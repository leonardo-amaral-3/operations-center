import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * O smoke: a fatia vertical inteira, de uma ponta à outra.
 *
 * Ele sobe o app buildado e percorre os cinco passos do CA-2 na ordem. Cada passo cobre um elo
 * diferente da corrente `renderer ↔ main ↔ core ↔ SDK`, e o teste falha se qualquer um quebrar.
 * É o único teste do repo que precisa do Claude Code logado e consome cota — por isso não roda no
 * CI, e por isso o `vitest.config.ts` exclui esta pasta.
 *
 * As âncoras `data-testid` que ele lê são contrato fixado na spec. Se alguma faltar, o bug é do
 * componente: a âncora volta ao nome da spec, nunca o teste ao nome errado.
 */

// `__dirname` e não `import.meta.url`: o Playwright transpila os specs para CommonJS enquanto o
// `package.json` não for `type: module`, e `import.meta` ali é erro de sintaxe.
const REPO_ROOT = join(__dirname, '..', '..')

/** Modelo barato: o smoke roda a cada verificação da fundação, e cota é recurso compartilhado. */
const SMOKE_MODEL = 'haiku'

/** Um turno do modelo, inclusive quando ele decide usar ferramenta. */
const TURN_TIMEOUT = 180_000

/** Depois do clique, voltar a `working` é síncrono no core: o que se espera aqui é só o IPC. */
const DECISION_TIMEOUT = 15_000

/** Intervalo entre duas leituras do estado enquanto a sessão trabalha. */
const POLL_INTERVAL = 250

let app: ElectronApplication
let window: Page
/** A `cwd` da sessão. Temporária porque é aqui que o `smoke.txt` do passo 5 vai parar. */
let workdir: string

test.beforeAll(async () => {
  workdir = mkdtempSync(join(tmpdir(), 'oc-smoke-'))

  app = await electron.launch({
    // O app buildado, resolvido pelo `main` do `package.json`. O `yarn smoke` roda o
    // `electron-vite build` antes justamente para que `out/` exista aqui.
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      // O ambiente é herdado inteiro, e `ANTHROPIC_API_KEY` **não** é removida de propósito. Ela é
      // o objeto da asserção do passo 3: apagá-la aqui garantiria o resultado que o teste deveria
      // estar provando — o falso-verde que este critério existe para evitar. Se a chave estiver no
      // ambiente, o app de fato subiria em billing de API, e o smoke deve dizer isso em vermelho.
      ...inheritedEnv(),
      // Sem carregar as settings pessoais, nenhuma allowlist pode pré-aprovar a ferramenta do
      // passo 5 e fazer o pedido de permissão não aparecer. É o que torna aquele passo
      // determinístico — e, de quebra, o que deixa o smoke barato: a maior parte do custo de uma
      // sessão é carregamento de contexto.
      OC_ISOLATED: '1',
      OC_MODEL: SMOKE_MODEL,
      OC_CWD: workdir,
      // A porta de ambiente que mantém esta fatia alcançável agora que o app abre no kanban. É ela
      // também que impede o smoke de tocar o GitHub: o main só registra o IPC de board no kanban.
      OC_SCREEN: 'chat',
    },
  })

  window = await app.firstWindow()
})

test.afterAll(async () => {
  await app.close()
  // Só depois de o app morrer: enquanto o subprocesso do Claude Code viver, o Windows segura
  // handles na pasta.
  rmSync(workdir, { recursive: true, force: true, maxRetries: 3 })
})

