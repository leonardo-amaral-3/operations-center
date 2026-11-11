// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CardEmVoo } from '../../src/renderer/fabrica/telas/Card'
import type { PropsDaTela } from '../../src/renderer/fabrica/telas'
import type { ReadCardResult } from '../../src/shared/ipc'
import type { AssumirDespachoResult, CardNaFabrica, SalaDaFabrica } from '../../src/shared/fabrica'
import { RETRATO_F2 } from './retrato-f2'
import {
  BOARDS_F4,
  CARD_4_EM_VOO,
  CARD_906_PARADO,
  CONTEUDO_DO_4,
  CORPO_TASKS_4,
} from './retrato-f4'

/** A tela Card da F4 (#133, CA-4.1/4.2/4.4) sobre os literais do "esperado F4". A ponte é falsa. */

const readFabricaCard = vi.fn<(p: { card: number }) => Promise<CardNaFabrica>>()
const readCard = vi.fn<(p: { itemId: string }) => Promise<ReadCardResult>>()
const assumirDespacho =
  vi.fn<(p: { despacho: string; itemId: string }) => Promise<AssumirDespachoResult>>()

function instalar(extra: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'oc', {
    value: {
      readFabricaCard,
      readCard,
      assumirDespacho,
      readBoards: () => Promise.resolve(BOARDS_F4),
      onBoards: () => () => {},
      ...extra,
    },
    configurable: true,
  })
}

beforeEach(() => {
  readFabricaCard
    .mockReset()
    .mockImplementation(({ card }) =>
      Promise.resolve<CardNaFabrica>(
        card === 906
          ? CARD_906_PARADO
          : card === 4
            ? CARD_4_EM_VOO
            : { kind: 'sem-despacho', card, cardUrl: '' },
      ),
    )
  readCard.mockReset().mockResolvedValue({ ok: true, content: CONTEUDO_DO_4 })
  assumirDespacho.mockReset().mockResolvedValue({ ok: true, anterior: null })
  instalar()
})

afterEach(cleanup)

const SALA: SalaDaFabrica = RETRATO_F2

function props(card: number, sala: SalaDaFabrica | null = SALA): PropsDaTela {
  return {
    tela: { tela: 'card', card },
    sala,
    ir: vi.fn(),
    comando: () => Promise.resolve(),
    emVoo: false,
  }
}

async function abrir(card = 4, sala: SalaDaFabrica | null = SALA) {
  const r = render(<CardEmVoo {...props(card, sala)} />)
  await screen.findByTestId('fabrica-card-sessao-titulo')
  return r
}

const PROIBIDO =
  /já existe|rascunho pronto|S1 · Hotfix|Nível A|ao vivo|Sonnet|até você devolver|não despacha nada neste card/i

