/**
 * O vocabulário da sala da fábrica (#122), do lado de cá da ponte.
 *
 * Só tipos, sem import de `electron` nem do SDK, como `src/shared/board.ts`.
 */
export type EstadoDoDespachante = 'rodando' | 'parado' | 'desconhecido'

/** A estação da esteira de um despacho, pela skill do comando (F1.5; a F2 a transforma em coluna). */
export type EstacaoDaFabrica =
  | 'entrada'
  | 'card'
  | 'spec'
  | 'tasks'
  | 'implementacao'
  | 'integracao'
  | 'revisao'
  | 'validacao'
  | 'release'
  | 'operacao'

export interface ItemNaSala {
  id: string // 'q-0003'
  tipo: 'pergunta' | 'decisao' // a F3 é dona da classificação
  card: number
  cardUrl: string
  motivo: string
  despacho: string
  comando: string | null // o do despacho de origem; null se ele não está no estado
  sessaoClaude: string | null
  criadoEm: string
  fechadoEm: string | null
  resolucao: string | null
}

export interface DespachoNaSala {
  id: string
  card: number
  cardUrl: string
  comando: string
  estacao: EstacaoDaFabrica | null // null: o comando não começa por uma skill da esteira
  estado: 'pendente' | 'lancando' | 'rodando'
  criadoEm: string
  lancadoEm: string | null
}

/** A pausa da fábrica (#129): `pausa.json` existe. `desde: null` quando o arquivo está torto. */
export interface PausaDaFabrica {
  desde: string | null
}

/** O que os três ramos do retrato dividem: o projeto, o despachante e a pausa (F1.5). */
interface CabecalhoDaSala {
  lidoEm: string
  projeto: string // 'Operations Center · Project 2'
  despachante: EstadoDoDespachante
  pausa: PausaDaFabrica | null // null: não está pausada
}

export type SalaDaFabrica =
  | ({ kind: 'sem-estado' } & CabecalhoDaSala)
  | ({ kind: 'ilegivel'; erro: string } & CabecalhoDaSala)
  | ({
      kind: 'ok'
      emVoo: DespachoNaSala[]
      abertos: ItemNaSala[]
      fechados: ItemNaSala[]
      frentesAbertas: number
    } & CabecalhoDaSala)

/** Os comandos do `yarn fabrica` que o app pode rodar (#129). Cada fase acrescenta os seus. */
export type ComandoDaFabrica =
  { tipo: 'pausar' } | { tipo: 'retomar' } | { tipo: 'fechar'; item: string; resolucao: string }

export interface ResultadoDoComando {
  ok: boolean // codigo === 0
  codigo: number // o código de saída do `executar`
  argv: string[] // o que rodou, para a tela e para o teste
  saida: string // o que o `executar` escreveu, linhas juntas por '\n'
  erro: string // o que ele avisou, idem
}

/** Como terminou o despacho de origem de um item (o `Desfecho['tipo']` do core, do lado de cá). */
export type FimDoDespacho = 'proximo' | 'parada' | 'falha'

/** Um despacho da frente de um item, para "Como chegou aqui" (F3). */
export interface PassoDaFrente {
  despacho: string // 'd-0007'
  skill: string // 'gm-plan-tasks': o primeiro termo do comando, sem a barra
  comando: string
  fim: FimDoDespacho | null // null: o despacho não concluiu
  detalhe: string | null // proximo → o comando seguinte; parada/falha → o motivo; null sem fim
  em: string | null // o `concluidoEm`
}

export interface PerguntaDaFila {
  item: ItemNaSala
  resultado: string | null // o `result` do saida.json da sessão de origem
  fechar: string // 'yarn fabrica fechar q-0003 "<resolução>"'; as telas da F3 não o mostram
  fim: FimDoDespacho | null // o desfecho do despacho de origem; null se ele não está no estado ou não concluiu
  pr: number | null // só quando `item.tipo === 'decisao'`: a PR citada no motivo
  prUrl: string | null // `urlDaPr(pr)`, ou null
  passos: PassoDaFrente[] // os despachos da frente do item, do mais antigo ao mais novo
}

export interface ReadPerguntaRequest {
  id: string
}

export interface ReadRelatorioRequest {
  dia: string
}

export type RelatorioDaSala =
  | { kind: 'ok'; dia: string; markdown: string; semFonte: number; geradoEm: string }
  | { kind: 'erro'; dia: string; erro: string }
