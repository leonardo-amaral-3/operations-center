import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { CONVERSABLE_STATIONS, STATUS_FIELD } from '../../src/core/board/query'

/**
 * O smoke do cartão-chat: clicar num cartão do kanban e conversar dentro dele, de ponta a ponta.
 *
 * Ele junta as duas metades que os outros dois smokes provam separadas — o kanban desenhado a
 * partir da fixture e uma sessão real do Claude Code —, e acrescenta a que só existe aqui: a
 * **descoberta da pasta**. Nada dela é simulado. O cenário monta um repo-fantoche com `git init` e
 * um `origin` de verdade, escreve um transcript de uma linha apontando para ele e liga
 * `OC_CLAUDE_PROJECTS` nessa raiz — então a varredura, o `git remote get-url` e a normalização
 * rodam inteiros, e mesmo assim a sessão aterrissa numa pasta descartável.
 *
 * Como o smoke da fatia vertical, ele **sobe sessão real: precisa do Claude Code logado e consome
 * cota**. Por isso `OC_MODEL` num modelo barato e `OC_ISOLATED=1`, e por isso ele fica fora do CI.
 *
 * **Nenhum valor esperado é escrito à mão.** Quais cartões clicar saem da fixture, e até o `origin`
 * do repo-fantoche é o repositório do cartão que a fixture manda conversar. Fixar "o card #4" faria
 * o teste quebrar no dia em que a fixture fosse recapturada, por um motivo que não diz nada sobre o
 * código.
 *
 * As âncoras `data-testid` que ele lê são contrato fixado na spec. Se alguma faltar, o bug é do
 * componente: a âncora volta ao nome da spec, nunca o teste ao nome errado.
 */

// `__dirname` e não `import.meta.url`: o Playwright transpila os specs para CommonJS enquanto o
// `package.json` não for `type: module`, e `import.meta` ali é erro de sintaxe.
const REPO_ROOT = join(__dirname, '..', '..')

/** **Absoluto**, e é o ponto: o processo do Electron não roda com a `cwd` do runner. */
const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'board.json')

/** Modelo barato: cota é recurso compartilhado com as sessões de terminal de quem roda isto. */
const SMOKE_MODEL = 'haiku'

/** Um turno do modelo, inclusive quando ele decide usar ferramenta. */
const TURN_TIMEOUT = 180_000

/** Depois do clique, voltar a `working` é síncrono no core: o que se espera aqui é só o IPC. */
const DECISION_TIMEOUT = 15_000

/** Intervalo entre duas leituras do estado enquanto a sessão trabalha. */
const POLL_INTERVAL = 250

/** A primeira coisa dita à sessão. Guardada porque o CA-6 a relê depois de colapsar e reabrir. */
const FIRST_PROMPT = 'Responda apenas: OK'

/**
 * O turno que o #12 manda parar: longo o bastante para dar tempo do clique, e **de texto puro**.
 *
 * O "sem usar ferramenta nenhuma" não é enfeite: o smoke roda com `OC_ISOLATED=1`, e ali *toda*
 * ferramenta passa pelo `canUseTool` — um pedido de permissão levaria o cartão a
 * `awaiting_decision`, o botão sumiria (CA-3) e o clique falharia por um motivo que não tem nada a
 * ver com parar turno.
 */
const LONG_PROMPT = 'Conte de 1 a 200, um número por linha, sem usar ferramenta nenhuma'

/**
 * O turno do CA-3 do #14: **de texto puro**, pela mesma razão do `LONG_PROMPT`, e longo o bastante
 * para haver turno em curso a observar quando a asserção chegar.
 *
 * O "explique o raciocínio" não é enfeite de prompt: o único heartbeat que o SDK publica são os
 * quadros de `thinking_tokens`, e sem fase de raciocínio o contador fica em zero e o teste falharia
 * por escolha do modelo, não por bug do app.
 */
