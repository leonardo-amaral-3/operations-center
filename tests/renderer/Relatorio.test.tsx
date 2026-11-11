// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PropsDaTela } from '../../src/renderer/fabrica/telas'
import { Relatorio } from '../../src/renderer/fabrica/telas/Relatorio'
import { esquecerRelatorios } from '../../src/renderer/fabrica/useDia'
import type {
  ComandoDaFabrica,
  PainelDoDia,
  RelatorioDaSala,
  RevisoesNaSala,
} from '../../src/shared/fabrica'
import { A2, A3, A4, PAINEL_F5, REVISAO_A4 } from './painel-f5'

/**
 * A tela Relatório da F5 (#134, CA-5.1/5.2/5.5, CA-E4): a ponte (`readRelatorio`,
 * `readFabricaRevisoes`) e o comando são falsos; o main nem entra.
 */

const ok = (
  painel: PainelDoDia = PAINEL_F5,
  dia = '2026-11-10',
  semFonte = 0,
): RelatorioDaSala => ({
  kind: 'ok',
  dia,
  markdown: `Relatório ${dia}`,
  semFonte,
  geradoEm: '2026-11-11T12:00:00.000Z',
  painel,
})
const REVISOES: RevisoesNaSala = { kind: 'ok', revisoes: [REVISAO_A4], ilegiveis: 0 }

const readRelatorio = vi.fn<(pedido: { dia: string }) => Promise<RelatorioDaSala>>()
const readFabricaRevisoes = vi.fn<() => Promise<RevisoesNaSala>>()

function instalar(com: Record<string, unknown> = { readRelatorio, readFabricaRevisoes }): void {
  Object.defineProperty(window, 'oc', { value: com, configurable: true })
}

beforeEach(() => {
  esquecerRelatorios()
  readRelatorio.mockReset().mockImplementation(({ dia }) => Promise.resolve(ok(PAINEL_F5, dia)))
  readFabricaRevisoes.mockReset().mockResolvedValue(REVISOES)
  instalar()
})
afterEach(cleanup)

function props(extra: Partial<PropsDaTela> = {}): PropsDaTela {
  return {
    tela: { tela: 'relatorio', dia: '2026-11-10' },
    sala: null,
    ir: vi.fn(),
    comando: () => Promise.resolve(),
    emVoo: false,
    ...extra,
  }
}

async function abrir(extra: Partial<PropsDaTela> = {}) {
  const p = props(extra)
  const r = render(<Relatorio {...p} />)
  await screen.findByTestId('fabrica-relatorio-frase')
  return { ...r, p }
}

const kpi = (nome: string) =>
  document.querySelector(`[data-testid="fabrica-kpi"][data-kpi="${nome}"] b`)?.textContent
const chave = (arquivo: string) =>
  document.querySelector<HTMLElement>(
    `[data-testid="fabrica-relatorio-chave"][data-arquivo="${arquivo}"]`,
  )

describe('Relatório: estados da leitura', () => {
  it('gerando, depois o corpo; o cabeçalho tem trilha, chips, seletor e atalhos', async () => {
    let resolver: (v: RelatorioDaSala) => void = () => undefined
    readRelatorio.mockReturnValue(new Promise((r) => (resolver = r)))
    render(<Relatorio {...props()} />)

    expect(screen.getByTestId('relatorio-gerando').textContent).toBe(
      'Gerando o relatório de 10/11…',
    )
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('Relatório de 10/11')
    expect(screen.getByText('montado do cofre, do board e do git')).toBeTruthy()
    expect(screen.getByTestId<HTMLInputElement>('relatorio-dia').value).toBe('2026-11-10')
    expect(screen.getByTestId<HTMLButtonElement>('relatorio-gerar').disabled).toBe(true)

    await act(async () => {
      resolver(ok())
      await Promise.resolve()
    })
    expect(screen.queryByTestId('relatorio-gerando')).toBeNull()
    expect(screen.getByTestId<HTMLButtonElement>('relatorio-gerar').disabled).toBe(false)
    expect(screen.getByText('ver trilha completa')).toBeTruthy()
  })

  it('erro da leitura e rejeição da ponte', async () => {
    readRelatorio.mockResolvedValueOnce({
      kind: 'erro',
      dia: '2026-11-10',
      erro: 'a pasta do cofre não existe',
    })
    render(<Relatorio {...props()} />)
    const erro = await screen.findByTestId('relatorio-erro')
    expect(erro.textContent).toContain('Não foi possível gerar o relatório.')
    expect(erro.textContent).toContain('a pasta do cofre não existe')
    cleanup()

    esquecerRelatorios()
    readRelatorio.mockRejectedValueOnce(new Error('ponte caiu'))
    render(<Relatorio {...props()} />)
    expect((await screen.findByTestId('relatorio-erro')).textContent).toContain('ponte caiu')
  })

  it('sem fonte: o chip só aparece com linha de fora', async () => {
    readRelatorio.mockResolvedValueOnce(ok(PAINEL_F5, '2026-11-10', 1))
    await abrir()
    expect(screen.getByTestId('relatorio-sem-fonte').textContent).toBe(
      '1 linha sem fonte ficou de fora',
    )
    cleanup()
    esquecerRelatorios()
    readRelatorio.mockResolvedValueOnce(ok(PAINEL_F5, '2026-11-10', 3))
    await abrir()
    expect(screen.getByTestId('relatorio-sem-fonte').textContent).toBe(
      '3 linhas sem fonte ficaram de fora',
    )
  })
})

