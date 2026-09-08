import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { CONVERSABLE_STATIONS, STATUS_FIELD } from '../../src/core/board/query'
import {
  BOARDS_FIXTURE_PATH,
  BOARD_FIXTURE_PATH,
  DISCOVERED,
  fixtureProject,
} from './boards-fixture'

/**
 * O smoke das abas: uma aba por board da esteira, a troca de aba trocando o kanban inteiro, a
 * conversa atravessando essa troca sem vazar, e a aba ativa sobrevivendo a fechar e reabrir o app.
 *
 * Sobe o app buildado com as fixtures e percorre `fixture → descoberta → main → renderer`. Os três
 * primeiros cenários não abrem cartão nenhum e por isso **não custam cota**; o quarto abre, e com
 * ele este arquivo entra para o time do `card-chat.smoke.spec.ts`: **sobe sessão real, precisa do
 * Claude Code logado e consome cota**. Daí o `OC_MODEL` num modelo barato e o `OC_ISOLATED=1`.
 *
 * A task 11 desenhou este arquivo prevendo que o CA-3 moraria noutro lugar, para não cobrar cota de
 * três cenários que não a usam. A previsão custou o que ela queria poupar: as variáveis de sessão
 * não gastam nada sozinhas — quem gasta é abrir cartão, e só o quarto cenário abre. O que um
 * segundo arquivo cobraria de verdade é uma **terceira** encenação da descoberta e da barra de
 * abas, para provar o mesmo que estes três já provaram.
 *
 * O cenário do CA-3 precisa de duas coisas que os outros não pedem, e as duas são o molde de
 * `card-chat.smoke.spec.ts`: um repo-fantoche com `git init` e um `origin` de verdade **por aba**,
 * e uma raiz de transcripts em `OC_CLAUDE_PROJECTS` que aponte para eles. Nada da descoberta da
 * pasta é simulado — a varredura, o `git remote get-url` e a normalização rodam inteiros, e mesmo
 * assim as duas sessões aterrissam em pastas descartáveis.
 *
 * **Nenhum valor esperado é escrito à mão.** Quantas abas, com que rótulos, em que ordem, quais
 * colunas e quais cartões — tudo sai de `tests/fixtures/boards.json` e do par dele,
 * `tests/fixtures/board.json`, pelo módulo `boards-fixture`. É esta linha que faz o CA-1 ser um
 * teste e não uma promessa: o 17º board sintético da fixture existe justamente para que uma lista de
 * abas escrita no código erre a **contagem** ou o **rótulo** e este arquivo fique vermelho. Fixar
 * `Plataformas v2` ou o número `19` aqui esvaziaria a prova inteira.
 *
 * Os CAs são citados pelos números da spec — CA-1 (a barra), CA-2 (a troca), CA-3 (a conversa) e
 * CA-4 (a aba lembrada). As tasks 11 e 12 usam uma numeração por fase, e nela são três: o CA-1.2
 * delas junta as duas metades que aqui aparecem separadas, a do kanban e a da conversa. Quem manda
 * é a spec, porque é o número dela que o `## Plano de testes` usa.
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
 * A terceira fixture, e ela só entra em cena no CA-3.
 *
 * Todo cartão aberto lê o conteúdo dele, e sem esta porta o cliente de fixture **lança**: os dois
 * cartões que o cenário abre apareceriam com um erro dentro, e a troca de aba seria provada sobre
 * uma tela vermelha. A cópia versionada basta — nada aqui reescreve fixture.
 */
const CARD_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'cards.json')

/** Modelo barato: cota é recurso compartilhado com as sessões de terminal de quem roda isto. */
const SMOKE_MODEL = 'haiku'

/** Um turno do modelo. Só o CA-3 gasta um, e é de texto puro. */
const TURN_TIMEOUT = 180_000

/**
 * A única fala do arquivo, e ela paga duas coisas.
 *
 * A primeira é a `cwd`: o `init` do SDK — que é quem a reporta — chega junto com o **primeiro
 * turno**, e não com a criação da sessão; até ele o rodapé diz "Conectando à sessão do Claude
 * Code…" e não existe `card-chat-cwd` nenhum. É o mesmo trato de `card-chat.smoke.spec.ts`, que
 * também só lê a pasta depois de a sessão ter falado.
 *
 * A segunda é o histórico, e é ele que faz o CA-3 afirmar **a mesma sessão** e não só a mesma
 * pasta: `cwd` voltaria idêntica de uma sessão nova aberta no mesmo repo; o que não sobrevive a uma
 * sessão trocada é o que já foi dito.
 */
const FIRST_PROMPT = 'Responda apenas: OK'

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
  field: { options: readonly { id: string; name: string }[] }
  items: { nodes: readonly FixtureNode[] }
}

