import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT } from './smoke-env'

/**
 * Os dados do GitHub do smoke da F6 (#135): o board e os cards da fixture, com quatro itens
 * sintéticos a mais (duas frentes para o Briefing e dois cards no trem do Release). Só leitura:
 * grava cópias em `pasta` e devolve os dois caminhos, que o smoke passa ao app por
 * `OC_BOARD_FIXTURE` e `OC_CARD_FIXTURE`.
 */

const REPO = 'leonardo-amaral-3/operations-center'
const CHAVE_DO_BOARD = 'leonardo-amaral-3/2'

type Json = Record<string, unknown>

interface Opcao {
  id: string
  name: string
}

function item(
  numero: number,
  titulo: string,
  status: Opcao,
  tipo: Opcao,
  parent?: { number: number; title: string },
): Json {
  const content: Json = {
    __typename: 'Issue',
    number: numero,
    title: titulo,
    url: `https://github.com/${REPO}/issues/${numero}`,
    closed: false,
    repository: { nameWithOwner: REPO },
    assignees: { nodes: [] },
  }
  if (parent !== undefined) {
    content.parent = { ...parent, repository: { nameWithOwner: REPO } }
  }
  return {
    id: `PVTI_f6_${numero}`,
    content,
    fieldValues: {
      nodes: [
        { optionId: status.id, name: status.name, field: { name: 'Status' } },
        { optionId: tipo.id, name: tipo.name, field: { name: 'Tipo' } },
      ],
    },
  }
}

function comentario(numero: number, corpo: string): Json {
  return {
    id: `IC_f6_${numero}`,
    author: { login: 'leonardo-amaral-3' },
    createdAt: '2026-11-11T10:00:00Z',
    body: corpo,
  }
}

export function montarGitHubDaF6(pasta: string): { board: string; cards: string } {
  const board = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/board.json'), 'utf8')) as {
    boards: Record<
      string,
      {
        data: {
          user: {
            projectV2: {
              field: { options: Opcao[] }
              items: { nodes: Json[] }
            }
          }
        }
      }
    >
  }
  const projeto = board.boards[CHAVE_DO_BOARD]?.data.user.projectV2
  if (projeto === undefined) throw new Error(`a fixture do board não tem ${CHAVE_DO_BOARD}`)
  const opcao = (nome: string): Opcao => {
    const achada = projeto.field.options.find((o) => o.name === nome)
    if (achada === undefined) throw new Error(`o Status "${nome}" não está em field.options`)
    return achada
  }
  const melhoria: Opcao = { id: 'b6b3a417', name: '✨ Melhoria' }
  const bug: Opcao = { id: '5bef632a', name: '🐞 Bug' }
  projeto.items.nodes.push(
    item(940, 'Sintético: frente do backlog para o briefing', opcao('📋 Backlog'), melhoria),
    item(941, 'Sintético: frente da triagem para o briefing', opcao('📥 Triagem'), bug),
    item(942, 'Sintético: card no trem com verificação', opcao('🚂 Release'), melhoria),
    item(943, 'Sintético: fase no trem com a spec no épico', opcao('🚂 Release'), bug, {
      number: 905,
      title: 'Sintético: épico com duas fases, em estações diferentes',
    }),
  )

  const cards = JSON.parse(
    readFileSync(join(REPO_ROOT, 'tests/fixtures/cards.json'), 'utf8'),
  ) as Record<string, { data: { repository: { issue: Json } } }>
  const molde = cards['4']
  if (molde === undefined) throw new Error('a fixture dos cards não tem o #4')
  const clonar = (numero: number, corpo: string): unknown => {
    const copia = JSON.parse(JSON.stringify(molde)) as typeof molde
    const issue = copia.data.repository.issue
    issue.number = numero
    issue.body = ''
    issue.comments = { totalCount: 1, nodes: [comentario(numero, corpo)] }
    return copia
  }
  cards['942'] = clonar(
    942,
    '<!-- gm:spec -->\n\n# Sintético — Spec\n\n## Verificação pós-deploy\nNa dev:\n1. abrir o Release e ver o #942;\n2. copiar as notas.\n\n## Plano de testes\nN/A',
  ) as (typeof cards)[string]
  cards['943'] = clonar(
    943,
    '<!-- gm:spec-ref -->\n\nA spec é a do épico #905.',
  ) as (typeof cards)[string]

  mkdirSync(pasta, { recursive: true })
  const caminhoDoBoard = join(pasta, 'board.json')
  const caminhoDosCards = join(pasta, 'cards.json')
  writeFileSync(caminhoDoBoard, JSON.stringify(board, null, 2))
  writeFileSync(caminhoDosCards, JSON.stringify(cards, null, 2))
  return { board: caminhoDoBoard, cards: caminhoDosCards }
}
