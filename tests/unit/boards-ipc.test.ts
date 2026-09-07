/**
 * O observador plural: a descoberta, as leituras por aba e o retrato que atravessa a ponte.
 *
 * O `electron` é mockado porque a única coisa que `src/main/boards.ts` usa dele é o `ipcMain.handle`
 * — e guardar os handlers num mapa é o que permite exercitar o canal de verdade. O que fica de
 * mentira é só o descobridor e o leitor, que já são injetados por construção.
 *
 * O caso que **não pode** faltar aqui é o isolamento entre abas: uma aba que falha, ou cuja leitura
 * fica presa, não pode apagar nem congelar as outras. É a diferença entre um app com dois boards e
 * um app com um board e um refém — e é invisível em qualquer teste que use uma aba só.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown) => unknown): void {
      handlers.set(channel, handler)
    },
  },
}))

import type { WebContents } from 'electron'

import type {
  Board,
  BoardCard,
  BoardFinder,
  BoardReader,
  DiscoveredBoard,
  Discovery,
  ReadBoardInput,
} from '../../src/core'
import { BOARD_REREAD_THROTTLE_MS, registerBoardsIpc } from '../../src/main/boards'
import type { BoardTab, BoardsSnapshot } from '../../src/shared/board'
import { IPC_INVOKE } from '../../src/shared/ipc'

/** As duas abas da bancada. A ordem é a que a descoberta devolveria — ela já ordena. */
const A: DiscoveredBoard = {
  key: 'leonardo-amaral-3/2',
  owner: 'leonardo-amaral-3',
  number: 2,
  title: 'Operations Center',
}

const B: DiscoveredBoard = {
  key: 'ICSF-Solutions/7',
  owner: 'ICSF-Solutions',
  number: 7,
  title: 'Plataformas v2',
}

interface Adiada<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

/** Uma promessa cuja hora de terminar é do teste — a leitura presa, aberta de propósito. */
function adiar<T>(): Adiada<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

interface Bancada {
  find?: () => Promise<Discovery>
  read?: (input: ReadBoardInput) => Promise<Board>
  loadActive?: () => Promise<string | null>
}

