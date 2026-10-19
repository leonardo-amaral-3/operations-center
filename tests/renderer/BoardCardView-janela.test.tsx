// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BoardCardView } from '../../src/renderer/components/BoardCardView'
import type { BoardCard } from '../../src/shared/board'

/**
 * #100 §3, a parte do cartão: `detached` (selo e marcador, sem montar o terminal), o botão Destacar
 * e `janela` (o cartão como conteúdo da janela do card). O `ClaudeTerminal` é um dublê que expõe se
 * recebeu `onCollapse`.
 */
vi.mock('../../src/renderer/components/ClaudeTerminal', () => ({
  ClaudeTerminal: ({ onCollapse }: { onCollapse?: () => void }) => (
    <div data-testid="claude-terminal">
      {onCollapse ? <button data-testid="card-collapse" onClick={onCollapse} /> : null}
    </div>
  ),
}))
vi.mock('../../src/renderer/components/CardContent', () => ({ CardContent: () => null }))

const CARD: BoardCard = {
  itemId: 'PVTI_janela',
  number: 9,
  title: 'Janela do card',
  url: 'https://github.com/leonardo-amaral-3/operations-center/issues/9',
  repository: 'leonardo-amaral-3/operations-center',
  closed: false,
  assignees: [],
  columnId: 'da732a01',
  fields: [],
  parent: null,
  phases: [],
}

const oc = {
  openCardWindow: vi.fn(() => Promise.resolve()),
  focusCardWindow: vi.fn(() => Promise.resolve()),
  bringBackCardWindow: vi.fn(() => Promise.resolve()),
}

beforeEach(() => {
  vi.clearAllMocks()
  // O jsdom não implementa `scrollIntoView`, que o cartão expandido chama ao abrir.
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('window', Object.assign(window, { oc }))
})
afterEach(cleanup)

interface Opts {
  expanded?: boolean
  maximized?: boolean
  detached?: boolean
  janela?: boolean
  onToggle?: (itemId: string) => void
  onRestore?: () => void
}

function montar({
  expanded = true,
  maximized = false,
  detached = false,
  janela = false,
  onToggle = () => {},
  onRestore = () => {},
}: Opts = {}): void {
  render(
    <BoardCardView
      card={CARD}
      conversable
      expanded={expanded}
      terminal={null}
      dormant={false}
      dangerous={false}
      onToggle={onToggle}
      onToggleDangerous={() => {}}
      maximized={maximized}
      onMaximize={() => {}}
      onRestore={onRestore}
      detached={detached}
      janela={janela}
    />,
  )
}

describe('#100 CA-2 — card destacado na principal', () => {
  it('expandido: marcador no lugar do corpo, e nenhum terminal montado', () => {
    montar({ detached: true })

    expect(screen.getByTestId('card-detached').textContent).toContain('Aberto em outra janela')
    expect(screen.queryByTestId('claude-terminal')).toBeNull()
    expect(screen.queryByTestId('card-detach')).toBeNull()
  })

  it('expandido: "Mostrar" foca e "Trazer de volta" devolve', () => {
    montar({ detached: true })

    fireEvent.click(screen.getByTestId('card-detached-show'))
    fireEvent.click(screen.getByTestId('card-detached-bring-back'))

    expect(oc.focusCardWindow).toHaveBeenCalledExactlyOnceWith({ itemId: CARD.itemId })
    expect(oc.bringBackCardWindow).toHaveBeenCalledExactlyOnceWith({ itemId: CARD.itemId })
  })

  it('expandido: ainda dá para fechar o cartão', () => {
    const onToggle = vi.fn()
    montar({ detached: true, onToggle })

    fireEvent.click(screen.getByTestId('card-collapse'))

    expect(onToggle).toHaveBeenCalledExactlyOnceWith(CARD.itemId)
  })

  it('recolhido: selo, e o clique foca a janela em vez de abrir o cartão', () => {
    const onToggle = vi.fn()
    montar({ expanded: false, detached: true, onToggle })

    expect(screen.getByTestId('card-detached-badge').textContent).toBe('Em outra janela')

    fireEvent.click(screen.getByTestId('board-card'))

    expect(oc.focusCardWindow).toHaveBeenCalledExactlyOnceWith({ itemId: CARD.itemId })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('recolhido e não destacado: sem selo, e o clique abre', () => {
    const onToggle = vi.fn()
    montar({ expanded: false, onToggle })

    expect(screen.queryByTestId('card-detached-badge')).toBeNull()

    fireEvent.click(screen.getByTestId('board-card'))

    expect(onToggle).toHaveBeenCalledExactlyOnceWith(CARD.itemId)
    expect(oc.focusCardWindow).not.toHaveBeenCalled()
  })
})

describe('#100 CA-2 — botão Destacar', () => {
  it('abre a janela sem o cursor, e fora de maximizado não recolhe nada', () => {
    const onRestore = vi.fn()
    montar({ onRestore })

    fireEvent.click(screen.getByTestId('card-detach'))

    expect(oc.openCardWindow).toHaveBeenCalledExactlyOnceWith({
      itemId: CARD.itemId,
      atCursor: false,
    })
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('maximizado: chama `onRestore` depois de abrir a janela', () => {
    const ordem: string[] = []
    oc.openCardWindow.mockImplementationOnce(() => {
      ordem.push('open')
      return Promise.resolve()
    })
    montar({ maximized: true, onRestore: () => ordem.push('restore') })

    fireEvent.click(screen.getByTestId('card-detach'))

    expect(ordem).toEqual(['open', 'restore'])
  })
})

describe('#100 CA-2 — `janela`', () => {
  it('esconde maximizar, destacar e os recolher, e ocupa a janela', () => {
    montar({ janela: true })

    expect(screen.queryByTestId('card-maximize')).toBeNull()
    expect(screen.queryByTestId('card-detach')).toBeNull()
    expect(screen.queryByTestId('card-collapse')).toBeNull()
    expect(screen.getByTestId('claude-terminal')).not.toBeNull()
    expect(screen.getByTestId('board-card').className).toContain('h-full')
    expect(screen.getByTestId('board-card').className).not.toContain('absolute')
  })

  it('o Esc não recolhe', () => {
    const onRestore = vi.fn()
    const onToggle = vi.fn()
    montar({ janela: true, onRestore, onToggle })

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )

    expect(onRestore).not.toHaveBeenCalled()
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('sem conversa: nem o "Fechar" do cartão aparece', () => {
    render(
      <BoardCardView
        card={CARD}
        conversable={false}
        expanded
        terminal={null}
        dormant={false}
        dangerous={false}
        onToggle={() => {}}
        onToggleDangerous={() => {}}
        janela
      />,
    )

    expect(screen.queryByTestId('card-collapse')).toBeNull()
    expect(screen.queryByTestId('claude-terminal')).toBeNull()
  })
})
