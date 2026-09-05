import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SettingSource } from '@anthropic-ai/claude-agent-sdk'
import { app, BrowserWindow } from 'electron'

import { SessionHost } from '../core'
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

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    title: 'Operations Center',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
}

// O main é dono do `core`: é ele que tem o `query` do SDK, o ambiente e o processo Node. O host é
// criado antes da janela para que nenhum `invoke` chegue a um canal ainda não registrado.
const host = new SessionHost({
  query,
  model: resolveModel(),
  settingSources: resolveSettingSources(),
})

const sessionIpc = registerSessionIpc(host, { cwd: resolveCwd() })

void app.whenReady().then(() => {
  createWindow()
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
