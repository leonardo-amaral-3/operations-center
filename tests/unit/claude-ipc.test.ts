/**
 * A orquestração do terminal Claude (#97, task 3): abre o `claude` num PTY por escopo e traduz os
 * hooks em estado. O `electron` é mockado como em `terminal-ipc.test.ts`; o PTY, pelo `fakePty`; o
 * servidor de hooks e o vigia de interrupção, por falsos que deixam o teste empurrar o evento.
 */
import { describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown, request: unknown) => unknown): void {
      handlers.set(channel, handler)
    },
  },
}))

import type { WebContents } from 'electron'
import { TerminalHost } from '../../src/core'
import type { HookEvent } from '../../src/core/terminal/claudeState'
import { registerClaudeTerminalIpc } from '../../src/main/claudeTerminal'
import type { ClaudeTerminalDeps } from '../../src/main/claudeTerminal'
import type { HookServer } from '../../src/main/hookServer'
import type { ClaudeScope, ClaudeStateEvent, OpenClaudeResult } from '../../src/shared/claude'
import { IPC_EVENT, IPC_INVOKE } from '../../src/shared/ipc'
import { createFakeSpawner } from '../fakes/fakePty'

const CARD: ClaudeScope = { kind: 'card', itemId: 'PVTI_a' }
const OUTRO: ClaudeScope = { kind: 'card', itemId: 'PVTI_b' }
const LIVRE: ClaudeScope = { kind: 'free', id: 'livre-1' }
const SID = 'e98072e9-1111-4222-8333-444455556666'
const SID2 = 'aaaaaaaa-1111-4222-8333-444455556666'

function fakeSender() {
  const enviados: Array<[string, unknown]> = []
  const on = new Map<string, Array<() => void>>()
  const sender = {
    isDestroyed: () => false,
    send: (canal: string, carga: unknown) => void enviados.push([canal, carga]),
    once: () => {},
    on: (evento: string, cb: () => void) => void on.set(evento, [...(on.get(evento) ?? []), cb]),
  } as unknown as WebContents
  const emitir = (evento: string): void => on.get(evento)?.forEach((cb) => cb())
  const estados = (): string[] =>
    enviados
      .filter(([c]) => c === IPC_EVENT.claudeState)
      .map(([, e]) => (e as ClaudeStateEvent).state.kind)
  return { sender, enviados, emitir, estados }
}

function montar(over: Partial<ClaudeTerminalDeps> & { dangerous?: boolean } = {}) {
  handlers.clear()
  const fake = createFakeSpawner()
  const host = new TerminalHost(() => Promise.resolve({ ok: true as const, spawn: fake.spawn }))
  const alvos: Array<(e: HookEvent) => void> = []
  const unregisters: Array<ReturnType<typeof vi.fn>> = []
  const hooks: HookServer = {
    register: (onEvent) => {
      alvos.push(onEvent)
      const unregister = vi.fn()
      unregisters.push(unregister)
      return Promise.resolve({ url: `http://127.0.0.1:1/hook/t${alvos.length}`, unregister })
    },
    close: () => Promise.resolve(),
  }
  const conversations = {
    locate: vi.fn((): Promise<{ sessionId: string; cwd: string } | null> => Promise.resolve(null)),
    remember: vi.fn(),
    forget: vi.fn(),
  }
  const free = {
    restore: vi.fn((): Promise<{ sessionId: string; cwd: string } | null> => Promise.resolve(null)),
    remember: vi.fn(),
    release: vi.fn(),
  }
  const vigias: Array<{ fire: () => void; stop: ReturnType<typeof vi.fn>; path: string }> = []
  const onTurnEnd = vi.fn()
  const ipc = registerClaudeTerminalIpc({
    host,
    hooks,
    claudeBin: () => 'C:\\claude.exe',
    model: () => undefined,
    baseEnv: () => ({ PATH: 'x' }),
    conversations,
    free,
    danger: { isDangerous: () => over.dangerous ?? false },
    resolveCwd: () => Promise.resolve('C:\\repo'),
    onTurnEnd,
    watchInterrupt: (path, cb) => {
      const stop = vi.fn()
      vigias.push({ fire: cb, stop, path })
      return { stop }
    },
    newId: () => SID,
    ...over,
  })
  const s = fakeSender()
  const invoke = <T>(canal: string, request?: unknown): Promise<T> => {
    const handler = handlers.get(canal)
    if (!handler) throw new Error(`canal não registrado: ${canal}`)
    return Promise.resolve(handler({ sender: s.sender }, request) as T)
  }
  const open = (scope: ClaudeScope) =>
    invoke<OpenClaudeResult>(IPC_INVOKE.openClaude, { scope, cols: 80, rows: 24 })
  const hook = (i: number, e: HookEvent) => alvos[i]!(e)
  return {
    fake,
    ipc,
    conversations,
    free,
    vigias,
    onTurnEnd,
    invoke,
    open,
    hook,
    alvos,
    unregisters,
    ...s,
  }
}

