/**
 * A orquestração do terminal Claude (#97): abre o `claude` num PTY por escopo, lê os hooks que ele
 * posta e publica o estado que o board enxerga.
 *
 * Dados, entrada, tamanho e saída do processo reusam os canais `terminal:*` (P11); aqui moram só
 * os três canais novos e o ciclo de vida. Toda mudança de estado passa por `signal`, e todo
 * fechamento por `teardown` — dois funis, para que um sinal tardio nunca ressuscite o que morreu.
 */

import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { TerminalHost } from '../core'
import { claudeArgs, claudeEnv } from '../core/terminal/claudeCommand'
import { nextTerminalState } from '../core/terminal/claudeState'
import type { ClaudeSignal, HookEvent } from '../core/terminal/claudeState'
import type {
  ClaudeScope,
  ClaudeStateEvent,
  CloseClaudeRequest,
  OpenClaudeRequest,
  OpenClaudeResult,
  TerminalState,
} from '../shared/claude'
import { IPC_EVENT, IPC_INVOKE, scopeKey } from '../shared/ipc'
import type { SessionScope } from '../shared/ipc'
import type { HookServer } from './hookServer'
import { watchInterrupt } from './transcriptWatch'
import type { TranscriptWatch } from './transcriptWatch'

type Located = { sessionId: string; cwd: string } | null

export interface ClaudeTerminalDeps {
  host: TerminalHost
  hooks: HookServer
  /** Lança com `CLAUDE_AUSENTE` quando não há binário. */
  claudeBin: () => string
  model: () => string | undefined
  baseEnv: () => Record<string, string>
  conversations: {
    locate(itemId: string): Promise<Located>
    remember(itemId: string, sessionId: string): void
    forget(itemId: string): void
  }
  free: {
    restore(id: string): Promise<Located>
    remember(id: string, sessionId: string): void
    release(id: string): void
  }
  danger: { isDangerous(scope: ClaudeScope): Promise<boolean> | boolean }
  resolveCwd: (scope: ClaudeScope) => Promise<string | null>
  onTurnEnd: (scope: ClaudeScope) => void
  watchInterrupt?: typeof watchInterrupt
  newId?: () => string
}

export interface ClaudeTerminalIpc {
  closeAll(): void
  close(scope: ClaudeScope): Promise<void>
}

interface Entry {
  scope: ClaudeScope
  id: string
  state: TerminalState
  sessionId: string
  dangerous: boolean
  unregister: () => void
  watch: TranscriptWatch | null
  sender: WebContents
}

