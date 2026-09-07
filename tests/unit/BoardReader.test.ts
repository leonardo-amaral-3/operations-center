import { describe, expect, it } from 'vitest'

import { BoardReader, MAX_PAGES } from '../../src/core/board/BoardReader'
import { BOARD_QUERY, CARD_FIELDS, CONVERSABLE_STATIONS } from '../../src/core/board/query'
import type { Board, GraphQLResponse } from '../../src/core/board/types'
import {
  STATUS_OPTIONS,
  createFakeGraphQL,
  draftItem,
  envelope,
  issueItem,
  notFound,
  pullRequestItem,
} from '../fakes/fakeGraphQL'
import type { FakeGraphQL } from '../fakes/fakeGraphQL'

const INPUT = { owner: 'dono', number: 2 }

const BACKLOG = STATUS_OPTIONS[1].id
const IMPLEMENTACAO = STATUS_OPTIONS[3].id
const PRODUCAO = STATUS_OPTIONS[7].id

function read(fake: FakeGraphQL): Promise<Board> {
  return new BoardReader({ graphql: fake.graphql }).read(INPUT)
}

function readPages(...pages: readonly GraphQLResponse[]): Promise<Board> {
  return read(createFakeGraphQL(...pages))
}

describe('BoardReader — regras 1 e 2: qual alias vale e qual erro é tolerável', () => {
  it('usa o alias `user` e ignora o NOT_FOUND do `organization` que a API manda junto', async () => {
    const board = await readPages(envelope({ alias: 'user', title: 'Operations Center' }))

    expect(board.title).toBe('Operations Center')
  })

  it('usa o alias `organization` quando é ele que resolve, ignorando o NOT_FOUND do `user`', async () => {
    const board = await readPages(envelope({ alias: 'organization', title: 'Board da org' }))

    expect(board.title).toBe('Board da org')
  })

  it('lança quando o erro é de outro path — engolir aqui esconderia falha de campo de verdade', async () => {
    const quebrado = envelope({
      errors: [
        notFound('organization'),
        { message: 'Field "field" argument "name" is required.', path: ['user', 'projectV2'] },
      ],
    })

    await expect(readPages(quebrado)).rejects.toThrow('Field "field" argument "name" is required.')
  })

  it('lança quando nenhum dos dois aliases resolve, com a mensagem do primeiro erro', async () => {
    const nenhum: GraphQLResponse = {
      data: { user: null, organization: null },
      errors: [notFound('user'), notFound('organization')],
    }

    await expect(readPages(nenhum)).rejects.toThrow(
      "Could not resolve to a User with the login of 'dono'.",
    )
  })

  it('lança quando não veio `data` nenhum', async () => {
    await expect(readPages({ data: null })).rejects.toThrow('board não encontrado')
  })
})

describe('BoardReader — regra 3: as colunas são as do board', () => {
  it('devolve uma coluna por opção do campo Status, na ordem em que o board as declara', async () => {
    const board = await readPages(envelope())

    expect(board.columns).toEqual(STATUS_OPTIONS.map((option) => ({ ...option })))
  })

  it('lança quando o board não declara o campo Status — é um board que não espelha a esteira', async () => {
    await expect(readPages(envelope({ options: null }))).rejects.toThrow(
      /campo single-select "Status"/,
    )
  })
})

describe('BoardReader — conversabilidade: a coluna sabe se conversa (CA-4)', () => {
  it('as duas estações sem skill dedicada são as únicas que não conversam', async () => {
    const board = await readPages(envelope())

    expect(
      board.columns.filter((column) => !column.conversable).map((column) => column.name),
    ).toEqual(['🧪 Validação em Dev', '✅ Produção'])
    expect(board.columns.filter((column) => column.conversable)).toHaveLength(
      CONVERSABLE_STATIONS.length,
    )
  })

  it('casa com e sem emoji, com e sem acento — quem decora o rótulo é o board, não a norma', async () => {
    const board = await readPages(
      envelope({
        options: [
          { id: 'a', name: '🎯 Especificação' },
          { id: 'b', name: 'Especificação' },
          { id: 'c', name: 'especificacao' },
          { id: 'd', name: 'IMPLEMENTAÇÃO' },
          { id: 'e', name: '👀 Revisao' },
          { id: 'f', name: '📥 triagem' },
        ],
      }),
    )

    expect(board.columns.every((column) => column.conversable)).toBe(true)
  })

  it('nome parecido não conversa: a comparação é do nome inteiro, em qualquer variação', async () => {
    const board = await readPages(
      envelope({
        options: [
          { id: 'a', name: '🧪 Validação em Dev' },
          { id: 'b', name: 'validacao em dev' },
          { id: 'c', name: '✅ Produção' },
          { id: 'd', name: 'PRODUCAO' },
          { id: 'e', name: 'Release candidate' },
          { id: 'f', name: 'Pré-triagem' },
        ],
      }),
    )

    expect(board.columns.some((column) => column.conversable)).toBe(false)
  })
})

