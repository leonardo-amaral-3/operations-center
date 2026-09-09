import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { STATUS_FIELD, TRIAGE_STATION } from '../../src/core/board/query'
import {
  BOARDS_FIXTURE_PATH,
  BOARD_FIXTURE_PATH,
  FIRST_BOARD,
  fixtureProject,
} from './boards-fixture'

/**
 * O smoke da nova triagem pela coluna 📥 Triagem: a ação, o painel e a saída (CA-1, CA-2 e CA-3 do
 * card #27).
 *
 * **Não toca a rede, não pede token e não consome cota**, como o do kanban e o do tema — e aqui isso
 * é resultado da fixture, não só da ausência de conversa: a aba que o app abre tem cartões de mais
 * de um repo, então `repoOfBoard` responde "não sei", `start` devolve `unknown-folder` e **nenhuma
 * sessão sobe**. É o ramo ambíguo do CA-2, exercitado de graça — e é por isso que este smoke entra
 * na lista dos que leem fixture, e não na dos quatro que consomem cota.
 *
 * O preço desse mesmo trato é o que ele **não** prova, e a spec o diz por escrito: a triagem rodando
 * na pasta do repo unânime, a issue nascendo e o card aparecendo sozinho no kanban ficam com a
 * verificação pós-deploy, porque automatizá-los criaria issues de verdade a cada `yarn smoke`.
 *
 * Três afirmações moram aqui porque não são escrevíveis em `tests/renderer/`, que roda no
 * `environment: 'node'` do Vitest com `renderToStaticMarkup` — sem DOM para clicar (emenda de
 * 2026-09-09 no `## Plano de testes`):
 * 1. **uma** coluna do kanban inteiro oferece a ação — decisão do `KanbanScreen`, não da `Column`;
 * 2. clicar faz o painel nascer, e a ação sai do cabeçalho enquanto ele estiver lá;
 * 3. clicar `Fechar` tira o painel da coluna. É a Decisão 11 exercitada de verdade, no estado em que
 *    ela mais importa: sem pasta e sem sessão, que é justamente onde um painel sem saída ficaria
 *    preso para sempre.
 *
 * **Nenhum valor esperado é escrito à mão.** A coluna de entrada, o `optionId` dela e quantos
 * cartões ela tem saem da fixture. Fixar o `optionId` da Triagem ou "a Triagem tem um card" faria o
 * teste quebrar no dia em que a fixture fosse recapturada — um vermelho que não diz nada sobre o
 * código.
 */

// `__dirname` e não `import.meta.url`: o Playwright transpila os specs para CommonJS enquanto o
// `package.json` não for `type: module`, e `import.meta` ali é erro de sintaxe.
const REPO_ROOT = join(__dirname, '..', '..')

/**
 * O board do envelope cru, do jeito que o `BoardReader` o recebe — a mesma leitura, e o mesmo `as`,
 * do smoke do kanban. Os opcionais existem porque a resposta é heterogênea: rascunho e pull request
 * não têm número, e valor de campo que não é single-select chega como `{}`.
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
    repository?: { nameWithOwner: string }
  }
  fieldValues: { nodes: readonly FixtureFieldValue[] }
}

interface FixtureFieldValue {
  optionId?: string
  field?: { name?: string }
}

/** O board que o app desenha: o primeiro da ordem da descoberta, derivado da fixture. */
const PROJECT = fixtureProject(FIRST_BOARD.key) as FixtureProject

/**
 * As colunas cujo nome contém a estação de entrada.
 *
 * `includes` e **não** o `isTriage` do core, de propósito: importar a régua para saber o que esperar
 * seria comparar o código consigo mesmo. Aqui a régua é mais frouxa — casa o nome inteiro sem
 * normalizar nada —, e é a guarda logo abaixo que prova que ela seleciona uma coluna só. O que se
 * importa de `query.ts` é o **nome** da estação, como o smoke do kanban já importa `STATUS_FIELD`:
 * vocabulário do board, não a decisão sob teste.
 */
const DE_ENTRADA = PROJECT.field.options.filter((option) => option.name.includes(TRIAGE_STATION))

const NODES = PROJECT.items.nodes

/** Os repos dos cartões da aba: é a contagem deles que decide se a triagem sabe onde rodar. */
const REPOS = new Set(
  NODES.filter(ehCartao)
    .map((node) => node.content.repository?.nameWithOwner)
    .filter((repository) => repository !== undefined),
)

let app: ElectronApplication
let window: Page
/** Descartável, e não o `userData` real: sem `preferences.json`, `pickActive` cai no primeiro. */
let state: string

// Os quatro testes são um roteiro, e não quatro perguntas independentes: o painel que o CA-1 abre é
// a premissa do CA-2, e o CA-3 o fecha. Serial é o que isso já é na prática com `workers: 1`, e o
// que ele acrescenta é o comportamento na falha — se o clique do CA-1 não abrir o painel, a fila
// para em vez de encenar mais duas quebras contra uma coluna vazia, que não diriam nada sobre o
// código. Mesma razão, e mesma linha, dos outros smokes que mexem no estado do app.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  state = mkdtempSync(join(tmpdir(), 'oc-triagem-'))

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
      // A aba que abre é a previsão do `FIRST_BOARD`, e ela só vale sem aba lembrada: uma
      // `preferences.json` de uso real na máquina de quem roda escolheria outra, e o teste mediria
      // um board que a fixture não descreve.
      OC_STATE_DIR: state,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell de quem roda abriria a tela
      // errada — e sem kanban não há coluna, não há ação e não há triagem.
      OC_SCREEN: 'kanban',
    },
  })

  window = await app.firstWindow()
})

