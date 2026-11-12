// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Pergunta } from '../../src/renderer/fabrica/telas/Pergunta'
import type { PropsDaTela } from '../../src/renderer/fabrica/telas'
import type { PerguntaDaFila, SalaDaFabrica } from '../../src/shared/fabrica'

import { PERGUNTAS_F3, RETRATO_F3 } from './retrato-f3'
import { BOARD_DO_PROJECT_2 } from './boardNaFabrica'

/**
 * A tela Pergunta (#132, CA-3.1, CA-3.3 e CA-3.4 do lado da tela): montada direto com as props, com
 * o retrato e as perguntas literais da fixture `f3`. A ponte é falsa: o main nem entra, e nenhum
 * comando roda de verdade.
 */

const readFabricaPergunta = vi.fn<(a: { id: string }) => Promise<PerguntaDaFila | null>>()
const comando = vi.fn<PropsDaTela['comando']>()
const ir = vi.fn<PropsDaTela['ir']>()

beforeEach(() => {
  readFabricaPergunta
    .mockReset()
    .mockImplementation(({ id }) => Promise.resolve(PERGUNTAS_F3[id] ?? null))
  comando.mockReset().mockResolvedValue(undefined)
  ir.mockReset()
  Object.defineProperty(window, 'oc', { value: { readFabricaPergunta }, configurable: true })
})

afterEach(cleanup)

function montar(
  item: string,
  extra: { sala?: SalaDaFabrica; emVoo?: boolean } = {},
): ReturnType<typeof render> {
  return render(
    <Pergunta
      tela={{ tela: 'pergunta', item }}
      sala={extra.sala ?? RETRATO_F3}
      ir={ir}
      comando={comando}
      emVoo={extra.emVoo ?? false}
      board={BOARD_DO_PROJECT_2}
    />,
  )
}

const texto = (testid: string): string => screen.getByTestId(testid).textContent ?? ''

const PROIBIDO = /evidência anexada|recomendado|\bleva\b|\bglosas?\b/i

