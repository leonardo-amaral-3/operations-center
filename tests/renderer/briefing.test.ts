import { describe, expect, it } from 'vitest'

import type { Board, BoardCard, BoardsSnapshot } from '../../src/shared/board'
import type { SalaDaFabrica } from '../../src/shared/fabrica'
import {
  CHAVE_DO_BOARD_DA_FABRICA,
  REPO_DOS_CARDS_DA_FABRICA,
  boardDaFabrica,
  chaveDoCard,
  colunaDoCard,
  estacaoDaColuna,
  repoDaFabrica,
} from '../../src/renderer/fabrica/boardDaFabrica'
import {
  NAO_FAZER_HOJE,
  comandoDaFrente,
  frentesDoBriefing,
  notaDoBriefing,
} from '../../src/renderer/fabrica/briefing'
import { BOARD_DE_DOIS_REPOS, BOARD_DO_PROJECT_2 } from './boardNaFabrica'

const COLUNAS = [
  { id: 'c-tri', name: '📥 Triagem' },
  { id: 'c-bac', name: '📋 Backlog' },
  { id: 'c-esp', name: '🎯 Especificação' },
  { id: 'c-rel', name: '🚂 Release' },
]

function card(n: number, columnId: string, parcial: Partial<BoardCard> = {}): BoardCard {
  return {
    itemId: `PVTI_${n}`,
    number: n,
    title: `Card ${n}`,
    url: `https://github.com/${REPO_DOS_CARDS_DA_FABRICA}/issues/${n}`,
    repository: REPO_DOS_CARDS_DA_FABRICA,
    closed: false,
    assignees: [],
    columnId,
    fields: [],
    parent: null,
    phases: [],
    ...parcial,
  }
}

function boardDe(cards: BoardCard[]): Board {
  return { title: 'Operations Center', columns: COLUNAS, cards } as unknown as Board
}

describe('boardDaFabrica', () => {
  const ALVO = BOARD_DO_PROJECT_2
  const aba = (parcial: Record<string, unknown>) => ({
    key: CHAVE_DO_BOARD_DA_FABRICA,
    title: 'x',
    board: null,
    readAt: null,
    error: null,
    ...parcial,
  })
  const snap = (boards: unknown, discoveryError: string | null = null): BoardsSnapshot =>
    ({ boards, activeKey: null, discoveryError }) as BoardsSnapshot

  it('sem retrato ou sem descoberta, lendo', () => {
    expect(boardDaFabrica(null, ALVO)).toEqual({ kind: 'lendo' })
    expect(boardDaFabrica(snap(null), ALVO)).toEqual({ kind: 'lendo' })
  })

  it('sem a aba do Project 2, erro, com o erro da descoberta quando há', () => {
    const r = boardDaFabrica(snap([]), ALVO)
    expect(r).toEqual({
      kind: 'erro',
      erro: 'o board do Operations Center (Project 2) não está entre os boards do app',
    })
    const r2 = boardDaFabrica(snap([], 'sem rede'), ALVO)
    expect(r2.kind === 'erro' && r2.erro.endsWith(': sem rede')).toBe(true)
  })

  it('aba sem board: o erro dela, ou lendo', () => {
    expect(boardDaFabrica(snap([aba({ error: 'caiu' })]), ALVO)).toEqual({
      kind: 'erro',
      erro: 'caiu',
    })
    expect(boardDaFabrica(snap([aba({})]), ALVO)).toEqual({ kind: 'lendo' })
  })

  it('com board, ok, mesmo com erro preenchido', () => {
    const board = boardDe([])
    expect(boardDaFabrica(snap([aba({ board, error: 'velho' })]), ALVO)).toEqual({
      kind: 'ok',
      board,
    })
  })
})

