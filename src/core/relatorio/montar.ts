import { ESTEIRA_STATIONS } from '../board/query'
import { normalizeStation } from '../board/stations'
import { classificar, type Classe } from './classificar'
import type {
  CardLido,
  Commit,
  Decisao,
  EntradaDoRelatorio,
  Fonte,
  Frente,
  Linha,
  Objetivo,
  Relatorio,
  Secao,
} from './tipos'

/**
 * Monta o relatório do dia a partir de dados já lidos (#120, spec-p1 §7).
 *
 * Pura: não lê disco, não roda `git` e não fala com a rede (R17). O corte "sem fonte não entra" vem
 * primeiro e último (CA-1.2): antes de qualquer contagem sai a decisão sem `arquivo` e o commit sem
 * `sha`, e no fim sai toda `Linha` que ficou sem fonte válida. As duas saídas somam em `semFonte`.
 */

const ESTACOES = ESTEIRA_STATIONS.map(normalizeStation)
const MAX_SALTOS = 5

const SECAO_DA_CLASSE: Readonly<Record<Exclude<Classe, 'rotina'>, Secao>> = {
  chave: 'chave',
  provisoria: 'provisorias',
  estacionada: 'estacionadas',
  desvio: 'desvios',
}

const emJanela = (em: string, inicio: number, fim: number): boolean => {
  const t = Date.parse(em)

  return t >= inicio && t < fim
}

const plural = (n: number, singular: string, mais: string): string => (n === 1 ? singular : mais)

const fonteValida = (f: Fonte): boolean => f.rotulo.trim() !== ''

const fonteDoCofre = (rotulo: string): Fonte => ({ tipo: 'cofre', rotulo, url: null })

const fonteDoCard = (c: CardLido): Fonte => ({ tipo: 'card', rotulo: `#${c.numero}`, url: c.url })

const nomeDoArquivo = (a: { arquivo: string }, b: { arquivo: string }): number =>
  a.arquivo.localeCompare(b.arquivo, 'en')

/** O `para` do último evento anterior a `limite`, ou `''` (fora do board) quando não há. */
function statusAntesDe(card: CardLido, limite: number): string {
  let status = ''

  for (const e of card.eventos) {
    if (Date.parse(e.em) < limite) status = e.para
  }

  return status === '' ? 'fora do board' : status
}

function posicao(estacao: string): number {
  return ESTACOES.indexOf(normalizeStation(estacao))
}

interface Parte {
  decisoes: { decisao: Decisao; classe: Classe; motivo: string }[]
  commits: Commit[]
  cards: Set<number>
}