describe('claude:open — abertura e linha de comando', () => {
  it('card com conversa lembrada: --resume no cwd do transcript', async () => {
    const t = montar()
    t.conversations.locate.mockResolvedValue({ sessionId: SID2, cwd: 'C:\\transcript' })

    const r = await t.open(CARD)

    expect(r).toMatchObject({ ok: true, spawned: true, dangerous: false })
    expect(t.fake.calls[0]!.cwd).toBe('C:\\transcript')
    expect(t.fake.calls[0]!.args.slice(0, 2)).toEqual(['--resume', SID2])
    expect(t.fake.calls[0]!.args).not.toContain('--fork-session')
  })

  it('card sem conversa: --session-id novo no resolveCwd', async () => {
    const t = montar()

    await t.open(CARD)

    expect(t.fake.calls[0]!.cwd).toBe('C:\\repo')
    expect(t.fake.calls[0]!.args.slice(0, 2)).toEqual(['--session-id', SID])
  })

  it('sessão livre usa free.restore', async () => {
    const t = montar()
    t.free.restore.mockResolvedValue({ sessionId: SID2, cwd: 'C:\\livre' })

    await t.open(LIVRE)

    expect(t.fake.calls[0]!.args.slice(0, 2)).toEqual(['--resume', SID2])
    expect(t.conversations.locate).not.toHaveBeenCalled()
  })

  it('pasta desconhecida: unknown-folder, sem register e sem spawn', async () => {
    const t = montar({ resolveCwd: () => Promise.resolve(null) })

    expect(await t.open(CARD)).toEqual({ ok: false, reason: 'unknown-folder' })
    expect(t.alvos).toHaveLength(0)
    expect(t.fake.calls).toHaveLength(0)
  })

  it('marca de perigo: flag na linha e dangerous:true', async () => {
    const t = montar({ dangerous: true })

    const r = await t.open(CARD)

    expect(r).toMatchObject({ ok: true, dangerous: true })
    expect(t.fake.calls[0]!.args).toContain('bypassPermissions')
  })

  it('claudeBin que lança: claude-missing, sem spawn', async () => {
    const t = montar({
      claudeBin: () => {
        throw new Error('CLAUDE_AUSENTE')
      },
    })

    expect(await t.open(CARD)).toEqual({
      ok: false,
      reason: 'claude-missing',
      detail: 'CLAUDE_AUSENTE',
    })
    expect(t.fake.calls).toHaveLength(0)
  })

  it('isDangerous que rejeita: o token de hooks sai do registro, sem spawn', async () => {
    const t = montar({ danger: { isDangerous: () => Promise.reject(new Error('board fora')) } })

    await expect(t.open(CARD)).rejects.toThrow('board fora')
    expect(t.unregisters[0]).toHaveBeenCalledTimes(1)
    expect(t.fake.calls).toHaveLength(0)
  })
})

