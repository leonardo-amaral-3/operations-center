// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Fabrica } from '../../src/renderer/fabrica/Fabrica'
import type {
  ComandoDaFabrica,
  ItemNaSala,
  PerguntaDaFila,
  ResultadoDoComando,
  SalaDaFabrica,
} from '../../src/shared/fabrica'
import type { BoardsSnapshot } from '../../src/shared/board'
import { BOARD_DE_DOIS_REPOS, readFabricaBoardDeTeste } from './boardNaFabrica'

/**
 * A raiz da fábrica no app (#130, CA-1.1 e CA-1.2 do lado da tela): abre na Sala com o cabeçalho do
 * protótipo, cada botão leva à sua tela, a trilha volta, e o item da fila e o despacho em voo levam
 * a Pergunta e ao Card. A ponte é falsa: o main nem entra.
 */

const aberto: ItemNaSala = {
  id: 'q-0001',
  tipo: 'pergunta',
  card: 901,
  repo: 'leonardo-amaral-3/operations-center',
  cardUrl: 'https://example.invalid/901',
  motivo: 'Qual rota?',
  despacho: 'd-0001',
  comando: '/gm-spec 901',
  sessaoClaude: null,
  criadoEm: '2026-11-11T12:00:00.000Z',
  fechadoEm: null,
  resolucao: null,
  estacao: 'spec',
  sessaoQuebrada: false,
}

function retrato(extra: { pausa?: SalaDaFabrica['pausa'] } = {}): SalaDaFabrica {
  return {
    kind: 'ok',
    lidoEm: '2026-11-11T12:00:00.000Z',
    projeto: 'Operations Center · Project 2',
    despachante: 'rodando',
    pausa: extra.pausa ?? null,
    recursos: {
      sessoes: { kind: 'ok', vivas: 0, teto: 3 },
      suite: { kind: 'livre' },
      disco: { kind: 'ok', livres: 50 * 1024 ** 3, minimo: 2 * 1024 ** 3 },
    },
    emVoo: [
      {
        id: 'd-0002',
        card: 903,
        repo: 'leonardo-amaral-3/operations-center',
        cardUrl: 'https://example.invalid/903',
        comando: '/gm-implement 903',
        estacao: 'implementacao',
        estado: 'rodando',
        criadoEm: '2026-11-11T12:00:00.000Z',
        lancadoEm: null,
        ondeRoda: 'worktree ainda não criada',
        viva: true,
      },
    ],
    abertos: [aberto],
    fechados: [],
    decisoes: [],
    frentesAbertas: 1,
  }
}

const pergunta: PerguntaDaFila = {
  item: aberto,
  resultado: 'A sessão perguntou.',
  fechar: 'yarn fabrica fechar q-0001 "<resolução>"',
  fim: 'parada',
  pr: null,
  prUrl: null,
  passos: [],
}

const readFabrica = vi.fn<() => Promise<SalaDaFabrica>>()
const readFabricaPergunta = vi.fn<() => Promise<PerguntaDaFila | null>>()
const readRelatorio = vi.fn(() => new Promise(() => {}))
const comandoFabrica = vi.fn<(c: ComandoDaFabrica) => Promise<ResultadoDoComando>>()

beforeEach(() => {
  readFabrica.mockReset().mockResolvedValue(retrato())
  readFabricaPergunta.mockReset().mockResolvedValue(pergunta)
  comandoFabrica.mockReset()
  Object.defineProperty(window, 'oc', {
    value: {
      readFabrica,
      readFabricaBoard: readFabricaBoardDeTeste,
      readFabricaPergunta,
      readRelatorio,
      comandoFabrica,
      // Sala e Agentes (F2) juntam título e etiquetas dos cards pelo retrato de boards.
      readBoards: () => Promise.resolve({ boards: [], activeKey: null, discoveryError: null }),
      onBoards: () => () => {},
    },
    configurable: true,
  })
})

afterEach(cleanup)

const telaAtual = () => screen.getByTestId('fabrica-tela').dataset.tela

