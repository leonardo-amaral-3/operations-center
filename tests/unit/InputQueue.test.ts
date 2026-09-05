import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { InputQueue } from '../../src/core/session/InputQueue'

/**
 * Devolve o controle ao event loop, para que o gerador chegue de fato à Promise onde estaciona.
 * Sem isso, "empurrar durante a espera" viraria "empurrar antes da espera" e o teste passaria
 * pelo caminho errado.
 */
function tick(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('InputQueue', () => {
  it('monta a mensagem no formato de entrada do SDK', async () => {
    const queue = new InputQueue()
    queue.push('olá')
    queue.close()

    const iterator = queue[Symbol.asyncIterator]()
    const first = await iterator.next()

    expect(first.done).toBe(false)
    expect(first.value).toEqual({
      type: 'user',
      message: { role: 'user', content: 'olá' },
      parent_tool_use_id: null,
    })
  })

  it('entrega, na ordem, o que foi empurrado antes de alguém consumir', async () => {
    const queue = new InputQueue()
    queue.push('primeira')
    queue.push('segunda')

    const iterator = queue[Symbol.asyncIterator]()

    expect((await iterator.next()).value).toMatchObject({ message: { content: 'primeira' } })
    expect((await iterator.next()).value).toMatchObject({ message: { content: 'segunda' } })
  })

  it('entrega ao consumidor que já estava esperando', async () => {
    const queue = new InputQueue()
    const iterator = queue[Symbol.asyncIterator]()

    const waiting = iterator.next()
    await tick()
    queue.push('chegou depois')

    expect((await waiting).value).toMatchObject({ message: { content: 'chegou depois' } })
  })

  it('continua entregando depois de esvaziar e voltar a esperar', async () => {
    const queue = new InputQueue()
    const iterator = queue[Symbol.asyncIterator]()

    queue.push('primeira')
    expect((await iterator.next()).value).toMatchObject({ message: { content: 'primeira' } })

    const waiting = iterator.next()
    await tick()
    queue.push('segunda')

    expect((await waiting).value).toMatchObject({ message: { content: 'segunda' } })
  })

  it('close libera o consumidor que estava esperando', async () => {
    const queue = new InputQueue()
    const iterator = queue[Symbol.asyncIterator]()

    const waiting = iterator.next()
    await tick()
    queue.close()

    expect(await waiting).toEqual({ done: true, value: undefined })
  })

  it('close drena o que estava pendente antes de terminar', async () => {
    const queue = new InputQueue()
    queue.push('primeira')
    queue.push('segunda')
    queue.close()

    const recebidas: SDKUserMessage[] = []
    for await (const message of queue) recebidas.push(message)

    expect(recebidas).toMatchObject([
      { message: { content: 'primeira' } },
      { message: { content: 'segunda' } },
    ])
  })

  it('ignora push depois de close', async () => {
    const queue = new InputQueue()
    queue.push('antes')
    queue.close()
    queue.push('depois')

    const recebidas: SDKUserMessage[] = []
    for await (const message of queue) recebidas.push(message)

    expect(recebidas).toMatchObject([{ message: { content: 'antes' } }])
  })
})