const THINKING_PROMPT =
  'Pense com calma e explique o seu raciocínio passo a passo: quantos dias há entre 3 de março de ' +
  '2027 e 19 de novembro de 2027? Não use ferramenta nenhuma.'

/**
 * O envelope cru, do jeito que o `BoardReader` o recebe — reduzido ao que este smoke precisa.
 *
 * O `as` é o mesmo trato que `createFixtureGraphQL` faz com o mesmo arquivo: o que valida a forma de
 * verdade é o app rodando logo abaixo. Os opcionais existem porque a resposta é heterogênea:
 * rascunho e pull request não têm número nem repositório, e valor de campo que não é single-select
 * chega como `{}`.
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

/** Um cartão da fixture, no mínimo de que este smoke precisa para escolher em quem clicar. */
interface FixtureCard {
  number: number
  columnId: string
  repository: string
}

const PROJECT = (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureEnvelope).data.user
  .projectV2

const COLUMNS = PROJECT.field.options

const CARDS = PROJECT.items.nodes.map(toFixtureCard).filter((card) => card !== null)

/**
 * As colunas que abrem chat, pela lista que o próprio core publica.
 *
 * Aqui a lista serve para **escolher em quem clicar**, e não para afirmar o critério: quem prova a
 * regra — com emoji, sem emoji, com acento e sem — é `tests/unit/BoardReader.test.ts`. Por isso o
 * `includes` basta, e não é preciso repetir aqui a normalização do `BoardReader`.
 */
const CONVERSABLE_COLUMN_IDS = new Set(
  COLUMNS.filter((column) =>
    CONVERSABLE_STATIONS.some((station) => column.name.includes(station)),
  ).map((column) => column.id),
)

const CONVERSABLE_CARDS = CARDS.filter((card) => CONVERSABLE_COLUMN_IDS.has(card.columnId))

/** O cartão que vai conversar de verdade — e, por tabela, quem define o `origin` do repo-fantoche. */
const CHAT_CARD = required(CONVERSABLE_CARDS[0], 'cartão nenhum em coluna conversável')

/** O repo que o cenário faz existir nesta máquina. Sai da fixture, não de uma constante. */
const HOME_REPO = CHAT_CARD.repository

/** O segundo cartão do CA-1, **em outra coluna**: abrir este tem de colapsar aquele. */
const SECOND_CARD = required(
  CONVERSABLE_CARDS.find(
    (card) => card.repository === HOME_REPO && card.columnId !== CHAT_CARD.columnId,
  ),
  'um segundo cartão conversável do mesmo repo em outra coluna',
)

/**
 * A borda do CA-5: um cartão em coluna conversável cujo repo **não** existe nesta máquina.
 *
 * Ela é sintética na fixture de propósito, e a guarda de `kanban.smoke.spec.ts` vigia a existência
 * dela. Perdê-la numa recaptura distraída pararia este smoke aqui, na carga — e não com um verde
 * que provaria menos.
 */
const OUTSIDER_CARD = required(
  CONVERSABLE_CARDS.find((card) => card.repository !== HOME_REPO),
  'um cartão conversável de um repo forasteiro (a borda do CA-5)',
)

/** O cartão do CA-4: coluna sem skill dedicada, logo clique nenhum abre nada. */
const INERT_CARD = required(
  CARDS.find((card) => !CONVERSABLE_COLUMN_IDS.has(card.columnId)),
  'um cartão em coluna não conversável (a borda do CA-4)',
)

let app: ElectronApplication
let window: Page
/** A raiz descartável do cenário: dentro dela vivem o repo-fantoche e a raiz de transcripts. */
let scenario: string
/** O repo-fantoche — a pasta em que a sessão do cartão precisa aterrissar (CA-3). */
let puppetRepo: string

