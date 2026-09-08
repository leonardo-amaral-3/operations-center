import { describe, expect, it } from 'vitest'

import { BoardFinder, pickActive } from '../../src/core/board/BoardFinder'
import type { DiscoveredBoard, Discovery } from '../../src/core/board/BoardFinder'
import { MAX_PAGES } from '../../src/core/board/envelope'
import { OWNERS_QUERY, PROJECTS_QUERY } from '../../src/core/board/query'
import type { GraphQLError, GraphQLFn, GraphQLResponse } from '../../src/core/board/types'
import { notFound } from '../fakes/fakeGraphQL'

/**
 * O descobridor, sozinho e sem quem o consuma.
 *
 * O cenário do filtro é o **retrato medido em 2026-09-07** — 16 Projects que o token enxerga, dos
 * quais 2 rodam a esteira e 10 estão arquivados — mais o 17º sintético, que existe para uma lista
 * fixa no código errar a contagem. O que a medição fixa são os **conjuntos de `Status`**, a
 * contagem e o que está arquivado; os títulos dos que não importam são preenchidos.
 *
 * A prova mecânica de que a lista não está escrita no código é do smoke, que deriva de
 * `tests/fixtures/boards.json` quantas abas espera. Aqui a mesma pergunta é feita em unidade, contra
 * os conjuntos que existem de verdade — é a diferença entre provar que o filtro funciona e provar
 * que ele funciona no dia em que o app abrir.
 */

const EU = 'leonardo-amaral-3'
const ORG = 'ICSF-Solutions'

/** Os quatro conjuntos de `Status` que os 16 Projects declaram. */
const ESTEIRA = [
  '📥 Triagem',
  '📋 Backlog',
  '🎯 Especificação',
  '🔨 Implementação',
  '👀 Revisão',
  '🧪 Validação em Dev',
  '🚂 Release',
  '✅ Produção',
]
const TODO = ['Todo', 'In Progress', 'Done']
const READY = ['Backlog', 'Ready', 'In progress', 'In review', 'Done']
const LEGADO = ['Backlog', 'A Fazer', 'Em andamento', 'Revisão de código']

/** Os 2 Projects do usuário: o board deste app, e um `untitled project` que não roda a esteira. */
const MEUS: readonly ProjectInput[] = [
  { owner: EU, number: 2, title: 'Operations Center', options: ESTEIRA },
  { owner: EU, number: 1, title: 'untitled project', options: TODO },
]

/**
 * Os 14 da org: 4 vivos e 10 arquivados. Só o `Plataformas v2` roda a esteira — e nenhum arquivado
 * roda, que é o que faz o degrau do `closed` precisar do teste dedicado logo abaixo para significar
 * alguma coisa.
 */
const DA_ORG: readonly ProjectInput[] = [
  { owner: ORG, number: 19, title: 'Plataformas v2', options: ESTEIRA },
  { owner: ORG, number: 18, title: 'teste', options: TODO },
  { owner: ORG, number: 17, title: 'Módulos Legados', options: LEGADO },
  // Board que **não declara** o campo `Status`: sem ele não há esteira a espelhar, e o `[]` que o
  // leitor extrai não passa em `runsEsteira`.
  { owner: ORG, number: 16, title: 'quadro sem Status', options: null },
  { owner: ORG, number: 15, title: 'Plataformas', closed: true, options: LEGADO },
  ...[14, 13, 12, 11, 10, 9, 8, 7, 6].map((number, indice) => ({
    owner: ORG,
    number,
    title: `quadro arquivado ${number}`,
    closed: true,
    options: indice % 2 === 0 ? TODO : READY,
  })),
]

/**
 * O 17º, sintético: as 8 estações declaradas, sob um dono e um número que não existem no mundo.
 *
 * Ele é listado sob a org **e declara outro dono** de propósito — é o caso que faz a chave ser
 * montada com o `owner` do nó, e não com o dono que estava sendo varrido. Sem isso a aba nasceria
 * com uma chave que o `BoardReader.read` não resolve: uma aba morta para sempre.
 */
const SINTETICO: ProjectInput = {
  owner: 'dono-que-nao-existe',
  number: 999,
  title: 'Quadro Sintético',
  options: ESTEIRA,
}

