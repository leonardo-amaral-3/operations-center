// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Fabrica } from '../../src/renderer/fabrica/Fabrica'
import type {
  ComandoDaFabrica,
  PerguntaDaFila,
  ResultadoDoComando,
  SalaDaFabrica,
  SessaoDaMaquina,
  SessoesDaMaquina,
} from '../../src/shared/fabrica'
import { BOARDS_F2, RETRATO_F2 } from './retrato-f2'

/**
 * Agentes da F2 (#131, CA-2.2 e a parte de tela do CA-2.3) sobre o retrato literal da fixture `f2`:
 * a tabela de sessões, os cadeados, os próximos despachos e o texto fixo da queda. A ponte é falsa.
 */

const readFabrica = vi.fn<() => Promise<SalaDaFabrica>>()
const readFabricaPergunta = vi.fn<() => Promise<PerguntaDaFila | null>>()
const comandoFabrica = vi.fn<(c: ComandoDaFabrica) => Promise<ResultadoDoComando>>()

beforeEach(() => {
  readFabrica.mockReset().mockResolvedValue(RETRATO_F2)
  readFabricaPergunta.mockReset().mockResolvedValue(null)
  comandoFabrica.mockReset()
  Object.defineProperty(window, 'oc', {
    value: {
      readFabrica,
      readFabricaPergunta,
      readRelatorio: () => new Promise(() => {}),
      comandoFabrica,
      readBoards: () => Promise.resolve(BOARDS_F2),
      onBoards: () => () => {},
    },
    configurable: true,
  })
})

afterEach(cleanup)

const telaAtual = () => screen.getByTestId('fabrica-tela').dataset.tela

async function abrir(retrato: SalaDaFabrica = RETRATO_F2) {
  readFabrica.mockResolvedValue(retrato)
  render(<Fabrica />)
  await screen.findByTestId('fabrica-recursos')
  fireEvent.click(screen.getByTestId('fabrica-nav-agentes'))
  // Os títulos vêm do retrato de boards, que chega depois do retrato da fábrica.
  if (retrato.kind === 'ok' && retrato.emVoo.some((d) => d.card === 2)) {
    await waitFor(() => {
      expect(document.body.textContent).toContain('Peer dependencies')
    })
  }
}

function celulas(linha: HTMLElement): string[] {
  return within(linha)
    .getAllByRole('cell')
    .map((c) => c.textContent ?? '')
}

function ok(extra: Partial<Extract<SalaDaFabrica, { kind: 'ok' }>>): SalaDaFabrica {
  return { ...RETRATO_F2, ...extra }
}

describe('Agentes · sessões da fábrica', () => {
  it('lista os quatro em voo e os três parados, com a estação e o onde roda', async () => {
    await abrir()

    expect(telaAtual()).toBe('agentes')

    const vivos = screen.getAllByTestId('fabrica-agente')

    expect(vivos.map((l) => l.dataset.state)).toEqual([
      'rodando',
      'rodando',
      'pendente',
      'lancando',
    ])
    expect(screen.getAllByTestId('fabrica-agente-parado')).toHaveLength(3)

    const [c1, c4, c2, c951] = vivos.map(celulas)

    expect(c1?.[1]).toBe('Implementação')
    expect(c4?.[1]).toBe('Spec · G2')
    expect(c2?.[1]).toBe('Card · G1')
    expect(c951?.[1]).toBe('Revisão · G4')
    expect(c4?.[3]).toBe('planning/')
    expect(c2?.[3]).toBe('sem worktree')
    expect(c4?.[2]).toBe('gm-spec')
    expect(c2?.[0]).toContain('#2 Peer dependencies')
  })

  it('Transcrito e Assumir só em rodando e lancando, e levam ao card da linha', async () => {
    await abrir()

    const vivos = screen.getAllByTestId('fabrica-agente')

    for (const linha of vivos) {
      const acoes = within(linha).queryAllByTestId(/^fabrica-(transcrito|assumir)$/)

      expect(acoes).toHaveLength(linha.dataset.state === 'pendente' ? 0 : 2)
    }

    const segundo = vivos[1]

    if (segundo === undefined) throw new Error('sem a linha do #4')
    fireEvent.click(within(segundo).getByTestId('fabrica-transcrito'))
    expect(telaAtual()).toBe('card')
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('#4')

    fireEvent.click(screen.getByTestId('fabrica-trilha-0'))
    fireEvent.click(screen.getByTestId('fabrica-nav-agentes'))
    fireEvent.click(
      within(screen.getAllByTestId('fabrica-agente')[3] as HTMLElement).getByTestId(
        'fabrica-assumir',
      ),
    )
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('#951')
  })

  it('Responder leva à pergunta do item', async () => {
    await abrir()

    const parados = screen.getAllByTestId('fabrica-agente-parado')
    const primeiro = parados[0]

    if (primeiro === undefined) throw new Error('sem parado')
    fireEvent.click(within(primeiro).getByTestId('fabrica-agentes-responder'))
    expect(telaAtual()).toBe('pergunta')
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('Pergunta')
  })

  it('a sessão quebrada tem o seu texto e a que não está viva diz que o despachante recolhe', async () => {
    await abrir(
      ok({
        emVoo: RETRATO_F2.emVoo.map((d) => (d.card === 1 ? { ...d, viva: false } : d)),
      }),
    )

    expect(screen.getAllByTestId('fabrica-agente-parado').map((l) => celulas(l)[4])).toContain(
      'sessão quebrada',
    )
    expect(celulas(screen.getAllByTestId('fabrica-agente')[0] as HTMLElement)[4]).toBe(
      'sem sessão viva; o despachante recolhe quando rodar',
    )
  })

  it('a suíte ocupada pelo card marca a linha dele', async () => {
    await abrir(
      ok({
        recursos: { ...RETRATO_F2.recursos, suite: { kind: 'ocupada', card: 1, esperando: 0 } },
      }),
    )

    expect(celulas(screen.getAllByTestId('fabrica-agente')[0] as HTMLElement)[4]).toContain(
      ' · segura a suíte de smoke',
    )
  })
})

