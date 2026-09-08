import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { STATUS_FIELD } from '../../src/core/board/query'
import {
  BOARDS_FIXTURE_PATH,
  BOARD_FIXTURE_PATH,
  DISCOVERED,
  fixtureProject,
} from './boards-fixture'

/**
 * O smoke das abas: uma aba por board da esteira, a troca de aba trocando o kanban inteiro, e a aba
 * ativa sobrevivendo a fechar e reabrir o app.
 *
 * Sobe o app buildado com as duas fixtures e percorre `fixture → descoberta → main → renderer`. Como
 * o smoke do kanban, ele **não toca a rede, não pede token e não consome cota** — e, ao contrário do
 * da retomada, também não sobe sessão nenhuma: nada aqui abre cartão. A conversa que atravessa a
 * troca de aba (CA-3) é o outro arquivo, pelo motivo oposto: ela precisa do aparato de sessão
 * inteiro, e arrastá-lo para cá cobraria cota de três cenários que não a usam.
 *
 * **Nenhum valor esperado é escrito à mão.** Quantas abas, com que rótulos, em que ordem, quais
 * colunas e quais cartões — tudo sai de `tests/fixtures/boards.json` e do par dele,
 * `tests/fixtures/board.json`, pelo módulo `boards-fixture`. É esta linha que faz o CA-1 ser um
 * teste e não uma promessa: o 17º board sintético da fixture existe justamente para que uma lista de
 * abas escrita no código erre a **contagem** ou o **rótulo** e este arquivo fique vermelho. Fixar
 * `Plataformas v2` ou o número `19` aqui esvaziaria a prova inteira.
 *
 * Os CAs são citados pelos números da spec — CA-1 (a barra), CA-2 (a troca) e CA-4 (a aba
 * lembrada). A task 11 os chama de CA-1.1, CA-1.2 e CA-1.3 numa numeração por fase; é a mesma coisa
 * dita de dois jeitos, e o que casa com o `## Plano de testes` é o número da spec.
 *
 * As âncoras `data-testid` que ele lê são contrato fixado na spec. Se alguma faltar, o bug é do
 * componente: a âncora volta ao nome da spec, nunca o teste ao nome errado.
 */

// `__dirname` e não `import.meta.url`: o Playwright transpila os specs para CommonJS enquanto o
// `package.json` não for `type: module`, e `import.meta` ali é erro de sintaxe.
const REPO_ROOT = join(__dirname, '..', '..')

/**
 * O arquivo que o app grava dentro do `OC_STATE_DIR` quando o humano troca de aba.
 *
 * Lido com `JSON.parse`, e não procurado como linha no texto: `writeState` grava **indentado**, e um
 * teste que caçasse a forma compactada ficaria vermelho sobre a grafia do arquivo em vez de sobre a
 * preferência gravada.
 */
const PREFERENCES_FILE = 'preferences.json'

/** Intervalo entre duas leituras do `preferences.json` enquanto a gravação não aparece. */
const POLL_INTERVAL = 250

/**
 * O prazo da gravação da aba ativa. Generoso para disco local, e curto perto do prazo do teste: o
 * que se espera aqui é um `rename` no `%TEMP%`, não uma resposta de rede.
 */
const GRAVACAO_TIMEOUT = 15_000

/**
 * O envelope cru do `BOARD_QUERY`, reduzido ao que este smoke lê.
 *
 * O `as` é o mesmo trato que `createFixtureGraphQL` faz com o mesmo arquivo: o que valida a forma de
 * verdade é o app rodando logo abaixo — se a fixture não tiver a forma que a API devolve, o kanban
 * sobe vazio e todas as asserções caem juntas. Os opcionais existem porque a resposta é
 * heterogênea: rascunho e pull request não têm número, e valor de campo que não é single-select
 * chega como `{}`.
 */
interface FixtureProject {
  title: string
  field: { options: readonly { id: string }[] }
  items: { nodes: readonly FixtureNode[] }
}

interface FixtureNode {
  content: {
    __typename: string
    number?: number
  }
  fieldValues: { nodes: readonly { optionId?: string; field?: { name?: string } }[] }
}

/** O que uma aba deve pôr na tela quando for a ativa — derivado, nunca digitado. */
interface Retrato {
  key: string
  /** O rótulo da aba. Sai da descoberta, e o board relido confirma o mesmo (ver a guarda abaixo). */
  title: string
  columnIds: readonly string[]
  cardNumbers: readonly number[]
}

const RETRATOS: readonly Retrato[] = DISCOVERED.map(toRetrato)

