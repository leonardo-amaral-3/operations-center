// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Mesa } from '../../src/renderer/mesa/Mesa'
import type { LayoutSnapshot } from '../../src/shared/ipc'
import { instalarOc } from './fakeOc'

/**
 * CA-5 pelo lado da faixa — o teste de DX da task 5 para "abrir": **um** clique em `▣ Terminal` abre o
 * terminal no último perfil usado (`powershell` na primeira vez), sem menu, sem pergunta, sem
 * diálogo. Se este teste ficar vermelho, a pessoa voltou a ter que escolher antes de poder digitar.
 *
 * `TerminalView` entra mockada porque o xterm não roda em `jsdom` (exige canvas e `matchMedia`). O
 * que a view faz de verdade — medir, pedir o PTY, ligar as teclas — é do smoke do terminal; aqui a
 * mock só **reporta o que recebeu**, e é isso que prova que a aba nasceu no perfil certo e que o
 * estado mandou spawnar.
 */

vi.mock('../../src/renderer/components/TerminalView', () => ({
  TerminalView: (props: { tab: { preset: string }; spawn: boolean }) => (
    <div data-testid="terminal-view" data-preset={props.tab.preset} data-spawn={props.spawn} />
  ),
}))

afterEach(cleanup)

async function montar(layout?: LayoutSnapshot): Promise<ReturnType<typeof instalarOc>> {
  const oc = instalarOc(layout)

  render(
    <Mesa>
      <p>kanban</p>
    </Mesa>,
  )
  // Descarrega `readLayout`/`readTerminalPresets`/`readFree`: sem isso o clique chegaria antes do
  // `hydrate` e o `lastPreset` do disco ainda não estaria no estado.
  await act(async () => {})

  return oc
}

describe('CA-5 — um clique abre no último perfil, sem perguntar', () => {
  it('na primeira vez abre em `powershell`', async () => {
    const oc = await montar()

    fireEvent.click(screen.getByTestId('mesa-new-terminal'))

    const aba = screen.getByTestId('terminal-tab')
    expect(aba.getAttribute('data-preset')).toBe('powershell')
    expect(screen.getByTestId('terminal-view').getAttribute('data-preset')).toBe('powershell')
    // O estado mandou a view pedir o PTY: abrir é uma ação, não um estado a configurar depois.
    expect(screen.getByTestId('terminal-view').getAttribute('data-spawn')).toBe('true')
    expect(oc.pedidosDaMesa).not.toContain('createFree')
  })

  it('com um `lastPreset` gravado, abre nele', async () => {
    await montar({
      dock: { open: false, height: 280, terminals: [], active: null },
      side: { open: false, width: 480, active: null },
      lastPreset: 'git-bash',
    })

    fireEvent.click(screen.getByTestId('mesa-new-terminal'))

    expect(screen.getByTestId('terminal-tab').getAttribute('data-preset')).toBe('git-bash')
  })

  it('não abre menu, diálogo nem pergunta nenhuma: o único elemento novo é a aba', async () => {
    await montar()

    fireEvent.click(screen.getByTestId('mesa-new-terminal'))

    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByTestId('terminal-tab')).toHaveLength(1)
  })

  it('o dock nasce aberto, com a aba nova ativa — e abrir de novo empilha, no mesmo perfil', async () => {
    await montar()

    fireEvent.click(screen.getByTestId('mesa-new-terminal'))
    fireEvent.click(screen.getByTestId('mesa-new-terminal'))

    expect(screen.getByTestId('terminal-dock').hasAttribute('hidden')).toBe(false)

    const abas = screen.getAllByTestId('terminal-tab')
    expect(abas.map((aba) => aba.getAttribute('data-preset'))).toEqual(['powershell', 'powershell'])
    expect(abas.map((aba) => aba.getAttribute('aria-selected'))).toEqual(['false', 'true'])
  })

  it('o `title` do botão diz o atalho', async () => {
    await montar()

    expect(screen.getByTestId('mesa-new-terminal').getAttribute('title')).toContain(
      'Ctrl+Shift+`',
    )
    expect(screen.getByTestId('mesa-new-free').getAttribute('title')).toContain('Ctrl+Shift+N')
  })
})

describe('CA-5 — o atalho faz o mesmo que o clique', () => {
  it('`Ctrl+Shift+`` abre no último perfil, sem tocar na faixa', async () => {
    await montar()

    fireEvent.keyDown(window, { code: 'Backquote', ctrlKey: true, shiftKey: true })

    expect(screen.getByTestId('terminal-tab').getAttribute('data-preset')).toBe('powershell')
  })
})
