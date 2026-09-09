import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { STATUS_FIELD } from '../../src/core/board/query'
import {
  BOARDS_FIXTURE_PATH,
  BOARD_FIXTURE_PATH,
  FIRST_BOARD,
  fixtureProject,
} from './boards-fixture'

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

/**
 * O board do envelope cru, do jeito que o `BoardReader` o recebe.
 *
 * O `as` é o mesmo trato que `createFixtureGraphQL` faz com o mesmo arquivo: o que valida a forma de
 * verdade é o app rodando logo abaixo — se a fixture não tiver a forma que a API devolve, o kanban
 * sobe vazio e todas as asserções caem juntas. Os opcionais existem porque a resposta é heterogênea:
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
  id: string
  content: {
    __typename: string
    number?: number
    title?: string
    closed?: boolean
    repository?: { nameWithOwner: string }
    assignees?: { nodes: readonly { login: string }[] }
    /**
     * O épico de que este cartão é fase. **Ausente** na captura real de 2026-09-05, e é isso que
     * o CA-3 mede: sem a chave, o cartão comum tem de sair igual ao de antes.
     */
    parent?: { number?: number; title?: string; repository?: { nameWithOwner: string } }
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
  /** O que a tela desenha como titulo do cartao — e o que o CA-3 mede. */
  title: string
  columnId: string
  closed: boolean
  /** `owner/name`. O kanban não o desenha; a guarda da fixture o usa para vigiar a quinta borda. */
  repository: string
  assignees: readonly string[]
  /** O épico de que este cartão é fase, ou `null`. Sai do `parent` da API, não do retrato. */
  parent: ExpectedParent | null
}

/** O épico nomeado por uma fase — número e título, como a API os devolve. */
interface ExpectedParent {
  number: number
  title: string
  repository: string
}

/** Um cartão que **é** fase: o `parent` não é nulo, e o teste pode lê-lo sem guarda. */
interface PhaseCard extends ExpectedCard {
  parent: ExpectedParent
}

/** O retângulo que o Playwright devolve, em pixels da viewport. */
interface Caixa {
  x: number
  y: number
  width: number
  height: number
}

/** O board que o app desenha: o primeiro da ordem da descoberta, derivado da fixture. */
const PROJECT = fixtureProject(FIRST_BOARD.key) as FixtureProject

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

/**
 * A chave que identifica uma issue no board: repo **e** número, dos dois lados do cruzamento.
 *
 * Reescrita aqui, e não importada de `epics.ts`, pela mesma razão que `toExpectedCard` reescreve
 * as regras do `BoardReader`: um teste que importa a implementação para saber o que esperar está
 * comparando o código consigo mesmo. O repo entra porque um board hospeda issues de mais de um, e
 * cruzar só por número penduraria uma fase sob um épico que não é o dela.
 */
function chave(repository: string, number: number): string {
  return `${repository}#${number}`
}

/** As fases de cada épico que estão neste board, pela chave do épico, em ordem crescente. */
const PHASES_BY_EPIC = agruparFases()

function agruparFases(): ReadonlyMap<string, readonly ExpectedCard[]> {
  const mapa = new Map<string, ExpectedCard[]>()

  for (const card of EXPECTED_CARDS) {
    if (card.parent === null) continue

    const daquele = chave(card.parent.repository, card.parent.number)
    const irmas = mapa.get(daquele)

    if (irmas) irmas.push(card)
    else mapa.set(daquele, [card])
  }

  for (const fases of mapa.values()) fases.sort((a, b) => a.number - b.number)

  return mapa
}

/** As fases de um cartão — vazio para quase todos, que é o caso comum do CA-3. */
function phasesOf(card: ExpectedCard): readonly ExpectedCard[] {
  return PHASES_BY_EPIC.get(chave(card.repository, card.number)) ?? []
}

/**
 * O épico com mais fases no board: o cartão em que o CA-2 tem mais o que provar.
 *
 * Derivado, e não escolhido pelo número: no dia em que a fixture ganhar um épico maior, é ele que
 * este teste passa a medir, sem ninguém vir aqui trocar uma constante.
 */
const EPIC_CARD = required(
  EXPECTED_CARDS.filter((card) => phasesOf(card).length > 0).sort(
    (a, b) => phasesOf(b).length - phasesOf(a).length,
  )[0],
  'um épico com fases no próprio board (o CA-2)',
)

/**
 * A fase cujo épico **não** tem cartão neste board — a borda do CA-1.
 *
 * É ela que separa "o crachá sai do `parent` da API" de "o crachá sai da varredura do retrato": as
 * duas leituras dão o mesmo resultado em toda fase cujo pai está no board, e só divergem aqui.
 */
