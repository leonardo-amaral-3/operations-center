// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAVE_DO_BOARD_DA_FABRICA } from '../../src/renderer/fabrica/boardDaFabrica'
import type { PropsDaTela } from '../../src/renderer/fabrica/telas'
import { Briefing } from '../../src/renderer/fabrica/telas/Briefing'
import type { BoardCard, BoardsSnapshot } from '../../src/shared/board'
import type {
  CardNaFabrica,
  ComandoDaFabrica,
  DespachoNaSala,
  SalaDaFabrica,
} from '../../src/shared/fabrica'
import { RETRATO_F2 } from './retrato-f2'
import { CARD_4_EM_VOO } from './retrato-f4'

/** A tela Briefing da F6 (#135, CA-6.1/6.2). A ponte e o comando são falsos; nada é solto de verdade. */

const REPO = 'leonardo-amaral-3/operations-center'
const COLUNAS = [
  { id: 'c-tri', name: '📥 Triagem', conversable: true, triage: true },
  { id: 'c-bac', name: '📋 Backlog', conversable: true, triage: false },
  { id: 'c-esp', name: '🎯 Especificação', conversable: true, triage: false },
]

function card(n: number, columnId: string): BoardCard {
  return {
    itemId: `PVTI_${n}`,
    number: n,
    title: `Título ${n}`,
    url: `https://github.com/${REPO}/issues/${n}`,
    repository: REPO,
    closed: false,
    assignees: [],
    columnId,
    fields: [],
    parent: null,
    phases: [],
  }
}

function boards(cards: BoardCard[]): BoardsSnapshot {
  return {
    boards: [
      {
        key: CHAVE_DO_BOARD_DA_FABRICA,
        title: 'OC',
        readAt: 1,
        error: null,
        board: { title: 'OC', columns: COLUNAS, cards },
      },
    ],
    activeKey: CHAVE_DO_BOARD_DA_FABRICA,
    discoveryError: null,
  }
}

// Backlog: #940 e #941; Triagem: #950; Especificação (fora): #960.
const BOARD = boards([
  card(960, 'c-esp'),
  card(950, 'c-tri'),
  card(940, 'c-bac'),
  card(941, 'c-bac'),
])

function despacho(id: string, n: number): DespachoNaSala {
  return {
    id,
    card: n,
    cardUrl: `https://github.com/${REPO}/issues/${n}`,
    comando: `/gm-spec #${n}`,
    estacao: 'spec',
    estado: 'pendente',
    criadoEm: '2026-11-11T12:00:00.000Z',
    lancadoEm: null,
    ondeRoda: 'worktree ainda não criada',
    viva: null,
  }
}

function sala(emVoo: DespachoNaSala[], extra: Partial<SalaDaFabrica> = {}): SalaDaFabrica {
  return { ...RETRATO_F2, emVoo, ...extra } as SalaDaFabrica
}

const readBoards = vi.fn<() => Promise<BoardsSnapshot>>()
const readFabrica = vi.fn<() => Promise<SalaDaFabrica>>()
const readFabricaCard = vi.fn<(r: { card: number }) => Promise<CardNaFabrica>>()

beforeEach(() => {
  readBoards.mockReset().mockResolvedValue(BOARD)
  readFabrica.mockReset().mockResolvedValue(sala([]))
  readFabricaCard.mockReset().mockResolvedValue(CARD_4_EM_VOO)
  Object.defineProperty(window, 'oc', {
    value: { readBoards, onBoards: () => () => {}, readFabrica, readFabricaCard },
    configurable: true,
  })
})
afterEach(cleanup)

function props(extra: Partial<PropsDaTela> = {}): PropsDaTela {
  return {
    tela: { tela: 'briefing' },
    sala: sala([]),
    ir: vi.fn(),
    comando: () => Promise.resolve(),
    emVoo: false,
    ...extra,
  }
}

async function abrir(extra: Partial<PropsDaTela> = {}) {
  const p = props(extra)
  render(<Briefing {...p} />)
  await screen.findAllByTestId('fabrica-briefing-frente')
  return p
}

