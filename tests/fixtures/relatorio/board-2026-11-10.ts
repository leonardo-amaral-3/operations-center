import type { GraphQLFn, GraphQLResponse } from '../../../src/core/board/types'

/**
 * O board de 10/11/2026 como o GitHub o devolveu (R9, R11, R12), para os dois documentos do
 * relatório. Só as fases da fábrica (#118 a #121) mexeram no dia; a #27 está no board, mas a última
 * mudança dela é de setembro, e por isso os nós dela vêm vazios.
 */

export const REPO_DA_FIXTURE = 'leonardo-amaral-3/operations-center'

interface Evento {
  createdAt: string
  previousStatus: string
  status: string
  project: { number: number }
}

function evento(createdAt: string, previousStatus: string, status: string): Evento {
  return { createdAt, previousStatus, status, project: { number: 2 } }
}

const BASE = 'https://github.com/leonardo-amaral-3/operations-center/issues'

interface CardDaFixture {
  titulo: string
  pai: number | null
  eventos: readonly Evento[]
}

/** Os cards da fábrica: títulos e URLs reais, pai e eventos de R9. */
const CARDS: Readonly<Record<number, CardDaFixture>> = {
  118: {
    titulo: 'Fábrica agêntica: o Operations Center despacha, governa e presta contas',
    pai: null,
    eventos: [
      evento('2026-11-10T19:59:00Z', '', '📥 Triagem'),
      evento('2026-11-10T20:01:23Z', '📥 Triagem', '📋 Backlog'),
    ],
  },
  119: {
    titulo:
      'Fase P0 do #118: portão de teste no Linux sem janela, claude do PATH, Direção e Mandato no repo',
    pai: 118,
    eventos: [evento('2026-11-10T20:47:01Z', '', '🎯 Especificação')],
  },
  120: {
    titulo: 'Fase P1 do #118: relatório do dia por frente, só com o que tem fonte',
    pai: 118,
    eventos: [evento('2026-11-10T20:57:03Z', '', '🎯 Especificação')],
  },
  121: {
    titulo: 'Fase P2 do #118: yarn fabrica, despachante sem janela com estado em disco',
    pai: 118,
    eventos: [evento('2026-11-10T20:58:43Z', '', '🎯 Especificação')],
  },
}

const MUDOU_NO_DIA = { nodes: [{ createdAt: '2026-11-10T20:00:00Z' }] }

function itemMovido(numero: number) {
  return {
    content: {
      __typename: 'Issue',
      number: numero,
      repository: { nameWithOwner: REPO_DA_FIXTURE },
      timelineItems: MUDOU_NO_DIA,
    },
  }
}

function respostaDosMovidos(): GraphQLResponse {
  return {
    data: {
      user: {
        projectV2: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                content: {
                  __typename: 'Issue',
                  number: 27,
                  repository: { nameWithOwner: REPO_DA_FIXTURE },
                  timelineItems: { nodes: [] },
                },
              },
              itemMovido(118),
              itemMovido(119),
              itemMovido(120),
              itemMovido(121),
            ],
          },
        },
      },
      organization: null,
    },
    errors: [
      {
        message: "Could not resolve to an Organization with the login of 'leonardo-amaral-3'.",
        path: ['organization'],
        type: 'NOT_FOUND',
      } as { message: string; path: string[] },
    ],
  }
}

function cardDaFixture(numero: number) {
  const card = CARDS[numero]
  if (!card) return null

  return {
    __typename: 'Issue',
    number: numero,
    title: card.titulo,
    url: `${BASE}/${numero}`,
    parent:
      card.pai === null
        ? null
        : { number: card.pai, repository: { nameWithOwner: REPO_DA_FIXTURE } },
    timelineItems: { pageInfo: { hasNextPage: false }, nodes: card.eventos },
  }
}

/**
 * O `GraphQLFn` falso: responde `RelatorioMovidos` com uma página e `RelatorioCards` com um alias
 * por número pedido. Número fora de 118 a 121 volta `null` com o `NOT_FOUND` do GitHub (R13).
 */
function responder(documento: string): GraphQLResponse {
  if (documento.includes('query RelatorioMovidos')) return respostaDosMovidos()

  if (documento.includes('query RelatorioCards')) {
    const numeros = [...documento.matchAll(/\bc(\d+): issueOrPullRequest/g)].map((m) =>
      Number(m[1]),
    )
    const repository: Record<string, unknown> = {}
    const errors: unknown[] = []

    for (const n of numeros) {
      const card = cardDaFixture(n)
      repository[`c${n}`] = card
      if (card === null) {
        errors.push({
          type: 'NOT_FOUND',
          path: ['repository', `c${n}`],
          message: `Could not resolve to an issue or pull request with the number of ${n}.`,
        })
      }
    }

    return {
      data: { repository },
      ...(errors.length > 0 ? { errors: errors as { message: string }[] } : {}),
    }
  }

  throw new Error('documento desconhecido na fixture do board')
}

export const graphqlDe10de11: GraphQLFn = (documento) =>
  Promise.resolve().then(() => responder(documento))
