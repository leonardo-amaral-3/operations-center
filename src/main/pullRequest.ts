import { ipcMain } from 'electron'

import type { PullRequestReader } from '../core'
import { IPC_INVOKE } from '../shared/ipc'
import type { ReadPullRequestRequest, ReadPullRequestResult } from '../shared/ipc'
import { coordenadasDe } from './card'
import type { CardIpcDeps } from './card'

/**
 * O canal de leitura do PR de um card. Mesmo corpo de `registerCardIpc`: o renderer manda cartão,
 * nunca coordenada, e quem traduz é o main com o retrato de board que ele mantém.
 *
 * Falha **não rejeita** — o motivo é texto que a tela desenha dentro do cartão.
 */
export function registerPullRequestIpc(reader: PullRequestReader, deps: CardIpcDeps): void {
  ipcMain.handle(
    IPC_INVOKE.readPullRequest,
    async (_event, request: ReadPullRequestRequest): Promise<ReadPullRequestResult> => {
      const card = deps.cardById(request.itemId)
      if (!card) return { ok: false, reason: 'este cartão não está no retrato de board do app' }

      const coordenadas = coordenadasDe(card)
      if ('reason' in coordenadas) return { ok: false, reason: coordenadas.reason }

      try {
        return {
          ok: true,
          pullRequest: await reader.read({ ...coordenadas, number: card.number }),
        }
      } catch (error: unknown) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },
  )
}
