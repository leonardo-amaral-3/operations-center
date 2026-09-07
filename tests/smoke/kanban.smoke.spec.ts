import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { STATUS_FIELD } from '../../src/core/board/query'

/**
 * O smoke do kanban: o board da fixture desenhado na tela, de ponta a ponta.
 *
 * Sobe o app buildado com `OC_BOARD_FIXTURE` e percorre `fixture → main → core → renderer`. Ao
 * contrário do smoke da fatia vertical, este **não toca a rede, não pede token e não consome cota**:
 * a única fonte de dado é `tests/fixtures/board.json`.
 *
 * **Nenhum valor esperado é escrito à mão aqui.** As colunas, a coluna de cada cartão, quem está
 * fechado e quem está sem dono saem todos da fixture. Fixar `b003f501` ou "o card #4 está em
 * Especificação" faria o teste quebrar no dia seguinte, quando o card andasse no board de verdade —
 * um vermelho que não diz nada sobre o código é pior que teste nenhum.
 *
 * As âncoras `data-testid` que ele lê são contrato fixado na spec. Se alguma faltar, o bug é do
 * componente: a âncora volta ao nome da spec, nunca o teste ao nome errado.
 */

// `__dirname` e não `import.meta.url`: o Playwright transpila os specs para CommonJS enquanto o
// `package.json` não for `type: module`, e `import.meta` ali é erro de sintaxe.
const REPO_ROOT = join(__dirname, '..', '..')

/** **Absoluto**, e é o ponto: o processo do Electron não roda com a `cwd` do runner. */
const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'board.json')

/**
 * O envelope cru, do jeito que o `BoardReader` o recebe.
 *
 * O `as` é o mesmo trato que `createFixtureGraphQL` faz com o mesmo arquivo: o que valida a forma de
 * verdade é o app rodando logo abaixo — se a fixture não tiver a forma que a API devolve, o kanban
 * sobe vazio e todas as asserções caem juntas. Os opcionais existem porque a resposta é heterogênea:
 * rascunho e pull request não têm número, e valor de campo que não é single-select chega como `{}`.
 */
interface FixtureEnvelope {
  data: { user: { projectV2: FixtureProject } }
}

interface FixtureProject {
  field: { options: readonly FixtureOption[] }
  items: { nodes: readonly FixtureNode[] }
}

interface FixtureOption {
  id: string
  name: string
}

interface FixtureNode {
  id: string
  content: {
    __typename: string
    number?: number
    closed?: boolean
    repository?: { nameWithOwner: string }
    assignees?: { nodes: readonly { login: string }[] }
  }
  fieldValues: { nodes: readonly FixtureFieldValue[] }
}

interface FixtureFieldValue {
  optionId?: string
  field?: { name?: string }
}

/** O que a tela deve mostrar de um cartão — derivado, nunca digitado. */
interface ExpectedCard {
  number: number
  columnId: string
  closed: boolean
  /** `owner/name`. O kanban não o desenha; a guarda da fixture o usa para vigiar a quinta borda. */
  repository: string
  assignees: readonly string[]
}

const PROJECT = (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureEnvelope).data.user
  .projectV2

/** As colunas esperadas, **na ordem em que o board as declara** — que é o CA-1. */
const COLUMNS = PROJECT.field.options

const NODES = PROJECT.items.nodes

const EXPECTED_CARDS = NODES.map(toExpectedCard).filter((card) => card !== null)

/**
 * Os itens que a fixture tem e o kanban não pode mostrar, quando dá para nomeá-los pelo número.
 *
 * Rascunho e pull request não têm número nenhum no envelope — a eles responde a contagem total de
 * cartões, que é a asserção que os pega.
 */
const EXCLUDED_NUMBERS = NODES.filter((node) => toExpectedCard(node) === null)
  .map((node) => node.content.number)
  .filter((number) => number !== undefined)

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  app = await electron.launch({
    // O app buildado, resolvido pelo `main` do `package.json`. O `yarn smoke` roda o
    // `electron-vite build` antes justamente para que `out/` exista aqui.
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      ...inheritedEnv(),
      // A porta que troca o GitHub por um arquivo. É ela que torna este smoke determinístico.
      OC_BOARD_FIXTURE: FIXTURE_PATH,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell de quem roda abriria a tela
      // errada e o teste falharia por um motivo que não tem nada a ver com o kanban.
      OC_SCREEN: 'kanban',
      // Inertes de propósito. A fixture ignora documento e variáveis, então estes valores não
      // podem importar — e se um dia a fiação da fixture quebrar, o app tentará ler um board que
      // não existe e o smoke fica vermelho na hora, em vez de passar em silêncio contra o board de
      // verdade.
      OC_PROJECT_OWNER: 'dono-que-a-fixture-ignora',
      OC_PROJECT_NUMBER: '999',
    },
  })

  window = await app.firstWindow()
})

test.afterAll(async () => {
  await app.close()
})

/**
 * A guarda da própria fixture.
 *
 * Os cinco itens sintéticos existem porque o board real não tem nenhum deles, e é fácil perdê-los
 * numa recaptura distraída. Sem esta verificação, perdê-los deixaria o smoke **verde** — só que
 * provando menos: cinco regras de filtro e de comportamento voltariam a existir só nos unitários.
 */
