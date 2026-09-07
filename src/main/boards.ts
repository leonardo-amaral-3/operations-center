import { ipcMain } from 'electron'
import type { WebContents } from 'electron'

import { pickActive } from '../core'
import type { BoardFinder, BoardReader, Discovery, ReadBoardInput } from '../core'
import type { BoardCard, BoardTab, BoardsSnapshot } from '../shared/board'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'

export interface BoardsIpcDeps {
  finder: BoardFinder
  reader: BoardReader
  /**
   * A aba lembrada, injetada como as quatro pontas de IO do `ConversationIndex` e pela mesma razão:
   * quem lê e escreve disco é o main, e a peça que decide fica testável sem ele.
   *
   * **Inertes na Fase 0** — `loadActive` responde `null` e `saveActive` não faz nada. A costura fica
   * pronta, e é a Fase 1 que liga o `preferences.json` nela.
   */
  loadActive: () => Promise<string | null>
  saveActive: (key: string) => Promise<void>
}

export interface BoardsIpc {
  /** Descobre — se ainda não descobriu — e relê o que estiver vencido. */
  refresh(): void
  /**
   * O cartão daquele item, procurado em **todas** as abas.
   *
   * É a peça que fecha `itemId → repo`: o renderer manda o cartão e o main descobre em que pasta a
   * sessão dele roda, sem que nenhum caminho de disco atravesse a ponte. Lê o retrato que este
   * registro já mantém — não relê board nenhum, porque um clique não pode depender da rede.
   */
  cardById(itemId: string): BoardCard | null
}

/**
 * Intervalo mínimo entre leituras **de uma mesma aba**. Não existe para proteger o rate limit — 5000
 * pontos/hora contra alguns alt-tabs é irrelevante —, e sim para não repetir trabalho à toa.
 */
export const BOARD_REREAD_THROTTLE_MS = 10_000

/**
 * O observador dos boards: liga a descoberta e as leituras ao `core` e mantém o retrato que a tela vê.
 *
 * Espelha `registerSessionIpc` — guarda o estado que só ele cria e devolve ao main a única alça de
 * que o ciclo de vida precisa. Aqui essa alça é `refresh()`, porque os gatilhos (foco da janela e
 * retorno de suspensão) são eventos do Electron, e quem os assina é o dono da janela.
 *
 * A descoberta roda **uma vez por execução**, e é o que impede a barra de abas de mudar debaixo do
 * usuário. A única exceção é o retry: enquanto ela nunca tiver terminado, cada gatilho tenta de novo.
 */
