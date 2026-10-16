import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

import type { BoardsSnapshot } from '../shared/board'
import type {
  ClaudeReleasedEvent,
  ClaudeStateEvent,
  CloseClaudeRequest,
  OpenClaudeRequest,
  OpenClaudeResult,
} from '../shared/claude'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type {
  ActivateBoardRequest,
  AnswerQuestionRequest,
  ChooseFolderRequest,
  ChooseFolderResult,
  CloseRequest,
  ConversationsSnapshot,
  CreateFreeResult,
  DangerousSnapshot,
  ForgetFreeRequest,
  FreeSnapshot,
  LayoutSnapshot,
  OpenTerminalRequest,
  OpenTerminalResult,
  OcApi,
  ReadCardRequest,
  ReadCardResult,
  ReadPullRequestRequest,
  ReadPullRequestResult,
  RenameFreeRequest,
  RespondPermissionRequest,
  Screen,
  SendRequest,
  SessionActivityEvent,
  SessionInitEvent,
  SessionMessageEvent,
  SessionStateEvent,
  SetDangerousRequest,
  SetThemeRequest,
  StartRequest,
  StartResult,
  StopRequest,
  TerminalCloseRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalInputRequest,
  TerminalPresetsSnapshot,
  TerminalResizeRequest,
  ThemeSnapshot,
  WindowSnapshot,
} from '../shared/ipc'
import { isTheme, THEME_DEFAULT, THEME_FLAG } from '../shared/theme'
import type { Theme } from '../shared/theme'

const SCREEN_FLAG = '--oc-screen='

/**
 * Lido de `process.argv`, preenchido por `additionalArguments` no main — e não de `process.env`,
 * que num preload sandboxado depende de um polyfill que não é contrato.
 *
 * Default `kanban`: uma flag ausente ou desconhecida abre o app, não a porta de teste.
 */
function resolveScreen(): Screen {
  const arg = process.argv.find((value) => value.startsWith(SCREEN_FLAG))

  return arg?.slice(SCREEN_FLAG.length) === 'chat' ? 'chat' : 'kanban'
}

/**
 * Lido de `process.argv` como a tela, e pela mesma razão: num preload sandboxado `process.env`
 * depende de um polyfill que não é contrato.
 *
 * Cai no default quando a flag falta ou traz nome desconhecido — aqui, ao contrário do main, isso
 * **não** é engano de quem digitou: o main já validou `OC_THEME` e lançou se fosse o caso. Uma flag
 * estranha chegando até aqui seria bug nosso, e derrubar a janela por causa dele deixaria o app sem
 * nenhuma cor em vez de com a cor errada.
 *
 * Chama-se `themeFromArgv` e **não** `resolveTheme` de propósito: já existe um `resolveTheme` no
 * main, com a política de falha oposta, e dois nomes iguais para regras contrárias é como alguém
 * "uniformiza" o errado.
 *
 * **O que ela devolve é a semente do primeiro paint, não a verdade corrente.** A flag é congelada
 * em `process.argv` quando a janela nasce; a partir da primeira troca do humano ela está
 * desatualizada, e quem manda passa a ser o retrato de `readTheme`/`onTheme`. Ver o contrato do
 * `theme` em `shared/ipc.ts` para o porquê de as duas coexistirem — e para o que quebra ao remover
 * qualquer uma delas.
 */
function themeFromArgv(): Theme {
  const arg = process.argv.find((value) => value.startsWith(THEME_FLAG))
  const valor = arg?.slice(THEME_FLAG.length)

  return isTheme(valor) ? valor : THEME_DEFAULT
}

/**
 * Assina um canal do main e devolve o cancelamento. O `IpcRendererEvent` fica aqui: o renderer
 * recebe só a carga, porque o resto do evento é detalhe do Electron e ele não deve saber que existe.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => {
    listener(payload)
  }

  ipcRenderer.on(channel, handler)

  return () => {
    ipcRenderer.off(channel, handler)
  }
}

/**
 * A ponte. É exatamente o contrato — nem um canal a mais, e nada do `ipcRenderer` cru: expor o
 * objeto do Electron daria ao renderer um canal para qualquer `handle` registrado no main, hoje e
 * no futuro, que é o buraco que `contextIsolation` existe para fechar.
 */