// Estes testes compartilham um app e uma conversa: o que um deixa na tela é a premissa do
// seguinte. Serial é o que isso já é na prática — e o que faz uma falha parar a fila em vez de
// gastar cota provando de novo a mesma quebra.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  // `realpathSync` porque o `cwd` que a sessão vai reportar é o caminho resolvido pelo sistema: em
  // `%TEMP%` com nome curto (8.3) ou com junção pelo meio, comparar o caminho não resolvido daria
  // um vermelho sobre a forma da string, e não sobre a pasta em que a sessão subiu.
  scenario = realpathSync(mkdtempSync(join(tmpdir(), 'oc-card-chat-')))
  puppetRepo = join(scenario, 'repo-fantoche')
  const projects = join(scenario, 'projects')
  const transcripts = join(projects, 'sessao-fantoche')

  mkdirSync(puppetRepo)
  mkdirSync(transcripts, { recursive: true })

  // O repo-fantoche: git de verdade, com o `origin` do repo do cartão que vai conversar. É contra
  // ele que `gitOrigin` roda — nada de mock na parte que importa.
  execFileSync('git', ['-C', puppetRepo, 'init', '-q'])
  execFileSync('git', [
    '-C',
    puppetRepo,
    'remote',
    'add',
    'origin',
    `https://github.com/${HOME_REPO}.git`,
  ])

  // Uma linha basta: é o `cwd` de dentro do transcript que o índice lê, nunca o nome da pasta.
  writeFileSync(
    join(transcripts, 'fantoche.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: puppetRepo })}\n`,
    'utf8',
  )

  app = await electron.launch({
    // O app buildado, resolvido pelo `main` do `package.json`. O `yarn smoke` roda o
    // `electron-vite build` antes justamente para que `out/` exista aqui.
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      // O ambiente é herdado inteiro, e `ANTHROPIC_API_KEY` **não** é removida: é o mesmo trato do
      // smoke da fatia vertical, que já afirma lá que a sessão não sobe em billing de API.
      ...inheritedEnv(),
      // A porta que troca o GitHub por um arquivo: o board deste smoke não toca a rede.
      OC_BOARD_FIXTURE: FIXTURE_PATH,
      // A porta que troca `~/.claude/projects` pela raiz do cenário. É ela que torna a descoberta
      // determinística sem substituir nenhuma peça dela.
      OC_CLAUDE_PROJECTS: projects,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell abriria a tela errada e o
      // teste falharia por um motivo que não tem nada a ver com o cartão-chat.
      OC_SCREEN: 'kanban',
      // Sem carregar as settings pessoais, nenhuma allowlist pode pré-aprovar a ferramenta do CA-2
      // e fazer o pedido de permissão não aparecer. É o que torna aquele passo determinístico — e,
      // de quebra, o que deixa o smoke barato.
      OC_ISOLATED: '1',
      OC_MODEL: SMOKE_MODEL,
      // Inertes de propósito, como no smoke do kanban: se a fiação da fixture quebrar, o app tenta
      // ler um board que não existe e o smoke fica vermelho na hora, em vez de passar em silêncio
      // contra o board de verdade.
      OC_PROJECT_OWNER: 'dono-que-a-fixture-ignora',
      OC_PROJECT_NUMBER: '999',
    },
  })

  window = await app.firstWindow()
})

test.afterAll(async () => {
  await app.close()
  // Só depois de o app morrer: enquanto os subprocessos do Claude Code viverem, o Windows segura
  // handles nas pastas.
  rmSync(scenario, { recursive: true, force: true, maxRetries: 3 })
})

