import type { DecisaoDoDia, PainelDoDia, RevisaoNaSala } from '../../shared/fabrica'
import { plural } from './linha'

/**
 * As regras puras do relatório e do portfólio da fábrica (#134, §F5.9): estado de uma decisão,
 * filtros, números do dia, barra de esforço, tipos e objetivos. Sem React nem `window`.
 */

export type EstadoDaDecisao =
  'confirmada' | 'contestada' | 'provisória' | 'alerta' | 'estacionada' | 'rotina' | 'decidida'

/** O dia de hoje em UTC, como o CLI do relatório. */
export function hojeEmUtc(agora: Date): string {
  return agora.toISOString().slice(0, 10)
}

/** `'2026-11-10'` → `'10/11'`. */
export function diaCurto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}

/** `'2026-11-10'` → `'10/11/2026'`. */
export function diaLongo(dia: string): string {
  return `${diaCurto(dia)}/${dia.slice(0, 4)}`
}

export function estadoDaDecisao(d: DecisaoDoDia, r: RevisaoNaSala | undefined): EstadoDaDecisao {
  if (r?.veredito === 'confirmada') return 'confirmada'
  if (r?.veredito === 'contestada') return 'contestada'
  if (d.secao === 'sem-repo') return 'alerta'
  if (d.provisoria) return 'provisória'
  if (d.secao === 'estacionada') return 'estacionada'
  if (d.secao === 'rotina') return 'rotina'

  return 'decidida'
}

export function aberta(d: DecisaoDoDia, r: RevisaoNaSala | undefined): boolean {
  return estadoDaDecisao(d, r) === 'provisória'
}

export const COR_DO_ESTADO: Record<EstadoDaDecisao, string> = {
  confirmada: 'bg-attention',
  contestada: 'bg-danger',
  provisória: 'bg-warning',
  alerta: 'bg-danger',
  estacionada: 'bg-question',
  rotina: 'bg-secondary-background',
  decidida: 'bg-secondary-background',
}

export function ehChave(d: DecisaoDoDia): boolean {
  return d.secao === 'chave' || d.secao === 'provisoria' || d.secao === 'desvio'
}

export function rotuloDaFrente(d: DecisaoDoDia): string {
  if (d.card !== null) return `operations-center#${d.card}`
  if (d.secao === 'sem-repo') return `${d.escopo.replace(/^#/, '')} (sem repo)`

  return 'operations-center, sem card'
}

export function quemDecidiu(d: DecisaoDoDia): string {
  return d.sob ?? 'sem «sob:»'
}

export function rotuloDoReversivel(d: DecisaoDoDia): string {
  if (d.reversivel === 'sim') return 'reversível'
  if (d.reversivel === 'nao') return 'irreversível'

  return 'sem marca'
}

export const FILTROS = ['Todas', 'Chave', 'Provisórias', 'Suas', 'Sem objetivo', 'Alertas'] as const
export type Filtro = (typeof FILTROS)[number]

export function passaNoFiltro(f: Filtro, d: DecisaoDoDia, r: RevisaoNaSala | undefined): boolean {
  switch (f) {
    case 'Todas':
      return true
    case 'Chave':
      return ehChave(d)
    case 'Provisórias':
      return estadoDaDecisao(d, r) === 'provisória'
    case 'Suas':
      return r !== undefined
    case 'Sem objetivo':
      return d.objetivos.length === 0
    case 'Alertas':
      return d.secao === 'sem-repo'
  }
}

export interface NumerosDoDia {
  cofre: number
  chaves: number
  provisorias: number
  estacionadas: number
  semRepo: number
}

export function numerosDoDia(
  p: PainelDoDia,
  revisoes: ReadonlyMap<string, RevisaoNaSala>,
): NumerosDoDia {
  const doRepo = p.decisoes.filter((d) => d.secao !== 'sem-repo')

  return {
    cofre: p.noCofre,
    chaves: doRepo.filter(ehChave).length,
    provisorias: doRepo.filter((d) => estadoDaDecisao(d, revisoes.get(d.arquivo)) === 'provisória')
      .length,
    estacionadas: doRepo.filter((d) => d.secao === 'estacionada').length,
    semRepo: p.decisoes.filter((d) => d.secao === 'sem-repo').length,
  }
}

