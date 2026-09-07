/**
 * O ponto em que a retomada se liga ao app: o `start` do main.
 *
 * O `electron` é mockado porque a única coisa que `src/main/ipc.ts` usa dele é o `ipcMain.handle` —
 * e guardar os handlers num mapa é o que permite exercitar os canais de verdade, com o `SessionHost`
 * de verdade e o `ConversationIndex` de verdade. O que fica de mentira é só o `query()` do SDK e as
 * quatro pontas de IO do índice, que já são injetados por construção.
 *
 * O caso que **não pode** faltar aqui é a partida concorrente: dois `start` para o mesmo cartão
 * seriam dois processos do Claude Code escrevendo o mesmo transcript, que é corrupção de dado do
 * usuário — o pior modo de falha desta feature, e o único que não dá para ver depois.
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

import { ConversationIndex, SessionHost } from '../../src/core'
import { oneStartPerCard, registerSessionIpc } from '../../src/main/ipc'
import { IPC_EVENT, IPC_INVOKE } from '../../src/shared/ipc'
import type { SessionSnapshot, StartResult } from '../../src/shared/ipc'
import { createFakeQuery } from '../fakes/fakeQuery'

const CARTAO = 'PVTI_cartao'

/** O `session_id` que o `fakeQuery` reporta no `init` — o vínculo que o app grava. */
const SESSAO_DO_SDK = 'fake-session'

/** O que o `resolveCwd` responderia: a pasta que o índice de repos aponta **agora**. */
const PASTA_DO_REPO = '/tmp/repo'

/** Onde a conversa de antes rodou, lida do transcript. É esta que tem de vencer. */
const PASTA_DA_CONVERSA = '/tmp/onde-a-conversa-rodou'

interface Adiada<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

/** Uma promessa cuja hora de terminar é do teste — a janela da corrida, aberta de propósito. */
function adiar<T>(): Adiada<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

/** O retrato de uma partida que subiu. Falhar aqui é o teste, não o app. */
function sessaoDe(result: StartResult): SessionSnapshot {
  if (!result.started) throw new Error(`a partida não subiu: ${result.reason}`)

  return result.session
}

interface Bancada {
  gravado?: ReadonlyMap<string, string>
  inspect?: (sessionId: string) => Promise<{ cwd: string } | null>
  resolveCwd?: (itemId: string | undefined) => Promise<string | null>
}

function montar(opcoes: Bancada = {}) {
  handlers.clear()

  const conversations = new ConversationIndex({
    load: () => Promise.resolve(opcoes.gravado ?? new Map()),
    save: () => Promise.resolve(),
    inspect: opcoes.inspect ?? (() => Promise.resolve({ cwd: PASTA_DA_CONVERSA })),
    transcript: () => Promise.resolve([]),
  })

  const fake = createFakeQuery()
  const host = new SessionHost({ query: fake.query })
  const criadas = vi.spyOn(host, 'start')
  const resolveCwd = vi.fn(opcoes.resolveCwd ?? (() => Promise.resolve(PASTA_DO_REPO)))

  const ipc = registerSessionIpc(host, { resolveCwd, conversations })

  const recebidos: string[] = []
  const esperas = new Map<string, () => void>()
  const sender = {
    isDestroyed: () => false,
    send(channel: string): void {
      recebidos.push(channel)
      esperas.get(channel)?.()
    },
  } as unknown as WebContents

  function invoke<T>(channel: string, request: unknown): Promise<T> {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`canal não registrado: ${channel}`)

    return Promise.resolve(handler({ sender }, request) as T)
  }

  return {
    conversations,
    fake,
    criadas,
    resolveCwd,
    ipc,
    start: (itemId?: string) => invoke<StartResult>(IPC_INVOKE.start, { itemId }),
    close: (sessionId: string) => invoke<void>(IPC_INVOKE.close, { sessionId }),
    /** Espera um evento atravessar a ponte. Sem timer: quem acorda o teste é o próprio canal. */
    ate: (channel: string): Promise<void> =>
      recebidos.includes(channel)
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            esperas.set(channel, () => {
              esperas.delete(channel)
              resolve()
            })
          }),
  }
}