function montar(opcoes: Bancada = {}) {
  handlers.clear()

  const find = vi.fn(opcoes.find ?? (() => Promise.resolve({ boards: [A, B], failed: [] })))
  const read = vi.fn(opcoes.read ?? ((input: ReadBoardInput) => Promise.resolve(lido(input))))

  const publicados: BoardsSnapshot[] = []
  let destruido = false
  let acordar: (() => void) | null = null

  const isDestroyed = vi.fn(() => destruido)
  const sender = {
    isDestroyed,
    send(_canal: string, snapshot: BoardsSnapshot): void {
      publicados.push(snapshot)
      acordar?.()
    },
  } as unknown as WebContents

  // O `as unknown as` é o preço de `BoardsIpcDeps` tipar as classes concretas, que é o que se quer
  // em produção: o main não pode passar qualquer coisa com um `find`. Aqui a dupla só precisa
  // responder o que o observador pergunta.
  const ipc = registerBoardsIpc({
    finder: { find } as unknown as BoardFinder,
    reader: { read } as unknown as BoardReader,
    loadActive: opcoes.loadActive ?? (() => Promise.resolve(null)),
    saveActive: () => Promise.resolve(),
  })

  /** Espera a n-ésima publicação atravessar a ponte. Sem timer: quem acorda o teste é o canal. */
  async function esperar(quantidade: number): Promise<BoardsSnapshot> {
    while (publicados.length < quantidade) {
      await new Promise<void>((resolve) => {
        acordar = resolve
      })
    }

    acordar = null

    return emPosicao(publicados, quantidade - 1)
  }

  return {
    ipc,
    find,
    read,
    isDestroyed,
    publicados,
    esperar,
    destruir: () => {
      destruido = true
    },
    readBoards: (): Promise<BoardsSnapshot> => {
      const handler = handlers.get(IPC_INVOKE.readBoards)
      if (!handler) throw new Error(`canal não registrado: ${IPC_INVOKE.readBoards}`)

      return Promise.resolve(handler({ sender }) as BoardsSnapshot)
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('o observador dos boards', () => {
  it('o retrato do invoke sai antes da descoberta, e é ele que a guarda do renderer descarta', async () => {
    const bancada = montar()

    // A janela entre o `invoke` e o primeiro evento é a **descoberta inteira**, e não uma leitura
    // em voo. É por isso que o `pushed` do `KanbanScreen` ficou mais importante, não menos.
    expect(await bancada.readBoards()).toEqual({
      boards: null,
      activeKey: null,
      discoveryError: null,
    })
  })

  it('a descoberta é retentada enquanto nunca terminou, e não roda mais depois dela', async () => {
    let tentativas = 0
    const bancada = montar({
      find: () => {
        tentativas += 1

        return tentativas === 1
          ? Promise.reject(new Error('o gh não devolveu token'))
          : Promise.resolve({ boards: [A, B], failed: [] })
      },
    })

    void bancada.readBoards()

    // Falhou: `boards` continua `null`, e é exatamente isso que autoriza o gatilho seguinte a
    // tentar de novo. Um `[]` aqui teria feito "não consegui perguntar" passar por "perguntei e não
    // achei board nenhum" — e o retry nunca mais aconteceria.
    const falha = await bancada.esperar(1)
    expect(falha.boards).toBeNull()
    expect(falha.discoveryError).toContain('o gh não devolveu token')

    bancada.ipc.refresh()
    const descoberto = await bancada.esperar(2)
    expect(descoberto.boards?.map((aba) => aba.key)).toEqual([A.key, B.key])
    expect(bancada.find).toHaveBeenCalledTimes(2)

    // Daqui para frente a barra de abas não muda mais debaixo do usuário, por mais gatilhos que
    // cheguem: foco, `resume` da máquina, ou o renderer pedindo de novo.
    bancada.ipc.refresh()
    await bancada.readBoards()
    bancada.ipc.refresh()
    expect(bancada.find).toHaveBeenCalledTimes(2)
  })

  it('um dono que falhou vira motivo no retrato, sem apagar os boards de quem respondeu', async () => {
    const bancada = montar({
      find: () =>
        Promise.resolve({
          boards: [A],
          failed: [{ owner: B.owner, reason: 'Resource protected by organization SAML enforcement' }],
        }),
    })

    void bancada.readBoards()
    const retrato = await bancada.esperar(1)

    // `boards` e `discoveryError` preenchidos **ao mesmo tempo**: um dono que caiu não apaga os
    // boards dos que responderam, e também não some da tela.
    expect(retrato.boards?.map((aba) => aba.key)).toEqual([A.key])
    expect(retrato.discoveryError).toContain(B.owner)
    expect(retrato.discoveryError).toContain('SAML')
    expect(retrato.activeKey).toBe(A.key)

    // Descoberta parcial **também é descoberta terminada**: um retry que trouxesse a org de volta
    // faria a barra de abas crescer debaixo do usuário, que é o que descobrir uma vez só impede.
    bancada.ipc.refresh()
    expect(bancada.find).toHaveBeenCalledTimes(1)
  })

  it('a aba nasce com o título da descoberta e passa a usar o do board', async () => {
    const bancada = montar()

    void bancada.readBoards()

    // Antes de qualquer leitura a aba já tem nome — é isso que a descoberta compra.
    expect(abaDe(await bancada.esperar(1), A.key).title).toBe(A.title)

    await bancada.esperar(3)
    expect(abaDe(ultimo(bancada.publicados), A.key).title).toBe(lido(coordenadaDe(A)).title)
  })

  it('a leitura em voo e o throttle são por aba, e não do observador inteiro', async () => {
    vi.useFakeTimers()

    const presa = adiar<Board>()
    const bancada = montar({
      read: (input) => (input.owner === A.owner ? presa.promise : Promise.resolve(lido(input))),
    })

    void bancada.readBoards()

    // A descoberta publica e as duas leituras disparam juntas. Com uma guarda global, a aba B
    // ficaria refém da leitura de A — que nunca volta.
    await bancada.esperar(2)
    expect(bancada.read).toHaveBeenCalledTimes(2)
    expect(abaDe(ultimo(bancada.publicados), B.key).board).not.toBeNull()
    expect(abaDe(ultimo(bancada.publicados), A.key).board).toBeNull()

    // Passado o throttle, B é relida — e A não, porque a leitura dela continua em voo. É o par que
    // prova que as **duas** guardas são por aba.
    vi.setSystemTime(Date.now() + BOARD_REREAD_THROTTLE_MS + 1)
    bancada.ipc.refresh()
    await bancada.esperar(3)

    expect(bancada.read.mock.calls.map(([input]) => input.owner)).toEqual([
      A.owner,
      B.owner,
      B.owner,
    ])
  })

  it('a falha de uma aba preserva o board dela e não toca o da outra', async () => {
    vi.useFakeTimers()

    let cair = false
    const bancada = montar({
      read: (input) =>
        cair && input.owner === A.owner
          ? Promise.reject(new Error('502 Bad Gateway'))
          : Promise.resolve(lido(input)),
    })

    void bancada.readBoards()
    const primeira = await bancada.esperar(3)
    expect(abaDe(primeira, A.key).error).toBeNull()

    cair = true
    vi.setSystemTime(Date.now() + BOARD_REREAD_THROTTLE_MS + 1)
    bancada.ipc.refresh()
    await bancada.esperar(5)

    const depois = ultimo(bancada.publicados)
    const a = abaDe(depois, A.key)

    // O board de antes sobrevive à falha — trocar informação levemente velha por informação nenhuma
    // a cada oscilação de rede seria regressão de produto. Quem acusa a idade é o `readAt`, que
    // fica parado no instante da última leitura que deu certo.
    expect(a.error).toContain('502 Bad Gateway')
    expect(a.board?.title).toBe(lido(coordenadaDe(A)).title)
    expect(a.readAt).toBe(abaDe(primeira, A.key).readAt)

    // E a aba B não sentiu nada: nem no board, nem no erro, nem no carimbo.
    expect(abaDe(depois, B.key).error).toBeNull()
    expect(abaDe(depois, B.key).board).not.toBeNull()
  })

  it('cardById encontra o cartão de qualquer aba, e não só o da ativa', async () => {
    const bancada = montar()

    void bancada.readBoards()
    await bancada.esperar(3)

    // A ativa é a primeira da ordem, e o cartão procurado está na **outra**. `itemId` é único no
    // GitHub inteiro, então varrer só a ativa deixaria um cartão sem pasta por estar na aba errada.
    expect(ultimo(bancada.publicados).activeKey).toBe(A.key)
    expect(bancada.ipc.cardById(cartaoDe(B).itemId)?.itemId).toBe(cartaoDe(B).itemId)
    expect(bancada.ipc.cardById(cartaoDe(A).itemId)?.itemId).toBe(cartaoDe(A).itemId)
    expect(bancada.ipc.cardById('PVTI_de_ninguem')).toBeNull()
  })

  it('o WebContents destruído sai do conjunto de assinantes', async () => {
    const leituras: Adiada<Board>[] = []
    const bancada = montar({
      read: () => {
        const leitura = adiar<Board>()
        leituras.push(leitura)

        return leitura.promise
      },
    })

    void bancada.readBoards()
    await bancada.esperar(1)
    expect(bancada.isDestroyed).toHaveBeenCalledTimes(1)

    bancada.destruir()

    // Duas leituras em voo, e portanto duas publicações a caminho.
    for (const leitura of leituras) leitura.resolve(lidoQualquer())
    await assentar()

    // A primeira publicação consultou e **removeu**; a segunda nem consultou. É esta diferença que
    // distingue "removido do conjunto" de "pulado toda vez" — e o segundo vazaria um `WebContents`
    // por janela, num observador que vive o app inteiro.
    expect(bancada.isDestroyed).toHaveBeenCalledTimes(2)
    expect(bancada.publicados).toHaveLength(1)
  })
})

function coordenadaDe(board: DiscoveredBoard): ReadBoardInput {
  return { owner: board.owner, number: board.number }
}

/**
 * O board que a leitura devolve, com um cartão dentro.
 *
 * O título é **outro** que o da descoberta de propósito: é a leitura que tem de vencer, porque ela
 * é a mais fresca. E a coordenada desconhecida **lança** — é o que prova que o main pede o board
 * pela coordenada que a descoberta deu, e não por uma chave recomposta na mão.
 */
function lido(input: ReadBoardInput): Board {
  const descoberto = [A, B].find(
    (candidato) => candidato.owner === input.owner && candidato.number === input.number,
  )

  if (!descoberto) {
    throw new Error(`coordenada que a descoberta não devolveu: ${input.owner}/${input.number}`)
  }

  return {
    title: `${descoberto.title} · lido do board`,
    columns: [],
    cards: [cartaoDe(descoberto)],
  }
}

/** Um board sem identidade, para quando o teste só precisa de uma leitura que termina. */
function lidoQualquer(): Board {
  return { title: 'qualquer', columns: [], cards: [] }
}

function cartaoDe(board: DiscoveredBoard): BoardCard {
  return {
    itemId: `PVTI_${board.owner}_${board.number}`,
    number: board.number,
    title: `um cartão de ${board.title}`,
    url: `https://github.com/${board.owner}`,
    repository: `${board.owner}/algum-repo`,
    closed: false,
    assignees: [],
    columnId: 'opt_qualquer',
    fields: [],
  }
}

/** A aba pedida, com o vermelho **aqui** e nomeando quem sumiu, em vez de um `undefined` adiante. */
function abaDe(snapshot: BoardsSnapshot, key: string): BoardTab {
  const aba = snapshot.boards?.find((candidata) => candidata.key === key)
  if (!aba) throw new Error(`o retrato não tem a aba ${key}`)

  return aba
}

function ultimo(publicados: readonly BoardsSnapshot[]): BoardsSnapshot {
  return emPosicao(publicados, publicados.length - 1)
}

function emPosicao(publicados: readonly BoardsSnapshot[], indice: number): BoardsSnapshot {
  const retrato = publicados[indice]
  if (retrato === undefined) throw new Error(`não houve publicação na posição ${indice}`)

  return retrato
}

/**
 * Deixa as microtarefas assentarem.
 *
 * Necessário só no teste do assinante destruído: lá as publicações não chegam a ninguém, então não
 * há evento pelo qual esperar. A cadeia da leitura é `then → catch → finally`, e a folga é para
 * não depender do número exato de voltas que ela gasta.
 */
async function assentar(): Promise<void> {
  for (let volta = 0; volta < 20; volta += 1) await Promise.resolve()
}