describe('claude:open — concorrência', () => {
  it('segundo open do mesmo escopo devolve o mesmo id, sem spawnar', async () => {
    const t = montar()

    const a = await t.open(CARD)
    const b = await t.open(CARD)

    expect(b).toMatchObject({ ok: true, spawned: false })
    expect((b as { id: string }).id).toBe((a as { id: string }).id)
    expect(t.fake.calls).toHaveLength(1)
  })

  it('dois open concorrentes dão um só spawn', async () => {
    const t = montar()

    const [a, b] = await Promise.all([t.open(CARD), t.open(CARD)])

    expect(a).toEqual(b)
    expect(t.fake.calls).toHaveLength(1)
  })

  it('conversa já viva noutro escopo: session-busy, sem spawn', async () => {
    const t = montar()
    t.conversations.locate.mockResolvedValue({ sessionId: SID2, cwd: 'C:\\a' })
    await t.open(CARD)

    expect(await t.open(OUTRO)).toEqual({ ok: false, reason: 'session-busy' })
    expect(t.fake.calls).toHaveLength(1)
  })

  it('claude:close durante um open em voo espera, mata e esquece', async () => {
    const t = montar()

    const aberta = t.open(CARD)
    await t.invoke(IPC_INVOKE.closeClaude, { scope: CARD })
    await aberta

    expect(t.fake.ptys[0]!.killed).toBe(true)
    expect(t.conversations.forget).toHaveBeenCalledWith('PVTI_a')
    expect(t.estados().at(-1)).toBe('closed')
  })
})

describe('estado e índice', () => {
  it('UserPromptSubmit lembra o session_id e vigia o transcript', async () => {
    const t = montar()
    await t.open(CARD)

    t.hook(0, { name: 'UserPromptSubmit', sessionId: SID2, transcriptPath: 'C:\\t.jsonl' })

    expect(t.conversations.remember).toHaveBeenCalledWith('PVTI_a', SID2)
    expect(t.vigias[0]!.path).toBe('C:\\t.jsonl')
    expect(t.estados().at(-1)).toBe('working')
  })

  it('um segundo prompt troca o vigia', async () => {
    const t = montar()
    await t.open(CARD)
    t.hook(0, { name: 'UserPromptSubmit', sessionId: SID, transcriptPath: 'a' })
    t.hook(0, { name: 'UserPromptSubmit', sessionId: SID2, transcriptPath: 'b' })

    expect(t.vigias[0]!.stop).toHaveBeenCalled()
    expect(t.vigias[1]!.path).toBe('b')
  })

  it('sessão livre lembra por free.remember', async () => {
    const t = montar()
    await t.open(LIVRE)

    t.hook(0, { name: 'UserPromptSubmit', sessionId: SID2, transcriptPath: 'a' })

    expect(t.free.remember).toHaveBeenCalledWith('livre-1', SID2)
  })

  it('PermissionRequest emite awaiting_decision; AskUserQuestion, awaiting_answer', async () => {
    const t = montar()
    await t.open(CARD)

    t.hook(0, { name: 'PermissionRequest', sessionId: SID, toolName: 'Bash' })
    expect(t.estados().at(-1)).toBe('awaiting_decision')
    t.hook(0, { name: 'PermissionRequest', sessionId: SID, toolName: 'AskUserQuestion' })
    expect(t.estados().at(-1)).toBe('awaiting_answer')
  })

  it('Stop emite awaiting_input e relê o board no card', async () => {
    const t = montar()
    await t.open(CARD)
    t.hook(0, { name: 'UserPromptSubmit', sessionId: SID, transcriptPath: 'a' })

    t.hook(0, { name: 'Stop', sessionId: SID })

    expect(t.estados().at(-1)).toBe('awaiting_input')
    expect(t.onTurnEnd).toHaveBeenCalledWith(CARD)
    expect(t.vigias[0]!.stop).toHaveBeenCalled()
  })

  it('Stop na sessão livre não relê nada', async () => {
    const t = montar()
    await t.open(LIVRE)
    t.hook(0, { name: 'UserPromptSubmit', sessionId: SID, transcriptPath: 'a' })

    t.hook(0, { name: 'Stop', sessionId: SID })

    expect(t.onTurnEnd).not.toHaveBeenCalled()
  })

  it('a interrupção do vigia emite awaiting_input e relê', async () => {
    const t = montar()
    await t.open(CARD)
    t.hook(0, { name: 'UserPromptSubmit', sessionId: SID, transcriptPath: 'a' })

    t.vigias[0]!.fire()

    expect(t.estados().at(-1)).toBe('awaiting_input')
    expect(t.onTurnEnd).toHaveBeenCalledWith(CARD)
  })

  it('o primeiro byte do PTY tira o estado de starting', async () => {
    const t = montar()
    await t.open(CARD)
    expect(t.estados()).toEqual([])

    t.fake.ptys[0]!.emitData('tela')

    expect(t.estados()).toEqual(['awaiting_input'])
  })

  it('sinal depois do fechamento é ignorado', async () => {
    const t = montar()
    await t.open(CARD)
    await t.ipc.close(CARD)
    const antes = t.enviados.length

    t.hook(0, { name: 'Stop', sessionId: SID })

    expect(t.enviados).toHaveLength(antes)
    expect(t.onTurnEnd).not.toHaveBeenCalled()
  })

  it('claude:states lista os vivos', async () => {
    const t = montar()
    await t.open(CARD)

    const estados = await t.invoke<ClaudeStateEvent[]>(IPC_INVOKE.readClaudeStates)

    expect(estados).toMatchObject([{ scope: CARD, state: { kind: 'starting' } }])
  })
})