const api: OcApi = {
  // Resolvido aqui, antes do `exposeInMainWorld`: o primeiro render já sabe o que desenhar, e não
  // há uma tela piscando enquanto uma promessa de configuração volta.
  screen: resolveScreen(),
  theme: themeFromArgv(),
  start: (request?: StartRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.start, request) as Promise<StartResult>,
  send: (request: SendRequest) => ipcRenderer.invoke(IPC_INVOKE.send, request) as Promise<void>,
  stop: (request: StopRequest) => ipcRenderer.invoke(IPC_INVOKE.stop, request) as Promise<void>,
  respondPermission: (request: RespondPermissionRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.respondPermission, request) as Promise<void>,
  answerQuestion: (request: AnswerQuestionRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.answerQuestion, request) as Promise<void>,
  close: (request: CloseRequest) => ipcRenderer.invoke(IPC_INVOKE.close, request) as Promise<void>,
  chooseFolder: (request: ChooseFolderRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.chooseFolder, request) as Promise<ChooseFolderResult>,
  onInit: (listener) => subscribe<SessionInitEvent>(IPC_EVENT.init, listener),
  onMessage: (listener) => subscribe<SessionMessageEvent>(IPC_EVENT.message, listener),
  onState: (listener) => subscribe<SessionStateEvent>(IPC_EVENT.state, listener),
  onActivity: (listener) => subscribe<SessionActivityEvent>(IPC_EVENT.activity, listener),
  readBoards: () => ipcRenderer.invoke(IPC_INVOKE.readBoards) as Promise<BoardsSnapshot>,
  onBoards: (listener) => subscribe<BoardsSnapshot>(IPC_EVENT.boards, listener),
  activateBoard: (request: ActivateBoardRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.activateBoard, request) as Promise<void>,
  readCard: (request: ReadCardRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.readCard, request) as Promise<ReadCardResult>,
  readPullRequest: (request: ReadPullRequestRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.readPullRequest, request) as Promise<ReadPullRequestResult>,
  readConversations: () =>
    ipcRenderer.invoke(IPC_INVOKE.readConversations) as Promise<ConversationsSnapshot>,
  onConversations: (listener) =>
    subscribe<ConversationsSnapshot>(IPC_EVENT.conversations, listener),
  setDangerous: (request: SetDangerousRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.setDangerous, request) as Promise<void>,
  readDangerous: () => ipcRenderer.invoke(IPC_INVOKE.readDangerous) as Promise<DangerousSnapshot>,
  onDangerous: (listener) => subscribe<DangerousSnapshot>(IPC_EVENT.dangerous, listener),
  readTheme: () => ipcRenderer.invoke(IPC_INVOKE.readTheme) as Promise<ThemeSnapshot>,
  setTheme: (request: SetThemeRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.setTheme, request) as Promise<void>,
  onTheme: (listener) => subscribe<ThemeSnapshot>(IPC_EVENT.theme, listener),
  readWindow: () => ipcRenderer.invoke(IPC_INVOKE.readWindow) as Promise<WindowSnapshot>,
  onWindow: (listener) => subscribe<WindowSnapshot>(IPC_EVENT.window, listener),
  minimizeWindow: () => ipcRenderer.invoke(IPC_INVOKE.minimizeWindow) as Promise<void>,
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC_INVOKE.toggleMaximizeWindow) as Promise<void>,
  closeWindow: () => ipcRenderer.invoke(IPC_INVOKE.closeWindow) as Promise<void>,
  readTerminalPresets: () =>
    ipcRenderer.invoke(IPC_INVOKE.readTerminalPresets) as Promise<TerminalPresetsSnapshot>,
  openTerminal: (request: OpenTerminalRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.openTerminal, request) as Promise<OpenTerminalResult>,
  writeTerminal: (request: TerminalInputRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.writeTerminal, request) as Promise<void>,
  resizeTerminal: (request: TerminalResizeRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.resizeTerminal, request) as Promise<void>,
  closeTerminal: (request: TerminalCloseRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.closeTerminal, request) as Promise<void>,
  onTerminalData: (listener) => subscribe<TerminalDataEvent>(IPC_EVENT.terminalData, listener),
  onTerminalExit: (listener) => subscribe<TerminalExitEvent>(IPC_EVENT.terminalExit, listener),
  openClaude: (request: OpenClaudeRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.openClaude, request) as Promise<OpenClaudeResult>,
  closeClaude: (request: CloseClaudeRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.closeClaude, request) as Promise<void>,
  readClaudeStates: () =>
    ipcRenderer.invoke(IPC_INVOKE.readClaudeStates) as Promise<ClaudeStateEvent[]>,
  onClaudeState: (listener) => subscribe<ClaudeStateEvent>(IPC_EVENT.claudeState, listener),
  onClaudeReleased: (listener) =>
    subscribe<ClaudeReleasedEvent>(IPC_EVENT.claudeReleased, listener),
  readFree: () => ipcRenderer.invoke(IPC_INVOKE.readFree) as Promise<FreeSnapshot>,
  createFree: () => ipcRenderer.invoke(IPC_INVOKE.createFree) as Promise<CreateFreeResult>,
  renameFree: (request: RenameFreeRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.renameFree, request) as Promise<void>,
  forgetFree: (request: ForgetFreeRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.forgetFree, request) as Promise<void>,
  onFree: (listener) => subscribe<FreeSnapshot>(IPC_EVENT.free, listener),
  readLayout: () => ipcRenderer.invoke(IPC_INVOKE.readLayout) as Promise<LayoutSnapshot>,
  setLayout: (snapshot: LayoutSnapshot) =>
    ipcRenderer.invoke(IPC_INVOKE.setLayout, snapshot) as Promise<void>,
}

contextBridge.exposeInMainWorld('oc', api)