describe('BoardReader — regras 4 e 5: quem vira cartão, e com quais etiquetas', () => {
  it('põe o cartão na coluna do seu optionId, nunca pelo nome da estação', async () => {
    const board = await readPages(
      envelope({
        items: [
          issueItem({
            id: 'PVTI_1',
            number: 4,
            fields: { Status: ['🔨 Implementação', IMPLEMENTACAO] },
          }),
        ],
      }),
    )

    expect(board.cards).toHaveLength(1)
    expect(board.cards[0]?.columnId).toBe(IMPLEMENTACAO)
  })

  it('traduz o cartão inteiro: número, título, url, repo, responsáveis', async () => {
    const board = await readPages(
      envelope({
        items: [
          issueItem({
            id: 'PVTI_abc',
            number: 4,
            title: 'Ler o board do GitHub',
            url: 'https://github.com/dono/repo/issues/4',
            repository: 'leonardo-amaral-3/operations-center',
            assignees: ['leonardo-amaral-3'],
            fields: { Status: ['📋 Backlog', BACKLOG] },
          }),
        ],
      }),
    )

    expect(board.cards[0]).toEqual({
      itemId: 'PVTI_abc',
      number: 4,
      title: 'Ler o board do GitHub',
      url: 'https://github.com/dono/repo/issues/4',
      repository: 'leonardo-amaral-3/operations-center',
      closed: false,
      assignees: ['leonardo-amaral-3'],
      columnId: BACKLOG,
      fields: [],
    })
  })

  it('N itens no envelope viram N cartões — um card com 7 tasks continua sendo um cartão só', async () => {
    const board = await readPages(
      envelope({
        items: [1, 2, 3, 4].map((n) =>
          issueItem({ id: `PVTI_${n}`, number: n, fields: { Status: ['📋 Backlog', BACKLOG] } }),
        ),
      }),
    )

    expect(board.cards).toHaveLength(4)
    expect(board.cards.map((card) => card.number)).toEqual([1, 2, 3, 4])
  })

  it('preserva a ordem em que o board devolveu os itens — ordenar faria o kanban parar de espelhá-lo', async () => {
    const board = await readPages(
      envelope({
        items: [7, 2, 30, 1].map((n) =>
          issueItem({ id: `PVTI_${n}`, number: n, fields: { Status: ['📋 Backlog', BACKLOG] } }),
        ),
      }),
    )

    expect(board.cards.map((card) => card.number)).toEqual([7, 2, 30, 1])
  })

  it('deixa de fora rascunho, pull request e item sem Status; a issue fechada entra', async () => {
    const board = await readPages(
      envelope({
        items: [
          draftItem('PVTI_draft'),
          pullRequestItem('PVTI_pr', 3),
          issueItem({ id: 'PVTI_orfa', number: 9 }),
          issueItem({
            id: 'PVTI_fechada',
            number: 1,
            closed: true,
            fields: { Status: ['✅ Produção', PRODUCAO] },
          }),
        ],
      }),
    )

    expect(board.cards).toHaveLength(1)
    expect(board.cards[0]?.itemId).toBe('PVTI_fechada')
    expect(board.cards[0]?.closed).toBe(true)
    expect(board.cards[0]?.columnId).toBe(PRODUCAO)
  })

  it('monta as etiquetas na ordem de CARD_FIELDS, e não na ordem do board', async () => {
    const board = await readPages(
      envelope({
        items: [
          issueItem({
            id: 'PVTI_1',
            number: 4,
            // De propósito fora de ordem, e com o `Status` no meio: a ordem da etiqueta é a de
            // `CARD_FIELDS`, porque é ela que a coluna do kanban consegue ler de relance.
            fields: {
              Rota: ['Completa', 'opt-completa'],
              Status: ['📋 Backlog', BACKLOG],
              Tipo: ['✨ Melhoria', 'opt-melhoria'],
              Classe: ['⚪ Padrão', 'opt-padrao'],
              Severidade: ['S2', 'opt-s2'],
            },
          }),
        ],
      }),
    )

    expect(board.cards[0]?.fields).toEqual([
      { name: 'Tipo', value: '✨ Melhoria', optionId: 'opt-melhoria' },
      { name: 'Severidade', value: 'S2', optionId: 'opt-s2' },
      { name: 'Classe', value: '⚪ Padrão', optionId: 'opt-padrao' },
      { name: 'Rota', value: 'Completa', optionId: 'opt-completa' },
    ])
    expect(board.cards[0]?.fields.map((field) => field.name)).toEqual([...CARD_FIELDS])
  })

  it('campo vazio no board não vira etiqueta, e `Módulo` nunca vira — vale `Comum` em todo card', async () => {
    const board = await readPages(
      envelope({
        items: [
          issueItem({
            id: 'PVTI_1',
            number: 4,
            fields: {
              Status: ['📋 Backlog', BACKLOG],
              Tipo: ['🐞 Bug', 'opt-bug'],
              Módulo: ['Comum', 'opt-comum'],
            },
          }),
        ],
      }),
    )

    expect(board.cards[0]?.fields).toEqual([{ name: 'Tipo', value: '🐞 Bug', optionId: 'opt-bug' }])
  })
})

