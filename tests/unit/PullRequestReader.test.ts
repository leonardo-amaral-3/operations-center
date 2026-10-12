import { describe, expect, it } from 'vitest'

import { PR_MAX_FILES, PullRequestReader } from '../../src/core/board/PullRequestReader'
import { PR_LINK_QUERY, PR_QUERY } from '../../src/core/board/query'
import type { GraphQLResponse, PullRequestView } from '../../src/core/board/types'
import {
  cardEnvelope,
  commentNode,
  createFakeGraphQL,
  prAuthor,
  prEnvelope,
  prRefNode,
  rollupNode,
  threadNode,
  type PrEnvelopeInput,
} from '../fakes/fakeGraphQL'

const INPUT = { owner: 'leonardo-amaral-3', name: 'operations-center', number: 13 }

const COM_PR = cardEnvelope({
  timeline: [prRefNode({ number: 76, body: '**Card:** #13', state: 'OPEN' })],
})

function arquivo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filename: 'src/a.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    blob_url: 'https://github.com/x/blob/a.ts',
    patch: '@@ -1 +1 @@\n-a\n+b',
    ...extra,
  }
}

function leitor(pr: GraphQLResponse, files: unknown = [arquivo()], link = COM_PR) {
  const fake = createFakeGraphQL(link, pr)
  const pedidos: string[] = []
  const reader = new PullRequestReader({
    graphql: fake.graphql,
    rest: (path) => {
      pedidos.push(path)
      return Promise.resolve(files)
    },
  })
  return { reader, fake, pedidos }
}

function read(input: PrEnvelopeInput = {}, files: unknown = [arquivo()]): Promise<PullRequestView> {
  return leitor(prEnvelope(input), files).reader.read(INPUT)
}

describe('PullRequestReader — o que é fatal', () => {
  it('lança "este card não tem PR" quando a timeline não traz o PR do card', async () => {
    const semPr = cardEnvelope({ timeline: [prRefNode({ number: 49, body: '**Card:** #45' })] })

    await expect(leitor(prEnvelope(), [], semPr).reader.read(INPUT)).rejects.toThrow(
      'este card não tem PR',
    )
  })

  it('lança em qualquer `errors` da consulta do PR', async () => {
    const quebrado = prEnvelope({ errors: [{ message: 'Field "x" doesn\'t exist.' }] })

    await expect(leitor(quebrado).reader.read(INPUT)).rejects.toThrow('Field "x" doesn\'t exist.')
  })

  it('lança em qualquer `errors` da descoberta, inclusive na timeline', async () => {
    const link = cardEnvelope({ errors: [{ message: 'SSO', path: ['repository', 'issue', 'timelineItems'] }] })

    await expect(leitor(prEnvelope(), [], link).reader.read(INPUT)).rejects.toThrow('SSO')
  })

  it('lança quando a issue não vem', async () => {
    const link = cardEnvelope({ missing: 'issue' })

    await expect(leitor(prEnvelope(), [], link).reader.read(INPUT)).rejects.toThrow(
      'o GitHub não devolveu a issue #13 de leonardo-amaral-3/operations-center',
    )
  })

  it('lança quando o `pullRequest` vem nulo', async () => {
    await expect(read({ missing: true })).rejects.toThrow(
      'o GitHub não devolveu o PR #76 de leonardo-amaral-3/operations-center',
    )
  })

  it('lança quando a REST não devolve um array', async () => {
    await expect(read({}, { message: 'Not Found' })).rejects.toThrow(
      'resposta inesperada da lista de arquivos do PR #76',
    )
  })
})

describe('PullRequestReader — as leituras', () => {
  it('lê a issue, o PR pelo número achado e a REST com o teto de arquivos', async () => {
    const { reader, fake, pedidos } = leitor(prEnvelope())
    await reader.read(INPUT)

    expect(fake.calls.map((c) => c.document)).toEqual([PR_LINK_QUERY, PR_QUERY])
    expect(fake.calls[0]?.variables).toEqual({ owner: INPUT.owner, name: INPUT.name, number: 13 })
    expect(fake.calls[1]?.variables).toEqual({ owner: INPUT.owner, name: INPUT.name, number: 76 })
    expect(pedidos).toEqual([
      `repos/leonardo-amaral-3/operations-center/pulls/76/files?per_page=${PR_MAX_FILES}`,
    ])
  })
})

