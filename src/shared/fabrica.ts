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
  estacao: EstacaoDaFabrica | null // a do comando do despacho de origem (`estacaoDoComando`)
  sessaoQuebrada: boolean // o despacho de origem terminou com desfecho `falha`
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
  ondeRoda: string // `ondeRodaDo`; nunca caminho absoluto
  viva: boolean | null // a sessão existe em /proc; null = pendente ou fora do Linux
}

/** O que a sala mostra em "O que a fábrica decidiu": um passo da esteira, ou um item da fila. */
export type DecisaoNaSala =
  | { tipo: 'passou'; id: string; card: number; skill: string; seguinte: string; em: string }
  | { tipo: 'fila'; id: string; card: number; item: ItemNaSala; em: string }

/** Sessões da prova vivas contra o teto do mandato (F2 §F2.1); falha de leitura nunca vira número. */
export type LeituraDeSessoes =
  | { kind: 'ok'; vivas: number; teto: number }
  | { kind: 'sem-leitura'; motivo: string; teto: number }

/** O cadeado da suíte de smoke: livre, ou ocupado (com o card da pasta dona e quantos esperam). */
export type LeituraDaSuite =
  | { kind: 'livre' }
  | { kind: 'ocupada'; card: number | null; esperando: number }
  | { kind: 'sem-leitura'; motivo: string }

/** O espaço livre onde a fábrica escreve, em bytes, contra o mínimo da esteira. */
export type LeituraDoDisco =
  { kind: 'ok'; livres: number; minimo: number } | { kind: 'sem-leitura'; motivo: string }

export interface RecursosDaFabrica {
  sessoes: LeituraDeSessoes
  suite: LeituraDaSuite
  disco: LeituraDoDisco
}

/** A pausa da fábrica (#129): `pausa.json` existe. `desde: null` quando o arquivo está torto. */
export interface PausaDaFabrica {
  desde: string | null
}

/** O que os três ramos do retrato dividem: o projeto, o despachante, a pausa e os recursos. */
interface CabecalhoDaSala {
  lidoEm: string
  projeto: string // 'Operations Center · Project 2'
  despachante: EstadoDoDespachante
  pausa: PausaDaFabrica | null // null: não está pausada
  recursos: RecursosDaFabrica
}

export type SalaDaFabrica =
  | ({ kind: 'sem-estado' } & CabecalhoDaSala)
  | ({ kind: 'ilegivel'; erro: string } & CabecalhoDaSala)
  | ({
      kind: 'ok'
      emVoo: DespachoNaSala[]
      abertos: ItemNaSala[]
      fechados: ItemNaSala[]
      decisoes: DecisaoNaSala[]
      frentesAbertas: number
    } & CabecalhoDaSala)

/** Os comandos do `yarn fabrica` que o app pode rodar (#129). Cada fase acrescenta os seus. */
export type ComandoDaFabrica =
  | { tipo: 'pausar' }
  | { tipo: 'retomar' }
  | { tipo: 'fechar'; item: string; resolucao: string } // F3
  | { tipo: 'entrada'; texto: string } // F4

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

/** Um despacho de um card, para a tela Card (F4). */
export interface DespachoDoCard {
  id: string
  comando: string
  estacao: EstacaoDaFabrica | null
  estado: 'pendente' | 'lancando' | 'rodando' | 'concluido'
  criadoEm: string
  lancadoEm: string | null
  concluidoEm: string | null
  sessao: string | null // o `sessaoClaude`: só existe depois que a sessão termina (M4)
  fim: 'proximo' | 'parada' | 'falha' | null // o `desfecho.tipo`; null sem desfecho
  detalhe: string | null // proximo → o comando seguinte; parada/falha → o motivo; null sem desfecho
}

/** O card na fábrica (F4): o despacho atual, o fim dele e os despachos terminados. */
export type CardNaFabrica =
  | { kind: 'sem-estado'; card: number; cardUrl: string }
  | { kind: 'ilegivel'; card: number; cardUrl: string; erro: string }
  | { kind: 'sem-despacho'; card: number; cardUrl: string }
  | {
      kind: 'ok'
      card: number
      cardUrl: string
      atual: DespachoDoCard // o em voo; sem ele, o terminado mais recente
      ondeRoda: string // `ondeRodaDo` do atual; nunca caminho absoluto
      viva: boolean | null // só para `lancando`/`rodando`; null nos outros e fora do Linux
      resultado: string | null // o `result` do `saida.json` do atual, só quando ele terminou
      terminados: DespachoDoCard[] // os concluídos do card, do mais novo ao mais velho
    }

export interface ReadCardDaFabricaRequest {
  card: number
}

/** Um item da entrada da fábrica (F4). */
export interface ItemNaEntrada {
  id: string // 'e-0001'
  texto: string
  fonte: 'voce'
  criadoEm: string
  triadoEm: string | null
  resolucao: string | null
}

export type EntradaNaSala =
  | { kind: 'ok'; itens: ItemNaEntrada[]; total: number } // itens: os 20 mais novos, mais novo primeiro
  | { kind: 'ilegivel'; erro: string }

/** Assumir a sessão de um despacho terminado no cartão do card (F4). */
export interface AssumirDespachoRequest {
  despacho: string // 'd-0007'
  itemId: string // o `itemId` do card no board do app
}

export type AssumirDespachoResult =
  | { ok: true; anterior: string | null } // a conversa que o cartão tinha, quando era outra
  | { ok: false; motivo: string }