const ORPHAN_PHASE = required(
  EXPECTED_CARDS.find((card): card is PhaseCard => {
    const pai = card.parent

    return (
      pai !== null &&
      !EXPECTED_CARDS.some(
        (outro) => chave(outro.repository, outro.number) === chave(pai.repository, pai.number),
      )
    )
  }),
  'uma fase cujo épico está fora do board (a borda do CA-1)',
)

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
      // As portas que trocam o GitHub por arquivo. São elas que tornam este smoke determinístico.
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell de quem roda abriria a tela
      // errada e o teste falharia por um motivo que não tem nada a ver com o kanban.
      OC_SCREEN: 'kanban',
      // Fixado pelo mesmo argumento, e não herdado: o CA-2 aqui afirma cor, e um `OC_THEME`
      // exportado no shell de quem roda mudaria em silêncio o que estas asserções medem.
      OC_THEME: 'lavanda',
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

// Os dois testes do card #41. O `CA-n` do nome é o daquele card, e não o do #4 que os vizinhos
// numeram — os dois conjuntos convivem neste arquivo, e o número sozinho seria ambíguo.
test('#41 CA-1: a fase traz o crachá do épico mesmo com o épico fora do board', async () => {
  const cracha = cardLocator(ORPHAN_PHASE.number).getByTestId('card-parent')

  await expect(cracha).toHaveAttribute('data-parent-number', String(ORPHAN_PHASE.parent.number))
  await expect(cracha).toContainText(`#${ORPHAN_PHASE.parent.number}`)

  // O título do épico vai no `title`, e não na face: a coluna tem ~264px úteis e o crachá mostra
  // só o número. É a segunda metade do CA-1.
  expect(await cracha.getAttribute('title')).toContain(ORPHAN_PHASE.parent.title)

  // E a metade que só esta borda prova: o épico não é cartão nenhum no kanban. Se o crachá viesse
  // da varredura do retrato em vez do `parent` da API, aqui não haveria de onde tirá-lo.
  await expect(cardLocator(ORPHAN_PHASE.parent.number)).toHaveCount(0)
})

test('#41 CA-2: o épico lista as fases deste board, cada uma com o nome da sua estação', async () => {
  const fases = phasesOf(EPIC_CARD)
  const naTela = cardLocator(EPIC_CARD.number).getByTestId('card-phase')

  await expect(naTela).toHaveCount(fases.length)

  for (const [index, fase] of fases.entries()) {
    // `nth` é ordem de documento: comparar posição a posição é o que prova a ordem crescente por
    // número, e não só que as mesmas fases estão todas lá.
    const linha = naTela.nth(index)

    await expect(linha).toHaveAttribute('data-phase-number', String(fase.number))
    await expect(linha).toHaveAttribute('data-phase-column', fase.columnId)
    await expect(linha).toContainText(`#${fase.number}`)
    // O nome da estação sai das colunas da fixture. Escrevê-lo à mão aqui faria o teste quebrar no
    // dia em que a estação fosse renomeada no board — um vermelho que não diz nada sobre o código.
    await expect(linha).toContainText(nomeDaColuna(fase.columnId))
  }
})

test('CA-2: a casca neobrutalista está na tela — borda de 2px, sombra dura e a paleta do tema', async () => {
  const column = window.getByTestId('column').first()
  const card = window.getByTestId('board-card').first()

  // Nada de captura de tela: os três valores do CA-2 são numéricos e comparáveis, e é por isso que
  // esta asserção não precisa de baseline nem envelhece quando alguém mexer num padding.
  for (const [nome, superficie] of [
    ['a coluna', column],
    ['o cartão', card],
  ] as const) {
    await expect(superficie, `${nome} perdeu a borda de 2px`).toHaveCSS('border-top-width', '2px')
    // A sombra **dura**: 4px de deslocamento, blur zero, spread zero. A regex e não a string
    // inteira porque o Chromium serializa a cor junto, e é o desenho que o CA-2 cobra.
    await expect(superficie, `${nome} perdeu a sombra dura`).toHaveCSS(
      'box-shadow',
      /oklch\(0 0 0\) 4px 4px 0px 0px/,
    )
  }

  // Os três níveis da hierarquia visual. O canvas sai do `body` de propósito: é ele que o
  // `index.css` pinta, e é a área que o overscroll do Chromium mostra além do conteúdo. A raia
  // **não** entra na conta — ela é `bg-background` como o canvas, e quem a separa é a borda.
  const canvas = await corDeFundo(window.locator('body'))
  const cabecalho = await corDeFundo(column.locator('header'))
  const face = await corDeFundo(card)

  // Dois a dois, e não "são três valores": a lavanda do canvas, o violet da esteira e o branco da
  // face de cartão têm de se distinguir aos pares, e um empate qualquer entre eles é o tema não
  // tendo chegado à tela.
  expect(canvas, 'o canvas e o cabeçalho da coluna têm o mesmo fundo').not.toBe(cabecalho)
  expect(cabecalho, 'o cabeçalho da coluna e a face do cartão têm o mesmo fundo').not.toBe(face)
  expect(canvas, 'o canvas e a face do cartão têm o mesmo fundo').not.toBe(face)
})