test('CA-5: o cartão do repo forasteiro pede a pasta, e não sobe sessão nenhuma', async () => {
  // A primeira asserção do arquivo é também a que espera o board carregar: até a leitura terminar,
  // a tela mostra "Lendo o board…" e não existe cartão nenhum.
  await expect(window.getByTestId('board-card')).toHaveCount(CARDS.length)

  await cardLocator(OUTSIDER_CARD).click()

  // O pedido da pasta, e **nenhuma conversa**: sem pasta resolvida não há sessão, e é isso que
  // separa o CA-5 de um chat que abriria numa pasta chutada.
  await expect(cardLocator(OUTSIDER_CARD).getByTestId('choose-folder')).toBeVisible()
  await expect(window.getByTestId('card-chat')).toHaveCount(0)

  // Colapsado, o cartão só mostra o sinal de estado quando existe sessão viva atrás dele. A
  // ausência do sinal é a prova de que nenhuma nasceu — o `start` respondeu, e respondeu "não sei".
  await cardLocator(OUTSIDER_CARD).getByTestId('card-collapse').click()
  await expect(cardLocator(OUTSIDER_CARD).getByTestId('state-badge')).toHaveCount(0)
})

test('CA-1 e CA-2: o cartão vira chat no próprio lugar, e a sessão responde', async () => {
  await cardLocator(CHAT_CARD).click()

  // Dentro do cartão, dentro da coluna daquele `columnId` — não em modal, não em outra tela. E um
  // só no kanban inteiro, que é a outra metade do RF-6.
  await expect(cardLocator(CHAT_CARD).getByTestId('card-chat')).toBeVisible()
  await expect(columnLocator(CHAT_CARD.columnId).getByTestId('card-chat')).toHaveCount(1)
  await expect(window.getByTestId('card-chat')).toHaveCount(1)

  const input = cardLocator(CHAT_CARD).getByTestId('card-chat-input')

  // Ler e digitar: a mensagem atravessa renderer → main → core → SDK e a resposta volta renderizada
  // dentro do cartão. A bolha de assistente só existe quando há texto, então vê-la já prova o texto.
  await input.fill(FIRST_PROMPT)
  await input.press('Enter')
  await expect(assistantMessages(CHAT_CARD).first()).toBeVisible({ timeout: TURN_TIMEOUT })
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input', {
    timeout: TURN_TIMEOUT,
  })
})

test('CA-3: a sessão do cartão roda na pasta do repo dele, e o cartão mostra qual é', async () => {
  const cwd = cardLocator(CHAT_CARD).getByTestId('card-chat-cwd')

  // A âncora só existe depois do `init`, e o `init` é o que o SDK reporta da sessão de verdade —
  // então o que está na tela **é** a `cwd` em que o Claude Code subiu, e não um rótulo que o
  // renderer montou por conta própria.
  await expect(cwd).toBeVisible()
  expect(comparablePath(await cwd.textContent())).toBe(comparablePath(puppetRepo))
})

test('CA-2: a permissão de escrita aparece no cartão e a decisão destrava o turno', async () => {
  const input = cardLocator(CHAT_CARD).getByTestId('card-chat-input')

  await input.fill('Crie um arquivo `smoke.txt` com o texto OK')
  await input.press('Enter')

  // A mesma carona do smoke da fatia vertical, agora dentro do cartão e igualmente **sem cota
  // nenhuma**: as crases já estavam naquele prompt. `smoke.txt` vira `<code>` e a crase não sobra
  // como caractere no texto visível — é o markdown do #9 provado na segunda tela, que é justamente
  // a que a bolha compartilhada existe para não deixar divergir.
  const sentBubble = userMessages(CHAT_CARD).last()
  await expect(sentBubble.locator('code')).toHaveText('smoke.txt')
  await expect(sentBubble).not.toContainText('`')

  await expect(cardLocator(CHAT_CARD).getByTestId('permission-prompt')).toBeVisible({
    timeout: TURN_TIMEOUT,
  })
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_decision')

  await cardLocator(CHAT_CARD).getByTestId('permission-allow').click()
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'working', {
    timeout: DECISION_TIMEOUT,
  })

  await allowUntilAwaitingInput(CHAT_CARD)

  // O arquivo no repo-fantoche fecha o CA-3 pelo outro lado: o rótulo na tela dizia aquela pasta, e
  // é nela que a ferramenta de fato escreveu.
  expect(existsSync(join(puppetRepo, 'smoke.txt'))).toBe(true)
})

