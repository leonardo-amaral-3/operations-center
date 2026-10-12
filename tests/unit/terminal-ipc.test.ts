/**
 * O teste de DX da task 2 do #74: terminal que não abre é **resultado**, não exceção, e cada motivo
 * diz o que fazer. O `electron` é mockado como em `session-ipc.test.ts`; o PTY, pelo `fakePty`.
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
import { IPC_EVENT, IPC_INVOKE } from '../../src/shared/ipc'
import type { OpenTerminalResult, SessionScope } from '../../src/shared/ipc'
import { registerTerminalIpc } from '../../src/main/terminal'
import type { ResolvedPreset } from '../../src/main/terminalPresets'
import { createFakeSpawner } from '../fakes/fakePty'

const PRESET: ResolvedPreset = {
  id: 'git-bash',
  label: 'Git Bash',
  group: 'shell',
  shell: 'C:\\Git\\bin\\bash.exe',
  args: ['--login', '-i'],
  env: {},
}
const ESCOPO: SessionScope = { kind: 'card', itemId: 'PVTI_x' }

function fakeSender() {
  const enviados: Array<[string, unknown]> = []
  const once = new Map<string, () => void>()
  const on = new Map<string, Array<() => void>>()
  const sender = {
    isDestroyed: () => false,
    send: (canal: string, carga: unknown) => void enviados.push([canal, carga]),
    once: (evento: string, cb: () => void) => void once.set(evento, cb),
    on: (evento: string, cb: () => void) => void on.set(evento, [...(on.get(evento) ?? []), cb]),
  } as unknown as WebContents
  /** Dispara um evento `on` como o Electron: todo ouvinte, e de novo a cada vez. */
  const emitir = (evento: string): void => on.get(evento)?.forEach((cb) => cb())
  return { sender, enviados, once, emitir }
}

function montar(
  over: {
    load?: ConstructorParameters<typeof TerminalHost>[0]
    pasta?: string | null
    existe?: boolean
  } = {},
) {
  handlers.clear()
  const fake = createFakeSpawner()
  const host = new TerminalHost(
    over.load ?? (() => Promise.resolve({ ok: true, spawn: fake.spawn })),
  )
  const ipc = registerTerminalIpc({
    presets: () => [PRESET],
    resolveCwd: () => Promise.resolve(over.pasta === undefined ? 'C:\\repos\\notoria' : over.pasta),
    host,
    exists: () => over.existe ?? true,
  })
  const abrir = (sender: WebContents, req: Partial<{ preset: string; scope: SessionScope }> = {}) =>
    handlers.get(IPC_INVOKE.openTerminal)!(
      { sender },
      { preset: 'git-bash', cols: 90, rows: 25, ...req },
    ) as Promise<OpenTerminalResult>
  return { fake, ipc, abrir }
}

describe('terminal:open — erro que diz o que fazer', () => {
  it('pty-unavailable volta como resultado, com o erro do módulo no detail', async () => {
    const { abrir } = montar({
      load: () => Promise.resolve({ ok: false, detail: "Cannot find module 'node-pty'" }),
    })

    expect(await abrir(fakeSender().sender)).toEqual({
      opened: false,
      reason: 'pty-unavailable',
      detail: "Cannot find module 'node-pty'",
    })
  })

  it('shell-missing diz qual executável faltou', async () => {
    const { abrir } = montar({ existe: false })

    expect(await abrir(fakeSender().sender)).toEqual({
      opened: false,
      reason: 'shell-missing',
      detail: PRESET.shell,
    })
  })

  it('perfil desconhecido também é shell-missing, nomeando o perfil', async () => {
    const { abrir } = montar()

    expect(await abrir(fakeSender().sender, { preset: 'zsh' })).toMatchObject({
      opened: false,
      reason: 'shell-missing',
      detail: 'perfil desconhecido: zsh',
    })
  })

  it('unknown-folder aparece como resultado, não como exceção', async () => {
    const { abrir, fake } = montar({ pasta: null })

    await expect(abrir(fakeSender().sender, { scope: ESCOPO })).resolves.toMatchObject({
      opened: false,
      reason: 'unknown-folder',
    })
    expect(fake.calls).toEqual([])
  })
})

describe('terminal:open — abrindo', () => {
  it('nasce no tamanho do xterm, na pasta do escopo, com o basename no título', async () => {
    const { abrir, fake } = montar()

    const r = await abrir(fakeSender().sender, { scope: ESCOPO })

    expect(r).toMatchObject({
      opened: true,
      terminal: { preset: 'git-bash', title: 'Git Bash · notoria' },
    })
    expect(fake.calls[0]).toMatchObject({ cwd: 'C:\\repos\\notoria', cols: 90, rows: 25 })
  })

  it('sem escopo o título é o rótulo', async () => {
    const { abrir } = montar()

    expect(await abrir(fakeSender().sender)).toMatchObject({ terminal: { title: 'Git Bash' } })
  })

  it('data e exit chegam só ao sender que abriu', async () => {
    const { abrir, fake } = montar()
    const a = fakeSender()
    const b = fakeSender()
    const r = await abrir(a.sender)
    await abrir(b.sender)
    if (!r.opened) throw new Error('não abriu')

    fake.ptys[0]!.emitData('oi')
    fake.ptys[0]!.emitExit(0)

    expect(a.enviados).toEqual([
      [IPC_EVENT.terminalData, { id: r.terminal.id, data: 'oi' }],
      [IPC_EVENT.terminalExit, { id: r.terminal.id, exitCode: 0 }],
    ])
    expect(b.enviados).toEqual([])
  })

  it('renderer destruído mata os PTYs dele e só os dele', async () => {
    const { abrir, fake } = montar()
    const a = fakeSender()
    await abrir(a.sender)
    await abrir(fakeSender().sender)

    a.once.get('destroyed')!()

    expect(fake.ptys.map((p) => p.killed)).toEqual([true, false])
  })

  it('reload do renderer (o mesmo WebContents navega) mata os PTYs dele e só os dele', async () => {
    const { abrir, fake } = montar()
    const a = fakeSender()
    await abrir(a.sender)
    await abrir(fakeSender().sender)

    a.emitir('did-navigate')

    expect(fake.ptys.map((p) => p.killed)).toEqual([true, false])
  })

  it('o segundo reload e o segundo crash matam como o primeiro', async () => {
    const { abrir, fake } = montar()
    const a = fakeSender()

    await abrir(a.sender)
    a.emitir('did-navigate')
    await abrir(a.sender)
    a.emitir('did-navigate')
    await abrir(a.sender)
    a.emitir('render-process-gone')
    await abrir(a.sender)
    a.emitir('render-process-gone')

    expect(fake.ptys.map((p) => p.killed)).toEqual([true, true, true, true])
  })

  it('closeAll encerra todos os terminais', async () => {
    const { abrir, fake, ipc } = montar()
    await abrir(fakeSender().sender)

    ipc.closeAll()

    expect(fake.ptys[0]!.killed).toBe(true)
  })
})

describe('terminal:presets', () => {
  it('entrega só id, rótulo e grupo — nunca executável nem ambiente', () => {
    montar()

    expect(handlers.get(IPC_INVOKE.readTerminalPresets)!({}, undefined)).toEqual({
      presets: [{ id: 'git-bash', label: 'Git Bash', group: 'shell' }],
    })
  })
})
