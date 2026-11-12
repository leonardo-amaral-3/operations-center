// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PropsDaTela } from '../../src/renderer/fabrica/telas'
import { Portfolio } from '../../src/renderer/fabrica/telas/Portfolio'
import { BotoesDaRevisao } from '../../src/renderer/fabrica/telas/revisao'
import { esquecerRelatorios } from '../../src/renderer/fabrica/useDia'
import type {
  ComandoDaFabrica,
  PainelDoDia,
  RelatorioDaSala,
  RevisaoNaSala,
  RevisoesNaSala,
} from '../../src/shared/fabrica'
import { A1, A2, A3, A4, A5, A8, A9, PAINEL_F5, REVISAO_A4 } from './painel-f5'
import { BOARD_DO_PROJECT_2 } from './boardNaFabrica'

/**
 * A tela Portfólio da F5 (#134, CA-5.2/5.3/5.5, CA-E4): a ponte (`readRelatorio`,
 * `readFabricaRevisoes`) e o comando são falsos; o main nem entra.
 */

const ok = (painel: PainelDoDia = PAINEL_F5, dia = '2026-11-10'): RelatorioDaSala => ({
  kind: 'ok',
  dia,
  markdown: `Relatório ${dia}`,
  semFonte: 0,
  geradoEm: '2026-11-11T12:00:00.000Z',
  painel,
})
const REVISOES: RevisoesNaSala = { kind: 'ok', revisoes: [REVISAO_A4], ilegiveis: 0 }

const readRelatorio = vi.fn<(pedido: { dia: string }) => Promise<RelatorioDaSala>>()
const readFabricaRevisoes = vi.fn<() => Promise<RevisoesNaSala>>()

beforeEach(() => {
  esquecerRelatorios()
  readRelatorio.mockReset().mockImplementation(({ dia }) => Promise.resolve(ok(PAINEL_F5, dia)))
  readFabricaRevisoes.mockReset().mockResolvedValue(REVISOES)
  Object.defineProperty(window, 'oc', {
    value: { readRelatorio, readFabricaRevisoes },
    configurable: true,
  })
})
afterEach(cleanup)

function props(extra: Partial<PropsDaTela> = {}): PropsDaTela {
  return {
    tela: { tela: 'portfolio', dia: '2026-11-10' },
    sala: null,
    ir: vi.fn(),
    comando: () => Promise.resolve(),
    emVoo: false,
    board: BOARD_DO_PROJECT_2,
    ...extra,
  }
}

async function abrir(extra: Partial<PropsDaTela> = {}) {
  const p = props(extra)
  const r = render(<Portfolio {...p} />)
  await screen.findByTestId('fabrica-portfolio-detalhe')
  await waitFor(() => {
    expect(readFabricaRevisoes).toHaveBeenCalled()
  })
  return { ...r, p }
}

const linhas = () =>
  screen.getAllByTestId('fabrica-decisoes-linha').map((l) => l.getAttribute('data-arquivo'))
const filtrar = (nome: string) => {
  fireEvent.click(
    document.querySelector(`[data-testid="fabrica-filtro"][data-filtro="${nome}"]`) as HTMLElement,
  )
}
const detalhe = () => screen.getByTestId('fabrica-portfolio-detalhe')

describe('Portfólio: cabeçalho e estados da leitura', () => {
  it('gerando, trilha, dia e "relatório do dia" → relatório com o dia', async () => {
    let resolver: (v: RelatorioDaSala) => void = () => undefined
    readRelatorio.mockReturnValue(new Promise((r) => (resolver = r)))
    const p = props()
    render(<Portfolio {...p} />)

    expect(screen.getByTestId('relatorio-gerando').textContent).toBe(
      'Gerando o relatório de 10/11…',
    )
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('Portfólio')
    expect(screen.getByTestId('fabrica-portfolio-dia').textContent).toBe('10/11/2026')

    await act(async () => {
      resolver(ok())
      await Promise.resolve()
    })
    expect(screen.queryByTestId('relatorio-gerando')).toBeNull()

    fireEvent.click(screen.getByTestId('fabrica-portfolio-relatorio'))
    expect(p.ir).toHaveBeenCalledWith({ tela: 'relatorio', dia: '2026-11-10' })
  })

  it('erro da leitura e rejeição da ponte', async () => {
    readRelatorio.mockResolvedValueOnce({ kind: 'erro', dia: '2026-11-10', erro: 'cofre ausente' })
    render(<Portfolio {...props()} />)
    expect((await screen.findByTestId('relatorio-erro')).textContent).toContain('cofre ausente')
    cleanup()

    esquecerRelatorios()
    readRelatorio.mockRejectedValueOnce(new Error('ponte caiu'))
    render(<Portfolio {...props()} />)
    expect((await screen.findByTestId('relatorio-erro')).textContent).toContain('ponte caiu')
  })
})