describe('BoardFinder — o filtro: só os boards que rodam a esteira viram aba (CA-0.1)', () => {
  it('dos 17 Projects saem exatamente os 3 que declaram as 8 estações', async () => {
    const daOrg = [...DA_ORG, SINTETICO]
    expect([...MEUS, ...daOrg]).toHaveLength(17)

    const { boards, failed } = await find({
      owners: [owners({ orgs: [ORG] })],
      byOwner: {
        [EU]: [projects({ nodes: MEUS })],
        [ORG]: [projects({ alias: 'organization', nodes: daOrg })],
      },
    })

    expect(boards.map((board) => board.key)).toEqual([
      `${EU}/2`,
      `${ORG}/19`,
      'dono-que-nao-existe/999',
    ])
    expect(failed).toEqual([])
  })

  it('devolve a coordenada inteira, com o dono que o **nó** declara', async () => {
    const { boards } = await find({
      owners: [owners({ orgs: [ORG] })],
      byOwner: {
        [EU]: [projects({ nodes: [] })],
        // O nó está na lista da org, mas diz pertencer a outro dono. Quem manda é o nó.
        [ORG]: [projects({ alias: 'organization', nodes: [SINTETICO] })],
      },
    })

    expect(boards).toEqual([
      {
        key: 'dono-que-nao-existe/999',
        owner: 'dono-que-nao-existe',
        number: 999,
        title: 'Quadro Sintético',
      },
    ])
  })

  it('descarta o board arquivado **antes** do teste da esteira', async () => {
    // O degrau só significa alguma coisa contra um board que passaria no segundo: hoje nenhum
    // arquivado roda a esteira, e o degrau existe para o dia em que um da esteira for arquivado.
    const { boards } = await find({
      owners: [owners()],
      byOwner: {
        [EU]: [
          projects({
            nodes: [
              { owner: EU, number: 3, title: 'Esteira arquivada', closed: true, options: ESTEIRA },
              { owner: EU, number: 2, title: 'Esteira viva', options: ESTEIRA },
            ],
          }),
        ],
      },
    })

    expect(boards.map((board) => board.title)).toEqual(['Esteira viva'])
  })

  it('atravessa nó torto sem explodir: sem número, sem título, sem dono e fora de formato', async () => {
    const tortos = [
      null,
      'nem objeto é',
      { ...node({ owner: EU, number: 4, title: 'sem dono' }), owner: null },
      { ...node({ owner: EU, number: 5, title: 'número que não é número' }), number: '5' },
      { ...node({ owner: EU, number: 6, title: 'sem título' }), title: null },
      { ...node({ owner: EU, number: 7, title: 'campo torto' }), field: { options: 'nada disso' } },
      node({ owner: EU, number: 8, title: 'o único inteiro' }),
    ]

    const { boards } = await find({
      owners: [owners()],
      byOwner: { [EU]: [{ data: { user: { projectsV2: page(tortos) }, organization: null } }] },
    })

    expect(boards.map((board) => board.key)).toEqual([`${EU}/8`])
  })
})

describe('BoardFinder — a ordem das abas', () => {
  it('é alfabética pelo título, e alfabética de gente: `Ártico` vem antes de `Azul`', async () => {
    // A ordem de code point poria `Azul` primeiro, porque `Á` é 193 e `z` é 122. O `Intl.Collator`
    // é o que faz a barra de abas ficar na ordem em que alguém procuraria um nome.
    const { boards } = await find({
      owners: [owners()],
      byOwner: {
        [EU]: [
          projects({
            nodes: ['Azul', 'Zulu', 'Ártico'].map((title, indice) => ({
              owner: EU,
              number: indice + 1,
              title,
              options: ESTEIRA,
            })),
          }),
        ],
      },
    })

    expect(boards.map((board) => board.title)).toEqual(['Ártico', 'Azul', 'Zulu'])
  })

  it('desempata título igual pelo dono, e não pela ordem em que os donos foram varridos', async () => {
    // `beta` é varrido primeiro (é o viewer) e sai depois: sem o desempate, a estabilidade do
    // `Array.sort` faria a posição herdar a ordem da varredura — um detalhe interno, não um fato do
    // board.
    const { boards } = await find({
      owners: [owners({ login: 'beta', orgs: ['alfa'] })],
      byOwner: {
        beta: [
          projects({ nodes: [{ owner: 'beta', number: 1, title: 'Mesmo', options: ESTEIRA }] }),
        ],
        alfa: [
          projects({
            alias: 'organization',
            nodes: [{ owner: 'alfa', number: 1, title: 'Mesmo', options: ESTEIRA }],
          }),
        ],
      },
    })

    expect(boards.map((board) => board.key)).toEqual(['alfa/1', 'beta/1'])
  })

  it('desempata título e dono iguais pelo número, crescente', async () => {
    const { boards } = await find({
      owners: [owners()],
      byOwner: {
        [EU]: [
          projects({
            nodes: [7, 3].map((number) => ({
              owner: EU,
              number,
              title: 'Mesmo',
              options: ESTEIRA,
            })),
          }),
        ],
      },
    })

    expect(boards.map((board) => board.number)).toEqual([3, 7])
  })
})