describe('Relatório: o corpo (CA-5.1)', () => {
  it('a frase, os cinco números e os rótulos fixos', async () => {
    await abrir()
    expect(screen.getByText('EM UMA FRASE')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('raiz da cadeia')
    await waitFor(() => {
      expect(kpi('provisorias')).toBe('2')
    })
    expect(['cofre', 'chaves', 'provisorias', 'estacionadas', 'sem-repo'].map(kpi)).toEqual([
      '12',
      '5',
      '2',
      '1',
      '1',
    ])
    for (const t of [
      'decisões no cofre',
      'decisões-chave abaixo',
      'provisórias para você',
      'estacionadas esperando você',
      'gravadas com escopo sem repo',
    ])
      expect(screen.getByText(t)).toBeTruthy()
  })

  it('sem frase: a frase de nada do dia', async () => {
    readRelatorio.mockResolvedValue(ok({ ...PAINEL_F5, frases: [] }))
    await abrir()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Nada do operations-center no cofre, no board nem no git em 10/11.',
    )
  })

  it('a barra por repo, a linha de tipos e os três sinais', async () => {
    await abrir()
    const seg = screen.getAllByTestId('fabrica-esforco-segmento')
    expect(seg.map((s) => s.textContent)).toEqual([
      'operations-center · 8',
      'claude-brain · 2',
      'extractor · 1',
      '',
    ])
    expect(seg[3]?.getAttribute('aria-label')).toBe('sem repo, 1')
    expect(screen.getByText('Decisões por repo (12)')).toBeTruthy()
    expect(
      screen.getByText('Tipos: 7 decisões, 0 descobertas, 1 pendência, 0 restrições.'),
    ).toBeTruthy()

    const sinais: Record<string, string> = {}
    for (const s of screen.getAllByTestId('fabrica-sinal')) {
      sinais[s.getAttribute('data-sinal') ?? ''] = s.textContent ?? ''
    }
    expect(sinais.direcao).toContain(
      '1 de 8 decisões do operations-center não citam objetivo da Direção.',
    )
    expect(sinais.direcao).toContain('Fora dele, o cofre teve 3 no dia')
    expect(sinais.direcao).toContain('Pode estar certo; a Direção é que precisa dizer.')
    expect(sinais.governanca).toContain('1 decisão foi gravada com escopo sem o repo: «46».')
    expect(sinais.briefing).toContain('A fábrica ainda não registra o briefing do dia')
  })

  it('sinais: sem sem-repo, sem fora e sem DIRECAO.md', async () => {
    const semRepo = {
      ...PAINEL_F5,
      decisoes: PAINEL_F5.decisoes.filter((d) => d.secao !== 'sem-repo'),
      noCofre: 8,
    }
    readRelatorio.mockResolvedValue(ok({ ...semRepo, objetivos: null }))
    await abrir()
    const s = (n: string) => document.querySelector(`[data-sinal="${n}"]`)?.textContent ?? ''
    expect(s('governanca')).toContain('Nenhuma decisão do dia foi gravada com escopo sem o repo.')
    expect(s('direcao')).toContain('Sem fabrica/DIRECAO.md no repo do relatório')
    expect(s('direcao')).not.toContain('Pode estar certo')
    expect(s('direcao')).not.toContain('Fora dele')
  })

  it('as cinco decisões-chave, com os botões só nas abertas', async () => {
    await abrir()
    expect(screen.getAllByTestId('fabrica-relatorio-chave')).toHaveLength(5)
    await waitFor(() => {
      expect(chave(A4)?.getAttribute('data-estado')).toBe('confirmada')
    })
    expect(chave(A2)?.getAttribute('data-estado')).toBe('provisória')
    expect(within(chave(A2) as HTMLElement).getByTestId('fabrica-confirmar')).toBeTruthy()
    expect(within(chave(A3) as HTMLElement).getByText('irreversível')).toBeTruthy()
    expect(within(chave(A3) as HTMLElement).getByText(/Agrupar pelo card do escopo/)).toBeTruthy()
    expect(within(chave(A4) as HTMLElement).queryByTestId('fabrica-confirmar')).toBeNull()
    expect(within(chave(A4) as HTMLElement).getByTestId('fabrica-revisao').textContent).toMatch(
      /^Confirmada em /,
    )
    expect(screen.getAllByTestId('fabrica-confirmar')).toHaveLength(2)
    expect(
      screen.getByText(
        /confirmar ou contestar grava na fábrica, e a orquestradora substitui no cofre/,
      ),
    ).toBeTruthy()
  })

  it('"Ver no cofre" mostra e esconde o arquivo', async () => {
    await abrir()
    const c = within(chave(A2) as HTMLElement)
    fireEvent.click(c.getByTestId('fabrica-ver-no-cofre'))
    expect(c.getByTestId('fabrica-no-cofre').textContent).toBe(`No cofre: ${A2}`)
    fireEvent.click(c.getByTestId('fabrica-ver-no-cofre'))
    expect(c.queryByTestId('fabrica-no-cofre')).toBeNull()
  })

  it('estacionadas, rotina com commits e Amanhã', async () => {
    const { p } = await abrir()
    expect(screen.getByTestId('fabrica-relatorio-estacionada').textContent).toContain(
      'operations-center#122 · Pendência: a cor do crachá da pausa',
    )
    const rotina = screen.getByTestId('fabrica-relatorio-rotina')
    expect(within(rotina).getByText('E mais 2 de rotina')).toBeTruthy()
    expect(rotina.textContent).toContain('trilha, e 3 commits no git.')
    fireEvent.click(screen.getByTestId('fabrica-relatorio-abrir-trilha'))
    expect(p.ir).toHaveBeenCalledWith({ tela: 'portfolio', dia: '2026-11-10' })
    expect(screen.getByText(/A fábrica ainda não escreve o plano de amanhã/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('fabrica-relatorio-briefing'))
    expect(p.ir).toHaveBeenCalledWith({ tela: 'briefing' })
    fireEvent.click(screen.getByTestId('fabrica-relatorio-trilha'))
    expect(p.ir).toHaveBeenLastCalledWith({ tela: 'portfolio', dia: '2026-11-10' })
  })

  it('a migalha 0 volta à Sala (CA-E4)', async () => {
    const { p } = await abrir()
    fireEvent.click(screen.getByTestId('fabrica-trilha-0'))
    expect(p.ir).toHaveBeenCalledWith({ tela: 'sala' })
  })
})

describe('Relatório: o dia e o cache', () => {
  it('trocar o dia chama ir com o dia novo e ignora valor inválido ou igual', async () => {
    const { p } = await abrir()
    const campo = screen.getByTestId('relatorio-dia')
    fireEvent.change(campo, { target: { value: '2026-11-09' } })
    expect(p.ir).toHaveBeenCalledWith({ tela: 'relatorio', dia: '2026-11-09' })
    fireEvent.change(campo, { target: { value: '' } })
    expect(p.ir).toHaveBeenCalledTimes(1)
  })

  it('na mesma renderização em que o dia muda, nada do dia velho', async () => {
    const { rerender, p } = await abrir()
    readRelatorio.mockReturnValue(new Promise(() => undefined))
    rerender(<Relatorio {...p} tela={{ tela: 'relatorio', dia: '2026-11-09' }} />)
    expect(screen.queryByTestId('fabrica-relatorio-frase')).toBeNull()
    expect(screen.getByTestId('relatorio-gerando').textContent).toContain('09/11')
  })

  it('voltar a um dia já gerado usa o cache; "gerar de novo" pede outra vez', async () => {
    const { rerender, p } = await abrir()
    expect(readRelatorio).toHaveBeenCalledTimes(1)
    rerender(<Relatorio {...p} tela={{ tela: 'relatorio', dia: '2026-11-09' }} />)
    await screen.findByTestId('fabrica-relatorio-frase')
    expect(readRelatorio).toHaveBeenCalledTimes(2)
    rerender(<Relatorio {...p} tela={{ tela: 'relatorio', dia: '2026-11-10' }} />)
    await screen.findByTestId('fabrica-relatorio-frase')
    expect(readRelatorio).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByTestId('relatorio-gerar'))
    await waitFor(() => {
      expect(readRelatorio).toHaveBeenCalledTimes(3)
    })
    await screen.findByTestId('fabrica-relatorio-frase')
  })

  it('descarta o pedido antigo que chega depois do novo', async () => {
    const resolvers: Record<string, (v: RelatorioDaSala) => void> = {}
    readRelatorio.mockImplementation(({ dia }) => new Promise((r) => (resolvers[dia] = r)))
    const p = props()
    const { rerender } = render(<Relatorio {...p} />)
    await waitFor(() => {
      expect(resolvers['2026-11-10']).toBeDefined()
    })
    rerender(<Relatorio {...p} tela={{ tela: 'relatorio', dia: '2026-11-09' }} />)
    await waitFor(() => {
      expect(resolvers['2026-11-09']).toBeDefined()
    })
    await act(async () => {
      resolvers['2026-11-09']?.(ok(PAINEL_F5, '2026-11-09'))
      await Promise.resolve()
    })
    await act(async () => {
      resolvers['2026-11-10']?.(
        ok({ ...PAINEL_F5, frases: [{ card: 1, texto: 'VELHA' }] }, '2026-11-10'),
      )
      await Promise.resolve()
    })
    expect(screen.queryByText('VELHA')).toBeNull()
    expect(screen.getByTestId('fabrica-relatorio-frase')).toBeTruthy()
  })
})

