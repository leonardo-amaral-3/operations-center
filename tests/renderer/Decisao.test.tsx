// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComandoDaFabrica, PerguntaDaFila, SalaDaFabrica } from '../../src/shared/fabrica'
import { Decisao } from '../../src/renderer/fabrica/telas/Decisao'
import type { PropsDaTela } from '../../src/renderer/fabrica/telas'
import { PERGUNTAS_F3, RETRATO_F3 } from './retrato-f3'

/**
 * A tela Decisão (#132, CA-3.2 a CA-3.4) montada direto com `PropsDaTela` e a ponte falsa: o main nem
 * entra. Os literais são os da fixture `f3`, escritos à mão em `retrato-f3.ts`.
 */

const readFabricaPergunta = vi.fn<(a: { id: string }) => Promise<PerguntaDaFila | null>>()
const comando = vi.fn<(c: ComandoDaFabrica) => Promise<void>>()
const ir = vi.fn()

beforeEach(() => {
  readFabricaPergunta
    .mockReset()
    .mockImplementation((a) => Promise.resolve(PERGUNTAS_F3[a.id] ?? null))
  comando.mockReset().mockResolvedValue(undefined)
  ir.mockReset()
  Object.defineProperty(window, 'oc', { value: { readFabricaPergunta }, configurable: true })
})

afterEach(cleanup)

function montar(item: string, extra: Partial<PropsDaTela> = {}, sala: SalaDaFabrica = RETRATO_F3) {
  return render(
    <Decisao
      tela={{ tela: 'decisao', item }}
      sala={sala}
      ir={ir}
      comando={comando}
      emVoo={false}
      {...extra}
    />,
  )
}

/** A pergunta da fixture; um id que não existe nela é erro do teste. */
function daFixture(id: string): PerguntaDaFila {
  const pergunta = PERGUNTAS_F3[id]

  if (pergunta === undefined) throw new Error(`a fixture f3 não tem ${id}`)

  return pergunta
}

const aguardar = () => screen.findByTestId('fabrica-decisao')

describe('Decisão · igual ao protótipo (CA-3.2)', () => {
  it('cabeçalho: trilha de três partes e os dois chips', async () => {
    montar('q-0013')
    await aguardar()
    expect(screen.getByTestId('fabrica-trilha').textContent).toBe(
      'Sala de controle/Esperando você/Revisão · G4',
    )
    expect(screen.getByTestId('fabrica-chip-tipo').textContent).toBe('Você aprova')
    expect(screen.getByTestId('fabrica-chip-posicao').textContent).toBe('2 de 4 na fila')
  })

  it('cartão: etiquetas, motivo e texto final', async () => {
    montar('q-0013')
    const cartao = await aguardar()
    expect(within(cartao).getByText('#962')).toBeTruthy()
    const pr = within(cartao).getByText<HTMLAnchorElement>('PR #970')
    expect(pr.href).toBe('https://github.com/leonardo-amaral-3/operations-center/pull/970')
    expect(within(cartao).getByText('gm-ship')).toBeTruthy()
    expect(within(cartao).getByRole('heading', { level: 1 }).textContent).toBe(
      'PR #970 aberta na dev (Card: #962); o merge é da orquestradora',
    )
    expect(within(cartao).getByText('Portão local:').tagName).toBe('STRONG')
  })

  it('sem evidência: o aviso, nunca anexo nem captura', async () => {
    montar('q-0013')
    await aguardar()
    expect(screen.getByTestId('fabrica-sem-evidencia').textContent).toContain(
      'A fábrica não anexa evidência.',
    )
  })

  it('"Precisa do seu olho" com a PR e o botão de abrir', async () => {
    montar('q-0013')
    await aguardar()
    const olho = screen.getByTestId('fabrica-olho')
    expect(within(olho).getByText('sem conferência')).toBeTruthy()
    expect(within(olho).getByText('A PR #970.')).toBeTruthy()
    const abrir = screen.getByTestId<HTMLAnchorElement>('fabrica-abrir-pr')
    expect(abrir.href).toBe('https://github.com/leonardo-amaral-3/operations-center/pull/970')
    expect(abrir.textContent).toBe('Abrir a PR')
  })

  it('"Se você aprovar": três passos com a PR', async () => {
    montar('q-0013')
    await aguardar()
    const card = screen.getByTestId('fabrica-se-aprovar')
    expect(card.textContent).toContain('«aprovado»')
    expect(card.textContent).toContain('O merge da PR #970 na dev continua da orquestradora')
    expect(card.textContent).toContain('(G5)')
  })

  it('"Como chegou aqui": um passo por despacho e a linha da fila', async () => {
    montar('q-0013')
    await aguardar()
    const passos = screen.getAllByTestId('fabrica-passo')
    expect(passos).toHaveLength(3)
    expect(passos[0]?.textContent).toContain('gm-plan-tasks')
    expect(passos[0]?.textContent).toContain('seguiu para /gm-implement ')
    expect(passos[1]?.textContent).toContain('gm-implement')
    expect(passos[1]?.textContent).toContain('seguiu para /gm-ship ')
    expect(passos[2]?.textContent).toContain('gm-ship')
    expect(passos[2]?.textContent).toContain('PARADA: PR #970 aberta na dev')
    expect(screen.getByTestId('fabrica-passo-fila').textContent).toContain('Na sua fila desde ')
  })

  it('"Linhagem": o card e a PR', async () => {
    montar('q-0013')
    await aguardar()
    const card = screen.getByRole('heading', { name: 'Linhagem' }).parentElement as HTMLElement
    const links = within(card).getAllByRole<HTMLAnchorElement>('link')
    expect(links.map((a) => [a.textContent, a.href])).toEqual([
      ['Card #962', 'https://github.com/leonardo-amaral-3/operations-center/issues/962'],
      ['PR #970', 'https://github.com/leonardo-amaral-3/operations-center/pull/970'],
    ])
    expect(card.textContent).toContain('Decisões do card: no cofre, fora do app.')
  })

  it('sem texto final: o aviso da tela', async () => {
    montar('q-0017')
    await aguardar()
    expect(screen.getByTestId('fabrica-decisao-sem-texto')).toBeTruthy()
  })

  it('sem PR no motivo: o Vazio, e a tela não quebra', async () => {
    readFabricaPergunta.mockResolvedValue({ ...daFixture('q-0013'), pr: null, prUrl: null })
    montar('q-0013')
    await aguardar()
    expect(screen.getByText('O motivo não cita uma PR.')).toBeTruthy()
    expect(screen.queryByTestId('fabrica-olho')).toBeNull()
    expect(screen.getByTestId('fabrica-se-aprovar').textContent).toContain('O merge da PR na dev')
  })

  it('item que saiu do estado', async () => {
    readFabricaPergunta.mockResolvedValue(null)
    montar('q-0013')
    expect(await screen.findByTestId('fabrica-item-sumiu')).toBeTruthy()
  })

  it('item fechado: a resolução no lugar da barra, e a fila no passado', async () => {
    const aberta = daFixture('q-0013')
    readFabricaPergunta.mockResolvedValue({
      ...aberta,
      item: { ...aberta.item, fechadoEm: '2026-11-11T10:00:00.000Z', resolucao: 'aprovado' },
    })
    montar('q-0013')
    await aguardar()
    expect(screen.getByTestId('fabrica-item-fechado').textContent).toContain(': aprovado')
    expect(screen.queryByTestId('fabrica-aprovar')).toBeNull()
    expect(screen.getByTestId('fabrica-passo-fila').textContent).toContain('Fechado em ')
  })
})