describe('BoardReader — regra 6: paginação', () => {
  it('acumula os cartões das páginas seguintes, pedindo cada uma com o cursor da anterior', async () => {
    const fake = createFakeGraphQL(
      envelope({
        items: [
          issueItem({ id: 'PVTI_1', number: 1, fields: { Status: ['📋 Backlog', BACKLOG] } }),
        ],
        hasNextPage: true,
        endCursor: 'cursor-da-pagina-1',
      }),
      envelope({
        title: 'ignorado — título e colunas vêm da primeira página',
        options: [{ id: 'opt-outra', name: 'Outra' }],
        items: [
          issueItem({ id: 'PVTI_2', number: 2, fields: { Status: ['✅ Produção', PRODUCAO] } }),
        ],
      }),
    )

    const board = await read(fake)

    expect(board.cards.map((card) => card.number)).toEqual([1, 2])
    expect(board.title).toBe('Operations Center')
    expect(board.columns).toHaveLength(STATUS_OPTIONS.length)

    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[0]).toEqual({
      document: BOARD_QUERY,
      variables: { owner: 'dono', number: 2, cursor: null },
    })
    expect(fake.calls[1]?.variables['cursor']).toBe('cursor-da-pagina-1')
  })

  it('lança ao estourar MAX_PAGES em vez de girar para sempre num pageInfo malformado', async () => {
    // A última página do roteiro se repete: esta diz `hasNextPage` para sempre.
    const fake = createFakeGraphQL(envelope({ hasNextPage: true, endCursor: 'sempre-o-mesmo' }))

    await expect(read(fake)).rejects.toThrow(`mais de ${MAX_PAGES} páginas`)
    expect(fake.calls).toHaveLength(MAX_PAGES)
  })
})

describe('BoardReader — regra 7: a resposta é dado externo', () => {
  it('atravessa formas inesperadas sem explodir: item, conteúdo e listas fora do formato', async () => {
    const board = await readPages(
      envelope({
        items: [
          null,
          'nem objeto é',
          { id: 42, content: { __typename: 'Issue' } },
          { id: 'PVTI_sem_conteudo' },
          { id: 'PVTI_sem_numero', content: { __typename: 'Issue', title: 't', url: 'u' } },
          {
            id: 'PVTI_ok',
            content: {
              __typename: 'Issue',
              number: 5,
              title: 'sem repo, sem responsável e com fieldValues torto',
              url: 'https://github.com/dono/repo/issues/5',
              assignees: null,
            },
            fieldValues: {
              nodes: [{ optionId: BACKLOG, name: '📋 Backlog', field: { name: 'Status' } }],
            },
          },
        ] as unknown as readonly Record<string, unknown>[],
      }),
    )

    expect(board.cards).toHaveLength(1)
    expect(board.cards[0]?.itemId).toBe('PVTI_ok')
    expect(board.cards[0]?.repository).toBe('')
    expect(board.cards[0]?.assignees).toEqual([])
    expect(board.cards[0]?.closed).toBe(false)
  })
})
