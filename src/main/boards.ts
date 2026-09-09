import { ipcMain } from 'electron'
import type { WebContents } from 'electron'

import { pickActive } from '../core'
import type { BoardFinder, BoardReader, Discovery, ReadBoardInput } from '../core'
import type { BoardCard, BoardTab, BoardsSnapshot } from '../shared/board'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type { ActivateBoardRequest } from '../shared/ipc'

export interface BoardsIpcDeps {
  finder: BoardFinder
  reader: BoardReader
  /**
   * A aba lembrada, injetada como as quatro pontas de IO do `ConversationIndex` e pela mesma razão:
   * quem lê e escreve disco é o main, e a peça que decide fica testável sem ele.
   *
   * `loadActive` é consultada **uma vez**, no fim da descoberta, e o que ela devolve é uma chave
   * opaca: quem tolera o lembrado que já não existe é o `pickActive`. `saveActive` só é chamada
   * pela ação do humano (Decisão 14) — nunca pela descoberta.
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
  /**
   * O repo daquela aba, ou `null` quando ela não tem **um** repo.
   *
   * Unanimidade, e não moda: contagem de cards não tem relação nenhuma com onde o `CLAUDE.md`
   * daquele board mora, e um board que ganhasse dez cards de outro repo mudaria a pasta da triagem
   * sozinho e em silêncio. Sem unanimidade a resposta é "não sei", que o painel já sabe tratar
   * pedindo a pasta.
   *
   * **Todos** os cartões, inclusive os fechados: a coluna ✅ Produção é do mesmo board e do mesmo
   * repo, e filtrar por estado faria o repo da aba mudar conforme os cards fossem fechando.
   *
   * Comparação case-insensitive porque o GitHub não distingue caixa em `owner/name` — a mesma
   * régua do `normalizeRepository` do `RepoIndex`. Devolve o `repository` como o board o escreveu.
   */
  repoOfBoard(key: string): string | null
  /** De qual aba é aquele cartão, ou `null`. É o que liga um fim de turno à aba a reler. */
  tabKeyOf(itemId: string): string | null
  /**
   * Relê aquela aba **agora**, furando o throttle.
   *
   * É o que faz o card recém-criado pela `/gm-triage` aparecer sem alt-tab: o fim do turno é uma
   * notícia de que o GitHub mudou, e não mais um gatilho de rotina como o foco da janela. As outras
   * duas guardas do `read` **continuam valendo** — leitura em voo e coordenada ausente não são
   * economia de trabalho, são ausência de trabalho a fazer.
   */
  readNow(key: string): void
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

  /**
   * A fila das gravações da aba lembrada. Uma promessa encadeada, e não um `void saveActive(...)`
   * solto: dois cliques seguidos escreveriam o mesmo arquivo ao mesmo tempo, e quem venceria seria
   * o sistema de arquivos — a mesma razão do `#gravando` do `ConversationIndex`.
   */
  let saving: Promise<void> = Promise.resolve()

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

  /**
   * `force` pula **só a guarda de throttle**, e essa fronteira é a regra.
   *
   * O throttle existe para não repetir trabalho à toa quando o gatilho é de rotina; um fim de turno
   * não é rotina, é a notícia de que alguém acabou de mexer no board. As outras duas guardas não
   * são economia — com leitura em voo não há nada a mais a saber, e sem coordenada não há a quem
   * perguntar —, então furá-las não adiantaria o retrato em nada.
   */
  function read(key: string, { force = false }: { force?: boolean } = {}): void {
    // Gatilho que chega com leitura em voo é **descartado, não enfileirado**: a leitura em voo
    // começou há no máximo o throttle e vai publicar dado fresco de qualquer forma. As duas guardas
    // são por aba porque uma leitura presa numa aba não pode impedir a releitura da outra — trocar
    // de aba passaria a depender da rede da aba anterior.
    if (reading.has(key)) return

    const last = lastReadAt.get(key) ?? 0
    if (!force && last !== 0 && Date.now() - last < BOARD_REREAD_THROTTLE_MS) return

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

  /**
   * O primeiro canal de **escrita** da ponte — e o que ele escreve é estado local do app, nunca o
   * GitHub. Daí o prefixo `ui:`, e não `boards:`.
   *
   * O renderer avisa que o humano clicou; quem decide continua sendo o main. **Publicar e gravar
   * são separados de propósito**, como no `ConversationIndex.remember`: a tela troca de aba no
   * mesmo tique, e uma gravação que falhe custa uma aba lembrada — não uma tela travada.
   */
  ipcMain.handle(IPC_INVOKE.activateBoard, (_event, request: ActivateBoardRequest): void => {
    // `key` desconhecida é **ignorada, e não erro**: o renderer pode estar clicando sobre um
    // retrato que já mudou, e antes da descoberta `tabs` é `null` e não há aba nenhuma a ativar.
    // Rejeitar transformaria uma corrida normal em exceção na tela.
    if (!tabs?.some((tab) => tab.key === request.key)) return

    activeKey = request.key
    publish()

    // O `catch` fecha cada elo da fila: uma gravação que falhou não pode deixá-la rejeitada e levar
    // junto as seguintes. E ninguém tem como capturar a falha lá fora — o `invoke` já respondeu.
    saving = saving.then(() => deps.saveActive(request.key)).catch(() => undefined)
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
    repoOfBoard(key: string): string | null {
      // Antes da primeira leitura daquela aba, `board` é `null` e a resposta é "não sei" — o mesmo
      // "não sei" da aba ambígua, e de propósito: quem pergunta é o painel, e o que ele faz com a
      // resposta é o mesmo nos dois casos. Aba que não está no retrato cai aqui também.
      const cards = tabs?.find((tab) => tab.key === key)?.board?.cards ?? []
      const [primeiro] = cards
      if (primeiro === undefined) return null

      const chave = normalizeRepository(primeiro.repository)
      const unanime = cards.every((card) => normalizeRepository(card.repository) === chave)

      // O `repository` como o **board** o escreveu, e não a chave normalizada: quem recebe isto é o
      // `RepoIndex`, que normaliza de novo por conta própria, e a caixa canônica do GitHub é a que
      // aparece se algum dia isto for parar numa tela.
      return unanime ? primeiro.repository : null
    },
    tabKeyOf(itemId: string): string | null {
      // **Todas** as abas, como o `cardById` e pela mesma razão: entre o começo do turno e o fim
      // dele o humano pode ter trocado de aba, e o cartão cuja sessão acabou de devolver a vez
      // continua sendo o mesmo cartão — na aba dele, que não é necessariamente a que está na tela.
      for (const tab of tabs ?? []) {
        const cards = tab.board?.cards ?? []
        if (cards.some((card) => card.itemId === itemId)) return tab.key
      }

      return null
    },
    readNow(key: string): void {
      read(key, { force: true })
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

/**
 * A régua de igualdade entre repos, a mesma do `RepoIndex`: o GitHub não distingue caixa em
 * `owner/name`, e o board devolve o `nameWithOwner` na caixa canônica.
 *
 * Repetida e não importada porque a do índice é detalhe interno dele — exportá-la faria uma função
 * de duas linhas virar contrato do core só para poupar duas linhas aqui.
 */
function normalizeRepository(repository: string): string {
  return repository.trim().toLowerCase()
}

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