describe('Portfólio: objetivos (CA-5.3)', () => {
  it('quatro objetivos sem barra de progresso e o cartão "sem objetivo"', async () => {
    await abrir()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'A empresa está indo na direção certa?',
    )
    expect(screen.getByTestId('fabrica-objetivos-origem').textContent).toBe(
      'objetivos do fabrica/DIRECAO.md, sem medida de progresso',
    )
    const cartoes = screen.getAllByTestId('fabrica-objetivo')
    expect(cartoes.map((c) => c.getAttribute('data-codigo'))).toEqual(['P0', 'P1', 'P2', 'P3'])
    for (const c of cartoes) expect(c.textContent).toContain('sem medida na Direção')

    const p0 = cartoes[0] as HTMLElement
    expect(p0.textContent).toContain('P0 · Fundação')
    expect(p0.textContent).toContain('Nenhuma decisão do dia cita este objetivo.')
    const p1 = cartoes[1] as HTMLElement
    expect(p1.textContent).toContain('Frentes: #120')
    expect(p1.textContent).toContain('2 decisões no dia')

    // 8 do operations-center; sem objetivo: A7 e A9 não contam (A9 é sem-repo), então só A7
    const sem = screen.getByTestId('fabrica-sem-objetivo')
    expect(sem.textContent).toContain('Sem objetivo da Direção')
    expect(sem.textContent).toContain('1 decisão no dia, 13% das do operations-center.')
  })

  it('sem DIRECAO.md: só o aviso e o cartão "sem objetivo"', async () => {
    readRelatorio.mockResolvedValue(ok({ ...PAINEL_F5, objetivos: null }))
    await abrir()
    expect(screen.getByTestId('fabrica-objetivos-origem').textContent).toBe(
      'sem fabrica/DIRECAO.md: a Direção ainda precisa ser escrita',
    )
    expect(screen.getByTestId('fabrica-objetivo-ausente').textContent).toContain(
      'Sem fabrica/DIRECAO.md no repo do relatório',
    )
    expect(screen.queryAllByTestId('fabrica-objetivo')).toHaveLength(0)
    expect(screen.getByTestId('fabrica-sem-objetivo')).toBeTruthy()
  })
})

describe('Portfólio: a trilha de decisões (CA-5.3)', () => {
  it('nove linhas, a contagem e os seis filtros', async () => {
    await abrir()
    expect(linhas()).toHaveLength(9)
    expect(screen.getByTestId('fabrica-decisoes-contagem').textContent).toContain(
      '9 de 9 decisões de 10/11 neste filtro.',
    )
    expect(
      screen.getAllByTestId('fabrica-filtro').map((b) => b.getAttribute('data-filtro')),
    ).toEqual(['Todas', 'Chave', 'Provisórias', 'Suas', 'Sem objetivo', 'Alertas'])
  })

  it('cada filtro mostra só as linhas dele', async () => {
    await abrir()
    filtrar('Chave')
    // chave, provisória e desvio
    expect(linhas()).toHaveLength(5)
    expect(linhas()).toEqual(expect.arrayContaining([A1, A2, A3, A4, A8]))

    filtrar('Provisórias')
    // A4 está confirmada: sai; sobram A2 e A3
    expect(linhas().sort()).toEqual([A2, A3].sort())

    filtrar('Suas')
    expect(linhas()).toEqual([A4])

    filtrar('Sem objetivo')
    expect(linhas()).toHaveLength(2)
    expect(linhas()).toContain(A9)

    filtrar('Alertas')
    expect(linhas()).toEqual([A9])
    expect(screen.getByTestId('fabrica-decisoes-contagem').textContent).toContain(
      '1 de 9 decisões de 10/11 neste filtro.',
    )

    filtrar('Suas')
    filtrar('Todas')
    expect(linhas()).toHaveLength(9)
  })

  it('filtro sem linha mostra o aviso', async () => {
    readFabricaRevisoes.mockResolvedValue({ kind: 'ok', revisoes: [], ilegiveis: 0 })
    await abrir()
    filtrar('Suas')
    expect(screen.getByTestId('fabrica-decisoes-vazia').textContent).toBe(
      'Nenhuma decisão neste filtro.',
    )
  })
})

