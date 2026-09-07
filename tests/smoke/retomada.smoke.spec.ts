import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import {
  BOARDS_FIXTURE_PATH,
  BOARD_FIXTURE_PATH,
  FIRST_BOARD,
  fixtureProject,
} from './boards-fixture'

import { CONVERSABLE_STATIONS, STATUS_FIELD } from '../../src/core/board/query'

/**
 * O smoke da retomada: fechar o app e abrir de novo devolve a conversa do cartão.
 *
 * **Arquivo novo, e não um caso a mais no `card-chat.smoke.spec.ts`.** Aquele é `mode: 'serial'` com
 * **um** app criado no `beforeAll`, e o que este card precisa provar são **dois** ciclos de vida do
 * app — o segundo começando do zero, com nada em memória e só o que ficou em disco. Enfiá-lo lá
 * dentro quebraria a premissa de todos os testes seguintes daquele arquivo.
 *
 * O cenário é o mesmo do cartão-chat — repo-fantoche com `git init` e `origin` de verdade,
 * `OC_CLAUDE_PROJECTS` numa raiz descartável, board vindo da fixture — mais **`OC_STATE_DIR`**
 * dentro da mesma pasta temporária. Sem ela o smoke gravaria o vínculo no `userData` real da
 * máquina, e um teste que suja o app de quem o roda é um teste que ninguém roda duas vezes.
 *
 * Duas coisas que quem mexer aqui precisa saber, e que custam uma tarde para descobrir sozinho:
 *
 * 1. **O transcript do Claude Code não vai para `OC_CLAUDE_PROJECTS`.** Essa variável só troca a
 *    raiz que o `RepoIndex` varre (`src/main/repos.ts`); o subprocesso do SDK escreve em
 *    `~/.claude/projects/` de verdade, e é lá que o `getSessionInfo`/`getSessionMessages` da
 *    retomada vai achá-lo. As duas raízes são diferentes de propósito.
 * 2. **O CA-3 não precisa de sessão real.** Um `sessionId` inventado escrito no arquivo de estado
 *    antes do relançamento prova "o transcript sumiu do disco" de forma determinística, sem gastar
 *    cota e sem tentar falsificar transcript nenhum.
 *
 * Como os outros smokes, ele **sobe sessão real: precisa do Claude Code logado e consome cota** —
 * dois turnos, no modelo barato —, e por isso fica fora do CI.
 *
 * **Nenhum valor esperado é escrito à mão.** Qual cartão conversa e qual recebe o vínculo quebrado
 * saem da fixture, e o `origin` do repo-fantoche é o repositório do cartão que vai conversar.
 */

// `__dirname` e não `import.meta.url`: o Playwright transpila os specs para CommonJS enquanto o
// `package.json` não for `type: module`, e `import.meta` ali é erro de sintaxe.
const REPO_ROOT = join(__dirname, '..', '..')

/**
 * A outra metade da fixture: o conteúdo de cada card, como no `card-chat.smoke.spec.ts`.
 *
 * Ela entrou aqui no merge com o card #13, que fez **todo cartão aberto** ler o conteúdo dele. Sem
 * esta porta o cliente de fixture lança, o `readCard` devolve `ok: false` e o cartão expandido deste
 * smoke desenharia um painel de erro a cada abertura — sem derrubar nenhum passo, porque o que se
 * afirma aqui é a conversa, e por isso mesmo: um erro permanente na tela que nenhum teste vê é
 * exatamente o que esconde o próximo de verdade.
 */
const CARD_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'cards.json')

/** Modelo barato: cota é recurso compartilhado com as sessões de terminal de quem roda isto. */
const SMOKE_MODEL = 'haiku'

/** Um turno do modelo. Generoso porque quem responde é um agente de verdade. */
const TURN_TIMEOUT = 180_000

/**
 * O prazo do que acontece na abertura: a verificação do vínculo gravado varre
 * `~/.claude/projects/` inteiro antes de o crachá poder aparecer.
 */
const BOOT_TIMEOUT = 60_000

/** Intervalo entre duas leituras do arquivo de estado enquanto a sessão nasce. */
const POLL_INTERVAL = 250

/**
 * A palavra que atravessa o fechamento do app.
 *
 * Ela é o CA-2 inteiro: plantada no primeiro ciclo de vida e pedida de volta no segundo, é a única
 * prova de que o Claude enxerga o que foi dito **antes** da reabertura — e não de que uma conversa
 * nova soube responder alguma coisa. Os dois prompts nascem dela, para o valor esperado não ser
 * digitado duas vezes.
 */