describe('Card · o #4 em voo', () => {
  it('mostra a cabeça: Tipo, Rota, operations-center#4 e o título', async () => {
    await abrir()
    const cabeca = screen.getByTestId('fabrica-card-cabeca')
    expect(within(cabeca).getByText('✨ Melhoria')).toBeTruthy()
    expect(within(cabeca).getByText('Completa')).toBeTruthy()
    expect(within(cabeca).getByText('operations-center#4')).toBeTruthy()
    expect(within(cabeca).getByRole('heading', { level: 1 }).textContent).toBe(
      'Ler o board do GitHub e desenhar o kanban somente-leitura',
    )
  })

  it('tem nove estações com quatro feitas, a atual e quatro por vir', async () => {
    await abrir()
    const estados = screen.getAllByTestId('fabrica-estacao').map((e) => e.dataset.estado)
    expect(estados).toEqual([
      'feita',
      'feita',
      'feita',
      'feita',
      'atual',
      'por-vir',
      'por-vir',
      'por-vir',
      'por-vir',
    ])
  })

  it('lê as cinco tasks: a 1 feita, a 2 trabalhando com viva true', async () => {
    await abrir()
    await waitFor(() => expect(screen.getAllByTestId('fabrica-task')).toHaveLength(5))
    expect(screen.getAllByTestId('fabrica-task').map((t) => t.dataset.estado)).toEqual([
      'feita',
      'trabalhando',
      'na-fila',
      'na-fila',
      'na-fila',
    ])
  })

  it('com viva false a 2 espera na fila', async () => {
    readFabricaCard.mockResolvedValue({ ...CARD_4_EM_VOO, viva: false })
    await abrir()
    await waitFor(() => expect(screen.getAllByTestId('fabrica-task')).toHaveLength(5))
    expect(screen.getAllByTestId('fabrica-task')[1]?.dataset.estado).toBe('na-fila')
    expect(screen.getByTestId('fabrica-card-log').textContent).toContain('sem sessão viva')
  })

  it('lista as decisões com o passo e o fim, do mais novo ao mais velho', async () => {
    await abrir()
    const decisoes = screen.getAllByTestId('fabrica-card-decisao')
    expect(decisoes).toHaveLength(3)
    expect(decisoes.map((x) => x.textContent)).toEqual([
      expect.stringMatching(/^Task/),
      expect.stringMatching(/^G3/),
      expect.stringMatching(/^G2/),
    ])
    expect(decisoes[0]?.textContent).toContain('seguiu para /gm-implement')
  })

  it('mostra o título da sessão e as linhas do log do rodando', async () => {
    await abrir()
    expect(screen.getByTestId('fabrica-card-sessao-titulo').textContent).toBe(
      'Sessão do d-0005, rodando',
    )
    const log = screen.getByTestId('fabrica-card-log').textContent ?? ''
    expect(log).toContain('› /gm-implement')
    expect(log).toContain('o texto da sessão só chega quando ela termina')
    expect(log).toContain('● rodando…')
  })

  it('Assumir, Mandar e Parar ficam desabilitados, e a nota explica', async () => {
    await abrir()
    expect(screen.getByTestId('fabrica-card-assumir').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('fabrica-card-mensagem').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('fabrica-card-parar').hasAttribute('disabled')).toBe(true)
    const nota = screen.getByTestId('fabrica-card-nota').textContent ?? ''
    expect(nota).toContain('Assumir libera quando a sessão terminar')
    expect(nota).toContain('Mandar uma mensagem e Parar o turno precisam falar com a sessão')
  })

  it('o chip da suíte só aparece com a suíte ocupada pelo #4', async () => {
    const ocupada = (card: number | null): SalaDaFabrica => ({
      ...RETRATO_F2,
      recursos: { ...RETRATO_F2.recursos, suite: { kind: 'ocupada', card, esperando: 0 } },
    })
    const { unmount } = await abrir(4, ocupada(4))
    expect(screen.getByTestId('fabrica-card-suite').textContent).toBe('cadeado: suíte de smoke')
    unmount()
    const outra = await abrir(4, ocupada(906))
    expect(screen.queryByTestId('fabrica-card-suite')).toBeNull()
    outra.unmount()
    await abrir(4, SALA)
    expect(screen.queryByTestId('fabrica-card-suite')).toBeNull()
  })

  it('o chip de onde roda usa o texto cru fora de uma worktree', async () => {
    await abrir()
    expect(screen.getByTestId('fabrica-card-onde').textContent).toBe('worktree ainda não criada')
  })

  it('o texto da tela não casa o que o protótipo mentiria', async () => {
    const { container } = await abrir()
    await waitFor(() => expect(screen.getAllByTestId('fabrica-task')).toHaveLength(5))
    expect(container.textContent).not.toMatch(PROIBIDO)
  })
})

