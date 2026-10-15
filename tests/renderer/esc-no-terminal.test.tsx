// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BoardCardView } from '../../src/renderer/components/BoardCardView'
import type { BoardCard } from '../../src/shared/board'

/**
 * P18 do #97: no cartão maximizado, o Esc restaura o cartão — exceto quando o alvo está dentro do
 * terminal, onde a tecla é da CLI (ela a usa para interromper o turno).
 *
 * O `ClaudeTerminal` é um dublê: o que se prova aqui é o `keydown` do cartão, e o xterm real exige
 * canvas.
 */
vi.mock('../../src/renderer/components/ClaudeTerminal', () => ({
  ClaudeTerminal: () => (
    <div data-testid="claude-terminal">
      <textarea data-testid="dentro" />
    </div>
  ),
}))
vi.mock('../../src/renderer/components/CardContent', () => ({ CardContent: () => null }))

const CARD: BoardCard = {
  itemId: 'PVTI_esc',
  number: 4,
  title: 'Esc no terminal',
  url: 'https://github.com/leonardo-amaral-3/operations-center/issues/4',
  repository: 'leonardo-amaral-3/operations-center',
  closed: false,
  assignees: [],
  columnId: 'da732a01',
  fields: [],
  parent: null,
  phases: [],
}

function montar(onRestore: () => void): ReturnType<typeof render> {
  return render(
    <BoardCardView
      card={CARD}
      conversable
      expanded
      maximized
      terminal={null}
      dormant={false}
      dangerous={false}
      onToggle={() => {}}
      onToggleDangerous={() => {}}
      onMaximize={() => {}}
      onRestore={onRestore}
    />,
  )
}

function esc(alvo: Element): void {
  alvo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

afterEach(cleanup)

describe('#97 P18 — Esc no cartão maximizado', () => {
  it('com o alvo dentro de `claude-terminal`, não restaura', () => {
    const onRestore = vi.fn()
    const { getByTestId } = montar(onRestore)

    esc(getByTestId('dentro'))

    expect(onRestore).not.toHaveBeenCalled()
  })

  it('com o alvo fora do terminal, ainda dentro do cartão, restaura', () => {
    const onRestore = vi.fn()
    const { getByTestId } = montar(onRestore)

    esc(getByTestId('card-maximize'))

    expect(onRestore).toHaveBeenCalledTimes(1)
  })
})
