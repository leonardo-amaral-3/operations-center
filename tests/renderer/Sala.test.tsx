// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Fabrica } from '../../src/renderer/fabrica/Fabrica'
import type { BoardCard, BoardsSnapshot } from '../../src/shared/board'
import type {
  ComandoDaFabrica,
  PerguntaDaFila,
  ResultadoDoComando,
  SalaDaFabrica,
} from '../../src/shared/fabrica'
import { BOARDS_F2, RETRATO_F2 } from './retrato-f2'

/**
 * A Sala da F2 (#131, CA-2.1) sobre o retrato literal da fixture `f2`: os quatro números, os três
 * cartões de "Esperando você", as nove colunas da Linha, os recursos e as decisões. A ponte é falsa.
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
}

function coluna(nome: string): HTMLElement {
  const el = screen.getAllByTestId('fabrica-coluna').find((c) => c.dataset.coluna === nome)
  if (el === undefined) throw new Error(`sem coluna ${nome}`)
  return el
}

/** O i-ésimo de uma lista que o retrato literal garante ter (o tsconfig não deixa indexar às cegas). */
function nth<T>(lista: readonly T[], i: number): T {
  const v = lista[i]
  if (v === undefined) throw new Error(`sem item ${i}`)
  return v
}

/** O cabeçalho que os três ramos do retrato dividem. */
function cabecalho() {
  const { lidoEm, projeto, despachante, pausa, recursos } = RETRATO_F2
  return { lidoEm, projeto, despachante, pausa, recursos }
}

function ok(extra: Partial<Extract<SalaDaFabrica, { kind: 'ok' }>>): SalaDaFabrica {
  return { ...RETRATO_F2, ...extra }
}

describe('Sala · resumo e Esperando você', () => {
  it('mostra os quatro números do retrato', async () => {
    await abrir()

    expect(screen.getByTestId('fabrica-resumo-esperando').textContent).toBe('3esperando você')
    expect(screen.getByTestId('fabrica-resumo-trabalhando').textContent).toBe(
      '3agentes trabalhando',
    )
    expect(screen.getByTestId('fabrica-resumo-cadeados').textContent).toBe('0cadeados ocupados')
    expect(screen.getByTestId('fabrica-resumo-quebradas').textContent).toBe('1sessão quebrada')
  })

  it('lista os três abertos, do mais antigo ao mais novo', async () => {
    await abrir()

    expect(screen.getAllByTestId('fabrica-aberto').map((a) => a.dataset.item)).toEqual([
      'q-0013',
      'q-0016',
      'q-0022',
    ])
  })

  it('Responder leva à Pergunta e Ver contexto ao Card, sem abrir o cartão', async () => {
    await abrir()
    const primeiro = nth(screen.getAllByTestId('fabrica-aberto'), 0)

    fireEvent.click(within(primeiro).getByTestId('fabrica-ver-contexto'))
    expect(telaAtual()).toBe('card')
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('#952')
    fireEvent.click(screen.getByTestId('fabrica-trilha-0'))

    fireEvent.click(
      within(nth(screen.getAllByTestId('fabrica-aberto'), 0)).getByTestId('fabrica-responder'),
    )
    expect(telaAtual()).toBe('pergunta')
  })

  it('clicar no cartão fora dos botões leva à Pergunta', async () => {
    await abrir()

    fireEvent.click(nth(screen.getAllByTestId('fabrica-aberto'), 1))
    expect(telaAtual()).toBe('pergunta')
  })

  it('o cartão leva o chip, o motivo e a etiqueta do card com a estação', async () => {
    await abrir()
    const quebrado = nth(screen.getAllByTestId('fabrica-aberto'), 1)

    expect(within(quebrado).getByText('Pergunta')).toBeTruthy()
    expect(within(quebrado).getByText('sessão quebrada')).toBeTruthy()
    expect(within(quebrado).getByText('#953 · Implementação')).toBeTruthy()
    expect(within(quebrado).getByText('a sessão terminou sem saída')).toBeTruthy()
  })

  it('um item de decisão mostra Aprovar e só o botão Revisar evidência', async () => {
    const decisao = { ...nth(RETRATO_F2.abertos, 0), tipo: 'decisao' as const }

    await abrir(ok({ abertos: [decisao] }))
    const cartao = screen.getByTestId('fabrica-aberto')

    expect(within(cartao).getByText('Aprovar')).toBeTruthy()
    expect(within(cartao).getByText('Revisar evidência')).toBeTruthy()
    expect(within(cartao).queryByTestId('fabrica-ver-contexto')).toBeNull()
    fireEvent.click(within(cartao).getByTestId('fabrica-responder'))
    expect(telaAtual()).toBe('decisao')
  })

  it('sem abertos mostra "Nada esperando você."', async () => {
    await abrir(ok({ abertos: [] }))

    expect(screen.getByTestId('fabrica-nada-esperando').textContent).toBe('Nada esperando você.')
  })
})

