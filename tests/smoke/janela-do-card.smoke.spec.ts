import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

import { CONVERSABLE_STATIONS, STATUS_FIELD } from '../../src/core/board/query'
import type { ClaudeStateEvent } from '../../src/shared/claude'
import {
  BOARDS_FIXTURE_PATH,
  BOARD_FIXTURE_PATH,
  FIRST_BOARD,
  fixtureProject,
} from './boards-fixture'
import {
  PERGUNTA_17_25,
  RESPOSTA_42,
  digitarNoTerminal,
  launchSmokeApp,
  provarSessaoNaPasta,
  xtermDe,
} from './smoke-app'
import { REPO_ROOT } from './smoke-env'

/**
 * O smoke da janela própria do card (#100, fase 3, CA-2): uma conversa em curso atravessa o
 * "Destacar" e o "Trazer de volta" **sem reiniciar o processo** — o mesmo `id` em `readClaudeStates`
 * e a rolagem anterior (`42`) visível nas duas janelas.
 *
 * **Sobe sessão real, precisa do Claude Code logado e consome cota**: um único turno, de texto puro,
 * num modelo barato (`OC_MODEL` vira o `--model` do terminal Claude). É o molde do cenário do CA-3 de
 * `abas.smoke.spec.ts` — repo-fantoche com `origin` de verdade e raiz de transcripts em
 * `OC_CLAUDE_PROJECTS` —, copiado e não importado pela mesma razão que lá: o cenário é deste arquivo.
 *
 * O cartão sai da fixture (o primeiro conversável do primeiro board), e não de um número escrito à
 * mão: uma recaptura de `board.json` não pode deixar este arquivo verde provando outra coisa.
 */

const CARD_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'cards.json')

const SMOKE_MODEL = 'haiku'
const TURN_TIMEOUT = 180_000

interface FixtureNode {
  content: { __typename: string; number?: number; repository?: { nameWithOwner: string } }
  fieldValues: { nodes: readonly { optionId?: string; field?: { name?: string } }[] }
}

interface FixtureProject {
  field: { options: readonly { id: string; name: string }[] }
  items: { nodes: readonly FixtureNode[] }
}

interface Cartao {
  number: number
  repository: string
}

const CARTAO = escolherCartao()

let app: ElectronApplication
let window: Page
let state: string
let scenario: string
let pasta: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  state = mkdtempSync(join(tmpdir(), 'oc-janela-'))
  // `realpathSync`: a `cwd` que a sessão reporta é o caminho resolvido pelo sistema.
  scenario = realpathSync(mkdtempSync(join(tmpdir(), 'oc-janela-repos-')))
  pasta = fantoche(CARTAO.repository)
})

test.afterAll(async () => {
  await app?.close()
  // Só depois de o app morrer: o Windows segura handles nas pastas enquanto o Claude Code vive.
  rmSync(state, { recursive: true, force: true, maxRetries: 3 })
  rmSync(scenario, { recursive: true, force: true, maxRetries: 3 })
})