/** A aba que nasce ativa: a primeira da ordem, porque no primeiro ciclo não há aba lembrada. */
const PRIMEIRA = required(RETRATOS[0], 'board nenhum da esteira')

/** A aba para a qual o humano troca — e a que o segundo ciclo de vida tem de encontrar ativa. */
const SEGUNDA = required(RETRATOS[1], 'um segundo board para trocar de aba')

let app: ElectronApplication
let window: Page
/** O `OC_STATE_DIR`: onde o app grava a aba ativa. Descartável, para o smoke não sujar a máquina. */
let state: string

// Dois ciclos de vida do mesmo app, em ordem: o que um teste deixa em disco é a premissa do
// seguinte — a aba que o CA-2 ativa é exatamente a que o CA-4 espera reencontrar. Serial é o que
// isso já é na prática, e é o que faz uma falha parar a fila em vez de encenar de novo a mesma
// quebra três vezes.
test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  state = mkdtempSync(join(tmpdir(), 'oc-abas-'))
})

test.afterAll(async () => {
  await app.close()
  // Só depois de o app morrer: enquanto ele vive, o Windows segura handles na pasta de estado.
  rmSync(state, { recursive: true, force: true, maxRetries: 3 })
})

/**
 * A guarda da própria fixture.
 *
 * Sem ela, uma recaptura distraída de `boards.json` deixaria este arquivo **verde** provando menos —
 * que é o pior desfecho possível para um teste cuja tese inteira é "o valor esperado não está
 * escrito no código". Cada linha aqui defende uma asserção lá embaixo que viraria vácuo sem a borda
 * que ela cobra.
 */
test('a fixture ainda sustenta o que este smoke afirma', () => {
  // O sintético, cobrado pela propriedade que o `_comment` da fixture lhe atribui — um dono
  // **fabricado**, diferente daquele cuja lista o traz — e não pelo nome, que seria justamente o
  // valor escrito à mão que este arquivo não pode ter. Perdê-lo faria a contagem cair para dois: um
  // número que uma lista fixa no código acerta por acaso.
  const varridos = Object.keys(
    (JSON.parse(readFileSync(BOARDS_FIXTURE_PATH, 'utf8')) as { byOwner: Record<string, unknown> })
      .byOwner,
  )
  expect(
    DISCOVERED.some((board) => !varridos.includes(board.owner)),
    'sumiu o board sintético: sem um dono fabricado, a contagem de abas volta a ser adivinhável',
  ).toBe(true)

  // Sem dois boards não há troca de aba a provar, e o CA-2 inteiro vira uma asserção sobre a única
  // tela que existe.
  expect(RETRATOS.length).toBeGreaterThan(1)

  // "Nenhum do primeiro sobrevive" só significa alguma coisa se os dois boards não compartilharem
  // coluna nem cartão. Compartilhando, a asserção seria impossível de satisfazer — ou, pior,
  // satisfeita por engano.
  expect(comum(PRIMEIRA.columnIds, SEGUNDA.columnIds), 'os dois boards dividem coluna').toEqual([])
  expect(comum(PRIMEIRA.cardNumbers, SEGUNDA.cardNumbers), 'os dois dividem cartão').toEqual([])

  // E cada board tem o que desenhar: um board sem coluna nenhuma passaria em toda contagem abaixo
  // sem nada ter chegado à tela.
  for (const retrato of RETRATOS) {
    expect(retrato.columnIds.length, `${retrato.key} sem coluna`).toBeGreaterThan(0)
  }
  expect(SEGUNDA.cardNumbers.length, `${SEGUNDA.key} sem cartão`).toBeGreaterThan(0)

  // As duas fixtures têm de concordar sobre o título de cada board. A aba nasce com o título da
  // **descoberta** e passa a usar o do **board** assim que a leitura volta; enquanto os dois forem o
  // mesmo, o rótulo é estável e o teste pode afirmá-lo sem depender de qual dos dois chegou. Se
  // discordassem, o vermelho apareceria na asserção de rótulo do CA-1 e diria a coisa errada sobre o
  // código.
  for (const [indice, retrato] of RETRATOS.entries()) {
    const descoberto = required(DISCOVERED[indice], 'a ordem dos dois derivados divergiu')
    expect(retrato.title, `as duas fixtures discordam do título de ${retrato.key}`).toBe(
      descoberto.title,
    )
  }
})

