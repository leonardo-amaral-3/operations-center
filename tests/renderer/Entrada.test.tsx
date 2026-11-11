// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Entrada } from '../../src/renderer/fabrica/telas/Entrada'
import type { PropsDaTela } from '../../src/renderer/fabrica/telas'
import type { EntradaNaSala, ItemNaEntrada, SalaDaFabrica } from '../../src/shared/fabrica'
import { RETRATO_F2 } from './retrato-f2'

/** A tela Entrada da F4 (#133, CA-4.3/4.4). A ponte e o comando são falsos. */

const readFabricaEntrada = vi.fn<() => Promise<EntradaNaSala>>()

function instalar(): void {
  Object.defineProperty(window, 'oc', {
    value: { readFabricaEntrada },
    configurable: true,
  })
}

const ABERTO: ItemNaEntrada = {
  id: 'e-0003',
  texto: 'O gestor pediu um filtro por competência.',
  fonte: 'voce',
  criadoEm: '2026-11-11T12:00:00.000Z',
  triadoEm: null,
  resolucao: null,
  triagem: 'esperando',
  parou: null,
}
const TRIADO: ItemNaEntrada = {
  id: 'e-0002',
  texto: 'Erro ao exportar BPA.',
  fonte: 'voce',
  criadoEm: '2026-11-10T12:00:00.000Z',
  triadoEm: '2026-11-10T13:00:00.000Z',
  resolucao: 'virou o #906',
  triagem: null,
  parou: null,
}
const TRIADO_SEM_CARD: ItemNaEntrada = {
  id: 'e-0001',
  texto: 'Só uma ideia.',
  fonte: 'voce',
  criadoEm: '2026-11-09T12:00:00.000Z',
  triadoEm: '2026-11-09T13:00:00.000Z',
  resolucao: 'só a PR #930',
  triagem: null,
  parou: null,
}
const TRES: EntradaNaSala = { kind: 'ok', itens: [ABERTO, TRIADO, TRIADO_SEM_CARD], total: 3 }

beforeEach(() => {
  readFabricaEntrada.mockReset().mockResolvedValue(TRES)
  instalar()
})
afterEach(cleanup)

const SALA: SalaDaFabrica = RETRATO_F2

function props(extra: Partial<PropsDaTela> = {}): PropsDaTela {
  return {
    tela: { tela: 'entrada' },
    sala: SALA,
    ir: vi.fn(),
    comando: () => Promise.resolve(),
    emVoo: false,
    ...extra,
  }
}

async function abrir(extra: Partial<PropsDaTela> = {}) {
  const p = props(extra)
  const r = render(<Entrada {...p} />)
  await screen.findAllByTestId('fabrica-entrada-item')
  return { ...r, p }
}

const PROIBIDO =
  /já existe|rascunho pronto|S1 · Hotfix|Nível A|ao vivo|Sonnet|até você devolver|não despacha nada neste card/i

const digitar = (valor: string) =>
  fireEvent.change(screen.getByTestId('fabrica-entrada-texto'), { target: { value: valor } })
const mandar = () => screen.getByTestId<HTMLButtonElement>('fabrica-entrada-mandar')

