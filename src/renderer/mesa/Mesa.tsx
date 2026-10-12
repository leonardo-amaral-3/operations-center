import type { JSX, ReactNode } from 'react'

import { TerminalDock } from '../components/TerminalDock'
import { WindowBar } from '../components/WindowBar'
import { useMesa } from './useMesa'

/**
 * A mesa (#74 §7): a faixa da janela acima, a tela escolhida abaixo.
 *
 * A faixa com os botões da mesa, a tela e, abaixo dela, o `<TerminalDock>`. O estado do dock e do
 * painel mora no `useMesa`; o `<SidePanel>` entra na task seguinte e se pendura à direita da tela.
 */
export function Mesa({ children }: { children: ReactNode }): JSX.Element {
  const mesa = useMesa()

  return (
    <div className="flex h-full flex-col">
      <WindowBar
        presets={mesa.presets}
        freeSessions={mesa.freeSessions}
        onNewTerminal={mesa.newTerminal}
        onNewFree={mesa.newFree}
        onOpenFree={mesa.openFree}
      />
      {/* `min-h-0` porque o filho é `h-full` e rola por dentro: sem ele o item de flex adota a
          altura do conteúdo e o kanban empurra a faixa para fora da janela. */}
      <div className="min-h-0 flex-1">{children}</div>

      {/* Montado assim que há aba, e escondido pelo próprio dock quando `open` é falso: o scrollback
          e a escuta do PTY vivem na `TerminalView`, e desmontá-la os perderia. */}
      {mesa.state.dock.terminals.length > 0 ? (
        <TerminalDock
          state={mesa.state}
          presets={mesa.presets}
          onActivate={(key) => mesa.dispatch({ type: 'activateTerminal', key })}
          onClose={mesa.closeTab}
          onResize={(height) =>
            mesa.dispatch({ type: 'resizeDock', height, viewportHeight: window.innerHeight })
          }
          onOpened={(key, snapshot) => mesa.dispatch({ type: 'terminalOpened', key, snapshot })}
          onFailed={(key, result) => mesa.dispatch({ type: 'terminalFailed', key, result })}
          onExited={(key, exitCode) => mesa.dispatch({ type: 'terminalExited', key, exitCode })}
          onFocusConsumed={() => mesa.dispatch({ type: 'focusConsumed' })}
          onNewTerminal={mesa.newTerminal}
        />
      ) : null}
    </div>
  )
}