describe('PullRequestReader — cabeçalho e merge (CA-3, CA-4)', () => {
  it('traduz o cabeçalho', async () => {
    const view = await read()

    expect(view).toMatchObject({
      number: 76,
      title: 'Ver o PR',
      state: 'OPEN',
      isDraft: false,
      mergedAt: null,
      baseRef: 'dev',
      headRef: 'feat/76-x',
      body: 'corpo do PR',
    })
  })

  it('traz o estado e a data de um PR mergeado', async () => {
    const view = await read({ state: 'MERGED' })

    expect(view.state).toBe('MERGED')
    expect(view.mergedAt).toBe('2026-10-12T10:00:00Z')
  })

  it.each(['MERGEABLE', 'CONFLICTING', 'UNKNOWN'] as const)('traduz mergeable %s', async (mergeable) => {
    expect((await read({ mergeable })).mergeable).toBe(mergeable)
  })

  it('trata um valor desconhecido de mergeable como UNKNOWN', async () => {
    expect((await read({ mergeable: 'OUTRO' })).mergeable).toBe('UNKNOWN')
  })
})

describe('PullRequestReader — a conversa (CA-4)', () => {
  it('marca bot pelo `__typename` e conta removida pelo login nulo', async () => {
    const view = await read({
      comments: [
        { id: 'c1', author: prAuthor('graphify-labs', 'Bot'), createdAt: '2026-10-12T10:00:00Z', body: 'a' },
        { id: 'c2', author: prAuthor(null), createdAt: '2026-10-12T11:00:00Z', body: 'b' },
      ],
    })

    expect(view.timeline.map((e) => (e.kind === 'comment' ? e.author : null))).toEqual([
      { login: 'graphify-labs', bot: true },
      { login: null, bot: false },
    ])
  })

  it('descarta review PENDING e COMMENTED vazia, e mantém APPROVED vazia', async () => {
    const review = (id: string, state: string, body: string) => ({
      id,
      state,
      body,
      author: prAuthor('lu'),
      submittedAt: '2026-10-12T10:00:00Z',
    })
    const view = await read({
      reviews: [
        review('r1', 'COMMENTED', '  '),
        review('r2', 'PENDING', 'rascunho'),
        review('r3', 'APPROVED', ''),
        review('r4', 'COMMENTED', 'olha isso'),
      ],
    })

    expect(view.timeline.map((e) => e.id)).toEqual(['r3', 'r4'])
  })

  it('descarta review sem `submittedAt`', async () => {
    const view = await read({ reviews: [{ id: 'r1', state: 'APPROVED', body: '', author: null }] })

    expect(view.timeline).toEqual([])
  })

  it('usa `originalLine` quando o thread desatualizado tem `line` nulo, e descarta thread vazio', async () => {
    const view = await read({
      threads: [
        threadNode({
          id: 't1',
          line: null,
          originalLine: 7,
          isOutdated: true,
          comments: [commentNode({ id: 'k1', body: 'x' })],
        }),
        threadNode({ id: 't2', comments: [] }),
      ],
    })

    expect(view.timeline).toHaveLength(1)
    expect(view.timeline[0]).toMatchObject({
      kind: 'thread',
      id: 't1',
      caminho: 'src/a.ts',
      line: 7,
      outdated: true,
      resolved: false,
    })
  })

  it('deixa `line` nulo quando os dois são nulos', async () => {
    const view = await read({
      threads: [
        threadNode({ id: 't1', line: null, originalLine: null, comments: [commentNode({ id: 'k', body: 'x' })] }),
      ],
    })

    expect(view.timeline[0]).toMatchObject({ kind: 'thread', line: null })
  })

  it('ordena os três tipos por data e desempata comentário → review → thread', async () => {
    const mesmaHora = '2026-10-12T12:00:00Z'
    const view = await read({
      threads: [
        threadNode({
          id: 't',
          comments: [commentNode({ id: 'k', body: 'x', createdAt: mesmaHora })],
        }),
        threadNode({
          id: 't-cedo',
          comments: [commentNode({ id: 'k2', body: 'x', createdAt: '2026-10-12T08:00:00Z' })],
        }),
      ],
      reviews: [{ id: 'r', state: 'APPROVED', body: '', author: null, submittedAt: mesmaHora }],
      comments: [{ id: 'c', author: null, createdAt: mesmaHora, body: 'x' }],
    })

    expect(view.timeline.map((e) => e.id)).toEqual(['t-cedo', 'c', 'r', 't'])
  })

  it.each([
    ['comentários', { commentsTotal: 101 }],
    ['reviews', { reviewsTotal: 101 }],
    ['threads', { threadsTotal: 51 }],
  ] as const)('marca `timelineTruncated` quando o totalCount de %s passa dos nós', async (_, extra) => {
    expect((await read(extra)).timelineTruncated).toBe(true)
  })

  it('marca `timelineTruncated` quando um thread tem mais comentários que os lidos', async () => {
    const view = await read({
      threads: [threadNode({ id: 't', commentsTotal: 21, comments: [commentNode({ id: 'k', body: 'x' })] })],
    })

    expect(view.timelineTruncated).toBe(true)
    expect((await read()).timelineTruncated).toBe(false)
  })
})

