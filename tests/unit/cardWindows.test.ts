/**
 * A janela própria do card (#100), contra dublês de `BrowserWindow` e de `screen`.
 *
 * O mock de `electron` tem três metades: `ipcMain` (os canais), `BrowserWindow` (o construtor, que
 * aqui registra cada janela criada) e `screen` (dois displays, para a posição ter onde errar).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, criadas, tela } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request?: unknown) => unknown>(),
  criadas: [] as unknown[],
  tela: {
    cursor: { x: 0, y: 0 },
  },
}))

const DISPLAY_A = { x: 0, y: 0, width: 1920, height: 1040 }
const DISPLAY_B = { x: 1920, y: 0, width: 2560, height: 1400 }

vi.mock('electron', () => {
  class FakeWindow {
    options: Record<string, unknown>
    ouvintes = new Map<string, () => void>()
    chamadas: string[] = []
    minimizada = false
    constructor(options: Record<string, unknown>) {
      this.options = options
      criadas.push(this)
    }
    on(evento: string, ouvinte: () => void): void {
      this.ouvintes.set(evento, ouvinte)
    }
    once(evento: string, ouvinte: () => void): void {
      this.ouvintes.set(evento, ouvinte)
    }
    show(): void {
      this.chamadas.push('show')
    }
    maximize(): void {
      this.chamadas.push('maximize')
    }
    focus(): void {
      this.chamadas.push('focus')
    }
    restore(): void {
      this.chamadas.push('restore')
    }
    isMinimized(): boolean {
      return this.minimizada
    }
    close(): void {
      this.chamadas.push('close')
      this.ouvintes.get('closed')?.()
    }
    destroy(): void {
      this.chamadas.push('destroy')
    }
  }

  return {
    ipcMain: {
      handle(channel: string, handler: (event: unknown, request?: unknown) => unknown): void {
        handlers.set(channel, handler)
      },
    },
    BrowserWindow: FakeWindow,
    screen: {
      getCursorScreenPoint: () => tela.cursor,
      getDisplayNearestPoint: (p: { x: number }) => ({
        workArea: p.x >= DISPLAY_B.x ? DISPLAY_B : DISPLAY_A,
      }),
      getDisplayMatching: (b: { x: number }) => ({
        workArea: b.x >= DISPLAY_B.x ? DISPLAY_B : DISPLAY_A,
      }),
      getPrimaryDisplay: () => ({ workArea: DISPLAY_A }),
    },
  }
})

import type { BrowserWindow, Rectangle, WebContents } from 'electron'

import { registerCardWindowsIpc } from '../../src/main/cardWindows'
import type { CardWindows } from '../../src/main/cardWindows'
import { IPC_EVENT, IPC_INVOKE } from '../../src/shared/ipc'

interface Janela {
  options: { webPreferences: { additionalArguments: string[] }; frame: boolean } & Record<
    string,
    unknown
  >
  ouvintes: Map<string, () => void>
  chamadas: string[]
  minimizada: boolean
  close(): void
}

const janela = (i: number): Janela => criadas[i] as Janela

function montar(homeBounds = { x: 100, y: 100, width: 800, height: 600 }) {
  handlers.clear()
  criadas.length = 0
  tela.cursor = { x: 0, y: 0 }

  const ordem: string[] = []
  const publicados: string[][] = []
  const observadas: unknown[] = []
  const protegidas: unknown[] = []
  const home = { getBounds: () => homeBounds }

  const sender = {
    isDestroyed: () => false,
    send(canal: string, carga: string[]): void {
      if (canal === IPC_EVENT.cardWindows) {
        ordem.push('publicou')
        publicados.push(carga)
      }
    },
  } as unknown as WebContents

  const cardWindows: CardWindows = registerCardWindowsIpc({
    theme: () => 'neobrutalism' as never,
    home: () => home as unknown as BrowserWindow,
    webPreferences: { sandbox: true, preload: 'p.js' },
    background: () => '#fff',
    protegerNavegacao: (w) => protegidas.push(w),
    load: () => ordem.push('load'),
    observarJanela: (w) => observadas.push(w),
  })

  function invocar(canal: string, request?: unknown): unknown {
    const handler = handlers.get(canal)
    if (!handler) throw new Error('canal não registrado: ' + canal)

    return handler({ sender }, request)
  }

  invocar(IPC_INVOKE.readCardWindows)

  return { cardWindows, invocar, ordem, publicados, observadas, protegidas }
}

describe('registerCardWindowsIpc', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('abre com os argumentos da tela card, sem moldura, e protege e observa a janela', () => {
    const { cardWindows, protegidas, observadas } = montar()

    cardWindows.open('I_1', null)

    const w = janela(0)
    expect(w.options.webPreferences.additionalArguments).toEqual([
      '--oc-screen=card',
      '--oc-card=I_1',
      expect.stringContaining('neobrutalism'),
    ])
    expect(w.options.frame).toBe(false)
    expect(w.options.roundedCorners).toBe(false)
    expect(w.options.show).toBe(false)
    expect(protegidas).toHaveLength(1)
    expect(observadas).toHaveLength(1)
  })

  it('publica o conjunto antes do load, e mostra e maximiza só no ready-to-show', () => {
    const { cardWindows, ordem, publicados } = montar()

    cardWindows.open('I_1', null)

    expect(ordem).toEqual(['publicou', 'load'])
    expect(publicados).toEqual([['I_1']])
    expect(janela(0).chamadas).toEqual([])

    janela(0).ouvintes.get('ready-to-show')?.()

    expect(janela(0).chamadas).toEqual(['show', 'maximize'])
  })

  it('reabrir o mesmo card foca a janela, sem segunda janela nem nova publicação', () => {
    const { cardWindows, publicados } = montar()

    cardWindows.open('I_1', null)
    cardWindows.open('I_1', null)

    expect(criadas).toHaveLength(1)
    expect(janela(0).chamadas).toEqual(['focus'])
    expect(publicados).toHaveLength(1)
  })

  it('restaura a janela minimizada antes de focar', () => {
    const { cardWindows } = montar()

    cardWindows.open('I_1', null)
    janela(0).minimizada = true
    cardWindows.focus('I_1')

    expect(janela(0).chamadas).toEqual(['restore', 'focus'])
  })

  it('o closed tira do mapa e publica; bringBack fecha com close()', () => {
    const { cardWindows, invocar, publicados } = montar()

    cardWindows.open('I_1', null)
    invocar(IPC_INVOKE.bringBackCardWindow, { itemId: 'I_1' })

    expect(janela(0).chamadas).toEqual(['close'])
    expect(cardWindows.list()).toEqual([])
    expect(publicados.at(-1)).toEqual([])
  })

  it('dois destacados são independentes: fechar um deixa o outro de pé', () => {
    const { cardWindows, publicados } = montar()

    cardWindows.open('I_1', null)
    cardWindows.open('I_2', null)
    janela(0).close()

    expect(cardWindows.list()).toEqual(['I_2'])
    expect(janela(1).chamadas).toEqual([])
    expect(publicados.at(-1)).toEqual(['I_2'])
  })

  it('closeAll usa close() e nunca destroy()', () => {
    const { cardWindows } = montar()

    cardWindows.open('I_1', null)
    cardWindows.open('I_2', null)
    cardWindows.closeAll()

    expect(janela(0).chamadas).toEqual(['close'])
    expect(janela(1).chamadas).toEqual(['close'])
    expect(cardWindows.list()).toEqual([])
  })

  it('forEach visita cada janela de card', () => {
    const { cardWindows } = montar()
    const vistas: unknown[] = []

    cardWindows.open('I_1', null)
    cardWindows.open('I_2', null)
    cardWindows.forEach((w) => vistas.push(w))

    expect(vistas).toEqual([janela(0), janela(1)])
  })

  it('atCursor dentro dos bounds da principal não abre nada', () => {
    const { invocar, cardWindows } = montar()

    tela.cursor = { x: 300, y: 300 }
    invocar(IPC_INVOKE.openCardWindow, { itemId: 'I_1', atCursor: true })

    expect(criadas).toHaveLength(0)
    expect(cardWindows.list()).toEqual([])
  })

  it('atCursor fora da principal abre centrado no workArea do display do ponto', () => {
    const { invocar } = montar()

    tela.cursor = { x: 3000, y: 200 }
    invocar(IPC_INVOKE.openCardWindow, { itemId: 'I_1', atCursor: true })

    const { x, y, width, height } = janela(0).options as unknown as Rectangle
    expect(width).toBe(Math.round(DISPLAY_B.width * 0.8))
    expect(height).toBe(Math.round(DISPLAY_B.height * 0.8))
    expect(x).toBe(DISPLAY_B.x + Math.round((DISPLAY_B.width - width) / 2))
    expect(y).toBe(Math.round((DISPLAY_B.height - height) / 2))
  })

  it('sem atCursor nasce no display da janela principal', () => {
    const { invocar } = montar({ x: 2000, y: 0, width: 800, height: 600 })

    invocar(IPC_INVOKE.openCardWindow, { itemId: 'I_1', atCursor: false })

    expect((janela(0).options as Record<string, number>).width).toBe(
      Math.round(DISPLAY_B.width * 0.8),
    )
  })

  it('readCardWindows devolve o conjunto e assina o chamador', () => {
    const { cardWindows, invocar, publicados } = montar()

    cardWindows.open('I_1', null)

    expect(invocar(IPC_INVOKE.readCardWindows)).toEqual(['I_1'])
    expect(publicados.at(-1)).toEqual(['I_1'])
  })

  it('itemId vazio ou ausente não abre nada', () => {
    const { invocar } = montar()

    invocar(IPC_INVOKE.openCardWindow, { itemId: '', atCursor: false })
    invocar(IPC_INVOKE.openCardWindow, undefined)

    expect(criadas).toHaveLength(0)
  })
})
