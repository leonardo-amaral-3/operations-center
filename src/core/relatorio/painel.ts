import type { DecisaoDoDia, PainelDoDia } from '../../shared/fabrica'
import { classificar } from './classificar'
import { lerDecisao, normalizar } from './cofre'
import type { Decisao, EntradaDoRelatorio, Relatorio } from './tipos'

/**
 * O relatório do dia em dado para as telas da F5 (spec-f5 §F5.3). Puro, como o resto do core do
 * relatório: a classificação e a frente de cada decisão são as da P1, sem segunda regra.
 */

export interface ResumoDoCofre {
  noCofre: number
  porRepo: Array<{ repo: string; decisoes: number }>
  semRepo: Decisao[]
}

const porNome = (a: string, b: string): number => a.localeCompare(b, 'en')

/**
 * O cofre inteiro do dia, de qualquer repo: quantas decisões, quantas por repo e as que foram
 * gravadas com escopo só número (o alerta de governança). O dono do repo cai do nome.
 */
export function resumirCofre(
  arquivos: readonly { nome: string; texto: string }[],
  dia: string,
): ResumoDoCofre {
  let noCofre = 0
  const semRepo: Decisao[] = []
  const contagem = new Map<string, number>()

  for (const { nome, texto } of arquivos) {
    if (!nome.endsWith('.md')) continue

    const d = lerDecisao(nome, texto)

    if (d === null || d.data !== dia) continue
    noCofre += 1
    if (/^#?\d+$/.test(d.escopo)) {
      semRepo.push(d)
      continue
    }

    const repo = /^(?:[\w.-]+\/)?([\w.-]+)(?:#\d+)?$/.exec(d.escopo)?.[1] ?? 'sem escopo'

    contagem.set(repo, (contagem.get(repo) ?? 0) + 1)
  }

  const porRepo = [...contagem.entries()]
    .map(([repo, decisoes]) => ({ repo, decisoes }))
    .sort((a, b) => b.decisoes - a.decisoes || porNome(a.repo, b.repo))

  return { noCofre, porRepo, semRepo: semRepo.sort((a, b) => porNome(a.arquivo, b.arquivo)) }
}

/** As marcas `reversível:` e `sob:` do porquê (o mandato manda gravá-las). */
export function marcasDoPorque(porque: string | null): {
  reversivel: 'sim' | 'nao' | null
  sob: string | null
} {
  if (porque === null) return { reversivel: null, sob: null }

  const marca = /\breversivel:\s*(sim|nao)\b/.exec(normalizar(porque))?.[1]
  const reversivel = marca === 'sim' || marca === 'nao' ? marca : null
  const casou = /\bsob:[ \t]*([^\n]*)/.exec(porque)

  if (casou === null) return { reversivel, sob: null }

  let valor = casou[1] ?? ''
  // Para no primeiro ponto seguido de espaço ou do fim da linha: o resto é texto livre.
  const ponto = valor.search(/\.(\s|$)/)

  if (ponto >= 0) valor = valor.slice(0, ponto)
  valor = valor.trim()

  return { reversivel, sob: valor === '' ? null : valor }
}

export function montarPainel(
  e: EntradaDoRelatorio,
  r: Relatorio,
  cofre: ResumoDoCofre,
): PainelDoDia {
  // Cada decisão do cofre entra numa `Linha` da sua frente, com a fonte `cofre` (M7).
  const frenteDe = new Map<string, number | null>()

  for (const f of r.frentes) {
    for (const secao of ['chave', 'provisorias', 'estacionadas', 'desvios', 'resto'] as const) {
      for (const linha of f.secoes[secao]) {
        for (const fonte of linha.fontes) {
          if (fonte.tipo === 'cofre') frenteDe.set(fonte.rotulo, f.card)
        }
      }
    }
  }

  const base = (d: Decisao) => ({
    arquivo: d.arquivo,
    escopo: d.escopo,
    tipo: d.tipo,
    titulo: d.titulo,
    porque: d.porque,
    descartado: d.descartado,
    objetivos: [...d.objetivos],
    provisoria: d.provisoria,
    ...marcasDoPorque(d.porque),
  })
  const doRepo: DecisaoDoDia[] = e.decisoes.map((d) => {
    const { classe, motivo } = classificar(d)

    return {
      ...base(d),
      card: d.card,
      frente: frenteDe.get(d.arquivo) ?? null,
      secao: classe,
      motivo,
    }
  })
  const semRepo: DecisaoDoDia[] = cofre.semRepo.map((d) => ({
    ...base(d),
    card: null,
    frente: null,
    secao: 'sem-repo',
    motivo: 'escopo sem repo',
  }))

  return {
    frases: r.frentes
      .map((f) => ({ card: f.card, texto: f.secoes.frase[0]?.texto ?? '' }))
      .filter((f) => f.texto !== ''),
    decisoes: [...doRepo, ...semRepo].sort((a, b) => porNome(a.arquivo, b.arquivo)),
    porRepo: cofre.porRepo,
    noCofre: cofre.noCofre,
    commits: e.commits.filter((c) => c.sha.trim() !== '').length,
    objetivos: e.objetivos === null ? null : e.objetivos.map((o) => ({ ...o })),
  }
}