test('CA-1: há uma aba por board da esteira e nenhuma a mais', async () => {
  await launch()

  const abas = window.getByTestId('board-tab')

  // A primeira asserção do arquivo é também a que espera a descoberta terminar: até lá a tela mostra
  // "Descobrindo os boards…" e não existe aba nenhuma. A contagem sai da fixture — é ela que faz
  // uma lista fixa de dois boards escrita no código ficar vermelha aqui, e não em lugar nenhum.
  await expect(abas).toHaveCount(RETRATOS.length)

  for (const [indice, retrato] of RETRATOS.entries()) {
    // `nth` é ordem de documento: comparar posição a posição prova a **ordem** das abas, e não só
    // que as mesmas chaves estão todas lá.
    await expect(abas.nth(indice)).toHaveAttribute('data-board-key', retrato.key)
    await expect(abas.nth(indice)).toHaveText(retrato.title)
  }

  // A aba ativa é a primeira da ordem, e a marca é semântica: `aria-selected`, não a cor de fundo.
  // Esta linha é também a premissa do CA-4 lá embaixo — sem ela, "a aba B nasceu ativa" poderia ser
  // só o app abrindo sempre onde abre.
  await expect(abaLocator(PRIMEIRA.key)).toHaveAttribute('aria-selected', 'true')
  await expect(window.locator('[data-testid="board-tab"][aria-selected="true"]')).toHaveCount(1)

  // E o kanban da tela é o dessa aba, não o de outra.
  await esperarKanbanDe(PRIMEIRA)
})

test('CA-2: trocar de aba troca o kanban inteiro', async () => {
  await abaLocator(SEGUNDA.key).click()

  await expect(abaLocator(SEGUNDA.key)).toHaveAttribute('aria-selected', 'true')
  await expect(abaLocator(PRIMEIRA.key)).toHaveAttribute('aria-selected', 'false')

  // O kanban do segundo board **inteiro**: a contagem mais a presença de cada `optionId` e de cada
  // número prova igualdade de conjunto, e não só que alguma coisa nova apareceu.
  await esperarKanbanDe(SEGUNDA)

  // A outra metade do CA-2, e a que precisa vir **depois** da espera acima: enquanto a troca não
  // tivesse chegado à tela, "não há coluna do primeiro board" seria uma frase verdadeira sobre o
  // instante errado. Explícita por coluna e por cartão porque o vermelho tem de nomear o que
  // sobreviveu — a contagem sozinha só diria que o total não bate.
  for (const columnId of PRIMEIRA.columnIds) {
    await expect(columnLocator(columnId), `a coluna ${columnId} sobreviveu à troca`).toHaveCount(0)
  }
  for (const number of PRIMEIRA.cardNumbers) {
    await expect(cardLocator(number), `o cartão #${number} sobreviveu à troca`).toHaveCount(0)
  }
})

test('CA-4: a aba ativa sobrevive a fechar e reabrir', async () => {
  // A gravação é enfileirada e ninguém a anuncia no DOM — o `invoke` já respondeu quando ela começa.
  // Poll deliberado, então, e com prazo: sem ele o `close()` abaixo correria contra a escrita e a
  // falha diria "a aba não foi lembrada" quando o que houve foi um teste apressado.
  expect(await abaGravada()).toBe(SEGUNDA.key)

  await app.close()

  // O segundo ciclo de vida: processo novo, nada em memória, e em disco só o que o primeiro deixou.
  await launch()

  await expect(window.getByTestId('board-tab')).toHaveCount(RETRATOS.length)
  // A aba lembrada nasce ativa — e nasce assim no **primeiro** retrato que traz abas: quem escolhe é
  // o main, no fim da descoberta, e a tela nunca chega a pintar a primeira aba para depois corrigir.
  await expect(abaLocator(SEGUNDA.key)).toHaveAttribute('aria-selected', 'true')
  await expect(abaLocator(PRIMEIRA.key)).toHaveAttribute('aria-selected', 'false')

  // E o kanban veio junto: uma preferência que só movesse o realce seria meia preferência.
  await esperarKanbanDe(SEGUNDA)
})

/**
 * Sobe o app com o cenário ligado e espera a janela.
 *
 * Existe porque este smoke o faz **duas vezes**, com o mesmo ambiente nas duas: é a identidade das
 * variáveis entre os dois ciclos — o `OC_STATE_DIR`, acima de tudo — que faz o segundo enxergar o
 * que o primeiro deixou.
 */