describe('Entrada · a lista', () => {
  it('mostra a trilha, o chip, o título e as cinco fontes com Tudo marcada', async () => {
    await abrir()
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('Entrada')
    expect(screen.getByTestId('fabrica-entrada-aviso').textContent).toBe(
      'Grava pelo yarn fabrica entrada · quem cria o card é a /gm-triage',
    )
    expect(screen.getByRole('heading', { name: 'O que chegou' })).toBeTruthy()
    const grupo = screen.getByRole('group', { name: 'Fontes' })
    const botoes = within(grupo).getAllByRole('button')
    expect(botoes.map((b) => b.textContent)).toEqual(['Tudo', 'Slack', 'Suporte', 'Vigia', 'Você'])
    expect(botoes.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ])
  })

  it('lista os três itens na ordem, com os chips e o "Ver #906" só no triado que cita um card', async () => {
    const { p } = await abrir()
    const itens = screen.getAllByTestId('fabrica-entrada-item') as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]
    expect(itens.map((i) => i.getAttribute('data-id'))).toEqual(['e-0003', 'e-0002', 'e-0001'])
    expect(itens.map((i) => i.getAttribute('data-estado'))).toEqual([
      'esperando',
      'triado',
      'triado',
    ])
    expect(within(itens[0]).getByText('esperando triagem')).toBeTruthy()
    expect(within(itens[1]).getByText('triada')).toBeTruthy()
    expect(within(itens[1]).getByText(/virou o #906/)).toBeTruthy()
    expect(within(itens[0]).queryByTestId('fabrica-entrada-ver')).toBeNull()
    expect(within(itens[2]).queryByTestId('fabrica-entrada-ver')).toBeNull()
    fireEvent.click(within(itens[1]).getByTestId('fabrica-entrada-ver'))
    expect(screen.getAllByTestId('fabrica-entrada-ver')).toHaveLength(1)
    expect(p.ir).toHaveBeenCalledWith({ tela: 'card', card: 906 })
  })

  it('Slack, Suporte e Vigia dizem que a fábrica não lê; Você mostra os itens', async () => {
    await abrir()
    const casos: [string, string][] = [
      ['slack', 'o Slack'],
      ['suporte', 'o suporte'],
      ['vigia', 'o Vigia'],
    ]
    for (const [slug, nome] of casos) {
      fireEvent.click(screen.getByTestId(`fabrica-entrada-fonte-${slug}`))
      expect(screen.getByTestId('fabrica-entrada-fonte-vazia').textContent).toBe(
        `A fábrica não lê ${nome} nesta prova: o que chega à entrada é o que você conta.`,
      )
      expect(screen.queryAllByTestId('fabrica-entrada-item')).toHaveLength(0)
    }
    fireEvent.click(screen.getByTestId('fabrica-entrada-fonte-voce'))
    expect(screen.getAllByTestId('fabrica-entrada-item')).toHaveLength(3)
  })

  it('diz quantos itens antigos ficaram de fora', async () => {
    readFabricaEntrada.mockResolvedValue({ ...TRES, total: 25 })
    await abrir()
    expect(screen.getByText('e mais 22 antigos no entrada.json')).toBeTruthy()
  })

  it('mostra o vazio e o ilegível', async () => {
    readFabricaEntrada.mockResolvedValue({ kind: 'ok', itens: [], total: 0 })
    const a = render(<Entrada {...props()} />)
    expect((await screen.findByTestId('fabrica-entrada-vazia')).textContent).toBe(
      'Nada chegou ainda. Conte abaixo o que te reportaram.',
    )
    a.unmount()
    readFabricaEntrada.mockResolvedValue({ kind: 'ilegivel', erro: 'json torto' })
    render(<Entrada {...props()} />)
    expect((await screen.findByTestId('fabrica-entrada-erro')).textContent).toBe(
      'Não deu para ler a entrada: json torto',
    )
  })

  it('uma exceção da ponte vira o erro na tela, sem exceção solta', async () => {
    readFabricaEntrada.mockRejectedValue(new Error('sem ponte'))
    render(<Entrada {...props()} />)
    expect((await screen.findByTestId('fabrica-entrada-erro')).textContent).toContain('sem ponte')
  })

  it('não diz o que o protótipo dizia e a fábrica não faz (CA-4.4)', async () => {
    const { container } = await abrir()
    expect(container.textContent ?? '').not.toMatch(PROIBIDO)
    for (const slug of ['slack', 'suporte', 'vigia']) {
      fireEvent.click(screen.getByTestId(`fabrica-entrada-fonte-${slug}`))
      expect(container.textContent ?? '').not.toMatch(PROIBIDO)
    }
  })
})

describe('Entrada · Mandar', () => {
  it('fica desabilitado com vazio, só espaços, mais de 4000 caracteres e emVoo', async () => {
    const { unmount } = await abrir()
    expect(mandar().disabled).toBe(true)
    digitar('   ')
    expect(mandar().disabled).toBe(true)
    digitar('a'.repeat(4000))
    expect(mandar().disabled).toBe(false)
    digitar('a'.repeat(4001))
    expect(mandar().disabled).toBe(true)
    expect(screen.getByText(/O texto passa de 4000 caracteres\./)).toBeTruthy()
    unmount()
    await abrir({ emVoo: true })
    digitar('oi')
    expect(mandar().disabled).toBe(true)
  })

  it('chama comando uma vez e esvazia a caixa quando a releitura traz o item novo', async () => {
    const comando = vi.fn(() => {
      readFabricaEntrada.mockResolvedValue({
        kind: 'ok',
        itens: [{ ...ABERTO, id: 'e-0004', texto: 'novo' }, ...TRES.itens],
        total: 4,
      })
      return Promise.resolve()
    })
    await abrir({ comando })
    digitar('  novo ')
    fireEvent.click(mandar())
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('fabrica-entrada-texto').value).toBe(''),
    )
    expect(comando).toHaveBeenCalledTimes(1)
    expect(comando).toHaveBeenCalledWith({ tipo: 'entrada', texto: '  novo ' })
    expect(screen.getAllByTestId('fabrica-entrada-item')).toHaveLength(4)
  })

  it('a caixa fica quando a releitura não traz o item', async () => {
    const comando = vi.fn(() => Promise.resolve())
    await abrir({ comando })
    digitar('nada novo')
    fireEvent.click(mandar())
    await waitFor(() => expect(comando).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mandar().disabled).toBe(false))
    expect(screen.getByTestId<HTMLTextAreaElement>('fabrica-entrada-texto').value).toBe('nada novo')
  })

  it('a resposta velha do reler da raiz não sobrescreve a lista nem decide a caixa', async () => {
    const NOVO: ItemNaEntrada = { ...ABERTO, id: 'e-0004', texto: 'novo' }
    const COM_NOVO: EntradaNaSala = { kind: 'ok', itens: [NOVO, ...TRES.itens], total: 4 }
    let velha!: (e: EntradaNaSala) => void
    const comando = vi.fn(() => Promise.resolve())
    const p = props({ comando })
    const { rerender } = render(<Entrada {...p} />)
    await screen.findAllByTestId('fabrica-entrada-item')

    digitar('novo')
    // O reler da raiz muda o `lidoEm` e o efeito pede uma leitura que só responde depois.
    readFabricaEntrada.mockReturnValueOnce(new Promise<EntradaNaSala>((r) => (velha = r)))
    readFabricaEntrada.mockResolvedValue(COM_NOVO)
    rerender(<Entrada {...p} sala={{ ...SALA, lidoEm: '2026-11-11T12:05:00.000Z' }} />)
    // O passo 3 do Mandar pede a leitura seguinte, e esta responde primeiro.
    fireEvent.click(mandar())
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('fabrica-entrada-texto').value).toBe(''),
    )
    expect(screen.getAllByTestId('fabrica-entrada-item')).toHaveLength(4)

    // A resposta velha chega depois, sem o item: não pode desfazer a lista.
    await act(() => {
      velha(TRES)
      return Promise.resolve()
    })
    expect(screen.getAllByTestId('fabrica-entrada-item')).toHaveLength(4)
  })
})