describe('Sala · Linha de produção', () => {
  it('tem as nove colunas, na ordem do protótipo', async () => {
    await abrir()

    expect(screen.getAllByTestId('fabrica-coluna').map((c) => c.dataset.coluna)).toEqual([
      'entrada',
      'card',
      'spec',
      'implementacao',
      'integracao',
      'revisao',
      'validacao',
      'release',
      'operacao',
    ])
  })

  it('põe cada despacho e cada item aberto na coluna da sua estação', async () => {
    await abrir()

    const conteudo = (nome: string) => coluna(nome).textContent ?? ''

    expect(conteudo('entrada')).toContain('#952')
    expect(conteudo('entrada')).toContain('PARADA')
    expect(conteudo('card')).toContain('#2 Peer dependencies')
    expect(conteudo('card')).toContain('na fila de lançamento')
    expect(conteudo('spec')).toContain('#4 Ler o board')
    expect(conteudo('implementacao')).toContain('#1 Fundar o operations-center')
    expect(conteudo('implementacao')).toContain('#953')
    expect(conteudo('implementacao')).toContain('FALHA')
    expect(conteudo('revisao')).toContain('#951')
    expect(conteudo('revisao')).toContain('#955')
    expect(conteudo('revisao')).toContain('PARADA')
    expect(conteudo('integracao')).toContain('O merge na dev é da orquestradora')
    expect(conteudo('validacao')).toContain('A validação em dev é sua')
    expect(conteudo('release')).toContain('Trem vazio.')
    expect(conteudo('operacao')).toContain('A fábrica não observa produção nesta prova.')
  })

  it('as etiquetas Tipo e Rota vão no #1 e nenhuma no #951', async () => {
    await abrir()

    const no1 = within(coluna('implementacao'))
    const no2 = within(coluna('card'))
    const no951 = within(coluna('revisao'))

    expect(no1.getAllByTitle(/^(Tipo|Rota): /).map((e) => e.getAttribute('data-field'))).toEqual([
      'Tipo',
      'Rota',
    ])
    expect(no2.getAllByTitle(/^Tipo: /)).toHaveLength(1)
    expect(no2.queryByTitle(/^Rota: /)).toBeNull()
    expect(no951.queryByTitle(/^(Tipo|Rota): /)).toBeNull()
  })

  it('o rótulo "Entrada" aparece uma vez só dentro da tela (o da navegação)', async () => {
    await abrir()

    const tela = screen.getByTestId('fabrica-tela')
    // O harness da F1 acha o rótulo pelo `getByText(..., { exact: true })` do Playwright, que casa o
    // texto **inteiro** do elemento. O matcher do Testing Library olha só os nós de texto próprios,
    // então aqui a regra do Playwright é reproduzida: o `.colhead` tem texto "EntradaA" e não casa.
    const casam = Array.from(tela.querySelectorAll('*')).filter(
      (el) => el.textContent?.trim() === 'Entrada',
    )

    expect(casam).toHaveLength(1)
    expect(nth(casam, 0).getAttribute('data-testid')).toBe('fabrica-nav-entrada')
  })

  it('o cabeçalho de coluna leva o rótulo como texto direto e o nível', async () => {
    await abrir()

    expect(coluna('entrada').firstElementChild?.textContent).toBe('EntradaA')
    expect(coluna('release').firstElementChild?.textContent).toBe('Release · G5C')
  })

  it('"agentes trabalhando" leva a Agentes', async () => {
    await abrir()

    fireEvent.click(screen.getByText('agentes trabalhando'))
    expect(telaAtual()).toBe('agentes')
  })

  it('um despacho com viva false mostra "sem sessão viva" e sai da contagem', async () => {
    const primeiro = nth(RETRATO_F2.emVoo, 0)
    const resto = RETRATO_F2.emVoo.slice(1)

    await abrir(ok({ emVoo: [{ ...primeiro, viva: false }, ...resto] }))

    expect(within(coluna('implementacao')).getByText(/sem sessão viva/)).toBeTruthy()
    expect(screen.getByTestId('fabrica-resumo-trabalhando').textContent).toBe(
      '2agentes trabalhando',
    )
  })

  it('um despacho sem estação aparece em "Fora da linha" como fabrica-em-voo', async () => {
    const solto = {
      ...nth(RETRATO_F2.emVoo, 0),
      id: 'd-0099',
      card: 960,
      cardUrl: 'https://example.invalid/960',
      estacao: null,
      comando: 'yarn x',
    }

    await abrir(ok({ emVoo: [solto] }))

    const fora = screen.getByTestId('fabrica-linha-fora')

    expect(fora.textContent).toContain('Fora da linha:')
    expect(within(fora).getByTestId('fabrica-em-voo').textContent).toBe('#960 yarn x')
    expect(within(fora).getByTestId('fabrica-em-voo').dataset.state).toBe('rodando')
    fireEvent.click(within(fora).getByTestId('fabrica-em-voo'))
    expect(telaAtual()).toBe('card')
  })

  it('a suíte ocupada pelo card 1 põe o cadeado no cartão do #1', async () => {
    await abrir(
      ok({
        recursos: {
          ...RETRATO_F2.recursos,
          suite: { kind: 'ocupada', card: 1, esperando: 0 },
        },
      }),
    )

    expect(within(coluna('implementacao')).getByTestId('fabrica-segura-suite').textContent).toBe(
      'suíte de smoke',
    )
    expect(screen.getAllByTestId('fabrica-segura-suite')).toHaveLength(1)
    expect(screen.getByTestId('fabrica-resumo-cadeados').textContent).toBe('1cadeado ocupado')
    expect(screen.getByTestId('fabrica-recurso-suite').textContent).toBe('#1 · fila vazia')
  })
})

