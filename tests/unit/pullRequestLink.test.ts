import { describe, expect, it } from 'vitest'

import { pickPullRequest } from '../../src/core/board/pullRequestLink'
import { prRefNode } from '../fakes/fakeGraphQL'

const CARD = { owner: 'leonardo-amaral-3', name: 'operations-center', number: 28 }

type Ref = Parameters<typeof prRefNode>[0]

/** O número do PR escolhido, ou `null` — é o que cada caso afirma. */
function escolhido(refs: readonly Ref[], card = CARD): number | null {
  return pickPullRequest({ nodes: refs.map(prRefNode) }, card)?.number ?? null
}

describe('pickPullRequest — a regra do CA-2: qual PR é o do card', () => {
  it('casa `**Card:** #28`, a forma medida em todos os PRs de card', () => {
    expect(escolhido([{ number: 76, body: '**Card:** #28\n\ncorpo' }])).toBe(76)
  })

  it('casa `Card: #28`, a forma da norma', () => {
    expect(escolhido([{ number: 76, body: 'Card: #28' }])).toBe(76)
  })

  it('devolve número, url e estado do PR achado', () => {
    const achado = pickPullRequest(
      { nodes: [prRefNode({ number: 76, body: '**Card:** #28', state: 'OPEN' })] },
      CARD,
    )

    expect(achado).toEqual({
      number: 76,
      url: 'https://github.com/leonardo-amaral-3/operations-center/pull/76',
      state: 'OPEN',
    })
  })

  it('não casa o PR de outro card que só cita o #28 na timeline', () => {
    expect(escolhido([{ number: 49, body: '**Card:** #45\n\nver também #28' }])).toBeNull()
  })

  it('não casa o PR de trem', () => {
    expect(escolhido([{ number: 77, body: '## Trem v2026.10.12\n\n- #28' }])).toBeNull()
  })

  it('não casa PR de outro repositório', () => {
    expect(
      escolhido([{ number: 5, body: '**Card:** #28', repository: 'fork-de-alguem/operations-center' }]),
    ).toBeNull()
  })

  it('respeita a fronteira do número: `#280` não é o #28', () => {
    expect(escolhido([{ number: 90, body: 'Card: #280' }])).toBeNull()
  })

  it('pula linhas vazias antes do `Card:`', () => {
    expect(escolhido([{ number: 76, body: '\n  \n\n**Card:** #28' }])).toBe(76)
  })

  it('aceita BOM no início e `\\r\\n` entre as linhas', () => {
    expect(escolhido([{ number: 76, body: '﻿\r\n**Card:** #28\r\n\r\ncorpo' }])).toBe(76)
  })

  it('só olha a primeira linha não vazia: `Card:` mais abaixo não vale', () => {
    expect(escolhido([{ number: 76, body: 'um resumo\n\n**Card:** #28' }])).toBeNull()
  })

  it('compara `nameWithOwner` sem diferenciar maiúsculas', () => {
    expect(
      escolhido([
        { number: 76, body: '**Card:** #28', repository: 'Leonardo-Amaral-3/Operations-Center' },
      ]),
    ).toBe(76)
  })
})

describe('pickPullRequest — o desempate: OPEN > MERGED > CLOSED, depois o maior número', () => {
  const corpo = '**Card:** #28'

  it('OPEN vence MERGED', () => {
    expect(
      escolhido([
        { number: 90, body: corpo, state: 'MERGED' },
        { number: 70, body: corpo, state: 'OPEN' },
      ]),
    ).toBe(70)
  })

  it('MERGED vence CLOSED', () => {
    expect(
      escolhido([
        { number: 90, body: corpo, state: 'CLOSED' },
        { number: 70, body: corpo, state: 'MERGED' },
      ]),
    ).toBe(70)
  })

  it('CLOSED sozinho é escolhido', () => {
    expect(escolhido([{ number: 70, body: corpo, state: 'CLOSED' }])).toBe(70)
  })

  it('dois MERGED: vence o de maior número', () => {
    expect(
      escolhido([
        { number: 80, body: corpo, state: 'MERGED' },
        { number: 70, body: corpo, state: 'MERGED' },
      ]),
    ).toBe(80)
  })
})

describe('pickPullRequest — timeline que não é o que se espera', () => {
  it.each([
    ['ausente', undefined],
    ['nula', null],
    ['texto', 'timeline'],
    ['sem `nodes`', {}],
    ['`nodes` que não é lista', { nodes: 7 }],
  ])('devolve null com a timeline %s', (_nome, timeline) => {
    expect(pickPullRequest(timeline, CARD)).toBeNull()
  })

  it('descarta o nó sem `source`, sem número, sem url, sem corpo ou com estado desconhecido', () => {
    const bom = prRefNode({ number: 76, body: '**Card:** #28' })
    const fonte = (bom['source'] ?? {}) as Record<string, unknown>
    const sem = (campo: string): Record<string, unknown> => {
      return { source: Object.fromEntries(Object.entries(fonte).filter(([chave]) => chave !== campo)) }
    }

    const timeline = {
      nodes: [
        {},
        null,
        { source: null },
        sem('number'),
        sem('url'),
        sem('body'),
        { source: { ...fonte, state: 'DRAFT' } },
      ],
    }

    expect(pickPullRequest(timeline, CARD)).toBeNull()
  })
})