test('CA-3: o título de todo cartão continua dentro da coluna, com a borda ocupando espaço', async () => {
  // **Todo** cartão, e não um escolhido a dedo: a largura útil caiu ~8px com a borda de 2px e a
  // sombra de 4px, e o cartão que estoura é justamente o que ninguém escolheria para o teste.
  for (const card of EXPECTED_CARDS) {
    // Título vazio faria `getByTitle('')` casar com qualquer coisa, e a asserção abaixo mediria o
    // elemento errado em silêncio.
    expect(card.title, `o cartão #${card.number} está sem título na fixture`).not.toBe('')

    const titulo = await caixaDe(
      cardLocator(card.number).getByTitle(card.title, { exact: true }),
      `o título do cartão #${card.number}`,
    )
    const raia = await caixaDe(columnLocator(card.columnId), `a coluna do cartão #${card.number}`)

    expect(titulo.width, `o título do cartão #${card.number} não ocupa largura`).toBeGreaterThan(0)
    expect(
      titulo.x + titulo.width,
      `o título do cartão #${card.number} vaza pela direita da coluna`,
    ).toBeLessThanOrEqual(raia.x + raia.width)
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
  const { __typename, number, title, closed, repository, assignees, parent } = node.content

  if (__typename !== 'Issue' || number === undefined || columnId === undefined) return null

  return {
    number,
    title: title ?? '',
    columnId,
    closed: closed === true,
    repository: repository?.nameWithOwner ?? '',
    assignees: (assignees?.nodes ?? []).map((assignee) => assignee.login),
    parent: toExpectedParent(parent),
  }
}

/**
 * O pai do envelope, com as mesmas tolerâncias do `readParent` do core: sem número não há pai, e
 * `title`/`repository` ausentes viram `''` em vez de matar o vínculo.
 */
function toExpectedParent(parent: FixtureNode['content']['parent']): ExpectedParent | null {
  if (parent?.number === undefined) return null

  return {
    number: parent.number,
    title: parent.title ?? '',
    repository: parent.repository?.nameWithOwner ?? '',
  }
}

/** O nome da estação de um `optionId` — tirado das colunas do board, nunca digitado. */
function nomeDaColuna(columnId: string): string {
  return COLUMNS.find((column) => column.id === columnId)?.name ?? ''
}

/**
 * A borda que o teste exige, ou vermelho na carga do módulo.
 *
 * Sem ela, a asserção que dependeria da borda passaria a provar outra coisa em silêncio — e um
 * smoke que muda de assunto sozinho é pior que um que não roda.
 */
function required<T>(value: T | undefined, missing: string): T {
  if (value === undefined) {
    throw new Error(`a fixture do board não tem ${missing} — sem isso este smoke prova menos`)
  }

  return value
}

function cardsIn(columnId: string): readonly ExpectedCard[] {
  return EXPECTED_CARDS.filter((card) => card.columnId === columnId)
}

/**
 * O `getComputedStyle` do navegador, declarado aqui e não importado de lugar nenhum.
 *
 * O `tsconfig.node.json` que compila os smokes **não** carrega a lib DOM, e não deve: `src/main`,
 * `src/core` e `src/preload` são Node, e uma lib DOM ali deixaria um `document` solto passar
 * despercebido numa revisão. O corpo do `evaluate` roda dentro do renderer, onde o global existe de
 * verdade — o que falta é só o tipo, e só do pedaço que este arquivo lê.
 */
declare function getComputedStyle(element: unknown): { backgroundColor: string }

/** O `background-color` computado, que é o que o CA-2 compara — três valores, nenhuma imagem. */
async function corDeFundo(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor)
}

/**
 * A caixa do elemento, com o `null` virando vermelho **aqui** e nomeando quem sumiu.
 *
 * `boundingBox()` devolve `null` para elemento fora do layout — e é justamente o que o CA-3
 * precisa distinguir: cartão fora da vista horizontal continua tendo caixa, porque o kanban rola e
 * não desmonta. Deixar o `null` seguir daria um `TypeError` sobre `x` três linhas adiante.
 */
async function caixaDe(locator: Locator, oQue: string): Promise<Caixa> {
  const caixa = await locator.boundingBox()
  if (caixa === null) throw new Error(`${oQue}: sem caixa — fora do layout`)

  return caixa
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
