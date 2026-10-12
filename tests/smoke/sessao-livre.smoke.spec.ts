import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'
import { launchSmokeApp } from './smoke-app'

/**
 * O smoke da sessão livre (#74): conversar com o Claude Code sem card, fechar o app, reabrir e
 * encontrar a mesma conversa.
 *
 * Como o `retomada`, **sobe sessão real: precisa do Claude Code logado e consome cota** — um turno,
 * no modelo barato —, e por isso fica fora do CI. Daí também os mesmos prazos dele.
 *
 * **O diálogo de pasta não é dirigível pelo Playwright**, então o smoke não cria a sessão pelo
 * botão: ele **semeia** `free-sessions.json` e `layout.json` no `stateDir` que ele mesmo cria, antes
 * de abrir o app. O `layout.json` é parte da semente porque o default do painel é fechado — sem
 * `side: { open: true, active }` a aba existiria e não estaria na tela. O que continua real é tudo
 * o que importa para o CA-2: o boot verificando a entrada, o chat subindo a sessão, o `init`
 * gravando o `sessionId` e a retomada relendo o transcript.
 */

/** Um turno do modelo. Generoso porque quem responde é um agente de verdade. */
const TURN_TIMEOUT = 180_000

/** A verificação do boot varre `~/.claude/projects/` antes de a aba poder dizer `recoverable`. */
const BOOT_TIMEOUT = 60_000

const POLL_INTERVAL = 250

const SMOKE_MODEL = 'haiku'

/** De texto puro: com `OC_ISOLATED=1` toda ferramenta pede permissão, e ninguém a destravaria. */
const PROMPT = 'responda só: ok. Não use ferramenta nenhuma.'

const STATE_FILE = 'free-sessions.json'

/** A versão do formato dos dois arquivos; o app lê versão desconhecida como arquivo vazio. */
const STATE_VERSION = 1

const FREE_ID = 'smoke-livre-1'
const TITLE = 'smoke livre'

let app: ElectronApplication
let window: Page
let scenario: string
let state: string
let pasta: string
let sessaoDoPrimeiroCiclo: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  scenario = realpathSync(mkdtempSync(join(tmpdir(), 'oc-livre-')))
  state = join(scenario, 'state')
  pasta = join(scenario, 'pasta-livre')
  mkdirSync(state)
  mkdirSync(pasta)
  mkdirSync(join(scenario, 'projects'))

  writeFileSync(
    join(state, STATE_FILE),
    `${JSON.stringify(
      {
        version: STATE_VERSION,
        sessions: [
          {
            id: FREE_ID,
            title: TITLE,
            cwd: pasta,
            sessionId: null,
            dangerous: false,
            createdAt: new Date(0).toISOString(),
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  writeFileSync(
    join(state, 'layout.json'),
    `${JSON.stringify(
      {
        version: STATE_VERSION,
        dock: { open: false, height: 280, terminals: [], active: null },
        side: { open: true, width: 480, active: FREE_ID },
        lastPreset: null,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
})

/**
 * O `getComputedStyle` do navegador, declarado aqui: o tsconfig que compila os smokes não carrega a
 * lib DOM (mesmo padrão de `kanban.smoke.spec.ts`). O corpo do `evaluate` roda no renderer.
 */
declare function getComputedStyle(element: unknown): { backgroundColor: string }

/** O `background-color` computado, que é o que o #78 compara. */
async function corDeFundo(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor)
}

test.afterAll(async () => {
  await app.close()
  rmSync(scenario, { recursive: true, force: true, maxRetries: 3 })
})

test('o primeiro ciclo de vida: a conversa acontece e o vínculo vai para o disco', async () => {
  await launch()

  const aba = window.getByTestId('free-tab')
  await expect(aba).toHaveCount(1)
  await expect(aba).toContainText(TITLE)
  // Semeada sem conversa: nada a retomar ainda.
  await expect(aba).toHaveAttribute('data-recoverable', 'false')

  await aba.click()

  // #78 CA-2: no painel lateral o chat veste o canvas, o mesmo fundo do cartão aberto.
  expect(
    await corDeFundo(window.getByTestId('card-chat')),
    'o chat do painel não veste o canvas',
  ).toBe(await corDeFundo(window.locator('body')))

  const input = window.getByTestId('card-chat-input')
  await input.fill(PROMPT)
  await input.press('Enter')

  await expect(mensagens('assistant').first()).toBeVisible({ timeout: TURN_TIMEOUT })

  // Lido do arquivo, e não da tela: `sessionId` não tem âncora de DOM e não deve ganhar uma.
  sessaoDoPrimeiroCiclo = await sessaoGravada()
})

test('CA-2: fechar e reabrir devolve a mesma conversa', async () => {
  await app.close()
  await launch()

  const aba = window.getByTestId('free-tab')
  await expect(aba).toHaveCount(1)
  // O crachá de "há o que retomar" só aparece depois de o boot verificar o transcript.
  await expect(aba).toHaveAttribute('data-recoverable', 'true', { timeout: BOOT_TIMEOUT })

  await aba.click()

  // O que foi dito antes do fechamento, relido do transcript em disco: nada disso sobreviveu em
  // memória.
  await expect(mensagens('user').first()).toContainText(PROMPT, { timeout: BOOT_TIMEOUT })
  await expect(mensagens('assistant').first()).toBeVisible()

  // E é a mesma sessão, não uma conversa nova que por acaso tem o mesmo texto na tela.
  expect(await sessaoGravada()).toBe(sessaoDoPrimeiroCiclo)
})

/** O `sessionId` gravado para a sessão semeada, esperando o `init` escrevê-lo. */
async function sessaoGravada(): Promise<string> {
  const deadline = Date.now() + BOOT_TIMEOUT

  while (Date.now() < deadline) {
    const gravado = lerSessionId()
    if (gravado !== null) return gravado

    await window.waitForTimeout(POLL_INTERVAL)
  }

  throw new Error(`o sessionId de ${FREE_ID} não apareceu em ${STATE_FILE} em ${BOOT_TIMEOUT} ms`)
}

function lerSessionId(): string | null {
  try {
    const arquivo = JSON.parse(readFileSync(join(state, STATE_FILE), 'utf8')) as {
      sessions?: { id?: string; sessionId?: string | null }[]
    }
    const entrada = arquivo.sessions?.find((sessao) => sessao.id === FREE_ID)

    return entrada?.sessionId ?? null
  } catch {
    return null
  }
}

function mensagens(role: 'user' | 'assistant'): Locator {
  return window.getByTestId('side-panel').locator(`[data-testid="message"][data-role="${role}"]`)
}

async function launch(): Promise<void> {
  app = await launchSmokeApp({
    stateDir: state,
    env: {
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      OC_CLAUDE_PROJECTS: join(scenario, 'projects'),
      OC_SCREEN: 'kanban',
      OC_ISOLATED: '1',
      OC_MODEL: SMOKE_MODEL,
    },
  })

  window = await app.firstWindow()
}
