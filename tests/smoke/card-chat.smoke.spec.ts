import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { CONVERSABLE_STATIONS, STATUS_FIELD } from '../../src/core/board/query'
import { THEMES } from '../../src/shared/theme'
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
  fundoEfetivo,
  launchSmokeApp,
  provarSessaoNaPasta,
  xtermDe,
} from './smoke-app'

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
 * cota**. Por isso `OC_MODEL` num modelo barato (vira `--model` no terminal Claude), e por isso ele
 * fica fora do CI. Desde o #97 o cartão aberto é o terminal do Claude Code (xterm), e o smoke o
 * dirige como a pessoa: digita no `textarea` do xterm e lê o texto de `.xterm-rows`.
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

/**
 * O segundo cartão do CA-1, **em outra coluna** — e é a coluna diferente que faz dele o par do
 * RA-1 do card #45: desde ele, abrir este **não** colapsa mais aquele.
 */
const SECOND_CARD = required(
  CONVERSABLE_CARDS.find(
    (card) => card.repository === HOME_REPO && card.columnId !== CHAT_CARD.columnId,
  ),
  'um segundo cartão conversável do mesmo repo em outra coluna',
)

/**
 * O par do RA-2 do card #45: um segundo cartão conversável na **mesma** coluna do `CHAT_CARD`.
 *
 * O board real não tem dois conversáveis juntos, então ele é sintético na fixture (o #904) — e de
 * repo forasteiro de propósito, pela Decisão 5 daquela spec: em coluna conversável do repo-casa,
 * abri-lo subiria uma sessão real só para provar que **outro** cartão colapsou.
 */
