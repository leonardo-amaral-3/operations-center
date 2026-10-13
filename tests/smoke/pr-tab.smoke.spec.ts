import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { CONVERSABLE_STATIONS, STATUS_FIELD } from '../../src/core/board/query'
import {
  BOARDS_FIXTURE_PATH,
  BOARD_FIXTURE_PATH,
  FIRST_BOARD,
  fixtureProject,
} from './boards-fixture'
import { launchSmokeApp } from './smoke-app'

/**
 * O smoke da aba PR: as abas Card e PR no cartão expandido, de ponta a ponta e **sem rede, sem
 * sessão e sem cota** — CA-1, CA-4, CA-5 e CA-6.
 *
 * É do time do `card-content.smoke.spec.ts`: a única fonte de dado são arquivos, e nada aqui fala
 * com o Claude Code. Os dois cartões saem da fixture do board pelo mesmo predicado dele — nenhum
 * número de card é escrito à mão. O PR é o **#9001** de `tests/fixtures/pulls.json`, ligado ao
 * cartão por uma `timelineItems` que o smoke acrescenta a uma **cópia** de `cards.json`, junto de
 * dois PRs que a descoberta tem de descartar (um de trem e um de outro card).
 *
 * As três fixtures de dado são lidas de cópias em diretório temporário: os passos 5 e 7 reescrevem o
 * `pulls.json` com o app de pé, e mutar a versionada deixaria fixture suja em disco.
 */

const REPO_ROOT = join(__dirname, '..', '..')

const CARD_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'cards.json')
const PR_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'pulls.json')

/** O PR fictício da fixture. É o número da `timelineItems` acrescentada e a chave do `pulls.json`. */
const PR_NUMBER = 9001

/** O título que o passo 5 escreve na cópia: é o que o ⟳ do PR tem de trazer para a tela. */
const NEW_TITLE = 'Titulo reescrito com o app de pe'

interface FixtureProject {
  field: { options: readonly { id: string; name: string }[] }
  items: { nodes: readonly FixtureNode[] }
}

interface FixtureNode {
  content: {
    __typename: string
    number?: number
    repository?: { nameWithOwner?: string }
  }
  fieldValues: { nodes: readonly { optionId?: string; field?: { name?: string } }[] }
}

interface FixtureCard {
  number: number
  columnId: string
  repo: string
}

/** `número da issue` → envelope cru do `CARD_QUERY`; o `_comment` do arquivo passa batido. */
type CardFixture = Record<string, { data: { repository: { issue: Record<string, unknown> } } }>

interface PullFixture {
  pulls: Record<string, { data: { repository: { pullRequest: { title: string } } } }>
  files: Record<string, unknown>
}

const PROJECT = fixtureProject(FIRST_BOARD.key) as FixtureProject

const CONVERSABLE_COLUMN_IDS = new Set(
  PROJECT.field.options
    .filter((column) => CONVERSABLE_STATIONS.some((station) => column.name.includes(station)))
    .map((column) => column.id),
)

const CARD_ENTRIES = JSON.parse(readFileSync(CARD_FIXTURE_PATH, 'utf8')) as CardFixture

/**
 * Cartões que abrem só para ler (coluna sem skill) **e** têm entrada na fixture de conteúdo — os
 * únicos que o app consegue expandir sem sessão. A ordem é a do board, como no smoke vizinho.
 */
const READABLE = PROJECT.items.nodes
  .map(toFixtureCard)
  .filter((card) => card !== null)
  .filter(
    (card) => !CONVERSABLE_COLUMN_IDS.has(card.columnId) && CARD_ENTRIES[String(card.number)],
  )

/** O cartão que ganha o PR: o mesmo predicado do `READ_CARD` de `card-content.smoke.spec.ts`. */
const PR_CARD = required(READABLE[0], 'um cartão em coluna não conversável (o cartão do PR)')

/** Outro cartão expansível, que fica **sem** PR. */
const SEM_PR_CARD = required(READABLE[1], 'um segundo cartão em coluna não conversável (sem PR)')

let app: ElectronApplication
let window: Page
let scenario: string
let pullFixtureCopy: string

