import { describe, expect, it, vi } from 'vitest'

import { MAX_PAGES } from '../../src/core/board/envelope'
import type { GraphQLFn, GraphQLResponse } from '../../src/core/board/types'
import {
  documentoDosCards,
  lerCards,
  lerNumerosMovidos,
  RELATORIO_MOVIDOS_QUERY,
} from '../../src/core/relatorio/board'
import { graphqlDe10de11, REPO_DA_FIXTURE } from '../fixtures/relatorio/board-2026-11-10'

const REPO = 'leonardo-amaral-3/operations-center'
const MOVIDOS = {
  owner: 'leonardo-amaral-3',
  repo: REPO,
  projeto: 2,
  inicio: '2026-11-10T00:00:00Z',
}
const CARDS = { owner: 'leonardo-amaral-3', name: 'operations-center', projeto: 2 }

function pagina(nodes: unknown[], proxima: string | null = null): GraphQLResponse {
  return {
    data: {
      user: {
        projectV2: {
          items: { pageInfo: { hasNextPage: proxima !== null, endCursor: proxima }, nodes },
        },
      },
      organization: null,
    },
    errors: [{ message: 'não achou', path: ['organization'] }],
  }
}

function item(numero: number, repo = REPO, eventos = 1) {
  return {
    content: {
      __typename: 'Issue',
      number: numero,
      repository: { nameWithOwner: repo },
      timelineItems: { nodes: Array.from({ length: eventos }, () => ({ createdAt: 'x' })) },
    },
  }
}

function card(numero: number, extra: Record<string, unknown> = {}) {
  return {
    __typename: 'Issue',
    number: numero,
    title: `Card ${numero}`,
    url: `https://github.com/o/r/issues/${numero}`,
    parent: null,
    timelineItems: { pageInfo: { hasNextPage: false }, nodes: [] },
    ...extra,
  }
}

function cardsFake(porNumero: (n: number) => unknown, errors?: unknown[]) {
  const fn = vi.fn<GraphQLFn>((documento) => {
    const repository: Record<string, unknown> = {}
    for (const m of documento.matchAll(/\bc(\d+): issueOrPullRequest/g)) {
      repository[`c${m[1]}`] = porNumero(Number(m[1]))
    }
    return Promise.resolve({
      data: { repository },
      ...(errors ? { errors: errors as { message: string }[] } : {}),
    })
  })
  return fn
}

describe('o documento do relatório', () => {
  it('não tem a palavra que a canária procura', () => {
    expect(RELATORIO_MOVIDOS_QUERY.toLowerCase()).not.toContain('mutation')
    expect(documentoDosCards([1]).toLowerCase()).not.toContain('mutation')
  })

  it('documentoDosCards põe um alias por número', () => {
    const doc = documentoDosCards([118, 119])
    expect(doc).toContain('c118: issueOrPullRequest(number: 118)')
    expect(doc).toContain('c119: issueOrPullRequest(number: 119)')
    expect(doc).toContain('fragment CardIssue on Issue')
    expect(doc).toContain('fragment CardPr on PullRequest')
  })
})