const SAME_COLUMN_CARD = required(
  CONVERSABLE_CARDS.find(
    (card) => card.columnId === CHAT_CARD.columnId && card.number !== CHAT_CARD.number,
  ),
  'um segundo cartão conversável na MESMA coluna do primeiro',
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

/**
 * A régua contra a qual se mede a coluna alargada do RA-1: uma coluna **sem cartão nenhum**.
 *
 * Sem cartão ela não tem como hospedar, hoje nem depois — e é isso que a torna régua. Escolher uma
 * coluna qualquer "que por acaso está fechada" amarraria a medida à ordem em que os testes deste
 * arquivo abrem e fecham cartão, que é justamente o que o `mode: 'serial'` já torna frágil demais.
 */
const IDLE_COLUMN = required(
  COLUMNS.find((column) => !CARDS.some((card) => card.columnId === column.id)),
  'uma coluna sem cartão nenhum (a régua da largura do RA-1)',
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

  app = await launchSmokeApp({
    // A pasta de estado do próprio app, apontada para o cenário por duas razões independentes.
    //
    // A que o #10 obriga: a marca do modo é durável, e sem ela uma marca sobrevivente de uma
    // rodada anterior faria o último teste deste arquivo começar com o modo já ligado — ele
    // provaria que desligar funciona, e não que ligar funciona.
    //
    // E a que já valia antes dele: sem ela, este smoke escreve o `conversations.json` no `userData`
    // real da máquina de quem o roda. Um vazamento pequeno, mas que não tem defensor.
    stateDir,
    env: {
      // As portas que trocam o GitHub por arquivo: o board deste smoke não toca a rede.
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      // E a do conteúdo do card, pelo mesmo motivo — e obrigatória: ver o comentário da constante.
      OC_CARD_FIXTURE: CARD_FIXTURE_PATH,
      // A porta que troca `~/.claude/projects` pela raiz do cenário. É ela que torna a descoberta
      // determinística sem substituir nenhuma peça dela.
      OC_CLAUDE_PROJECTS: projects,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell abriria a tela errada e o
      // teste falharia por um motivo que não tem nada a ver com o cartão-chat.
      OC_SCREEN: 'kanban',
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
  await expect(window.getByTestId('claude-terminal')).toHaveCount(0)

  // Colapsado, o cartão só mostra o sinal de estado quando existe sessão viva atrás dele. A
  // ausência do sinal é a prova de que nenhuma nasceu — o `start` respondeu, e respondeu "não sei".
  await cardLocator(OUTSIDER_CARD).getByTestId('card-collapse').click()
  await expect(cardLocator(OUTSIDER_CARD).getByTestId('state-badge')).toHaveCount(0)
})

test('CA-1 e CA-2: o cartão vira chat no próprio lugar, e a sessão responde', async () => {
  await cardLocator(CHAT_CARD).click()

  // Dentro do cartão, dentro da coluna daquele `columnId` — não em modal, não em outra tela. E um
  // só no kanban inteiro, que é a outra metade do RF-6.
  await expect(cardLocator(CHAT_CARD).getByTestId('claude-terminal')).toBeVisible()
  await expect(columnLocator(CHAT_CARD.columnId).getByTestId('claude-terminal')).toHaveCount(1)
  await expect(window.getByTestId('claude-terminal')).toHaveCount(1)

  // O estado ao abrir (`starting` na sonda do #80) não se afirma: a corrida com o `init` não é
  // deste critério.
  await barraSemSobreposicao(CHAT_CARD, 'aberto, ao abrir')

  // Digitar no xterm: a pergunta atravessa renderer → main → PTY → Claude Code, e a resposta (`42`,
  // que não está no texto enviado) volta desenhada na tela do terminal e no selo do hook `Stop`.
  await digitarNoTerminal(terminalDe(CHAT_CARD), PERGUNTA_17_25)
  await expect(xtermDe(terminalDe(CHAT_CARD))).toContainText(RESPOSTA_42, { timeout: TURN_TIMEOUT })
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input', {
    timeout: TURN_TIMEOUT,
  })

  await barraSemSobreposicao(CHAT_CARD, 'aberto, sua vez')

  // O CA-3 do card #8, de carona nesta sessão viva: a borda de 2px e a sombra de 4px do design
  // system comem largura útil dentro da coluna de 36rem (`Column.tsx:95`), e o sinal de estado é o
  // que mais cresce aqui dentro. **Nos quatro lados**, e não só pela direita: na barra de ações ele
  // divide a linha com até cinco botões, e um estouro por cima ou por baixo seria clipado pelo scroll do mesmo jeito.
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
  // O transcript da sessão nasce na pasta em que o processo de fato subiu: é a `cwd` real, e não um
  // rótulo que o renderer montou. O cabeçalho da TUI não prova isso, porque encurta o caminho.
  await provarSessaoNaPasta(puppetRepo)
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
  await expect(terminalDe(CHAT_CARD)).toBeVisible()

  // Recolher a seção e recarregá-la são os dois gestos que mexem no conteúdo. Nenhum deles pode
  // mexer na sessão — e o estado do badge é onde isso apareceria primeiro.
  await card.getByTestId('card-content-toggle').click()
  await expect(card.getByTestId('card-content-body')).toHaveCount(0)

  const reload = card.getByTestId('card-content-reload')

  await reload.click()
  // O ⟳ volta a si quando a leitura aterrissa: esperar por isso é esperar a recarga **inteira**, e
  // não só o clique — sem essa espera a asserção abaixo leria o badge antes de a resposta chegar.
  await expect(reload).toBeEnabled()

  // A mesma instância do xterm: a resposta de antes do recarregar segue na tela.
  await expect(terminalDe(CHAT_CARD)).toBeVisible()
  await expect(xtermDe(terminalDe(CHAT_CARD))).toContainText(RESPOSTA_42)
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input')
})

/**
 * O que o renderer estático não prova: o gesto, o `Esc` e a ausência de remonte. Se o expandir
 * remontasse o `Chat`, o rascunho e a releitura do conteúdo seriam os dois primeiros a denunciar.
 */
test('#28 CA-1 e CA-2: expandir cobre a tela, e Esc devolve o cartão com rascunho, histórico e sessão', async () => {
  const card = cardLocator(CHAT_CARD)
  // A resposta de antes de expandir: se o expandir remontasse o terminal, ela sumiria da tela.
  await expect(xtermDe(terminalDe(CHAT_CARD))).toContainText(RESPOSTA_42)

  await card.getByTestId('card-maximize').click()

  // Cobre a área das colunas inteira, ±1px nos quatro lados. O cabeçalho e a faixa de conversas
  // ficam fora dela (#100): expandido, o cartão não esconde o caminho para o próximo card.
  const tela = await caixaDe(window.getByTestId('kanban-area'), 'a área das colunas')
  const cobre = await caixaDe(card, 'o cartão expandido')
  expect(Math.abs(cobre.x - tela.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(cobre.y - tela.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(cobre.width - tela.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(cobre.height - tela.height)).toBeLessThanOrEqual(1)

  await barraSemSobreposicao(CHAT_CARD, 'expandido, sua vez')

  // A seção estava recolhida (há sessão viva) e abriu sozinha, sem o teto de 26rem.
  const corpo = card.getByTestId('card-content-body')
  await expect(corpo).toBeVisible()
  expect(await corpo.getAttribute('class')).not.toContain('max-h-[26rem]')
  expect((await caixaDe(corpo, 'o corpo do conteúdo')).height).toBeGreaterThan(416)

  // O Esc é disparado FORA do terminal: dentro dele a tecla é da CLI (P18), que a usa para
  // interromper o turno. O foco vai para um botão do próprio cartão.
  await card.getByTestId('card-content-toggle').focus()
  await window.keyboard.press('Escape')

  expect(await card.getAttribute('class')).not.toContain('absolute')
  const volta = await caixaDe(card, 'o cartão recolhido')
  const coluna = await caixaDe(columnLocator(CHAT_CARD.columnId), 'a coluna do cartão')
  expect(volta.x).toBeGreaterThanOrEqual(coluna.x - 1)
  expect(volta.y).toBeGreaterThanOrEqual(coluna.y - 1)
  expect(volta.x + volta.width).toBeLessThanOrEqual(coluna.x + coluna.width + 1)
  // Na vertical só o topo: a seção de conteúdo segue aberta ao recolher (só o expandir a abre), o
  // cartão passa da altura da coluna de 760px, e é a lista dela que rola. O `scrollIntoView`
  // `nearest` garante o topo à vista.
  expect(volta.y).toBeLessThan(coluna.y + coluna.height)

  // Nada remontou: o texto de antes segue no xterm, a sessão no mesmo estado, o conteúdo não relido.
  await expect(xtermDe(terminalDe(CHAT_CARD))).toContainText(RESPOSTA_42)
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input')
  await expect(card.getByTestId('card-content-reload')).toBeEnabled()
  await expect(card.getByText('Lendo o card…')).toHaveCount(0)

  // Devolve o cartão como o #13 CA-5 o deixou, para os testes seguintes.
  await card.getByTestId('card-content-toggle').click()
  await expect(card.getByTestId('card-content-body')).toHaveCount(0)
})

test('#28 CA-4: o botão recolhe, e fechar o cartão expandido não o reabre expandido', async () => {
  const card = cardLocator(CHAT_CARD)
  const botao = card.getByTestId('card-maximize')

  await botao.click()
  expect(await card.getAttribute('class')).toContain('absolute')
  await botao.click()
  expect(await card.getAttribute('class')).not.toContain('absolute')

  await botao.click()
  await card.getByTestId('card-collapse').click()
  await expect(card.getByTestId('card-collapse')).toHaveCount(0)

  // Reabrir pelo clique no cartão: volta no lugar, aberto e não expandido.
  await card.click()
  await expect(card.getByTestId('card-maximize')).toHaveAttribute('aria-pressed', 'false')
  expect(await card.getAttribute('class')).not.toContain('absolute')
  // Há sessão viva, então a seção de conteúdo nasce recolhida (`CardContent.tsx:44`).
  await expect(card.getByTestId('card-content-body')).toHaveCount(0)
  // Colapsar fecha a vista, não a conversa: o xterm volta com o que já tinha.
  await expect(xtermDe(terminalDe(CHAT_CARD))).toContainText(RESPOSTA_42)
})

/**
 * O #78: o chat se separa do conteúdo pela cor. Sem fundo próprio, o `card-chat` herdava a face do
 * cartão e ficava "tudo junto e grudado"; agora ele veste o canvas (o `body`), nas três combinações,
 * no cartão aberto e no expandido.
 *
 * A troca é por `data-theme` no `<html>`, e não pelo `theme-option`: o trilho do tema já é provado em
 * `tema.smoke.spec.ts`, e aqui só interessa a cascata, que resolve nesse atributo.
 */
test('#78 CA-1 e CA-2: o chat veste o canvas, e não a face, nas três combinações', async () => {
  const card = cardLocator(CHAT_CARD)
  if ((await card.getByTestId('claude-terminal').count()) === 0) await card.click()

  const html = window.locator('html')
  const original = await html.getAttribute('data-theme')
  type Raiz = {
    setAttribute(nome: string, valor: string): void
    removeAttribute(nome: string): void
  }

  const medir = async (): Promise<void> => {
    for (const tema of THEMES) {
      await html.evaluate((raiz: Raiz, valor) => raiz.setAttribute('data-theme', valor), tema)
      await expect(html).toHaveAttribute('data-theme', tema)

      const chat = await fundoEfetivo(card.getByTestId('claude-terminal'))
      const face = await corDeFundo(card)
      const canvas = await corDeFundo(window.locator('body'))
      expect(chat, `na ${tema}, o chat tem o fundo da face do cartão`).not.toBe(face)
      expect(chat, `na ${tema}, o chat não tem o fundo do canvas`).toBe(canvas)
    }
  }

  try {
    await medir()
    await card.getByTestId('card-maximize').click()
    await medir()
    await card.getByTestId('card-maximize').click()
  } finally {
    await html.evaluate(
      (raiz: Raiz, valor) =>
        valor === null
          ? raiz.removeAttribute('data-theme')
          : raiz.setAttribute('data-theme', valor),
      original,
    )
  }
})

/**
 * A reescrita deliberada do teste do CA-4 do #6.
 *
 * Aquele teste afirmava duas coisas: que o clique não abre chat, e que o cartão-chat **continua
 * aberto** atrás dele. A segunda caiu quando o #13 fez todo cartão abrir — um cartão por vez
 * (RF-6), e o inerte passou a ser um cartão. O #45 a devolve por outro caminho: a regra agora é um
 * por **coluna**, e o inerte está numa coluna que não é a do `CHAT_CARD`, então ninguém colapsa.
 *
 * A primeira metade nunca mudou, e é o que o CA-3 do #13 herda: ali nenhuma sessão sobe.
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

  // E nada de sessão **aqui**. O cartão-chat do `CHAT_CARD`, esse continua na tela: outra coluna, e
  // desde o #45 abrir um cartão só fecha os abertos da mesma coluna dele.
  await expect(cardLocator(INERT_CARD).getByTestId('claude-terminal')).toHaveCount(0)
  await expect(cardLocator(CHAT_CARD).getByTestId('claude-terminal')).toBeVisible()

  // Um no kanban inteiro, e não dois: o cartão inerte abriu sem subir sessão nenhuma. É a metade do
  // critério que sobreviveu à emenda do #13, agora afirmada por contagem em vez de por colapso.
  await expect(window.getByTestId('claude-terminal')).toHaveCount(1)

  // E aquela sessão segue viva, com a conversa onde estava — o clique noutra coluna não a tocou.
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input')
  await expect(xtermDe(terminalDe(CHAT_CARD))).toContainText(RESPOSTA_42)
})

test('CA-1 e CA-6: o segundo cartão sobe em outra coluna, e a sessão do primeiro continua viva', async () => {
  await cardLocator(SECOND_CARD).click()

  await expect(cardLocator(SECOND_CARD).getByTestId('claude-terminal')).toBeVisible()
  await expect(columnLocator(SECOND_CARD.columnId).getByTestId('claude-terminal')).toHaveCount(1)
  await expect(window.getByTestId('claude-terminal')).toHaveCount(2)

  // Aberto — e vivo. O #45 tirou o colapso daqui, mas não o que o CA-6 afirma: a sessão do vizinho
  // atravessa o clique intacta, e o sinal de estado é onde isso apareceria primeiro. Quem prova o
  // CA-6 com o cartão **fechado** é agora o teste do RA-2, logo abaixo.
  await expect(cardLocator(CHAT_CARD).getByTestId('claude-terminal')).toBeVisible()
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input')

  // E é a mesma conversa, não uma sessão nova: a resposta que o `CHAT_CARD` deu continua no xterm.
  await expect(xtermDe(terminalDe(CHAT_CARD))).toContainText(RESPOSTA_42)
})

/**
 * O RA-1 do card #45, de carona nos dois cartões que o teste acima deixou abertos — e **sem gastar
 * um turno**: o que ele afirma é contagem e geometria, e as duas já estão na tela.
 *
 * A largura não é enfeite do critério. `hosting` é decidido dentro de cada `Column`, sobre os
 * cartões dela, e é ele que troca `w-72` por `w-[34rem]`: duas colunas largas ao mesmo tempo é a
 * prova de que o estado plural chegou ao **layout**, e não só ao reducer.
 *
 * "Ao mesmo tempo" é sobre estado, e não sobre caber na janela — duas colunas hospedeiras somam
 * mais que a largura dela. É por isso que a medida é de caixa, e não de captura de tela.
 */
test('#45 RA-1: dois cartões de colunas diferentes ficam abertos, e as duas colunas alargam', async () => {
  await expect(window.getByTestId('claude-terminal')).toHaveCount(2)
  await expect(columnLocator(CHAT_CARD.columnId).getByTestId('claude-terminal')).toHaveCount(1)
  await expect(columnLocator(SECOND_CARD.columnId).getByTestId('claude-terminal')).toHaveCount(1)

  const primeira = await caixaDe(
    columnLocator(CHAT_CARD.columnId),
    `a coluna do cartão #${CHAT_CARD.number}`,
  )
  const segunda = await caixaDe(
    columnLocator(SECOND_CARD.columnId),
    `a coluna do cartão #${SECOND_CARD.number}`,
  )
  const regua = await caixaDe(columnLocator(IDLE_COLUMN.id), `a coluna ${IDLE_COLUMN.name}`)

  expect(primeira.width, 'a coluna do primeiro cartão aberto não alargou').toBeGreaterThan(
    regua.width,
  )
  expect(segunda.width, 'a coluna do segundo cartão aberto não alargou').toBeGreaterThan(
    regua.width,
  )
})

/**
 * O RA-2 do card #45: dentro da coluna a regra antiga continua valendo — e vale **só** ali.
 *
 * O `SAME_COLUMN_CARD` é de repo forasteiro (Decisão 5): ele para no pedido da pasta e não sobe
 * sessão nenhuma. É o bastante, e é a economia — o que o critério precisa provar é que o
 * cartão-chat do vizinho **some** e o crachá dele **fica**, e nada disso pede uma segunda conversa.
 *
 * O clique do fim não é zelo, é a premissa do resto do arquivo: os testes abaixo escrevem no
 * `CHAT_CARD`, e a caixa de escrever só existe com ele aberto. Reabri-lo é a mesma regra rodando na
 * direção contrária — e, de quebra, a prova de que a conversa voltou inteira.
 */
test('#45 RA-2: o cartão da mesma coluna fecha o vizinho dela, e só ele', async () => {
  await cardLocator(SAME_COLUMN_CARD).click()

  // Abriu, e abriu inteiro: o pedido da pasta é o fim da linha para um repo que não existe aqui, e
  // o corpo do conteúdo é o que pega envelope faltando em `cards.json` — sem ele o despacho lança e
  // o cartão vira erro na tela em vez de cartão.
  await expect(cardLocator(SAME_COLUMN_CARD).getByTestId('choose-folder')).toBeVisible()
  await expect(cardLocator(SAME_COLUMN_CARD).getByTestId('card-content-body')).toBeVisible()

  // O vizinho da **mesma** coluna colapsou — e a sessão dele não foi junto. O sinal no cartão
  // fechado é o CA-6 do #6, e é ele que separa colapsar de encerrar.
  await expect(cardLocator(CHAT_CARD).getByTestId('claude-terminal')).toHaveCount(0)
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input')

  // E ninguém de fora se mexeu: o `SECOND_CARD` está noutra coluna e continua aberto, com a sessão
  // dele à mostra. É esta linha que separa o RA-2 da regra antiga, que fechava o kanban inteiro.
  await expect(cardLocator(SECOND_CARD).getByTestId('claude-terminal')).toBeVisible()
  await expect(window.getByTestId('claude-terminal')).toHaveCount(1)

  await cardLocator(CHAT_CARD).click()

  // De volta, com a conversa de sempre — e o cartão da mesma coluna fechado pela mesma regra, agora
  // do outro lado.
  await expect(cardLocator(CHAT_CARD).getByTestId('claude-terminal')).toBeVisible()
  await expect(cardLocator(SAME_COLUMN_CARD).getByTestId('choose-folder')).toHaveCount(0)
  await expect(xtermDe(terminalDe(CHAT_CARD))).toContainText(RESPOSTA_42)
  await expect(window.getByTestId('claude-terminal')).toHaveCount(2)
})

test('CA-6: encerrar é ação minha — o botão mata a sessão e o terminal reabre vazio', async () => {
  await cardLocator(CHAT_CARD).getByTestId('card-end-session').click()

  // O selo da conversa encerrada some. Reaberto, o terminal novo ainda não recebeu hook nenhum, e o
  // máximo que o selo pode dizer é `starting`: o que ele não pode é seguir em `awaiting_input`.
  await expect
    .poll(
      async () =>
        (await badge(CHAT_CARD).count()) === 0
          ? 'ausente'
          : await badge(CHAT_CARD).getAttribute('data-state'),
      { message: 'o selo da conversa encerrada não saiu', timeout: DECISION_TIMEOUT },
    )
    .toMatch(/^(ausente|starting)$/)

  // E o xterm é outro: a resposta da conversa que acabou não está mais nele.
  await expect(xtermDe(terminalDe(CHAT_CARD))).not.toContainText(RESPOSTA_42)
})

/**
 * O card #10 no terminal Claude (#97): a marca de perigo liga e desliga com o terminal vivo, e o
 * terminal avisa que ela só vale na próxima abertura (decisão 8 da spec do #97).
 *
 * Ele opera o `SECOND_CARD`, que continua **aberto** desde o teste em que subiu — clicar nele
 * fecharia o cartão. Não conversa com o modelo: o que se prova é o crachá e o aviso, e os dois
 * já estão na tela.
 */
test('#10: a marca de perigo vale na próxima abertura, e o terminal avisa', async () => {
  const card = cardLocator(SECOND_CARD)

  await expect(card.getByTestId('claude-terminal')).toBeVisible()
  await expect(card.getByTestId('danger-badge')).toHaveCount(0)
  await expect(card.getByTestId('danger-next-open')).toHaveCount(0)

  await card.getByTestId('card-danger-toggle').click()

  // O crachá é o retrato **publicado de volta** pelo main — o renderer não tem estado otimista. E o
  // aviso é a outra metade: o processo nasceu sem a marca e segue sem ela até a próxima abertura.
  await expect(card.getByTestId('danger-badge')).toBeVisible({ timeout: DECISION_TIMEOUT })
  await expect(card.getByTestId('danger-next-open')).toBeVisible({ timeout: DECISION_TIMEOUT })

  // Desligar volta a bater com o modo em que o processo abriu: o crachá e o aviso saem juntos.
  await card.getByTestId('card-danger-toggle').click()
  await expect(card.getByTestId('danger-badge')).toHaveCount(0, { timeout: DECISION_TIMEOUT })
  await expect(card.getByTestId('danger-next-open')).toHaveCount(0, { timeout: DECISION_TIMEOUT })
})

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

/**
 * O `getComputedStyle` do navegador, declarado aqui: o tsconfig que compila os smokes não carrega a
 * lib DOM (mesmo padrão de `kanban.smoke.spec.ts`). O corpo do `evaluate` roda no renderer.
 */
declare function getComputedStyle(element: unknown): { backgroundColor: string }

/** O `background-color` computado, que é o que o #78 compara. */
async function corDeFundo(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor)
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

/** O corpo do terminal Claude do cartão — a raiz onde o xterm vive. */
function terminalDe(card: FixtureCard): Locator {
  return cardLocator(card).getByTestId('claude-terminal')
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
 * O #80: a barra de ações do chat mostra o selo inteiro e deixa todo botão acionável, nos três
 * temas. Mede por retângulo (`getBoundingClientRect`) e por acerto (`elementFromPoint`): a
 * interseção prova «sem sobreposição», e o acerto central prova que nenhuma camada cobre o botão —
 * a metade do critério que um retângulo sozinho não vê.
 *
 * O botão desabilitado fica fora do teste de acerto: `ui/button.tsx` aplica
 * `disabled:pointer-events-none`, então o ponto atravessa o botão por desenho (Decisão 11 do #27).
 * Ele continua obrigado a ficar dentro da barra e sem cobrir o selo.
 */
async function barraSemSobreposicao(card: FixtureCard, onde: string): Promise<void> {
  const barra = cardLocator(card).getByTestId('claude-terminal-bar')
  await expect(barra).toBeVisible()
  // `elementFromPoint` só enxerga o que está na viewport.
  await barra.scrollIntoViewIfNeeded()

  const html = window.locator('html')
  const original = await html.getAttribute('data-theme')
  type Raiz = {
    setAttribute(nome: string, valor: string): void
    removeAttribute(nome: string): void
  }
  type Retangulo = { left: number; right: number; top: number; bottom: number }
  // O tsconfig dos testes não tem a lib `dom`: o pedaço do DOM que a medição toca vai tipado à mão.
  type No = {
    getBoundingClientRect(): Retangulo & { width: number; height: number }
    getAttribute(nome: string): string | null
    textContent: string | null
    scrollWidth: number
    clientWidth: number
    disabled: boolean
    children: ArrayLike<No>
    ownerDocument: {
      elementFromPoint(x: number, y: number): No | null
      defaultView: { innerWidth: number } | null
    }
    querySelector(seletor: string): No | null
    querySelectorAll(seletor: string): ArrayLike<No>
    closest(seletor: string): No | null
  }

  try {
    for (const tema of THEMES) {
      await html.evaluate((raiz: Raiz, valor) => raiz.setAttribute('data-theme', valor), tema)
      await expect(html).toHaveAttribute('data-theme', tema)

      const medida = await barra.evaluate((el: No) => {
        const retangulo = (e: No): Retangulo => {
          const r = e.getBoundingClientRect()
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
        }
        const centro = (e: No): No | null => {
          const r = e.getBoundingClientRect()
          return e.ownerDocument.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        }
        const selo = el.querySelector('[data-testid="state-badge"]')

        return {
          janela: el.ownerDocument.defaultView?.innerWidth ?? -1,
          barra: retangulo(el),
          filhos: Array.from(el.children).map(retangulo),
          selo:
            selo === null
              ? null
              : {
                  ...retangulo(selo),
                  scrollWidth: selo.scrollWidth,
                  clientWidth: selo.clientWidth,
                  acertou: centro(selo) === selo,
                },
          botoes: Array.from(el.querySelectorAll('button')).map((b) => ({
            id: b.getAttribute('data-testid') ?? b.textContent ?? '?',
            disabled: b.disabled,
            ...retangulo(b),
            acertou: centro(b)?.closest('button') === b,
          })),
        }
      })

      const em = `${onde}, no tema ${tema}`
      const { barra: caixa, selo, botoes, janela } = medida
      // Diagnóstico da falha intermitente do CA-2 (#80): em que largura de janela e de barra ela veio.
      const diag = `janela ${janela}px, barra ${caixa.left.toFixed(1)}–${caixa.right.toFixed(1)}`
      const area = (a: Retangulo, b: Retangulo): number =>
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

      expect(selo, `CA-1, ${em}: a barra não tem selo de estado`).not.toBeNull()
      if (selo === null) continue

      // CA-1: o selo inteiro, sem sobreposição.
      for (const b of botoes) {
        expect(area(selo, b), `CA-1, ${em}: o selo é coberto por «${b.id}»`).toBeLessThanOrEqual(
          0.5,
        )
      }
      expect(selo.scrollWidth, `CA-1, ${em}: o selo está truncado`).toBeLessThanOrEqual(
        selo.clientWidth,
      )
      expect(selo.acertou, `CA-1, ${em}: o ponto central do selo devolve outro elemento`).toBe(true)

      // CA-2: tudo dentro da barra, tudo acionável.
      const dentro = (r: Retangulo, quem: string): void => {
        expect(
          r.left,
          `CA-2, ${em}: «${quem}» vaza pela esquerda (${diag}; ${r.left.toFixed(1)}–${r.right.toFixed(1)})`,
        ).toBeGreaterThanOrEqual(caixa.left - 0.5)
        expect(
          r.right,
          `CA-2, ${em}: «${quem}» vaza pela direita (${diag}; ${r.left.toFixed(1)}–${r.right.toFixed(1)})`,
        ).toBeLessThanOrEqual(caixa.right + 0.5)
      }
      medida.filhos.forEach((f, i) => dentro(f, `filho ${i} da barra`))
      for (const b of botoes) {
        dentro(b, b.id)
        expect(b.right - b.left, `CA-2, ${em}: «${b.id}» sem largura`).toBeGreaterThan(0)
        if (!b.disabled) {
          expect(b.acertou, `CA-2, ${em}: o centro de «${b.id}» está coberto`).toBe(true)
        }
      }
    }
  } finally {
    await html.evaluate(
      (raiz: Raiz, valor) =>
        valor === null
          ? raiz.removeAttribute('data-theme')
          : raiz.setAttribute('data-theme', valor),
      original,
    )
  }
}