describe('Fabrica · moldura e navegação (CA-1.1)', () => {
  it('abre na Sala com o cabeçalho do protótipo', async () => {
    render(<Fabrica />)
    await screen.findByTestId('fabrica-cabecalho')

    expect(telaAtual()).toBe('sala')
    expect(screen.getByRole('heading', { name: 'Operations Center' })).toBeTruthy()
    expect(screen.getByText('Sala de controle da fábrica')).toBeTruthy()

    const nav = screen.getByRole('navigation', { name: 'Telas' })

    expect(Array.from(nav.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Sala de controle',
      'Briefing',
      'Relatório',
      'Portfólio',
      'Entrada',
      'Agentes',
      'Release',
      'Mandato e placar',
    ])
    expect((await screen.findByTestId('fabrica-projeto')).textContent).toBe(
      'Operations Center · Project 2',
    )
    expect(screen.getByTestId('fabrica-estado').textContent).toBe('Fábrica ligada')
    expect(screen.getByTestId('fabrica-pausar').textContent).toBe('Pausar fábrica')
  })

  it.each([
    ['briefing', 'Briefing do dia'],
    ['relatorio', 'Relatório de '],
    ['portfolio', 'Portfólio'],
    ['entrada', 'Entrada'],
    ['agentes', 'Agentes'],
    ['release', 'Release'],
    ['mandato', 'Mandato'],
  ])('o botão %s leva à tela e a trilha volta à Sala', async (tela, ultimo) => {
    render(<Fabrica />)
    await screen.findByTestId('fabrica-cabecalho')
    await screen.findByTestId('fabrica-aberto')

    fireEvent.click(screen.getByTestId(`fabrica-nav-${tela}`))
    expect(telaAtual()).toBe(tela)

    const trilha = screen.getByTestId('fabrica-trilha')

    expect(trilha.textContent).toContain('Sala de controle')
    expect(trilha.textContent).toContain(ultimo)

    fireEvent.click(screen.getByTestId('fabrica-trilha-0'))
    expect(telaAtual()).toBe('sala')
  })

  it.each(['briefing', 'relatorio', 'portfolio', 'entrada', 'agentes', 'release', 'mandato'])(
    'na tela %s o botão dela está marcado e outro botão leva direto à próxima, sem passar pela Sala',
    async (tela) => {
      const ordem = [
        'sala',
        'briefing',
        'relatorio',
        'portfolio',
        'entrada',
        'agentes',
        'release',
        'mandato',
      ]
      const outra = ordem[(ordem.indexOf(tela) + 1) % ordem.length] as string

      render(<Fabrica />)

      await screen.findByTestId('fabrica-cabecalho')
      await screen.findByTestId('fabrica-aberto')
      fireEvent.click(screen.getByTestId(`fabrica-nav-${tela}`))
      expect(telaAtual()).toBe(tela)
      expect(screen.getByTestId(`fabrica-nav-${tela}`).getAttribute('aria-current')).toBe('page')
      expect(
        screen
          .getAllByTestId(/^fabrica-nav-/)
          .filter((b) => b.getAttribute('aria-current') !== null),
      ).toHaveLength(1)

      fireEvent.click(screen.getByTestId(`fabrica-nav-${outra}`))
      expect(telaAtual()).toBe(outra)
    },
  )

  it('a Pergunta mostra o menu sem nenhum botão marcado', async () => {
    render(<Fabrica />)
    await screen.findByTestId('fabrica-cabecalho')
    fireEvent.click(await screen.findByTestId('fabrica-aberto'))

    expect(telaAtual()).toBe('pergunta')
    expect(screen.getByTestId('fabrica-nav')).toBeTruthy()
    expect(
      screen.getAllByTestId(/^fabrica-nav-/).filter((b) => b.getAttribute('aria-current') !== null),
    ).toEqual([])
  })

  it('o Briefing tem corpo, e o botão Pausar também fica no cabeçalho de Agentes', async () => {
    render(<Fabrica />)
    await screen.findByTestId('fabrica-cabecalho')
    fireEvent.click(screen.getByTestId('fabrica-nav-briefing'))
    expect(screen.queryByTestId('fabrica-por-vir')).toBeNull()
    // O botão Pausar também fica no cabeçalho de Agentes.
    fireEvent.click(screen.getByTestId('fabrica-trilha-0'))
    fireEvent.click(screen.getByTestId('fabrica-nav-agentes'))
    expect(screen.getByTestId('fabrica-pausar')).toBeTruthy()
  })

  it('um item da fila leva à Pergunta, com a trilha de três partes', async () => {
    render(<Fabrica />)
    await screen.findByTestId('fabrica-cabecalho')
    fireEvent.click(await screen.findByTestId('fabrica-aberto'))

    expect(telaAtual()).toBe('pergunta')
    expect(screen.getByTestId('fabrica-trilha').textContent).toBe(
      'Sala de controle/Esperando você/Pergunta',
    )
    expect((await screen.findByTestId('fabrica-pergunta')).textContent).toContain('Qual rota?')
    expect(screen.getByTestId('fabrica-responder-fechar')).toBeTruthy()

    fireEvent.click(screen.getByTestId('fabrica-trilha-1'))
    expect(telaAtual()).toBe('sala')
  })

  it('um despacho em voo leva ao Card, com o #<card> na trilha', async () => {
    render(<Fabrica />)
    await screen.findByTestId('fabrica-cabecalho')
    fireEvent.click(await screen.findByTestId('fabrica-em-voo'))

    expect(telaAtual()).toBe('card')
    expect(screen.getByTestId('fabrica-trilha').textContent).toBe('Sala de controle/Linha/#903')
  })
})

