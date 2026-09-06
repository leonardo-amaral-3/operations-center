/**
 * A superfície pública do core.
 *
 * O core deixou de ser "o host de sessões": ele é **a lógica de produto agnóstica de casca**, e a
 * leitura do board entra aqui como segunda capacidade, ao lado do host. A mudança é deliberada — o
 * que as duas têm em comum é o mecanismo que as torna testáveis, o cliente injetado.
 *
 * O que a casca (hoje o main do Electron) precisa é: criar um host, começar uma sessão e observar
 * os três canais dela; e ler o board. O resto — fila de entrada, máquina de estados, emissor, as
 * guardas de narrowing da resposta — é interno, e mantê-lo fora daqui é o que deixa reescrevê-lo
 * sem tocar em quem consome.
 */

export { BoardReader, MAX_PAGES } from './board/BoardReader'
export { BOARD_QUERY, CARD_FIELDS, CONVERSABLE_STATIONS } from './board/query'
export type { BoardReaderDeps, ReadBoardInput } from './board/BoardReader'
export type { GraphQLFn, GraphQLResponse } from './board/types'
export type { Board, BoardCard, BoardCardField, BoardColumn } from './board/types'

export { DEFAULT_SETTING_SOURCES, SessionHost } from './session/SessionHost'
export type { QueryFn, SessionHostDeps, StartSessionInput } from './session/SessionHost'
export type { SessionHandle } from './session/SessionHandle'
export type { SessionState } from './session/state'
export type {
  ChatMessage,
  PermissionDecision,
  PermissionRequest,
  SessionInit,
} from './session/types'