describe('BoardFinder — o envelope: qual alias vale e qual erro é tolerável', () => {
  it('usa o alias `user` e ignora o NOT_FOUND do `organization` que a API manda junto', async () => {
    const { boards } = await find({
      owners: [owners()],
      byOwner: { [EU]: [projects({ alias: 'user', nodes: [SINTETICO] })] },
    })

    expect(boards).toHaveLength(1)
  })

  it('usa o alias `organization` quando é ele que resolve, ignorando o NOT_FOUND do `user`', async () => {
    const { boards } = await find({
      owners: [owners({ login: EU, orgs: [ORG] })],
      byOwner: {
        [EU]: [projects({ nodes: [] })],
        [ORG]: [projects({ alias: 'organization', nodes: [SINTETICO] })],
      },
    })

    expect(boards).toHaveLength(1)
  })

  it('erro de outro path derruba **aquele dono**: engolir esconderia falha de campo de verdade', async () => {
    const { boards, failed } = await find({
      owners: [owners({ orgs: [ORG] })],
      byOwner: {
        [EU]: [projects({ nodes: [{ owner: EU, number: 2, title: 'Vivo', options: ESTEIRA }] })],
        [ORG]: [
          projects({
            alias: 'organization',
            errors: [
              notFound('user'),
              { message: 'Field "field" argument "name" is required.', path: ['organization'] },
            ],
          }),
        ],
      },
    })

    expect(boards.map((board) => board.key)).toEqual([`${EU}/2`])
    expect(failed).toEqual([{ owner: ORG, reason: 'Field "field" argument "name" is required.' }])
  })
})

describe('BoardFinder — a paginação', () => {
  it('acumula as organizações das páginas seguintes, pedindo cada uma com o cursor da anterior', async () => {
    const fake = createFake({
      owners: [
        owners({ orgs: ['org-a'], hasNextPage: true, endCursor: 'cursor-dos-donos' }),
        owners({ orgs: ['org-b'] }),
      ],
      byOwner: {
        [EU]: [projects({ nodes: [] })],
        'org-a': [projects({ alias: 'organization', nodes: [] })],
        'org-b': [projects({ alias: 'organization', nodes: [SINTETICO] })],
      },
    })

    const { boards } = await new BoardFinder({ graphql: fake.graphql }).find()

    expect(boards).toHaveLength(1)
    expect(fake.calls[0]).toEqual({ document: OWNERS_QUERY, variables: { cursor: null } })
    expect(fake.calls[1]).toEqual({
      document: OWNERS_QUERY,
      variables: { cursor: 'cursor-dos-donos' },
    })
    // Os donos, nesta ordem e sem repetição — e só depois de a lista inteira estar de pé.
    expect(fake.calls.slice(2)).toEqual(
      [EU, 'org-a', 'org-b'].map((owner) => ({
        document: PROJECTS_QUERY,
        variables: { owner, cursor: null },
      })),
    )
  })

  it('não varre o mesmo dono duas vezes quando ele aparece repetido', async () => {
    const fake = createFake({
      owners: [owners({ login: EU, orgs: [ORG, EU, ORG] })],
      byOwner: {
        [EU]: [projects({ nodes: [] })],
        [ORG]: [projects({ alias: 'organization', nodes: [] })],
      },
    })

    await new BoardFinder({ graphql: fake.graphql }).find()

    expect(fake.calls.filter((call) => call.document === PROJECTS_QUERY)).toHaveLength(2)
  })

  it('acumula os Projects das páginas seguintes de um dono, com o cursor da anterior', async () => {
    const fake = createFake({
      owners: [owners()],
      byOwner: {
        [EU]: [
          projects({
            nodes: [{ owner: EU, number: 2, title: 'Primeiro', options: ESTEIRA }],
            hasNextPage: true,
            endCursor: 'cursor-dos-projects',
          }),
          projects({ nodes: [{ owner: EU, number: 3, title: 'Segundo', options: ESTEIRA }] }),
        ],
      },
    })

    const { boards } = await new BoardFinder({ graphql: fake.graphql }).find()

    expect(boards.map((board) => board.title)).toEqual(['Primeiro', 'Segundo'])
    expect(fake.calls[2]?.variables).toEqual({ owner: EU, cursor: 'cursor-dos-projects' })
  })

  it('lança ao estourar MAX_PAGES nos donos, em vez de girar num pageInfo malformado', async () => {
    // A última página do roteiro se repete: esta diz `hasNextPage` para sempre.
    const fake = createFake({
      owners: [owners({ hasNextPage: true, endCursor: 'sempre-o-mesmo' })],
      byOwner: {},
    })

    await expect(new BoardFinder({ graphql: fake.graphql }).find()).rejects.toThrow(
      `mais de ${MAX_PAGES} páginas de organizações`,
    )
    expect(fake.calls).toHaveLength(MAX_PAGES)
  })

  it('lança ao estourar MAX_PAGES nos Projects de um dono', async () => {
    const fake = createFake({
      owners: [owners()],
      byOwner: { [EU]: [projects({ hasNextPage: true, endCursor: 'sempre-o-mesmo' })] },
    })

    await expect(new BoardFinder({ graphql: fake.graphql }).find()).rejects.toThrow(
      `mais de ${MAX_PAGES} páginas de Projects`,
    )
    expect(fake.calls).toHaveLength(MAX_PAGES + 1)
  })
})