describe('Sala · Recursos e decisões', () => {
  it('mostra os cinco recursos do retrato saudável', async () => {
    await abrir()

    expect(screen.getByTestId('fabrica-recurso-sessoes').textContent).toContain('1 de 3')
    expect(screen.getByTestId('fabrica-recurso-suite').textContent).toBe('livre')
    expect(screen.getByTestId('fabrica-recurso-disco').textContent).toBe('acima de 2 GB')
    expect(screen.getByTestId('fabrica-recurso-disco').title).toBe('50,0 GB livres')
    expect(screen.getByText('Cópias do Ghidra')).toBeTruthy()
    expect(screen.getByTitle('esta fábrica não usa o Ghidra').textContent).toBe('não se aplica')
    expect(screen.getByTitle('o app não lê a cota do plano do Claude').textContent).toBe(
      'sem leitura',
    )
  })

  it('"sem leitura" nunca vira número, e o motivo fica no title', async () => {
    await abrir(
      ok({
        recursos: {
          sessoes: { kind: 'sem-leitura', motivo: 'lendo o mandato da dev', teto: 3 },
          suite: { kind: 'sem-leitura', motivo: 'só no Linux' },
          disco: { kind: 'sem-leitura', motivo: 'statfs falhou' },
        },
      }),
    )

    expect(
      screen.getByText('sem leitura', { selector: '[title="lendo o mandato da dev"]' }),
    ).toBeTruthy()
    expect(screen.getByTestId('fabrica-resumo-cadeados').textContent).toBe('—cadeados ocupados')
    expect(screen.getByTestId('fabrica-resumo-cadeados').title).toBe('só no Linux')
    expect(screen.getByTestId('fabrica-recurso-suite').textContent).toBe('sem leitura')
    expect(screen.getByTestId('fabrica-recurso-disco').title).toBe('statfs falhou')
  })

  it('disco abaixo do mínimo é "abaixo de 2 GB"', async () => {
    await abrir(
      ok({
        recursos: {
          ...RETRATO_F2.recursos,
          disco: { kind: 'ok', livres: 1024 ** 3, minimo: 2 * 1024 ** 3 },
        },
      }),
    )

    expect(screen.getByTestId('fabrica-recurso-disco').textContent).toBe('abaixo de 2 GB')
  })

  it('lista as seis decisões na ordem, com o fechado e o link do mandato', async () => {
    await abrir()

    const tela = screen.getByTestId('fabrica-tela')
    const passou = within(tela).getAllByTestId('fabrica-decidiu')

    expect(passou.map((p) => p.textContent)).toEqual([
      'AG3 do #1 passou; o próximo passo é /gm-implement.',
      'AG2 do #1 passou; o próximo passo é /gm-plan-tasks.',
    ])
    expect(within(tela).getAllByTestId('fabrica-parou')).toHaveLength(3)
    expect(within(tela).getByTestId('fabrica-fechado').textContent).toContain(
      'resolvido: seguir sem segundo revisor',
    )

    fireEvent.click(screen.getByTestId('fabrica-ver-mandato'))
    expect(telaAtual()).toBe('mandato')
  })

  it('sem decisões diz "Nada decidido ainda."', async () => {
    await abrir(ok({ decisoes: [] }))

    expect(screen.getByText('Nada decidido ainda.')).toBeTruthy()
  })
})