describe('Agentes · crachá e sessões fora do yarn fabrica (CA-2.3)', () => {
  it('mostra "1 de 3 sessões" e esconde o aviso quando as vivas são as da tabela', async () => {
    await abrir(
      ok({
        recursos: { ...RETRATO_F2.recursos, sessoes: { kind: 'ok', vivas: 3, teto: 3 } },
      }),
    )

    expect(screen.getByTestId('fabrica-sessoes').textContent).toBe('3 de 3 sessões')
    expect(screen.queryByTestId('fabrica-agentes-fora')).toBeNull()
  })

  it('1 de 3 sessões com três vivas na tabela não inventa sessão fora', async () => {
    await abrir()

    expect(screen.getByTestId('fabrica-sessoes').textContent).toBe('1 de 3 sessões')
    expect(screen.queryByTestId('fabrica-agentes-fora')).toBeNull()
  })

  it('com 5 vivas e 3 na tabela, avisa das 2 fora', async () => {
    await abrir(
      ok({
        recursos: { ...RETRATO_F2.recursos, sessoes: { kind: 'ok', vivas: 5, teto: 3 } },
      }),
    )

    expect(screen.getByTestId('fabrica-agentes-fora').textContent).toBe(
      '2 sessões da prova fora do yarn fabrica: contam no teto e não aparecem nesta tabela.',
    )
  })

  it('sem leitura das sessões: "sem leitura · teto 3" com o motivo, e nenhum aviso', async () => {
    await abrir(
      ok({
        recursos: {
          ...RETRATO_F2.recursos,
          sessoes: { kind: 'sem-leitura', motivo: 'lendo o mandato da dev', teto: 3 },
        },
      }),
    )

    const cracha = screen.getByTestId('fabrica-sessoes')

    expect(cracha.textContent).toBe('sem leitura · teto 3')
    expect(cracha.getAttribute('title')).toBe('lendo o mandato da dev')
    expect(screen.queryByTestId('fabrica-agentes-fora')).toBeNull()
  })
})