const SENHA = 'CARAMBOLA'

/**
 * O primeiro turno. **De texto puro**, como o `LONG_PROMPT` do cartão-chat e pelo mesmo motivo: o
 * smoke roda com `OC_ISOLATED=1`, e ali *toda* ferramenta passa pelo `canUseTool` — um pedido de
 * permissão levaria o cartão a `awaiting_decision` e o teste ficaria esperando um turno que ninguém
 * destravou.
 */
const FIRST_PROMPT = `Guarde a palavra-chave ${SENHA}. Responda apenas: OK. Não use ferramenta nenhuma.`

/** O segundo turno, já no app relançado: só é respondível por quem lembra do primeiro. */
const SECOND_PROMPT =
  'Qual era a palavra-chave que pedi para você guardar? Responda apenas com ela. Não use ' +
  'ferramenta nenhuma.'

/** O arquivo que o app grava dentro do `OC_STATE_DIR`. */
const STATE_FILE = 'conversations.json'

/**
 * A versão do formato do arquivo de estado.
 *
 * É o único valor deste smoke que não sai da fixture nem do app: para **escrever** o vínculo
 * quebrado do CA-3 é preciso falar o formato que o app lê. Importá-lo de `src/main/conversations.ts`
 * arrastaria o `electron` para dentro do spec — o número mora aqui, e o teste do CA-1 quebraria
 * primeiro se ele mudasse.
 */
const STATE_VERSION = 1

/** Um `sessionId` que não existe em `~/.claude/projects/` — o transcript que sumiu do CA-3. */
const SESSAO_FANTASMA = '00000000-0000-4000-8000-000000000000'

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
  id: string
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

/** Um cartão da fixture, no mínimo de que este smoke precisa. */
interface FixtureCard {
  /** O `id` do item no Projects — a chave do vínculo gravado, e o que este smoke escreve e lê. */
  itemId: string
  number: number
  columnId: string
  repository: string
}

/** O arquivo de estado, do jeito que o app o escreve. */
interface StateFile {
  version: number
  cards: Record<string, string>
}

/** O board que o app desenha: o primeiro da ordem da descoberta, derivado da fixture. */
const PROJECT = fixtureProject(FIRST_BOARD.key) as FixtureProject

const COLUMNS = PROJECT.field.options

const CARDS = PROJECT.items.nodes.map(toFixtureCard).filter((card) => card !== null)

/**
 * As colunas que abrem chat, pela lista que o próprio core publica.
 *
 * Aqui a lista serve para **escolher em quem clicar**, e não para afirmar o critério: quem prova a
 * regra é `tests/unit/BoardReader.test.ts`.
 */
const CONVERSABLE_COLUMN_IDS = new Set(
  COLUMNS.filter((column) =>
    CONVERSABLE_STATIONS.some((station) => column.name.includes(station)),
  ).map((column) => column.id),
)

const CONVERSABLE_CARDS = CARDS.filter((card) => CONVERSABLE_COLUMN_IDS.has(card.columnId))

/** O cartão que conversa de verdade — e, por tabela, quem define o `origin` do repo-fantoche. */
const CHAT_CARD = required(CONVERSABLE_CARDS[0], 'cartão nenhum em coluna conversável')

/** O repo que o cenário faz existir nesta máquina. Sai da fixture, não de uma constante. */
const HOME_REPO = CHAT_CARD.repository

/**
 * O cartão do CA-3: recebe um vínculo para uma sessão que não existe.
 *
 * Ele nunca é clicado — o que se afirma dele é a **ausência** do crachá —, então tanto faz se o repo
 * dele existe nesta máquina. Basta não ser o cartão que conversa.
 */
const GHOST_CARD = required(
  CONVERSABLE_CARDS.find((card) => card.itemId !== CHAT_CARD.itemId),
  'um segundo cartão conversável para receber o vínculo quebrado do CA-3',
)

let app: ElectronApplication
let window: Page
/** A raiz descartável do cenário: dentro dela vivem o repo-fantoche, os transcripts e o estado. */
let scenario: string
/** O repo-fantoche — a pasta em que a sessão do cartão sobe, e à qual ela precisa voltar. */
let puppetRepo: string
/** A raiz de transcripts que o `RepoIndex` varre. **Não** é onde o Claude Code escreve. */
let projects: string
/** O `OC_STATE_DIR`: onde o app grava o vínculo `cartão → sessão`. */
let state: string
/** O `session_id` do primeiro ciclo de vida, lido do arquivo. O CA-2 compara com ele no fim. */
let primeiraSessao: string