export function montarRelatorio(e: EntradaDoRelatorio): Relatorio {
  const inicio = Date.parse(e.janela.inicio)
  const fim = Date.parse(e.janela.fim)
  let semFonte = 0

  const decisoes = e.decisoes.filter((d) => {
    if (d.arquivo.trim() !== '') return true
    semFonte += 1

    return false
  })
  const commits = e.commits.filter((c) => {
    if (c.sha.trim() !== '') return true
    semFonte += 1

    return false
  })

  /** A raiz da cadeia de sub-issues (§7): para no último pai lido, em 5 saltos ou num ciclo. */
  const raiz = (n: number): number => {
    const vistos = new Set<number>([n])
    let atual = n

    for (let salto = 0; salto < MAX_SALTOS; salto += 1) {
      const pai = e.cards.get(atual)?.pai ?? null

      if (pai === null || !e.cards.has(pai) || vistos.has(pai)) break
      vistos.add(pai)
      atual = pai
    }

    return atual
  }

  // As frentes: a chave é a raiz, ou `null` para o que não tem card.
  const partes = new Map<number | null, Parte>()
  const parte = (chave: number | null): Parte => {
    let p = partes.get(chave)

    if (p === undefined) {
      p = { decisoes: [], commits: [], cards: new Set() }
      partes.set(chave, p)
    }

    return p
  }

  for (const decisao of decisoes) {
    const chave = decisao.card === null ? null : raiz(decisao.card)
    const p = parte(chave)

    p.decisoes.push({ decisao, ...classificar(decisao) })
    if (decisao.card !== null) p.cards.add(decisao.card)
  }
  for (const commit of commits) {
    const chave = commit.card === null ? null : raiz(commit.card)
    const p = parte(chave)

    p.commits.push(commit)
    if (commit.card !== null) p.cards.add(commit.card)
  }

  const eventosDoDia = (c: CardLido) => c.eventos.filter((ev) => emJanela(ev.em, inicio, fim))
  const volumeDeEventos = new Map<number | null, number>()

  for (const card of e.cards.values()) {
    const doDia = eventosDoDia(card)

    if (doDia.length === 0) continue

    const chave = raiz(card.numero)

    parte(chave).cards.add(card.numero)
    volumeDeEventos.set(chave, (volumeDeEventos.get(chave) ?? 0) + doDia.length)
  }
  // A raiz também é citada na frase, mesmo sem entrada própria.
  for (const [chave, p] of partes) {
    if (chave !== null) p.cards.add(chave)
  }

  const volume = (chave: number | null): number => {
    const p = parte(chave)

    return p.decisoes.length + p.commits.length + (volumeDeEventos.get(chave) ?? 0)
  }
  const chaves = [...partes.keys()].sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1

    return volume(b) - volume(a) || a - b
  })

  const frentes: Frente[] = chaves.map((chave) => {
    const p = parte(chave)
    const ordenadas = [...p.decisoes].sort((a, b) => nomeDoArquivo(a.decisao, b.decisao))
    const secoes: Record<Secao, Linha[]> = {
      frase: [],
      chave: [],
      provisorias: [],
      estacionadas: [],
      desvios: [],
      resto: [],
    }

    for (const { decisao, classe, motivo } of ordenadas) {
      if (classe === 'rotina') continue

      const detalhes: string[] = []

      if (decisao.fato !== decisao.titulo) detalhes.push(decisao.fato)
      if (decisao.porque !== null) detalhes.push(`**Por quê:** ${decisao.porque}`)
      if (decisao.descartado !== null) detalhes.push(`**Descartado:** ${decisao.descartado}`)
      secoes[SECAO_DA_CLASSE[classe]].push({
        texto: `**${decisao.titulo}**${motivo === '' ? '' : ` — ${motivo}`}`,
        detalhes,
        fontes: [fonteDoCofre(decisao.arquivo)],
      })
    }

    const citados = [...p.cards].sort((a, b) => a - b)

    // Desvios do board: o card que anda para trás na esteira (Technical Decisions, 6 e 15).
    for (const n of citados) {
      const card = e.cards.get(n)

      if (card === undefined) continue
      for (const ev of eventosDoDia(card)) {
        const de = posicao(ev.de)
        const para = posicao(ev.para)

        if (de >= 0 && para >= 0 && para < de) {
          secoes.desvios.push({
            texto: `#${n} voltou de ${ev.de} para ${ev.para} em ${ev.em}`,
            detalhes: [],
            fontes: [fonteDoCard(card)],
          })
        }
      }
    }

    const rotina = ordenadas.filter((x) => x.classe === 'rotina')

    if (rotina.length > 0) {
      const porTipo = new Map<string, number>()

      for (const { decisao } of rotina) {
        porTipo.set(decisao.tipo, (porTipo.get(decisao.tipo) ?? 0) + 1)
      }

      const tipos = [...porTipo.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([tipo, n]) => `${tipo} ${n}`)

      secoes.resto.push({
        texto: `${rotina.length} de rotina (${tipos.join(', ')})`,
        detalhes: [],
        fontes: rotina.map((x) => fonteDoCofre(x.decisao.arquivo)),
      })
    }
    if (p.commits.length > 0) {
      const resumo = p.commits.map((c) => `${c.sha.slice(0, 7)} ${c.assunto}`).join('; ')

      secoes.resto.push({
        texto: `${p.commits.length} ${plural(p.commits.length, 'commit', 'commits')}: ${resumo}`,
        detalhes: [],
        fontes: p.commits.map((c) => ({
          tipo: 'commit',
          rotulo: c.sha.slice(0, 7),
          url: `https://github.com/${e.repo.owner}/${e.repo.name}/commit/${c.sha}`,
        })),
      })
    }

    secoes.frase.push(fraseDoDia(e, chave, p, citados))

    const titulo =
      chave === null
        ? `${e.repo.name}, sem card`
        : e.cards.has(chave)
          ? `[#${chave}](${e.cards.get(chave)?.url ?? ''}) · ${e.cards.get(chave)?.titulo ?? ''}`
          : `#${chave}`

    return { card: chave, titulo, secoes, restoContado: rotina.length + p.commits.length }
  })

  const contagemDeClasse = (classe: Classe): number =>
    decisoes.filter((d) => classificar(d).classe === classe).length
  const mudancas = [...e.cards.values()].reduce((s, c) => s + eventosDoDia(c).length, 0)
  const contagem: Linha[] = [
    {
      texto:
        `${decisoes.length} ${plural(decisoes.length, 'decisão', 'decisões')} do cofre com escopo ` +
        `${e.repo.name} em ${e.janela.dia}: chave ${contagemDeClasse('chave')}, provisórias ` +
        `${contagemDeClasse('provisoria')}, estacionadas ${contagemDeClasse('estacionada')}, desvios ` +
        `${contagemDeClasse('desvio')}, rotina ${contagemDeClasse('rotina')}`,
      detalhes: [],
      fontes: [fonteDoCofre(e.pastaDoCofre)],
    },
    {
      texto: `${mudancas} ${plural(mudancas, 'mudança', 'mudanças')} de Status no board`,
      detalhes: [],
      fontes: [
        {
          tipo: 'board',
          rotulo: `Project ${e.projeto}`,
          url: `https://github.com/users/${e.repo.owner}/projects/${e.projeto}`,
        },
      ],
    },
    {
      texto: `${commits.length} ${plural(commits.length, 'commit', 'commits')} nos refs locais e remotos, sem fetch`,
      detalhes: [],
      fontes: [{ tipo: 'git', rotulo: e.pastaDoRepo, url: null }],
    },
  ]

  const ilegiveis: Linha[] = e.ilegiveis.map((nome) => ({
    texto: 'sem frontmatter com `data` e `tipo`',
    detalhes: [],
    fontes: [fonteDoCofre(nome)],
  }))

  // O corte do fim: linha sem nenhuma fonte válida sai e soma em `semFonte`.
  const comFonte = (linhas: readonly Linha[]): Linha[] =>
    linhas.filter((l) => {
      if (l.fontes.some(fonteValida)) return true
      semFonte += 1

      return false
    })
  const frentesFinais = frentes.map((f) => ({
    ...f,
    secoes: {
      frase: comFonte(f.secoes.frase),
      chave: comFonte(f.secoes.chave),
      provisorias: comFonte(f.secoes.provisorias),
      estacionadas: comFonte(f.secoes.estacionadas),
      desvios: comFonte(f.secoes.desvios),
      resto: comFonte(f.secoes.resto),
    },
  }))
  const contagemFinal = comFonte(contagem)
  const ilegiveisFinais = comFonte(ilegiveis)

  return {
    janela: e.janela,
    repo: e.repo,
    contagem: contagemFinal,
    frentes: frentesFinais,
    ilegiveis: ilegiveisFinais,
    semFonte,
  }
}