describe('fechamento', () => {
  it('a saída do PTY emite closed sem esquecer', async () => {
    const t = montar()
    await t.open(CARD)

    t.fake.ptys[0]!.emitExit(0)

    expect(t.estados().at(-1)).toBe('closed')
    expect(t.enviados.some(([c]) => c === IPC_EVENT.terminalExit)).toBe(true)
    expect(t.conversations.forget).not.toHaveBeenCalled()
  })

  it('claude:close mata, emite closed e esquece (card)', async () => {
    const t = montar()
    await t.open(CARD)

    await t.invoke(IPC_INVOKE.closeClaude, { scope: CARD })

    expect(t.fake.ptys[0]!.killed).toBe(true)
    expect(t.estados().at(-1)).toBe('closed')
    expect(t.conversations.forget).toHaveBeenCalledWith('PVTI_a')
  })

  it('claude:close na sessão livre usa release', async () => {
    const t = montar()
    await t.open(LIVRE)

    await t.invoke(IPC_INVOKE.closeClaude, { scope: LIVRE })

    expect(t.free.release).toHaveBeenCalledWith('livre-1')
  })

  it('claude:close sem processo vivo só esquece', async () => {
    const t = montar()

    await t.invoke(IPC_INVOKE.closeClaude, { scope: CARD })

    expect(t.conversations.forget).toHaveBeenCalledWith('PVTI_a')
    expect(t.fake.ptys).toHaveLength(0)
  })

  it('closeAll mata tudo sem esquecer', async () => {
    const t = montar()
    t.conversations.locate.mockResolvedValueOnce(null)
    await t.open(CARD)
    await t.open(LIVRE)

    t.ipc.closeAll()

    expect(t.fake.ptys.every((p) => p.killed)).toBe(true)
    expect(t.conversations.forget).not.toHaveBeenCalled()
    expect(t.free.release).not.toHaveBeenCalled()
  })

  it('close(scope) mata sem esquecer e emite closed', async () => {
    const t = montar()
    await t.open(CARD)

    await t.ipc.close(CARD)

    expect(t.fake.ptys[0]!.killed).toBe(true)
    expect(t.estados().at(-1)).toBe('closed')
    expect(t.conversations.forget).not.toHaveBeenCalled()
  })

  it('did-navigate do sender fecha, e o próximo open spawna de novo', async () => {
    const t = montar()
    await t.open(CARD)

    t.emitir('did-navigate')
    const r = await t.open(CARD)

    expect(r).toMatchObject({ ok: true, spawned: true })
    expect(t.fake.calls).toHaveLength(2)
    expect(t.conversations.forget).not.toHaveBeenCalled()
  })
})