// Dois ciclos de vida do mesmo app, em ordem: o que um teste deixa em disco é a premissa do
// seguinte. Serial é o que isso já é na prática — e o que faz uma falha parar a fila em vez de
// gastar cota provando de novo a mesma quebra.
test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  // `realpathSync` porque o `cwd` que a sessão vai reportar é o caminho resolvido pelo sistema: em
  // `%TEMP%` com nome curto (8.3) ou com junção pelo meio, comparar o caminho não resolvido daria
  // um vermelho sobre a forma da string, e não sobre a pasta em que a sessão subiu.
  scenario = realpathSync(mkdtempSync(join(tmpdir(), 'oc-retomada-')))
  puppetRepo = join(scenario, 'repo-fantoche')
  projects = join(scenario, 'projects')
  state = join(scenario, 'state')
  const transcripts = join(projects, 'sessao-fantoche')

  mkdirSync(puppetRepo)
  mkdirSync(transcripts, { recursive: true })
  mkdirSync(state)

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
})

test.afterAll(async () => {
  await app.close()
  // Só depois de o app morrer: enquanto os subprocessos do Claude Code viverem, o Windows segura
  // handles nas pastas.
  rmSync(scenario, { recursive: true, force: true, maxRetries: 3 })
})

test('o primeiro ciclo de vida: a conversa acontece, o vínculo vai para o disco, e o app é relançado', async () => {
  await launch()

  // A primeira asserção do arquivo é também a que espera o board carregar: até a leitura terminar,
  // a tela mostra "Lendo o board…" e não existe cartão nenhum.
  await expect(window.getByTestId('board-card')).toHaveCount(CARDS.length)

  // Nada gravado ainda, logo nenhum cartão tem o que retomar. Sem esta linha, o crachá que o CA-1
  // espera depois poderia ser um crachá que já estava lá.
  await expect(window.getByTestId('conversation-badge')).toHaveCount(0)

  await cardLocator(CHAT_CARD).click()
  await expect(cardLocator(CHAT_CARD).getByTestId('card-chat')).toBeVisible()

  const input = cardLocator(CHAT_CARD).getByTestId('card-chat-input')
  await input.fill(FIRST_PROMPT)
  await input.press('Enter')

  await expect(assistantMessages(CHAT_CARD).first()).toBeVisible({ timeout: TURN_TIMEOUT })
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input', {
    timeout: TURN_TIMEOUT,
  })

  // O vínculo, lido **do arquivo** e não da tela: id de sessão não tem uso nenhum no kanban, e não
  // deve ganhar uma âncora de DOM só para um teste poder olhá-lo.
  primeiraSessao = await linkedSession(CHAT_CARD.itemId)

  await app.close()

  // O CA-3, plantado no intervalo entre os dois ciclos: um cartão que nunca conversou passa a
  // apontar para uma sessão que não existe. É o mesmo estado em que o app acordaria se alguém
  // apagasse o transcript com ele fechado — e sai de graça, sem turno nenhum.
  writeLinks({ ...readLinks(), [GHOST_CARD.itemId]: SESSAO_FANTASMA })

  // O segundo ciclo de vida: processo novo, mapas em memória vazios, e em disco só o que o primeiro
  // deixou. É a premissa dos três testes seguintes.
  await launch()
})

test('CA-3: o cartão de vínculo quebrado volta sem crachá, e o board volta inteiro', async () => {
  await expect(window.getByTestId('board-card')).toHaveCount(CARDS.length)

  // A espera pelo crachá do **outro** cartão é o que torna esta afirmação honesta: ela prova que a
  // verificação do boot terminou e já chegou à tela. Sem ela, "o cartão não tem crachá" passaria
  // sozinho, no instante em que nenhum cartão tinha.
  await expect(conversationBadge(CHAT_CARD)).toBeVisible({ timeout: BOOT_TIMEOUT })

  await expect(conversationBadge(GHOST_CARD)).toHaveCount(0)
  // E nada foi inventado no lugar: nem chat aberto, nem sessão viva atrás do cartão fechado.
  await expect(window.getByTestId('card-chat')).toHaveCount(0)
  await expect(badge(GHOST_CARD)).toHaveCount(0)
})