test('a fixture ainda cobre as cinco bordas que o board real não tem', () => {
  const typenames = NODES.map((node) => node.content.__typename)

  expect(typenames).toContain('DraftIssue')
  expect(typenames).toContain('PullRequest')
  expect(EXCLUDED_NUMBERS.length).toBeGreaterThan(0)
  expect(EXPECTED_CARDS.some((card) => card.closed)).toBe(true)
  expect(EXPECTED_CARDS.some((card) => card.assignees.length === 0)).toBe(true)
  // Sem coluna vazia, a asserção de `data-column-count="0"` lá embaixo não provaria nada.
  expect(COLUMNS.some((column) => cardsIn(column.id).length === 0)).toBe(true)
  // A quinta borda, e a única que não é deste smoke: mais de um repo entre os cartões. É o que
  // permite ao `card-chat.smoke.spec.ts` ter um cartão cujo repo **não** existe na máquina, e com
  // ele exercitar o "não sei onde este repo vive" de ponta a ponta. Aqui só se vigia a existência
  // da borda; quem afirma o que ela precisa ser — coluna conversável — é o smoke que a usa.
  expect(new Set(EXPECTED_CARDS.map((card) => card.repository)).size).toBeGreaterThan(1)
})

test('CA-1: as colunas são as do board, na ordem, e a vazia continua desenhada', async () => {
  const columns = window.getByTestId('column')

  // A primeira asserção do arquivo é também a que espera o board carregar: até a leitura terminar,
  // a tela mostra "Lendo o board…" e não existe coluna nenhuma.
  await expect(columns).toHaveCount(COLUMNS.length)

  for (const [index, column] of COLUMNS.entries()) {
    // `nth` é ordem de documento: comparar posição a posição é o que prova a ordem, e não só que os
    // mesmos nomes estão todos lá.
    await expect(columns.nth(index)).toHaveAttribute('data-column-name', column.name)

    const esperados = cardsIn(column.id)
    await expect(columnLocator(column.id)).toHaveAttribute(
      'data-column-count',
      String(esperados.length),
    )
    await expect(columnLocator(column.id).getByTestId('board-card')).toHaveCount(esperados.length)
  }
})

test('CA-1 e CA-3: cada card está na coluna do seu optionId, e uma vez só no kanban inteiro', async () => {
  for (const card of EXPECTED_CARDS) {
    // A contagem global é o CA-3: um card do board é **um** cartão, em uma coluna só. Vale para
    // todos, e não só para o #1 do enunciado — o envelope não sabe quantas tasks um card tem, e uma
    // asserção que vale para todo cartão é mais forte do que a que nomeia um.
    await expect(cardLocator(card.number)).toHaveCount(1)
    await expect(columnLocator(card.columnId).locator(cardSelector(card.number))).toHaveCount(1)
  }
})

test('rascunho, pull request e item sem Status não viram cartão', async () => {
  // Pega os três de uma vez, inclusive rascunho e pull request, que não têm número para nomear.
  await expect(window.getByTestId('board-card')).toHaveCount(EXPECTED_CARDS.length)

  for (const number of EXCLUDED_NUMBERS) {
    await expect(cardLocator(number)).toHaveCount(0)
  }
})

test('o cartão fechado entra, e o cartão sem dono diz que está sem dono', async () => {
  for (const card of EXPECTED_CARDS) {
    await expect(cardLocator(card.number)).toHaveAttribute('data-card-closed', String(card.closed))
    await expect(cardLocator(card.number)).toHaveAttribute(
      'data-card-assignees',
      card.assignees.join(','),
    )

    // O atributo vazio sozinho não distingue "sem dono" de "componente que esqueceu de renderizar";
    // a marca visível é o que o usuário de fato vê.
    if (card.assignees.length === 0) {
      await expect(cardLocator(card.number)).toContainText('sem dono')
    } else {
      await expect(cardLocator(card.number)).toContainText(card.assignees.join(', '))
    }
  }
})

test('CA-4: o carimbo de frescor sai preenchido e não acusa dado velho após a carga', async () => {
  const freshness = window.getByTestId('freshness')

  await expect(freshness).toHaveAttribute('data-stale', 'false')

  const readAt = await freshness.getAttribute('data-read-at')
  // Preenchido *e* um instante plausível: `''` passaria numa asserção de "existe" sem provar que
  // houve leitura alguma.
  expect(Number(readAt)).toBeGreaterThan(0)
})

/** O `optionId` do `Status` do item, ou `undefined` se ele não estiver em coluna nenhuma. */
function statusOptionId(node: FixtureNode): string | undefined {
  return node.fieldValues.nodes.find((value) => value.field?.name === STATUS_FIELD)?.optionId
}

/**
 * As mesmas regras 4 do `BoardReader`, aplicadas do lado de fora: só issue, só com número, só com
 * `Status`. Escritas de novo aqui de propósito — se o teste importasse o `BoardReader` para saber o
 * que esperar, ele estaria comparando o código consigo mesmo.
 */
function toExpectedCard(node: FixtureNode): ExpectedCard | null {
  const columnId = statusOptionId(node)
  const { __typename, number, closed, repository, assignees } = node.content

  if (__typename !== 'Issue' || number === undefined || columnId === undefined) return null

  return {
    number,
    columnId,
    closed: closed === true,
    repository: repository?.nameWithOwner ?? '',
    assignees: (assignees?.nodes ?? []).map((assignee) => assignee.login),
  }
}

function cardsIn(columnId: string): readonly ExpectedCard[] {
  return EXPECTED_CARDS.filter((card) => card.columnId === columnId)
}

function cardSelector(number: number): string {
  return `[data-testid="board-card"][data-card-number="${number}"]`
}

function columnLocator(columnId: string): Locator {
  return window.locator(`[data-testid="column"][data-column-id="${columnId}"]`)
}

function cardLocator(number: number): Locator {
  return window.locator(cardSelector(number))
}

/**
 * O `process.env` do runner, pronto para o Playwright: passar `env` substitui o ambiente inteiro, e
 * sem `PATH` o Electron nem subiria. As chaves sem valor caem porque o tipo do Playwright só aceita
 * string.
 */
function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}