describe('Card · o #906 parado', () => {
  it('mostra o resultado, o fim e habilita Assumir', async () => {
    const { container } = await abrir(906)
    expect(screen.getByTestId('fabrica-card-sessao-titulo').textContent).toBe(
      'Sessão do d-0007, terminada',
    )
    expect(screen.getByTestId('fabrica-card-resultado').textContent).toContain('Portão local')
    expect(screen.getByTestId('fabrica-card-fim').textContent).toBe(
      '■ PARADA: PR #930 aberta na dev (Card: #906); o merge é da orquestradora',
    )
    expect(screen.getByTestId('fabrica-card-onde').textContent).toBe('sem worktree')
    expect(screen.getByText(/· fase do #905/)).toBeTruthy()
    expect(screen.getByTestId('fabrica-card-assumir').hasAttribute('disabled')).toBe(false)
    expect(screen.getByTestId('fabrica-card-nota').textContent).toContain(
      'Assumir abre o mesmo terminal',
    )
    expect(container.textContent).not.toMatch(PROIBIDO)
  })

  it('o clique chama assumirDespacho uma vez e mostra o aviso com a conversa anterior', async () => {
    assumirDespacho.mockResolvedValue({ ok: true, anterior: 'conversa-velha' })
    await abrir(906)
    fireEvent.click(screen.getByTestId('fabrica-card-assumir'))
    const aviso = await screen.findByTestId('fabrica-card-assumido')
    expect(assumirDespacho).toHaveBeenCalledTimes(1)
    expect(assumirDespacho).toHaveBeenCalledWith({ despacho: 'd-0007', itemId: 'PVTI_f4_906' })
    expect(aviso.textContent).toContain('A sessão abriu na janela do card.')
    expect(aviso.textContent).toContain('claude --resume conversa-velha')
  })

  it('a recusa vira o alerta com o motivo', async () => {
    assumirDespacho.mockResolvedValue({ ok: false, motivo: 'a sessão não está nesta máquina' })
    await abrir(906)
    fireEvent.click(screen.getByTestId('fabrica-card-assumir'))
    expect((await screen.findByTestId('fabrica-card-assumir-erro')).textContent).toBe(
      'a sessão não está nesta máquina',
    )
    expect(screen.queryByTestId('fabrica-card-assumido')).toBeNull()
  })

  it('uma exceção do assumirDespacho vira recusa', async () => {
    assumirDespacho.mockRejectedValue(new Error('ponte caiu'))
    await abrir(906)
    fireEvent.click(screen.getByTestId('fabrica-card-assumir'))
    expect((await screen.findByTestId('fabrica-card-assumir-erro')).textContent).toBe('ponte caiu')
  })

  it('sem sessão, Assumir fica desabilitado com a frase certa', async () => {
    readFabricaCard.mockResolvedValue({
      ...CARD_906_PARADO,
      atual: { ...CARD_906_PARADO.atual, sessao: null },
    })
    await abrir(906)
    expect(screen.getByTestId('fabrica-card-assumir').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('fabrica-card-nota').textContent).toContain(
      'terminou sem id de sessão',
    )
  })

  it('fora de um board aberto, Assumir fica desabilitado com a frase certa', async () => {
    instalar({ readBoards: () => Promise.resolve({ ...BOARDS_F4, boards: [] }) })
    await abrir(906)
    await waitFor(() =>
      expect(screen.getByTestId('fabrica-card-nota').textContent).toContain(
        'não está num board aberto',
      ),
    )
    expect(screen.getByTestId('fabrica-card-assumir').hasAttribute('disabled')).toBe(true)
  })
})

describe('Card · os Vazios das tasks', () => {
  const vazio = () => screen.getByTestId('fabrica-card-tasks-vazio').textContent

  it('card fora do board', async () => {
    instalar({ readBoards: () => Promise.resolve({ ...BOARDS_F4, boards: [] }) })
    await abrir()
    await waitFor(() => expect(vazio()).toContain('não está num board aberto no app'))
  })

  it('erro de leitura, por ok false e por exceção', async () => {
    readCard.mockResolvedValue({ ok: false, reason: 'sem rede' })
    const { unmount } = await abrir()
    await waitFor(() => expect(vazio()).toBe('Sem leitura do card: sem rede'))
    unmount()
    readCard.mockRejectedValue(new Error('caiu'))
    await abrir()
    await waitFor(() => expect(vazio()).toBe('Sem leitura do card: caiu'))
  })

  it('sem gm:tasks, com e sem truncado', async () => {
    readCard.mockResolvedValue({ ok: true, content: { ...CONTEUDO_DO_4, comments: [] } })
    const { unmount } = await abrir()
    await waitFor(() => expect(vazio()).toContain('ainda não tem tasks'))
    expect(vazio()).not.toContain('100 primeiros')
    unmount()
    readCard.mockResolvedValue({
      ok: true,
      content: { ...CONTEUDO_DO_4, comments: [], truncated: true },
    })
    await abrir()
    await waitFor(() => expect(vazio()).toContain('O app leu os 100 primeiros comentários.'))
  })

  it('gm:tasks sem linha de task', async () => {
    const [c] = CONTEUDO_DO_4.comments
    if (c === undefined) throw new Error('sem comentário')
    readCard.mockResolvedValue({
      ok: true,
      content: { ...CONTEUDO_DO_4, comments: [{ ...c, body: '<!-- gm:tasks -->\nnada' }] },
    })
    await abrir()
    await waitFor(() =>
      expect(vazio()).toBe('O comentário gm:tasks do card não tem linha de task.'),
    )
  })

  it('usa o último comentário gm:tasks', async () => {
    const [c] = CONTEUDO_DO_4.comments
    if (c === undefined) throw new Error('sem comentário')
    readCard.mockResolvedValue({
      ok: true,
      content: {
        ...CONTEUDO_DO_4,
        comments: [
          { ...c, body: '<!-- gm:tasks -->\n- [x] 1 — velha' },
          { ...c, id: 'outro', body: CORPO_TASKS_4 },
        ],
      },
    })
    await abrir()
    await waitFor(() => expect(screen.getAllByTestId('fabrica-task')).toHaveLength(5))
  })
})

describe('Card · os estados que não são ok', () => {
  it('sem-estado, sem-despacho e ilegivel terminam a tela', async () => {
    readFabricaCard.mockResolvedValue({ kind: 'sem-estado', card: 4, cardUrl: '' })
    const a = render(<CardEmVoo {...props(4)} />)
    expect((await screen.findByTestId('fabrica-card-sem-estado')).textContent).toContain(
      'não tem estado.json',
    )
    expect(screen.queryByTestId('fabrica-card-sessao-titulo')).toBeNull()
    a.unmount()

    readFabricaCard.mockResolvedValue({ kind: 'sem-despacho', card: 4, cardUrl: '' })
    const b = render(<CardEmVoo {...props(4)} />)
    expect((await screen.findByTestId('fabrica-card-sem-despacho')).textContent).toBe(
      'A fábrica não tem despacho do #4.',
    )
    b.unmount()

    readFabricaCard.mockResolvedValue({ kind: 'ilegivel', card: 4, cardUrl: '', erro: 'torto' })
    render(<CardEmVoo {...props(4)} />)
    expect((await screen.findByTestId('fabrica-card-erro')).textContent).toBe(
      'Não deu para ler o card na fábrica: torto',
    )
  })

  it('enquanto lê, mostra Lendo o card…', () => {
    readFabricaCard.mockReturnValue(new Promise(() => {}))
    render(<CardEmVoo {...props(4)} />)
    expect(screen.getByTestId('fabrica-card-lendo').textContent).toBe('Lendo o card…')
  })

  it('sem readFabricaCard no fake vira fabrica-card-erro, sem exceção solta', async () => {
    instalar({ readFabricaCard: undefined })
    render(<CardEmVoo {...props(4)} />)
    expect(await screen.findByTestId('fabrica-card-erro')).toBeTruthy()
  })
})

describe('Card · a borda lenta', () => {
  function adiavel() {
    let resolver: (c: CardNaFabrica) => void = () => {}
    const promessa = new Promise<CardNaFabrica>((r) => {
      resolver = r
    })
    return { promessa, resolver }
  }

  it('descarta a resposta mais velha, mesmo depois de o card mudar', async () => {
    const velha = adiavel()
    readFabricaCard
      .mockReset()
      .mockReturnValueOnce(velha.promessa)
      .mockResolvedValue(CARD_906_PARADO)
    const r = render(<CardEmVoo {...props(4)} />)
    r.rerender(<CardEmVoo {...props(906)} />)
    await screen.findByTestId('fabrica-card-sessao-titulo')
    expect(screen.getByTestId('fabrica-card-sessao-titulo').textContent).toBe(
      'Sessão do d-0007, terminada',
    )
    await act(async () => {
      velha.resolver(CARD_4_EM_VOO)
      await Promise.resolve()
    })
    expect(screen.getByTestId('fabrica-card-sessao-titulo').textContent).toBe(
      'Sessão do d-0007, terminada',
    )
  })

  it('descarta a resposta fora de ordem de um novo retrato do mesmo card', async () => {
    const lenta = adiavel()
    readFabricaCard
      .mockReset()
      .mockResolvedValueOnce(CARD_906_PARADO)
      .mockReturnValueOnce(lenta.promessa)
      .mockResolvedValue({ ...CARD_906_PARADO, resultado: 'o mais novo' })
    const r = render(<CardEmVoo {...props(906, { ...RETRATO_F2, lidoEm: 'a' })} />)
    await screen.findByTestId('fabrica-card-resultado')
    r.rerender(<CardEmVoo {...props(906, { ...RETRATO_F2, lidoEm: 'b' })} />)
    r.rerender(<CardEmVoo {...props(906, { ...RETRATO_F2, lidoEm: 'c' })} />)
    await waitFor(() =>
      expect(screen.getByTestId('fabrica-card-resultado').textContent).toBe('o mais novo'),
    )
    await act(async () => {
      lenta.resolver({ ...CARD_906_PARADO, resultado: 'velho demais' })
      await Promise.resolve()
    })
    expect(screen.getByTestId('fabrica-card-resultado').textContent).toBe('o mais novo')
  })

  it('a releitura por lidoEm mantém os dados na tela, sem piscar Lendo o card…', async () => {
    const lenta = adiavel()
    readFabricaCard
      .mockReset()
      .mockResolvedValueOnce(CARD_4_EM_VOO)
      .mockReturnValueOnce(lenta.promessa)
    const r = render(<CardEmVoo {...props(4, { ...RETRATO_F2, lidoEm: 'a' })} />)
    await screen.findByTestId('fabrica-card-sessao-titulo')
    r.rerender(<CardEmVoo {...props(4, { ...RETRATO_F2, lidoEm: 'b' })} />)
    expect(screen.queryByTestId('fabrica-card-lendo')).toBeNull()
    expect(screen.getByTestId('fabrica-card-sessao-titulo').textContent).toBe(
      'Sessão do d-0005, rodando',
    )
    await act(async () => {
      lenta.resolver(CARD_4_EM_VOO)
      await Promise.resolve()
    })
  })

  it('a releitura do retrato não relê o GitHub', async () => {
    const r = render(<CardEmVoo {...props(4, { ...RETRATO_F2, lidoEm: 'a' })} />)
    await waitFor(() => expect(screen.getAllByTestId('fabrica-task')).toHaveLength(5))
    r.rerender(<CardEmVoo {...props(4, { ...RETRATO_F2, lidoEm: 'b' })} />)
    await waitFor(() => expect(readFabricaCard).toHaveBeenCalledTimes(2))
    expect(readCard).toHaveBeenCalledTimes(1)
  })
})