test('CA-1: o cartão volta com o sinal de conversa, e expandido devolve o que foi dito antes', async () => {
  // Colapsado, o cartão diz que há conversa — e **só** isso: sessão viva não há nenhuma, e o crachá
  // de estado é justamente o que separa as duas coisas.
  await expect(conversationBadge(CHAT_CARD)).toBeVisible()
  await expect(badge(CHAT_CARD)).toHaveCount(0)

  await cardLocator(CHAT_CARD).click()
  await expect(cardLocator(CHAT_CARD).getByTestId('card-chat')).toBeVisible()

  // O histórico do ciclo anterior, na ordem em que aconteceu: a primeira fala continua sendo a
  // primeira. Ela veio do transcript em disco — nada dela sobreviveu em memória ao fechamento.
  const mine = userMessages(CHAT_CARD)
  await expect(mine.first()).toContainText(FIRST_PROMPT)
  await expect(assistantMessages(CHAT_CARD).first()).toBeVisible()
})

test('CA-2: a mensagem seguinte continua o mesmo fio, na mesma sessão', async () => {
  const chat = cardLocator(CHAT_CARD)

  // Lida agora e comparada com `+1`: quantas bolhas o turno restaurado deixou é escolha do modelo, e
  // fixar um número aqui seria escrever à mão um valor que o teste pode ler.
  const respostas = await assistantMessages(CHAT_CARD).count()

  const input = chat.getByTestId('card-chat-input')
  await input.fill(SECOND_PROMPT)
  await input.press('Enter')

  await expect(assistantMessages(CHAT_CARD)).toHaveCount(respostas + 1, { timeout: TURN_TIMEOUT })
  await expect(badge(CHAT_CARD)).toHaveAttribute('data-state', 'awaiting_input', {
    timeout: TURN_TIMEOUT,
  })

  // A metade do CA-2 que só o modelo pode responder: a senha foi dita antes de o app fechar, e quem
  // a repete é uma sessão que nasceu depois. Sem `resume`, aqui viria um "não sei".
  await expect(assistantMessages(CHAT_CARD).last()).toContainText(SENHA, { ignoreCase: true })

  // A sessão retomada subiu de verdade, e subiu **na pasta em que a conversa aconteceu**.
  //
  // Aferido **depois** do turno, e não à abertura do cartão: a âncora só existe quando o `init`
  // chega, e o `init` só chega quando o `query()` tem o que consumir — antes da primeira mensagem o
  // cartão mostra "Conectando à sessão do Claude Code…". Medido nesta máquina: esperar por ela antes
  // do envio estoura o prazo sem que nada esteja errado.
  const cwd = chat.getByTestId('card-chat-cwd')
  await expect(cwd).toBeVisible()
  expect(comparablePath(await cwd.textContent())).toBe(comparablePath(puppetRepo))

  // E a outra metade, que o disco responde: é a **mesma** sessão, e não uma conversa nova que por
  // acaso soube a senha. O `remember` reescreve o vínculo a cada `init` — se o SDK tivesse forkado,
  // o id no arquivo seria outro.
  expect(await linkedSession(CHAT_CARD.itemId)).toBe(primeiraSessao)
})

/**
 * Sobe o app com o cenário inteiro ligado e espera a janela.
 *
 * Existe porque este smoke o faz **duas vezes**, com o mesmo ambiente nas duas: é a identidade das
 * variáveis entre os dois ciclos que faz o segundo enxergar o que o primeiro deixou.
 */