test('CA-2: destacar leva a conversa viva para a janela nova, e trazer de volta a devolve intacta', async () => {
  app = await launchSmokeApp({
    stateDir: state,
    env: {
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_CARD_FIXTURE: CARD_FIXTURE_PATH,
      OC_CLAUDE_PROJECTS: join(scenario, 'projects'),
      OC_SCREEN: 'kanban',
      OC_MODEL: SMOKE_MODEL,
    },
  })
  window = await app.firstWindow()

  // A conversa: o único turno de cota do arquivo. `42` não está no texto enviado.
  const cartao = window.locator(`[data-testid="board-card"][data-card-number="${CARTAO.number}"]`)
  await expect(cartao).toHaveAttribute('data-card-conversable', 'true')
  await cartao.click()
  const terminal = cartao.getByTestId('claude-terminal')
  await expect(terminal).toBeVisible()
  await digitarNoTerminal(terminal, PERGUNTA_17_25)
  await expect(xtermDe(terminal)).toContainText(RESPOSTA_42, { timeout: TURN_TIMEOUT })
  await provarSessaoNaPasta(pasta)

  const antes = await idsDoCartao()
  // Sem um terminal vivo a igualdade abaixo seria `[] == []`, e provaria nada.
  expect(antes).toHaveLength(1)

  // Destacar: abre a janela do card, e a principal troca o corpo pelo marcador.
  const janelaDoCard = app.waitForEvent('window')
  await cartao.getByTestId('card-detach').click()
  const card = await janelaDoCard
  await card.waitForLoadState('domcontentloaded')

  await expect(card.getByTestId('card-screen')).toBeVisible()
  // A rolagem anterior está na janela nova: o terminal foi adotado, não reiniciado.
  const terminalDoCard = card.getByTestId('claude-terminal')
  await expect(terminalDoCard).toBeVisible()
  await expect(xtermDe(terminalDoCard)).toContainText(RESPOSTA_42, { timeout: 30_000 })
  await expect(window.getByTestId('card-detached')).toBeVisible()
  await expect(window.getByTestId('claude-terminal')).toHaveCount(0)

  // O mesmo processo: um terminal só, com o mesmo `id`.
  expect(await idsDoCartao()).toEqual(antes)

  // Trazer de volta: a janela do card fecha, a principal reassume com a rolagem intacta.
  // O clique fecha a página que o recebeu: o Playwright reporta "Target page closed" no próprio
  // clique, e a prova de que ele valeu é o evento `close`, esperado ao lado.
  const fechou = card.waitForEvent('close')
  await card
    .getByTestId('card-bring-back')
    .click()
    .catch(() => undefined)
  await fechou
  await expect(window.getByTestId('card-detached')).toHaveCount(0)
  const devolvido = window.locator(
    `[data-testid="board-card"][data-card-number="${CARTAO.number}"]`,
  )
  await expect(xtermDe(devolvido.getByTestId('claude-terminal'))).toContainText(RESPOSTA_42, {
    timeout: 30_000,
  })
  expect(await idsDoCartao()).toEqual(antes)
})

/**
 * Os `id` dos terminais de card: `readClaudeStates` do renderer da principal, filtrado pelo cartão.
 * Só o `id`, e não o estado inteiro, que muda sozinho (`working` → `awaiting_input`); é o do pty, e reiniciar o processo o mudaria.
 */
async function idsDoCartao(): Promise<string[]> {
  const todos = await window.evaluate(() =>
    // `globalThis` e não `window`: aqui `window` é a `Page`, e o tsconfig dos smokes não tem a lib `dom`.
    (
      globalThis as unknown as { oc: { readClaudeStates(): Promise<ClaudeStateEvent[]> } }
    ).oc.readClaudeStates(),
  )

  return todos.filter((evento) => evento.scope.kind === 'card').map((evento) => evento.id)
}

/** O primeiro cartão conversável do primeiro board, pelas mesmas regras do `BoardReader`. */
function escolherCartao(): Cartao {
  const project = fixtureProject(FIRST_BOARD.key) as FixtureProject
  const conversaveis = new Set(
    project.field.options
      .filter((option) => CONVERSABLE_STATIONS.some((station) => option.name.includes(station)))
      .map((option) => option.id),
  )

  for (const node of project.items.nodes) {
    const { __typename, number, repository } = node.content
    const coluna = node.fieldValues.nodes.find((v) => v.field?.name === STATUS_FIELD)?.optionId

    if (__typename === 'Issue' && number !== undefined && coluna && conversaveis.has(coluna)) {
      return { number, repository: repository?.nameWithOwner ?? '' }
    }
  }

  throw new Error(
    `a fixture de ${FIRST_BOARD.key} não tem cartão conversável — sem isso este smoke prova menos`,
  )
}

/** `git init` de verdade, `origin` de verdade e um transcript de uma linha apontando para a pasta. */
function fantoche(repository: string): string {
  const raiz = join(scenario, 'repo')
  const projects = join(scenario, 'projects')

  mkdirSync(raiz)
  execFileSync('git', ['-C', raiz, 'init', '-q'])
  execFileSync('git', [
    '-C',
    raiz,
    'remote',
    'add',
    'origin',
    `https://github.com/${repository}.git`,
  ])

  mkdirSync(join(projects, 'fantoche'), { recursive: true })
  writeFileSync(
    join(projects, 'fantoche', 'fantoche.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: raiz })}\n`,
    'utf8',
  )

  return raiz
}