export function registerClaudeTerminalIpc(deps: ClaudeTerminalDeps): ClaudeTerminalIpc {
  const { host, hooks } = deps
  const watchTranscript = deps.watchInterrupt ?? watchInterrupt
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const live = new Map<string, Entry>()
  const opening = new Map<string, Promise<OpenClaudeResult>>()
  const watched = new WeakSet<WebContents>()
  /** Ligado pelo `closeAll`, que só roda no fechamento do app: abertura que chegar depois morre. */
  let encerrado = false

  const emit = (sender: WebContents, channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }

  const stateEvent = (e: Entry): ClaudeStateEvent => ({
    scope: e.scope,
    id: e.id,
    state: e.state,
    dangerous: e.dangerous,
  })

  const forgetScope = (scope: ClaudeScope): void => {
    if (scope.kind === 'card') deps.conversations.forget(scope.itemId)
    else deps.free.release(scope.id)
  }

  const rememberScope = (scope: ClaudeScope, sessionId: string): void => {
    if (scope.kind === 'card') deps.conversations.remember(scope.itemId, sessionId)
    else deps.free.remember(scope.id, sessionId)
  }

  /** A única rotina de fechamento. `hostClose:false` é a saída do próprio PTY, que já morreu. */
  const teardown = (
    key: string,
    opts: { forget: boolean; hostClose?: boolean; id?: string },
  ): void => {
    const entry = live.get(key)
    if (entry === undefined || (opts.id !== undefined && entry.id !== opts.id)) return
    live.delete(key)
    if (opts.hostClose !== false) host.close(entry.id)
    entry.unregister()
    entry.watch?.stop()
    entry.state = { kind: 'closed' }
    emit(entry.sender, IPC_EVENT.claudeState, stateEvent(entry))
    if (opts.forget) forgetScope(entry.scope)
  }

  const signal = (key: string, s: ClaudeSignal): void => {
    const entry = live.get(key)
    if (entry === undefined) return
    const { state, turnEnded } = nextTerminalState(entry.state, s)
    if (state.kind !== entry.state.kind) {
      entry.state = state
      emit(entry.sender, IPC_EVENT.claudeState, stateEvent(entry))
    }
    if (turnEnded && entry.scope.kind === 'card') deps.onTurnEnd(entry.scope)

    if (s.name === 'UserPromptSubmit') {
      entry.sessionId = s.sessionId
      rememberScope(entry.scope, s.sessionId)
      entry.watch?.stop()
      entry.watch = watchTranscript(s.transcriptPath, () => signal(key, { name: 'interrupted' }))
    } else if (s.name === 'Stop' || s.name === 'interrupted') {
      entry.watch?.stop()
      entry.watch = null
    }
  }

  const closeOf = (sender: WebContents): void => {
    for (const [key, entry] of [...live]) {
      if (entry.sender === sender) teardown(key, { forget: false })
    }
  }

  const watchSender = (sender: WebContents): void => {
    if (watched.has(sender)) return
    watched.add(sender)
    sender.once('destroyed', () => closeOf(sender))
    sender.on('render-process-gone', () => closeOf(sender))
    sender.on('did-navigate', () => closeOf(sender))
  }

  const openResult = (e: Entry, spawned: boolean): OpenClaudeResult => ({
    ok: true,
    id: e.id,
    state: e.state,
    dangerous: e.dangerous,
    spawned,
  })

  const doOpen = async (
    key: string,
    request: OpenClaudeRequest,
    sender: WebContents,
  ): Promise<OpenClaudeResult> => {
    const { scope } = request
    const found =
      scope.kind === 'card'
        ? await deps.conversations.locate(scope.itemId)
        : await deps.free.restore(scope.id)

    let start: { kind: 'resume' | 'new'; sessionId: string }
    let cwd: string
    if (found !== null) {
      for (const [other, entry] of live) {
        if (other !== key && entry.sessionId === found.sessionId) {
          return { ok: false, reason: 'session-busy' }
        }
      }
      start = { kind: 'resume', sessionId: found.sessionId }
      cwd = found.cwd
    } else {
      const pasta = await deps.resolveCwd(scope)
      if (pasta === null) return { ok: false, reason: 'unknown-folder' }
      start = { kind: 'new', sessionId: newId() }
      cwd = pasta
    }

    let bin: string
    try {
      bin = deps.claudeBin()
    } catch (erro) {
      return {
        ok: false,
        reason: 'claude-missing',
        detail: erro instanceof Error ? erro.message : String(erro),
      }
    }

    const { url, unregister } = await hooks.register((ev: HookEvent) => signal(key, ev))
    let dangerous: boolean
    let aberto: Awaited<ReturnType<TerminalHost['open']>>
    try {
      dangerous = await deps.danger.isDangerous(scope)
      aberto = await host.open({
        shell: bin,
        args: claudeArgs({ start, dangerous, hookUrl: url, model: deps.model() }),
        env: claudeEnv(deps.baseEnv()),
        cwd,
        cols: request.cols,
        rows: request.rows,
      })
    } catch (erro) {
      // Sem isto o token seguiria aceito pelo servidor de hooks até o app fechar.
      unregister()
      throw erro
    }
    if (!aberto.ok) {
      unregister()
      return { ok: false, reason: 'pty-unavailable', detail: aberto.detail }
    }
    if (encerrado) {
      // O `closeAll` passou enquanto esta abertura esperava: ninguém mais fecharia este `claude`.
      host.close(aberto.id)
      unregister()
      return { ok: false, reason: 'pty-unavailable', detail: 'o app está fechando' }
    }

    const entry: Entry = {
      scope,
      id: aberto.id,
      state: { kind: 'starting' },
      sessionId: start.sessionId,
      dangerous,
      unregister,
      watch: null,
      sender,
    }
    live.set(key, entry)
    watchSender(sender)
    host.onData(entry.id, (data) => {
      emit(sender, IPC_EVENT.terminalData, { id: entry.id, data })
      // Só enquanto sobe: rodar a máquina a cada byte seria custo sem efeito.
      if (entry.state.kind === 'starting') signal(key, { name: 'output' })
    })
    host.onExit(entry.id, (exitCode) => {
      emit(sender, IPC_EVENT.terminalExit, { id: entry.id, exitCode })
      teardown(key, { forget: false, hostClose: false, id: entry.id })
    })
    return openResult(entry, true)
  }

  ipcMain.handle(
    IPC_INVOKE.openClaude,
    (event, request: OpenClaudeRequest): Promise<OpenClaudeResult> => {
      const key = scopeKey(request.scope)
      const vivo = live.get(key)
      if (vivo !== undefined) return Promise.resolve(openResult(vivo, false))
      const emVoo = opening.get(key)
      if (emVoo !== undefined) return emVoo
      const promessa = doOpen(key, request, event.sender).finally(() => opening.delete(key))
      opening.set(key, promessa)
      return promessa
    },
  )

  const settle = async (key: string): Promise<void> => {
    const emVoo = opening.get(key)
    if (emVoo !== undefined) await emVoo.catch(() => undefined)
  }

  const close = async (scope: ClaudeScope): Promise<void> => {
    const key = scopeKey(scope)
    await settle(key)
    teardown(key, { forget: false })
  }

  ipcMain.handle(IPC_INVOKE.closeClaude, async (_e, r: CloseClaudeRequest): Promise<void> => {
    const key = scopeKey(r.scope)
    await settle(key)
    if (live.has(key)) teardown(key, { forget: true })
    else forgetScope(r.scope)
  })

  ipcMain.handle(IPC_INVOKE.readClaudeStates, (): ClaudeStateEvent[] =>
    [...live.values()].map(stateEvent),
  )

  return {
    closeAll: () => {
      encerrado = true
      for (const key of [...live.keys()]) teardown(key, { forget: false })
    },
    close,
  }
}

/** O `closeScope` do `free:forget`: o terminal Claude fecha antes da sessão do SDK. */
export function composeCloseScope(
  claude: { close(scope: ClaudeScope): Promise<void> },
  sdk: (scope: SessionScope) => Promise<void>,
): (scope: SessionScope) => Promise<void> {
  return async (scope) => {
    if (scope.kind !== 'triage') await claude.close(scope)
    await sdk(scope)
  }
}
