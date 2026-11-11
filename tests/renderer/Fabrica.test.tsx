// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Fabrica } from '../../src/renderer/fabrica/Fabrica'
import type {
  ComandoDaFabrica,
  ItemNaSala,
  PerguntaDaFila,
  ResultadoDoComando,
  SalaDaFabrica,
} from '../../src/shared/fabrica'

/**
 * A raiz da fábrica no app (#130, CA-1.1 e CA-1.2 do lado da tela): abre na Sala com o cabeçalho do
 * protótipo, cada botão leva à sua tela, a trilha volta, e o item da fila e o despacho em voo levam
 * a Pergunta e ao Card. A ponte é falsa: o main nem entra.
 */

const aberto: ItemNaSala = {
  id: 'q-0001',
  tipo: 'pergunta',
  card: 901,
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
    await screen.findByTestId('fabrica-aberto')

    fireEvent.click(screen.getByTestId(`fabrica-nav-${tela}`))
    expect(telaAtual()).toBe(tela)

    const trilha = screen.getByTestId('fabrica-trilha')

    expect(trilha.textContent).toContain('Sala de controle')
    expect(trilha.textContent).toContain(ultimo)

    fireEvent.click(screen.getByTestId('fabrica-trilha-0'))
    expect(telaAtual()).toBe('sala')
  })

  it('as telas sem corpo mostram o marcador da fase', () => {
    render(<Fabrica />)
    fireEvent.click(screen.getByTestId('fabrica-nav-briefing'))
    expect(screen.getByTestId('fabrica-por-vir').textContent).toBe(
      'Esta tela chega na F6 do épico #129.',
    )
    // O botão Pausar também fica no cabeçalho de Agentes.
    fireEvent.click(screen.getByTestId('fabrica-trilha-0'))
    fireEvent.click(screen.getByTestId('fabrica-nav-agentes'))
    expect(screen.getByTestId('fabrica-pausar')).toBeTruthy()
  })

  it('um item da fila leva à Pergunta, com a trilha de três partes', async () => {
    render(<Fabrica />)
    fireEvent.click(await screen.findByTestId('fabrica-aberto'))

    expect(telaAtual()).toBe('pergunta')
    expect(screen.getByTestId('fabrica-trilha').textContent).toBe(
      'Sala de controle/Esperando você/Pergunta',
    )
    expect((await screen.findByTestId('fabrica-pergunta')).textContent).toContain('Qual rota?')
    expect(screen.getByTestId('fabrica-pergunta-fechar').textContent).toBe(pergunta.fechar)

    fireEvent.click(screen.getByTestId('fabrica-trilha-1'))
    expect(telaAtual()).toBe('sala')
  })

  it('um despacho em voo leva ao Card, com o #<card> na trilha', async () => {
    render(<Fabrica />)
    fireEvent.click(await screen.findByTestId('fabrica-em-voo'))

    expect(telaAtual()).toBe('card')
    expect(screen.getByTestId('fabrica-trilha').textContent).toBe('Sala de controle/Linha/#903')
  })
})

describe('Fabrica · Pausar e Retomar (CA-1.2)', () => {
  it('pausa pelo canal, relê o retrato e vira Retomar; o botão só volta com o retrato novo', async () => {
    comandoFabrica.mockResolvedValue({ ok: true, codigo: 0, argv: ['pausar'], saida: '', erro: '' })

    render(<Fabrica />)
    await screen.findByTestId('fabrica-aberto')
    readFabrica.mockResolvedValue(retrato({ pausa: { desde: '2026-11-11T12:30:00.000Z' } }))

    fireEvent.click(screen.getByTestId('fabrica-pausar'))
    expect(comandoFabrica).toHaveBeenCalledExactlyOnceWith({ tipo: 'pausar' })
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
    expect(comandoFabrica).toHaveBeenLastCalledWith({ tipo: 'retomar' })
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
    await screen.findByTestId('fabrica-aberto')
    fireEvent.click(screen.getByTestId('fabrica-pausar'))
    expect((await screen.findByTestId('fabrica-comando-erro')).textContent).toBe('canal fora')
  })

  it('sem retrato o botão fica desabilitado e o crachá diz que lê', () => {
    readFabrica.mockReturnValue(new Promise(() => {}))
    render(<Fabrica />)
    expect(screen.getByTestId('fabrica-pausar')).toHaveProperty('disabled', true)
    expect(screen.getByTestId('fabrica-estado').textContent).toBe('Lendo a fábrica…')
    expect(screen.queryByTestId('fabrica-projeto')).toBeNull()
  })
})