describe('oneStartPerCard', () => {
  it('a segunda partida do mesmo cartão pega carona na primeira', async () => {
    const gate = oneStartPerCard<string>()
    const adiada = adiar<string>()
    let chamadas = 0

    const primeira = gate(CARTAO, () => {
      chamadas += 1
      return adiada.promise
    })
    const segunda = gate(CARTAO, () => {
      chamadas += 1
      return Promise.resolve('a segunda subiu sozinha')
    })

    adiada.resolve('a única')

    expect(await primeira).toBe('a única')
    expect(await segunda).toBe('a única')
    expect(chamadas).toBe(1)
  })

  it('a partida que termina libera o cartão para a próxima', async () => {
    const gate = oneStartPerCard<number>()

    expect(await gate(CARTAO, () => Promise.resolve(1))).toBe(1)
    expect(await gate(CARTAO, () => Promise.resolve(2))).toBe(2)
  })

  it('a partida que falha também libera — cartão trancado até reiniciar seria pior', async () => {
    const gate = oneStartPerCard<number>()

    await expect(gate(CARTAO, () => Promise.reject(new Error('não subiu')))).rejects.toThrow(
      'não subiu',
    )
    expect(await gate(CARTAO, () => Promise.resolve(2))).toBe(2)
  })

  it('sem cartão ninguém pega carona: a tela de chat não compartilha partida', async () => {
    const gate = oneStartPerCard<number>()
    let chamadas = 0
    const conta = (valor: number) => () => {
      chamadas += 1
      return Promise.resolve(valor)
    }

    const [um, dois] = await Promise.all([gate(undefined, conta(1)), gate(undefined, conta(2))])

    expect([um, dois]).toEqual([1, 2])
    expect(chamadas).toBe(2)
  })
})

describe('registerSessionIpc — a retomada', () => {
  it('dois `start` simultâneos para o mesmo cartão produzem uma sessão só', async () => {
    const pasta = adiar<string | null>()
    const bancada = montar({ resolveCwd: () => pasta.promise })

    // Sem `await` entre os dois: é exatamente o duplo-monte do StrictMode, e a janela é o `await`
    // do `resolveCwd` — que aqui fica aberta até o teste mandar fechar.
    const primeira = bancada.start(CARTAO)
    const segunda = bancada.start(CARTAO)
    pasta.resolve(PASTA_DO_REPO)

    const [uma, outra] = await Promise.all([primeira, segunda])

    expect(bancada.criadas).toHaveBeenCalledTimes(1)
    expect(sessaoDe(uma).id).toBe(sessaoDe(outra).id)
  })

  it('a retomada vem antes do `resolveCwd`: vale a pasta em que a conversa rodou', async () => {
    const bancada = montar({ gravado: new Map([[CARTAO, 'sessao-de-ontem']]) })

    await bancada.start(CARTAO)

    expect(bancada.resolveCwd).not.toHaveBeenCalled()
    expect(bancada.fake.options?.resume).toBe('sessao-de-ontem')
    expect(bancada.fake.options?.cwd).toBe(PASTA_DA_CONVERSA)
  })

  it('sem vínculo gravado, sobe conversa nova na pasta do repo', async () => {
    const bancada = montar()

    await bancada.start(CARTAO)

    expect(bancada.resolveCwd).toHaveBeenCalledWith(CARTAO)
    expect(bancada.fake.options?.resume).toBeUndefined()
    expect(bancada.fake.options?.cwd).toBe(PASTA_DO_REPO)
  })

  it('o `init` grava o vínculo com o id que o SDK reportou', async () => {
    const bancada = montar()

    await bancada.start(CARTAO)
    await bancada.ate(IPC_EVENT.init)

    expect(bancada.conversations.recoverable()).toEqual([CARTAO])
  })

  it('encerrar a sessão esquece o vínculo — o CA-4', async () => {
    const bancada = montar()
    const sessao = sessaoDe(await bancada.start(CARTAO))
    await bancada.ate(IPC_EVENT.init)

    await bancada.close(sessao.id)

    expect(bancada.conversations.recoverable()).toEqual([])
  })

  it('desligar o app **não** esquece: é essa a diferença que o card existe para criar', async () => {
    const bancada = montar()
    await bancada.start(CARTAO)
    await bancada.ate(IPC_EVENT.init)

    await bancada.ipc.closeAll()

    expect(bancada.conversations.recoverable()).toEqual([CARTAO])
  })

  it('o vínculo gravado sobrevive ao id do SDK ser o mesmo depois do `resume`', async () => {
    const bancada = montar({ gravado: new Map([[CARTAO, SESSAO_DO_SDK]]) })

    await bancada.start(CARTAO)
    await bancada.ate(IPC_EVENT.init)

    expect(bancada.conversations.recoverable()).toEqual([CARTAO])
  })
})