describe('Fabrica · Pausar e Retomar (CA-1.2)', () => {
  it('pausa pelo canal, relê o retrato e vira Retomar; o botão só volta com o retrato novo', async () => {
    comandoFabrica.mockResolvedValue({ ok: true, codigo: 0, argv: ['pausar'], saida: '', erro: '' })

    render(<Fabrica />)

    await screen.findByTestId('fabrica-cabecalho')
    await screen.findByTestId('fabrica-aberto')
    readFabrica.mockResolvedValue(retrato({ pausa: { desde: '2026-11-11T12:30:00.000Z' } }))

    fireEvent.click(screen.getByTestId('fabrica-pausar'))
    expect(comandoFabrica).toHaveBeenCalledExactlyOnceWith({
      board: 'leonardo-amaral-3/2',
      comando: { tipo: 'pausar' },
    })
    expect(screen.getByTestId('fabrica-pausar')).toHaveProperty('disabled', true)

    await waitFor(() => {
      expect(screen.getByTestId('fabrica-estado').textContent).toBe('Fábrica pausada')
    })
    await waitFor(() => {
      expect(screen.getByTestId('fabrica-pausar')).toHaveProperty('disabled', false)
    })
    expect(screen.getByTestId('fabrica-pausar').textContent).toBe('Retomar fábrica')

    comandoFabrica.mockResolvedValue({
      ok: true,
      codigo: 0,
      argv: ['retomar'],
      saida: '',
      erro: '',
    })
    readFabrica.mockResolvedValue(retrato())
    fireEvent.click(screen.getByTestId('fabrica-pausar'))
    expect(comandoFabrica).toHaveBeenLastCalledWith({
      board: 'leonardo-amaral-3/2',
      comando: { tipo: 'retomar' },
    })
    await waitFor(() => {
      expect(screen.getByTestId('fabrica-estado').textContent).toBe('Fábrica ligada')
    })
  })

  it('um comando que falha mostra a linha de erro, e ela some no comando seguinte', async () => {
    comandoFabrica.mockResolvedValueOnce({
      ok: false,
      codigo: 2,
      argv: ['pausar'],
      saida: '',
      erro: 'pasta temporária recusada',
    })

    render(<Fabrica />)

    await screen.findByTestId('fabrica-cabecalho')
    await screen.findByTestId('fabrica-aberto')
    fireEvent.click(screen.getByTestId('fabrica-pausar'))
    expect((await screen.findByTestId('fabrica-comando-erro')).textContent).toBe(
      'pasta temporária recusada',
    )

    comandoFabrica.mockResolvedValueOnce({
      ok: true,
      codigo: 0,
      argv: ['pausar'],
      saida: '',
      erro: '',
    })
    await waitFor(() => {
      expect(screen.getByTestId('fabrica-pausar')).toHaveProperty('disabled', false)
    })
    fireEvent.click(screen.getByTestId('fabrica-pausar'))
    await waitFor(() => {
      expect(screen.queryByTestId('fabrica-comando-erro')).toBeNull()
    })
  })

  it('uma rejeição do canal vira a linha de erro com a mensagem', async () => {
    comandoFabrica.mockRejectedValueOnce(new Error('canal fora'))

    render(<Fabrica />)

    await screen.findByTestId('fabrica-cabecalho')
    await screen.findByTestId('fabrica-aberto')
    fireEvent.click(screen.getByTestId('fabrica-pausar'))
    expect((await screen.findByTestId('fabrica-comando-erro')).textContent).toBe('canal fora')
  })

  it('sem retrato o botão fica desabilitado e o crachá diz que lê', async () => {
    readFabrica.mockReturnValue(new Promise(() => {}))
    render(<Fabrica />)
    await screen.findByTestId('fabrica-cabecalho')
    expect(screen.getByTestId('fabrica-pausar')).toHaveProperty('disabled', true)
    expect(screen.getByTestId('fabrica-estado').textContent).toBe('Lendo a fábrica…')
    expect(screen.queryByTestId('fabrica-projeto')).toBeNull()
  })
})

