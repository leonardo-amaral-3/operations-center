import { ipcMain } from 'electron'

import type { CardReader } from '../core'
import type { BoardCard } from '../shared/board'
import { IPC_INVOKE } from '../shared/ipc'
import type { ReadCardRequest, ReadCardResult } from '../shared/ipc'

export interface CardIpcDeps {
  /** O cartão daquele item no retrato corrente do board — é o `BoardIpc.cardById`. */
  cardById: (itemId: string) => BoardCard | null
}

/**
 * O canal de leitura do conteúdo de um card.
 *
 * Arquivo próprio, e não dentro de `registerBoardsIpc`: aquele registro existe para guardar o
 * retrato do board e o ciclo de vida das releituras; este não guarda nada — é pergunta e resposta,
 * uma leitura por abertura de cartão. O nome e a forma espelham `registerSessionIpc`/
 * `registerBoardsIpc`.
 *
 * Não devolve alça nenhuma: sem estado, não há ciclo de vida para o main operar de fora.
 */
export function registerCardIpc(reader: CardReader, deps: CardIpcDeps): void {
  ipcMain.handle(
    IPC_INVOKE.readCard,
    async (_event, request: ReadCardRequest): Promise<ReadCardResult> => {
      // O renderer manda cartão, nunca coordenada: quem traduz `itemId` em `owner/name/number` é o
      // main, com o retrato de board que ele mesmo mantém.
      const card = deps.cardById(request.itemId)
      if (!card) return { ok: false, reason: 'este cartão não está no retrato de board do app' }

      // `owner/name`, como o board o entrega. Formato inesperado vira recusa, e não um pedido torto
      // à API.
      const partes = card.repository.split('/')
      const [owner, name] = partes
      if (partes.length !== 2 || !owner || !name) {
        return { ok: false, reason: `repo em formato inesperado: ${card.repository}` }
      }

      try {
        return { ok: true, content: await reader.read({ owner, name, number: card.number }) }
      } catch (error: unknown) {
        // Falha **não rejeita**: o motivo é texto que a tela desenha dentro do cartão, e rejeitar
        // obrigaria o renderer a farejar mensagem de erro para distinguir um caso do outro.
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },
  )
}
