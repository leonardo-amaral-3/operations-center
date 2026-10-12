import { useRef } from 'react'
import type { JSX, PointerEvent } from 'react'

import type { OpenTerminalResult, TerminalPreset, TerminalSnapshot } from '../../shared/ipc'
import { abaParaSpawnar } from '../mesa/mesaState'
import type { MesaState } from '../mesa/mesaState'
import { Button } from '../ui/button'
import { TerminalView } from './TerminalView'

export interface TerminalDockProps {
  state: MesaState
  presets: readonly TerminalPreset[]
  onActivate: (key: string) => void
  onClose: (key: string) => void
  onResize: (height: number) => void
  onOpened: (key: string, snapshot: TerminalSnapshot) => void
  onFailed: (key: string, result: Extract<OpenTerminalResult, { opened: false }>) => void
  onExited: (key: string, exitCode: number) => void
  onFocusConsumed: () => void
  /** Abre um terminal novo no perfil escolhido; a aba que falhou sai logo depois. */
  onNewTerminal: (preset: string) => void
}

/**
 * O dock inferior (#74 §9): a alça de redimensionar, as abas e, por baixo, um `TerminalView` por aba.
 *
 * **Todas as views ficam montadas, e o dock escondido também.** A inativa vai com `hidden`, e o dock
 * fechado idem: desmontar perderia o scrollback e, pior, o xterm deixaria de ouvir o PTY — a saída
 * que chegasse com o dock escondido sumiria. A spec diz "o dock quando `dock.open`"; o que importa
 * dela é que o dock fechado não ocupe tela, e `hidden` entrega isso sem custar o histórico.
 *
 * A barra de abas é a de `BoardTabs.tsx`: `nav role="tablist"`, um `Button` por aba, a ativa no
 * violeta e a inativa no fundo secundário. O `✕` é um botão irmão, não filho — botão dentro de
 * botão é HTML inválido e o clique do `✕` ativaria a aba antes de fechá-la.
 */
export function TerminalDock({
  state,
  presets,
  onActivate,
  onClose,
  onResize,
  onOpened,
  onFailed,
  onExited,
  onFocusConsumed,
  onNewTerminal,
}: TerminalDockProps): JSX.Element {
  const { dock, focus } = state
  const paraSpawnar = abaParaSpawnar(state)?.key ?? null
  const arrasto = useRef<{ y: number; altura: number } | null>(null)

  function aoPressionarAAlca(event: PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    arrasto.current = { y: event.clientY, altura: dock.height }
  }

  function aoArrastarAAlca(event: PointerEvent<HTMLDivElement>): void {
    if (arrasto.current === null) return

    // A alça está na borda de cima: subir o ponteiro **aumenta** o dock.
    onResize(arrasto.current.altura + (arrasto.current.y - event.clientY))
  }

  function aoSoltarAAlca(event: PointerEvent<HTMLDivElement>): void {
    arrasto.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <section
      data-testid="terminal-dock"
      aria-label="Terminais"
      hidden={!dock.open}
      style={{ height: dock.height }}
      className="flex shrink-0 flex-col bg-background"
    >
      <div
        data-testid="dock-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Redimensionar o terminal"
        onPointerDown={aoPressionarAAlca}
        onPointerMove={aoArrastarAAlca}
        onPointerUp={aoSoltarAAlca}
        onPointerCancel={aoSoltarAAlca}
        className="h-1.5 shrink-0 cursor-row-resize touch-none bg-border"
      />

      <nav
        role="tablist"
        aria-label="Terminais abertos"
        className="flex shrink-0 items-center gap-2 overflow-x-auto p-1.5"
      >
        {dock.terminals.map((aba) => {
          const selecionada = aba.key === dock.active

          return (
            <div key={aba.key} className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                role="tab"
                aria-selected={selecionada}
                data-testid="terminal-tab"
                data-preset={aba.preset}
                variant={selecionada ? 'default' : 'neutral'}
                size="xs"
                className="max-w-56 font-heading"
                title={aba.title}
                onClick={() => onActivate(aba.key)}
              >
                <span className="truncate">{aba.title}</span>
              </Button>

              <Button
                type="button"
                variant="neutral"
                size="xs"
                data-testid="terminal-tab-close"
                aria-label={`Fechar ${aba.title}`}
                title="Fechar (Ctrl+Shift+W)"
                onClick={() => onClose(aba.key)}
              >
                <span aria-hidden>✕</span>
              </Button>
            </div>
          )
        })}
      </nav>

      <div className="min-h-0 flex-1">
        {dock.terminals.map((aba) => {
          const ativa = aba.key === dock.active

          return (
            <div key={aba.key} hidden={!ativa} className="h-full">
              <TerminalView
                tab={aba}
                active={ativa && dock.open}
                spawn={aba.key === paraSpawnar}
                focus={ativa && focus === 'terminal'}
                presets={presets}
                onOpened={(snapshot) => onOpened(aba.key, snapshot)}
                onFailed={(result) => onFailed(aba.key, result)}
                onExited={(exitCode) => onExited(aba.key, exitCode)}
                onFocusConsumed={onFocusConsumed}
                onChoosePreset={(preset) => {
                  onNewTerminal(preset)
                  onClose(aba.key)
                }}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
