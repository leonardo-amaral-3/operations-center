/**
 * O contrato IPC, num módulo que **os dois lados importam**.
 *
 * Renderer e main não conversam por string solta: os nomes de canal e o formato de cada carga
 * moram aqui, e é o compilador que impede um lado de mudar sem o outro. É também o único módulo
 * que o renderer compartilha com o processo Node — por isso ele não conhece `electron` nem o SDK,
 * só os tipos de dado que o `core` publica.
 */

import type { BoardsSnapshot, CardContent } from './board'
import type {
  ChatMessage,
  PermissionDecision,
  QuestionAnswers,
  SessionInit,
  SessionState,
  TurnActivity,
} from './session'
import type { Theme } from './theme'

/**
 * Qual tela o app desenha. Decidido no main por `OC_SCREEN` e entregue ao preload por argv — o
 * renderer não escolhe, só obedece.
 */
export type Screen = 'kanban' | 'chat'

/** Renderer → main. Toda pergunta tem resposta, então são `invoke`. */
export const IPC_INVOKE = {
  start: 'session:start',
  send: 'session:send',
  respondPermission: 'session:respond-permission',
  answerQuestion: 'session:answer-question',
  stop: 'session:stop',
  close: 'session:close',
  chooseFolder: 'repo:choose-folder',
  /**
   * O plural é o nome ficando honesto sobre a carga: um `board:read` que devolve a lista de todos
   * os boards descobertos é um nome que mente.
   */
  readBoards: 'boards:read',
  /**
   * Qual aba o humano ativou. **O prefixo `ui:` é de propósito**: este é o primeiro canal de
   * *escrita* da ponte, e o que ele escreve é estado local do app — nunca o GitHub. Ficar fora de
   * `boards:` e de `card:` é o que mantém a asserção "todo canal que toca o GitHub é de leitura"
   * verdadeira **e** legível para quem chegar depois com a canária vermelha na mão.
   */
  activateBoard: 'ui:active-board',
  readCard: 'card:read',
  readConversations: 'conversations:read',
  readDangerous: 'danger:read',
  setDangerous: 'danger:set',
} as const

/** Main → renderer. Avisos de mão única, disparados pelo `core` quando a sessão se mexe. */
export const IPC_EVENT = {
  init: 'session:init',
  message: 'session:message',
  state: 'session:state',
  /**
   * O pulso do turno. Canal próprio, e não um campo do `state`: ele bate a cada ~1,3s enquanto o
   * modelo pensa, e o kanban assina o `state` para manter o crachá dos cartões fechados vivo. Quem
   * não quer o pulso não assina.
   */
  activity: 'session:activity',
  boards: 'boards:changed',
  /**
   * Mudou o conjunto de cartões com conversa recuperável. Canal próprio, e não carona no board: o
   * board tem throttle de 10s (`BOARD_REREAD_THROTTLE_MS`) e fala do GitHub; isto é estado do app e
   * precisa aparecer na hora em que uma sessão nasce ou é encerrada.
   */
  conversations: 'conversations:changed',
  /**
   * Mudou o conjunto de cartões que rodam sem o portão. Canal próprio pelo mesmo motivo do de
   * conversas: é estado do app, precisa aparecer na hora, e não tem nada a ver com o throttle de
   * 10s do board.
   */
  dangerous: 'danger:changed',
} as const

/**
 * O retrato da sessão no instante em que ela nasce.
 *
 * `start` devolve o retrato em vez de só o id porque a assinatura dos canais e a criação da sessão
 * não são o mesmo instante: qualquer evento disparado antes de o `invoke` voltar ao renderer
 * chegaria a ninguém. Com o retrato, a tela começa do estado real e os eventos só a atualizam.
 */
export interface SessionSnapshot {
  id: string
  /**
   * De qual cartão é esta sessão, ou `undefined` na tela de chat da fatia vertical. Volta no retrato
   * porque o kanban mantém várias sessões vivas ao mesmo tempo: sem ele, uma resposta que chega
   * fora de ordem não teria como ser casada com o cartão que a pediu.
   */
  itemId: string | undefined
  init: SessionInit | undefined
  state: SessionState
  messages: readonly ChatMessage[]
  /**
   * O pulso no instante do retrato — é o que faz um cartão reaberto no meio do turno já nascer com
   * o relógio certo, em vez de começar a contar do zero e mentir sobre a idade do turno.
   */
  activity: TurnActivity
}

/**
 * De qual cartão é a sessão. Ausente = a tela de chat da fatia vertical, que roda em `OC_CWD`.
 *
 * Continua sendo o main quem traduz `itemId` em pasta: o renderer manda o cartão, nunca o caminho.
 */
export interface StartRequest {
  itemId?: string
}

