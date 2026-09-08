import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * A outra metade da fixture: o conteúdo de cada card.
 *
 * Ela não é opcional aqui desde o card #13. Todo cartão aberto lê o conteúdo dele, e sem esta porta
 * o cliente de fixture **lança** — o cartão abriria com um erro na tela, e todo passo deste arquivo
 * falharia por falta de arquivo, não por bug do app. A cópia versionada basta: nenhum teste daqui
 * reescreve fixture (quem faz isso é o smoke do conteúdo, no diretório temporário dele).
 */
const CARD_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'cards.json')

/** Modelo barato: cota é recurso compartilhado com as sessões de terminal de quem roda isto. */
const SMOKE_MODEL = 'haiku'

/** Um turno do modelo, inclusive quando ele decide usar ferramenta. */
const TURN_TIMEOUT = 180_000

/** Depois do clique, o próximo estado é síncrono no core: o que se espera aqui é só o IPC. */
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

/** O retângulo que o Playwright devolve, em pixels da viewport. */
interface Caixa {
  x: number
  y: number
  width: number
  height: number
}

/** O board que o app desenha: o primeiro da ordem da descoberta, derivado da fixture. */
const PROJECT = fixtureProject(FIRST_BOARD.key) as FixtureProject

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

/**
 * O cartão do CA-3 do card #13: coluna sem skill dedicada, logo ele abre para ler e não conversa.
 *
 * Era a borda do CA-4 do #6 — "clique nenhum abre nada" —, e o #13 emendou aquele critério: o que
 * sobrevive dele é a metade que este arquivo continua provando, que ali **nenhuma sessão sobe**.
 */
const INERT_CARD = required(
  CARDS.find((card) => !CONVERSABLE_COLUMN_IDS.has(card.columnId)),
  'um cartão em coluna não conversável (a borda do CA-3 do #13)',
)

let app: ElectronApplication
let window: Page
/** A raiz descartável do cenário: dentro dela vivem o repo-fantoche, os transcripts e o estado. */
let scenario: string
/** O repo-fantoche — a pasta em que a sessão do cartão precisa aterrissar (CA-3). */
let puppetRepo: string
/**
 * O `OC_STATE_DIR`: a pasta em que o app grava o próprio estado — aqui, a marca do modo do #10.
 *
 * `stateDir`, e não `state` como no smoke da retomada: ali não há um `const state` local a
 * sombrear o nome, e aqui há (`allowUntilAwaitingInput`).
 */