describe('Fabrica · fila acionável (F3)', () => {
  const comItens = (
    extra: Partial<Extract<SalaDaFabrica, { kind: 'ok' }>>,
  ): Extract<SalaDaFabrica, { kind: 'ok' }> => ({
    ...(retrato() as Extract<SalaDaFabrica, { kind: 'ok' }>),
    ...extra,
  })

  it('um item de tipo decisao na Sala leva à Decisão, com a trilha de três partes', async () => {
    const decisao: ItemNaSala = {
      ...aberto,
      id: 'q-0002',
      tipo: 'decisao',
      card: 902,
      motivo: 'PR #970 aberta na dev (Card: #902); o merge é da orquestradora',
      comando: '/gm-ship 902',
      estacao: 'revisao',
    }
    readFabrica.mockResolvedValue(comItens({ abertos: [decisao] }))
    readFabricaPergunta.mockResolvedValue({
      ...pergunta,
      item: decisao,
      fim: 'parada',
      pr: 970,
      prUrl: 'https://github.com/leonardo-amaral-3/operations-center/pull/970',
    })

    render(<Fabrica />)

    await screen.findByTestId('fabrica-cabecalho')
    fireEvent.click(await screen.findByTestId('fabrica-aberto'))

    expect(telaAtual()).toBe('decisao')
    expect(screen.getByTestId('fabrica-trilha').textContent).toBe(
      'Sala de controle/Esperando você/Revisão · G4',
    )
    expect(await screen.findByTestId('fabrica-decisao')).toBeTruthy()
  })

  it('um fechar recusado mostra a linha de erro e a tela relê o item, já fechado', async () => {
    const recusa = 'fabrica: o item q-0001 já foi fechado'
    comandoFabrica.mockResolvedValue({
      ok: false,
      codigo: 1,
      argv: ['fechar', 'q-0001', 'x'],
      saida: '',
      erro: recusa,
    })

    render(<Fabrica />)

    await screen.findByTestId('fabrica-cabecalho')
    fireEvent.click(await screen.findByTestId('fabrica-aberto'))
    fireEvent.change(await screen.findByTestId('fabrica-resposta'), { target: { value: 'x' } })
    expect(readFabricaPergunta).toHaveBeenCalledTimes(1)

    // Quem fechou foi outro (a CLI, na mão): o retrato seguinte já traz o item em `fechados`.
    const fechado: ItemNaSala = {
      ...aberto,
      fechadoEm: '2026-11-11T12:05:00.000Z',
      resolucao: 'resolvido por fora',
    }
    readFabrica.mockResolvedValue(comItens({ abertos: [], fechados: [fechado] }))
    readFabricaPergunta.mockResolvedValue({ ...pergunta, item: fechado })
    fireEvent.click(screen.getByTestId('fabrica-responder-fechar'))

    expect((await screen.findByTestId('fabrica-comando-erro')).textContent).toBe(recusa)
    expect(comandoFabrica).toHaveBeenCalledWith({
      board: 'leonardo-amaral-3/2',
      comando: { tipo: 'fechar', item: 'q-0001', resolucao: 'x' },
    })
    await waitFor(() => {
      expect(readFabricaPergunta).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.getByTestId('fabrica-chip-posicao').textContent).toBe('fechado')
    })
  })
})