describe('Agentes · cadeados, próximos e a queda', () => {
  it('mostra os três cadeados com o texto de cada um', async () => {
    await abrir()

    const texto = screen.getByRole('heading', { name: 'Cadeados' }).closest('div')?.textContent

    expect(texto).toContain('Ninguém rodando a suíte. Uma suíte por vez na máquina (yarn smoke).')
    expect(texto).toContain('Esta fábrica não usa o Ghidra: não há cadeado a mostrar.')
    expect(texto).toContain(
      '50,0 GB livres na partição da fábrica. O mínimo da esteira é 2 GB; o despachante não confere o disco antes de lançar.',
    )
  })

  it('suíte ocupada com o #777 e fila vazia', async () => {
    await abrir(
      ok({
        recursos: { ...RETRATO_F2.recursos, suite: { kind: 'ocupada', card: 777, esperando: 0 } },
      }),
    )

    expect(screen.getByText(/Com o #777\. Fila vazia\./)).toBeTruthy()
  })

  it('o pendente aparece em Próximos despachos com a previsão', async () => {
    await abrir()

    const proximos = screen.getAllByTestId('fabrica-proximo')

    expect(proximos).toHaveLength(1)
    expect(proximos[0]?.textContent).toContain('#2 Peer dependencies')
    expect(proximos[0]?.textContent).toContain('/gm-card #2, sobe no próximo passo do despachante.')
  })

  it('sem pendente, o vazio de Próximos despachos', async () => {
    await abrir(ok({ emVoo: RETRATO_F2.emVoo.filter((d) => d.estado !== 'pendente') }))

    expect(screen.getByTestId('fabrica-proximos-vazio').textContent).toContain('Nada pendente.')
    expect(screen.queryByTestId('fabrica-proximo')).toBeNull()
  })

  it('mais de cinco pendentes: cinco itens e "e mais n"', async () => {
    const base = RETRATO_F2.emVoo[2]

    if (base === undefined) throw new Error('sem pendente')
    await abrir(
      ok({
        emVoo: Array.from({ length: 7 }, (_, i) => ({ ...base, id: `d-p${i}`, card: 100 + i })),
      }),
    )

    expect(screen.getAllByTestId('fabrica-proximo')).toHaveLength(5)
    expect(screen.getByText('e mais 2.')).toBeTruthy()
  })

  it('traz o texto fixo de "Se o PC cair"', async () => {
    await abrir()

    expect(screen.getByRole('heading', { name: 'Se o PC cair' })).toBeTruthy()
    expect(screen.getByText(/^Como na queda de 09\/11\/2026\./)).toBeTruthy()
    expect(screen.getByText(/^Nada é relançado sozinho:/)).toBeTruthy()
  })
})

describe('Agentes · fora do ramo ok', () => {
  it('sem retrato mostra o fabrica-lendo e nenhum crachá de sessões', () => {
    readFabrica.mockReturnValue(new Promise(() => {}))
    render(<Fabrica />)
    fireEvent.click(screen.getByTestId('fabrica-nav-agentes'))

    expect(screen.getByTestId('fabrica-lendo')).toBeTruthy()
    expect(screen.queryByTestId('fabrica-sessoes')).toBeNull()
  })

  it('sem-estado: a tabela vazia, o crachá do mandato e o vazio dos próximos', async () => {
    const { lidoEm, projeto, despachante, pausa, recursos } = RETRATO_F2

    await abrir({ kind: 'sem-estado', lidoEm, projeto, despachante, pausa, recursos })

    expect(screen.getByTestId('fabrica-agentes-vazio').textContent).toBe(
      'Nenhuma sessão da fábrica em voo.',
    )
    expect(screen.getByTestId('fabrica-sessoes').textContent).toBe('1 de 3 sessões')
    expect(screen.getByTestId('fabrica-proximos-vazio')).toBeTruthy()
  })

  it('ilegivel: o erro antes da tabela, que fica vazia', async () => {
    const { lidoEm, projeto, despachante, pausa, recursos } = RETRATO_F2

    await abrir({
      kind: 'ilegivel',
      lidoEm,
      projeto,
      despachante,
      pausa,
      recursos,
      erro: 'json torto',
    })

    expect(screen.getByTestId('fabrica-erro').textContent).toContain('json torto')
    expect(screen.getByTestId('fabrica-agentes-vazio')).toBeTruthy()
  })

  it('o Pausar continua no cabeçalho', async () => {
    await abrir()

    expect(screen.getByTestId('fabrica-pausar').textContent).toBe('Pausar fábrica')
  })
})

describe('Agentes · sessões da máquina (#142, CA-2 e CA-3)', () => {
  const OC = 'leonardo-amaral-3/operations-center'

  const sessao = (extra: Partial<SessaoDaMaquina>): SessaoDaMaquina => ({
    pid: 1,
    origem: 'interativa',
    daFabrica: false,
    skill: null,
    pasta: null,
    repo: null,
    card: null,
    cardUrl: null,
    ...extra,
  })

  const TRES: SessaoDaMaquina[] = [
    sessao({
      pid: 10,
      origem: 'despachada',
      daFabrica: true,
      skill: 'gm-spec',
      pasta: '~/pessoal/operations-center-2-x',
      repo: OC,
      card: 2,
      cardUrl: `https://github.com/${OC}/issues/2`,
    }),
    sessao({
      pid: 20,
      pasta: '~/notoria/plataformas-910-x',
      repo: 'icsf-solutions/plataformas',
      card: 910,
      cardUrl: 'https://github.com/icsf-solutions/plataformas/issues/910',
    }),
    sessao({ pid: 30, origem: 'sdk', pasta: '~/pessoal' }),
  ]

  async function abrirComMaquina(leitura: () => Promise<SessoesDaMaquina> | undefined) {
    Object.defineProperty(window, 'oc', {
      value: {
        ...window.oc,
        readFabricaSessoes: leitura,
      },
      configurable: true,
    })
    await abrir()
  }

  it('uma linha por sessão; a do operations-center tem botão que leva ao card', async () => {
    await abrirComMaquina(() => Promise.resolve({ kind: 'ok', lidoEm: 'x', sessoes: TRES }))

    const linhas = await screen.findAllByTestId('fabrica-maquina-sessao')

    expect(linhas).toHaveLength(3)

    const [oc, icsf, solta] = linhas as [HTMLElement, HTMLElement, HTMLElement]

    expect(celulas(oc)[1]).toBe(OC)
    expect(celulas(oc)[2]).toContain('despachada (-p)')
    expect(celulas(oc)[2]).toContain('yarn fabrica')
    expect(celulas(oc)[3]).toBe('gm-spec')
    expect(celulas(oc)[4]).toBe('~/pessoal/operations-center-2-x')
    expect(oc.dataset.pid).toBe('10')
    expect(oc.dataset.origem).toBe('despachada')

    fireEvent.click(within(oc).getByRole('button'))
    expect(telaAtual()).toBe('card')
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('#2')

    expect(celulas(icsf)[0]).toContain('#910')
    expect(within(icsf).queryByRole('button')).toBeNull()
    expect(celulas(icsf)[1]).toBe('icsf-solutions/plataformas')
    expect(celulas(icsf)[2]).toBe('interativa')

    expect(celulas(solta)[0]).toBe('sem leitura')
    expect(celulas(solta)[1]).toBe('sem leitura')
    expect(celulas(solta)[2]).toBe('SDK')
    expect(celulas(solta)[3]).toBe('—')
  })

  it('o título do card vem do board, pela URL em minúsculas', async () => {
    await abrirComMaquina(() => Promise.resolve({ kind: 'ok', lidoEm: 'x', sessoes: TRES }))

    const linhas = await screen.findAllByTestId('fabrica-maquina-sessao')

    await waitFor(() => {
      expect(celulas(linhas[0] as HTMLElement)[0]).toContain('Peer dependencies')
    })
  })

  it('card de outro repo não é botão, nem com card conhecido', async () => {
    await abrirComMaquina(() =>
      Promise.resolve({ kind: 'ok', lidoEm: 'x', sessoes: [TRES[1] as SessaoDaMaquina] }),
    )

    const [linha] = await screen.findAllByTestId('fabrica-maquina-sessao')

    expect(within(linha as HTMLElement).queryByRole('button')).toBeNull()
  })

  it('sem-leitura mostra o motivo', async () => {
    await abrirComMaquina(() => Promise.resolve({ kind: 'sem-leitura', motivo: 'só no Linux' }))

    const p = await screen.findByTestId('fabrica-maquina-sem-leitura')

    expect(p.textContent).toBe('sem leitura: só no Linux')
    expect(p.getAttribute('title')).toBe('só no Linux')
  })

  it('lista vazia mostra o vazio', async () => {
    await abrirComMaquina(() => Promise.resolve({ kind: 'ok', lidoEm: 'x', sessoes: [] }))

    expect((await screen.findByTestId('fabrica-maquina-vazio')).textContent).toBe(
      'Nenhuma sessão claude viva na máquina.',
    )
  })

  it('antes da primeira resposta, "Lendo as sessões da máquina…"', async () => {
    await abrirComMaquina(() => new Promise(() => {}))

    expect(screen.getByTestId('fabrica-maquina-lendo')).toBeTruthy()
  })

  it('sem o método no window.oc, sem-leitura', async () => {
    await abrir()

    expect((await screen.findByTestId('fabrica-maquina-sem-leitura')).textContent).toContain(
      'sem leitura',
    )
  })

  it('sem retrato da fábrica a seção não aparece', () => {
    readFabrica.mockReturnValue(new Promise(() => {}))
    render(<Fabrica />)
    fireEvent.click(screen.getByTestId('fabrica-nav-agentes'))

    expect(screen.queryByTestId('fabrica-maquina')).toBeNull()
  })
})