describe('Pergunta · a tela do protótipo (CA-3.1)', () => {
  it('mostra a trilha, os dois chips e o cartão da pergunta', async () => {
    const { container } = montar('q-0009')

    expect((await screen.findByTestId('fabrica-pergunta')).textContent).toContain(
      'o card não diz se a resposta vai para o board ou para o cofre',
    )
    expect(texto('fabrica-trilha')).toBe('Sala de controle/Esperando você/Pergunta')
    expect(texto('fabrica-chip-tipo')).toBe('Pergunta · trava o #961')
    expect(texto('fabrica-chip-posicao')).toBe('1 de 4 na fila')

    const cartao = screen.getByTestId('fabrica-pergunta')

    expect(cartao.textContent).toContain('#961')
    expect(cartao.textContent).toContain('gm-spec')
    expect(cartao.textContent).toContain('d-0005')
    expect(cartao.querySelector('h1')?.textContent).toBe(
      'o card não diz se a resposta vai para o board ou para o cofre',
    )
    // O texto final entra em markdown: o "Onde parou" sai em negrito.
    expect(cartao.querySelector('strong')?.textContent).toBe('Onde parou:')
    expect(container.textContent).not.toMatch(PROIBIDO)
  })

  it('"De onde veio" mostra o despacho, a sessão e a hora em que parou', async () => {
    montar('q-0009')
    await screen.findByTestId('fabrica-pergunta')

    const origem = screen.getByTestId('fabrica-pergunta-origem')

    expect(origem.textContent).toContain('De onde veio')
    expect(origem.textContent).toContain('d-0005 · /gm-spec #961')
    expect(origem.textContent).toContain('sessao-961')
    expect(origem.textContent).toContain('parou')
  })

  it('não tem cartão de opção: o Vazio diz que a sessão não deixou opções', async () => {
    montar('q-0009')
    await screen.findByTestId('fabrica-pergunta')

    expect(texto('fabrica-sem-opcoes')).toBe(
      'Esta sessão não deixou opções estruturadas, e a fábrica não inventa opções. Qualquer resposta fecha o item com ela como resolução.',
    )

    const secao = screen.getByRole('region', { name: 'Opções' })

    expect(secao.querySelectorAll('button')).toHaveLength(0)
    expect(secao.textContent).toContain('O que a fábrica faz com cada resposta')
  })

  it('lista os outros três itens abertos, e clicar o primeiro vai à Decisão', async () => {
    montar('q-0009')
    await screen.findByTestId('fabrica-pergunta')

    const outras = screen.getAllByTestId('fabrica-outra')

    expect(outras).toHaveLength(3)
    expect(screen.queryByTestId('fabrica-outras-vazio')).toBeNull()
    expect(outras[0]?.textContent).toBe(
      'G4 da PR #970: sem bloqueante · parecer https://github.com/leonardo-amaral-3/operations-center/pull/970#issuecomment-1',
    )

    fireEvent.click(outras[0] as HTMLElement)
    expect(ir).toHaveBeenCalledWith({ tela: 'decisao', item: 'q-0013' })
  })

  it('"Por que chegou a você" tem a frase da PARADA', async () => {
    montar('q-0009')
    await screen.findByTestId('fabrica-pergunta')

    expect(texto('fabrica-por-que')).toBe(
      'Por que chegou a você' +
        'A sessão do /gm-spec #961 terminou com PARADA em vez de decidir sozinha, e o despachante encerrou a frente do #961.',
    )
  })

  it('"Por que chegou a você" do G4 diz que o parecer não aprovou a PR', async () => {
    const g4 = PERGUNTAS_F3['q-0013'] as PerguntaDaFila
    readFabricaPergunta.mockResolvedValueOnce({
      ...g4,
      item: { ...g4.item, tipo: 'pergunta' },
    })
    montar('q-0013')
    await screen.findByTestId('fabrica-pergunta')

    expect(texto('fabrica-por-que')).toBe(
      'Por que chegou a você' +
        `O G4 da /g4 #962 PR #970 terminou sem aprovar a PR para o merge (${g4.item.motivo}), e o despachante encerrou a frente do #962.`,
    )
  })

  it('o item sem texto final mostra o aviso, a frase da falha e "3 de 4 na fila"', async () => {
    montar('q-0016')

    expect((await screen.findByTestId('fabrica-pergunta-sem-texto')).textContent).toBe(
      'A sessão não deixou texto final.',
    )
    expect(texto('fabrica-por-que')).toContain(
      'terminou sem um fim que a fábrica entenda (a sessão terminou sem saída). O despachante não relança sozinho.',
    )
    expect(texto('fabrica-chip-posicao')).toBe('3 de 4 na fila')
    expect(texto('fabrica-pergunta-origem')).toContain('sem sessão registrada')
  })

  it('as frases do PROXIMO recusado e do despacho fora do estado', async () => {
    const base = PERGUNTAS_F3['q-0009'] as PerguntaDaFila

    readFabricaPergunta.mockResolvedValueOnce({ ...base, fim: 'proximo' })
    const { unmount } = montar('q-0009')

    expect((await screen.findByTestId('fabrica-por-que')).textContent).toContain(
      'pediu um próximo passo que a fábrica não aceita (o card não diz se a resposta vai para o board ou para o cofre), e a frente parou aqui.',
    )
    unmount()

    readFabricaPergunta.mockResolvedValueOnce({
      ...base,
      fim: null,
      passos: [],
      item: { ...base.item, comando: null },
    })
    montar('q-0009')

    expect((await screen.findByTestId('fabrica-por-que')).textContent).toContain(
      'O despacho de origem (d-0005) não está no estado da fábrica.',
    )
    // Sem passo de origem, a etiqueta do skill diz isso, e a linha do despacho também.
    expect(texto('fabrica-pergunta')).toContain('sem despacho')
    expect(texto('fabrica-pergunta-origem')).toContain('d-0005 · fora do estado')
  })

  it('com um retrato de um item só, não há outras decisões', async () => {
    const ok = RETRATO_F3 as Extract<SalaDaFabrica, { kind: 'ok' }>
    const so: SalaDaFabrica = { ...ok, abertos: ok.abertos.slice(0, 1) }

    montar('q-0009', { sala: so })
    await screen.findByTestId('fabrica-pergunta')

    expect(screen.queryAllByTestId('fabrica-outra')).toHaveLength(0)
    expect(texto('fabrica-outras-vazio')).toBe('Nenhum outro item aberto.')
  })

  it('o item que já fechou mostra "fechado" e a resolução, sem caixa de resposta', async () => {
    const sala = RETRATO_F3 as Extract<SalaDaFabrica, { kind: 'ok' }>

    montar('q-0003', { sala })

    expect((await screen.findByTestId('fabrica-item-fechado')).textContent).toContain(
      'o board da fábrica (Project 2)',
    )
    expect(texto('fabrica-chip-posicao')).toBe('fechado')
    expect(screen.queryByTestId('fabrica-resposta')).toBeNull()
    expect(screen.queryByTestId('fabrica-responder-fechar')).toBeNull()
  })

  it('o item que saiu do estado mostra o aviso, sem o chip de tipo', async () => {
    montar('q-9999')

    expect(await screen.findByTestId('fabrica-item-sumiu')).toBeTruthy()
    expect(screen.queryByTestId('fabrica-chip-tipo')).toBeNull()
    expect(texto('fabrica-chip-posicao')).toBe('fora da fila')
  })
})