export interface Segmento {
  rotulo: string
  n: number
  largura: number
  classe: string
  semRepo: boolean
}

const REPO_DA_FABRICA = 'operations-center'

export function segmentosDoEsforco(p: PainelDoDia): Segmento[] {
  const total = p.noCofre
  if (total === 0) return []

  const largura = (n: number): number => Math.round((n * 1000) / total) / 10
  const segmento = (repo: string, n: number, classe: string): Segmento => ({
    rotulo: `${repo} · ${n}`,
    n,
    largura: largura(n),
    classe,
    semRepo: false,
  })

  const fabrica = p.porRepo.find((r) => r.repo === REPO_DA_FABRICA)
  const outros = p.porRepo.filter((r) => r.repo !== REPO_DA_FABRICA)
  const saida: Segmento[] = []
  let classes: string[]
  let resto: typeof outros

  if (fabrica !== undefined && fabrica.decisoes > 0) {
    saida.push(segmento(fabrica.repo, fabrica.decisoes, 'bg-main'))
    classes = ['bg-main/60', 'bg-main/25']
    resto = outros
  } else {
    classes = ['bg-main', 'bg-main/60', 'bg-main/25']
    resto = outros
  }

  const nomeados = resto.slice(0, classes.length)
  nomeados.forEach((r, i) => {
    saida.push(segmento(r.repo, r.decisoes, classes[i] ?? 'bg-main/25'))
  })

  const somaOutros = resto.slice(classes.length).reduce((soma, r) => soma + r.decisoes, 0)
  if (somaOutros > 0) {
    saida.push(segmento('outros', somaOutros, 'bg-secondary-background'))
  }

  const semRepo = p.decisoes.filter((d) => d.secao === 'sem-repo').length
  if (semRepo > 0) {
    saida.push({
      rotulo: `sem repo, ${semRepo}`,
      n: semRepo,
      largura: largura(semRepo),
      classe: 'bg-danger',
      semRepo: true,
    })
  }

  return saida
}

export function tiposDoDia(p: PainelDoDia): string {
  const doRepo = p.decisoes.filter((d) => d.secao !== 'sem-repo')
  const conta = (tipo: string): number => doRepo.filter((d) => d.tipo === tipo).length
  const conhecidos = ['decisao', 'descoberta', 'pendencia', 'restricao']
  const outros = doRepo.filter((d) => !conhecidos.includes(d.tipo)).length
  const partes = [
    `${conta('decisao')} ${plural(conta('decisao'), 'decisão', 'decisões')}`,
    `${conta('descoberta')} ${plural(conta('descoberta'), 'descoberta', 'descobertas')}`,
    `${conta('pendencia')} ${plural(conta('pendencia'), 'pendência', 'pendências')}`,
    `${conta('restricao')} ${plural(conta('restricao'), 'restrição', 'restrições')}`,
  ]
  if (outros > 0) partes.push(`${outros} de outro tipo`)

  return `Tipos: ${partes.join(', ')}.`
}

export interface ObjetivoDoDia {
  codigo: string
  nome: string
  frentes: string[]
  decisoes: number
}

function frentesDe(decisoes: DecisaoDoDia[]): string[] {
  const numeros = [
    ...new Set(decisoes.map((d) => d.frente).filter((f): f is number => f !== null)),
  ].sort((a, b) => a - b)
  const lista = numeros.map((n) => `#${n}`)
  if (decisoes.some((d) => d.frente === null)) lista.push('sem card')

  return lista
}

export function objetivosDoDia(p: PainelDoDia): ObjetivoDoDia[] | null {
  if (p.objetivos === null) return null
  const doRepo = p.decisoes.filter((d) => d.secao !== 'sem-repo')

  return p.objetivos.map((o) => {
    const citam = doRepo.filter((d) => d.objetivos.includes(o.codigo))

    return { codigo: o.codigo, nome: o.nome, frentes: frentesDe(citam), decisoes: citam.length }
  })
}

export function semObjetivoDoDia(p: PainelDoDia): {
  frentes: string[]
  decisoes: number
  doRepo: number
} {
  const doRepo = p.decisoes.filter((d) => d.secao !== 'sem-repo')
  const sem = doRepo.filter((d) => d.objetivos.length === 0)

  return { frentes: frentesDe(sem), decisoes: sem.length, doRepo: doRepo.length }
}