describe('lerNumerosMovidos', () => {
  it('ignora nós vazios, outro repo, DraftIssue e content nulo', async () => {
    const graphql = vi.fn<GraphQLFn>(() =>
      Promise.resolve(
        pagina([
          item(27, REPO, 0),
          item(5, 'outro/repo'),
          { content: { __typename: 'DraftIssue' } },
          { content: null },
          item(121),
          item(118),
          item(118),
        ]),
      ),
    )

    expect(await lerNumerosMovidos(graphql, MOVIDOS)).toEqual([118, 121])
    expect(graphql.mock.calls[0]?.[1]).toEqual({
      owner: 'leonardo-amaral-3',
      number: 2,
      cursor: null,
      inicio: '2026-11-10T00:00:00Z',
    })
  })

  it('nunca usa o totalCount', async () => {
    const comTotal = {
      content: {
        number: 27,
        repository: { nameWithOwner: REPO },
        timelineItems: { totalCount: 7, nodes: [] },
      },
    }
    expect(await lerNumerosMovidos(() => Promise.resolve(pagina([comTotal])), MOVIDOS)).toEqual([])
  })

  it('pagina por endCursor', async () => {
    const graphql = vi
      .fn<GraphQLFn>()
      .mockResolvedValueOnce(pagina([item(3)], 'c1'))
      .mockResolvedValueOnce(pagina([item(2)]))

    expect(await lerNumerosMovidos(graphql, MOVIDOS)).toEqual([2, 3])
    expect(graphql.mock.calls[1]?.[1]).toMatchObject({ cursor: 'c1' })
  })

  it('lança no teto de páginas', async () => {
    const graphql = vi.fn<GraphQLFn>(() => Promise.resolve(pagina([], 'sempre')))

    await expect(lerNumerosMovidos(graphql, MOVIDOS)).rejects.toThrow(
      `o board passou de ${MAX_PAGES} páginas`,
    )
    expect(graphql).toHaveBeenCalledTimes(MAX_PAGES)
  })

  it('lança o erro que não é o do alias que não resolveu', async () => {
    const graphql: GraphQLFn = () =>
      Promise.resolve({
        ...pagina([]),
        errors: [{ message: 'falha de verdade', path: ['user'] }],
      })
    await expect(lerNumerosMovidos(graphql, MOVIDOS)).rejects.toThrow('falha de verdade')
  })
})

