import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { CONVERSABLE_STATIONS, STATUS_FIELD } from '../../src/core/board/query'
import {
  BOARDS_FIXTURE_PATH,
  BOARD_FIXTURE_PATH,
  FIRST_BOARD,
  fixtureProject,
} from './boards-fixture'

/**
 * O smoke do conteúdo: abrir um cartão que não conversa, ler o que está escrito nele e recarregar —
 * de ponta a ponta, e **sem sessão, sem modelo e sem cota**.
 *
 * Ele é do time do `kanban.smoke.spec.ts`, e não do `card-chat.smoke.spec.ts`: a única fonte de dado
 * são os arquivos de `tests/fixtures/`, e nada aqui fala com o Claude Code. Por isso as
 * variáveis são só `OC_SCREEN` e as três de fixture — sem `OC_MODEL`, sem
 * `OC_ISOLATED` e sem `OC_CLAUDE_PROJECTS`, que são o que amarra aquele outro smoke à bancada. O
 * percurso, mesmo assim, é o inteiro: `fixture → main → core → renderer`.
 *
 * **Nenhum valor esperado é escrito à mão.** Qual cartão abrir sai da fixture do board — o primeiro
 * em coluna sem skill dedicada —, e quantos comentários esperar sai da fixture de conteúdo. Fixar "o
 * card #901" faria o teste quebrar no dia da recaptura, por um motivo que não diz nada sobre o
 * código.
 *
 * As duas fixtures são lidas de uma **cópia** em diretório temporário, e não de `tests/fixtures/`: o
 * CA-7 reescreve o arquivo com o app de pé, e mutar a versionada deixaria fixture suja em disco —
 * vermelho intermitente no dia seguinte, na suíte de outra pessoa.
 *
 * As âncoras `data-testid` que ele lê são contrato fixado na spec. Se alguma faltar, o bug é do
 * componente: a âncora volta ao nome da spec, nunca o teste ao nome errado.
 */

// `__dirname` e não `import.meta.url`: o Playwright transpila os specs para CommonJS enquanto o
// `package.json` não for `type: module`, e `import.meta` ali é erro de sintaxe.
const REPO_ROOT = join(__dirname, '..', '..')

const CARD_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'cards.json')

/**
 * O comentário que o CA-7 acrescenta à cópia da fixture **depois** de o conteúdo já estar na tela.
 *
 * Ele faz o papel do comentário que a sessão publica no card enquanto alguém o lê — o cenário do
 * critério. É entrada do teste, e não valor esperado derivado de fixture: quem o escreve aqui é o
 * próprio teste, uma linha antes de exigi-lo na tela.
 */
const NEW_COMMENT =
  'Comentário publicado com o app de pé — é este que o ⟳ tem de trazer para a tela.'

/**
 * O envelope cru do board, do jeito que o `BoardReader` o recebe — reduzido ao que este smoke
 * precisa para escolher em quem clicar.
 *
 * O `as` é o mesmo trato que `createFixtureGraphQL` faz com o mesmo arquivo: o que valida a forma de
 * verdade é o app rodando logo abaixo. Os opcionais existem porque a resposta é heterogênea:
 * rascunho e pull request não têm número, e valor de campo que não é single-select chega como `{}`.
 */
interface FixtureProject {
  field: { options: readonly FixtureOption[] }
  items: { nodes: readonly FixtureNode[] }
}

interface FixtureOption {
  id: string
  name: string
}

interface FixtureNode {
  content: {
    __typename: string
    number?: number
  }
  fieldValues: { nodes: readonly FixtureFieldValue[] }
}

interface FixtureFieldValue {
  optionId?: string
  field?: { name?: string }
}

/** Um cartão da fixture, no mínimo de que este smoke precisa: em quem clicar, e em qual coluna. */
interface FixtureCard {
  number: number
  columnId: string
}

/**
 * A outra fixture: o mapa `número da issue` → envelope cru do `CARD_QUERY`.
 *
 * O `_comment` do arquivo mora neste mesmo mapa e **não** tem esta forma. Ele passa batido de
 * propósito: nada aqui varre o mapa inteiro — só a chave do cartão escolhido é lida, e a reescrita
 * do CA-7 devolve o arquivo com as outras chaves como as encontrou.
 */
type CardFixture = Record<string, CardEnvelope>

