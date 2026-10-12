// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O `TerminalView` sem o xterm de verdade, que exige canvas: o `Terminal` é um dublê que guarda o
 * gancho de teclas e a seleção, e a ponte `window.oc` é um stub que segura a resposta do
 * `openTerminal` até o teste soltá-la. É o suficiente para os dois achados da revisão da PR #75
 * que moram no componente: o terminal em branco do StrictMode e o `Ctrl+Shift+C` que apagava a área
 * de transferência.
 */

const { termos } = vi.hoisted(() => ({
  termos: [] as Array<{
    selecao: string
    tecla: ((event: KeyboardEvent) => boolean) | null
  }>,
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  },
}))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    readonly #estado = { selecao: '', tecla: null as ((event: KeyboardEvent) => boolean) | null }
    constructor() {
      termos.push(this.#estado)
    }
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    focus(): void {}
    paste(): void {}
    dispose(): void {}
    clearSelection(): void {}
    hasSelection(): boolean {
      return this.#estado.selecao !== ''
    }
    getSelection(): string {
      return this.#estado.selecao
    }
    onResize() {
      return { dispose: () => undefined }
    }
    onData() {
      return { dispose: () => undefined }
    }
    attachCustomKeyEventHandler(cb: (event: KeyboardEvent) => boolean): void {
      this.#estado.tecla = cb
    }
  },
}))

import { TerminalView } from '../../src/renderer/components/TerminalView'
import type { TerminalViewProps } from '../../src/renderer/components/TerminalView'
import type { OpenTerminalResult } from '../../src/shared/ipc'

let respostas: Array<(r: OpenTerminalResult) => void>
let fechados: string[]
let clipboard: { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> }

beforeEach(() => {
  termos.length = 0
  respostas = []
  fechados = []
  clipboard = {
    writeText: vi.fn(() => Promise.resolve()),
    readText: vi.fn(() => Promise.resolve('')),
  }
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  )
  ;(window as unknown as { oc: unknown }).oc = {
    openTerminal: () => new Promise<OpenTerminalResult>((resolve) => respostas.push(resolve)),
    closeTerminal: ({ id }: { id: string }) => {
      fechados.push(id)

      return Promise.resolve()
    },
    resizeTerminal: () => Promise.resolve(),
    writeTerminal: () => Promise.resolve(),
    onTerminalData: () => () => undefined,
    onTerminalExit: () => () => undefined,
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function props(over: Partial<TerminalViewProps> = {}): TerminalViewProps {
  return {
    tab: {
      key: 'k1',
      preset: 'powershell',
      title: 'PowerShell',
      id: null,
      failure: null,
      exitCode: null,
    },
    active: true,
    spawn: true,
    focus: false,
    presets: [],
    onOpened: vi.fn(),
    onFailed: vi.fn(),
    onExited: vi.fn(),
    onFocusConsumed: vi.fn(),
    onChoosePreset: vi.fn(),
    ...over,
  }
}

const aberto = (id: string): OpenTerminalResult => ({
  opened: true,
  terminal: { id, preset: 'powershell', title: 'PowerShell' },
})

describe('TerminalView no StrictMode (yarn dev)', () => {
  it('a remontagem pede o PTY dela, e o terminal nasce ligado — não em branco', async () => {
    const p = props()
    render(
      <StrictMode>
        <TerminalView {...p} />
      </StrictMode>,
    )

    // Um pedido por montagem: o da primeira, que o cleanup órfã, e o da que fica.
    expect(respostas).toHaveLength(2)

    await act(async () => {
      respostas[0]!(aberto('pty-orfao'))
      respostas[1]!(aberto('pty-vivo'))
    })

    expect(fechados).toEqual(['pty-orfao'])
    expect(p.onOpened).toHaveBeenCalledExactlyOnceWith({
      id: 'pty-vivo',
      preset: 'powershell',
      title: 'PowerShell',
    })
  })
})

describe('TerminalView — copiar', () => {
  const ctrlShiftC = {
    type: 'keydown',
    code: 'KeyC',
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    preventDefault: () => undefined,
  } as unknown as KeyboardEvent

  it('Ctrl+Shift+C sem seleção não toca a área de transferência, e não vira ^C no shell', () => {
    render(<TerminalView {...props({ spawn: false })} />)

    expect(termos[0]!.tecla!(ctrlShiftC)).toBe(false)
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('Ctrl+Shift+C com seleção copia a seleção', () => {
    render(<TerminalView {...props({ spawn: false })} />)
    termos[0]!.selecao = 'oc-smoke-ok'

    termos[0]!.tecla!(ctrlShiftC)

    expect(clipboard.writeText).toHaveBeenCalledWith('oc-smoke-ok')
  })
})