export function registerBoardsIpc(deps: BoardsIpcDeps): BoardsIpc {
  const subscribers = new Set<WebContents>()

  /** `null` = a descoberta ainda não terminou. É o discriminante que a tela lê. */
  let tabs: readonly BoardTab[] | null = null
  let activeKey: string | null = null
  let discoveryError: string | null = null
  let discovering = false

  /**
   * A coordenada de cada aba, guardada da descoberta em vez de recomposta a partir da `key`.
   *
   * A `key` é `owner/number` e seria fácil parti-la de volta; guardar o que a descoberta já disse
   * evita que a ponte e o leitor passem a depender do formato dela — que existe para o renderer ter
   * uma chave opaca, e não para ser um par serializado.
   */
  const coordinates = new Map<string, ReadBoardInput>()

  /** As duas guardas de hoje, agora **por aba**. */
  const reading = new Set<string>()
  const lastReadAt = new Map<string, number>()

  function snapshot(): BoardsSnapshot {
    return { boards: tabs, activeKey, discoveryError }
  }

  function publish(): void {
    const next = snapshot()

    for (const sender of subscribers) {
      // Destruído é **removido**, não apenas pulado como o `forwardEvents` de sessão faz: lá a
      // sessão morre junto com a janela, aqui o observador vive o app inteiro e o conjunto cresceria
      // a cada janela nova.
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        continue
      }

      sender.send(IPC_EVENT.boards, next)
    }
  }

  function refresh(): void {
    // Terminada a descoberta — **inclusive parcialmente** —, o que sobra a fazer é reler as abas
    // vencidas. Ela não roda mais nesta execução: um retry que trouxesse um dono a mais faria a
    // barra de abas crescer debaixo do usuário, que é justamente o que descobrir uma vez só existe
    // para impedir. O preço de um dono que caiu fica escrito no cabeçalho, não numa aba que aparece
    // sozinha dez minutos depois.
    if (tabs !== null) {
      readStale()

      return
    }

    // Aqui mora o retry: enquanto a descoberta nunca tiver **terminado**, cada gatilho — foco,
    // `resume` do `powerMonitor`, o `readBoards` do renderer — tenta de novo.
    if (discovering) return

    discovering = true
    void discover()
  }

  async function discover(): Promise<void> {
    try {
      const discovery = await deps.finder.find()
      const remembered = await deps.loadActive()

      // Os três juntos, e só depois dos dois `await`: uma falha em qualquer um dos dois deixa o
      // estado inteiro como estava, e `tabs === null` é o que faz o próximo gatilho tentar de novo.
      discoveryError = motivoDosDonos(discovery.failed)
      activeKey = pickActive(discovery.boards, remembered)
      tabs = discovery.boards.map((board) => {
        coordinates.set(board.key, { owner: board.owner, number: board.number })

        // `title` da descoberta e `board: null`: é o que faz a aba ter nome antes da primeira
        // leitura dela, em vez de uma aba anônima piscando até a rede responder.
        return { key: board.key, title: board.title, board: null, readAt: null, error: null }
      })
    } catch (error) {
      // Não houve descoberta nenhuma: `tabs` continua `null` e o motivo vai para a tela, que é o
      // par exato de "erro sem nada a preservar".
      discoveryError = motivo(error)
    } finally {
      discovering = false
      publish()
    }

    if (tabs !== null) readStale()
  }

  function readStale(): void {
    for (const tab of tabs ?? []) read(tab.key)
  }

  function read(key: string): void {
    // Gatilho que chega com leitura em voo é **descartado, não enfileirado**: a leitura em voo
    // começou há no máximo o throttle e vai publicar dado fresco de qualquer forma. As duas guardas
    // são por aba porque uma leitura presa numa aba não pode impedir a releitura da outra — trocar
    // de aba passaria a depender da rede da aba anterior.
    if (reading.has(key)) return

    const last = lastReadAt.get(key) ?? 0
    if (last !== 0 && Date.now() - last < BOARD_REREAD_THROTTLE_MS) return

    const coordinate = coordinates.get(key)
    if (coordinate === undefined) return

    reading.add(key)

    void deps.reader
      .read(coordinate)
      .then((board) => {
        // `title` também: o do board é mais fresco que o que a descoberta trouxe, e é ele que passa
        // a nomear a aba a partir daqui.
        update(key, (tab) => ({ ...tab, title: board.title, board, readAt: Date.now(), error: null }))
      })
      .catch((error: unknown) => {
        // O board antigo **daquela aba** sobrevive à falha dela: trocar informação levemente velha
        // por informação nenhuma a cada oscilação de rede seria regressão de produto. Quem impede o
        // dado velho de mentir é o carimbo de frescor, que passa a acusar a idade.
        update(key, (tab) => ({ ...tab, error: motivo(error) }))
      })
      .finally(() => {
        reading.delete(key)
        lastReadAt.set(key, Date.now())
        // Cada leitura publica sozinha ao terminar — a aba que respondeu primeiro aparece primeiro,
        // em vez de todas esperarem a mais lenta.
        publish()
      })
  }

  /**
   * Troca uma aba pela `key`, e não pelo índice: o retrato pode ter mudado enquanto a leitura
   * voltava, e casar por posição é o que faria uma resposta atrasada escrever na aba errada.
   */
  function update(key: string, change: (tab: BoardTab) => BoardTab): void {
    tabs = tabs?.map((tab) => (tab.key === key ? change(tab) : tab)) ?? null
  }

  ipcMain.handle(IPC_INVOKE.readBoards, (event): BoardsSnapshot => {
    subscribers.add(event.sender)

    // Sem descoberta nenhuma ainda, a tela pediria e ficaria olhando para o vazio. Na prática o main
    // já disparou a primeira no `whenReady`, e então este `refresh` é no-op pela guarda de
    // `discovering` — o caminho só corre de verdade quando aquela descoberta falhou antes de o
    // renderer aparecer.
    if (tabs === null) refresh()

    return snapshot()
  })

  return {
    refresh,
    cardById(itemId: string): BoardCard | null {
      // **Todas** as abas, e não só a ativa: `itemId` é único no GitHub inteiro, e um cartão cuja
      // aba deixou de ser a ativa entre o clique e a resposta continua sendo o mesmo cartão.
      for (const tab of tabs ?? []) {
        const card = tab.board?.cards.find((candidate) => candidate.itemId === itemId)
        if (card) return card
      }

      return null
    },
  }
}

/**
 * Os donos que não deram para varrer, como uma frase só — ou `null` quando todos responderam.
 *
 * Vai para o cabeçalho, ao lado do carimbo de frescor: um dono que caiu não apaga os boards dos que
 * responderam, e também não pode falhar em silêncio. O nome do dono entra porque é ele que diz o que
 * fazer a respeito — uma org com SAML expirado se resolve autorizando aquela org, e não relendo.
 */
function motivoDosDonos(failed: Discovery['failed']): string | null {
  if (failed.length === 0) return null

  return failed.map((owner) => `${owner.owner}: ${owner.reason}`).join(' · ')
}

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
