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
    once: (evento: string, cb: () => void) => void on.set(evento, [...(on.get(evento) ?? []), cb]),
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

  it('closeAll durante um open em voo: o claude que nasce depois morre, sem esquecer', async () => {
    let liberar!: (v: boolean) => void
    const gate = new Promise<boolean>((r) => (liberar = r))
    const t = montar({ danger: { isDangerous: () => gate } })

    const aberta = t.open(CARD)
    await vi.waitFor(() => expect(t.alvos).toHaveLength(1))
    t.ipc.closeAll()
    liberar(false)
    const r = await aberta

    expect(r).toMatchObject({ ok: false, reason: 'pty-unavailable' })
    expect(t.fake.ptys[0]!.killed).toBe(true)
    expect(t.unregisters[0]).toHaveBeenCalledTimes(1)
    expect(await t.invoke(IPC_INVOKE.readClaudeStates)).toEqual([])
    expect(t.conversations.forget).not.toHaveBeenCalled()
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

describe('claude:open — adoção por outro WebContents (#100)', () => {
  /** Um segundo WebContents chamando os mesmos handlers, como a janela do card faria. */
  const como = (s: ReturnType<typeof fakeSender>) => ({
    open: (scope: ClaudeScope) =>
      Promise.resolve(
        handlers.get(IPC_INVOKE.openClaude)!({ sender: s.sender }, { scope, cols: 80, rows: 24 }),
      ) as Promise<OpenClaudeResult>,
    states: () =>
      Promise.resolve(
        handlers.get(IPC_INVOKE.readClaudeStates)!({ sender: s.sender }, undefined),
      ) as Promise<ClaudeStateEvent[]>,
  })
  const dados = (s: ReturnType<typeof fakeSender>): string[] =>
    s.enviados
      .filter(([c]) => c === IPC_EVENT.terminalData)
      .map(([, p]) => (p as { data: string }).data)
  const soltos = (s: ReturnType<typeof fakeSender>): unknown[] =>
    s.enviados.filter(([c]) => c === IPC_EVENT.claudeReleased).map(([, p]) => p)

  it('B abre o escopo vivo de A: mesmo id, snapshot com a saída, e a saída seguinte só vai a B', async () => {
    const t = montar()
    const b = fakeSender()
    const a = await t.open(CARD)
    t.fake.ptys[0]!.emitData('ola do A\r\n')

    const r = await como(b).open(CARD)

    expect(r).toMatchObject({ ok: true, spawned: false, id: (a as { id: string }).id })
    expect((r as { snapshot?: { data: string } }).snapshot?.data).toContain('ola do A')
    expect(soltos(t)).toEqual([{ scope: CARD }])
    t.fake.ptys[0]!.emitData('depois')
    expect(dados(b)).toEqual(['depois'])
    expect(dados(t)).toEqual(['ola do A\r\n'])
  })

  it('reabrir pelo próprio dono não traz snapshot nem solta nada', async () => {
    const t = montar()
    await t.open(CARD)

    const r = await t.open(CARD)

    expect(r).toMatchObject({ ok: true, spawned: false })
    expect((r as { snapshot?: unknown }).snapshot).toBeUndefined()
    expect(soltos(t)).toEqual([])
  })

  it('resizeMirror vale para o id do terminal Claude e ignora os outros', async () => {
    const t = montar()
    const b = fakeSender()
    const a = (await t.open(CARD)) as { id: string }

    t.ipc.resizeMirror('nao-e-claude', 10, 5)
    t.ipc.resizeMirror(a.id, 100, 30)
    const r = await como(b).open(CARD)

    expect((r as { snapshot?: { cols: number; rows: number } }).snapshot).toMatchObject({
      cols: 100,
      rows: 30,
    })
  })

  it('B abre enquanto a abertura de A está em voo: adota depois do spawn', async () => {
    let liberar!: (v: boolean) => void
    const gate = new Promise<boolean>((r) => (liberar = r))
    const t = montar({ danger: { isDangerous: () => gate } })
    const b = fakeSender()

    const deA = t.open(CARD)
    await vi.waitFor(() => expect(t.alvos).toHaveLength(1))
    const deB = como(b).open(CARD)
    liberar(false)
    const [ra, rb] = await Promise.all([deA, deB])

    expect(ra).toMatchObject({ ok: true, spawned: true })
    expect(rb).toMatchObject({ ok: true, spawned: false })
    expect((rb as { snapshot?: unknown }).snapshot).toBeDefined()
    t.fake.ptys[0]!.emitData('x')
    expect(dados(b)).toEqual(['x'])
    expect(t.fake.calls).toHaveLength(1)
  })

  it('o PTY sai durante o await do snapshot: B resolve, sem snapshot', async () => {
    const t = montar()
    const b = fakeSender()
    await t.open(CARD)

    const pendente = como(b).open(CARD)
    t.fake.ptys[0]!.emitExit(0)
    const r = await pendente

    expect(r).toMatchObject({ ok: true, spawned: false, state: { kind: 'closed' } })
    expect((r as { snapshot?: unknown }).snapshot).toBeUndefined()
  })

  it('o PTY sai antes do ramo em voo de B responder: closed, não o starting de A', async () => {
    let liberar!: (v: boolean) => void
    const gate = new Promise<boolean>((r) => (liberar = r))
    const t = montar({ danger: { isDangerous: () => gate } })
    const b = fakeSender()

    const deA = t.open(CARD)
    // Registrado antes do `.then` de B: o PTY sai entre a resposta de A e a de B.
    void deA.then(() => t.fake.ptys[0]!.emitExit(0))
    await vi.waitFor(() => expect(t.alvos).toHaveLength(1))
    const deB = como(b).open(CARD)
    liberar(false)
    const [ra, rb] = await Promise.all([deA, deB])

    expect(ra).toMatchObject({ ok: true, spawned: true })
    expect(rb).toMatchObject({ ok: true, spawned: false, state: { kind: 'closed' } })
    expect((rb as { snapshot?: unknown }).snapshot).toBeUndefined()
  })

  describe('isOwner — o dono antigo não escreve nem redimensiona', () => {
    it('depois da adoção só o novo dono é dono; id desconhecido aceita qualquer sender', async () => {
      const t = montar()
      const b = fakeSender()
      const a = (await t.open(CARD)) as { id: string }

      expect(t.ipc.isOwner(a.id, t.sender)).toBe(true)
      expect(t.ipc.isOwner(a.id, b.sender)).toBe(false)
      await como(b).open(CARD)

      expect(t.ipc.isOwner(a.id, t.sender)).toBe(false)
      expect(t.ipc.isOwner(a.id, b.sender)).toBe(true)
      expect(t.ipc.isOwner('nao-e-claude', t.sender)).toBe(true)
    })
  })

  it('C adota durante o await de B: B responde sem snapshot', async () => {
    const t = montar()
    const b = fakeSender()
    const c = fakeSender()
    await t.open(CARD)

    const deB = como(b).open(CARD)
    const deC = como(c).open(CARD)
    const [rb, rc] = await Promise.all([deB, deC])

    expect((rb as { snapshot?: unknown }).snapshot).toBeUndefined()
    expect((rc as { snapshot?: unknown }).snapshot).toBeDefined()
  })

  it('claude:state vai a quem leu claude:states, e não só ao dono', async () => {
    const t = montar()
    const c = fakeSender()
    await t.open(CARD)
    await como(c).states()

    t.hook(0, { name: 'UserPromptSubmit', sessionId: SID, transcriptPath: 'a' })

    expect(c.estados()).toContain('working')
    expect(t.estados()).toContain('working')
  })

  describe('devolução à principal', () => {
    /** `t.sender` é a principal (A); `b` e `c` são janelas de card que adotam. */
    const comHome = () => {
      const caixa: { home: WebContents | null } = { home: null }
      const t = montar({ home: () => caixa.home })
      caixa.home = t.sender
      return t
    }

    it.each(['destroyed', 'did-navigate', 'render-process-gone'])(
      'dono B que não é a principal sai por %s: o PTY segue vivo e o dono vira A',
      async (evento) => {
        const t = comHome()
        const b = fakeSender()
        await t.open(CARD)
        await como(b).open(CARD)

        b.emitir(evento)

        expect(t.fake.ptys[0]!.killed).toBe(false)
        t.fake.ptys[0]!.emitData('depois')
        expect(dados(t)).toEqual([])
        expect(dados(b)).toEqual([])
      },
    )

    it('depois da devolução, o open de A traz o snapshot com a saída que chegou no intervalo', async () => {
      const t = comHome()
      const b = fakeSender()
      await t.open(CARD)
      await como(b).open(CARD)
      b.emitir('destroyed')
      t.fake.ptys[0]!.emitData('na ausencia\r\n')

      const r = await t.open(CARD)

      expect(r).toMatchObject({ ok: true, spawned: false })
      expect((r as { snapshot?: { data: string } }).snapshot?.data).toContain('na ausencia')
      t.fake.ptys[0]!.emitData('de novo')
      expect(dados(t)).toEqual(['de novo'])
    })

    it('a devolução publica o estado a quem leu claude:states', async () => {
      const t = comHome()
      const b = fakeSender()
      await t.open(CARD)
      await como(b).open(CARD)
      const antes = t.estados().length

      b.emitir('destroyed')

      expect(t.estados().length).toBe(antes + 1)
    })

    it('o exit do PTY chega ao dono mesmo devolvida', async () => {
      const t = comHome()
      const b = fakeSender()
      await t.open(CARD)
      await como(b).open(CARD)
      b.emitir('destroyed')

      t.fake.ptys[0]!.emitExit(0)

      expect(t.enviados.some(([c]) => c === IPC_EVENT.terminalExit)).toBe(true)
    })

    it('o dono é a própria principal destruída: o PTY morre, como hoje', async () => {
      const t = comHome()
      await t.open(CARD)

      t.emitir('destroyed')

      expect(t.fake.ptys[0]!.killed).toBe(true)
    })

    it('home devolvendo null: o dono que morre derruba o PTY', async () => {
      const t = montar({ home: () => null })
      const b = fakeSender()
      await t.open(CARD)
      await como(b).open(CARD)

      b.emitir('destroyed')

      expect(t.fake.ptys[0]!.killed).toBe(true)
    })

    it('CA-3: destruir B não mata o PTY de C nem o de A, e o card 1 passa a ser de A', async () => {
      const t = comHome()
      const b = fakeSender()
      const c = fakeSender()
      await t.open(LIVRE)
      await t.open(CARD)
      await t.open(OUTRO)
      await como(b).open(CARD)
      await como(c).open(OUTRO)

      b.emitir('destroyed')

      expect(t.fake.ptys.map((p) => p.killed)).toEqual([false, false, false])
      t.fake.ptys[1]!.emitData('card1')
      t.fake.ptys[2]!.emitData('card2')
      expect(dados(t)).toEqual([])
      expect(dados(c)).toEqual(['card2'])
      const r = await t.open(CARD)
      expect((r as { snapshot?: { data: string } }).snapshot?.data).toContain('card1')
    })
  })
})