let stateDir: string

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
  stateDir = join(scenario, 'state')
  const projects = join(scenario, 'projects')
  const transcripts = join(projects, 'sessao-fantoche')

  mkdirSync(puppetRepo)
  mkdirSync(stateDir)
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
      // As portas que trocam o GitHub por arquivo: o board deste smoke não toca a rede.
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      // E a do conteúdo do card, pelo mesmo motivo — e obrigatória: ver o comentário da constante.
      OC_CARD_FIXTURE: CARD_FIXTURE_PATH,
      // A porta que troca `~/.claude/projects` pela raiz do cenário. É ela que torna a descoberta
      // determinística sem substituir nenhuma peça dela.
      OC_CLAUDE_PROJECTS: projects,
      // A pasta de estado do próprio app, apontada para o cenário por duas razões independentes.
      //
      // A que o #10 obriga: a marca do modo é durável, e sem esta porta uma marca sobrevivente de
      // uma rodada anterior faria o último teste deste arquivo começar com o modo já ligado — ele
      // provaria que desligar funciona, e não que ligar funciona.
      //
      // E a que já valia antes dele: sem a variável, este smoke escreve o `conversations.json` no
      // `userData` real da máquina de quem o roda. Um vazamento pequeno, mas que não tem defensor.
      OC_STATE_DIR: stateDir,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell abriria a tela errada e o
      // teste falharia por um motivo que não tem nada a ver com o cartão-chat.
      OC_SCREEN: 'kanban',
      // Sem carregar as settings pessoais, nenhuma allowlist pode pré-aprovar a ferramenta do CA-2
      // e fazer o pedido de permissão não aparecer. É o que torna aquele passo determinístico — e,
      // de quebra, o que deixa o smoke barato.
      OC_ISOLATED: '1',
      OC_MODEL: SMOKE_MODEL,
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

  // O CA-3 do card #8, de carona nesta sessão viva: a borda de 2px e a sombra de 4px do design
  // system comem largura útil dentro da coluna de 288px, e o sinal de estado é o que mais cresce
  // aqui dentro. **Nos quatro lados**, e não só pela direita: na barra de ações ele divide a linha
  // com três botões, e um estouro por cima ou por baixo seria clipado pelo scroll do mesmo jeito.
  //
  // Medido aqui e não em teste próprio porque um teste novo custaria um turno novo — e a asserção
  // não precisa de um: o que ela lê é geometria, e a geometria já está na tela.
  const sinal = await caixaDe(badge(CHAT_CARD), 'o sinal de estado do cartão-chat')
  const cartao = await caixaDe(cardLocator(CHAT_CARD), 'o cartão-chat')

  expect(sinal.width, 'o sinal de estado não ocupa largura').toBeGreaterThan(0)
  expect(sinal.x, 'o sinal de estado vaza pela esquerda do cartão').toBeGreaterThanOrEqual(cartao.x)
  expect(sinal.y, 'o sinal de estado vaza por cima do cartão').toBeGreaterThanOrEqual(cartao.y)
  expect(
    sinal.x + sinal.width,
    'o sinal de estado vaza pela direita do cartão',
  ).toBeLessThanOrEqual(cartao.x + cartao.width)
  expect(sinal.y + sinal.height, 'o sinal de estado vaza por baixo do cartão').toBeLessThanOrEqual(
    cartao.y + cartao.height,
  )
})

test('CA-3: a sessão do cartão roda na pasta do repo dele, e o cartão mostra qual é', async () => {
  const cwd = cardLocator(CHAT_CARD).getByTestId('card-chat-cwd')

  // A âncora só existe depois do `init`, e o `init` é o que o SDK reporta da sessão de verdade —
  // então o que está na tela **é** a `cwd` em que o Claude Code subiu, e não um rótulo que o
  // renderer montou por conta própria.
  await expect(cwd).toBeVisible()
  expect(comparablePath(await cwd.textContent())).toBe(comparablePath(puppetRepo))
})

/**
 * O CA-5 do card #13, de carona nesta sessão viva e **sem gastar um turno**: o que ele afirma é
 * geometria e estado, e os dois já estão na tela.
 *
 * Ele fica aqui, e não no smoke do conteúdo, porque é o único arquivo com sessão de verdade — a
 * pergunta "recarregar o conteúdo encerra a sessão?" não tem como ser respondida onde não há sessão.
 */
test('#13 CA-5: o conteúdo e a conversa dividem o cartão, e recarregar não toca a sessão', async () => {
  const card = cardLocator(CHAT_CARD)

  // Os dois no **mesmo** cartão: o conteúdo acima, a caixa de escrever abaixo. É o que separa esta
  // decisão de abas ou de painel lateral, que cumpririam "conversa alcançável" e não "com o
  // conteúdo à mostra".
  await expect(card.getByTestId('card-content')).toBeVisible()
  await expect(card.getByTestId('card-chat-input')).toBeVisible()

  // Recolher a seção e recarregá-la são os dois gestos que mexem no conteúdo. Nenhum deles pode
  // mexer na sessão — e o estado do badge é onde isso apareceria primeiro.
  await card.getByTestId('card-content-toggle').click()
  await expect(card.getByTestId('card-content-body')).toHaveCount(0)

  const reload = card.getByTestId('card-content-reload')

  await reload.click()
  // O ⟳ volta a si quando a leitura aterrissa: esperar por isso é esperar a recarga **inteira**, e
  // não só o clique — sem essa espera a asserção abaixo leria o badge antes de a resposta chegar.
  await expect(reload).toBeEnabled()

  await expect(card.getByTestId('card-chat-input')).toBeVisible()
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input')
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

  // A decisão humana destrava o turno. O que vem **depois** dela não se afirma aqui: com a fila do
  // #11, o estado seguinte tanto pode ser `working` quanto o próximo pedido, ao sabor de quantas
  // ferramentas o modelo resolveu disparar no lote. Quem cobra o resto é o laço, que atravessa a
  // fila inteira até a vez voltar.
  await cardLocator(CHAT_CARD).getByTestId('permission-allow').click()

  await allowUntilAwaitingInput(CHAT_CARD)

  // O arquivo no repo-fantoche fecha o CA-3 pelo outro lado: o rótulo na tela dizia aquela pasta, e
  // é nela que a ferramenta de fato escreveu.
  expect(existsSync(join(puppetRepo, 'smoke.txt'))).toBe(true)
})

