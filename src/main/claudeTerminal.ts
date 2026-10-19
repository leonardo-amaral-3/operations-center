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
import { ScreenMirror } from '../core/terminal/ScreenMirror'
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
  /**
   * A janela principal, para onde o terminal volta quando o dono (outra janela) cai. `null` quando
   * não há principal viva: aí o terminal morre com o dono, como antes do #100.
   */
  home?: () => WebContents | null
  watchInterrupt?: typeof watchInterrupt
  newId?: () => string
}

export interface ClaudeTerminalIpc {
  closeAll(): void
  close(scope: ClaudeScope): Promise<void>
  /** O `terminal:resize` é do `terminal.ts`, que não conhece o espelho: o `index.ts` liga os dois. Id que não é de terminal Claude é ignorado. */
  resizeMirror(id: string, cols: number, rows: number): void
  /**
   * Quem pode escrever e redimensionar o terminal `id`: só o dono atual de um terminal Claude. Id
   * que não é de terminal Claude aceita qualquer sender (é do `terminal.ts`).
   */
  isOwner(id: string, sender: WebContents): boolean
}

interface Entry {
  scope: ClaudeScope
  id: string
  state: TerminalState
  sessionId: string
  dangerous: boolean
  unregister: () => void
  watch: TranscriptWatch | null
  /** Quem recebe a saída e o estado; muda quando outro WebContents adota o terminal (#100). */
  owner: WebContents
  /** A tela do processo, para entregar o snapshot a quem adota. */
  mirror: ScreenMirror
  /**
   * O terminal voltou à principal sem que o renderer dela tenha instância do escopo: a saída vai só
   * ao espelho, e o próximo `claude:open` dela recebe o snapshot (#100).
   */
  devolvida: boolean
}

