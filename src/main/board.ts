import { ipcMain } from 'electron'
import type { WebContents } from 'electron'

import type { BoardReader } from '../core'
import type { BoardSnapshot } from '../shared/board'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'

export interface BoardIpcOptions {
  /** Dono e número do Project. Vêm de `OC_PROJECT_OWNER`/`OC_PROJECT_NUMBER`, lidos no main. */
  owner: string
  number: number
}

export interface BoardIpc {
  /**
   * Pede uma releitura. É no-op se já houver leitura em voo ou se a última terminou há menos de
   * `BOARD_REREAD_THROTTLE_MS`.
   */
  refresh(): void
}

/**
 * Intervalo mínimo entre leituras. Não existe para proteger o rate limit — 5000 pontos/hora contra
 * alguns alt-tabs é irrelevante —, e sim para não repetir trabalho à toa.
 */
export const BOARD_REREAD_THROTTLE_MS = 10_000

/**
 * O observador do board: liga os dois canais de leitura ao `core` e mantém o retrato que a tela vê.
 *
 * Espelha `registerSessionIpc` — guarda o estado que só ele cria e devolve ao main a única alça de
 * que o ciclo de vida precisa. Aqui essa alça é `refresh()`, porque os gatilhos (foco da janela,
 * retorno de suspensão e, um dia, a skill terminando um turno) são eventos do Electron, e quem os
 * assina é o dono da janela.
 */
export function registerBoardIpc(reader: BoardReader, options: BoardIpcOptions): BoardIpc {
  const subscribers = new Set<WebContents>()
  let snapshot: BoardSnapshot = { board: null, readAt: null, error: null }
  let reading = false
  let lastReadAt = 0

  function publish(next: BoardSnapshot): void {
    snapshot = next

    for (const sender of subscribers) {
      // Destruído é **removido**, não apenas pulado como o `forwardEvents` de sessão faz: lá a
      // sessão morre junto com a janela, aqui o observador vive o app inteiro e o conjunto cresceria
      // a cada janela nova.
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        continue
      }

      sender.send(IPC_EVENT.board, next)
    }
  }

  function refresh(): void {
    // Gatilho que chega com leitura em voo é **descartado, não enfileirado**: a leitura em voo
    // começou há no máximo o throttle e vai publicar dado fresco de qualquer forma. O preço — uma
    // mudança que aconteça exatamente nessa janela só aparece no próximo gatilho — está aceito na
    // spec, e enfileirar traria coalescência e deduplicação para cobrir poucos segundos.
    if (reading) return
    if (lastReadAt !== 0 && Date.now() - lastReadAt < BOARD_REREAD_THROTTLE_MS) return

    reading = true

    void reader
      .read({ owner: options.owner, number: options.number })
      .then((board) => {
        publish({ board, readAt: Date.now(), error: null })
      })
      .catch((error: unknown) => {
        // O board antigo sobrevive à falha: trocar informação levemente velha por informação nenhuma
        // a cada oscilação de rede seria regressão de produto. Quem impede o dado velho de mentir é
        // o carimbo de frescor, que passa a acusar a idade.
        publish({ board: snapshot.board, readAt: snapshot.readAt, error: motivo(error) })
      })
      .finally(() => {
        reading = false
        lastReadAt = Date.now()
      })
  }

  ipcMain.handle(IPC_INVOKE.readBoard, (event): BoardSnapshot => {
    subscribers.add(event.sender)

    // Sem leitura nenhuma ainda, a tela pediria e ficaria olhando para o vazio. Na prática o main já
    // disparou a primeira no `whenReady`, e então este `refresh` é no-op pela guarda de concorrência
    // — o caminho só corre de verdade quando aquela leitura falhou antes de o renderer aparecer.
    if (lastReadAt === 0) refresh()

    return snapshot
  })

  return { refresh }
}

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