/** O board da aba na raiz (#157): a fábrica pede o board da aba, e só então a Sala. */
describe('Fabrica · o board da aba (#157)', () => {
  const retratoDeBoards = (activeKey: string | null, chaves: string[]): BoardsSnapshot => ({
    boards: chaves.map((key) => ({
      key,
      title: `T ${key}`,
      board: null,
      readAt: null,
      error: null,
    })),
    activeKey,
    discoveryError: null,
  })

  const ouvintes = new Set<(s: BoardsSnapshot) => void>()
  const empurrar = (s: BoardsSnapshot): void => {
    for (const cb of ouvintes) cb(s)
  }
  const readFabricaBoard = vi.fn(readFabricaBoardDeTeste)
  const canais = {
    readFabricaEntrada: vi.fn(),
    readFabricaCard: vi.fn(),
    readFabricaRevisoes: vi.fn(),
    readFabricaMandato: vi.fn(),
  }

  function ponte(readBoards: () => Promise<BoardsSnapshot>, board = readFabricaBoard): void {
    ouvintes.clear()
    readFabricaBoard.mockClear()
    Object.defineProperty(window, 'oc', {
      value: {
        ...window.oc,
        readBoards,
        readFabricaBoard: board,
        ...canais,
        onBoards: (cb: (s: BoardsSnapshot) => void) => {
          ouvintes.add(cb)
          return () => {
            ouvintes.delete(cb)
          }
        },
      },
      configurable: true,
    })
  }

  it('espera o retrato dos boards: até lá nenhum readFabricaBoard nem readFabrica', async () => {
    let liberar: (s: BoardsSnapshot) => void = () => undefined
    ponte(() => new Promise((r) => (liberar = r)))
    render(<Fabrica />)

    expect((await screen.findByTestId('fabrica-lendo')).textContent).toBe(
      'Lendo o estado da fábrica…',
    )
    expect(readFabricaBoard).not.toHaveBeenCalled()
    expect(readFabrica).not.toHaveBeenCalled()

    liberar(retratoDeBoards('ICSF-Solutions/19', ['ICSF-Solutions/19']))
    await screen.findByTestId('fabrica-recusa')
    expect(readFabrica).not.toHaveBeenCalled()
  })

  it('sem aba, o readFabricaBoard recebe board null', async () => {
    ponte(() => Promise.resolve(retratoDeBoards(null, [])))
    render(<Fabrica />)

    await screen.findByTestId('fabrica-cabecalho')
    expect(readFabricaBoard).toHaveBeenCalledExactlyOnceWith({ board: null })
    await waitFor(() => {
      expect(readFabrica).toHaveBeenCalledWith({ board: 'leonardo-amaral-3/2' })
    })
  })

  it('a aba fulano/8: readFabrica e o Pausar levam a chave dela', async () => {
    ponte(() => Promise.resolve(retratoDeBoards('fulano/8', ['fulano/8'])))
    render(<Fabrica />)

    await screen.findByTestId('fabrica-cabecalho')
    await waitFor(() => {
      expect(readFabrica).toHaveBeenCalledWith({ board: 'fulano/8' })
    })
    comandoFabrica.mockResolvedValue({ ok: true, codigo: 0, argv: [], saida: '', erro: '' })
    fireEvent.click(await screen.findByTestId('fabrica-pausar'))
    expect(comandoFabrica).toHaveBeenCalledWith({
      board: 'fulano/8',
      comando: { tipo: 'pausar' },
    })
  })

  it('o retrato empurrado com outra aba servida remonta a Sala e volta à tela sala', async () => {
    ponte(() => Promise.resolve(retratoDeBoards('leonardo-amaral-3/2', ['leonardo-amaral-3/2'])))
    render(<Fabrica />)

    fireEvent.click(await screen.findByTestId('fabrica-nav-agentes'))
    expect(telaAtual()).toBe('agentes')
    readFabrica.mockClear()

    act(() => {
      empurrar(retratoDeBoards('fulano/8', ['leonardo-amaral-3/2', 'fulano/8']))
    })
    await waitFor(() => {
      expect(readFabrica).toHaveBeenCalledWith({ board: 'fulano/8' })
    })
    expect(readFabrica).not.toHaveBeenCalledWith({ board: 'leonardo-amaral-3/2' })
    await waitFor(() => {
      expect(telaAtual()).toBe('sala')
    })
  })

  it.each([
    [
      'ICSF-Solutions/19',
      'o board ICSF-Solutions/19 não está configurado em fabrica/boards.json: falta a entrada dele (repo, workspace, pasta de estado e mandato)',
    ],
    [
      'sem/mandato',
      'o board sem/mandato (Sem Mandato) não tem mandato aprovado: falta o campo mandato em fabrica/boards.json',
    ],
  ])('a aba %s recusada: o motivo, nenhum botão e nenhum canal de pasta', async (chave, motivo) => {
    ponte(
      () => Promise.resolve(retratoDeBoards(chave, [chave])),
      vi.fn(() => Promise.resolve({ kind: 'recusado' as const, chave, motivo })),
    )
    render(<Fabrica />)

    const recusa = await screen.findByTestId('fabrica-recusa')
    expect(recusa.textContent).toContain(motivo)
    expect(recusa.dataset.board).toBe(chave)
    expect(within(screen.getByTestId('fabrica-sala')).queryAllByRole('button')).toEqual([])
    expect(readFabrica).not.toHaveBeenCalled()
    expect(readFabricaPergunta).not.toHaveBeenCalled()
    expect(comandoFabrica).not.toHaveBeenCalled()
    for (const canal of Object.values(canais)) expect(canal).not.toHaveBeenCalled()
  })

  it('readFabricaBoard que rejeita mostra a mensagem do erro em fabrica-recusa', async () => {
    ponte(
      () => Promise.resolve(retratoDeBoards('fulano/8', ['fulano/8'])),
      vi.fn(() => Promise.reject(new Error('ponte caiu'))),
    )
    render(<Fabrica />)

    expect((await screen.findByTestId('fabrica-recusa')).textContent).toContain('ponte caiu')
  })

  it('a navegação: oito botões com o Project 2; sem Relatório, Portfólio e Release com outro board', async () => {
    ponte(() => Promise.resolve(retratoDeBoards(null, [])))
    const { unmount } = render(<Fabrica />)
    await screen.findByTestId('fabrica-nav')
    expect(screen.getByTestId('fabrica-nav').querySelectorAll('button')).toHaveLength(8)
    unmount()

    ponte(
      () => Promise.resolve(retratoDeBoards('fulano/8', ['fulano/8'])),
      vi.fn(() => Promise.resolve(BOARD_DE_DOIS_REPOS)),
    )
    render(<Fabrica />)
    await screen.findByTestId('fabrica-nav')
    expect(screen.getByTestId('fabrica-nav').querySelectorAll('button')).toHaveLength(5)
    for (const t of ['relatorio', 'portfolio', 'release']) {
      expect(screen.queryByTestId(`fabrica-nav-${t}`)).toBeNull()
    }
  })
})