describe('Sala · os outros ramos do retrato', () => {
  it('sem-estado mostra a mensagem e os Recursos', async () => {
    await abrir({ kind: 'sem-estado', ...cabecalho() })

    expect(screen.getByTestId('fabrica-vazia').textContent).toContain(
      'Nenhum despacho registrado ainda.',
    )
    expect(screen.getByTestId('fabrica-recursos')).toBeTruthy()
    expect(screen.queryByTestId('fabrica-resumo-esperando')).toBeNull()
  })

  it('ilegivel mostra o erro e os Recursos', async () => {
    await abrir({ kind: 'ilegivel', erro: 'JSON torto', ...cabecalho() })

    expect(screen.getByTestId('fabrica-erro').textContent).toContain('JSON torto')
    expect(screen.getByTestId('fabrica-recursos')).toBeTruthy()
  })

  it('enquanto lê, mostra "Lendo o estado da fábrica…"', () => {
    readFabrica.mockReturnValue(new Promise(() => {}))
    render(<Fabrica />)

    expect(screen.getByTestId('fabrica-lendo').textContent).toBe('Lendo o estado da fábrica…')
  })

  it('sem retrato de boards, o card aparece só com o número', async () => {
    Object.defineProperty(window, 'oc', {
      value: {
        ...window.oc,
        readBoards: () => Promise.resolve({ boards: [], activeKey: null, discoveryError: null }),
      },
      configurable: true,
    })
    await abrir()
    await waitFor(() => {
      expect(coluna('implementacao').textContent).toContain('#1')
    })

    expect(coluna('implementacao').textContent).not.toContain('Fundar o operations-center')
    expect(within(coluna('implementacao')).queryByTitle(/^Tipo: /)).toBeNull()
  })
})