const soltar = () => screen.getByTestId<HTMLButtonElement>('fabrica-briefing-soltar')
const frente = (n: number) =>
  screen
    .getAllByTestId('fabrica-briefing-frente')
    .find((f) => f.getAttribute('data-card') === `${n}`)!
const marcar = (n: number) =>
  fireEvent.click(within(frente(n)).getByTestId('fabrica-briefing-entra'))

describe('Briefing · as frentes (CA-6.1)', () => {
  it('mostra o cabeçalho, o modo do dia e uma frente por card do Backlog e da Triagem', async () => {
    await abrir()
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('Briefing')
    expect(screen.getByRole('heading', { name: 'O que a fábrica toca hoje sem você' })).toBeTruthy()
    const junto = screen.getByTestId<HTMLButtonElement>('fabrica-briefing-modo-junto')
    expect(junto.disabled).toBe(true)
    expect(junto.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('fabrica-briefing-modo-auto').getAttribute('aria-pressed')).toBe(
      'true',
    )
    const frentes = screen.getAllByTestId('fabrica-briefing-frente')
    expect(frentes.map((f) => f.getAttribute('data-card'))).toEqual(['940', '941', '950'])
    expect(within(frente(940)).getByTestId('fabrica-briefing-chip').textContent).toBe(
      '📋 Backlog · /gm-spec #940',
    )
    expect(within(frente(950)).getByTestId('fabrica-briefing-chip').textContent).toBe(
      '📥 Triagem · /gm-card #950',
    )
    expect(within(frente(940)).getByDisplayValue('3 ao mesmo tempo · 20 por frente')).toBeTruthy()
    expect(screen.queryByText(/objetivo:/)).toBeNull()
  })

  it('as frentes ficam dentro da lista com teto de 1040 px (#149)', async () => {
    await abrir()
    const lista = document.querySelector('[data-lista="briefing-frentes"]')
    expect(lista).not.toBeNull()
    expect(lista!.getAttribute('data-teto')).toBe('1040')
    const frentes = screen.getAllByTestId('fabrica-briefing-frente')
    expect(frentes).toHaveLength(3)
    for (const f of frentes) expect(lista!.contains(f)).toBe(true)
  })

  it('o botão Soltar só habilita com frente marcada', async () => {
    await abrir()
    expect(soltar().disabled).toBe(true)
    marcar(940)
    expect(soltar().disabled).toBe(false)
    marcar(940)
    expect(soltar().disabled).toBe(true)
  })

  it('sem sala ou com emVoo o botão fica desabilitado', async () => {
    await abrir({ sala: null })
    marcar(940)
    expect(soltar().disabled).toBe(true)
    cleanup()
    await abrir({ emVoo: true })
    marcar(940)
    expect(soltar().disabled).toBe(true)
  })

  it('card já em voo vira "já em voo", sem caixa e com Ver', async () => {
    const em = sala([despacho('d-0001', 941)])
    const p = await abrir({ sala: em })
    const f = frente(941)
    expect(f.getAttribute('data-estado')).toBe('em-voo')
    expect(within(f).queryByTestId('fabrica-briefing-entra')).toBeNull()
    expect(within(f).getByText('já em voo')).toBeTruthy()
    fireEvent.click(within(f).getByTestId('fabrica-briefing-ver'))
    expect(p.ir).toHaveBeenCalledWith({ tela: 'card', card: 941 })
  })

  it('card com item aberto na fila: avisa na frente, e ela segue marcável (G4 da PR #141, menor 3)', async () => {
    const aberto = { ...RETRATO_F2.abertos[0]!, id: 'q-0031', card: 941 }
    await abrir({ sala: sala([], { abertos: [aberto] }) })
    expect(within(frente(941)).getByTestId('fabrica-briefing-aberto').textContent).toBe(
      'item aberto na fila',
    )
    expect(within(frente(941)).getByTestId('fabrica-briefing-aberto-aviso').textContent).toBe(
      'O #941 tem o item q-0031 aberto na fila: um despacho dele parou e espera resposta. Soltar abre uma frente nova sem fechar o item; se é a mesma frente, responda na Fila antes.',
    )
    expect(within(frente(941)).queryByTestId('fabrica-briefing-entra')).not.toBeNull()
    expect(within(frente(940)).queryByTestId('fabrica-briefing-aberto')).toBeNull()
    expect(within(frente(940)).queryByTestId('fabrica-briefing-aberto-aviso')).toBeNull()
  })

  it('a nota passa do limite: avisa e desabilita', async () => {
    await abrir()
    marcar(940)
    fireEvent.change(screen.getByTestId('fabrica-briefing-contexto'), {
      target: { value: 'x'.repeat(1001) },
    })
    expect(soltar().disabled).toBe(true)
    expect(screen.getByText(/A nota do #940 passa de 1000 caracteres\./)).toBeTruthy()
  })

  it('board lendo, com erro e vazio', async () => {
    readBoards.mockReturnValue(new Promise(() => {}))
    render(<Briefing {...props()} />)
    expect(screen.getByText('Lendo o board…')).toBeTruthy()
    cleanup()
    readBoards.mockRejectedValue(new Error('sem rede'))
    render(<Briefing {...props()} />)
    expect((await screen.findByTestId('fabrica-briefing-erro')).textContent).toBe(
      'Sem leitura do board do Operations Center: sem rede',
    )
    cleanup()
    readBoards.mockResolvedValue(boards([card(960, 'c-esp')]))
    render(<Briefing {...props()} />)
    expect((await screen.findByTestId('fabrica-briefing-vazio')).textContent).toContain(
      'Nenhum card no 📋 Backlog nem na 📥 Triagem',
    )
  })

  it('o aviso do despachante segue a precedência da spec', async () => {
    await abrir({ sala: sala([], { despachante: 'parado' }) })
    expect(screen.getByTestId('fabrica-briefing-despachante').textContent).toContain(
      'O despachante não está rodando',
    )
    cleanup()
    await abrir({ sala: sala([], { despachante: 'parado', pausa: { desde: null } }) })
    expect(screen.getByTestId('fabrica-briefing-despachante').textContent).toContain('está pausada')
    cleanup()
    await abrir({ sala: sala([], { despachante: 'desconhecido' }) })
    expect(screen.getByTestId('fabrica-briefing-despachante').textContent).toContain(
      'Não deu para saber',
    )
    cleanup()
    await abrir({ sala: sala([]) })
    expect(screen.queryByTestId('fabrica-briefing-despachante')).toBeNull()
  })
})

describe('Briefing · Soltar o dia (CA-6.2)', () => {
  /** Uma sala que ganha o despacho do card quando o `comando` roda, para os cards em `abrem`. */
  function ligar(abrem: number[]) {
    let ativo: DespachoNaSala[] = []
    readFabrica.mockImplementation(() => Promise.resolve(sala(ativo)))
    const comando = vi.fn((c: ComandoDaFabrica) => {
      if (c.tipo === 'iniciar' && abrem.includes(c.card)) {
        ativo = [...ativo, despacho(`d-${c.card}`, c.card)]
      }
      return Promise.resolve()
    })
    return comando
  }

  it('solta na ordem da tela: lê antes e depois, e só "aberta" com id novo', async () => {
    const comando = ligar([940, 950])
    await abrir({ comando })
    marcar(950)
    marcar(940)
    fireEvent.change(within(frente(940)).getByTestId('fabrica-briefing-pronto'), {
      target: { value: 'spec aprovada.' },
    })
    fireEvent.change(screen.getByTestId('fabrica-briefing-contexto'), {
      target: { value: 'prazo da secretaria' },
    })
    fireEvent.click(soltar())
    await waitFor(() => expect(screen.getAllByTestId('fabrica-briefing-resultado')).toHaveLength(2))
    expect(comando.mock.calls.map(([c]) => (c as { card: number }).card)).toEqual([940, 950])
    const primeira = comando.mock.calls[0]![0] as Extract<ComandoDaFabrica, { tipo: 'iniciar' }>
    expect(primeira.repo).toBe('leonardo-amaral-3/operations-center')
    expect(primeira.nota).toMatch(
      /^Briefing do dia \d\d\/\d\d: pronto quando spec aprovada\. Contexto do dia: prazo da secretaria\.$/,
    )
    expect(
      screen
        .getAllByTestId('fabrica-briefing-resultado')
        .map((r) => r.getAttribute('data-resultado')),
    ).toEqual(['aberta', 'aberta'])
    // as abertas saem das marcadas
    expect(soltar().disabled).toBe(true)
  })

  it('"nao-abriu" para o dia e marca as seguintes como "nao-solta"', async () => {
    const comando = ligar([])
    await abrir({ comando })
    marcar(940)
    marcar(941)
    marcar(950)
    fireEvent.click(soltar())
    await waitFor(() => expect(screen.getAllByTestId('fabrica-briefing-resultado')).toHaveLength(3))
    expect(comando).toHaveBeenCalledTimes(1)
    expect(
      screen
        .getAllByTestId('fabrica-briefing-resultado')
        .map((r) => r.getAttribute('data-resultado')),
    ).toEqual(['nao-abriu', 'nao-solta', 'nao-solta'])
    // o card que não abriu continua marcado
    expect(
      within(frente(940)).getByTestId<HTMLInputElement>('fabrica-briefing-entra').checked,
    ).toBe(true)
  })

  it('card que já estava em voo na leitura de antes não é solto de novo', async () => {
    readFabrica.mockResolvedValue(sala([despacho('d-9', 940)]))
    const comando = vi.fn(() => Promise.resolve())
    await abrir({ comando })
    marcar(940)
    fireEvent.click(soltar())
    const r = await screen.findByTestId('fabrica-briefing-resultado')
    expect(r.getAttribute('data-resultado')).toBe('ja-em-voo')
    expect(comando).not.toHaveBeenCalled()
  })

  it('leitura que falha antes de soltar: "sem-leitura", nada roda e o resto não é solto', async () => {
    readFabrica.mockRejectedValue(new Error('x'))
    const comando = vi.fn(() => Promise.resolve())
    await abrir({ comando })
    marcar(940)
    marcar(941)
    fireEvent.click(soltar())
    await waitFor(() => expect(screen.getAllByTestId('fabrica-briefing-resultado')).toHaveLength(2))
    expect(comando).not.toHaveBeenCalled()
    expect(
      screen
        .getAllByTestId('fabrica-briefing-resultado')
        .map((r) => r.getAttribute('data-resultado')),
    ).toEqual(['sem-leitura', 'nao-solta'])
  })

  it('leitura que falha depois do comando: "sem-leitura" e para', async () => {
    readFabrica.mockResolvedValueOnce(sala([]))
    readFabrica.mockResolvedValue({
      ...RETRATO_F2,
      kind: 'ilegivel',
      erro: 'torto',
    })
    const comando = vi.fn(() => Promise.resolve())
    await abrir({ comando })
    marcar(940)
    marcar(941)
    fireEvent.click(soltar())
    await waitFor(() => expect(screen.getAllByTestId('fabrica-briefing-resultado')).toHaveLength(2))
    expect(comando).toHaveBeenCalledTimes(1)
    expect(
      screen
        .getAllByTestId('fabrica-briefing-resultado')
        .map((r) => r.getAttribute('data-resultado')),
    ).toEqual(['sem-leitura', 'nao-solta'])
  })

  it('a tela fechada no meio do Soltar para o laço: nenhuma frente é solta depois (G4 da PR #141, menor 2)', async () => {
    let ativo: DespachoNaSala[] = []
    readFabrica.mockImplementation(() => Promise.resolve(sala(ativo)))
    let liberar: () => void = () => {}
    const comando = vi.fn(
      (c: ComandoDaFabrica) =>
        new Promise<void>((resolve) => {
          if (c.tipo === 'iniciar') ativo = [...ativo, despacho(`d-${c.card}`, c.card)]
          liberar = resolve
        }),
    )
    const p = props({ comando })
    const { unmount } = render(<Briefing {...p} />)
    await screen.findAllByTestId('fabrica-briefing-frente')
    marcar(940)
    marcar(941)
    marcar(950)
    fireEvent.click(soltar())
    await waitFor(() => expect(comando).toHaveBeenCalledTimes(1))
    unmount()
    liberar()
    await new Promise((r) => setTimeout(r, 30))
    expect(comando).toHaveBeenCalledTimes(1)
  })

  it('sem estado.json a leitura é lista vazia, e o comando roda', async () => {
    readFabrica.mockResolvedValue({ ...RETRATO_F2, kind: 'sem-estado' })
    const comando = vi.fn(() => Promise.resolve())
    await abrir({ comando })
    marcar(940)
    fireEvent.click(soltar())
    const r = await screen.findByTestId('fabrica-briefing-resultado')
    expect(comando).toHaveBeenCalledTimes(1)
    expect(r.getAttribute('data-resultado')).toBe('nao-abriu')
  })
})

describe('Briefing · plano devolvido', () => {
  it('lista os despachos do card em voo, do mais velho ao mais novo', async () => {
    const em = sala([despacho('d-0006', 4)])
    await abrir({ sala: em })
    const passos = await screen.findAllByTestId('fabrica-briefing-passo')
    expect(readFabricaCard).toHaveBeenCalledWith({ card: 4 })
    expect(passos.length).toBe(4)
    expect(passos.at(-1)!.textContent).toContain(CARD_4_EM_VOO.atual.comando)
  })

  it('leitura que falha vira "sem leitura dos despachos"', async () => {
    readFabricaCard.mockRejectedValue(new Error('x'))
    await abrir({ sala: sala([despacho('d-0006', 4)]) })
    expect(await screen.findByText('sem leitura dos despachos do #4: x')).toBeTruthy()
  })

  it('mostra no máximo três e conta o resto', async () => {
    const em = sala([1, 2, 3, 4, 5].map((n) => despacho(`d-${n}`, n)))
    await abrir({ sala: em })
    expect(screen.getByText('e mais 2 em voo na Sala')).toBeTruthy()
    await waitFor(() => expect(readFabricaCard).toHaveBeenCalledTimes(3))
  })

  it('sem nada em voo: vazio; sem sala: lendo; ilegível: erro', async () => {
    await abrir()
    expect(screen.getByTestId('fabrica-briefing-sem-plano').textContent).toBe(
      'Nada em voo: o plano aparece aqui quando uma frente começa.',
    )
    cleanup()
    await abrir({ sala: null })
    expect(screen.getByText('Lendo a fábrica…')).toBeTruthy()
    cleanup()
    await abrir({ sala: { ...RETRATO_F2, kind: 'ilegivel', erro: 'torto' } as SalaDaFabrica })
    expect(screen.getByText('Sem leitura do estado da fábrica: torto')).toBeTruthy()
  })

  it('usa os textos trocados do protótipo e não inventa os que a fábrica não faz', async () => {
    await abrir()
    const texto = document.body.textContent ?? ''
    expect(texto).toContain('A fábrica não escreve plano')
    expect(texto).toContain('Vai na nota de cada frente, numa linha só. O Slack fica fora do app.')
    expect(texto).toContain('não precisa aprovar')
    expect(texto).not.toMatch(/\[proj\.\]|\[horas\]|\[n\]|allowlist|O que pode alargar/)
  })
})

describe('Briefing · a frente abre o Card em qualquer ponto (#145, CA-2)', () => {
  it('clicar na frente leva ao Card', async () => {
    const p = await abrir()
    const f = frente(941)
    fireEvent.click(f)
    expect(p.ir).toHaveBeenCalledWith({ tela: 'card', card: 941 })
  })

  it('checkbox, rótulo e campo Pronto quando não abrem o Card', async () => {
    const p = await abrir()
    const f = frente(941)
    const caixa = within(f).getByTestId<HTMLInputElement>('fabrica-briefing-entra')
    fireEvent.click(caixa)
    expect(caixa.checked).toBe(true)
    fireEvent.click(within(f).getByText('Entra no dia', { exact: false }))
    fireEvent.click(within(f).getByTestId('fabrica-briefing-pronto'))
    expect(p.ir).not.toHaveBeenCalled()
  })
})