describe('Portfólio: o detalhe', () => {
  it('o padrão é a primeira decisão aberta; clicar numa linha troca', async () => {
    await abrir()
    expect(detalhe().textContent).toContain('A leitura do cofre vai em lotes de 64 arquivos')
    const ativa = screen
      .getAllByTestId('fabrica-decisoes-linha')
      .filter((l) => l.getAttribute('aria-pressed') === 'true')
    expect(ativa.map((l) => l.getAttribute('data-arquivo'))).toEqual([A2])

    const linha = document.querySelector(`[data-arquivo="${A1}"]`) as HTMLElement
    fireEvent.click(linha)
    expect(detalhe().textContent).toContain('G2 da F9 decidido sob mandato')
    expect(detalhe().textContent).toContain('Profundidade Completa')
    expect(detalhe().textContent).toContain('Sob: mandato #1439')
    expect(detalhe().textContent).toContain('Objetivo: P3 · A interface')
    expect(detalhe().textContent).toContain(`No cofre: ${A1}`)
  })

  it('sem aberta, o padrão é a primeira do painel; sem decisão, o aviso', async () => {
    const so = PAINEL_F5.decisoes.filter((d) => d.arquivo === A4)
    readRelatorio.mockResolvedValue(ok({ ...PAINEL_F5, decisoes: so }))
    await abrir()
    expect(detalhe().textContent).toContain('A sala lê o mandato da dev pela GraphQL')
    cleanup()

    esquecerRelatorios()
    readRelatorio.mockResolvedValue(ok({ ...PAINEL_F5, decisoes: [] }))
    render(<Portfolio {...props()} />)
    expect((await screen.findByTestId('fabrica-portfolio-detalhe')).textContent).toBe(
      'Nenhuma decisão em 10/11.',
    )
  })

  it('o sem-repo: objetivo "nenhum; escopo gravado sem o repo", sem marca sob', async () => {
    await abrir()
    fireEvent.click(document.querySelector(`[data-arquivo="${A9}"]`) as HTMLElement)
    expect(detalhe().textContent).toContain('Objetivo: nenhum; escopo gravado sem o repo')
    expect(detalhe().textContent).toContain('Sob: sem marca «sob:» no porquê')
    expect(detalhe().textContent).toContain('Descartado: —')
  })

  it('"Abrir o card" leva ao card e fica desabilitado sem card', async () => {
    const { p } = await abrir()
    fireEvent.click(within(detalhe()).getByTestId('fabrica-abrir-transcrito'))
    expect(p.ir).toHaveBeenCalledWith({
      tela: 'card',
      card: 120,
      repo: 'leonardo-amaral-3/operations-center',
    })

    fireEvent.click(document.querySelector(`[data-arquivo="${A9}"]`) as HTMLElement)
    const botao = within(detalhe()).getByTestId<HTMLButtonElement>('fabrica-abrir-transcrito')
    expect(botao.disabled).toBe(true)
    expect(botao.title).toBe('a decisão não tem card')
  })

  it('numa decisão que não está aberta, os botões aparecem desabilitados', async () => {
    await abrir()
    fireEvent.click(document.querySelector(`[data-arquivo="${A4}"]`) as HTMLElement)
    expect(within(detalhe()).getByTestId<HTMLButtonElement>('fabrica-confirmar').disabled).toBe(
      true,
    )
    expect(within(detalhe()).getByTestId<HTMLButtonElement>('fabrica-contestar').disabled).toBe(
      true,
    )
    expect(within(detalhe()).getByTestId('fabrica-revisao').textContent).toContain('Confirmada em')

    fireEvent.click(document.querySelector(`[data-arquivo="${A5}"]`) as HTMLElement)
    expect(within(detalhe()).getByTestId<HTMLButtonElement>('fabrica-confirmar').disabled).toBe(
      true,
    )
  })
})