interface FixtureNode {
  content: {
    __typename: string
    number?: number
    repository?: { nameWithOwner: string }
  }
  fieldValues: { nodes: readonly { optionId?: string; field?: { name?: string } }[] }
}

/** Um cartão da fixture, no mínimo de que este smoke precisa: em quem clicar, e onde ele vive. */
interface Cartao {
  number: number
  columnId: string
  repository: string
}

/** O que uma aba deve pôr na tela quando for a ativa — derivado, nunca digitado. */
interface Retrato {
  key: string
  /** O rótulo da aba. Sai da descoberta, e o board relido confirma o mesmo (ver a guarda abaixo). */
  title: string
  columnIds: readonly string[]
  cardNumbers: readonly number[]
  /**
   * O primeiro cartão desta aba que abre conversa, ou `undefined` se o board não tiver nenhum.
   *
   * É ele que o CA-3 clica — e, por tabela, é o repositório dele que decide qual `origin` o
   * repo-fantoche daquela aba recebe. Derivado como tudo o mais: fixar "o card #4" faria o teste
   * quebrar no dia da recaptura, por um motivo que não diz nada sobre o código.
   */
  conversa: Cartao | undefined
}

const RETRATOS: readonly Retrato[] = DISCOVERED.map(toRetrato)

/** A aba que nasce ativa: a primeira da ordem, porque no primeiro ciclo não há aba lembrada. */
const PRIMEIRA = required(RETRATOS[0], 'board nenhum da esteira')

/** A aba para a qual o humano troca — e a que o segundo ciclo de vida tem de encontrar ativa. */
const SEGUNDA = required(RETRATOS[1], 'um segundo board para trocar de aba')

/** Os dois cartões que o CA-3 abre, um por aba. */
const CONVERSA_A = required(PRIMEIRA.conversa, `cartão conversável nenhum em ${PRIMEIRA.key}`)
const CONVERSA_B = required(SEGUNDA.conversa, `cartão conversável nenhum em ${SEGUNDA.key}`)

let app: ElectronApplication
let window: Page
/** O `OC_STATE_DIR`: onde o app grava a aba ativa. Descartável, para o smoke não sujar a máquina. */
let state: string
/** A raiz descartável do CA-3: dentro dela vivem os repos-fantoche e a raiz de transcripts. */
let scenario: string
/** O `OC_CLAUDE_PROJECTS`: a raiz de transcripts de onde sai o mapa `repo → pasta local`. */
let projects: string
/** `owner/repo` → a pasta descartável em que a sessão daquele repo tem de aterrissar. */
const puppets = new Map<string, string>()

// Dois ciclos de vida do mesmo app, em ordem: o que um teste deixa em disco é a premissa do
// seguinte — a aba que o CA-2 ativa é exatamente a que o CA-4 espera reencontrar. Serial é o que
// isso já é na prática, e é o que faz uma falha parar a fila em vez de encenar de novo a mesma
// quebra três vezes.
test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  state = mkdtempSync(join(tmpdir(), 'oc-abas-'))
  // `realpathSync` porque a `cwd` que a sessão reporta é o caminho resolvido pelo sistema: em
  // `%TEMP%` com nome curto (8.3) ou com junção pelo meio, comparar o caminho não resolvido daria um
  // vermelho sobre a forma da string, e não sobre a pasta em que a sessão subiu.
  scenario = realpathSync(mkdtempSync(join(tmpdir(), 'oc-abas-repos-')))
  projects = join(scenario, 'projects')
  mkdirSync(projects)

  // Montados na carga, e não dentro do CA-3: se o `git` desta máquina não colaborar, isso tem de
  // aparecer antes de qualquer app subir — e não no meio de um cenário que já gastou um turno.
  for (const conversa of [CONVERSA_A, CONVERSA_B]) fantoche(conversa.repository)
})