test.afterAll(async () => {
  await app.close()
  rmSync(state, { recursive: true, force: true })
})

/**
 * A guarda da própria fixture, e ela vale por duas coisas.
 *
 * A primeira: sem **exatamente uma** coluna de entrada, o "um `new-triage` no kanban inteiro" lá
 * embaixo passaria a provar outra coisa — ou nada. A segunda: é a aba ter cartões de mais de um repo
 * que põe este smoke no ramo ambíguo, e é isso que o mantém sem cota. Uma recaptura que deixasse a
 * aba unânime faria o smoke tentar subir uma sessão de verdade **em silêncio**.
 */
test('a fixture ainda dá uma coluna de entrada só, e uma aba de repo ambíguo', () => {
  expect(DE_ENTRADA).toHaveLength(1)
  expect(REPOS.size).toBeGreaterThan(1)
})

test('CA-1: só a coluna de entrada oferece a nova triagem', async () => {
  // Também é esta a asserção que espera o board carregar: até a leitura terminar, a tela mostra
  // "Lendo o board…" e não existe coluna nenhuma.
  await expect(window.getByTestId('new-triage')).toHaveCount(1)

  // No kanban inteiro há uma; e ela está **nesta** coluna. As duas metades juntas são o CA-1: a
  // primeira sozinha não diz onde, e a segunda sozinha não exclui as outras sete.
  await expect(colunaDeEntrada().getByTestId('new-triage')).toHaveCount(1)
})

test('CA-1: clicar faz nascer o painel, que não é cartão, e a ação sai do cabeçalho', async () => {
  const antes = cartoesEsperados()
  await expect(colunaDeEntrada()).toHaveAttribute('data-column-count', String(antes))
  await expect(colunaDeEntrada().getByTestId('board-card')).toHaveCount(antes)

  await colunaDeEntrada().getByTestId('new-triage').click()

  await expect(colunaDeEntrada().getByTestId('triage-panel')).toHaveCount(1)

  // O painel **não** é cartão: nem entra na contagem do cabeçalho, que sai de `cards.length`, nem
  // vira um `board-card` a mais na pilha. É a asserção que pega a implementação preguiçosa — um
  // cartão sintético com número inventado — que passaria em tudo o mais deste arquivo.
  await expect(colunaDeEntrada()).toHaveAttribute('data-column-count', String(antes))
  await expect(colunaDeEntrada().getByTestId('board-card')).toHaveCount(antes)

  // E some do kanban inteiro, não só desta coluna: a chave da aba é uma só, e a segunda triagem
  // seria a mesma.
  await expect(window.getByTestId('new-triage')).toHaveCount(0)
})

test('CA-2: com a aba ambígua o painel pede a pasta, e nenhuma sessão sobe', async () => {
  const painel = colunaDeEntrada().getByTestId('triage-panel')

  await expect(painel.getByTestId('choose-folder')).toBeVisible()

  // O `choose-folder` na tela já é a resposta do main — o `unknown-folder` que o `start` devolve
  // quando a aba não tem repo unânime —, e a ausência do corpo da conversa é a outra metade: sem
  // `card-chat` não há histórico, caixa nem `cwd`, logo não há sessão. Esperar o botão **antes**
  // desta linha não é zelo: até o `start` responder, a vista ainda é a inicial e o corpo está lá.
  await expect(painel.getByTestId('card-chat')).toHaveCount(0)
})

test('CA-3: o painel nunca fica preso — Fechar o tira da coluna', async () => {
  const painel = colunaDeEntrada().getByTestId('triage-panel')

  // Sem pasta e sem sessão: é o estado em que o `disabled` do rodapé do cartão prenderia o painel
  // na coluna para sempre, e é por isso que a Decisão 11 existe. O botão tem de estar clicável.
  await painel.getByTestId('card-end-session').click()

  await expect(colunaDeEntrada().getByTestId('triage-panel')).toHaveCount(0)
  // E a ação volta ao cabeçalho: fechar devolve a coluna ao estado de onde ela saiu, e não a um
  // terceiro estado sem triagem aberta e sem como abrir outra.
  await expect(colunaDeEntrada().getByTestId('new-triage')).toHaveCount(1)
})

/** A coluna de entrada, endereçada pelo `optionId` que a fixture declara. */
function colunaDeEntrada(): Locator {
  return window.locator(`[data-testid="column"][data-column-id="${entrada().id}"]`)
}

/**
 * Quantos cartões a coluna de entrada deve mostrar — as mesmas regras do `BoardReader` aplicadas de
 * fora, como o smoke do kanban as aplica: só issue, só com número, só com o `Status` desta coluna.
 */
function cartoesEsperados(): number {
  const id = entrada().id

  return NODES.filter((node) => ehCartao(node) && statusOptionId(node) === id).length
}

/** A coluna de entrada da fixture, com o `undefined` virando vermelho aqui e não três linhas além. */
function entrada(): FixtureOption {
  const [primeira] = DE_ENTRADA
  if (primeira === undefined) throw new Error('a fixture não tem coluna de entrada')

  return primeira
}

function ehCartao(node: FixtureNode): boolean {
  return node.content.__typename === 'Issue' && node.content.number !== undefined
}

/** O `optionId` do `Status` do item, ou `undefined` se ele não estiver em coluna nenhuma. */
function statusOptionId(node: FixtureNode): string | undefined {
  return node.fieldValues.nodes.find((value) => value.field?.name === STATUS_FIELD)?.optionId
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
