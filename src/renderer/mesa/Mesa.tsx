import type { JSX, ReactNode } from 'react'

import { WindowBar } from '../components/WindowBar'
import { useMesa } from './useMesa'

/**
 * A mesa (#74 §7): a faixa da janela acima, a tela escolhida abaixo.
 *
 * Esta task entrega o recorte da base — a faixa com os botões da mesa e a tela. O estado do dock e do
 * painel já mora no `useMesa`, mas `<TerminalDock>` e `<SidePanel>` entram nas tasks seguintes e se
 * penduram aqui: o dock abaixo da tela, o painel à direita dela.
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
    </div>
  )
}
