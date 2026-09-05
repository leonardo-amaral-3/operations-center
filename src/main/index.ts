import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

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

void app.whenReady().then(() => {
  createWindow()
})

// Fechar a janela encerra o app — inclusive no macOS. Nada de histórico se perde: as sessões do
// Claude Code são resumíveis por id e os transcripts vivem em `~/.claude/projects/`.
app.on('window-all-closed', () => {
  app.quit()
})