test.afterAll(async () => {
  await app.close()
  // Só depois de o app morrer: enquanto ele — e os subprocessos do Claude Code — vivem, o Windows
  // segura handles nas duas pastas.
  rmSync(state, { recursive: true, force: true, maxRetries: 3 })
  rmSync(scenario, { recursive: true, force: true, maxRetries: 3 })
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

  // E a **terceira** fixture acompanha as outras duas. `cards.json` é o par de `board.json` — uma
  // entrada por issue que vira cartão —, e a entrada que falta não derruba nada: o cartão abre com
  // o erro da fixture dentro dele, e o CA-3 seguiria verde provando a troca de aba sobre uma tela
  // com um vermelho no meio. Cobrado aqui, com o número do cartão, e não lá.
  const conteudos = JSON.parse(readFileSync(CARD_FIXTURE_PATH, 'utf8')) as Record<string, unknown>
  for (const conversa of [CONVERSA_A, CONVERSA_B]) {
    expect(
      conteudos[String(conversa.number)],
      `cards.json não tem o conteúdo do card #${conversa.number}`,
    ).toBeDefined()
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

test('CA-3: a conversa sobrevive à troca de aba e não vaza', async () => {
  // O CA-4 deixou a **segunda** aba ativa; o cenário começa na primeira. E começa esperando o
  // kanban dela: clicar num cartão que ainda não chegou clicaria em coisa nenhuma.
  await abaLocator(PRIMEIRA.key).click()
  await esperarKanbanDe(PRIMEIRA)

  const cartaoA = cardLocator(CONVERSA_A.number)

  // Que a coluna deste cartão é mesmo das que conversam não é suposição do teste: o atributo vem da
  // regra que o core decidiu, e é por ele que este é o cartão certo para o critério.
  await expect(cartaoA).toHaveAttribute('data-card-conversable', 'true')
  await cartaoA.click()
  await expect(cartaoA.getByTestId('card-chat')).toBeVisible()

  // A fala vem antes de qualquer asserção sobre a sessão, e não por pressa: é o primeiro turno que
  // traz o `init` — ver o comentário do `FIRST_PROMPT`. É também o único turno de cota do arquivo.
  const entrada = cartaoA.getByTestId('card-chat-input')
  await entrada.fill(FIRST_PROMPT)
  await entrada.press('Enter')
  await expect(assistantMessages(cartaoA).first()).toBeVisible({ timeout: TURN_TIMEOUT })

  // O que está no rodapé **é** a pasta em que o Claude Code subiu — o SDK a reportou —, e não um
  // rótulo que o renderer montou. É ela que a volta para esta aba tem de reencontrar idêntica.
  const cwdA = cartaoA.getByTestId('card-chat-cwd')
  await expect(cwdA).toBeVisible()
  expect(comparablePath(await cwdA.textContent())).toBe(
    comparablePath(puppet(CONVERSA_A.repository)),
  )

  // A aba B, e a metade "não vaza": o `card-chat` da A não está em lugar nenhum desta tela. No
  // kanban **inteiro**, e não só fora do cartão dela — é a asserção que pega uma conversa desenhada
  // por baixo de um board que não é o dela.
  await abaLocator(SEGUNDA.key).click()
  await esperarKanbanDe(SEGUNDA)
  await expect(window.getByTestId('card-chat')).toHaveCount(0)

  // Abrir um cartão aqui é a outra metade: cada aba lembra o **seu** cartão aberto, e o da A não
  // pode fechar por causa disto.
  const cartaoB = cardLocator(CONVERSA_B.number)

  await expect(cartaoB).toHaveAttribute('data-card-conversable', 'true')
  await cartaoB.click()
  await expect(cartaoB.getByTestId('card-chat')).toBeVisible()
  await expect(window.getByTestId('card-chat')).toHaveCount(1)

  // E só. A sessão desta aba sobe — o `card-chat` no lugar do pedido de pasta é a prova de que o
  // repo-fantoche dela foi encontrado —, mas ela não fala: o que o CA-3 cobra aqui é que o cartão
  // **abra e continue aberto**, e um segundo turno custaria cota para provar o mesmo.

  // De volta à aba A: o cartão continua **aberto**, e a conversa é a mesma — mesma pasta e mesmo
  // histórico. Uma sessão trocada devolveria a mesma pasta e um histórico vazio; é o `FIRST_PROMPT`
  // ainda na tela que separa os dois casos.
  await abaLocator(PRIMEIRA.key).click()
  await esperarKanbanDe(PRIMEIRA)
  await expect(cartaoA.getByTestId('card-chat')).toBeVisible()
  await expect(cwdA).toBeVisible()
  expect(comparablePath(await cwdA.textContent())).toBe(
    comparablePath(puppet(CONVERSA_A.repository)),
  )
  await expect(userMessages(cartaoA).first()).toContainText(FIRST_PROMPT)
  await expect(assistantMessages(cartaoA).first()).toBeVisible()

  // E o "não vaza" no outro sentido, que é o que fecha a simetria: o cartão-chat da B não veio
  // junto. Um só na tela, e ele é o desta aba.
  await expect(window.getByTestId('card-chat')).toHaveCount(1)

  // E o cartão da B não fechou enquanto estivemos aqui: a asserção que fecha o CA-3 pelo outro
  // lado, e sem a qual "cada aba lembra o seu" valeria só para a primeira delas.
  await abaLocator(SEGUNDA.key).click()
  await esperarKanbanDe(SEGUNDA)
  await expect(cartaoB.getByTestId('card-chat')).toBeVisible()
  await expect(window.getByTestId('card-chat')).toHaveCount(1)
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
      // A do conteúdo do card, obrigatória a partir do CA-3: ver o comentário da constante.
      OC_CARD_FIXTURE: CARD_FIXTURE_PATH,
      // A porta que troca `~/.claude/projects` pela raiz do cenário. É ela que torna a descoberta
      // da pasta determinística sem substituir nenhuma peça dela.
      OC_CLAUDE_PROJECTS: projects,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell de quem roda abriria a tela
      // errada e o teste falharia por um motivo que não tem nada a ver com abas.
      OC_SCREEN: 'kanban',
      // As duas do CA-3, e elas não custam nada nos três cenários que não abrem cartão: o que gasta
      // cota é uma sessão, e nenhuma sobe até alguém clicar. Sem `OC_ISOLATED`, a sessão carregaria
      // o contexto inteiro deste projeto — que é a maior parte da conta.
      OC_ISOLATED: '1',
      OC_MODEL: SMOKE_MODEL,
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
  const cartoes = project.items.nodes.map(toCartao).filter((cartao) => cartao !== null)

  // As colunas que abrem chat, pela lista que o próprio core publica. Aqui ela serve para **escolher
  // em quem clicar**, e não para afirmar o critério: quem prova a regra — com emoji, sem emoji, com
  // acento e sem — é `tests/unit/BoardReader.test.ts`. Por isso o `includes` basta, e não é preciso
  // repetir aqui a normalização do `BoardReader`.
  const conversaveis = new Set(
    project.field.options
      .filter((option) => CONVERSABLE_STATIONS.some((station) => option.name.includes(station)))
      .map((option) => option.id),
  )

  return {
    key: board.key,
    title: project.title,
    columnIds: project.field.options.map((option) => option.id),
    cardNumbers: cartoes.map((cartao) => cartao.number),
    conversa: cartoes.find((cartao) => conversaveis.has(cartao.columnId)),
  }
}

/** As mesmas regras do `BoardReader` que decidem o que vira cartão: só issue, com número e Status. */
function toCartao(node: FixtureNode): Cartao | null {
  const columnId = statusOptionId(node)
  const { __typename, number, repository } = node.content

  if (__typename !== 'Issue' || number === undefined || columnId === undefined) return null

  return { number, columnId, repository: repository?.nameWithOwner ?? '' }
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

/**
 * O repo-fantoche de um repositório do board: `git init` de verdade, `origin` de verdade, e um
 * transcript de uma linha apontando para ele.
 *
 * Um por repositório, e não um por cartão: se as duas abas conversassem sobre o mesmo repo, dois
 * fantoches com o mesmo `origin` deixariam ambíguo qual pasta o índice devolveria — e o CA-3
 * passaria a afirmar uma coincidência.
 *
 * É o molde de `card-chat.smoke.spec.ts`, copiado e não importado pela mesma razão que `toCartao` é:
 * o que se monta aqui é o **cenário** deste arquivo, e um cenário compartilhado teria de servir aos
 * dois — que é como uma bancada de teste começa a decidir o que o teste prova.
 */
function fantoche(repository: string): string {
  const conhecido = puppets.get(repository)
  if (conhecido !== undefined) return conhecido

  const pasta = join(scenario, slug(repository))

  mkdirSync(pasta)
  execFileSync('git', ['-C', pasta, 'init', '-q'])
  execFileSync('git', [
    '-C',
    pasta,
    'remote',
    'add',
    'origin',
    `https://github.com/${repository}.git`,
  ])

  // Uma linha basta: é a `cwd` de dentro do transcript que o índice lê, nunca o nome da pasta.
  const transcripts = join(projects, slug(repository))

  mkdirSync(transcripts)
  writeFileSync(
    join(transcripts, 'fantoche.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: pasta })}\n`,
    'utf8',
  )

  puppets.set(repository, pasta)

  return pasta
}

/** A pasta em que a sessão daquele repo tem de ter subido. Montada no `beforeAll`. */
function puppet(repository: string): string {
  const pasta = puppets.get(repository)
  if (pasta === undefined) throw new Error(`nenhum repo-fantoche foi montado para ${repository}`)

  return pasta
}

/** `owner/repo` como nome de pasta. Só precisa ser estável e único entre os repos do cenário. */
function slug(repository: string): string {
  return repository.replace(/[^\w.-]+/g, '-')
}

/**
 * Um caminho na forma em que o sistema de arquivos o compara.
 *
 * O que se afirma é a **pasta**, não a grafia dela: no Windows a caixa não distingue caminho nenhum,
 * e `/` e `\` levam ao mesmo lugar. Comparar as strings cruas trocaria a asserção sobre onde a
 * sessão subiu por uma sobre como o SDK escreveu o caminho de volta.
 */
function comparablePath(path: string | null): string {
  return (path ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

function assistantMessages(cartao: Locator): Locator {
  return cartao.locator('[data-testid="message"][data-role="assistant"]')
}

function userMessages(cartao: Locator): Locator {
  return cartao.locator('[data-testid="message"][data-role="user"]')
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