describe('colunaDoCard e estacaoDaColuna', () => {
  it('o nome da coluna, ou vazio', () => {
    const b = boardDe([])
    expect(colunaDoCard(b, card(1, 'c-bac'))).toBe('📋 Backlog')
    expect(colunaDoCard(b, card(1, 'zzz'))).toBe('')
  })

  it('as três estações, sem emoji nem caixa; o resto é outra', () => {
    expect(estacaoDaColuna('📥 Triagem')).toBe('triagem')
    expect(estacaoDaColuna('📋 Backlog')).toBe('backlog')
    expect(estacaoDaColuna('🚂 Release')).toBe('release')
    expect(estacaoDaColuna('release')).toBe('release')
    expect(estacaoDaColuna('🎯 Especificação')).toBe('outra')
    expect(estacaoDaColuna('')).toBe('outra')
  })
})

describe('frentesDoBriefing', () => {
  const board = boardDe([
    card(1, 'c-tri'),
    card(2, 'c-bac'),
    card(3, 'c-bac', { closed: true }),
    card(4, 'c-bac', { repository: 'outro/repo' }),
    card(5, 'c-esp'),
    card(6, 'c-rel'),
    card(7, 'c-bac'),
    card(8, 'c-tri'),
  ])

  it('só os abertos do repo da fábrica, Backlog antes, na ordem do board', () => {
    const f = frentesDoBriefing(board, null, BOARD_DO_PROJECT_2)
    expect(f.map((x) => x.card)).toEqual([2, 7, 1, 8])
    expect(f[0]).toMatchObject({
      repo: REPO_DOS_CARDS_DA_FABRICA,
      coluna: '📋 Backlog',
      comando: '/gm-spec #2',
      titulo: 'Card 2',
    })
    expect(f[2]).toMatchObject({ coluna: '📥 Triagem', comando: '/gm-card #1' })
  })

  it('emVoo pela sala ok; falso com sem-estado ou null', () => {
    const ok = {
      kind: 'ok',
      emVoo: [{ card: 7, repo: REPO_DOS_CARDS_DA_FABRICA }],
      abertos: [],
    } as unknown as SalaDaFabrica
    const semEstado = { kind: 'sem-estado' } as unknown as SalaDaFabrica
    expect(frentesDoBriefing(board, ok, BOARD_DO_PROJECT_2).map((x) => x.emVoo)).toEqual([
      false,
      true,
      false,
      false,
    ])
    expect(frentesDoBriefing(board, semEstado, BOARD_DO_PROJECT_2).some((x) => x.emVoo)).toBe(false)
    expect(frentesDoBriefing(board, null, BOARD_DO_PROJECT_2).some((x) => x.emVoo)).toBe(false)
  })

  it('abertos: os itens abertos da fila de cada card (G4 da PR #141, menor 3)', () => {
    const ok = {
      kind: 'ok',
      emVoo: [],
      abertos: [
        { id: 'q-0003', card: 7, repo: REPO_DOS_CARDS_DA_FABRICA },
        { id: 'q-0005', card: 99, repo: REPO_DOS_CARDS_DA_FABRICA },
        { id: 'q-0008', card: 7, repo: REPO_DOS_CARDS_DA_FABRICA },
      ],
    } as unknown as SalaDaFabrica
    expect(
      frentesDoBriefing(board, ok, BOARD_DO_PROJECT_2).map((x) => [x.card, x.abertos]),
    ).toEqual([
      [2, []],
      [7, ['q-0003', 'q-0008']],
      [1, []],
      [8, []],
    ])
    const semEstado = { kind: 'sem-estado' } as unknown as SalaDaFabrica
    expect(
      frentesDoBriefing(board, semEstado, BOARD_DO_PROJECT_2).every((x) => x.abertos.length === 0),
    ).toBe(true)
    expect(
      frentesDoBriefing(board, null, BOARD_DO_PROJECT_2).every((x) => x.abertos.length === 0),
    ).toBe(true)
  })

  it('o mesmo número em dois repos do board: duas frentes, e só a do repo em voo marca emVoo', () => {
    const doisRepos = boardDe([
      card(5, 'c-bac', {
        repository: 'fulano/repo-a',
        url: 'https://github.com/fulano/repo-a/issues/5',
      }),
      card(5, 'c-bac', {
        repository: 'Fulano/Repo-B',
        url: 'https://github.com/fulano/repo-b/issues/5',
      }),
      card(5, 'c-bac', { repository: 'outro/x' }),
    ])
    const ok = {
      kind: 'ok',
      emVoo: [{ card: 5, repo: 'fulano/repo-b' }],
      abertos: [{ id: 'q-0001', card: 5, repo: 'fulano/repo-a' }],
    } as unknown as SalaDaFabrica
    const f = frentesDoBriefing(doisRepos, ok, BOARD_DE_DOIS_REPOS)
    expect(f.map((x) => [x.repo, x.chave, x.emVoo, x.abertos])).toEqual([
      ['fulano/repo-a', 'fulano/repo-a#5', false, ['q-0001']],
      ['fulano/repo-b', 'fulano/repo-b#5', true, []],
    ])
  })

  it('comandoDaFrente', () => {
    expect(comandoDaFrente('backlog', 940)).toBe('/gm-spec #940')
    expect(comandoDaFrente('triagem', 941)).toBe('/gm-card #941')
  })
})