/**
 * "Não sei onde fica o repo" **não é exceção**: é uma resposta prevista, e o cartão sabe o que fazer
 * com ela (CA-5). Rejeitar obrigaria o renderer a farejar a mensagem do erro para distinguir isso de
 * uma falha de verdade — e mensagem de erro não é contrato. Falha real continua rejeitando.
 */
export type StartResult =
  { started: true; session: SessionSnapshot } | { started: false; reason: 'unknown-folder' }

export interface SendRequest {
  sessionId: string
  text: string
}

export interface RespondPermissionRequest {
  sessionId: string
  requestId: string
  decision: PermissionDecision
}

export interface AnswerQuestionRequest {
  sessionId: string
  requestId: string
  answers: QuestionAnswers
}

/**
 * Parar o turno em curso. **Não** é `close`: a sessão continua viva, com id, contexto e histórico —
 * o que morre é a vez que estava rodando.
 */
export interface StopRequest {
  sessionId: string
}

export interface CloseRequest {
  sessionId: string
}

/** Abre o seletor de diretório para o repo daquele cartão (CA-5). */
export interface ChooseFolderRequest {
  itemId: string
}

/**
 * **Sem caminho.** O renderer só precisa saber se houve escolha para chamar `start` de novo; quem
 * guarda e usa a pasta é o main. Devolver a string seria fazer um caminho de disco atravessar a
 * ponte sem nenhum uso do outro lado — e a canária do `ipc-no-path` existe para impedir justamente
 * isso. O caminho aparece na tela por outra via: o `cwd` que o próprio SDK reporta no `init`.
 */
export interface ChooseFolderResult {
  chosen: boolean
}

/**
 * Qual aba o usuário ativou. **`key`, nunca coordenada**: para o renderer ela é string opaca, e quem
 * a traduz em `owner`/`number` é o main — a mesma regra que já vale para `itemId`.
 *
 * `key` que o main não reconheça **não é erro**: o retrato pode ter mudado entre o desenho da barra
 * e o clique, e derrubar o `invoke` por isso faria uma corrida normal virar exceção na tela.
 */
export interface ActivateBoardRequest {
  key: string
}

/** De qual cartão. `itemId`, nunca `owner/name/number`: quem traduz cartão em coordenada é o main. */
export interface ReadCardRequest {
  itemId: string
}

/**
 * Falha **não rejeita**, pelo mesmo motivo de `StartResult`: a tela precisa desenhar o erro dentro
 * do cartão, e o motivo é texto de tela — o precedente é `BoardTab.error`, que já é a string
 * que o kanban mostra.
 */
export type ReadCardResult = { ok: true; content: CardContent } | { ok: false; reason: string }

/**
 * Todo evento diz de qual sessão veio. Hoje há uma só na tela; o `sessionId` é o que faz o kanban
 * do PRD ser depois um problema de roteamento no renderer, e não uma troca de contrato.
 */
export interface SessionInitEvent {
  sessionId: string
  init: SessionInit
}

export interface SessionMessageEvent {
  sessionId: string
  message: ChatMessage
}

export interface SessionStateEvent {
  sessionId: string
  state: SessionState
}

/**
 * O pulso do turno corrente, já com os dois carimbos de relógio que o main põe.
 *
 * Vem inteiro a cada batida, e não como delta: o consumidor substitui o que tem, e um evento
 * perdido não deixa a tela contando de um valor que nunca mais será corrigido.
 */
export interface SessionActivityEvent {
  sessionId: string
  activity: TurnActivity
}

/**
 * Quais cartões têm conversa a retomar. Vem inteiro a cada mudança, e o consumidor substitui — a
 * mesma regra do `BoardsSnapshot` e do `TurnActivity`, e pelo mesmo motivo: evento perdido não deixa
 * a tela num estado que nunca mais será corrigido.
 *
 * **Só `itemId`.** Nenhum `sessionId` e nenhuma pasta atravessam a ponte: o renderer não tem o que
 * fazer com eles, e a canária do `ipc-no-path` existe para manter isso assim.
 */
export interface ConversationsSnapshot {
  itemIds: readonly string[]
}

/**
 * Qual cartão, e para qual lado. `dangerous: false` é desmarcar.
 *
 * **`itemId`, nunca pasta** — a mesma regra do `StartRequest`, e aqui ela vale ainda mais: o modo
 * tira o portão de uma sessão que escreve em disco, e deixar o renderer dizer *onde* seria juntar
 * as duas metades exatas do buraco que `contextIsolation` fecha.
 */
export interface SetDangerousRequest {
  itemId: string
  dangerous: boolean
}

/**
 * Quais cartões rodam sem o portão. Inteiro a cada mudança, como o `ConversationsSnapshot` e pela
 * mesma razão: evento perdido não deixa a tela num estado que nunca mais será corrigido.
 */
export interface DangerousSnapshot {
  itemIds: readonly string[]
}