describe('Pergunta · Responder e fechar o item (CA-3.3)', () => {
  const botao = () => screen.getByTestId<HTMLButtonElement>('fabrica-responder-fechar')
  const caixa = () => screen.getByTestId<HTMLTextAreaElement>('fabrica-resposta')

  it('fica desabilitado com a resposta vazia e com só espaços', async () => {
    montar('q-0009')
    await screen.findByTestId('fabrica-resposta')

    expect(botao().disabled).toBe(true)

    fireEvent.change(caixa(), { target: { value: '   \n ' } })
    expect(botao().disabled).toBe(true)

    fireEvent.click(botao())
    expect(comando).not.toHaveBeenCalled()
  })

  it('chama o comando uma vez, com a resolução aparada', async () => {
    montar('q-0009')
    await screen.findByTestId('fabrica-resposta')

    fireEvent.change(caixa(), { target: { value: '  gravar no cofre ' } })
    expect(botao().disabled).toBe(false)

    fireEvent.click(botao())
    expect(comando).toHaveBeenCalledTimes(1)
    expect(comando).toHaveBeenCalledWith({
      tipo: 'fechar',
      item: 'q-0009',
      resolucao: 'gravar no cofre',
    })
  })

  it('fica desabilitado com um comando em voo', async () => {
    montar('q-0009', { emVoo: true })
    await screen.findByTestId('fabrica-resposta')

    fireEvent.change(caixa(), { target: { value: 'gravar no cofre' } })
    expect(botao().disabled).toBe(true)
  })

  it('trocar de item zera a resposta', async () => {
    const { rerender } = montar('q-0009')
    await screen.findByTestId('fabrica-resposta')
    fireEvent.change(caixa(), { target: { value: 'meio digitada' } })

    rerender(
      <Pergunta
        tela={{ tela: 'pergunta', item: 'q-0016' }}
        sala={RETRATO_F3}
        ir={ir}
        comando={comando}
        emVoo={false}
        board={BOARD_DO_PROJECT_2}
      />,
    )

    await waitFor(() => {
      expect(texto('fabrica-pergunta')).toContain('a sessão terminou sem saída')
    })
    expect(caixa().value).toBe('')
  })

  it('o item que fecha por baixo mostra o estado fechado e tira a caixa', async () => {
    const base = PERGUNTAS_F3['q-0009'] as PerguntaDaFila
    const { item } = base
    const fechado: PerguntaDaFila = {
      ...base,
      item: { ...item, fechadoEm: '2026-11-11T10:00:00.000Z', resolucao: 'gravar no cofre' },
    }

    readFabricaPergunta.mockResolvedValueOnce(fechado)
    montar('q-0009')

    expect((await screen.findByTestId('fabrica-item-fechado')).textContent).toContain(
      'gravar no cofre',
    )
    expect(screen.queryByTestId('fabrica-resposta')).toBeNull()
  })
})