describe('BoardFinder — um dono que falha não apaga os boards dos outros (CA-0.3)', () => {
  it('a org bloqueada entra em `failed` com o motivo, e os boards do dono que respondeu ficam', async () => {
    const { boards, failed } = await find({
      owners: [owners({ orgs: [ORG] })],
      byOwner: {
        [EU]: [projects({ nodes: MEUS })],
        [ORG]: [saml()],
      },
    })

    expect(boards.map((board) => board.key)).toEqual([`${EU}/2`])
    expect(failed).toEqual([{ owner: ORG, reason: SAML }])
  })

  it('rejeita quando **todos** os donos falham, com o motivo do primeiro', async () => {
    // Aí não houve descoberta: rejeitar é o que faz o gatilho seguinte tentar de novo, em vez de
    // aceitar uma lista vazia como resposta boa.
    const finder = new BoardFinder({
      graphql: createFake({
        owners: [owners({ orgs: [ORG] })],
        byOwner: {
          [EU]: [saml('o primeiro motivo')],
          [ORG]: [saml('o segundo motivo')],
        },
      }).graphql,
    })

    await expect(finder.find()).rejects.toThrow('o primeiro motivo')
  })

  it('rejeita quando a lista de donos falha — sem ela não há descoberta a relatar', async () => {
    const quebrado = { data: null, errors: [{ message: 'Bad credentials' }] }

    await expect(
      new BoardFinder({ graphql: createFake({ owners: [quebrado], byOwner: {} }).graphql }).find(),
    ).rejects.toThrow('Bad credentials')
  })

  it('rejeita quando o GitHub não diz de quem é o token', async () => {
    const semViewer = { data: { viewer: null } }

    await expect(
      new BoardFinder({ graphql: createFake({ owners: [semViewer], byOwner: {} }).graphql }).find(),
    ).rejects.toThrow('não disse de quem é o token')
  })
})

describe('pickActive — qual aba nasce ativa', () => {
  const BOARDS: readonly DiscoveredBoard[] = [
    { key: 'a/1', owner: 'a', number: 1, title: 'A' },
    { key: 'b/2', owner: 'b', number: 2, title: 'B' },
  ]

  it('sem lembrado, vale a primeira da ordem', () => {
    expect(pickActive(BOARDS, null)).toBe('a/1')
  })

  it('lista vazia não tem aba ativa', () => {
    expect(pickActive([], null)).toBeNull()
  })
})

// ── O cliente de mentira ──────────────────────────────────────────────────────────────────────
//
// Despacha por **documento**, e não por ordem de chamada como o `createFakeGraphQL` do board: o
// `find()` manda um `OWNERS_QUERY` e depois N `PROJECTS_QUERY` em paralelo, e um roteiro por posição
// serviria a página do dono errado. Esgotadas as páginas de um documento, a última se repete — é o
// que deixa escrever o caso do `pageInfo` malformado sem um roteiro de vinte entradas.

