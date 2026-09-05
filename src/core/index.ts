/**
 * A superfície pública do core.
 *
 * O que a casca (hoje o main do Electron) precisa é: criar um host, começar uma sessão e observar
 * os três canais dela. O resto — fila de entrada, máquina de estados, emissor — é interno, e mantê-lo
 * fora daqui é o que deixa reescrevê-lo sem tocar em quem consome.
 */

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