export function registerClaudeTerminalIpc(deps: ClaudeTerminalDeps): ClaudeTerminalIpc {
  const { host, hooks } = deps
  const watchTranscript = deps.watchInterrupt ?? watchInterrupt
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const home = deps.home ?? (() => null)
  const live = new Map<string, Entry>()
  /** Guarda o sender que disparou a abertura: outro sender que chegue no meio adota depois do spawn. */
  const opening = new Map<string, { promise: Promise<OpenClaudeResult>; sender: WebContents }>()
  /** Todo WebContents que leu `readClaudeStates`: o estado é de todos, a saída é só do dono. */
  const stateSubscribers = new Set<WebContents>()
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

  /** Estado a `stateSubscribers ∪ {owner}`, limpando os destruídos (padrão do `window.ts`). */
  const publishState = (e: Entry): void => {
    for (const sub of stateSubscribers) {
      if (sub.isDestroyed()) stateSubscribers.delete(sub)
    }
    const alvos = new Set(stateSubscribers).add(e.owner)
    for (const alvo of alvos) emit(alvo, IPC_EVENT.claudeState, stateEvent(e))
  }

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
    entry.mirror.dispose()
    entry.state = { kind: 'closed' }
    publishState(entry)
    if (opts.forget) forgetScope(entry.scope)
  }

  const signal = (key: string, s: ClaudeSignal): void => {
    const entry = live.get(key)
    if (entry === undefined) return
    const { state, turnEnded } = nextTerminalState(entry.state, s)
    if (state.kind !== entry.state.kind) {
      entry.state = state
      publishState(entry)
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
      if (entry.owner !== sender) continue
      const principal = home()
      if (principal !== null && principal !== sender) {
        // A janela que segurava o terminal caiu, a principal não: ele continua vivo, agora dela.
        entry.owner = principal
        entry.devolvida = true
        watchSender(principal)
        publishState(entry)
      } else {
        teardown(key, { forget: false })
      }
    }
  }

  const watchSender = (sender: WebContents): void => {
    if (watched.has(sender)) return
    watched.add(sender)
    sender.once('destroyed', () => closeOf(sender))
    sender.on('render-process-gone', () => closeOf(sender))
    sender.on('did-navigate', () => closeOf(sender))
  }

  const openResult = (e: Entry, spawned: boolean): Extract<OpenClaudeResult, { ok: true }> => ({
    ok: true,
    id: e.id,
    state: e.state,
    dangerous: e.dangerous,
    spawned,
  })

  /** A resposta de uma adoção, montada do estado **atual**: o PTY pode ter saído durante o `await`. */
  const adotada = (
    key: string,
    entry: Entry,
    sender: WebContents,
    snapshot: Awaited<ReturnType<ScreenMirror['snapshot']>>,
  ): Extract<OpenClaudeResult, { ok: true }> => {
    if (live.get(key) !== entry) {
      return { ...openResult(entry, false), state: { kind: 'closed' } }
    }
    // Um terceiro adotou durante a espera: o snapshot já não é de quem perguntou.
    if (entry.owner !== sender) return openResult(entry, false)
    return { ...openResult(entry, false), snapshot }
  }

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
      owner: sender,
      mirror: new ScreenMirror(request.cols, request.rows),
      devolvida: false,
    }
    live.set(key, entry)
    watchSender(sender)
    host.onData(entry.id, (data) => {
      // Espelho antes de emitir, e `owner` lido a cada chunk: o `TerminalHost` não tem unsubscribe,
      // então a troca de dono é feita mudando o campo, nunca o callback.
      entry.mirror.write(data)
      // Devolvida, o renderer da principal não tem instância: o que chegasse agora seria escrito
      // duas vezes, no snapshot do próximo `open` e na fila de pendentes.
      if (!entry.devolvida) emit(entry.owner, IPC_EVENT.terminalData, { id: entry.id, data })
      // Só enquanto sobe: rodar a máquina a cada byte seria custo sem efeito.
      if (entry.state.kind === 'starting') signal(key, { name: 'output' })
    })
    host.onExit(entry.id, (exitCode) => {
      emit(entry.owner, IPC_EVENT.terminalExit, { id: entry.id, exitCode })
      teardown(key, { forget: false, hostClose: false, id: entry.id })
    })
    return openResult(entry, true)
  }

  /**
   * `claude:open` de escopo vivo. O próprio dono recebe o resultado de hoje; outro sender **adota**:
   * a troca de dono e o `snapshot()` acontecem no mesmo tick síncrono, então todo chunk anterior
   * está no snapshot e todo chunk posterior vai ao novo dono pelo `terminal:data`.
   */
  const enter = async (
    key: string,
    entry: Entry,
    sender: WebContents,
  ): Promise<OpenClaudeResult> => {
    if (entry.owner === sender) {
      if (!entry.devolvida) return openResult(entry, false)
      // O renderer da principal descartou a instância quando a outra janela adotou: precisa da tela.
      entry.devolvida = false
      return adotada(key, entry, sender, await entry.mirror.snapshot())
    }
    const anterior = entry.owner
    entry.owner = sender
    entry.devolvida = false
    watchSender(sender)
    if (!anterior.isDestroyed()) anterior.send(IPC_EVENT.claudeReleased, { scope: entry.scope })
    return adotada(key, entry, sender, await entry.mirror.snapshot())
  }

  ipcMain.handle(
    IPC_INVOKE.openClaude,
    (event, request: OpenClaudeRequest): Promise<OpenClaudeResult> => {
      const key = scopeKey(request.scope)
      const sender = event.sender
      const vivo = live.get(key)
      if (vivo !== undefined) return enter(key, vivo, sender)
      const emVoo = opening.get(key)
      if (emVoo !== undefined) {
        if (sender === emVoo.sender) return emVoo.promise
        return emVoo.promise.then((r) => {
          if (!r.ok) return r
          const nascido = live.get(key)
          if (nascido !== undefined) return enter(key, nascido, sender)
          // O PTY saiu entre o spawn de A e esta resposta: a de A ainda diz `starting`.
          return { ...r, spawned: false, state: { kind: 'closed' } as const }
        })
      }
      const promise = doOpen(key, request, sender).finally(() => opening.delete(key))
      opening.set(key, { promise, sender })
      return promise
    },
  )

  const settle = async (key: string): Promise<void> => {
    const emVoo = opening.get(key)
    if (emVoo !== undefined) await emVoo.promise.catch(() => undefined)
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

  ipcMain.handle(IPC_INVOKE.readClaudeStates, (event): ClaudeStateEvent[] => {
    stateSubscribers.add(event.sender)
    return [...live.values()].map(stateEvent)
  })

  return {
    closeAll: () => {
      encerrado = true
      for (const key of [...live.keys()]) teardown(key, { forget: false })
    },
    close,
    resizeMirror: (id, cols, rows) => {
      for (const entry of live.values()) {
        if (entry.id === id) entry.mirror.resize(cols, rows)
      }
    },
    isOwner: (id, sender) => {
      for (const entry of live.values()) {
        if (entry.id === id) return entry.owner === sender
      }
      return true
    },
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