describe('Relatório: confirmar e contestar (CA-5.2)', () => {
  it('Confirmar chama o comando e relê só as revisões', async () => {
    const comando = vi.fn<(c: ComandoDaFabrica) => Promise<void>>().mockResolvedValue(undefined)
    await abrir({ comando })
    await waitFor(() => {
      expect(screen.getAllByTestId('fabrica-confirmar')).toHaveLength(2)
    })
    const antes = readFabricaRevisoes.mock.calls.length
    const relAntes = readRelatorio.mock.calls.length
    readFabricaRevisoes.mockResolvedValue({
      kind: 'ok',
      ilegiveis: 0,
      revisoes: [REVISAO_A4, { ...REVISAO_A4, arquivo: A2 }],
    })
    fireEvent.click(within(chave(A2) as HTMLElement).getByTestId('fabrica-confirmar'))
    expect(comando).toHaveBeenCalledWith({ tipo: 'confirmar', arquivo: A2 })
    await waitFor(() => {
      expect(chave(A2)?.getAttribute('data-estado')).toBe('confirmada')
    })
    expect(readFabricaRevisoes.mock.calls.length).toBe(antes + 1)
    expect(readRelatorio.mock.calls.length).toBe(relAntes)
    expect(within(chave(A2) as HTMLElement).queryByTestId('fabrica-confirmar')).toBeNull()
  })

  it('Contestar só grava com motivo; grava, relê e fecha a caixa', async () => {
    const comando = vi.fn<(c: ComandoDaFabrica) => Promise<void>>().mockResolvedValue(undefined)
    await abrir({ comando })
    await waitFor(() => {
      expect(screen.getAllByTestId('fabrica-contestar')).toHaveLength(2)
    })
    const c = within(chave(A3) as HTMLElement)
    fireEvent.click(c.getByTestId('fabrica-contestar'))
    const gravar = c.getByTestId<HTMLButtonElement>('fabrica-contestar-gravar')
    expect(gravar.disabled).toBe(true)
    fireEvent.change(c.getByTestId('fabrica-contestar-motivo'), { target: { value: '  ' } })
    expect(gravar.disabled).toBe(true)
    fireEvent.change(c.getByTestId('fabrica-contestar-motivo'), {
      target: { value: 'a raiz tem de parar no épico' },
    })
    expect(gravar.disabled).toBe(false)
    readFabricaRevisoes.mockResolvedValue({
      kind: 'ok',
      ilegiveis: 0,
      revisoes: [
        REVISAO_A4,
        {
          arquivo: A3,
          veredito: 'contestada',
          em: '2026-11-11T10:00:00.000Z',
          motivo: 'a raiz tem de parar no épico',
          atendida: null,
        },
      ],
    })
    fireEvent.click(gravar)
    expect(comando).toHaveBeenCalledWith({
      tipo: 'contestar',
      arquivo: A3,
      motivo: 'a raiz tem de parar no épico',
    })
    await waitFor(() => {
      expect(chave(A3)?.getAttribute('data-estado')).toBe('contestada')
    })
    expect(within(chave(A3) as HTMLElement).getByTestId('fabrica-revisao').textContent).toContain(
      'a raiz tem de parar no épico',
    )
    expect(screen.queryByTestId('fabrica-contestar-motivo')).toBeNull()
  })

  it('Cancelar não chama nada', async () => {
    const comando = vi.fn<(c: ComandoDaFabrica) => Promise<void>>().mockResolvedValue(undefined)
    await abrir({ comando })
    await waitFor(() => {
      expect(screen.getAllByTestId('fabrica-contestar')).toHaveLength(2)
    })
    const c = within(chave(A2) as HTMLElement)
    fireEvent.click(c.getByTestId('fabrica-contestar'))
    fireEvent.click(c.getByTestId('fabrica-contestar-cancelar'))
    expect(c.queryByTestId('fabrica-contestar-motivo')).toBeNull()
    expect(comando).not.toHaveBeenCalled()
  })

  it('emVoo desabilita os botões', async () => {
    await abrir({ emVoo: true })
    await waitFor(() => {
      expect(screen.getAllByTestId('fabrica-confirmar')).toHaveLength(2)
    })
    for (const b of screen.getAllByTestId<HTMLButtonElement>('fabrica-confirmar'))
      expect(b.disabled).toBe(true)
  })

  it('sem readFabricaRevisoes no fake: aviso e botões desabilitados', async () => {
    instalar({ readRelatorio })
    await abrir()
    expect((await screen.findByTestId('fabrica-revisoes-erro')).textContent).toContain(
      'Não deu para ler as revisões',
    )
    for (const b of screen.getAllByTestId<HTMLButtonElement>('fabrica-confirmar'))
      expect(b.disabled).toBe(true)
    // Sem revisões, o número de provisórias não é sabido: "—", não todas como não revisadas.
    expect(kpi('provisorias')).toBe('—')
    expect(kpi('cofre')).toBe('12')
  })

  it('enquanto as revisões carregam, provisórias mostra "—"; ao chegar, o número', async () => {
    let resolver: (v: RevisoesNaSala) => void = () => undefined
    readFabricaRevisoes.mockReturnValue(new Promise((r) => (resolver = r)))
    await abrir()
    expect(kpi('provisorias')).toBe('—')
    expect(kpi('estacionadas')).toBe('1')
    await act(async () => {
      resolver(REVISOES)
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(kpi('provisorias')).toBe('2')
    })
  })

  it('linhas ilegíveis: singular e plural', async () => {
    readFabricaRevisoes.mockResolvedValue({ kind: 'ok', revisoes: [], ilegiveis: 1 })
    await abrir()
    expect((await screen.findByTestId('fabrica-revisoes-ilegiveis')).textContent).toBe(
      '1 linha do revisoes.jsonl não deu para ler',
    )
    cleanup()
    readFabricaRevisoes.mockResolvedValue({ kind: 'ok', revisoes: [], ilegiveis: 2 })
    await abrir()
    expect((await screen.findByTestId('fabrica-revisoes-ilegiveis')).textContent).toBe(
      '2 linhas do revisoes.jsonl não deram para ler',
    )
  })
})