/**
 * A reescrita deliberada do teste do CA-4 do #6.
 *
 * Aquele teste afirmava duas coisas: que o clique não abre chat, e que o cartão-chat **continua
 * aberto** atrás dele. A segunda deixou de ser verdade quando o #13 fez todo cartão abrir — um
 * cartão por vez (RF-6), e agora o inerte também é um cartão. A primeira sobrevive inteira, e é o
 * que o CA-3 do #13 herda: ali nenhuma sessão sobe.
 *
 * O passo de reabrir no fim não é zelo: sem ele o teste seguinte ("abrir o segundo cartão colapsa o
 * primeiro") passaria verde afirmando um colapso que já tinha acontecido aqui — degradação
 * silenciosa, que é pior que vermelho.
 */
test('#13 CA-3: o cartão de coluna sem skill abre o conteúdo, e não sobe sessão', async () => {
  await cardLocator(INERT_CARD).click()

  // Que a coluna é mesmo das sem skill não é suposição do teste: o atributo vem da regra que o core
  // decidiu, e é por ele que este cartão é o cartão certo para o critério.
  await expect(cardLocator(INERT_CARD)).toHaveAttribute('data-card-conversable', 'false')

  // Abre — e abre **mostrando**, porque não há sessão viva aqui para disputar a atenção: cartão sem
  // conversa nasce com o conteúdo à mostra, que é o único motivo de alguém tê-lo aberto.
  await expect(cardLocator(INERT_CARD).getByTestId('card-content')).toBeVisible()
  await expect(cardLocator(INERT_CARD).getByTestId('card-content-body')).toBeVisible()

  // E nada de sessão: nem neste cartão, nem no kanban inteiro. Zero, e não "um" como antes — o
  // cartão-chat colapsou, que é o RF-6 aplicado ao cartão que agora também abre.
  await expect(window.getByTestId('card-chat')).toHaveCount(0)

  // A sessão do outro cartão sobreviveu ao colapso. É o CA-6 do #6 ganhando uma prova a mais, no
  // lugar da que a emenda tirou.
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input')

  // Reabrir devolve **aquela** conversa, com o histórico: o `start` é idempotente por `itemId`, e
  // nenhuma segunda sessão subiu enquanto o cartão esteve fechado.
  await cardLocator(CHAT_CARD).click()
  await expect(cardLocator(CHAT_CARD).getByTestId('card-chat')).toBeVisible()
  await expect(window.getByTestId('card-chat')).toHaveCount(1)
  await expect(userMessages(CHAT_CARD).first()).toContainText(FIRST_PROMPT)
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
 * O card #10 contra o SDK de verdade: o modo *dangerously* ligado, usado, e desligado — tudo na
 * mesma sessão viva.
 *
 * É a única prova da entrega que lê o `permissionMode` **reportado** pelo SDK em vez do mandado
 * pelo app. Os unitários fixam o contrato medido dentro do `fakeQuery` (ele recusa a troca sem
 * `allowDangerouslySkipPermissions`, e não chama o `canUseTool` em bypass), mas um fake é uma
 * afirmação nossa sobre o SDK; aqui quem responde é ele. E o fake emite `init` uma vez só, nunca a
 * cada turno como o SDK real — então o modo reportado depois de uma troca só existe aqui.
 *
 * **Ele opera o `SECOND_CARD`, e fica no fim do arquivo.** As duas escolhas são obrigatórias, não
 * estéticas: este arquivo é `mode: 'serial'` e dois testes acima fixam a contagem de mensagens do
 * `CHAT_CARD` em 2 e em 3 — mandar prompt naquele cartão aqui os quebraria por um motivo que não
 * diz nada sobre o modo. O `SECOND_CARD` tem sessão viva desde o teste do colapso e ninguém conta
 * as mensagens dele.
 *
 * A sessão dele nasceu **sem** a marca, e é o caso interessante: o que se exerce aqui é a troca em
 * voo (`setPermissionMode` numa sessão de pé), e não o nascimento já em bypass. É também a ordem em
 * que uma pessoa de verdade faz isso — abrir o cartão e clicar antes de escrever qualquer coisa.
 */
test('#10 CA-1 e CA-3: o cartão marcado roda sem portão, e desmarcar devolve o portão', async () => {
  const card = cardLocator(SECOND_CARD)

  await card.click()
  await expect(card.getByTestId('card-chat')).toBeVisible()
  await expect(card.getByTestId('danger-badge')).toHaveCount(0)

  await card.getByTestId('card-danger-toggle').click()

  // O crachá é o retrato **publicado de volta** pelo main — o renderer não tem estado otimista.
  // Vê-lo é ver o caminho inteiro ter acontecido: o SDK aceitou a troca de modo, o main gravou a
  // marca e o evento voltou. E vê-lo **com o cartão aberto** é a metade do CA-2 que separa este
  // crachá dos vizinhos, que se calam ao expandir.
  await expect(card.getByTestId('danger-badge')).toBeVisible({ timeout: DECISION_TIMEOUT })

  const input = card.getByTestId('card-chat-input')
  const semPortao = 'sem-portao.txt'

  await input.fill(`Crie um arquivo \`${semPortao}\` com o texto OK`)
  await input.press('Enter')

  await expectTurnWithoutGate(SECOND_CARD)

  // A ferramenta **executou**, e não apenas o turno terminou depressa: um modelo que respondesse
  // "claro, pode deixar" sem tocar em ferramenta nenhuma daria exatamente o mesmo verde acima. O
  // CA-1 fala de ferramenta que roda sem perguntar, e é o arquivo em disco que diz isso.
  expect(existsSync(join(puppetRepo, semPortao))).toBe(true)

  // A segunda fonte, a do próprio SDK: o `init` do turno que acabou de rodar. Antes deste turno o
  // valor em mãos ainda era o do nascimento da sessão (`default`), e é por isso que a leitura vem
  // aqui e não logo depois do clique.
  await expect(card.getByTestId('card-chat-cwd')).toHaveAttribute(
    'data-permission-mode',
    'bypassPermissions',
  )

  // Desligar — **sem encerrar nada**. A conversa acima continua na tela e a sessão é a mesma: é o
  // CA-3 ("o comportamento volta a ser o de hoje") e a reversibilidade do CA-2 no mesmo caso.
  await card.getByTestId('card-danger-toggle').click()
  await expect(card.getByTestId('danger-badge')).toHaveCount(0, { timeout: DECISION_TIMEOUT })

  // Alvo de nome **diferente** do passo anterior, e é o mesmo cuidado que o `THINKING_PROMPT`
  // documenta: repetir o prompt daria ao modelo um arquivo que já existe, ele poderia responder
  // "já está feito" sem pedir ferramenta nenhuma, e o portão não teria a chance de aparecer — o
  // teste falharia por escolha dele, não por bug do app.
  const comPortao = 'com-portao.txt'

  await input.fill(`Crie um arquivo \`${comPortao}\` com o texto OK`)
  await input.press('Enter')

  await expect(card.getByTestId('permission-prompt')).toBeVisible({ timeout: TURN_TIMEOUT })
  await expect(badge(SECOND_CARD)).toHaveAttribute('data-state', 'awaiting_decision')

  await card.getByTestId('permission-allow').click()
  await allowUntilAwaitingInput(SECOND_CARD)

  expect(existsSync(join(puppetRepo, comPortao))).toBe(true)

  // E o outro lado da segunda fonte. Lido só agora, com o turno encerrado: nenhum `init` novo virá
  // depois dele, então o valor na tela é o do turno que acabou de rodar com o portão de volta.
  await expect(card.getByTestId('card-chat-cwd')).toHaveAttribute('data-permission-mode', 'default')
})

/**
 * O card #15 contra o modelo de verdade: a escrita de arquivo mostra o diff dentro da própria
 * entrada da trilha, na conversa, sem painel nenhum ao lado.
 *
 * Os unitários já provam cada metade separada — que `diffOf` conta e numera o patch, que a entrada
 * ao vivo troca `diff: null` pelo diff **antes** do `result` (o roteiro do fake termina no
 * `tool_result`, de propósito) e o que o `ToolEntry` desenha. O que só existe aqui é o patch vir do
 * SDK de verdade: nenhum `structuredPatch` deste passo foi escrito por nós.
 *
 * **Ele opera o `SECOND_CARD`, e fica no fim do arquivo** — a mesma amarra que o passo do #10
 * documenta logo acima, e pelo mesmo motivo: dois testes lá em cima fixam a contagem de mensagens
 * do `CHAT_CARD`, e um turno novo naquele cartão os quebraria por uma razão que não diz nada sobre
 * diff.
 *
 * E ele manda **editar** um arquivo que já existe, em vez de criar um: criação não tem patch nenhum
 * (é o CA-2, medido em 86 resultados de 86) e não produziria `diff-line` alguma.
 */
test('#15 CA-1: a escrita de arquivo mostra o diff na própria entrada da trilha', async () => {
  const card = cardLocator(SECOND_CARD)
  const input = card.getByTestId('card-chat-input')

  // O arquivo que o passo do #10 deixou no repo-fantoche. O nome é repetido aqui, e não hasteado
  // para constante compartilhada, porque o CA-6 desta feature se prova no diff da PR: o que este
  // arquivo ganhou tem de ser só este passo.
  const alvo = 'sem-portao.txt'

  // "Leia … e depois edite" não é rodeio de prompt, é a mesma precaução do `THINKING_PROMPT`: a
  // `Edit` do Claude Code recusa arquivo que a conversa ainda não leu, e sem o pedido explícito da
  // ferramenta o modelo pode chegar ao mesmo fim por `Bash`, que escreve sem `structuredPatch`
  // nenhum — o teste falharia por escolha dele, não por bug do app.
  await input.fill(
    `Leia o arquivo \`${alvo}\` e depois, com a ferramenta Edit, troque o texto OK por TUDO CERTO`,
  )
  await input.press('Enter')

  // O portão voltou no fim do passo acima, e o smoke roda com `OC_ISOLATED=1`: toda ferramenta
  // deste turno passa pelo `canUseTool`, inclusive a leitura.
  await allowUntilAwaitingInput(SECOND_CARD)

  // **A última**, e não a primeira: este cartão já carrega os diffs dos dois `Write` do passo
  // acima, que são criações — `+N` e trecho nenhum (CA-2). A edição é a chamada mais recente, e é
  // ela a única que tem trecho para mostrar.
  const diff = card.getByTestId('tool-diff').last()

  await expect(diff).toBeVisible({ timeout: DECISION_TIMEOUT })

  // O total veio do patch, e não de um zero desenhado: `data-additions` maior que zero é o que
  // separa "a área apareceu" de "a contagem aconteceu". Regex e não número exato pela mesma razão
  // do `data-tokens` do #14 — quanto o modelo mexeu é escolha dele.
  await expect(diff).toHaveAttribute('data-additions', /^[1-9]\d*$/)

  // E o trecho, com a espécie que o core decidiu lendo o prefixo do patch. Uma linha basta: que
  // exista linha nova marcada como nova é o que esta feature promete; quantas, não.
  const linhasNovas = diff.locator('[data-testid="diff-line"][data-diff-kind="add"]')

  await expect(linhasNovas.first()).toBeVisible()
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
      const prompt = cardLocator(card).getByTestId('permission-prompt')

      // O crachá pode dizer `awaiting_decision` com o painel já fora da tela: o clique o esconde na
      // hora e quem o repõe é o `state` seguinte, que vem pela ponte. Nessa janela não há o que
      // decidir — e ler o `data-request` aqui esperaria por um painel que, se o próximo estado for
      // `working`, não volta mais.
      if ((await prompt.count()) === 0) {
        await window.waitForTimeout(POLL_INTERVAL)
        continue
      }

      const anterior = await prompt.getAttribute('data-request')
      await prompt.getByTestId('permission-allow').click()

      // O prompt sai da tela no clique, mas o **estado** pode não mudar: com a fila do #11, o
      // próximo pedido mantém o `data-state` em `awaiting_decision`, e esperar por ele esgotaria o
      // prazo com o app funcionando como a spec manda. O que muda sempre é *qual* pedido está em
      // cartaz — ou não há mais nenhum.
      await expect
        .poll(
          async () =>
            (await prompt.count()) === 0 ? null : await prompt.getAttribute('data-request'),
          { timeout: DECISION_TIMEOUT },
        )
        .not.toBe(anterior)
      continue
    }

    // Poll deliberado: o que se observa aqui é o progresso de um agente externo, e o DOM não tem
    // evento nenhum para assinar enquanto ele pensa.
    await window.waitForTimeout(POLL_INTERVAL)
  }

  throw new Error(`a sessão não devolveu a vez em ${TURN_TIMEOUT} ms`)
}

/**
 * Espera a vez voltar **provando que ela voltou sozinha**: nenhum `permission-prompt` na tela e o
 * cartão sem passar por `awaiting_decision` em leitura nenhuma. É o CA-1 do #10.
 *
 * O gêmeo negativo do `allowUntilAwaitingInput`, e o poll basta aqui — não é uma amostragem que
 * possa perder o instante errado. **Nada resolve um pedido de permissão sem uma pessoa**: se o modo
 * tivesse falhado, o cartão *ficaria* em `awaiting_decision` até o prazo estourar, e não passaria
 * por ele num piscar entre duas leituras. É a ausência de saída automática que transforma um laço
 * de 250 ms em prova.
 */
async function expectTurnWithoutGate(card: FixtureCard): Promise<void> {
  const state = badge(card)
  const prompt = cardLocator(card).getByTestId('permission-prompt')
  const deadline = Date.now() + TURN_TIMEOUT

  while (Date.now() < deadline) {
    const kind = await state.getAttribute('data-state')

    expect(kind, 'o cartão marcado parou para pedir permissão').not.toBe('awaiting_decision')
    expect(await prompt.count(), 'o pedido de permissão apareceu no cartão marcado').toBe(0)

    if (kind === 'awaiting_input') return
    // Sessão morta não devolve vez nenhuma: esperar o prazo inteiro só trocaria o motivo real da
    // falha por um timeout que não explica nada.
    if (kind === 'closed' || kind === 'failed') {
      throw new Error(`a sessão terminou em ${kind} antes de devolver a vez`)
    }

    // Poll deliberado, como no irmão acima: o que se observa é o progresso de um agente externo, e
    // o DOM não tem evento nenhum para assinar enquanto ele pensa.
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