/**
 * A superfície inteira que o renderer enxerga, exposta como `window.oc` pelo preload. O que não
 * está aqui não existe do lado de lá — não há `ipcRenderer`, não há `require`, não há Node.
 *
 * Os `on*` devolvem a função de cancelamento, como os do `core`: um `useEffect` que assina precisa
 * poder desassinar sem guardar o handler.
 */
export interface OcApi {
  /**
   * Qual tela desenhar. É um valor, não uma promessa: o preload o resolve de `process.argv` antes
   * de expor a ponte, então o primeiro render já sabe o que desenhar e não há tela piscando.
   */
  readonly screen: Screen

  /**
   * Qual combinação de cores desenhar. Valor e não promessa, pela mesma razão de `screen`: o
   * `main.tsx` põe o `data-theme` no `<html>` antes do primeiro render, e não há tela trocando de cor
   * depois de aparecer.
   */
  readonly theme: Theme

  /**
   * Começa a sessão do cartão — ou a da fatia vertical, quando `start()` vem sem cartão nenhum.
   *
   * O único parâmetro é o `itemId`: a pasta de trabalho e o modelo continuam sendo resolvidos no
   * main (`OC_CWD`, `OC_MODEL`, e o índice de repos do RF-10). Deixar o renderer escolher a `cwd`
   * seria dar a uma tela sandboxada o poder de apontar uma sessão do Claude Code para qualquer lugar
   * do disco.
   *
   * Idempotente por cartão: com sessão viva para aquele `itemId`, devolve o retrato dela em vez de
   * subir uma segunda — é o que faz colapsar e reabrir manter a conversa.
   */
  start(request?: StartRequest): Promise<StartResult>
  send(request: SendRequest): Promise<void>
  stop(request: StopRequest): Promise<void>
  respondPermission(request: RespondPermissionRequest): Promise<void>
  answerQuestion(request: AnswerQuestionRequest): Promise<void>
  close(request: CloseRequest): Promise<void>
  /** Pergunta ao humano onde o repo daquele cartão está. A escolha fica no main (CA-5). */
  chooseFolder(request: ChooseFolderRequest): Promise<ChooseFolderResult>
  onInit(listener: (event: SessionInitEvent) => void): () => void
  onMessage(listener: (event: SessionMessageEvent) => void): () => void
  onState(listener: (event: SessionStateEvent) => void): () => void
  /** O pulso do turno. Só quem mostra a conversa aberta assina — ver `IPC_EVENT.activity`. */
  onActivity(listener: (event: SessionActivityEvent) => void): () => void

  /**
   * O retrato atual dos boards. Pode voltar com `boards: null` — a descoberta é assíncrona e a
   * janela entre este pedido e o primeiro evento é a descoberta inteira, não uma leitura só.
   */
  readBoards(): Promise<BoardsSnapshot>
  /** Todo fim de descoberta ou de leitura — com sucesso ou com falha — empurra um retrato novo. */
  onBoards(listener: (snapshot: BoardsSnapshot) => void): () => void

  /**
   * Diz ao main que o humano trocou de aba. **O renderer avisa, não decide**: quem é dono do
   * `activeKey` é o main, e a aba nova volta pelo mesmo retrato de sempre — uma fonte da verdade, e
   * não duas se corrigindo.
   *
   * Resolve quando o main registrou a troca, e **não** quando ela chegou ao disco: a gravação da
   * aba lembrada é enfileirada, porque a tela não pode esperar o disco e uma gravação que falhe
   * custa uma aba lembrada, não uma tela travada.
   */
  activateBoard(request: ActivateBoardRequest): Promise<void>

  /** Lê o que está escrito naquele card: o corpo e os comentários. Não toca sessão nenhuma. */
  readCard(request: ReadCardRequest): Promise<ReadCardResult>

  /** Os cartões com conversa recuperável. Pode voltar vazio se a verificação do boot não terminou. */
  readConversations(): Promise<ConversationsSnapshot>
  /** Toda mudança do conjunto — sessão que nasce, sessão encerrada, verificação do boot. */
  onConversations(listener: (snapshot: ConversationsSnapshot) => void): () => void

  /**
   * Liga ou desliga o modo *dangerously* daquele cartão.
   *
   * **Sem retorno, e sem atualização otimista do lado da tela**: o crachá segue o retrato publicado
   * por `onDangerous`, e só ele. Com sessão viva quem manda é o que o SDK aceitou, não o que a tela
   * pediu — uma recusa deixa o conjunto como estava e a tela simplesmente não se move, que é a
   * verdade.
   */
  setDangerous(request: SetDangerousRequest): Promise<void>
  /** Os cartões marcados. Pode voltar vazio se a carga do boot ainda não terminou. */
  readDangerous(): Promise<DangerousSnapshot>
  /** Toda mudança do conjunto — a marca de um cartão, e o fim da carga do boot. */
  onDangerous(listener: (snapshot: DangerousSnapshot) => void): () => void
}

declare global {
  interface Window {
    readonly oc: OcApi
  }
}
