/**
 * A janela própria de cada card (#100): um `BrowserWindow` por `itemId`, aberto pelo main, que
 * mostra o card e adota o terminal Claude dele.
 *
 * **A janela principal é a dona do app, e estas são satélites.** O terminal do card volta sozinho
 * para a principal quando a janela do card morre — a regra de `closeOf` do `claudeTerminal`, da
 * fase 1 —, então este módulo não toca terminal nenhum: abre, foca, fecha e avisa quem está aberto.
 *
 * O que vem de `index.ts` chega por `deps` e não por import: a proteção de navegação, as
 * `webPreferences` e a janela principal são do `index.ts` (o teste do markdown lê ali a guarda), e
 * as duas regras de posição leem a principal.
 */

import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Rectangle, WebContents, WebPreferences } from 'electron'

import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type { CardWindowRequest, OpenCardWindowRequest } from '../shared/ipc'
import { THEME_FLAG } from '../shared/theme'
import type { Theme } from '../shared/theme'

/** Quanto do `workArea` a janela ocupa antes do `maximize()`: o tamanho a que ela volta ao restaurar. */
const FRACAO_DO_DISPLAY = 0.8

export interface CardWindows {
  /** Abre o card; já destacado, foca. `at` é o ponto de tela onde posicionar, ou `null` para a principal. */
  open(itemId: string, at: { x: number; y: number } | null): void
  bringBack(itemId: string): void
  focus(itemId: string): void
  list(): string[]
  forEach(fn: (win: BrowserWindow) => void): void
  /** Fecha cada janela de card com `close()`, nunca `destroy()`: o fechamento devolve o terminal. */
  closeAll(): void
}

export interface CardWindowsDeps {
  theme(): Theme
  /** A janela principal, ou `null` se já fechou. */
  home(): BrowserWindow | null
  /** As `webPreferences` da janela principal, sem os `additionalArguments`, que são daqui. */
  webPreferences: WebPreferences
  /** A cor de fundo da combinação, a mesma do `createWindow`. */
  background(theme: Theme): string
  /** O `setWindowOpenHandler` e o guard de `will-navigate` da principal. */
  protegerNavegacao(win: BrowserWindow): void
  load(win: BrowserWindow): void
  observarJanela(win: BrowserWindow): void
}

/** Os `bounds` iniciais: 80% do `workArea`, centrados nele. O `maximize()` cobre o display depois. */
function limitesCentrados(area: Rectangle): Rectangle {
  const width = Math.round(area.width * FRACAO_DO_DISPLAY)
  const height = Math.round(area.height * FRACAO_DO_DISPLAY)

  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  }
}

function dentro(bounds: Rectangle, ponto: { x: number; y: number }): boolean {
  return (
    ponto.x >= bounds.x &&
    ponto.x < bounds.x + bounds.width &&
    ponto.y >= bounds.y &&
    ponto.y < bounds.y + bounds.height
  )
}

/** O `workArea` do display onde a janela nasce: o do ponto, ou o da principal. */
function areaDeTrabalho(deps: CardWindowsDeps, at: { x: number; y: number } | null): Rectangle {
  if (at) return screen.getDisplayNearestPoint(at).workArea

  const home = deps.home()

  return home
    ? screen.getDisplayMatching(home.getBounds()).workArea
    : screen.getPrimaryDisplay().workArea
}

function createCardWindow(
  deps: CardWindowsDeps,
  itemId: string,
  theme: Theme,
  at: { x: number; y: number } | null,
): BrowserWindow {
  const window = new BrowserWindow({
    ...limitesCentrados(areaDeTrabalho(deps, at)),
    backgroundColor: deps.background(theme),
    // Sem moldura do sistema, como a principal: a faixa do card é desenhada pelo renderer.
    frame: false,
    roundedCorners: false,
    show: false,
    autoHideMenuBar: true,
    title: 'Operations Center',
    webPreferences: {
      ...deps.webPreferences,
      additionalArguments: ['--oc-screen=card', `--oc-card=${itemId}`, `${THEME_FLAG}${theme}`],
    },
  })

  window.once('ready-to-show', () => {
    window.show()
    window.maximize()
  })

  deps.protegerNavegacao(window)
  deps.observarJanela(window)

  return window
}

export function registerCardWindowsIpc(deps: CardWindowsDeps): CardWindows {
  const janelas = new Map<string, BrowserWindow>()
  const subscribers = new Set<WebContents>()

  function publicar(): void {
    const itemIds = [...janelas.keys()]

    for (const sender of subscribers) {
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        continue
      }

      sender.send(IPC_EVENT.cardWindows, itemIds)
    }
  }

  function focus(itemId: string): void {
    const window = janelas.get(itemId)
    if (!window) return

    if (window.isMinimized()) window.restore()
    window.focus()
  }

  function open(itemId: string, at: { x: number; y: number } | null): void {
    if (janelas.has(itemId)) {
      focus(itemId)
      return
    }

    const window = createCardWindow(deps, itemId, deps.theme(), at)

    janelas.set(itemId, window)
    window.on('closed', () => {
      // Só tira o que ainda é esta janela: o mesmo `itemId` pode ter reaberto entre o `close()` e o
      // evento, e apagar a janela nova deixaria o card sem marcador com a janela de pé.
      if (janelas.get(itemId) !== window) return

      janelas.delete(itemId)
      publicar()
    })

    // **Antes do `load`**, e depois do `set`: a principal tem de desmontar o terminal do cartão
    // antes de a janela nova adotá-lo, senão um remonte na principal tomaria o terminal de volta.
    publicar()
    deps.load(window)
  }

  ipcMain.handle(IPC_INVOKE.openCardWindow, (_event, request: OpenCardWindowRequest): void => {
    if (typeof request?.itemId !== 'string' || request.itemId === '') return

    if (!request.atCursor) {
      open(request.itemId, null)
      return
    }

    const ponto = screen.getCursorScreenPoint()
    const home = deps.home()

    // Soltar dentro da principal é um arrasto cancelado, não um pedido de janela.
    if (home && dentro(home.getBounds(), ponto)) return

    open(request.itemId, ponto)
  })

  ipcMain.handle(IPC_INVOKE.bringBackCardWindow, (_event, request: CardWindowRequest): void => {
    janelas.get(request.itemId)?.close()
  })

  ipcMain.handle(IPC_INVOKE.focusCardWindow, (_event, request: CardWindowRequest): void => {
    focus(request.itemId)
  })

  ipcMain.handle(IPC_INVOKE.readCardWindows, (event): string[] => {
    subscribers.add(event.sender)

    return [...janelas.keys()]
  })

  return {
    open,
    bringBack: (itemId) => janelas.get(itemId)?.close(),
    focus,
    list: () => [...janelas.keys()],
    forEach: (fn) => {
      for (const window of janelas.values()) fn(window)
    },
    closeAll: () => {
      for (const window of [...janelas.values()]) window.close()
    },
  }
}