interface Call {
  document: string
  variables: Record<string, unknown>
}

interface Roteiro {
  /** As páginas do `OWNERS_QUERY`. */
  owners: readonly GraphQLResponse[]
  /** Por dono, as páginas do `PROJECTS_QUERY`. Dono fora do mapa é erro de roteiro, não caso de uso. */
  byOwner: Readonly<Record<string, readonly GraphQLResponse[]>>
}

interface Fake {
  graphql: GraphQLFn
  calls: readonly Call[]
}

function createFake(roteiro: Roteiro): Fake {
  const calls: Call[] = []
  const vezes = new Map<string, number>()

  const graphql: GraphQLFn = (document, variables) => {
    calls.push({ document, variables })

    const dono = document === OWNERS_QUERY ? '' : String(variables['owner'])
    const paginas = document === OWNERS_QUERY ? roteiro.owners : roteiro.byOwner[dono]
    if (paginas === undefined || paginas.length === 0) {
      return Promise.reject(new Error(`o roteiro não tem páginas para "${dono}"`))
    }

    const vez = vezes.get(dono) ?? 0
    vezes.set(dono, vez + 1)

    return Promise.resolve(paginas[Math.min(vez, paginas.length - 1)] as GraphQLResponse)
  }

  return { graphql, calls }
}

function find(roteiro: Roteiro): Promise<Discovery> {
  return new BoardFinder({ graphql: createFake(roteiro).graphql }).find()
}

interface OwnersInput {
  login?: string | null
  orgs?: readonly string[]
  hasNextPage?: boolean
  endCursor?: string | null
}

/** Uma página do `OWNERS_QUERY`, na forma em que a API a devolve. */
function owners(input: OwnersInput = {}): GraphQLResponse {
  const { login = EU, orgs = [], hasNextPage = false, endCursor = null } = input

  return {
    data: {
      viewer: {
        login,
        organizations: {
          pageInfo: { hasNextPage, endCursor },
          nodes: orgs.map((org) => ({ login: org })),
        },
      },
    },
  }
}

interface ProjectsInput {
  /** Qual alias resolve. O outro vem `null`, com o `NOT_FOUND` que a API real manda junto. */
  alias?: 'user' | 'organization'
  nodes?: readonly ProjectInput[]
  hasNextPage?: boolean
  endCursor?: string | null
  /** Substitui os erros. O default é só o `NOT_FOUND` do alias que não resolveu. */
  errors?: readonly GraphQLError[]
}

/** Uma página do `PROJECTS_QUERY`: um alias preenchido, o outro `null` e o `NOT_FOUND` dele. */
function projects(input: ProjectsInput = {}): GraphQLResponse {
  const { alias = 'user', nodes = [], hasNextPage = false, endCursor = null, errors } = input
  const outro = alias === 'user' ? 'organization' : 'user'

  return {
    data: {
      [alias]: { projectsV2: page(nodes.map(node), hasNextPage, endCursor) },
      [outro]: null,
    },
    errors: errors ?? [notFound(outro)],
  }
}

/** A resposta da org que o token vê mas não pode abrir: os dois aliases `null` e um erro fatal. */
const SAML = 'Resource protected by organization SAML enforcement.'

function saml(message: string = SAML): GraphQLResponse {
  return {
    data: { user: null, organization: null },
    errors: [{ message, path: ['organization'] }],
  }
}

interface ProjectInput {
  owner: string
  number: number
  title: string
  closed?: boolean
  /** As opções do campo `Status`, na ordem. `null` = board que não declara o campo. */
  options?: readonly string[] | null
}

/** Um nó de `projectsV2`, como o documento o pede. */
function node(input: ProjectInput): Record<string, unknown> {
  const { owner, number, title, closed = false, options = ESTEIRA } = input

  return {
    number,
    title,
    closed,
    owner: { login: owner },
    field: options === null ? null : { options: options.map((name) => ({ name })) },
  }
}

function page(
  nodes: readonly unknown[],
  hasNextPage = false,
  endCursor: string | null = null,
): Record<string, unknown> {
  return { pageInfo: { hasNextPage, endCursor }, nodes }
}