describe('Entrada · o item triado abre o Card em qualquer ponto (#145, CA-2)', () => {
  it('clicar no triado que cita #906 leva ao Card; sem card e aberto não navegam', async () => {
    const { p } = await abrir()
    const itens = screen.getAllByTestId('fabrica-entrada-item')
    const por = (id: string) => itens.find((i) => i.getAttribute('data-id') === id)!
    fireEvent.click(within(por('e-0002')).getByText('Erro ao exportar BPA.'))
    expect(p.ir).toHaveBeenCalledWith({ tela: 'card', card: 906 })
    vi.mocked(p.ir).mockClear()
    fireEvent.click(within(por('e-0001')).getByText('Só uma ideia.'))
    fireEvent.click(within(por('e-0003')).getByText(/filtro por competência/))
    expect(p.ir).not.toHaveBeenCalled()
  })
})

describe('Entrada · a triagem da fábrica (#145)', () => {
  const EM_TRIAGEM: ItemNaEntrada = { ...ABERTO, id: 'e-0004', triagem: 'triando' }
  const PAROU: ItemNaEntrada = {
    ...ABERTO,
    id: 'e-0005',
    triagem: 'parou',
    parou: 'PARADA: isso é suporte',
  }

  it('mostra os quatro estados com o data-estado e o texto de cada um', async () => {
    readFabricaEntrada.mockResolvedValue({
      kind: 'ok',
      itens: [ABERTO, EM_TRIAGEM, PAROU, TRIADO],
      total: 4,
    })
    await abrir()
    const itens = screen.getAllByTestId('fabrica-entrada-item')
    expect(itens.map((i) => i.getAttribute('data-estado'))).toEqual([
      'esperando',
      'triando',
      'parou',
      'triado',
    ])
    const situacao = itens.map((i) => within(i).getByTestId('fabrica-entrada-situacao').textContent)
    expect(situacao).toEqual(['esperando triagem', 'em triagem', 'a triagem parou', 'triada'])
    expect(
      within(itens[1] as HTMLElement).getByText(/A \/gm-triage está lendo o relato/),
    ).toBeTruthy()
    expect(
      within(itens[2] as HTMLElement).getByText(
        'A triagem parou sem card: PARADA: isso é suporte. A orquestradora fecha o item com yarn fabrica triar.',
      ),
    ).toBeTruthy()
    expect(document.body.textContent).not.toMatch(PROIBIDO)
  })

  const SALA_BASE = RETRATO_F2
  const variantes: [string, Partial<SalaDaFabrica>, string][] = [
    [
      'pausada',
      { pausa: { desde: '2026-11-11T10:00:00.000Z' } },
      'A fábrica está pausada: a triagem começa quando você retomar.',
    ],
    [
      'rodando',
      { pausa: null, despachante: 'rodando' },
      'O despachante lança a /gm-triage para este item no próximo passo em que houver vaga.',
    ],
    [
      'desconhecido',
      { pausa: null, despachante: 'desconhecido' },
      'Não deu para saber se o despachante está rodando: a triagem começa quando ele rodar.',
    ],
    [
      'parado',
      { pausa: null, despachante: 'parado' },
      'O despachante não está rodando: a triagem começa quando a orquestradora ligar o yarn fabrica rodar.',
    ],
  ]
  it.each(variantes)('o aviso do esperando com o despachante %s', async (_n, extra, texto) => {
    await abrir({ sala: { ...SALA_BASE, ...extra } as SalaDaFabrica })
    const item = screen.getAllByTestId('fabrica-entrada-item')[0] as HTMLElement
    expect(within(item).getByText(texto)).toBeTruthy()
  })

  it('o aviso do esperando sem sala é o do despachante parado', async () => {
    await abrir({ sala: null })
    const item = screen.getAllByTestId('fabrica-entrada-item')[0] as HTMLElement
    expect(within(item).getByText(/O despachante não está rodando/)).toBeTruthy()
  })
})
