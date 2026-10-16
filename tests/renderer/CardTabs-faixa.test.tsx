// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    const { container } = render(<CardTabs tabs={[]} onFocus={() => {}} />)

    expect(container.innerHTML).toBe('')
  })

  it('uma aba por item, na ordem, com o rótulo `#n título` e o título inteiro no `title`', () => {
    render(<CardTabs tabs={ABAS} onFocus={() => {}} />)

    const abas = screen.getAllByTestId('card-tab')

    expect(abas.map((aba) => aba.dataset.itemId)).toEqual(['PVTI_1', 'PVTI_2'])
    expect(abas[0]?.textContent).toContain('#7 Primeiro')
    expect(abas[1]?.getAttribute('title')).toBe(`#12 ${ABAS[1]?.title}`)
  })

  it('o clique devolve o `itemId` da aba', () => {
    const onFocus = vi.fn()

    render(<CardTabs tabs={ABAS} onFocus={onFocus} />)
    fireEvent.click(screen.getAllByTestId('card-tab')[1] as HTMLElement)

    expect(onFocus).toHaveBeenCalledExactlyOnceWith('PVTI_2')
  })
})
