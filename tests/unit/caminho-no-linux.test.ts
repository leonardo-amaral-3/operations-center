/**
 * A CI roda no Linux, e lá o `basename` de `node:path` é o posix: `C:\repos\notoria` não tem `/` e
 * volta inteiro. O app roda no Windows e o caminho real é Windows, então o código é que tem de ser
 * neutro de plataforma (PR #75, CI vermelha). Este teste põe o `node:path` posix no lugar do nativo
 * e prova os três pontos — o título da sessão livre criada, o da lida do disco sem título e o do
 * terminal "aqui" — no Windows também, sem esperar o runner.
 */
import { describe, expect, it, vi } from 'vitest'

const { handlers, dialogo, lido } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => unknown>(),
  dialogo: { resposta: { canceled: false, filePaths: ['C:\\Users\\lokin\\notoria'] } },
  lido: vi.fn((): unknown => null),
}))

vi.mock('node:path', async () => {
  const real = await vi.importActual<typeof import('node:path')>('node:path')

  return { ...real.posix, default: real.posix }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown, request: unknown) => unknown): void {
      handlers.set(channel, handler)
    },
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: () => Promise.resolve(dialogo.resposta) },
}))

vi.mock('../../src/main/store', () => ({
  readState: () => Promise.resolve(lido()),
  writeState: () => Promise.resolve(),
}))

import { basename } from 'node:path'
import type { WebContents } from 'electron'

import { FreeIndex, TerminalHost } from '../../src/core'
import { loadFree, registerFreeIpc } from '../../src/main/free'
import { registerTerminalIpc } from '../../src/main/terminal'
import { IPC_INVOKE } from '../../src/shared/ipc'
import type { OpenTerminalResult } from '../../src/shared/ipc'
import { createFakeSpawner } from '../fakes/fakePty'

const sender = {
  isDestroyed: () => false,
  send: () => undefined,
  on: () => undefined,
  once: () => undefined,
} as unknown as WebContents

describe('caminho Windows com o node:path do Linux', () => {
  it('a premissa: o basename posix não separa caminho Windows', () => {
    expect(basename('C:\\repos\\notoria')).toBe('C:\\repos\\notoria')
  })

  it('free:create titula a sessão com o nome da pasta', async () => {
    handlers.clear()
    const index = new FreeIndex({
      load: () => Promise.resolve([]),
      save: () => Promise.resolve(),
      inspect: () => Promise.resolve(null),
      transcript: () => Promise.resolve([]),
    })
    registerFreeIpc(index, { closeScope: () => Promise.resolve() })

    await handlers.get(IPC_INVOKE.createFree)!({ sender }, undefined)

    expect(index.list().map((s) => s.title)).toEqual(['notoria'])
  })

  it('entrada do disco sem título ganha o nome da pasta', async () => {
    lido.mockReturnValue({ version: 1, sessions: [{ id: 'a', cwd: 'C:\\repos\\notoria' }] })

    expect((await loadFree())[0]?.title).toBe('notoria')
  })

  it('o terminal "aqui" leva o nome da pasta no título', async () => {
    handlers.clear()
    const fake = createFakeSpawner()
    registerTerminalIpc({
      presets: () => [
        { id: 'git-bash', label: 'Git Bash', group: 'shell', shell: 'bash', args: [], env: {} },
      ],
      resolveCwd: () => Promise.resolve('C:\\repos\\notoria'),
      host: new TerminalHost(() => Promise.resolve({ ok: true, spawn: fake.spawn })),
      exists: () => true,
    })

    const r = (await handlers.get(IPC_INVOKE.openTerminal)!(
      { sender },
      { preset: 'git-bash', scope: { kind: 'card', itemId: 'PVTI_x' }, cols: 80, rows: 24 },
    )) as OpenTerminalResult

    expect(r).toMatchObject({ opened: true, terminal: { title: 'Git Bash · notoria' } })
  })
})