async function launch(): Promise<void> {
  app = await electron.launch({
    // O app buildado, resolvido pelo `main` do `package.json`. O `yarn smoke` roda o
    // `electron-vite build` antes justamente para que `out/` exista aqui.
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      ...inheritedEnv(),
      // As portas que trocam o GitHub por arquivo. São elas que tornam este smoke determinístico —
      // e a de `boards.json` é o que faz a barra de abas ser a da fixture, e não a da conta de quem
      // roda o teste.
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      // A porta desta feature: sem ela a aba ativa iria para o `userData` real da máquina, e o
      // smoke mudaria a aba em que o app de quem o roda abre da próxima vez.
      OC_STATE_DIR: state,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell de quem roda abriria a tela
      // errada e o teste falharia por um motivo que não tem nada a ver com abas.
      OC_SCREEN: 'kanban',
    },
  })

  window = await app.firstWindow()
}

/**
 * A `key` gravada como aba ativa, esperando a gravação acontecer.
 *
 * Tolerante na leitura do mesmo jeito que o app é — arquivo ainda ausente ou meio escrito é "nada
 * gravado" —, e quem transforma a ausência em vermelho é o prazo, que sabe o que estava esperando.
 */
async function abaGravada(): Promise<string> {
  const deadline = Date.now() + GRAVACAO_TIMEOUT

  while (Date.now() < deadline) {
    const gravada = lerAbaGravada()
    if (gravada !== null) return gravada

    await window.waitForTimeout(POLL_INTERVAL)
  }

  throw new Error(`nenhuma aba foi gravada em ${PREFERENCES_FILE} em ${GRAVACAO_TIMEOUT} ms`)
}

function lerAbaGravada(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(state, PREFERENCES_FILE), 'utf8')) as {
      activeBoard?: unknown
    }

    return typeof parsed.activeBoard === 'string' ? parsed.activeBoard : null
  } catch {
    return null
  }
}

/**
 * O kanban daquela aba na tela, por conjunto: a contagem mais a presença de cada `optionId` e de
 * cada número. Os dois juntos são igualdade de conjunto — a contagem sozinha toleraria uma troca, e
 * a presença sozinha toleraria um sobrevivente.
 */
async function esperarKanbanDe(retrato: Retrato): Promise<void> {
  await expect(window.getByTestId('column')).toHaveCount(retrato.columnIds.length)
  for (const columnId of retrato.columnIds) {
    await expect(columnLocator(columnId), `falta a coluna ${columnId}`).toHaveCount(1)
  }

  await expect(window.getByTestId('board-card')).toHaveCount(retrato.cardNumbers.length)
  for (const number of retrato.cardNumbers) {
    await expect(cardLocator(number), `falta o cartão #${number}`).toHaveCount(1)
  }
}

/**
 * O que o board da fixture põe na tela, pelas mesmas regras do `BoardReader`: só issue, só com
 * número, só com `Status`.
 *
 * Escritas de novo aqui de propósito — se o teste importasse o `BoardReader` para saber o que
 * esperar, estaria comparando o código consigo mesmo.
 */
function toRetrato(board: { key: string }): Retrato {
  const project = fixtureProject(board.key) as FixtureProject

  return {
    key: board.key,
    title: project.title,
    columnIds: project.field.options.map((option) => option.id),
    cardNumbers: project.items.nodes
      .filter((node) => node.content.__typename === 'Issue' && statusOptionId(node) !== undefined)
      .map((node) => node.content.number)
      .filter((number) => number !== undefined),
  }
}

/** O `optionId` do `Status` do item, ou `undefined` se ele não estiver em coluna nenhuma. */
function statusOptionId(node: FixtureNode): string | undefined {
  return node.fieldValues.nodes.find((value) => value.field?.name === STATUS_FIELD)?.optionId
}

function comum<T>(a: readonly T[], b: readonly T[]): readonly T[] {
  return a.filter((item) => b.includes(item))
}

/**
 * O que a fixture precisa ter para este smoke fazer sentido, cobrado na carga do módulo.
 *
 * Lança de propósito: sem a borda, o teste que dependeria dela passaria a provar outra coisa — e um
 * smoke que muda de assunto em silêncio é pior que um que não roda.
 */
function required<T>(value: T | undefined, missing: string): T {
  if (value === undefined) {
    throw new Error(`a fixture da descoberta não tem ${missing} — sem isso este smoke prova menos`)
  }

  return value
}

function abaLocator(key: string): Locator {
  return window.locator(`[data-testid="board-tab"][data-board-key="${key}"]`)
}

function columnLocator(columnId: string): Locator {
  return window.locator(`[data-testid="column"][data-column-id="${columnId}"]`)
}

function cardLocator(number: number): Locator {
  return window.locator(`[data-testid="board-card"][data-card-number="${number}"]`)
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