test('a fatia vertical responde, se identifica e pede permissão para escrever', async () => {
  const badge = window.getByTestId('state-badge')
  const input = window.getByTestId('chat-input')
  const assistantMessages = window.locator('[data-testid="message"][data-role="assistant"]')

  // 1 — a janela abre e a tela de chat renderiza.
  await expect(input).toBeVisible()

  // 2 — a mensagem digitada atravessa renderer → main → core → SDK, e a resposta volta renderizada.
  //     A bolha de assistente só existe quando há texto, então vê-la já prova o texto.
  await input.fill('Responda apenas: OK')
  await input.press('Enter')
  await expect(assistantMessages.first()).toBeVisible({ timeout: TURN_TIMEOUT })

  // 3 — o painel de status mostra o `init` da sessão. A espera vem **depois** da primeira resposta
  //     porque o SDK só emite o `init` quando o primeiro turno começa (emenda de 2026-09-05 no
  //     CA-2); esperar por ele antes travaria para sempre.
  const sessionInit = window.getByTestId('session-init')
  await expect(sessionInit).toBeVisible()

  const apiKeySource = await sessionInit.getAttribute('data-api-key-source')
  // A origem precisa existir *e* não ser a chave de API: um atributo vazio passaria na segunda
  // asserção sozinha sem provar nada.
  expect(apiKeySource).toBeTruthy()
  expect(apiKeySource).not.toBe('ANTHROPIC_API_KEY')

  // 4 — fim do turno: `result` de sucesso com a fila vazia devolve a vez ao usuário.
  await expect(badge).toHaveAttribute('data-state', 'awaiting_input', { timeout: TURN_TIMEOUT })

  // 5 — a metade difícil da ponte: uma instrução que exige escrita faz o `canUseTool` disparar.
  await input.fill('Crie um arquivo `smoke.txt` com o texto OK')
  await input.press('Enter')

  await expect(window.getByTestId('permission-prompt')).toBeVisible({ timeout: TURN_TIMEOUT })
  await expect(badge).toHaveAttribute('data-state', 'awaiting_decision')

  // A decisão humana destrava o turno. `working` dura o tempo de a ferramenta rodar e o modelo
  // fechar o turno — segundos —, então a asserção que polla o alcança com folga.
  await window.getByTestId('permission-allow').click()
  await expect(badge).toHaveAttribute('data-state', 'working', { timeout: DECISION_TIMEOUT })

  await allowUntilAwaitingInput(window)

  expect(existsSync(join(workdir, 'smoke.txt'))).toBe(true)
})

/**
 * Permite o que a sessão pedir até ela devolver a vez.
 *
 * O passo 5 pede uma escrita, mas quem decide quantas ferramentas usar para isso é o modelo — ele
 * pode querer olhar a pasta antes de escrever nela, e em modo isolado *toda* ferramenta passa pelo
 * `canUseTool`. Fixar "exatamente um pedido" tornaria o teste refém dessa escolha; o que o critério
 * afirma é que o pedido chega à tela e que a decisão humana destrava o turno, e isso vale para cada
 * um deles.
 */
async function allowUntilAwaitingInput(page: Page): Promise<void> {
  const badge = page.getByTestId('state-badge')
  const deadline = Date.now() + TURN_TIMEOUT

  while (Date.now() < deadline) {
    const state = await badge.getAttribute('data-state')

    if (state === 'awaiting_input') return
    // Sessão morta não devolve vez nenhuma: esperar o prazo inteiro só trocaria o motivo real da
    // falha por um timeout que não explica nada.
    if (state === 'closed' || state === 'failed') {
      throw new Error(`a sessão terminou em ${state} antes de devolver a vez`)
    }

    if (state === 'awaiting_decision') {
      await page.getByTestId('permission-allow').click()
      // O prompt some da tela no clique, mas o estado só muda quando a resposta volta pela ponte.
      // Sem esperar por isso, a volta do laço tentaria clicar num botão que já não existe.
      await expect(badge).not.toHaveAttribute('data-state', 'awaiting_decision', {
        timeout: DECISION_TIMEOUT,
      })
      continue
    }

    // Poll deliberado: o que se observa aqui é o progresso de um agente externo, e o DOM não tem
    // evento nenhum para assinar enquanto ele pensa.
    await page.waitForTimeout(POLL_INTERVAL)
  }

  throw new Error(`a sessão não devolveu a vez em ${TURN_TIMEOUT} ms`)
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
