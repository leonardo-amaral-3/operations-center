import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SettingSource } from '@anthropic-ai/claude-agent-sdk'
import { app, BrowserWindow, powerMonitor } from 'electron'

import { BoardReader, SessionHost } from '../core'
import type { GraphQLFn } from '../core'
import type { Screen } from '../shared/ipc'
import { registerBoardIpc } from './board'
import type { BoardIpcOptions } from './board'
import { createFixtureGraphQL } from './github/fixture'
import { createGitHubGraphQL } from './github/graphql'
import { createGhTokenSource } from './github/token'
import { registerSessionIpc } from './ipc'

/**
 * A pasta de trabalho da sessão. Sem `OC_CWD`, é a raiz do repo — o app aberto sobre si mesmo, que
 * é o que faz `yarn dev` ser útil no primeiro segundo. O smoke aponta para um diretório temporário.
 */
function resolveCwd(): string {
  return process.env.OC_CWD ?? app.getAppPath()
}

/** `OC_MODEL` vazia é o mesmo que ausente: quem decide o modelo passa a ser o Claude Code. */
function resolveModel(): string | undefined {
  return process.env.OC_MODEL || undefined
}

/**
 * `OC_ISOLATED=1` derruba as fontes de configuração para `[]`.
 *
 * Existe para o smoke: sem carregar as settings pessoais, nenhuma allowlist pode pré-aprovar a
 * ferramenta e fazer o pedido de permissão não aparecer — um falso-verde silencioso. Fora do smoke
 * a variável não deve ser usada: uma sessão sem `CLAUDE.md` é um Claude Code amputado, e é por isso
 * que ausente significa "vale o default do `SessionHost`", não "isolada".
 */
function resolveSettingSources(): SettingSource[] | undefined {
  return process.env.OC_ISOLATED === '1' ? [] : undefined
}

/**
 * Qual tela o app abre. `OC_SCREEN=chat` é porta de ambiente sem representação na UI: existe para o
 * smoke da fatia vertical continuar provando renderer ↔ main ↔ core ↔ SDK. Qualquer outro valor
 * abre o kanban, que é o app.
 */
function resolveScreen(): Screen {
  return process.env.OC_SCREEN === 'chat' ? 'chat' : 'kanban'
}

/** Qual board ler. O default é o Operations Center; o mesmo binário serve outro board pelo ambiente. */
function resolveBoard(): BoardIpcOptions {
  const raw = process.env.OC_PROJECT_NUMBER
  const number = raw === undefined || raw === '' ? 2 : Number(raw)

  // Valor inválido **lança**, em vez de cair no default: abrir o board 2 com toda a confiança do
  // mundo quando pediram outro é o pior modo de falha que existe aqui.
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`OC_PROJECT_NUMBER inválido: ${String(raw)}`)
  }

  return { owner: process.env.OC_PROJECT_OWNER || 'leonardo-amaral-3', number }
}

/**
 * Qual cliente o `core` recebe. `OC_BOARD_FIXTURE` é a porta do smoke: com ela o app lê um arquivo e
 * não toca a rede; sem ela, é o GitHub de verdade, com o token do `gh`.
 */
function createGraphQL(): GraphQLFn {
  const fixture = process.env.OC_BOARD_FIXTURE

  return fixture ? createFixtureGraphQL(fixture) : createGitHubGraphQL(createGhTokenSource())
}

const screen = resolveScreen()

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    title: 'Operations Center',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Como o preload sabe qual tela desenhar. É o mecanismo documentado do Electron para passar
      // dados ao preload e funciona com `sandbox: true` — ler `process.env` lá dentro não.
      additionalArguments: [`--oc-screen=${screen}`],
      // O renderer nunca vê Node. Toda capacidade dele passa pelo contrato do preload.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Devolvida porque é nela que o gatilho de foco se pendura — o observador do board precisa de uma
  // referência à janela, e sem isto não haveria onde.
  return window
}

// O main é dono do `core`: é ele que tem o `query` do SDK, o ambiente e o processo Node. O host é
// criado antes da janela para que nenhum `invoke` chegue a um canal ainda não registrado.
const host = new SessionHost({
  query,
  model: resolveModel(),
  settingSources: resolveSettingSources(),
})

const sessionIpc = registerSessionIpc(host, { cwd: resolveCwd() })

// **O IPC de board só é registrado no kanban.** Assim o smoke da fatia vertical (`OC_SCREEN=chat`)
// não tem como tocar o GitHub nem por acidente: o determinismo dele fica garantido por construção,
// e não por disciplina de quem escreve o teste.
const boardIpc =
  screen === 'kanban'
    ? registerBoardIpc(new BoardReader({ graphql: createGraphQL() }), resolveBoard())
    : null

void app.whenReady().then(() => {
  const window = createWindow()
  if (!boardIpc) return

  // Em paralelo à criação da janela: a leitura começa antes de o renderer pedir.
  boardIpc.refresh()

  // Os dois gatilhos moram aqui dentro porque o `powerMonitor` do Electron só pode ser usado depois
  // do evento `ready` — registrá-lo no topo do módulo lança.
  window.on('focus', () => {
    boardIpc.refresh()
  })

  // Necessário além do `focus`: quando a máquina acorda, a janela costuma já estar em foco e nenhum
  // evento de foco dispara. Sem ele, quem nunca fecha o app começaria a manhã com o board de ontem.
  powerMonitor.on('resume', () => {
    boardIpc.refresh()
  })
})

// Fechar a janela encerra o app — inclusive no macOS. Nada de histórico se perde: as sessões do
// Claude Code são resumíveis por id e os transcripts vivem em `~/.claude/projects/`.
//
// `closeAll()` não é esperado de propósito. A parte que importa dele é síncrona (nega o que estava
// pendente e fecha as filas de entrada); o que sobra é aguardar o subprocesso terminar o turno em
// andamento, e esperar por isso deixaria o app vivo sem janela nenhuma. A spec aceita o preço: um
// turno em andamento morre.
app.on('window-all-closed', () => {
  void sessionIpc.closeAll()
  app.quit()
})