describe('Decisão · aprovar e devolver (CA-3.3)', () => {
  it('Aprovar sem nota fecha com "aprovado"', async () => {
    montar('q-0013')
    await aguardar()
    fireEvent.click(screen.getByTestId('fabrica-aprovar'))
    expect(comando).toHaveBeenCalledTimes(1)
    expect(comando).toHaveBeenCalledWith({ tipo: 'fechar', item: 'q-0013', resolucao: 'aprovado' })
  })

  it('Aprovar com nota fecha com "aprovado: <nota>"', async () => {
    montar('q-0013')
    await aguardar()
    fireEvent.change(screen.getByTestId('fabrica-nota'), { target: { value: ' ok ' } })
    fireEvent.click(screen.getByTestId('fabrica-aprovar'))
    expect(comando).toHaveBeenCalledWith({
      tipo: 'fechar',
      item: 'q-0013',
      resolucao: 'aprovado: ok',
    })
  })

  it('Devolver precisa da nota e fecha com "devolvido: <nota>"', async () => {
    montar('q-0017')
    await aguardar()
    const devolver = screen.getByTestId<HTMLButtonElement>('fabrica-devolver')
    expect(devolver.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('fabrica-nota'), { target: { value: '   ' } })
    expect(devolver.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('fabrica-nota'), {
      target: { value: 'faltou o teste do fechar' },
    })
    expect(devolver.disabled).toBe(false)
    fireEvent.click(devolver)
    expect(comando).toHaveBeenCalledWith({
      tipo: 'fechar',
      item: 'q-0017',
      resolucao: 'devolvido: faltou o teste do fechar',
    })
  })

  it('com um comando em voo, os dois botões ficam desabilitados', async () => {
    montar('q-0013', { emVoo: true })
    await aguardar()
    fireEvent.change(screen.getByTestId('fabrica-nota'), { target: { value: 'x' } })
    expect(screen.getByTestId<HTMLButtonElement>('fabrica-aprovar').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('fabrica-devolver').disabled).toBe(true)
  })

  it('trocar de item zera a nota', async () => {
    const { rerender } = montar('q-0013')
    await aguardar()
    fireEvent.change(screen.getByTestId('fabrica-nota'), { target: { value: 'uma nota' } })
    rerender(
      <Decisao
        tela={{ tela: 'decisao', item: 'q-0017' }}
        sala={RETRATO_F3}
        ir={ir}
        comando={comando}
        emVoo={false}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText('PR #971').length).toBeGreaterThan(0)
    })
    expect(screen.getByTestId<HTMLInputElement>('fabrica-nota').value).toBe('')
  })
})

describe('Decisão · nada que minta (CA-3.4)', () => {
  it('o texto da tela não traz evidência anexada, opção recomendada, leva nem glosa', async () => {
    const { container } = montar('q-0013')
    await aguardar()
    expect(container.textContent ?? '').not.toMatch(
      /evidência anexada|recomendado|\bleva\b|\bglosas?\b/i,
    )
    expect(container.querySelector('img, pre')).toBeNull()
  })
})