describe('notaDoBriefing', () => {
  const dia = '2026-11-12'
  it('os quatro casos', () => {
    expect(notaDoBriefing({ dia, prontoQuando: '', contexto: '' })).toBe(
      'Briefing do dia 12/11, solto pela tela Briefing.',
    )
    expect(notaDoBriefing({ dia, prontoQuando: 'a spec sai', contexto: '' })).toBe(
      'Briefing do dia 12/11: pronto quando a spec sai.',
    )
    expect(notaDoBriefing({ dia, prontoQuando: '', contexto: 'dia calmo' })).toBe(
      'Briefing do dia 12/11. Contexto do dia: dia calmo.',
    )
    expect(notaDoBriefing({ dia, prontoQuando: 'a spec sai', contexto: 'dia calmo' })).toBe(
      'Briefing do dia 12/11: pronto quando a spec sai. Contexto do dia: dia calmo.',
    )
  })

  it('junta espaço e quebra de linha, tira a pontuação final e nunca começa por --', () => {
    const n = notaDoBriefing({
      dia,
      prontoQuando: '  a spec\n\n  sai;. ',
      contexto: 'dia\tcalmo,\r\nmesmo',
    })
    expect(n).toBe(
      'Briefing do dia 12/11: pronto quando a spec sai. Contexto do dia: dia calmo, mesmo.',
    )
    expect(n).not.toMatch(/[\n\r]/)
    expect(n.startsWith('--')).toBe(false)
  })

  it('só pontuação conta como vazio', () => {
    expect(notaDoBriefing({ dia, prontoQuando: ' .. ', contexto: ';' })).toBe(
      'Briefing do dia 12/11, solto pela tela Briefing.',
    )
  })
})

describe('NAO_FAZER_HOJE', () => {
  it('são as três regras', () => {
    expect(NAO_FAZER_HOJE).toHaveLength(3)
  })
})

describe('repoDaFabrica e chaveDoCard', () => {
  it('lista: o item igual sem caixa, na grafia do board; fora da lista, null', () => {
    expect(repoDaFabrica(BOARD_DE_DOIS_REPOS, 'FULANO/Repo-B')).toBe('fulano/repo-b')
    expect(repoDaFabrica(BOARD_DE_DOIS_REPOS, 'fulano/repo-c')).toBeNull()
    expect(repoDaFabrica(BOARD_DO_PROJECT_2, REPO_DOS_CARDS_DA_FABRICA.toUpperCase())).toBe(
      REPO_DOS_CARDS_DA_FABRICA,
    )
  })

  it("forma '<owner>/*': o owner do board, com o name como veio", () => {
    const estrela = { repos: null, owner: 'Fulano' }
    expect(repoDaFabrica(estrela, 'fulano/Qualquer')).toBe('Fulano/Qualquer')
    expect(repoDaFabrica(estrela, 'outro/Qualquer')).toBeNull()
    expect(repoDaFabrica(estrela, 'fulano')).toBeNull()
    expect(repoDaFabrica(estrela, 'fulano/a/b')).toBeNull()
  })

  it('chaveDoCard em minúsculas', () => {
    expect(chaveDoCard('Fulano/Repo-B', 5)).toBe('fulano/repo-b#5')
  })
})