interface CardEnvelope {
  data: { repository: { issue: CardIssue } }
}

interface CardIssue {
  body?: string
  comments: { totalCount: number; nodes: CommentNode[] }
}

interface CommentNode {
  id: string
  author: { login: string } | null
  createdAt: string
  body: string
}

/** O retângulo que o Playwright devolve, em pixels da viewport. */
interface Caixa {
  x: number
  y: number
  width: number
  height: number
}

/**
 * As quatro medidas de rolagem de um elemento — o insumo das três medidas do CA-4.
 *
 * São lidas aos pares e comparadas **entre si**: "rola" é `scrollHeight > clientHeight`, e nunca um
 * número de pixels. Um valor absoluto aqui viraria vermelho no primeiro `padding` que alguém
 * mexesse, sem dizer nada sobre o critério.
 */
interface Rolagem {
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
}

/** O board que o app desenha: o primeiro da ordem da descoberta, derivado da fixture. */
const PROJECT = fixtureProject(FIRST_BOARD.key) as FixtureProject

const COLUMNS = PROJECT.field.options

const CARDS = PROJECT.items.nodes.map(toFixtureCard).filter((card) => card !== null)

/**
 * As colunas que abrem chat, pela lista que o próprio core publica.
 *
 * Aqui ela serve para **escolher em quem clicar**, e não para afirmar o critério: quem prova a regra
 * — com emoji, sem emoji, com acento e sem — é `tests/unit/BoardReader.test.ts`. Por isso o
 * `includes` basta, e não é preciso repetir aqui a normalização do `BoardReader`.
 */
const CONVERSABLE_COLUMN_IDS = new Set(
  COLUMNS.filter((column) =>
    CONVERSABLE_STATIONS.some((station) => column.name.includes(station)),
  ).map((column) => column.id),
)

/**
 * O cartão deste smoke: o primeiro em coluna **sem** skill dedicada.
 *
 * É o cartão do CA-3 — o que a emenda ao CA-4 do #6 fez passar de inerte a legível — e é também o
 * que a fixture carrega de corpo longo, que é o insumo do CA-4. Um cartão só, porque os três
 * critérios são sobre a mesma abertura: ele abre, mostra, cabe e recarrega.
 */
const READ_CARD = required(
  CARDS.find((card) => !CONVERSABLE_COLUMN_IDS.has(card.columnId)),
  'um cartão em coluna não conversável (o cartão do CA-3)',
)

const CARD_ISSUE = required(
  (JSON.parse(readFileSync(CARD_FIXTURE_PATH, 'utf8')) as CardFixture)[String(READ_CARD.number)],
  `entrada para o card #${READ_CARD.number} na fixture de conteúdo`,
).data.repository.issue

/** Quantos comentários a tela tem de desenhar. Sai da fixture — e é a base da contagem do CA-7. */
const EXPECTED_COMMENTS = CARD_ISSUE.comments.nodes.length

let app: ElectronApplication
let window: Page
/** A raiz descartável onde as cópias das duas fixtures vivem. */
let scenario: string
/** A cópia de `cards.json` — o arquivo que o CA-7 reescreve com o app de pé. */
let cardFixtureCopy: string

// Estes testes compartilham um app e **um cartão aberto**: o que um deixa na tela é a premissa do
// seguinte. Serial é o que isso já é na prática — e o que faz uma falha parar a fila em vez de medir
// geometria de um cartão que nunca abriu.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  scenario = mkdtempSync(join(tmpdir(), 'oc-card-content-'))
  const boardsFixtureCopy = join(scenario, 'boards.json')
  const boardFixtureCopy = join(scenario, 'board.json')
  cardFixtureCopy = join(scenario, 'cards.json')

  // As três juntas, e não só a que muda: elas são um conjunto, e apontar o app para uma cópia e
  // duas originais deixaria o cenário mais difícil de ler do que o que ele economizaria.
  copyFileSync(BOARDS_FIXTURE_PATH, boardsFixtureCopy)
  copyFileSync(BOARD_FIXTURE_PATH, boardFixtureCopy)
  copyFileSync(CARD_FIXTURE_PATH, cardFixtureCopy)

  app = await electron.launch({
    // O app buildado, resolvido pelo `main` do `package.json`. O `yarn smoke` roda o
    // `electron-vite build` antes justamente para que `out/` exista aqui.
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      ...inheritedEnv(),
      // As três portas que trocam o GitHub por arquivo — e é só isso que este smoke precisa de
      // ambiente. **Absolutos**, e é o ponto: o processo do Electron não roda com a `cwd` do runner.
      OC_BOARD_FIXTURE: boardFixtureCopy,
      OC_BOARDS_FIXTURE: boardsFixtureCopy,
      OC_CARD_FIXTURE: cardFixtureCopy,
      // Descartável, e **não** o `userData` real: sem isto o app lê o `preferences.json` da máquina
      // de quem roda e `pickActive` abre a aba lembrada de uso de verdade — enquanto tudo o que este
      // arquivo espera sai do `FIRST_BOARD`. O vermelho vem como "Expected: 6, Received: 2", que
      // acusa o board errado sem dizer o nome dele.
      OC_STATE_DIR: scenario,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell de quem roda abriria a tela
      // errada e o teste falharia por um motivo que não tem nada a ver com o conteúdo do card.
      OC_SCREEN: 'kanban',
    },
  })

  window = await app.firstWindow()
})