describe('lerCards', () => {
  it('lista vazia devolve Map vazio sem chamar o graphql', async () => {
    const graphql = vi.fn<GraphQLFn>()
    expect((await lerCards(graphql, { ...CARDS, numeros: [] })).size).toBe(0)
    expect(graphql).not.toHaveBeenCalled()
  })

  it('51 números dão dois documentos (50 + 1)', async () => {
    const graphql = cardsFake(card)
    const numeros = Array.from({ length: 51 }, (_, i) => i + 1)

    const lidos = await lerCards(graphql, { ...CARDS, numeros })

    expect(lidos.size).toBe(51)
    expect(graphql).toHaveBeenCalledTimes(2)
    expect(graphql.mock.calls[0]?.[0].match(/issueOrPullRequest\(/g)).toHaveLength(50)
    expect(graphql.mock.calls[1]?.[0].match(/issueOrPullRequest\(/g)).toHaveLength(1)
  })

  it('tolera o NOT_FOUND do alias, e só ele', async () => {
    const naoAchou = (path: (string | number)[], type: string) => [{ type, path, message: 'sumiu' }]

    const ok = await lerCards(
      cardsFake(
        (n) => (n === 9999 ? null : card(n)),
        naoAchou(['repository', 'c9999'], 'NOT_FOUND'),
      ),
      { ...CARDS, numeros: [9999, 5] },
    )
    expect([...ok.keys()]).toEqual([5])

    for (const erros of [
      naoAchou(['repository', 'c1234'], 'NOT_FOUND'),
      naoAchou(['organization'], 'NOT_FOUND'),
      naoAchou(['repository', 'c9999'], 'FORBIDDEN'),
    ]) {
      await expect(
        lerCards(
          cardsFake((n) => (n === 9999 ? null : card(n)), erros),
          { ...CARDS, numeros: [9999, 5] },
        ),
      ).rejects.toThrow('sumiu')
    }
  })

  it('busca o pai numa segunda rodada e para depois da quarta', async () => {
    const dois = cardsFake((n) =>
      card(n, { parent: n === 120 ? { number: 118, repository: { nameWithOwner: REPO } } : null }),
    )
    const lidos = await lerCards(dois, { ...CARDS, numeros: [120] })
    expect([...lidos.keys()].sort()).toEqual([118, 120])
    expect(lidos.get(120)?.pai).toBe(118)
    expect(dois).toHaveBeenCalledTimes(2)

    const cadeia = cardsFake((n) =>
      card(n, { parent: { number: n - 1, repository: { nameWithOwner: REPO } } }),
    )
    const lidosDaCadeia = await lerCards(cadeia, { ...CARDS, numeros: [10] })
    expect(cadeia).toHaveBeenCalledTimes(4)
    expect([...lidosDaCadeia.keys()].sort((a, b) => a - b)).toEqual([7, 8, 9, 10])
  })

  it('pai de outro repo dá pai nulo', async () => {
    const lidos = await lerCards(
      cardsFake((n) =>
        card(n, { parent: { number: 3, repository: { nameWithOwner: 'o/outro' } } }),
      ),
      { ...CARDS, numeros: [5] },
    )
    expect(lidos.get(5)?.pai).toBeNull()
  })

  it('PR dá pai nulo sem a chave parent; Issue sem a chave lança', async () => {
    const pr = {
      __typename: 'PullRequest',
      number: 116,
      title: 'PR',
      url: 'u',
      timelineItems: { nodes: [] },
    }
    expect(
      (
        await lerCards(
          cardsFake(() => pr),
          { ...CARDS, numeros: [116] },
        )
      ).get(116)?.pai,
    ).toBeNull()

    const semParent: Record<string, unknown> = card(5)
    delete semParent['parent']
    await expect(
      lerCards(
        cardsFake(() => semParent),
        { ...CARDS, numeros: [5] },
      ),
    ).rejects.toThrow('resposta inesperada do GitHub para o card #5')
  })

  it('lança em forma inesperada', async () => {
    for (const ruim of [
      { ...card(5), __typename: 'Outro' },
      { ...card(5), title: undefined },
      null,
    ]) {
      await expect(
        lerCards(
          cardsFake(() => ruim),
          { ...CARDS, numeros: [5] },
        ),
      ).rejects.toThrow('resposta inesperada do GitHub para o card #5')
    }
  })

  it('filtra eventos de outro Project e ordena por data', async () => {
    const ev = (em: string, para: string, projeto: number) => ({
      createdAt: em,
      previousStatus: '',
      status: para,
      project: { number: projeto },
    })
    const lidos = await lerCards(
      cardsFake((n) =>
        card(n, {
          timelineItems: {
            pageInfo: { hasNextPage: false },
            nodes: [
              ev('2026-11-10T12:00:00Z', 'B', 2),
              ev('2026-11-10T11:00:00Z', 'X', 3),
              ev('2026-11-10T10:00:00Z', 'A', 2),
            ],
          },
        }),
      ),
      { ...CARDS, numeros: [5] },
    )
    expect(lidos.get(5)?.eventos.map((e) => e.para)).toEqual(['A', 'B'])
  })

  it('lança com hasNextPage', async () => {
    const cheio = card(5, { timelineItems: { pageInfo: { hasNextPage: true }, nodes: [] } })
    await expect(
      lerCards(
        cardsFake(() => cheio),
        { ...CARDS, numeros: [5] },
      ),
    ).rejects.toThrow(
      'o card #5 tem mais de 100 mudanças de Status, e o relatório não lê além disso',
    )
  })
})

describe('a fixture de 10/11/2026', () => {
  it('dá 118 a 121, os pais e os 5 eventos do dia', async () => {
    expect(REPO_DA_FIXTURE).toBe(REPO)
    const numeros = await lerNumerosMovidos(graphqlDe10de11, MOVIDOS)
    expect(numeros).toEqual([118, 119, 120, 121])

    const cards = await lerCards(graphqlDe10de11, { ...CARDS, numeros })

    expect([...cards.keys()]).toEqual([118, 119, 120, 121])
    expect([...cards.values()].map((c) => c.pai)).toEqual([null, 118, 118, 118])
    expect([...cards.values()].reduce((soma, c) => soma + c.eventos.length, 0)).toBe(5)
    expect(cards.get(118)?.eventos).toEqual([
      { em: '2026-11-10T19:59:00Z', de: '', para: '📥 Triagem' },
      { em: '2026-11-10T20:01:23Z', de: '📥 Triagem', para: '📋 Backlog' },
    ])
    expect(cards.get(120)?.url).toBe(
      'https://github.com/leonardo-amaral-3/operations-center/issues/120',
    )
  })
})