test('CA-4: clicar num cartão de coluna sem skill dedicada não abre nada', async () => {
  await cardLocator(INERT_CARD).click()

  await expect(cardLocator(INERT_CARD).getByTestId('card-chat')).toHaveCount(0)
  // E o cartão que estava aberto **continua aberto**: prova que o clique foi um clique de verdade,
  // num elemento que estava lá, e que simplesmente não fez nada — e não um clique que errou o alvo.
  await expect(cardLocator(CHAT_CARD).getByTestId('card-chat')).toBeVisible()
  await expect(window.getByTestId('card-chat')).toHaveCount(1)
})

test('CA-1 e CA-6: abrir o segundo cartão colapsa o primeiro, e a sessão dele continua viva', async () => {
  await cardLocator(SECOND_CARD).click()

  await expect(cardLocator(SECOND_CARD).getByTestId('card-chat')).toBeVisible()
  await expect(columnLocator(SECOND_CARD.columnId).getByTestId('card-chat')).toHaveCount(1)
  await expect(window.getByTestId('card-chat')).toHaveCount(1)

  // Colapsado — e vivo. O sinal no cartão fechado é o que torna o CA-6 operável: uma conversa que
  // continua atrás de um cartão fechado sem sinal nenhum é uma conversa que ninguém gere.
  await expect(cardLocator(CHAT_CARD).getByTestId('card-chat')).toHaveCount(0)
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input')

  // Reabrir devolve a conversa, e não uma sessão nova: as duas mensagens que este teste mandou
  // continuam lá, na ordem em que foram ditas.
  await cardLocator(CHAT_CARD).click()
  await expect(cardLocator(CHAT_CARD).getByTestId('card-chat')).toBeVisible()

  const mine = userMessages(CHAT_CARD)
  await expect(mine).toHaveCount(2)
  await expect(mine.first()).toContainText(FIRST_PROMPT)
})

test('#12: parar o turno corta a vez, deixa a nota e devolve a sessão viva', async () => {
  const stopButton = cardLocator(CHAT_CARD).getByTestId('card-stop-turn')
  const input = cardLocator(CHAT_CARD).getByTestId('card-chat-input')

  // Nada rodando, nada a parar: o botão do CA-3 é situacional, e em `awaiting_input` ele nem existe
  // no DOM.
  await expect(stopButton).toHaveCount(0)

  await input.fill(LONG_PROMPT)
  await input.press('Enter')

  // `working` já no Enter — é o CA-4, e é ele que faz o botão existir num turno que não pede
  // permissão nenhuma. O prazo é o do IPC, não o do modelo: a transição é síncrona no core.
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'working', {
    timeout: DECISION_TIMEOUT,
  })
  await expect(stopButton).toBeVisible()

  await stopButton.click()

  // O CA-1 na sessão real: a vez volta, e volta como `awaiting_input` — e não como `failed`, que é
  // o que um result de turno abortado viraria sem a bandeira do core.
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input', {
    timeout: TURN_TIMEOUT,
  })

  // A parada é visível (a nota) e a ação some com o turno que ela cortou.
  await expect(noticeMessages(CHAT_CARD)).toHaveCount(1)
  await expect(stopButton).toHaveCount(0)

  // O CA-2 pela metade da memória: a conversa inteira continua na tela, na ordem, com a primeira
  // mensagem ainda sendo a primeira.
  const mine = userMessages(CHAT_CARD)
  await expect(mine).toHaveCount(3)
  await expect(mine.first()).toContainText(FIRST_PROMPT)

  // E a outra metade: a **mesma** sessão responde o turno seguinte. A contagem é lida agora e
  // comparada com `+1` porque quantas bolhas o turno cortado deixou é escolha do modelo — fixar um
  // número aqui seria escrever à mão um valor esperado que o teste pode ler.
  const answers = await assistantMessages(CHAT_CARD).count()

  await input.fill('Responda apenas: SEGUE')
  await input.press('Enter')

  await expect(assistantMessages(CHAT_CARD)).toHaveCount(answers + 1, { timeout: TURN_TIMEOUT })
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input', {
    timeout: TURN_TIMEOUT,
  })
})