// Os passos compartilham um app e **um cartão aberto**: o que um deixa na tela é a premissa do
// seguinte. Serial é o que faz uma falha parar a fila.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  scenario = mkdtempSync(join(tmpdir(), 'oc-pr-tab-'))
  const boardsFixtureCopy = join(scenario, 'boards.json')
  const boardFixtureCopy = join(scenario, 'board.json')
  const cardFixtureCopy = join(scenario, 'cards.json')
  pullFixtureCopy = join(scenario, 'pulls.json')

  copyFileSync(BOARDS_FIXTURE_PATH, boardsFixtureCopy)
  copyFileSync(BOARD_FIXTURE_PATH, boardFixtureCopy)
  copyFileSync(PR_FIXTURE_PATH, pullFixtureCopy)
  writeFileSync(cardFixtureCopy, JSON.stringify(withTimeline(PR_CARD)), 'utf8')

  app = await launchSmokeApp({
    stateDir: scenario,
    env: {
      OC_BOARD_FIXTURE: boardFixtureCopy,
      OC_BOARDS_FIXTURE: boardsFixtureCopy,
      OC_CARD_FIXTURE: cardFixtureCopy,
      OC_PR_FIXTURE: pullFixtureCopy,
      OC_SCREEN: 'kanban',
    },
  })

  window = await app.firstWindow()
})

test.afterAll(async () => {
  await app.close()
  rmSync(scenario, { recursive: true, force: true, maxRetries: 3 })
})

test('1: cartão aberto na coluna, sem expandir, não mostra abas (CA-1)', async () => {
  await expect(window.getByTestId('board-card')).not.toHaveCount(0)

  await cardLocator(PR_CARD).click()
  await expect(cardLocator(PR_CARD).getByTestId('card-content-body')).toBeVisible()
  await expect(cardLocator(PR_CARD).getByTestId('card-content-reload')).toBeEnabled()

  await expect(cardLocator(PR_CARD).getByRole('tablist')).toHaveCount(0)
})

test('2: expandido, as abas aparecem com Card selecionada e o PR ainda não foi lido (CA-1, CA-6)', async () => {
  const card = cardLocator(PR_CARD)

  await card.getByTestId('card-maximize').click()

  await expect(card.getByTestId('card-tab-card')).toHaveAttribute('aria-selected', 'true')
  await expect(card.getByTestId('card-tab-pr')).toContainText(`PR #${PR_NUMBER}`)
  // Montado só na primeira seleção: sem o elemento, não houve leitura do PR.
  await expect(card.getByTestId('card-pr-body')).toHaveCount(0)
})

test('3: a aba PR traz cabeçalho, conversa, CI e arquivos (CA-4)', async () => {
  const card = cardLocator(PR_CARD)

  await card.getByTestId('card-tab-pr').click()

  await expect(card.getByTestId('pr-header')).toContainText(readTitle())
  await expect(card.getByTestId('pr-reload')).toBeEnabled()

  await expect(card.locator('[data-testid="pr-entry"][data-kind="review"]')).toContainText('bot')
  const thread = card.locator('[data-testid="pr-entry"][data-kind="thread"]')
  await expect(thread.getByTestId('pr-thread-loc')).toBeVisible()
  await expect(thread.getByTestId('pr-thread-resolved')).toBeVisible()
  await expect(card.getByTestId('pr-checks')).toBeVisible()
  await expect(card.getByTestId('pr-file')).toHaveCount(2)
})

test('4: um arquivo por vez abre e fecha o patch; sem patch fica o link (CA-5)', async () => {
  const card = cardLocator(PR_CARD)
  const arquivos = card.getByTestId('pr-file')
  const comPatch = arquivos.nth(0)
  const semPatch = arquivos.nth(1)

  // Sem patch não há o que abrir: a linha não se diz expansível, e o que fica é o link.
  await expect(semPatch).not.toHaveAttribute('aria-expanded')
  await semPatch.click()
  await expect(card.getByTestId('diff-line')).toHaveCount(0)
  await expect(card.getByText('Ver no GitHub')).toBeVisible()

  // Duas vezes o mesmo arquivo: abre e fecha.
  await comPatch.click()
  await expect(card.getByTestId('diff-line').first()).toBeVisible()
  await comPatch.click()
  await expect(card.getByTestId('diff-line')).toHaveCount(0)
})

test('5: o ⟳ do PR relê e traz o título novo', async () => {
  const card = cardLocator(PR_CARD)

  rewritePulls((fixture) => {
    required(fixture.pulls[String(PR_NUMBER)], `o PR #${PR_NUMBER} na cópia`).data.repository.pullRequest.title =
      NEW_TITLE
  })

  await card.getByTestId('pr-reload').click()

  await expect(card.getByTestId('pr-header')).toContainText(NEW_TITLE)
  await expect(card.getByTestId('pr-reload')).toBeEnabled()
})