async function launch(): Promise<void> {
  app = await electron.launch({
    // O app buildado, resolvido pelo `main` do `package.json`. O `yarn smoke` roda o
    // `electron-vite build` antes justamente para que `out/` exista aqui.
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      // O ambiente é herdado inteiro, e `ANTHROPIC_API_KEY` **não** é removida: é o mesmo trato dos
      // outros smokes, que já afirmam lá que a sessão não sobe em billing de API.
      ...inheritedEnv(),
      // As portas que trocam o GitHub por arquivo: o board deste smoke não toca a rede.
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      // E a do conteúdo do card, pelo mesmo motivo — ver o comentário da constante.
      OC_CARD_FIXTURE: CARD_FIXTURE_PATH,
      // A porta que troca `~/.claude/projects` pela raiz do cenário — só para a **varredura de
      // repos**. O transcript da sessão continua nascendo na raiz de verdade, e é lá que a retomada
      // o procura.
      OC_CLAUDE_PROJECTS: projects,
      // A porta desta feature: sem ela o vínculo iria para o `userData` real da máquina, e o smoke
      // sujaria o app de quem o roda.
      OC_STATE_DIR: state,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell abriria a tela errada e o
      // teste falharia por um motivo que não tem nada a ver com retomada.
      OC_SCREEN: 'kanban',
      // Sem carregar as settings pessoais: é o que mantém os dois turnos baratos e sem allowlist
      // nenhuma influindo no que o modelo pode fazer.
      OC_ISOLATED: '1',
      OC_MODEL: SMOKE_MODEL,
      // A coordenada sai da própria fixture, como nos vizinhos: é o primeiro board da ordem da
      // descoberta, o mesmo que o app escolherá sozinho quando a descoberta virar a fonte.
      // ESTAS DUAS LINHAS MORREM NA TASK 5, junto com o `OC_PROJECT_*`.
      OC_PROJECT_OWNER: FIRST_BOARD.owner,
      OC_PROJECT_NUMBER: String(FIRST_BOARD.number),
    },
  })

  window = await app.firstWindow()
}

/**
 * O `sessionId` gravado para aquele cartão, esperando a gravação acontecer.
 *
 * O `remember` do índice é síncrono para quem chama e **agenda** a escrita; ela acontece no `init`,
 * bem antes de o turno responder, mas nada no DOM sinaliza que o arquivo já está em disco. Poll
 * deliberado, então — e com prazo, para a falha dizer "o vínculo não foi gravado" em vez de estourar
 * o teste inteiro num timeout mudo.
 */
async function linkedSession(itemId: string): Promise<string> {
  const deadline = Date.now() + BOOT_TIMEOUT

  while (Date.now() < deadline) {
    const gravado = readLinks()[itemId]
    if (gravado !== undefined && gravado !== '') return gravado

    await window.waitForTimeout(POLL_INTERVAL)
  }

  throw new Error(
    `o vínculo do cartão ${itemId} não apareceu em ${STATE_FILE} em ${BOOT_TIMEOUT} ms`,
  )
}

/**
 * O vínculo gravado, `itemId → sessionId`.
 *
 * Tolerante do mesmo jeito que o app é: arquivo ausente ou ilegível vira mapa vazio. Quem transforma
 * a ausência em vermelho é o `linkedSession`, que sabe o que estava esperando.
 */
function readLinks(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(join(state, STATE_FILE), 'utf8')) as Partial<StateFile>

    return parsed.cards ?? {}
  } catch {
    return {}
  }
}

/** O arquivo de estado escrito à mão — o único jeito de plantar o vínculo quebrado do CA-3. */
function writeLinks(cards: Record<string, string>): void {
  writeFileSync(
    join(state, STATE_FILE),
    `${JSON.stringify({ version: STATE_VERSION, cards }, null, 2)}\n`,
    'utf8',
  )
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

  return { itemId: node.id, number, columnId, repository: repository?.nameWithOwner ?? '' }
}

/**
 * O que a fixture precisa ter para este smoke fazer sentido.
 *
 * Lança na carga do módulo, de propósito: sem a borda, o teste que dependeria dela passaria a provar
 * outra coisa — e um smoke que muda de assunto em silêncio é pior que um que não roda.
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

function badge(card: FixtureCard): Locator {
  return cardLocator(card).getByTestId('state-badge')
}

function conversationBadge(card: FixtureCard): Locator {
  return cardLocator(card).getByTestId('conversation-badge')
}

function assistantMessages(card: FixtureCard): Locator {
  return cardLocator(card).locator('[data-testid="message"][data-role="assistant"]')
}

function userMessages(card: FixtureCard): Locator {
  return cardLocator(card).locator('[data-testid="message"][data-role="user"]')
}

/**
 * Um caminho na forma em que o sistema de arquivos o compara.
 *
 * O que se afirma é a **pasta**, não a grafia dela: no Windows a caixa não distingue caminho nenhum,
 * e `/` e `\` levam ao mesmo lugar.
 */
function comparablePath(path: string | null): string {
  return (path ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

/**
 * O `process.env` do runner, pronto para o Playwright: passar `env` substitui o ambiente inteiro, e
 * sem `PATH` (e sem `HOME`/`USERPROFILE`, onde vivem as credenciais do Claude Code **e os
 * transcripts que a retomada lê**) o Electron nem subiria. As chaves sem valor caem porque o tipo do
 * Playwright só aceita string.
 */
function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}