test('#14 CA-2: a trilha da ferramenta sobrevive ao colapso do cartão', async () => {
  // A ferramenta que gerou a trilha é a do passo da permissão de escrita, lá em cima: aqui o que se
  // prova é que aquilo **ficou**, e não que o modelo usa ferramenta — isso ele já provou uma vez, e
  // provar de novo custaria outro turno de cota por nada.
  await expect(toolEntries(CHAT_CARD).first()).toBeVisible()

  await cardLocator(CHAT_CARD).getByTestId('card-collapse').click()
  await expect(cardLocator(CHAT_CARD).getByTestId('card-chat')).toHaveCount(0)

  await cardLocator(CHAT_CARD).click()
  await expect(cardLocator(CHAT_CARD).getByTestId('card-chat')).toBeVisible()

  // Com o status final, e não só presente: uma entrada que voltasse `running` seria uma sessão que
  // a tela afirma trabalhando sobre uma ferramenta que terminou faz tempo.
  await expect(doneToolEntries(CHAT_CARD).first()).toBeVisible()
  await expect(runningToolEntries(CHAT_CARD)).toHaveCount(0)
})

test('#14 CA-3: a linha viva conta o turno, e some quando ele acaba', async () => {
  const input = cardLocator(CHAT_CARD).getByTestId('card-chat-input')
  const pulse = cardLocator(CHAT_CARD).getByTestId('turn-pulse')

  // Fora de turno não há pulso: ele é o spinner, não o histórico.
  await expect(pulse).toHaveCount(0)

  await input.fill(THINKING_PROMPT)
  await input.press('Enter')

  await expect(pulse).toBeVisible({ timeout: DECISION_TIMEOUT })
  // O contador de raciocínio é o único heartbeat que o SDK dá: vê-lo passar de zero é a prova de
  // que a linha está viva de verdade, e não desenhando um relógio local sobre uma sessão muda.
  await expect(pulse).toHaveAttribute('data-tokens', /^[1-9]\d*$/, { timeout: TURN_TIMEOUT })

  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input', {
    timeout: TURN_TIMEOUT,
  })

  // E some. Sem isto o app teria trocado um sinal que mente por outro: uma linha eternamente viva
  // sobre uma sessão parada é exatamente o que este card existe para tirar da tela.
  await expect(pulse).toHaveCount(0)
})

test('CA-6: encerrar é ação minha — e o botão mata a sessão', async () => {
  await cardLocator(CHAT_CARD).getByTestId('card-end-session').click()

  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'closed', {
    timeout: DECISION_TIMEOUT,
  })
})

/**
 * Permite o que a sessão pedir até ela devolver a vez.
 *
 * O passo da escrita pede um arquivo, mas quem decide quantas ferramentas usar para isso é o modelo
 * — ele pode querer olhar a pasta antes de escrever nela, e em modo isolado *toda* ferramenta passa
 * pelo `canUseTool`. Fixar "exatamente um pedido" tornaria o teste refém dessa escolha; o que o
 * critério afirma é que o pedido chega ao cartão e que a decisão humana destrava o turno.
 */