describe('PullRequestReader — o CI (CA-4)', () => {
  it('sem commit, o CI é vazio', async () => {
    expect((await read({ rollup: null })).checks).toEqual({ state: null, checks: [], truncated: false })
  })

  it('traduz CheckRun (conclusion, senão status) e StatusContext, e descarta outros tipos', async () => {
    const view = await read({
      rollup: rollupNode('PENDING', [
        { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'u1' },
        { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null },
        { __typename: 'StatusContext', context: 'ci/x', state: 'FAILURE', targetUrl: 'u2' },
        { __typename: 'Outro', name: 'z' },
      ]),
    })

    expect(view.checks).toEqual({
      state: 'PENDING',
      truncated: false,
      checks: [
        { name: 'lint', result: 'SUCCESS', url: 'u1' },
        { name: 'test', result: 'IN_PROGRESS', url: null },
        { name: 'ci/x', result: 'FAILURE', url: 'u2' },
      ],
    })
  })

  it('marca `truncated` quando contexts.totalCount passa dos nós', async () => {
    const node = { __typename: 'CheckRun', name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' }

    expect((await read({ rollup: rollupNode('SUCCESS', [node], 51) })).checks.truncated).toBe(true)
  })
})

describe('PullRequestReader — os arquivos (CA-5)', () => {
  it('traduz o item da REST, com o patch já em hunks', async () => {
    const [a] = (await read()).arquivos

    expect(a).toMatchObject({
      caminho: 'src/a.ts',
      caminhoAnterior: null,
      status: 'modified',
      additions: 1,
      deletions: 1,
      url: 'https://github.com/x/blob/a.ts',
    })
    expect(a?.diff?.hunks[0]?.lines).toHaveLength(2)
  })

  it('status desconhecido vira `changed`', async () => {
    expect((await read({}, [arquivo({ status: 'weird' })])).arquivos[0]?.status).toBe('changed')
  })

  it('renomeado traz o caminho anterior', async () => {
    const view = await read({}, [arquivo({ status: 'renamed', previous_filename: 'src/old.ts' })])

    expect(view.arquivos[0]).toMatchObject({ status: 'renamed', caminhoAnterior: 'src/old.ts' })
  })

  it('sem `blob_url` a url é nula; sem `patch` o diff é nulo', async () => {
    const semPatch = arquivo()
    delete semPatch['blob_url']
    delete semPatch['patch']

    expect((await read({}, [semPatch])).arquivos[0]).toMatchObject({ url: null, diff: null })
  })

  it('descarta item sem `filename`', async () => {
    const view = await read({}, [{ status: 'added' }, arquivo()])

    expect(view.arquivos).toHaveLength(1)
  })

  it('`totalDeArquivos` vem do `changedFiles`', async () => {
    expect((await read({ changedFiles: 130 })).totalDeArquivos).toBe(130)
  })

  it('`arquivosCortados` com 130 arquivos e 100 itens da REST', async () => {
    const cem = Array.from({ length: 100 }, (_, i) => arquivo({ filename: `f${i}.ts` }))
    const view = await read({ changedFiles: 130 }, cem)

    expect(view.arquivosCortados).toBe(true)
  })

  it('um item malformado entre 100 não vira corte quando `changedFiles` é 100', async () => {
    const itens: unknown[] = Array.from({ length: 99 }, (_, i) => arquivo({ filename: `f${i}.ts` }))
    itens.push({ status: 'added' })
    const view = await read({ changedFiles: 100 }, itens)

    expect(view.arquivos).toHaveLength(99)
    expect(view.arquivosCortados).toBe(false)
  })
})
