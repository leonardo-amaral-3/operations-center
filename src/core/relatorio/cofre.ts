import type { Decisao, Janela } from './tipos'

type Repo = { owner: string; name: string }

/**
 * O repo da fábrica (Technical Decisions, 11). A assinatura da spec, `lerDecisao(arquivo, texto)`,
 * não traz o repo, mas o §2 manda preencher `card` por `cardDoEscopo(escopo, …)`: o terceiro
 * parâmetro é opcional e vale isto, e `decisoesDoDia` passa o repo que recebeu.
 */
const REPO_DA_FABRICA: Repo = { owner: 'leonardo-amaral-3', name: 'operations-center' }

/** O dia do cofre é o dia em UTC (R3). Não valida: quem valida é o CLI (spec-p1 §8). */
export function janelaDoDia(dia: string): Janela {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  const seguinte = new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10)

  return { dia, inicio: `${dia}T00:00:00Z`, fim: `${seguinte}T00:00:00Z` }
}

/** Tira os acentos e põe em minúsculas: as marcas do mandato variam na grafia (R7). */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** `p0..p3`, `p0, p2` ou `p0 e p1` viram os códigos, em maiúsculas, sem repetição e em ordem. */
function objetivosDe(porque: string): string[] {
  const achados = new Set<number>()

  for (const casou of porque.matchAll(/\bobjetivo:\s*(p[0-3](?:\s*(?:\.\.|,|e)\s*p[0-3])*)/g)) {
    let anterior: number | null = null
    let intervalo = false

    for (const ficha of (casou[1] ?? '').matchAll(/p([0-3])|\.\./g)) {
      if (ficha[1] === undefined) {
        intervalo = true
        continue
      }

      const codigo = Number(ficha[1])
      const de = intervalo && anterior !== null ? Math.min(anterior, codigo) : codigo
      const ate = intervalo && anterior !== null ? Math.max(anterior, codigo) : codigo

      for (let n = de; n <= ate; n++) achados.add(n)
      anterior = codigo
      intervalo = false
    }
  }

  return [...achados].sort((x, y) => x - y).map((n) => `P${n}`)
}

/**
 * O escopo do `lembrar` (`operations-center#118`) dito em repo e card (spec-p1 §2). `casa` só vale
 * para o repo pedido: `operations-center-x` e `outro/operations-center` não casam.
 */
