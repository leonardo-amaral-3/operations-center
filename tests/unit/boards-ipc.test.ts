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
  handlers: new Map<string, (event: unknown, request?: unknown) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown, request?: unknown) => unknown): void {
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

/** O canal pedido, com o vermelho **aqui** e nomeando quem falta, em vez de um `undefined` adiante. */
function canal(nome: string): (event: unknown, request?: unknown) => unknown {
  const handler = handlers.get(nome)
  if (!handler) throw new Error(`canal não registrado: ${nome}`)

  return handler
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

  /**
   * A ponta de escrita, sempre espiã: **quando** ela é chamada é metade do que esta suíte prova.
   * A Decisão 14 é uma afirmação sobre chamada que não acontece — a descoberta não regrava —, e
   * isso só se vê com o `vi.fn` ligado em todos os casos, não só nos que gravam.
   */
  const saveActive = vi.fn(() => Promise.resolve())

  // O `as unknown as` é o preço de `BoardsIpcDeps` tipar as classes concretas, que é o que se quer
  // em produção: o main não pode passar qualquer coisa com um `find`. Aqui a dupla só precisa
  // responder o que o observador pergunta.
  const ipc = registerBoardsIpc({
    finder: { find } as unknown as BoardFinder,
    reader: { read } as unknown as BoardReader,
    loadActive: opcoes.loadActive ?? (() => Promise.resolve(null)),
    saveActive,
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
    saveActive,
    isDestroyed,
    publicados,
    esperar,
    destruir: () => {
      destruido = true
    },
    readBoards: (): Promise<BoardsSnapshot> =>
      Promise.resolve(canal(IPC_INVOKE.readBoards)({ sender }) as BoardsSnapshot),
    /** O canal de escrita, chamado como o `ipcMain.handle` o chamaria: evento primeiro, carga depois. */
    activateBoard: (key: string): Promise<void> =>
      Promise.resolve(canal(IPC_INVOKE.activateBoard)({ sender }, { key }) as void),
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

  it('repoOfBoard devolve o repo unânime da aba, sem se importar com a caixa', async () => {
    const bancada = montar({
      read: () =>
        Promise.resolve({
          ...lidoQualquer(),
          cards: [
            cartaoDoRepo('um', 'leonardo-amaral-3/operations-center'),
            // A mesma coisa para o GitHub, que não distingue caixa em `owner/name`. Comparar as
            // strings cruas faria a triagem desta aba cair no ramo ambíguo por causa de um `O`
            // maiúsculo que ninguém digitou.
            cartaoDoRepo('dois', 'Leonardo-Amaral-3/Operations-Center'),
            { ...cartaoDoRepo('tres', 'leonardo-amaral-3/operations-center'), closed: true },
          ],
        }),
    })

    void bancada.readBoards()
    await bancada.esperar(3)

    // O `repository` como o board o escreveu, e não a chave normalizada: quem recebe isto é o
    // `RepoIndex`, que normaliza de novo por conta própria.
    expect(bancada.ipc.repoOfBoard(A.key)).toBe('leonardo-amaral-3/operations-center')
  })

  it('repoOfBoard responde "não sei" com dois repos, com aba vazia, e com aba que não existe', async () => {
    const bancada = montar({
      read: (input) =>
        Promise.resolve({
          ...lidoQualquer(),
          cards:
            input.owner === A.owner
              ? [
                  cartaoDoRepo('um', 'leonardo-amaral-3/operations-center'),
                  // **Fechado, e conta**: a coluna ✅ Produção é do mesmo board, e um card de outro
                  // repo continua tornando a aba ambígua depois de fechado. Filtrar por estado faria
                  // o repo da aba — e a pasta da triagem — mudar sozinho conforme os cards fechassem.
                  { ...cartaoDoRepo('dois', 'leonardo-amaral-3/claude-brain'), closed: true },
                ]
              : [],
        }),
    })

    void bancada.readBoards()
    await bancada.esperar(3)

    // Dois repos: a moda escolheria um dos dois em silêncio, e a pasta da triagem passaria a mudar
    // sozinha ao sabor de quantos cards cada repo tem. "Não sei" manda o painel pedir a pasta.
    expect(bancada.ipc.repoOfBoard(A.key)).toBeNull()

    // Aba sem cartão nenhum: não há de onde tirar repo.
    expect(bancada.ipc.repoOfBoard(B.key)).toBeNull()

    // E a aba que o retrato não tem — uma `key` de um board que sumiu entre o clique e a resposta.
    expect(bancada.ipc.repoOfBoard('ninguem/999')).toBeNull()
  })

  it('repoOfBoard responde "não sei" antes de a leitura daquela aba voltar', async () => {
    const presa = adiar<Board>()
    const bancada = montar({ read: () => presa.promise })

    void bancada.readBoards()

    // A descoberta publicou e as leituras estão em voo: a aba já tem nome e ainda não tem board.
    // É o mesmo "não sei" da aba ambígua, e de propósito — o painel trata os dois do mesmo jeito.
    await bancada.esperar(1)
    expect(bancada.ipc.repoOfBoard(A.key)).toBeNull()

    presa.resolve(lidoQualquer())
  })

  it('tabKeyOf diz de que aba é o cartão, e null para quem não está em nenhuma', async () => {
    const bancada = montar()

    void bancada.readBoards()
    await bancada.esperar(3)

    // O par do `cardById`, e é ele que traduz o fim de um turno de cartão na aba a reler. A busca é
    // em **todas** as abas pela mesma razão: o humano pode ter trocado de aba durante o turno, e o
    // card continua onde estava.
    expect(bancada.ipc.tabKeyOf(cartaoDe(A).itemId)).toBe(A.key)
    expect(bancada.ipc.tabKeyOf(cartaoDe(B).itemId)).toBe(B.key)

    // O cartão que o retrato não tem — board que sumiu, aba ainda não lida. Não relê nada, em vez
    // de relerem-se todas por precaução.
    expect(bancada.ipc.tabKeyOf('PVTI_de_ninguem')).toBeNull()
  })

  it('readNow relê dentro do throttle — e só a aba pedida', async () => {
    const bancada = montar()

    void bancada.readBoards()
    await bancada.esperar(3)
    expect(bancada.read).toHaveBeenCalledTimes(2)

    // O gatilho de rotina, dentro dos 10s, é descartado: é o throttle vivo, e é o que dá sentido à
    // linha seguinte. Sem esta asserção, um `readNow` que não furasse nada passaria despercebido
    // num teste onde o throttle já tivesse vencido.
    bancada.ipc.refresh()
    expect(bancada.read).toHaveBeenCalledTimes(2)

    // O fim do turno não é rotina: é a notícia de que a skill acabou de criar um card. Fura.
    bancada.ipc.readNow(A.key)
    await bancada.esperar(4)

    expect(bancada.read).toHaveBeenCalledTimes(3)
    // E só a aba daquela sessão. Reler as duas seria uma leitura do GitHub a mais por turno, para
    // uma aba em que nada aconteceu.
    expect(bancada.read.mock.calls.at(-1)?.[0]).toEqual(coordenadaDe(A))
  })

  it('readNow não atropela a leitura em voo daquela aba', async () => {
    const presa = adiar<Board>()
    const bancada = montar({
      read: (input) => (input.owner === A.owner ? presa.promise : Promise.resolve(lido(input))),
    })

    void bancada.readBoards()
    await bancada.esperar(2)
    expect(bancada.read).toHaveBeenCalledTimes(2)

    // `force` pula **só** a guarda de throttle. A leitura em voo não é economia de trabalho: uma
    // segunda leitura da mesma aba não responderia nada que a que já está a caminho não vá trazer,
    // e um fim de turno chega no meio dela com frequência.
    bancada.ipc.readNow(A.key)
    expect(bancada.read).toHaveBeenCalledTimes(2)

    presa.resolve(lidoQualquer())
  })

  it('readNow é no-op antes de a descoberta terminar', () => {
    const bancada = montar()

    // A outra guarda que `force` não pula: sem coordenada não há a quem perguntar. Uma sessão que
    // devolveu a vez antes de a descoberta responder — o app aberto direto num cartão — cairia
    // aqui, e pedir board a `undefined` seria trocar um retrato atrasado por uma exceção.
    bancada.ipc.readNow(A.key)

    expect(bancada.read).not.toHaveBeenCalled()
    // E também não dispara a descoberta: quem a liga é o `refresh`, e o fim de um turno não é um
    // gatilho de descoberta.
    expect(bancada.find).not.toHaveBeenCalled()
  })

  it('a aba lembrada nasce ativa quando ela está entre as descobertas', async () => {
    const bancada = montar({ loadActive: () => Promise.resolve(B.key) })

    void bancada.readBoards()

    // O primeiro caso do `pickActive` que a Fase 0 deixou inalcançável: até aqui o main passava
    // `() => null`, e um lembrado **válido** nunca chegava a ele. A ativa é a B, e não a primeira
    // da ordem — que é toda a diferença entre lembrar e não lembrar.
    expect((await bancada.esperar(1)).activeKey).toBe(B.key)
  })

  it('o lembrado que saiu da lista cai na primeira aba, e a preferência não é apagada', async () => {
    const bancada = montar({ loadActive: () => Promise.resolve('ICSF-Solutions/999') })

    void bancada.readBoards()
    const retrato = await bancada.esperar(1)

    // O segundo caso inalcançável, e o CA-4 inteiro: board arquivado, renumerado ou que deixou de
    // declarar as 8 estações abre na primeira aba **sem erro nenhum na tela** — a ausência do
    // lembrado não é falha de descoberta.
    expect(retrato.activeKey).toBe(A.key)
    expect(retrato.discoveryError).toBeNull()

    // E a Decisão 14: a descoberta **não** regrava o arquivo. A ausência pode ser temporária — a
    // org fora do ar, um token sem `read:org` naquele dia — e regravar apagaria uma preferência que
    // ia voltar a valer. O caso já se resolve na leitura, de graça, e é por isso que corrigir o
    // disco aqui seria destruir estado para não ganhar nada.
    await assentar()
    expect(bancada.saveActive).not.toHaveBeenCalled()
  })

  it('ativar uma aba publica na hora e enfileira a gravação', async () => {
    const bancada = montar()

    void bancada.readBoards()
    await bancada.esperar(3)
    expect(ultimo(bancada.publicados).activeKey).toBe(A.key)

    const antes = bancada.publicados.length
    const ativando = bancada.activateBoard(B.key)

    // **Sem um `await` sequer**: o retrato novo já atravessou a ponte quando o handler retornou. É
    // esta linha que prova a separação, e não um `expect` depois do `await` — que ficaria verde
    // também numa implementação que gravasse primeiro e publicasse depois. Uma gravação que falhe
    // custa uma aba lembrada; uma tela que espera o disco custa a troca de aba inteira.
    expect(bancada.publicados).toHaveLength(antes + 1)
    expect(ultimo(bancada.publicados).activeKey).toBe(B.key)

    await ativando

    // E a gravação veio depois, com a chave que o humano ativou — esta sim, a ação dele.
    await assentar()
    expect(bancada.saveActive.mock.calls).toEqual([[B.key]])
  })

  it('a key que não está entre as abas é ignorada, e não é erro', async () => {
    const bancada = montar()

    // Antes da descoberta não há aba nenhuma. Um clique que chegasse aqui — janela reaberta, evento
    // atrasado — não pode derrubar o `invoke`.
    await expect(bancada.activateBoard(B.key)).resolves.toBeUndefined()

    void bancada.readBoards()
    await bancada.esperar(3)
    const antes = bancada.publicados.length

    await expect(bancada.activateBoard('ninguem/999')).resolves.toBeUndefined()

    // Nem publicação, nem gravação, nem exceção: o renderer pode estar clicando sobre um retrato que
    // já mudou, e isso é corrida normal, não engano de quem chamou. A aba ativa fica onde estava.
    expect(bancada.publicados).toHaveLength(antes)
    expect(ultimo(bancada.publicados).activeKey).toBe(A.key)
    await assentar()
    expect(bancada.saveActive).not.toHaveBeenCalled()
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
    parent: null,
    phases: [],
  }
}

/**
 * Um cartão de um repo escolhido pelo teste. Só o `repository` importa para a régua da triagem — o
 * resto é o cartão de sempre, para o caso não depender de campo nenhum que ele não olha.
 */
function cartaoDoRepo(sufixo: string, repository: string): BoardCard {
  return { ...cartaoDe(A), itemId: `PVTI_${sufixo}`, repository }
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