/** A Linha segue a aba selecionada (#142, CA-1 e CA-3). */
describe('Sala · a Linha segue a aba', () => {
  const PLAT = 'https://github.com/ICSF-Solutions/plataformas/issues'

  function card(
    repo: string,
    number: number,
    columnId: string,
    title = `card ${number}`,
  ): BoardCard {
    return {
      itemId: `PVTI_t_${repo}_${number}`,
      number,
      title,
      url: `https://github.com/${repo}/issues/${number}`,
      repository: repo,
      closed: false,
      assignees: [],
      columnId,
      fields: [],
      parent: null,
      phases: [],
    }
  }

  const COLUNAS = [
    { id: 'c-spec', name: '🎯 Especificação', conversable: true, triage: false },
    { id: 'c-back', name: '📋 Backlog', conversable: false, triage: false },
  ]

  function snapshot(
    activeKey: string | null,
    extra: BoardsSnapshot['boards'] = [],
  ): BoardsSnapshot {
    return {
      boards: [
        ...BOARDS_F2.boards!,
        {
          key: 'ICSF-Solutions/19',
          title: 'Plataformas v2',
          readAt: 1,
          error: null,
          board: {
            title: 'Plataformas v2',
            columns: COLUNAS,
            cards: [
              card('ICSF-Solutions/plataformas', 910, 'c-spec', 'Plataforma nova'),
              card('ICSF-Solutions/plataformas', 911, 'c-back', 'Ideia solta'),
            ],
          },
        },
        ...(extra ?? []),
      ],
      activeKey,
      discoveryError: null,
    }
  }

  let empurrar: (s: BoardsSnapshot) => void = () => {}

  function comBoards(retrato: BoardsSnapshot | null) {
    Object.defineProperty(window, 'oc', {
      value: {
        ...window.oc,
        readBoards: () => Promise.resolve(retrato as BoardsSnapshot),
        onBoards: (cb: (s: BoardsSnapshot) => void) => {
          empurrar = cb
          return () => {}
        },
      },
      configurable: true,
    })
  }

  const texto = () => screen.getByTestId('fabrica-linha-board').textContent

  it('(b) com a aba do Plataformas, o #910 está na spec, o #952 sai da entrada e o rótulo diz a aba', async () => {
    comBoards(snapshot('ICSF-Solutions/19'))
    await abrir()
    await waitFor(() => {
      expect(texto()).toBe('board Plataformas v2')
    })

    const spec = within(coluna('spec'))
    const cardDoBoard = spec.getByTestId('fabrica-board-card')
    expect(cardDoBoard.dataset.card).toBe(`${PLAT}/910`)
    expect(cardDoBoard.textContent).toContain('#910')
    expect(spec.queryByTestId('fabrica-board-card-abrir')).toBeNull()
    expect(coluna('entrada').textContent).not.toContain('#952')
    expect(screen.queryAllByTestId('fabrica-em-voo')).toHaveLength(0)
  })

  it('(c) o snapshot empurrado com a aba do Project 2 devolve o #952 sem remontar', async () => {
    comBoards(snapshot('ICSF-Solutions/19'))
    await abrir()
    await waitFor(() => {
      expect(coluna('spec').textContent).toContain('#910')
    })
    const recursos = screen.getByTestId('fabrica-recursos')

    act(() => {
      empurrar(snapshot('leonardo-amaral-3/2'))
    })

    await waitFor(() => {
      expect(coluna('entrada').textContent).toContain('#952')
    })
    expect(coluna('spec').textContent).not.toContain('#910')
    expect(texto()).toBe('board Operations Center')
    expect(screen.getByTestId('fabrica-recursos')).toBe(recursos)
  })

  it('(d) o card do Backlog vai para "Fora das estações da linha", agrupado pelo nome da coluna', async () => {
    comBoards(snapshot('ICSF-Solutions/19'))
    await abrir()

    const grupo = await screen.findByTestId('fabrica-a-parte-coluna')
    expect(grupo.dataset.colunaDoBoard).toBe('📋 Backlog')
    expect(grupo.textContent).toContain('#911')
  })

  it('(e) sem-estado com o board ok mostra a mensagem e o card do board', async () => {
    comBoards(snapshot('ICSF-Solutions/19'))
    await abrir({ kind: 'sem-estado', ...cabecalho() })

    expect(screen.getByTestId('fabrica-vazia')).toBeTruthy()
    await waitFor(() => {
      expect(within(coluna('spec')).getByTestId('fabrica-board-card').textContent).toContain('#910')
    })
  })

  it("(e') ilegivel com o board ok mostra o erro e o card do board", async () => {
    comBoards(snapshot('ICSF-Solutions/19'))
    await abrir({ kind: 'ilegivel', erro: 'JSON torto', ...cabecalho() })

    expect(screen.getByTestId('fabrica-erro')).toBeTruthy()
    await waitFor(() => {
      expect(within(coluna('spec')).getByTestId('fabrica-board-card').textContent).toContain('#910')
    })
  })

  it('(f) card do operations-center sem despacho abre a tela Card', async () => {
    const retrato = snapshot('leonardo-amaral-3/2')
    const aba = retrato.boards![0]!
    const novo = card('leonardo-amaral-3/operations-center', 77, 'da732a01', 'Sem despacho')
    comBoards({
      ...retrato,
      boards: [{ ...aba, board: { ...aba.board!, cards: [...aba.board!.cards, novo] } }],
    })
    await abrir()

    const botao = await within(coluna('implementacao')).findByTestId('fabrica-board-card-abrir')
    expect(botao.textContent).toContain('#77')
    fireEvent.click(botao)

    expect(telaAtual()).toBe('card')
  })

  it('(g) o rótulo do board em cada ramo', async () => {
    comBoards(null)
    await abrir()
    expect(texto()).toBe('lendo os boards…')
    cleanup()

    comBoards(snapshot(null))
    await abrir()
    await waitFor(() => {
      expect(texto()).toBe('nenhum board selecionado')
    })
    cleanup()

    const semBoard = snapshot('ICSF-Solutions/19')
    const abas = semBoard.boards!.map((a) =>
      a.key === 'ICSF-Solutions/19' ? { ...a, board: null } : a,
    )
    comBoards({ ...semBoard, boards: abas })
    await abrir()
    await waitFor(() => {
      expect(texto()).toBe('board Plataformas v2 · lendo…')
    })
    cleanup()

    comBoards({
      ...semBoard,
      boards: abas.map((a) => (a.key === 'ICSF-Solutions/19' ? { ...a, error: 'rede caiu' } : a)),
    })
    await abrir()
    await waitFor(() => {
      expect(texto()).toBe('board Plataformas v2 · sem leitura')
    })
    expect(screen.getByTestId('fabrica-linha-board').getAttribute('title')).toBe('rede caiu')
  })
})
