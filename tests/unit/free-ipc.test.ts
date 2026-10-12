/**
 * O canal `free:*` (#74 CA-2, parte do main): o seletor de pasta, o retrato que "ler também assina"
 * e o `forget` que fecha a sessão viva **antes** de remover a entrada. O `electron` é mockado como
 * em `session-ipc.test.ts`; o `FreeIndex` é o de verdade, com as pontas de IO falsas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, dialogo } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => unknown>(),
  dialogo: { resposta: { canceled: true, filePaths: [] as string[] } },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown, request: unknown) => unknown): void {
      handlers.set(channel, handler)
    },
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: () => Promise.resolve(dialogo.resposta) },
}))

import type { WebContents } from 'electron'

import { FreeIndex } from '../../src/core'
import { registerFreeIpc } from '../../src/main/free'
import { IPC_EVENT, IPC_INVOKE } from '../../src/shared/ipc'
import type { CreateFreeResult, FreeSnapshot, SessionScope } from '../../src/shared/ipc'

function montar() {
  handlers.clear()

  const index = new FreeIndex({
    load: () => Promise.resolve([]),
    save: () => Promise.resolve(),
    inspect: () => Promise.resolve(null),
    transcript: () => Promise.resolve([]),
    onChange: () => ipc.publish(),
    newId: () => 'livre-1',
  })
  const ordem: string[] = []
  const closeScope = vi.fn((scope: SessionScope): Promise<void> => {
    // Quando a alça roda a entrada ainda tem de existir: fechar depois de remover não prova nada.
    ordem.push(`fechou:${scope.kind === 'free' ? scope.id : '?'}:${index.list().length}`)

    return Promise.resolve()
  })
  const ipc = registerFreeIpc(index, { closeScope })

  const enviados: Array<[string, unknown]> = []
  const sender = {
    isDestroyed: () => false,
    send: (canal: string, carga: unknown) => void enviados.push([canal, carga]),
  } as unknown as WebContents

  const invoke = <T>(canal: string, request?: unknown): Promise<T> => {
    const handler = handlers.get(canal)
    if (!handler) throw new Error(`canal não registrado: ${canal}`)

    return Promise.resolve(handler({ sender }, request) as T)
  }

  return { index, closeScope, ordem, enviados, invoke }
}

beforeEach(() => {
  dialogo.resposta = { canceled: true, filePaths: [] }
})

describe('free:create', () => {
  it('diálogo cancelado → `created:false`, e nada nasce', async () => {
    const { invoke, index } = montar()

    expect(await invoke<CreateFreeResult>(IPC_INVOKE.createFree)).toEqual({ created: false })
    expect(index.list()).toEqual([])
  })

  it('pasta escolhida → `created:true` e a sessão nasce com o nome da pasta de título', async () => {
    dialogo.resposta = { canceled: false, filePaths: ['C:\\Users\\lokin\\notoria'] }
    const { invoke, index } = montar()

    expect(await invoke<CreateFreeResult>(IPC_INVOKE.createFree)).toEqual({
      created: true,
      id: 'livre-1',
    })
    expect(index.list()).toEqual([
      { id: 'livre-1', title: 'notoria', dangerous: false, recoverable: false },
    ])
    expect(index.cwdOf('livre-1')).toBe('C:\\Users\\lokin\\notoria')
  })
})

describe('free:read e free:changed', () => {
  it('ler também assina: a mudança seguinte chega ao assinante como retrato inteiro', async () => {
    dialogo.resposta = { canceled: false, filePaths: ['C:\\notoria'] }
    const { invoke, enviados } = montar()

    expect(await invoke<FreeSnapshot>(IPC_INVOKE.readFree)).toEqual({ sessions: [] })
    await invoke(IPC_INVOKE.createFree)

    const [canal, carga] = enviados[enviados.length - 1] ?? []
    expect(canal).toBe(IPC_EVENT.free)
    expect((carga as FreeSnapshot).sessions.map((s) => s.title)).toEqual(['notoria'])
  })

  it('`free:rename` ignora título vazio', async () => {
    dialogo.resposta = { canceled: false, filePaths: ['C:\\notoria'] }
    const { invoke, index } = montar()
    await invoke(IPC_INVOKE.createFree)

    await invoke(IPC_INVOKE.renameFree, { id: 'livre-1', title: '   ' })
    expect(index.list()[0]?.title).toBe('notoria')

    await invoke(IPC_INVOKE.renameFree, { id: 'livre-1', title: 'api' })
    expect(index.list()[0]?.title).toBe('api')
  })
})

describe('free:forget', () => {
  it('fecha a sessão viva ANTES de remover a entrada', async () => {
    dialogo.resposta = { canceled: false, filePaths: ['C:\\notoria'] }
    const { invoke, index, closeScope, ordem } = montar()
    await invoke(IPC_INVOKE.createFree)

    await invoke(IPC_INVOKE.forgetFree, { id: 'livre-1' })

    expect(closeScope).toHaveBeenCalledWith({ kind: 'free', id: 'livre-1' })
    expect(ordem).toEqual(['fechou:livre-1:1'])
    expect(index.list()).toEqual([])
  })
})
