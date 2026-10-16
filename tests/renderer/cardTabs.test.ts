import { describe, expect, it } from 'vitest'

import type { BoardCard, BoardTab, BoardsSnapshot } from '../../src/shared/board'
import { abasDeConversa } from '../../src/renderer/screens/cardTabs'

function card(itemId: string, number: number, title: string): BoardCard {
  return {
    itemId,
    number,
    title,
    url: `https://example.invalid/${itemId}`,
    repository: 'leonardo-amaral-3/operations-center',
    closed: false,
    assignees: [],
    columnId: 'COL',
    fields: [],
    parent: null,
    phases: [],
  }
}

function aba(key: string, cards: BoardCard[]): BoardTab {
  return {
    key,
    title: key,
    board: { title: key, columns: [], cards },
    readAt: 1,
    error: null,
  }
}

const retrato: BoardsSnapshot = {
  boards: [
    aba('dono/2', [card('PVTI_1', 10, 'Primeiro'), card('PVTI_2', 11, 'Segundo')]),
    aba('dono/7', [card('PVTI_3', 30, 'De outro board')]),
  ],
  activeKey: 'dono/2',
  discoveryError: null,
}

const SEM_DESTACADOS: ReadonlySet<string> = new Set()

describe('abasDeConversa', () => {
  it('duas conversas vivas e uma fechada dão duas abas, na ordem de chegada', () => {
    const abas = abasDeConversa(
      {
        PVTI_2: { kind: 'working' },
        PVTI_1: { kind: 'awaiting_input' },
        PVTI_3: { kind: 'closed' },
      },
      retrato,
      SEM_DESTACADOS,
    )

    expect(abas.map((a) => a.itemId)).toEqual(['PVTI_2', 'PVTI_1'])
    expect(abas[0]).toEqual({
      itemId: 'PVTI_2',
      number: 11,
      title: 'Segundo',
      state: { kind: 'working' },
      detached: false,
    })
  })

  it('itemId que o retrato não conhece fica de fora', () => {
    const abas = abasDeConversa(
      { PVTI_FANTASMA: { kind: 'working' }, PVTI_1: { kind: 'working' } },
      retrato,
      SEM_DESTACADOS,
    )

    expect(abas.map((a) => a.itemId)).toEqual(['PVTI_1'])
  })

  it('o card de outro board também ganha aba', () => {
    const abas = abasDeConversa({ PVTI_3: { kind: 'starting' } }, retrato, SEM_DESTACADOS)

    expect(abas).toHaveLength(1)
    expect(abas[0]).toMatchObject({ itemId: 'PVTI_3', number: 30 })
  })

  it('marca como destacado o que está no conjunto, e aguenta retrato ainda não lido', () => {
    const abas = abasDeConversa(
      { PVTI_1: { kind: 'working' } },
      retrato,
      new Set(['PVTI_1']),
    )

    expect(abas[0]?.detached).toBe(true)
    expect(
      abasDeConversa(
        { PVTI_1: { kind: 'working' } },
        { boards: null, activeKey: null, discoveryError: null },
        SEM_DESTACADOS,
      ),
    ).toEqual([])
  })
})
