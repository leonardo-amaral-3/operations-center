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
  parentNode,
  pullRequestItem,
} from '../fakes/fakeGraphQL'
import type { FakeGraphQL } from '../fakes/fakeGraphQL'
import fixture from '../fixtures/board.json'

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

describe('BoardReader — a régua da triagem: a coluna sabe se é a de entrada (CA-1)', () => {
  it('marca `triage` na 📥 Triagem e em nenhuma das outras sete', async () => {
    // O contrário do `conversable`, e de propósito: lá são seis contra duas, aqui é **uma** contra
    // sete. É a coluna que ganhará a ação de nova triagem, e duas colunas marcadas dariam dois
    // botões no mesmo board.
    const board = await readPages(envelope())

    expect(board.columns.filter((column) => column.triage).map((column) => column.name)).toEqual([
      '📥 Triagem',
    ])
    expect(board.columns).toHaveLength(8)
  })

  it('conclui `triage` do nome, em qualquer decoração, e nunca do optionId', async () => {
    // Os ids são inventados aqui de propósito: se a régua olhasse `optionId`, ela erraria os três
    // primeiros — que é exatamente o que aconteceria ao apontar o app para outro board.
    const board = await readPages(
      envelope({
        options: [
          { id: 'zzz', name: '📥 Triagem' },
          { id: 'yyy', name: 'Triagem' },
          { id: 'xxx', name: 'triagem' },
          { id: 'opt-triagem', name: 'Pré-triagem' },
          { id: 'www', name: '📋 Backlog' },
        ],
      }),
    )

    expect(board.columns.map((column) => column.triage)).toEqual([true, true, true, false, false])
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
      parent: null,
      phases: [],
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

describe('BoardReader — o documento pede o pai (CA-3)', () => {
  it('`BOARD_QUERY` seleciona `parent` com número, título e repositório', () => {
    // A **única** asserção desta suíte que olha o texto do documento, e ela existe porque nada mais
    // o olha: o fake devolve o envelope roteirizado sem ler a consulta, e a fixture dos smokes
    // despacha por **identidade** de documento (`src/main/github/fixture.ts`), nunca por conteúdo.
    //
    // Medido em 2026-09-08, apagando esta linha de `query.ts`: 30 arquivos, 466 testes, `tsc` e
    // `eslint` **todos verdes** — e um app que, contra o GitHub de verdade, não desenha crachá
    // nenhum. É o modo de falha mais caro que este card tem, porque ele passa por toda porta
    // automática e só aparece na verificação pós-deploy, na mão.
    //
    // O espaço é normalizado para que reindentar o documento não fique vermelho; os três subcampos
    // continuam presos, porque é deles que `readParent` vive.
    expect(BOARD_QUERY.replace(/\s+/g, ' ')).toContain(
      'parent { number title repository { nameWithOwner } }',
    )
  })
})

describe('BoardReader — o pai que a issue declara (CA-1)', () => {
  it('traduz o pai bem formado, e o repositório vem de dentro dele — não do cartão', async () => {
    const board = await readPages(
      envelope({
        items: [
          issueItem({
            id: 'PVTI_fase',
            number: 32,
            repository: 'dono/repo',
            parent: parentNode(25, 'Operar o board pela esteira', 'leonardo-amaral-3/operations-center'),
            fields: { Status: ['🔨 Implementação', IMPLEMENTACAO] },
          }),
        ],
      }),
    )

    // O repo do cartão é `dono/repo` e o do pai é outro, de propósito: um `readParent` que lesse o
    // `repository` do nível de cima passaria por um pai do mesmo repo e penduraria a fase sob o
    // épico errado no dia em que o board hospedasse dois repos — que é o caso que a fixture já tem.
    expect(board.cards[0]?.parent).toEqual({
      number: 25,
      title: 'Operar o board pela esteira',
      repository: 'leonardo-amaral-3/operations-center',
    })
  })

  it('`parent` ausente e `parent: null` narram os dois para `null`', async () => {
    const board = await readPages(
      envelope({
        items: [
          issueItem({ id: 'PVTI_sem_chave', number: 1, fields: { Status: ['📋 Backlog', BACKLOG] } }),
          issueItem({
            id: 'PVTI_nulo',
            number: 2,
            parent: null,
            fields: { Status: ['📋 Backlog', BACKLOG] },
          }),
        ],
      }),
    )

    // As duas formas existem de verdade e vêm de origens diferentes: a chave ausente é a captura
    // feita antes de o documento pedir o campo, e o `null` é o que a API devolve para issue órfã.
    expect(board.cards.map((card) => card.parent)).toEqual([null, null])
  })

  it('pai sem número é descartado: sem ele não há crachá nem por onde cruzar', async () => {
    const board = await readPages(
      envelope({
        items: [
          issueItem({
            id: 'PVTI_pai_sem_numero',
            number: 7,
            parent: { title: 'um épico sem número', repository: { nameWithOwner: 'dono/repo' } },
            fields: { Status: ['📋 Backlog', BACKLOG] },
          }),
          issueItem({
            id: 'PVTI_pai_com_numero_torto',
            number: 8,
            parent: { number: '25', title: 'número que veio string' },
            fields: { Status: ['📋 Backlog', BACKLOG] },
          }),
        ],
      }),
    )

    expect(board.cards.map((card) => card.parent)).toEqual([null, null])
  })

  it('título e repositório ausentes viram string vazia — o vínculo sobrevive ao campo que faltou', async () => {
    const board = await readPages(
      envelope({
        items: [
          issueItem({
            id: 'PVTI_pai_pelado',
            number: 9,
            parent: { number: 25 },
            fields: { Status: ['📋 Backlog', BACKLOG] },
          }),
        ],
      }),
    )

    // `''` e não `null`: é o número que faz o crachá existir, e o título só alimenta o `title` do
    // hover. Matar o vínculo por causa dele seria perder o fato por causa do enfeite.
    expect(board.cards[0]?.parent).toEqual({ number: 25, title: '', repository: '' })
  })
})

/** Os três cartões do board 2 que vieram da captura de 2026-09-05 — os sintéticos têm id próprio. */
const CAPTURA_REAL = [1, 2, 4]

describe('BoardReader — a captura real da fixture continua intocada (CA-3)', () => {
  it('os nós sem a chave `parent` produzem `parent: null` e nenhuma fase', async () => {
    const envelopeDoBoard2 = fixture.boards['leonardo-amaral-3/2'] as GraphQLResponse

    // A premissa, afirmada e não suposta: a decisão 11 da spec é que a captura **não** é retocada
    // para caber no campo novo. Se uma recaptura futura trouxer `parent` de verdade, é aqui que
    // alguém descobre — e não num smoke, três dias depois.
    const nodes = (
      envelopeDoBoard2.data as {
        user: { projectV2: { items: { nodes: readonly { content?: Record<string, unknown> }[] } } }
      }
    ).user.projectV2.items.nodes
    const crus = nodes.filter((no) => CAPTURA_REAL.includes(Number(no.content?.['number'])))

    expect(crus).toHaveLength(CAPTURA_REAL.length)
    expect(crus.every((no) => no.content !== undefined && !('parent' in no.content))).toBe(true)

    // E a conclusão: `asRecord(undefined)` é `null`, o mesmo que `parent: null` daria.
    const board = await read(createFakeGraphQL(envelopeDoBoard2))
    const reais = board.cards.filter((card) => CAPTURA_REAL.includes(card.number))

    // O `toEqual` do filtro antes do `every`: sem ele, um filtro que não achasse ninguém deixaria
    // as duas linhas abaixo verdes por vacuidade.
    expect(reais.map((card) => card.number)).toEqual(CAPTURA_REAL)
    expect(reais.every((card) => card.parent === null)).toBe(true)
    expect(reais.every((card) => card.phases.length === 0)).toBe(true)
  })
})
