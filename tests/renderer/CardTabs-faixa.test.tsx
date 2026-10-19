// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CardTabs } from '../../src/renderer/components/CardTabs'
import type { CardTab } from '../../src/renderer/components/CardTabs'

/** A faixa de conversas (#100, fase 2): lista vazia some, cada aba rotula e devolve o `itemId`. */

afterEach(cleanup)

const ABAS: readonly CardTab[] = [
  { itemId: 'PVTI_1', number: 7, title: 'Primeiro', state: { kind: 'working' }, detached: false },
  {
    itemId: 'PVTI_2',
    number: 12,
    title: 'Um título bem mais comprido que vinte e quatro caracteres',
    state: { kind: 'awaiting_input' },
    detached: false,
  },
]

describe('#100 — CardTabs', () => {
  it('lista vazia não renderiza nada', () => {
    const { container } = render(<CardTabs tabs={[]} onFocus={() => {}} onClose={() => {}} />)

    expect(container.innerHTML).toBe('')
  })

  it('uma aba por item, na ordem, com o rótulo `#n título` e o título inteiro no `title`', () => {
    render(<CardTabs tabs={ABAS} onFocus={() => {}} onClose={() => {}} />)

    const abas = screen.getAllByTestId('card-tab')

    expect(abas.map((aba) => aba.dataset.itemId)).toEqual(['PVTI_1', 'PVTI_2'])
    expect(abas[0]?.textContent).toContain('#7 Primeiro')
    expect(abas[1]?.getAttribute('title')).toBe(`#12 ${ABAS[1]?.title}`)
  })

  it('o clique devolve o `itemId` da aba', () => {
    const onFocus = vi.fn()

    render(<CardTabs tabs={ABAS} onFocus={onFocus} onClose={() => {}} />)
    fireEvent.click(screen.getAllByTestId('card-tab')[1] as HTMLElement)

    expect(onFocus).toHaveBeenCalledExactlyOnceWith('PVTI_2')
  })
})

describe('#100 fase 3 — aba destacável', () => {
  const openCardWindow = vi.fn()
  const focusCardWindow = vi.fn()

  beforeEach(() => {
    openCardWindow.mockReset()
    focusCardWindow.mockReset()
    Object.defineProperty(window, 'oc', {
      value: { openCardWindow, focusCardWindow },
      configurable: true,
    })
  })

  it('aba destacada ganha `data-detached` e o clique foca a janela, não a faixa', () => {
    const onFocus = vi.fn()
    const abas = [{ ...(ABAS[0] as CardTab), detached: true }, ABAS[1] as CardTab]

    render(<CardTabs tabs={abas} onFocus={onFocus} onClose={() => {}} />)

    const [destacada, comum] = screen.getAllByTestId('card-tab') as [HTMLElement, HTMLElement]

    expect(destacada.dataset.detached).toBe('true')
    expect(comum.dataset.detached).toBe('false')

    fireEvent.click(destacada)

    expect(focusCardWindow).toHaveBeenCalledExactlyOnceWith({ itemId: 'PVTI_1' })
    expect(onFocus).not.toHaveBeenCalled()
  })

  it('toda aba é arrastável e o `dragend` pede a janela no cursor', () => {
    render(<CardTabs tabs={ABAS} onFocus={() => {}} onClose={() => {}} />)

    const [primeira] = screen.getAllByTestId('card-tab') as [HTMLElement]

    expect(screen.getAllByTestId('card-tab').every((a) => a.draggable)).toBe(true)

    fireEvent.dragEnd(primeira)

    expect(openCardWindow).toHaveBeenCalledExactlyOnceWith({ itemId: 'PVTI_1', atCursor: true })
  })

  it('cada aba tem um ✕ que devolve o itemId a onClose, sem chamar onFocus', () => {
    const onFocus = vi.fn()
    const onClose = vi.fn()

    render(<CardTabs tabs={ABAS} onFocus={onFocus} onClose={onClose} />)

    const fechar = screen.getAllByTestId('card-tab-close')

    expect(fechar.map((b) => b.dataset.itemId)).toEqual(['PVTI_1', 'PVTI_2'])

    fireEvent.click(fechar[1] as HTMLElement)

    expect(onClose).toHaveBeenCalledExactlyOnceWith('PVTI_2')
    expect(onFocus).not.toHaveBeenCalled()
  })

  it('o ✕ da aba destacada também chama onClose, sem focusCardWindow', () => {
    const onClose = vi.fn()
    const abas = [{ ...(ABAS[0] as CardTab), detached: true }]

    render(<CardTabs tabs={abas} onFocus={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('card-tab-close'))

    expect(onClose).toHaveBeenCalledExactlyOnceWith('PVTI_1')
    expect(focusCardWindow).not.toHaveBeenCalled()
  })
})