test.afterAll(async () => {
  await app.close()
  rmSync(scenario, { recursive: true, force: true, maxRetries: 3 })
})

/**
 * A guarda da própria fixture.
 *
 * O corpo do cartão sintético é longo **e largo** de propósito: sem a tabela e sem o bloco de código
 * de linha comprida não há o que tentar estourar a coluna, e o CA-4 lá embaixo passaria verde sem
 * medir nada. Perder isso numa recaptura distraída tem de doer aqui, com o nome do que se perdeu, e
 * não três testes adiante numa asserção de geometria.
 */
test('a fixture ainda traz o cartão de leitura com o corpo que o CA-4 precisa', () => {
  const body = CARD_ISSUE.body ?? ''

  expect(body, `o card #${READ_CARD.number} está sem corpo na fixture`).not.toBe('')
  // A linha separadora do GFM e a cerca do bloco: os dois elementos que o CA-4 nomeia, e os dois que
  // rolam dentro do próprio contêiner em vez de alargar a coluna.
  expect(body, 'o corpo da fixture perdeu a tabela').toMatch(/^\|\s*---/m)
  expect(body, 'o corpo da fixture perdeu o bloco de código').toMatch(/^ {0,3}```/m)
  // Sem comentário nenhum, a contagem do CA-7 sairia de zero e não distinguiria "recarregou" de
  // "desenhou o primeiro".
  expect(EXPECTED_COMMENTS, 'o card da fixture está sem comentários').toBeGreaterThan(0)
})

test('CA-3: o cartão de coluna sem skill abre e mostra o conteúdo, e nenhuma sessão sobe', async () => {
  // A primeira asserção de tela do arquivo é também a que espera o board carregar: até a leitura
  // terminar, a tela mostra "Lendo o board…" e não existe cartão nenhum.
  await expect(window.getByTestId('board-card')).toHaveCount(CARDS.length)

  await cardLocator(READ_CARD).click()

  // Que a coluna é mesmo das sem skill não é suposição do teste: o atributo vem da regra que o core
  // decidiu, e é por ele que este cartão é o cartão certo para o critério.
  await expect(cardLocator(READ_CARD)).toHaveAttribute('data-card-conversable', 'false')

  // Abre — e abre **mostrando**: cartão sem sessão viva nasce com o conteúdo à mostra, porque foi
  // para ler que ele foi aberto.
  await expect(cardLocator(READ_CARD).getByTestId('card-content')).toBeVisible()
  await expect(cardLocator(READ_CARD).getByTestId('card-content-body')).toBeVisible()

  // O ⟳ nasce desabilitado e volta a si quando a leitura aterrissa: esperar por ele é esperar a
  // leitura **inteira**, e não só o clique. É o que separa "mostra o conteúdo" de "mostra Lendo o
  // card…" — e o que faz a contagem abaixo ser uma contagem, e não uma corrida.
  await expect(reloadButton(READ_CARD)).toBeEnabled()
  await expect(commentLocator(READ_CARD)).toHaveCount(EXPECTED_COMMENTS)

  // E nada de sessão: nem neste cartão, nem no kanban inteiro. Ler não sobe chat, que é a metade do
  // CA-4 do #6 que a emenda preservou inteira.
  await expect(window.getByTestId('card-chat')).toHaveCount(0)
})

test('CA-4: o conteúdo rola dentro da própria caixa, e o cartão continua dentro da coluna', async () => {
  const corpo = cardLocator(READ_CARD).getByTestId('card-content-body')
  const caixa = await rolagemDe(corpo)

  // Primeira medida: **rola na vertical**. É o teto de altura fazendo o trabalho dele — sem ele, a
  // spec de 44 mil caracteres do card #6 empurraria o cartão seguinte para fora da vista, e o kanban
  // deixaria de ser um kanban.
  expect(
    caixa.scrollHeight,
    'o conteúdo cabe inteiro na caixa — não há rolagem vertical a provar',
  ).toBeGreaterThan(caixa.clientHeight)

  // Segunda medida: e **não** rola na horizontal. Quem absorve a largura da tabela é o contêiner
  // dela, dentro do `Markdown`; se aquele contêiner sumisse, a barra apareceria aqui. O `+ 1` é a
  // tolerância do arredondamento subpixel do Chromium, e é a única folga do arquivo.
  expect(caixa.scrollWidth, 'a caixa do conteúdo rola na horizontal').toBeLessThanOrEqual(
    caixa.clientWidth + 1,
  )

  // A outra metade da mesma medida, e é ela que impede a de cima de passar de graça: a tabela **é**
  // mais larga que a caixa, e quem rola é o contêiner dela. `first()` porque um dia pode haver duas
  // tabelas no corpo, e o que se mede aqui é o mecanismo, não a segunda.
  const tabela = await rolagemDe(corpo.locator('div:has(> table)').first())

  expect(
    tabela.scrollWidth,
    'a tabela da fixture coube na coluna — a medida acima não prova nada',
  ).toBeGreaterThan(tabela.clientWidth)

  // Terceira medida: a caixa do cartão continua dentro da coluna que o hospeda — nos dois lados, e
  // não só pela direita. É o que separa "o conteúdo rola dentro de si" de "o conteúdo empurrou o
  // cartão para cima das colunas vizinhas".
  const cartao = await caixaDe(cardLocator(READ_CARD), `o cartão #${READ_CARD.number}`)
  const raia = await caixaDe(
    columnLocator(READ_CARD.columnId),
    `a coluna do cartão #${READ_CARD.number}`,
  )

  expect(cartao.width, 'o cartão aberto não ocupa largura').toBeGreaterThan(0)
  expect(cartao.x, 'o cartão vaza pela esquerda da coluna').toBeGreaterThanOrEqual(raia.x)
  expect(cartao.x + cartao.width, 'o cartão vaza pela direita da coluna').toBeLessThanOrEqual(
    raia.x + raia.width,
  )
})

/**
 * O CA-7 provado sem rede, sem sessão e sem cota.
 *
 * `createFixtureGraphQL` **relê e reparseia o arquivo a cada chamada**, e isso é propriedade
 * declarada dele: reler é o que deixa trocar a fixture com o app de pé. É o que permite encenar aqui
 * o cenário do critério — um comentário que nasce no card **depois** de o conteúdo ter carregado.
 */
test('CA-7: recarregar traz o comentário que nasceu depois da carga, sem fechar o cartão', async () => {
  const comentarios = commentLocator(READ_CARD)

  // A premissa, relida: é contra esta contagem que o "um a mais" lá embaixo significa alguma coisa.
  await expect(comentarios).toHaveCount(EXPECTED_COMMENTS)

  const mapa = JSON.parse(readFileSync(cardFixtureCopy, 'utf8')) as CardFixture
  const comments = required(
    mapa[String(READ_CARD.number)],
    `entrada para o card #${READ_CARD.number} na cópia da fixture`,
  ).data.repository.issue.comments

  comments.nodes.push({
    id: 'IC_comentario_do_smoke_do_ca7',
    author: { login: 'esteira-gm' },
    createdAt: '2026-09-06T21:00:00Z',
    body: NEW_COMMENT,
  })
  // O `totalCount` sobe junto, e é `+= 1` e não `= nodes.length`: ele é quem decide o `truncated` do
  // `CardReader`, e reescrevê-lo apagaria um corte que a fixture porventura declare.
  comments.totalCount += 1

  writeFileSync(cardFixtureCopy, JSON.stringify(mapa), 'utf8')

  await reloadButton(READ_CARD).click()
  // O ⟳ volta a si quando a leitura aterrissa: esperar por isso é esperar a recarga inteira.
  await expect(reloadButton(READ_CARD)).toBeEnabled()

  await expect(comentarios).toHaveCount(EXPECTED_COMMENTS + 1)
  // `last()` porque a ordem é a da resposta, que é a cronológica: o comentário novo entra no fim.
  await expect(comentarios.last()).toContainText(NEW_COMMENT)

  // E o cartão continua como estava: aberto, com a seção à mostra e sem sessão nenhuma. Recarregar é
  // trazer o que falta, e não recomeçar o cartão.
  await expect(cardLocator(READ_CARD).getByTestId('card-content-body')).toBeVisible()
  await expect(window.getByTestId('card-chat')).toHaveCount(0)
})

/** O `optionId` do `Status` do item, ou `undefined` se ele não estiver em coluna nenhuma. */
function statusOptionId(node: FixtureNode): string | undefined {
  return node.fieldValues.nodes.find((value) => value.field?.name === STATUS_FIELD)?.optionId
}

/** As mesmas regras do `BoardReader` que decidem o que vira cartão: só issue, com número e Status. */
function toFixtureCard(node: FixtureNode): FixtureCard | null {
  const columnId = statusOptionId(node)
  const { __typename, number } = node.content

  if (__typename !== 'Issue' || number === undefined || columnId === undefined) return null

  return { number, columnId }
}

/**
 * O que as fixtures precisam ter para este smoke fazer sentido.
 *
 * Lança na carga do módulo, de propósito: sem a borda, o teste que dependeria dela passaria a provar
 * outra coisa — e um smoke que muda de assunto em silêncio é pior que um que não roda.
 */
function required<T>(value: T | undefined, missing: string): T {
  if (value === undefined) {
    throw new Error(`as fixtures não têm ${missing} — sem isso este smoke prova menos`)
  }

  return value
}

function cardLocator(card: FixtureCard): Locator {
  return window.locator(`[data-testid="board-card"][data-card-number="${card.number}"]`)
}

function columnLocator(columnId: string): Locator {
  return window.locator(`[data-testid="column"][data-column-id="${columnId}"]`)
}

function commentLocator(card: FixtureCard): Locator {
  return cardLocator(card).getByTestId('card-comment')
}

function reloadButton(card: FixtureCard): Locator {
  return cardLocator(card).getByTestId('card-content-reload')
}

/**
 * As medidas de rolagem do elemento, lidas dentro do renderer.
 *
 * O `tsconfig.node.json` que compila os smokes **não** carrega a lib DOM, e não deve: `src/main`,
 * `src/core` e `src/preload` são Node, e uma lib DOM ali deixaria um `document` solto passar
 * despercebido numa revisão. O corpo do `evaluate` roda dentro do renderer, onde as quatro
 * propriedades existem de verdade — o que falta deste lado é só o tipo.
 *
 * O smoke do kanban resolve o mesmo problema declarando o `getComputedStyle` que ele usa; aqui não
 * há global equivalente para as medidas de rolagem, então o tipo é nomeado na entrada: `Rolagem` é
 * exatamente o que se lê do elemento, e nada além.
 */
async function rolagemDe(locator: Locator): Promise<Rolagem> {
  return locator.evaluate((element) => {
    const caixa = element as unknown as Rolagem

    // Um objeto simples, e não o próprio elemento: o que atravessa a fronteira do `evaluate` é
    // serializado, e nó do DOM não atravessa.
    return {
      scrollWidth: caixa.scrollWidth,
      clientWidth: caixa.clientWidth,
      scrollHeight: caixa.scrollHeight,
      clientHeight: caixa.clientHeight,
    }
  })
}

/**
 * A caixa do elemento, com o `null` virando vermelho **aqui** e nomeando quem sumiu.
 *
 * `boundingBox()` devolve `null` para elemento fora do layout, e deixar o `null` seguir daria um
 * `TypeError` sobre `x` três linhas adiante — que não diz nada sobre o critério que falhou.
 */
async function caixaDe(locator: Locator, oQue: string): Promise<Caixa> {
  const caixa = await locator.boundingBox()
  if (caixa === null) throw new Error(`${oQue}: sem caixa — fora do layout`)

  return caixa
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
