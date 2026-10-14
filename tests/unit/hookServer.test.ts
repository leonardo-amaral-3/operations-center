import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HookEvent } from '../../src/core/terminal/claudeState'
import { createHookServer } from '../../src/main/hookServer'
import type { HookServer } from '../../src/main/hookServer'

const SESSAO = '0b1e6a2c-1f4d-4a51-9c33-2e7e5b9d4a10'

let server: HookServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

async function start(onEvent: (event: HookEvent) => void = () => undefined) {
  server = createHookServer()
  return server.register(onEvent)
}

function post(url: string, body: string): Promise<Response> {
  return fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
}

describe('hookServer', () => {
  it('POST válido: 200 com {} e entrega o evento parseado', async () => {
    const onEvent = vi.fn()
    const { url } = await start(onEvent)

    const res = await post(url, JSON.stringify({ hook_event_name: 'Stop', session_id: SESSAO }))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({})
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith({ name: 'Stop', sessionId: SESSAO })
    })
  })

  it('token desconhecido dá 404 e GET dá 405', async () => {
    const { url } = await start()
    const base = url.slice(0, url.lastIndexOf('/') + 1)

    expect((await post(`${base}00000000-0000-0000-0000-000000000000`, '{}')).status).toBe(404)
    expect((await fetch(url)).status).toBe(405)
  })

  it('JSON inválido e evento que o app não assina dão 400', async () => {
    const { url } = await start()

    expect((await post(url, '{nao-e-json')).status).toBe(400)
    expect(
      (await post(url, JSON.stringify({ hook_event_name: 'Outro', session_id: SESSAO }))).status,
    ).toBe(400)
  })

  it('corpo acima de 1 MiB dá 413', async () => {
    const onEvent = vi.fn()
    const { url } = await start(onEvent)

    const res = await post(url, 'x'.repeat(1024 * 1024 + 10))

    expect(res.status).toBe(413)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('unregister faz o token dar 404', async () => {
    const { url, unregister } = await start()
    unregister()

    expect((await post(url, '{}')).status).toBe(404)
  })

  it('dois register concorrentes sobem um listen só (mesma porta)', async () => {
    server = createHookServer()
    const [a, b] = await Promise.all([server.register(() => undefined), server.register(() => undefined)])

    expect(new URL(a.url).port).toBe(new URL(b.url).port)
    expect(a.url).not.toBe(b.url)
  })
})
