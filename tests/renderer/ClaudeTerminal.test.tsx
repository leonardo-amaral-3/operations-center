// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClaudeTerminal } from '../../src/renderer/components/ClaudeTerminal'
import type { ClaudeScope } from '../../src/shared/claude'
import { instalarOc } from './fakeOc'
import type { OcFake } from './fakeOc'

/**
 * O componente do terminal Claude (#97 §10), com o xterm mockado como em `TerminalView.test.tsx`:
 * o registro de instâncias é o de verdade, o `Terminal` é um dublê que não desenha nada.
 */

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
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    focus(): void {}
    dispose(): void {}
    hasSelection(): boolean {
      return false
    }
    attachCustomKeyEventHandler(): void {}
    onData(): { dispose(): void } {
      return { dispose: () => undefined }
    }
    onResize(): { dispose(): void } {
      return { dispose: () => undefined }
    }
  },
}))

// O registro é um singleton do módulo: um escopo novo por caso evita herdar a instância do anterior.
let CARTAO: ClaudeScope = { kind: 'card', itemId: 'item_0' }
let casos = 0
const SEM_PASTA = 'Não sei em que pasta este cartão trabalha.'

let oc: OcFake

beforeEach(() => {
  CARTAO = { kind: 'card', itemId: `item_${++casos}` }
  oc = instalarOc()
})

afterEach(cleanup)

function montar(props: Partial<Parameters<typeof ClaudeTerminal>[0]> = {}): void {
  render(
    <ClaudeTerminal
      scope={CARTAO}
      state={{ kind: 'working' }}
      dangerous={false}
      semPasta={SEM_PASTA}
      onToggleDangerous={() => undefined}
      onCollapse={() => undefined}
      {...props}
    />,
  )
}

describe('ClaudeTerminal', () => {
  it('no render de servidor já mostra a barra, com "Encerrar sessão" desabilitado sem estado', () => {
    const html = renderToStaticMarkup(
      <ClaudeTerminal
        scope={CARTAO}
        state={null}
        dangerous={false}
        semPasta={SEM_PASTA}
        onToggleDangerous={() => undefined}
      />,
    )

    expect(html).toContain('data-testid="claude-terminal-bar"')
    expect(html).toMatch(/data-testid="card-end-session"[^>]*disabled/)
    expect(html).not.toContain('state-badge')
  })

  it('unknown-folder renderiza só o SemPasta, sem barra nem corpo', async () => {
    oc.responderClaude({ ok: false, reason: 'unknown-folder' })
    montar()
    await act(async () => {})

    expect(screen.getByText(SEM_PASTA)).toBeTruthy()
    expect(screen.getByTestId('choose-folder')).toBeTruthy()
    expect(screen.queryByTestId('claude-terminal-bar')).toBeNull()
    expect(screen.queryByTestId('claude-terminal')).toBeNull()
  })

  it('"Encerrar sessão" chama closeClaude antes do novo openClaude', async () => {
    montar()
    await act(async () => {})
    expect(oc.claudeAbertos).toHaveLength(1)

    fireEvent.click(screen.getByTestId('card-end-session'))
    await act(async () => {})

    expect(oc.claudeFechados).toEqual([{ scope: CARTAO }])
    expect(oc.claudeAbertos).toHaveLength(2)
  })

  it('danger-next-open aparece quando a prop difere do modo do main e some quando volta a bater', async () => {
    const { rerender } = render(
      <ClaudeTerminal
        scope={CARTAO}
        state={{ kind: 'working' }}
        dangerous={false}
        semPasta={SEM_PASTA}
        onToggleDangerous={() => undefined}
      />,
    )
    await act(async () => {})
    expect(screen.queryByTestId('danger-next-open')).toBeNull()

    const com = (dangerous: boolean): ReactElement => (
      <ClaudeTerminal
        scope={CARTAO}
        state={{ kind: 'working' }}
        dangerous={dangerous}
        semPasta={SEM_PASTA}
        onToggleDangerous={() => undefined}
      />
    )
    rerender(com(true))
    expect(screen.getByTestId('danger-next-open')).toBeTruthy()

    rerender(com(false))
    expect(screen.queryByTestId('danger-next-open')).toBeNull()
  })

  it('claude-missing mostra o erro e o botão de tentar de novo', async () => {
    oc.responderClaude({ ok: false, reason: 'claude-missing', detail: 'claude não encontrado' })
    montar()
    await act(async () => {})

    expect(screen.getByTestId('claude-terminal-error').textContent).toBe('claude não encontrado')

    fireEvent.click(screen.getByTestId('claude-terminal-retry'))
    await act(async () => {})

    expect(oc.claudeAbertos).toHaveLength(2)
    expect(screen.queryByTestId('claude-terminal-error')).toBeNull()
  })

  it('session-busy mostra o texto do item 1', async () => {
    oc.responderClaude({ ok: false, reason: 'session-busy' })
    montar()
    await act(async () => {})

    expect(screen.getByTestId('claude-terminal-error').textContent).toBe(
      'Esta conversa já está aberta em outro terminal. Encerre-a lá para abrir aqui.',
    )
    expect(screen.getByTestId('claude-terminal-bar')).toBeTruthy()
  })
})
