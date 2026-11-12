/**
 * Os tipos do relatório do dia (#120, P1 do épico #118). Spec: `spec-p1.md`, §1.
 *
 * O `core` do relatório é puro (Coding Standards da spec; R17): nada aqui lê disco, roda `git` ou
 * fala com a rede. Tudo chega por parâmetro e sai como dado, como no `BoardReader`.
 */

/** O dia do relatório, em UTC (R3): `inicio` inclusivo, `fim` exclusivo. */
export interface Janela {
  dia: string // 'AAAA-MM-DD'
  inicio: string // `${dia}T00:00:00Z`
  fim: string // dia seguinte, `T00:00:00Z`
}

export type TipoDeFonte = 'cofre' | 'card' | 'commit' | 'board' | 'git' | 'direcao'

/** Fonte válida é a que tem `rotulo` não vazio depois de `trim()`. `url` é opcional. */
export interface Fonte {
  tipo: TipoDeFonte
  rotulo: string
  url: string | null
}

export interface Decisao {
  arquivo: string // só o nome, sem pasta
  data: string
  tipo: string // cru, do frontmatter
  escopo: string // cru, com trim
  card: number | null // o #n do escopo
  substitui: string | null // cru, do frontmatter
  titulo: string
  fato: string
  porque: string | null
  descartado: string | null
  objetivos: readonly string[] // 'P0'..'P3', sem repetição, em ordem
  provisoria: boolean // marca `provisória: sim`
  irreversivel: boolean // marca `reversível: não`
}

export interface EventoDeStatus {
  em: string // createdAt
  de: string // previousStatus ('' = fora do board)
  para: string // status
}

export interface CardLido {
  numero: number
  titulo: string
  url: string
  pai: number | null
  eventos: readonly EventoDeStatus[] // só os do Project pedido, por `em` crescente
}

export interface Commit {
  sha: string
  em: string // %cI
  assunto: string
  card: number | null
}

export interface Objetivo {
  codigo: string // 'P0'
  nome: string // 'Fundação'
}

export interface EntradaDoRelatorio {
  janela: Janela
  repo: { owner: string; name: string }
  projeto: number
  pastaDoCofre: string
  pastaDoRepo: string
  decisoes: readonly Decisao[]
  ilegiveis: readonly string[] // nomes de arquivo
  cards: ReadonlyMap<number, CardLido>
  commits: readonly Commit[]
  objetivos: readonly Objetivo[] | null // null = sem fabrica/DIRECAO.md
}

export interface Linha {
  texto: string
  detalhes: readonly string[] // parágrafos abaixo do item, na ordem
  fontes: readonly Fonte[]
}

export type Secao = 'frase' | 'chave' | 'provisorias' | 'estacionadas' | 'desvios' | 'resto'

export interface Frente {
  card: number | null // null = sem card
  titulo: string // já formatado para o cabeçalho (§7)
  secoes: Readonly<Record<Secao, readonly Linha[]>>
  restoContado: number // decisões de rotina + commits
}

export interface Relatorio {
  janela: Janela
  repo: { owner: string; name: string }
  contagem: readonly Linha[]
  frentes: readonly Frente[]
  ilegiveis: readonly Linha[]
  semFonte: number
}