describe('Portfólio: confirmar e contestar (CA-5.2)', () => {
  it('Confirmar chama o comando e relê as revisões', async () => {
    const comando = vi.fn<(c: ComandoDaFabrica) => Promise<void>>().mockResolvedValue(undefined)
    await abrir({ comando })
    const antes = readFabricaRevisoes.mock.calls.length
    readFabricaRevisoes.mockResolvedValue({
      kind: 'ok',
      revisoes: [
        REVISAO_A4,
        {
          arquivo: A2,
          veredito: 'confirmada',
          em: '2026-11-11T10:00:00.000Z',
          motivo: null,
          atendida: null,
        },
      ],
      ilegiveis: 0,
    })

    fireEvent.click(within(detalhe()).getByTestId('fabrica-confirmar'))
    expect(comando).toHaveBeenCalledWith({ tipo: 'confirmar', arquivo: A2 })
    await waitFor(() => {
      expect(readFabricaRevisoes.mock.calls.length).toBe(antes + 1)
    })
    await waitFor(() => {
      expect(
        document.querySelector(`[data-arquivo="${A2}"] [data-testid="fabrica-estado-da-decisao"]`)
          ?.textContent,
      ).toBe('confirmada')
    })
    expect(readRelatorio).toHaveBeenCalledTimes(1)
  })

  it('Contestar só grava com motivo; Cancelar não chama nada', async () => {
    const comando = vi.fn<(c: ComandoDaFabrica) => Promise<void>>().mockResolvedValue(undefined)
    await abrir({ comando })

    fireEvent.click(within(detalhe()).getByTestId('fabrica-contestar'))
    const gravar = screen.getByTestId<HTMLButtonElement>('fabrica-contestar-gravar')
    expect(gravar.disabled).toBe(true)

    fireEvent.change(screen.getByTestId('fabrica-contestar-motivo'), { target: { value: '   ' } })
    expect(gravar.disabled).toBe(true)

    fireEvent.click(screen.getByTestId('fabrica-contestar-cancelar'))
    expect(screen.queryByTestId('fabrica-contestar-motivo')).toBeNull()
    expect(comando).not.toHaveBeenCalled()

    fireEvent.click(within(detalhe()).getByTestId('fabrica-contestar'))
    fireEvent.change(screen.getByTestId('fabrica-contestar-motivo'), {
      target: { value: 'lote de 64 não foi medido' },
    })
    // A caixa fecha quando a contestação aparece nas revisões relidas.
    readFabricaRevisoes.mockResolvedValue({
      kind: 'ok',
      revisoes: [
        REVISAO_A4,
        {
          arquivo: A2,
          veredito: 'contestada',
          em: '2026-11-11T10:00:00.000Z',
          motivo: 'lote de 64 não foi medido',
          atendida: null,
        },
      ],
      ilegiveis: 0,
    })
    fireEvent.click(screen.getByTestId('fabrica-contestar-gravar'))
    expect(comando).toHaveBeenCalledWith({
      tipo: 'contestar',
      arquivo: A2,
      motivo: 'lote de 64 não foi medido',
    })
    await waitFor(() => {
      expect(screen.queryByTestId('fabrica-contestar-motivo')).toBeNull()
    })
  })

  it('o comando de contestar falha: a caixa fica aberta com o motivo', async () => {
    // A raiz não lança quando o comando falha: mostra o erro e relê. As revisões não mudam.
    const comando = vi.fn<(c: ComandoDaFabrica) => Promise<void>>().mockResolvedValue(undefined)
    await abrir({ comando })
    const antes = readFabricaRevisoes.mock.calls.length

    fireEvent.click(within(detalhe()).getByTestId('fabrica-contestar'))
    fireEvent.change(screen.getByTestId('fabrica-contestar-motivo'), {
      target: { value: 'motivo que não pode se perder' },
    })
    fireEvent.click(screen.getByTestId('fabrica-contestar-gravar'))
    await waitFor(() => {
      expect(readFabricaRevisoes.mock.calls.length).toBe(antes + 1)
    })
    expect(comando).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId<HTMLTextAreaElement>('fabrica-contestar-motivo').value).toBe(
      'motivo que não pode se perder',
    )
    expect(screen.getByTestId<HTMLButtonElement>('fabrica-contestar-gravar').disabled).toBe(false)
  })

  it('trocar de linha com a caixa aberta zera a caixa: o motivo não vai para outra decisão', async () => {
    const comando = vi.fn<(c: ComandoDaFabrica) => Promise<void>>().mockResolvedValue(undefined)
    await abrir({ comando })
    expect(detalhe().textContent).toContain(`No cofre: ${A2}`)

    fireEvent.click(within(detalhe()).getByTestId('fabrica-contestar'))
    fireEvent.change(screen.getByTestId('fabrica-contestar-motivo'), {
      target: { value: 'motivo escrito para a A2' },
    })

    fireEvent.click(document.querySelector(`[data-arquivo="${A3}"]`) as HTMLElement)
    expect(detalhe().textContent).toContain(`No cofre: ${A3}`)
    expect(screen.queryByTestId('fabrica-contestar-motivo')).toBeNull()
    expect(screen.queryByTestId('fabrica-contestar-gravar')).toBeNull()

    // Abrir a caixa na A3 começa vazia, e o que se grava é da A3.
    fireEvent.click(within(detalhe()).getByTestId('fabrica-contestar'))
    expect(screen.getByTestId<HTMLTextAreaElement>('fabrica-contestar-motivo').value).toBe('')
    fireEvent.change(screen.getByTestId('fabrica-contestar-motivo'), {
      target: { value: 'motivo da A3' },
    })
    fireEvent.click(screen.getByTestId('fabrica-contestar-gravar'))
    expect(comando).toHaveBeenCalledTimes(1)
    expect(comando).toHaveBeenCalledWith({ tipo: 'contestar', arquivo: A3, motivo: 'motivo da A3' })
  })

  it('Gravar contestação segue o habilitado: decisão que deixou de estar aberta não grava', () => {
    const d = PAINEL_F5.decisoes.find((x) => x.arquivo === A2)
    if (d === undefined) throw new Error('A2 sumiu do painel')
    const comando = vi.fn<(c: ComandoDaFabrica) => Promise<void>>().mockResolvedValue(undefined)
    const botoes = (revisao: RevisaoNaSala | undefined, podeLer = true) => (
      <BotoesDaRevisao
        decisao={d}
        revisao={revisao}
        podeLer={podeLer}
        comando={comando}
        emVoo={false}
        aoGravar={() => Promise.resolve()}
        terceiro={<span />}
        sempre
      />
    )
    const { rerender } = render(botoes(undefined))
    fireEvent.click(screen.getByTestId('fabrica-contestar'))
    fireEvent.change(screen.getByTestId('fabrica-contestar-motivo'), {
      target: { value: 'um motivo' },
    })
    const gravar = () => screen.getByTestId<HTMLButtonElement>('fabrica-contestar-gravar')
    expect(gravar().disabled).toBe(false)

    rerender(botoes(undefined, false))
    expect(gravar().disabled).toBe(true)

    rerender(
      botoes({
        arquivo: A2,
        veredito: 'confirmada',
        em: '2026-11-11T10:00:00.000Z',
        motivo: null,
        atendida: null,
      }),
    )
    // Revisada por fora: a caixa some, e nada se grava por cima da primeira revisão.
    expect(screen.queryByTestId('fabrica-contestar-gravar')).toBeNull()
    expect(comando).not.toHaveBeenCalled()
  })

  it('emVoo desabilita Confirmar e Contestar', async () => {
    await abrir({ emVoo: true })
    expect(within(detalhe()).getByTestId<HTMLButtonElement>('fabrica-confirmar').disabled).toBe(
      true,
    )
    expect(within(detalhe()).getByTestId<HTMLButtonElement>('fabrica-contestar').disabled).toBe(
      true,
    )
  })

  it('sem readFabricaRevisoes no fake, os botões ficam desabilitados', async () => {
    Object.defineProperty(window, 'oc', { value: { readRelatorio }, configurable: true })
    render(<Portfolio {...props()} />)
    await screen.findByTestId('fabrica-portfolio-detalhe')
    await waitFor(() => {
      expect(within(detalhe()).getByTestId<HTMLButtonElement>('fabrica-confirmar').disabled).toBe(
        true,
      )
    })
  })
})
