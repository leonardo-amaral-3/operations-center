import { describe, expect, it } from 'vitest'

import { CardReader, MAX_COMMENTS } from '../../src/core/board/CardReader'
import { CARD_QUERY } from '../../src/core/board/query'
import type { CardContent, GraphQLResponse } from '../../src/core/board/types'
import { cardEnvelope, commentNode, createFakeGraphQL, prRefNode } from '../fakes/fakeGraphQL'

const INPUT = { owner: 'leonardo-amaral-3', name: 'operations-center', number: 13 }

function read(page: GraphQLResponse): Promise<CardContent> {
  return new CardReader({ graphql: createFakeGraphQL(page).graphql }).read(INPUT)
}

/** Só a etiqueta, que é a regra 5 destilada — o resto do comentário não interessa ao caso. */
async function kindOf(body: string): Promise<string | null> {
  const content = await read(cardEnvelope({ comments: [commentNode({ id: 'c1', body })] }))
  const [comment] = content.comments

  // Alto de propósito: um comentário descartado pela regra 4 devolveria `null` daqui e faria o caso
  // "não etiqueta" passar verde pelo motivo errado.
  if (!comment) throw new Error('o comentário do caso não sobreviveu à tradução')

  return comment.kind
}

describe('CardReader — regras 1 e 2: o que é fatal', () => {
  it('lança em qualquer `errors`, mesmo com `data` preenchido — este documento não tem erro esperado', async () => {
    const quebrado = cardEnvelope({
      errors: [{ message: 'Field "body" doesn\'t exist on type "Issue".' }],
    })

    await expect(read(quebrado)).rejects.toThrow('Field "body" doesn\'t exist on type "Issue".')
  })

  it('lança quando o `repository` vem nulo — o caminho do repo forasteiro ou privado sem acesso', async () => {
    await expect(read(cardEnvelope({ missing: 'repository' }))).rejects.toThrow(
      'o GitHub não devolveu a issue #13 de leonardo-amaral-3/operations-center — repo inacessível ou card removido',
    )
  })

  it('lança com a mesma mensagem quando a `issue` vem nula — o card foi removido', async () => {
    await expect(read(cardEnvelope({ missing: 'issue' }))).rejects.toThrow(
      /não devolveu a issue #13 de leonardo-amaral-3\/operations-center/,
    )
  })

  it('lança quando não veio `data` nenhum', async () => {
    await expect(read({ data: null })).rejects.toThrow(/não devolveu a issue #13/)
  })
})

describe('CardReader — regra 3: o corpo', () => {
  it('devolve o corpo da issue como o GitHub o escreveu', async () => {
    const content = await read(cardEnvelope({ number: 6, body: '## Contexto\n\numa linha' }))

    expect(content).toMatchObject({ number: 6, body: '## Contexto\n\numa linha' })
  })

  it('vira string vazia quando a issue não tem corpo — card sem corpo é caso normal, não erro', async () => {
    const content = await read(cardEnvelope({ body: null }))

    expect(content.body).toBe('')
  })
})

describe('CardReader — regra 4: os comentários', () => {
  it('traduz os comentários na ordem da resposta, que é a cronológica que a API devolve', async () => {
    const content = await read(
      cardEnvelope({
        comments: [
          commentNode({ id: 'c1', body: 'o primeiro', createdAt: '2026-09-01T09:00:00Z' }),
          commentNode({ id: 'c2', body: 'o segundo', author: 'outra-pessoa' }),
        ],
      }),
    )

    expect(content.comments).toEqual([
      {
        id: 'c1',
        author: 'leonardo-amaral-3',
        createdAt: '2026-09-01T09:00:00Z',
        body: 'o primeiro',
        kind: null,
      },
      {
        id: 'c2',
        author: 'outra-pessoa',
        createdAt: '2026-09-06T12:00:00Z',
        body: 'o segundo',
        kind: null,
      },
    ])
  })

  it('descarta em silêncio o nó sem `id` e o nó sem `body` — não há o que mostrar nem por qual chave', async () => {
    const content = await read(
      cardEnvelope({
        comments: [
          { author: { login: 'alguem' }, createdAt: '2026-09-01T09:00:00Z', body: 'sem id' },
          { id: 'c2', author: { login: 'alguem' }, createdAt: '2026-09-01T10:00:00Z' },
          commentNode({ id: 'c3', body: 'o que sobra' }),
        ],
      }),
    )

    expect(content.comments.map((comment) => comment.id)).toEqual(['c3'])
  })

  it('devolve `author: null` para conta removida, e nunca string vazia — a informação é de verdade', async () => {
    const content = await read(
      cardEnvelope({ comments: [commentNode({ id: 'c1', body: 'de quem saiu', author: null })] }),
    )

    expect(content.comments).toEqual([expect.objectContaining({ author: null })])
  })
})

describe('CardReader — regra 5: a etiqueta sai do marcador da primeira linha', () => {
  it('lê `gm:spec` da primeira linha e **não** remove o marcador do corpo', async () => {
    const body = '<!-- gm:spec -->\n\n# Ler o conteúdo do card\n\n## References'
    const content = await read(cardEnvelope({ comments: [commentNode({ id: 'c1', body })] }))

    expect(content.comments[0]).toMatchObject({ kind: 'spec', body })
  })

  it('lê os outros marcadores da esteira, e um inédito também — `kind` é `string` solta', async () => {
    await expect(kindOf('<!-- gm:tasks -->\n### Tasks')).resolves.toBe('tasks')
    await expect(kindOf('<!-- gm:decisao -->\npor quê')).resolves.toBe('decisao')
    await expect(kindOf('<!-- gm:prd -->\num marcador que a esteira ainda não tem')).resolves.toBe(
      'prd',
    )
  })

  it('aceita o marcador colado e o corpo que começa com linhas em branco', async () => {
    await expect(kindOf('<!--gm:spec-->')).resolves.toBe('spec')
    await expect(kindOf('\n\n  <!-- gm:spec -->\ntexto')).resolves.toBe('spec')
  })

  it('não etiqueta comentário sem marcador', async () => {
    await expect(kindOf('só um comentário escrito à mão')).resolves.toBeNull()
  })

  it('não etiqueta marcador no meio do texto — falar de um não é ser um', async () => {
    await expect(kindOf('a spec põe um <!-- gm:tasks --> na primeira linha')).resolves.toBeNull()
  })
})

describe('CardReader — regras 6 e 7: o corte aparece, e a página é uma só', () => {
  it('não corta quando todos os comentários couberam', async () => {
    const content = await read(
      cardEnvelope({ comments: [commentNode({ id: 'c1', body: 'um' })], totalCount: 1 }),
    )

    expect(content.truncated).toBe(false)
  })

  it('marca `truncated` quando o `totalCount` excede os nós que vieram', async () => {
    const content = await read(
      cardEnvelope({ comments: [commentNode({ id: 'c1', body: 'um' })], totalCount: 137 }),
    )

    expect(content.truncated).toBe(true)
  })

  it('não inventa corte quando o `totalCount` não veio', async () => {
    const content = await read(
      cardEnvelope({ comments: [commentNode({ id: 'c1', body: 'um' })], totalCount: null }),
    )

    expect(content.truncated).toBe(false)
  })

  it('manda o CARD_QUERY uma vez só, com o teto de comentários e sem cursor', async () => {
    const fake = createFakeGraphQL(cardEnvelope())

    await new CardReader({ graphql: fake.graphql }).read(INPUT)

    expect(fake.calls).toEqual([
      {
        document: CARD_QUERY,
        variables: {
          owner: 'leonardo-amaral-3',
          name: 'operations-center',
          number: 13,
          comments: MAX_COMMENTS,
        },
      },
    ])
  })
})

describe('CardReader — o PR do card', () => {
  const doCard = prRefNode({ number: 76, body: '**Card:** #13', state: 'OPEN' })

  it('preenche `pullRequest` quando a timeline tem o PR do card', async () => {
    const content = await read(cardEnvelope({ timeline: [doCard] }))

    expect(content.pullRequest).toEqual({
      number: 76,
      url: 'https://github.com/leonardo-amaral-3/operations-center/pull/76',
      state: 'OPEN',
    })
  })

  it('devolve `null` sem `timelineItems`, e o resto do conteúdo fica igual', async () => {
    const content = await read(cardEnvelope({ number: 6, body: 'texto' }))

    expect(content).toEqual({
      number: 6,
      body: 'texto',
      comments: [],
      truncated: false,
      pullRequest: null,
    })
  })

  it('tolera `errors` com `path` em `timelineItems`: devolve o card e `pullRequest: null`', async () => {
    const content = await read(
      cardEnvelope({
        body: 'o card segue de pé',
        timeline: [doCard],
        errors: [
          { message: 'Resource not accessible', path: ['repository', 'issue', 'timelineItems', 'nodes', 0] },
        ],
      }),
    )

    expect(content).toMatchObject({ body: 'o card segue de pé', pullRequest: null })
  })

  it('erro na própria conexão anula a issue (timelineItems é não-nulo): relê sem a timeline', async () => {
    // O que o GitHub devolve quando o erro cai em `timelineItems`, e não num nó: o `null` sobe até a
    // `issue`, que é o primeiro campo anulável acima dela.
    const anulada: GraphQLResponse = {
      data: { repository: { issue: null } },
      errors: [{ message: 'timeline indisponível', path: ['repository', 'issue', 'timelineItems'] }],
    }
    const fake = createFakeGraphQL(anulada, cardEnvelope({ body: 'o card segue de pé' }))

    const content = await new CardReader({ graphql: fake.graphql }).read(INPUT)

    expect(content).toMatchObject({ body: 'o card segue de pé', pullRequest: null })
    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[1]?.variables).toMatchObject({ comPr: false })
  })

  it('issue nula sem erro de timeline não relê: é o repo inacessível da regra 2', async () => {
    const fake = createFakeGraphQL({ data: { repository: { issue: null } } })

    await expect(new CardReader({ graphql: fake.graphql }).read(INPUT)).rejects.toThrow('repo inacessível')
    expect(fake.calls).toHaveLength(1)
  })

  it('continua fatal com `errors` de outro `path`, mesmo ao lado de um erro de timeline', async () => {
    const quebrado = cardEnvelope({
      errors: [
        { message: 'na timeline', path: ['repository', 'issue', 'timelineItems'] },
        { message: 'no corpo', path: ['repository', 'issue', 'body'] },
      ],
    })

    await expect(read(quebrado)).rejects.toThrow('no corpo')
  })
})