test('6: trocar de aba não relê nem desmonta nenhuma das duas', async () => {
  const card = cardLocator(PR_CARD)

  await card.getByTestId('card-tab-card').click()
  await expect(card.getByTestId('card-content-body')).toBeVisible()
  await expect(card.getByText('Lendo o card…')).toHaveCount(0)

  await card.getByTestId('card-tab-pr').click()
  await expect(card.getByTestId('pr-header')).toContainText(NEW_TITLE)
  await expect(card.getByText('Lendo o PR…')).toHaveCount(0)
})

test('7: falha ao reler o PR fica dentro da aba PR e não afeta a aba Card', async () => {
  const card = cardLocator(PR_CARD)

  rewritePulls((fixture) => {
    delete fixture.pulls[String(PR_NUMBER)]
  })

  await card.getByTestId('pr-reload').click()
  await expect(card.getByTestId('pr-view')).toContainText('Não consegui ler o PR')

  await card.getByTestId('card-tab-card').click()
  await expect(card.getByTestId('card-content-body')).toBeVisible()
  await expect(card.getByTestId('card-content-body')).not.toContainText('Não consegui ler o PR')
})

test('8: recolher e expandir de novo volta com a aba Card selecionada', async () => {
  const card = cardLocator(PR_CARD)

  await card.getByTestId('card-tab-pr').click()
  await card.getByTestId('card-maximize').click()
  await card.getByTestId('card-maximize').click()

  await expect(card.getByTestId('card-tab-card')).toHaveAttribute('aria-selected', 'true')
})

test('9: cartão expandido sem PR não tem abas (CA-1)', async () => {
  await cardLocator(PR_CARD).getByTestId('card-collapse').click()

  const card = cardLocator(SEM_PR_CARD)
  await card.click()
  await expect(card.getByTestId('card-content-body')).toBeVisible()
  await card.getByTestId('card-maximize').click()
  await expect(card.getByTestId('card-content-reload')).toBeEnabled()

  await expect(card.getByRole('tablist')).toHaveCount(0)
})

/** O título do PR na fixture versionada, lido do arquivo: nenhum valor esperado escrito à mão. */
function readTitle(): string {
  const fixture = JSON.parse(readFileSync(PR_FIXTURE_PATH, 'utf8')) as PullFixture

  return required(fixture.pulls[String(PR_NUMBER)], `o PR #${PR_NUMBER} em pulls.json`).data
    .repository.pullRequest.title
}

/** Reescreve a cópia do `pulls.json`; o app a relê a cada chamada. */
function rewritePulls(change: (fixture: PullFixture) => void): void {
  const fixture = JSON.parse(readFileSync(pullFixtureCopy, 'utf8')) as PullFixture

  change(fixture)
  writeFileSync(pullFixtureCopy, JSON.stringify(fixture), 'utf8')
}

/**
 * `cards.json` com a `timelineItems` do cartão do PR: o #9001 (o do card, mergeado) e dois PRs que
 * a descoberta tem de descartar — um de trem e um que declara outro card.
 */
function withTimeline(card: FixtureCard): CardFixture {
  const mapa = JSON.parse(readFileSync(CARD_FIXTURE_PATH, 'utf8')) as CardFixture
  const issue = required(mapa[String(card.number)], `entrada do card #${card.number}`).data.repository
    .issue

  const referencia = (number: number, state: string, body: string): unknown => ({
    source: {
      number,
      url: `https://github.com/${card.repo}/pull/${number}`,
      state,
      body,
      repository: { nameWithOwner: card.repo },
    },
  })

  issue['timelineItems'] = {
    nodes: [
      referencia(PR_NUMBER, 'MERGED', `**Card:** #${card.number}\n\nPR do card.`),
      referencia(PR_NUMBER + 1, 'OPEN', '## Trem v2026.10.12\n\nPRs do trem.'),
      referencia(PR_NUMBER + 2, 'OPEN', `**Card:** #${card.number + 1000}\n\nOutro card.`),
    ],
  }

  return mapa
}

function toFixtureCard(node: FixtureNode): FixtureCard | null {
  const columnId = node.fieldValues.nodes.find((value) => value.field?.name === STATUS_FIELD)
    ?.optionId
  const { __typename, number, repository } = node.content
  const repo = repository?.nameWithOwner

  if (__typename !== 'Issue' || number === undefined || columnId === undefined) return null
  if (repo === undefined) return null

  return { number, columnId, repo }
}

function required<T>(value: T | undefined, missing: string): T {
  if (value === undefined) {
    throw new Error(`as fixtures não têm ${missing} — sem isso este smoke prova menos`)
  }

  return value
}

function cardLocator(card: FixtureCard): Locator {
  return window.locator(`[data-testid="board-card"][data-card-number="${card.number}"]`)
}
