/**
 * O servidor local que recebe os hooks HTTP da CLI (#97). Um por app, em 127.0.0.1 numa porta
 * efêmera; cada terminal Claude registra um destino e ganha uma URL com token próprio.
 */

import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { parseHookBody } from '../core/terminal/claudeState'
import type { HookEvent } from '../core/terminal/claudeState'

export interface HookServer {
  /** Registra um destino e devolve a URL que vai no --settings. Sobe o servidor na primeira chamada. */
  register(onEvent: (event: HookEvent) => void): Promise<{ url: string; unregister: () => void }>
  close(): Promise<void>
}

const MAX_BODY = 1024 * 1024
const ROUTE = /^\/hook\/([0-9a-f-]+)$/i

function reply(res: ServerResponse, status: number, body = '', extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...extra })
  res.end(body)
}

export function createHookServer(): HookServer {
  const targets = new Map<string, (event: HookEvent) => void>()
  let listening: Promise<{ server: Server; port: number }> | null = null

  function handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') {
      req.resume()
      reply(res, 405)
      return
    }
    const token = ROUTE.exec((req.url ?? '').split('?')[0] ?? '')?.[1]
    const onEvent = token === undefined ? undefined : targets.get(token)
    if (onEvent === undefined) {
      req.resume()
      reply(res, 404)
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    let rejected = false
    req.on('data', (chunk: Buffer) => {
      if (rejected) return
      size += chunk.length
      if (size > MAX_BODY) {
        rejected = true
        chunks.length = 0
        // Responde primeiro; o resto do corpo é descartado sem `destroy` antes da resposta.
        reply(res, 413, '', { connection: 'close' })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (rejected) return
      let event: HookEvent | null
      try {
        event = parseHookBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        event = null
      }
      if (event === null) {
        reply(res, 400)
        return
      }
      // `{}` não decide nada no PermissionRequest: o diálogo da CLI continua aparecendo (P3).
      reply(res, 200, '{}')
      const accepted = event
      setImmediate(() => {
        onEvent(accepted)
      })
    })
  }

  function listen(): Promise<{ server: Server; port: number }> {
    listening ??= new Promise((resolve, reject) => {
      const server = createServer(handle)
      server.once('error', (error) => {
        listening = null
        reject(error)
      })
      server.listen(0, '127.0.0.1', () => {
        resolve({ server, port: (server.address() as AddressInfo).port })
      })
    })
    return listening
  }

  return {
    async register(onEvent) {
      const { port } = await listen()
      const token = randomUUID()
      targets.set(token, onEvent)
      return {
        url: `http://127.0.0.1:${port}/hook/${token}`,
        unregister: () => {
          targets.delete(token)
        },
      }
    },
    async close() {
      const current = listening
      listening = null
      targets.clear()
      if (current === null) return
      const { server } = await current
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      })
    },
  }
}
