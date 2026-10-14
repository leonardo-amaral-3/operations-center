// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Mesa } from '../../src/renderer/mesa/Mesa'
import type { FreeSessionCard, LayoutSnapshot } from '../../src/shared/ipc'
import { instalarOc } from './fakeOc'

/**
 * O painel da sessão livre — o teste de DX da task 6 do #74.
 *
 * **Criar uma sessão livre põe o foco na caixa de texto dela** (CA-7): quem aperta `Ctrl+Shift+N`,
 * escolhe a pasta e já pode digitar. Se este teste ficar vermelho, a pessoa voltou a ter que pegar o
 * mouse depois de um diálogo para começar a escrever.
 *
 * E a sessão que ficou sem transcript (`recoverable: false`) aparece com título e pasta, sem
 * histórico — o painel não finge uma conversa que não existe, nem some com a sessão.
 *
 * `TerminalView` entra mockada como em `WindowBar-mesa.test.tsx`: o xterm não roda em `jsdom`.
 */

vi.mock('../../src/renderer/components/TerminalView', () => ({
  TerminalView: (props: { tab: { preset: string; scope?: unknown } }) => (
    <div data-testid="terminal-view" data-scope={JSON.stringify(props.tab.scope ?? null)} />
  ),
}))

// O terminal Claude (#97) monta o xterm de verdade no registro de instâncias; aqui ele é um dublê
// que só conta os `focus()`, porque é isso que o CA-7 passou a observar (não há mais caixa de texto).
const focos = vi.hoisted(() => ({ n: 0 }))

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
    focus(): void {
      focos.n++
    }
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

afterEach(() => {
  cleanup()
  focos.n = 0
})

function painelAberto(ativa: string | null): LayoutSnapshot {
  return {
    dock: { open: false, height: 280, terminals: [], active: null },
    side: { open: true, width: 480, active: ativa },
    lastPreset: null,
  }
}

const SEM_TRANSCRIPT: FreeSessionCard = {
  id: 'free_0',
  title: 'notoria-api',
  dangerous: false,
  recoverable: false,
}

async function montar(
  layout: LayoutSnapshot,
  opcoes: Parameters<typeof instalarOc>[1] = {},
): Promise<ReturnType<typeof instalarOc>> {
  const oc = instalarOc(layout, opcoes)

  render(
    <Mesa>
      <p>kanban</p>
    </Mesa>,
  )
  // Descarrega `readLayout`/`readFree`/`start`: sem isso o clique chegaria antes do `hydrate`.
  await act(async () => {})

  return oc
}

describe('CA-7 — criar uma sessão livre põe o foco na caixa dela', () => {
  it('o cursor cai na caixa de texto, sem clique nenhum depois do diálogo', async () => {
    await montar(painelAberto(null), { criaLivre: true })

    // Nada recebe foco sozinho na abertura do app.
    expect(screen.queryByTestId('claude-terminal')).toBeNull()

    fireEvent.keyDown(window, { code: 'KeyN', ctrlKey: true, shiftKey: true })
    await act(async () => {})

    expect(screen.getByTestId('claude-terminal')).toBeTruthy()
    expect(focos.n).toBe(1)
  })

  it('reabrir o app com o painel aberto numa sessão não põe o foco em lugar nenhum', async () => {
    await montar(painelAberto('free_0'), { livres: [SEM_TRANSCRIPT] })

    // A sessão restaurada está na tela, e mesmo assim o teclado não é levado a ela:
    // digitar sem clicar não pode cair numa conversa que ninguém escolheu.
    expect(screen.getByTestId('claude-terminal')).toBeTruthy()
    expect(focos.n).toBe(0)
  })
})