async function allowUntilAwaitingInput(card: FixtureCard): Promise<void> {
  const state = badge(card)
  const deadline = Date.now() + TURN_TIMEOUT

  while (Date.now() < deadline) {
    const kind = await state.getAttribute('data-state')

    if (kind === 'awaiting_input') return
    // Sessão morta não devolve vez nenhuma: esperar o prazo inteiro só trocaria o motivo real da
    // falha por um timeout que não explica nada.
    if (kind === 'closed' || kind === 'failed') {
      throw new Error(`a sessão terminou em ${kind} antes de devolver a vez`)
    }

    if (kind === 'awaiting_decision') {
      await cardLocator(card).getByTestId('permission-allow').click()
      // O prompt some da tela no clique, mas o estado só muda quando a resposta volta pela ponte.
      // Sem esperar por isso, a volta do laço tentaria clicar num botão que já não existe.
      await expect(state).not.toHaveAttribute('data-state', 'awaiting_decision', {
        timeout: DECISION_TIMEOUT,
      })
      continue
    }

    // Poll deliberado: o que se observa aqui é o progresso de um agente externo, e o DOM não tem
    // evento nenhum para assinar enquanto ele pensa.
    await window.waitForTimeout(POLL_INTERVAL)
  }

  throw new Error(`a sessão não devolveu a vez em ${TURN_TIMEOUT} ms`)
}

/** O `optionId` do `Status` do item, ou `undefined` se ele não estiver em coluna nenhuma. */
function statusOptionId(node: FixtureNode): string | undefined {
  return node.fieldValues.nodes.find((value) => value.field?.name === STATUS_FIELD)?.optionId
}

/** As mesmas regras do `BoardReader` que decidem o que vira cartão: só issue, com número e Status. */
function toFixtureCard(node: FixtureNode): FixtureCard | null {
  const columnId = statusOptionId(node)
  const { __typename, number, repository } = node.content

  if (__typename !== 'Issue' || number === undefined || columnId === undefined) return null

  return { number, columnId, repository: repository?.nameWithOwner ?? '' }
}

/**
 * O que a fixture precisa ter para este smoke fazer sentido.
 *
 * Lança na carga do módulo, de propósito: sem a borda, o teste que dependeria dela passaria a
 * provar outra coisa — e um smoke que muda de assunto em silêncio é pior que um que não roda.
 */
function required<T>(value: T | undefined, missing: string): T {
  if (value === undefined) {
    throw new Error(`a fixture do board não tem ${missing} — sem isso este smoke prova menos`)
  }

  return value
}

function cardLocator(card: FixtureCard): Locator {
  return window.locator(`[data-testid="board-card"][data-card-number="${card.number}"]`)
}

function columnLocator(columnId: string): Locator {
  return window.locator(`[data-testid="column"][data-column-id="${columnId}"]`)
}

function badge(card: FixtureCard): Locator {
  return cardLocator(card).getByTestId('state-badge')
}

function assistantMessages(card: FixtureCard): Locator {
  return cardLocator(card).locator('[data-testid="message"][data-role="assistant"]')
}

function userMessages(card: FixtureCard): Locator {
  return cardLocator(card).locator('[data-testid="message"][data-role="user"]')
}

function noticeMessages(card: FixtureCard): Locator {
  return cardLocator(card).locator('[data-testid="message"][data-role="notice"]')
}

function toolEntries(card: FixtureCard): Locator {
  return cardLocator(card).locator('[data-testid="tool-entry"]')
}

function doneToolEntries(card: FixtureCard): Locator {
  return cardLocator(card).locator('[data-testid="tool-entry"][data-status="done"]')
}

function runningToolEntries(card: FixtureCard): Locator {
  return cardLocator(card).locator('[data-testid="tool-entry"][data-status="running"]')
}

/**
 * Um caminho na forma em que o sistema de arquivos o compara.
 *
 * O que o CA-3 afirma é a **pasta**, não a grafia dela: no Windows a caixa não distingue caminho
 * nenhum, e `/` e `\` levam ao mesmo lugar. Comparar as strings cruas trocaria uma asserção sobre
 * onde a sessão subiu por uma sobre como o SDK escreveu o caminho de volta.
 */
function comparablePath(path: string | null): string {
  return (path ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

/**
 * O `process.env` do runner, pronto para o Playwright: passar `env` substitui o ambiente inteiro,
 * e sem `PATH` (e sem `HOME`/`USERPROFILE`, onde vivem as credenciais do Claude Code) o Electron
 * nem subiria. As chaves sem valor caem porque o tipo do Playwright só aceita string.
 */
function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}