export function cardDoEscopo(escopo: string, repo: Repo): { casa: boolean; card: number | null } {
  const casou = /^(?:([\w.-]+)\/)?([\w.-]+)(?:#(\d+))?$/.exec(escopo.trim())

  if (!casou) return { casa: false, card: null }

  const [, dono, nome, numero] = casou
  const casa = nome === repo.name && (dono === undefined || dono === repo.owner)

  return { casa, card: casa && numero !== undefined ? Number(numero) : null }
}

/** Lê um arquivo do cofre. `null` quando não tem frontmatter com `data` e `tipo` (spec-p1 §2). */
export function lerDecisao(
  arquivo: string,
  texto: string,
  repo: Repo = REPO_DA_FABRICA,
): Decisao | null {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n')

  if (linhas[0] !== '---') return null

  const fechamento = linhas.indexOf('---', 1)

  if (fechamento === -1) return null

  const frontmatter = new Map<string, string>()

  for (const linha of linhas.slice(1, fechamento)) {
    const casou = /^([a-z_]+):\s*(.*)$/.exec(linha)

    if (casou?.[1] !== undefined) frontmatter.set(casou[1], (casou[2] ?? '').trim())
  }

  const data = frontmatter.get('data') ?? ''
  const tipo = frontmatter.get('tipo') ?? ''

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || tipo === '') return null

  const escopo = frontmatter.get('escopo') ?? ''
  const substitui = frontmatter.get('substitui')
  const corpo = linhas.slice(fechamento + 1)

  // O bloco do título vai da primeira linha `# ` até a primeira linha vazia: o `lembrar` escreve
  // `# ${titulo}\n\n${fato}`, e o título tem várias linhas quando o fato quebra antes do ponto.
  const inicioDoTitulo = corpo.findIndex((l) => l.startsWith('# '))
  let fimDoTitulo = inicioDoTitulo

  if (inicioDoTitulo !== -1) {
    fimDoTitulo = corpo.findIndex((l, i) => i > inicioDoTitulo && l.trim() === '')
    if (fimDoTitulo === -1) fimDoTitulo = corpo.length
  }

  const blocoDoTitulo = inicioDoTitulo === -1 ? [] : corpo.slice(inicioDoTitulo, fimDoTitulo)
  const resto = inicioDoTitulo === -1 ? corpo : corpo.slice(fimDoTitulo)

  const ehMarcador = (l: string): boolean =>
    l.startsWith('**Por quê:** ') || l.startsWith('**Descartado:** ') || l.startsWith('**Refs:** ')
  const primeiroMarcador = resto.findIndex(ehMarcador)
  const fato = (primeiroMarcador === -1 ? resto : resto.slice(0, primeiroMarcador))
    .join('\n')
    .trim()

  const trecho = (marcador: string): string | null => {
    const i = resto.findIndex((l) => l.startsWith(marcador))

    if (i === -1) return null

    const fim = resto.findIndex((l, j) => j > i && ehMarcador(l))
    const linhasDoTrecho = resto.slice(i, fim === -1 ? resto.length : fim)

    return [linhasDoTrecho[0]?.slice(marcador.length) ?? '', ...linhasDoTrecho.slice(1)]
      .join('\n')
      .trim()
  }

  const porque = trecho('**Por quê:** ')
  const descartado = trecho('**Descartado:** ')
  const titulo =
    blocoDoTitulo.length > 0
      ? blocoDoTitulo.map((l, i) => (i === 0 ? l.slice(2) : l).trim()).join(' ')
      : (fato.split('\n').find((l) => l.trim() !== '') ?? '')

  const marcas = normalizar(porque ?? '')
  const { casa, card } = cardDoEscopo(escopo, repo)

  return {
    arquivo,
    data,
    tipo,
    escopo: escopo.trim(),
    card: casa ? card : null,
    substitui: substitui === undefined || substitui.trim() === '' ? null : substitui,
    titulo,
    fato,
    porque,
    descartado,
    objetivos: objetivosDe(marcas),
    provisoria: /\bprovisoria:\s*sim\b/.test(marcas),
    irreversivel: /\breversivel:\s*nao\b/.test(marcas),
  }
}

/**
 * As decisões do dia com escopo do repo, e os nomes que não deram para ler (spec-p1 §2). Um arquivo
 * ilegível entra pelo prefixo do dia no nome, seja de que repo for: é melhor um quebrado de outro
 * repo aparecer do que um do repo sumir (spec-p1 §7).
 */
export function decisoesDoDia(
  arquivos: readonly { nome: string; texto: string }[],
  dia: string,
  repo: Repo,
): { decisoes: Decisao[]; ilegiveis: string[] } {
  const decisoes: Decisao[] = []
  const ilegiveis: string[] = []

  for (const { nome, texto } of arquivos) {
    if (!nome.endsWith('.md')) continue

    const lida = lerDecisao(nome, texto, repo)

    if (lida === null) {
      if (nome.startsWith(`${dia}-`)) ilegiveis.push(nome)
      continue
    }

    if (lida.data === dia && cardDoEscopo(lida.escopo, repo).casa) decisoes.push(lida)
  }

  const porNome = (a: string, b: string): number => a.localeCompare(b, 'en')

  return {
    decisoes: decisoes.sort((a, b) => porNome(a.arquivo, b.arquivo)),
    ilegiveis: ilegiveis.sort(porNome),
  }
}