describe('CA-2 — a sessão sem transcript aparece com título e pasta, sem histórico', () => {
  it('mostra o título, marca `recoverable=false` e não inventa mensagens', async () => {
    await montar(painelAberto('free_0'), { livres: [SEM_TRANSCRIPT] })

    const aba = screen.getByTestId('free-tab')
    expect(aba.textContent).toBe('notoria-api')
    expect(aba.getAttribute('data-free-id')).toBe('free_0')
    expect(aba.getAttribute('data-recoverable')).toBe('false')

    expect(screen.getByTestId('free-no-history')).toBeTruthy()
    // O terminal está lá para a próxima abertura criar uma conversa nova na mesma pasta.
    expect(screen.getByTestId('claude-terminal')).toBeTruthy()
  })

  it('com transcript, não há aviso de "sem histórico"', async () => {
    await montar(painelAberto('free_0'), { livres: [{ ...SEM_TRANSCRIPT, recoverable: true }] })

    expect(screen.getByTestId('free-tab').getAttribute('data-recoverable')).toBe('true')
    expect(screen.queryByTestId('free-no-history')).toBeNull()
  })
})

describe('#97 R2 — o estado do terminal da sessão livre chega ao selo', () => {
  it('um `claude:state` do escopo `free` aparece; o de um cartão não mexe no painel', async () => {
    const oc = await montar(painelAberto('free_0'), { livres: [SEM_TRANSCRIPT] })

    act(() => {
      oc.publicarEstadoClaude({
        scope: { kind: 'card', itemId: 'item_9' },
        id: 'claude_9',
        state: { kind: 'working' },
        dangerous: false,
      })
    })
    expect(screen.getByTestId('state-badge').getAttribute('data-state')).toBe('starting')

    act(() => {
      oc.publicarEstadoClaude({
        scope: { kind: 'free', id: 'free_0' },
        id: 'claude_1',
        state: { kind: 'working' },
        dangerous: false,
      })
    })
    expect(screen.getByTestId('state-badge').getAttribute('data-state')).toBe('working')
  })
})

describe('CA-3 —o "Terminal aqui" convive com o painel e o kanban', () => {
  it('abre o dock no escopo da sessão, sem fechar o painel nem a tela', async () => {
    await montar(painelAberto('free_0'), { livres: [SEM_TRANSCRIPT] })

    fireEvent.click(screen.getByTestId('chat-open-terminal'))

    expect(JSON.parse(screen.getByTestId('terminal-view').getAttribute('data-scope')!)).toEqual({
      kind: 'free',
      id: 'free_0',
    })
    expect(screen.getByText('kanban')).toBeTruthy()
    expect(screen.getByTestId('side-panel')).toBeTruthy()
  })
})

describe('esquecer e renomear', () => {
  it('esquecer pede confirmação: o primeiro clique não apaga, o segundo sim', async () => {
    const oc = await montar(painelAberto('free_0'), { livres: [SEM_TRANSCRIPT] })

    fireEvent.click(screen.getByTestId('free-tab-close'))
    expect(oc.pedidosDaMesa.some((p) => p.startsWith('forgetFree'))).toBe(false)

    fireEvent.click(screen.getByTestId('free-forget-confirm'))
    await act(async () => {})

    expect(oc.pedidosDaMesa).toContain('forgetFree:free_0')
  })

  it('qualquer outro clique desfaz o "Esquecer?"', async () => {
    await montar(painelAberto('free_0'), { livres: [SEM_TRANSCRIPT] })

    fireEvent.click(screen.getByTestId('free-tab-close'))
    fireEvent.pointerDown(screen.getByText('kanban'))

    expect(screen.queryByTestId('free-forget-confirm')).toBeNull()
  })

  it('duplo clique renomeia com Enter e desfaz com Escape', async () => {
    const oc = await montar(painelAberto('free_0'), { livres: [SEM_TRANSCRIPT] })

    fireEvent.doubleClick(screen.getByTestId('free-tab'))
    fireEvent.change(screen.getByTestId('free-rename'), { target: { value: 'api nova' } })
    fireEvent.keyDown(screen.getByTestId('free-rename'), { key: 'Enter' })
    expect(oc.pedidosDaMesa).toContain('renameFree:free_0:api nova')

    fireEvent.doubleClick(screen.getByTestId('free-tab'))
    fireEvent.change(screen.getByTestId('free-rename'), { target: { value: 'descartado' } })
    fireEvent.keyDown(screen.getByTestId('free-rename'), { key: 'Escape' })
    expect(oc.pedidosDaMesa.filter((p) => p.startsWith('renameFree'))).toHaveLength(1)
  })
})