/**
 * A frase do dia: uma linha por frente (§7). Nunca cita arquivo do cofre nem commit pelo nome, para
 * o CA-1.3 poder contar cada fonte "exatamente uma vez" na linha da seção onde a decisão caiu.
 */
function fraseDoDia(
  e: EntradaDoRelatorio,
  chave: number | null,
  p: Parte,
  citados: readonly number[],
): Linha {
  const inicio = Date.parse(e.janela.inicio)
  const fim = Date.parse(e.janela.fim)
  const D = p.decisoes.length
  const C = p.commits.length
  const decisoesTexto = `${D} ${plural(D, 'decisão', 'decisões')}`
  const commitsTexto = `${C} ${plural(C, 'commit', 'commits')}`

  if (chave === null) {
    const fontes: Fonte[] = [fonteDoCofre(e.pastaDoCofre)]

    if (C > 0) fontes.push({ tipo: 'git', rotulo: e.pastaDoRepo, url: null })

    return {
      texto: `${decisoesTexto} no cofre e ${commitsTexto} sem card.`,
      detalhes: [],
      fontes,
    }
  }

  const fontes: Fonte[] = []
  const movimentos = citados.map((n) => {
    const card = e.cards.get(n)

    if (card === undefined) return `#${n} não foi achado no GitHub`
    fontes.push(fonteDoCard(card))

    const antes = statusAntesDe(card, inicio)
    const depois = statusAntesDe(card, fim)
    const mudou = card.eventos.filter((ev) => emJanela(ev.em, inicio, fim)).length

    if (mudou === 0) {
      return depois === 'fora do board' ? `#${n} fora do board` : `#${n} segue em ${depois}`
    }

    return `#${n} ${antes} → ${depois}${mudou > 1 ? ` (${mudou} mudanças)` : ''}`
  })

  const codigos = [...new Set(p.decisoes.flatMap((x) => x.decisao.objetivos))].sort()
  let texto = `${movimentos.join('; ')}. ${decisoesTexto} no cofre, ${commitsTexto}.`

  if (codigos.length > 0) {
    const nomeados = new Map<string, Objetivo>((e.objetivos ?? []).map((o) => [o.codigo, o]))
    let daDirecao = false
    const lista = codigos.map((codigo) => {
      const o = nomeados.get(codigo)

      if (o === undefined) return codigo
      daDirecao = true

      return `${codigo} · ${o.nome}`
    })

    texto += ` Objetivos: ${lista.join(', ')}.`
    if (daDirecao) fontes.push({ tipo: 'direcao', rotulo: 'fabrica/DIRECAO.md', url: null })
  }
  if (fontes.length === 0) fontes.push(fonteDoCofre(e.pastaDoCofre))

  return { texto, detalhes: [], fontes }
}
