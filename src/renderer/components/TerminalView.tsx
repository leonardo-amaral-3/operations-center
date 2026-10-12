import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

import { oklchToSrgb, parseOklch, toHex } from '../../shared/color'
import type { OpenTerminalResult, TerminalPreset, TerminalSnapshot } from '../../shared/ipc'
import type { MesaTab } from '../mesa/mesaState'
import { terminalKeyAction } from '../mesa/terminalKeys'
import { TerminalFailure } from './TerminalFailure'

export interface TerminalViewProps {
  tab: MesaTab
  /** A aba que está na tela: a única que mede, spawna e recebe foco. */
  active: boolean
  /** O `abaParaSpawnar` do estado apontou para esta aba: é a hora de pedir o PTY. */
  spawn: boolean
  /** A intenção de foco do estado (`focus === 'terminal'`), já recortada para esta aba. */
  focus: boolean
  presets: readonly TerminalPreset[]
  onOpened: (snapshot: TerminalSnapshot) => void
  onFailed: (result: Extract<OpenTerminalResult, { opened: false }>) => void
  onExited: (exitCode: number) => void
  onFocusConsumed: () => void
  onChoosePreset: (preset: string) => void
}

/**
 * Um xterm por aba (#74 §9). O componente é a ponte entre três mundos que não se conhecem: o
 * `Terminal` do xterm (DOM e canvas), a ponte IPC (`window.oc.*Terminal`) e o estado puro da mesa.
 *
 * **Quem pede o PTY é este componente**, e não o `useMesa`: só ele sabe o `cols`/`rows` que o xterm
 * mediu no contêiner, e o PTY nasce já desse tamanho (`OpenTerminalRequest`). `spawn` chega do estado
 * (`abaParaSpawnar`): só a aba ativa, com o dock aberto, e uma vez — as restauradas esperam a
 * primeira ativação.
 *
 * **Foco é intenção consumida, não efeito de nascer** (CA-7): `term.focus()` só roda quando o estado
 * traz `focus` para uma aba ativa. A aba restaurada pelo `hydrate` também nasce, e se nascer fosse
 * motivo de foco o app roubaria o teclado na abertura.
 *
 * Tudo que o efeito de montagem precisa saber do mundo de fora entra por `ref` (`atual`): ele roda
 * uma vez, e um fechamento sobre as props de então despacharia sempre a partir do primeiro render.
 */
export function TerminalView(props: TerminalViewProps): JSX.Element {
  const { tab, active, spawn, focus, presets } = props

  const atual = useRef(props)
  atual.current = props

  const corpo = useRef<HTMLDivElement>(null)
  const termo = useRef<Terminal | null>(null)
  const abrirRef = useRef<() => void>(() => undefined)
  // O `id` do PTY desta aba, ou `null`. Vive em ref e não em prop porque os eventos de dados chegam
  // entre dois renders — e o primeiro pedaço de saída vem junto da resposta do `openTerminal`.
  const idRef = useRef<string | null>(tab.id)
  const emVoo = useRef(false)

  useEffect(() => {
    idRef.current = tab.id
  }, [tab.id])

  useEffect(() => {
    const host = corpo.current
    if (host === null) return

    let vivo = true

    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: 'Cascadia Mono, Consolas, ui-monospace, monospace',
      theme: themeFromTokens(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // `window.open` cai no `setWindowOpenHandler` do main (`src/main/index.ts`), que entrega
    // `http(s)`/`mailto` ao navegador do sistema e **nega** a janela: zero canal novo, e a guarda
    // que o markdown já usa continua sendo a única.
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))
    term.open(host)
    termo.current = term

    function ajustar(): void {
      // Contêiner escondido (aba inativa, dock fechado) não tem tamanho; o `fit` recusa e fica no
      // que estava. O `ResizeObserver` refaz quando a aba volta à tela.
      try {
        fit.fit()
      } catch {
        // Sem tamanho medível não há o que ajustar; a próxima medição tenta de novo.
      }
    }

    ajustar()

    function escrever(texto: string): void {
      term.write(texto)
    }

    async function abrir(): Promise<void> {
      if (emVoo.current) return
      emVoo.current = true

      ajustar()
      const { tab: aba } = atual.current

      const result = await window.oc.openTerminal({
        preset: aba.preset,
        ...(aba.scope === undefined ? {} : { scope: aba.scope }),
        cols: term.cols,
        rows: term.rows,
      })

      emVoo.current = false

      if (!vivo) {
        // A aba foi fechada com o pedido em voo: o PTY que acabou de nascer não tem dono.
        if (result.opened) void window.oc.closeTerminal({ id: result.terminal.id })

        return
      }

      if (result.opened) {
        idRef.current = result.terminal.id
        atual.current.onOpened(result.terminal)
      } else {
        atual.current.onFailed(result)
      }
    }

    abrirRef.current = () => void abrir()

    const observador = new ResizeObserver(ajustar)
    observador.observe(host)

    const aoRedimensionar = term.onResize(({ cols, rows }) => {
      if (idRef.current !== null) void window.oc.resizeTerminal({ id: idRef.current, cols, rows })
    })

    const aoDigitar = term.onData((data) => {
      if (idRef.current !== null) {
        void window.oc.writeTerminal({ id: idRef.current, data })

        return
      }

      // Aba encerrada: `Enter` reabre o mesmo perfil na mesma pasta (a linha de saída promete isso).
      if (atual.current.tab.exitCode !== null && data === '\r') abrirRef.current()
    })

    term.attachCustomKeyEventHandler((event) => {
      switch (terminalKeyAction(event, term.hasSelection())) {
        case 'copy':
          event.preventDefault()
          void navigator.clipboard.writeText(term.getSelection())

          return false
        case 'paste':
          // Sem o `preventDefault` o `paste` nativo do textarea do xterm colaria uma segunda vez.
          event.preventDefault()
          void navigator.clipboard.readText().then((texto) => term.paste(texto))

          return false
        case 'bubble':
          // Sem `preventDefault`: o `keydown` global da mesa é quem consome a tecla.
          return false
        case 'terminal':
          return true
      }
    })

    function aoClicarComODireito(event: MouseEvent): void {
      event.preventDefault()

      if (term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
      } else {
        void navigator.clipboard.readText().then((texto) => term.paste(texto))
      }
    }

    host.addEventListener('contextmenu', aoClicarComODireito)

    const desassinarDados = window.oc.onTerminalData((event) => {
      if (event.id === idRef.current) escrever(event.data)
    })

    const desassinarSaida = window.oc.onTerminalExit((event) => {
      if (event.id !== idRef.current) return

      idRef.current = null
      escrever(
        `\r\n— processo encerrado (código ${event.exitCode}). Enter reabre, Ctrl+Shift+W fecha —\r\n`,
      )
      atual.current.onExited(event.exitCode)
    })

    // O `ThemePicker` escreve o `data-theme` num `useEffect`, **depois** do ouvinte do evento de
    // tema: ler as variáveis no evento pegaria a combinação antiga. O atributo é a fonte, então é
    // ele que se observa.
    const observadorDoTema = new MutationObserver(() => {
      term.options.theme = themeFromTokens()
    })
    observadorDoTema.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    return () => {
      vivo = false
      termo.current = null
      abrirRef.current = () => undefined
      observadorDoTema.disconnect()
      desassinarSaida()
      desassinarDados()
      host.removeEventListener('contextmenu', aoClicarComODireito)
      aoDigitar.dispose()
      aoRedimensionar.dispose()
      observador.disconnect()
      term.dispose()
    }
  }, [])

  useEffect(() => {
    if (spawn && !emVoo.current) abrirRef.current()
  }, [spawn])

  useEffect(() => {
    if (!focus || !active) return

    termo.current?.focus()
    atual.current.onFocusConsumed()
  }, [focus, active])

  return (
    <div className="relative h-full w-full">
      {/* O xterm continua montado sob a falha: trocar o contêiner perderia o `Terminal` e, no
          `Tentar de novo`, o tamanho que o PTY precisa. `hidden` só o tira da tela. */}
      <div
        ref={corpo}
        data-testid="terminal-host"
        hidden={tab.failure !== null}
        className="h-full w-full p-1"
      />

      {tab.failure !== null ? (
        <div className="absolute inset-0">
          <TerminalFailure
            reason={tab.failure.reason}
            detail={tab.failure.detail}
            presetLabel={presets.find((preset) => preset.id === tab.preset)?.label ?? tab.preset}
            scope={tab.scope}
            presets={presets}
            onRetry={() => abrirRef.current()}
            onChoosePreset={props.onChoosePreset}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * As cores do xterm saem das variáveis do tema **que existem em runtime** — `--background`,
 * `--foreground`, `--main`, `--border` —, nunca das `--color-*` do `@theme inline`, que são só do
 * compilador do Tailwind e não chegam ao CSS final.
 *
 * Os valores vêm na sintaxe de cor da folha, que o xterm não entende, então passam por
 * `parseOklch` → sRGB → hex (`src/shared/color.ts`). Token ausente **ou** em formato que o parser
 * recusa deixa aquela cor no default do xterm: terminal com a cor errada ainda é terminal, e uma
 * exceção aqui o derrubaria antes do primeiro prompt. As 16 cores ANSI ficam no default.
 */
function themeFromTokens(): ITheme {
  const estilo = getComputedStyle(document.documentElement)

  function cor(token: string): string | undefined {
    const bruto = estilo.getPropertyValue(token).trim()
    if (bruto === '') return undefined

    try {
      return toHex(oklchToSrgb(...parseOklch(bruto)))
    } catch {
      return undefined
    }
  }

  const fundo = cor('--background')
  const frente = cor('--foreground')
  const destaque = cor('--main')
  const borda = cor('--border')

  return {
    ...(fundo === undefined ? {} : { background: fundo }),
    ...(frente === undefined ? {} : { foreground: frente, cursor: frente }),
    ...(destaque === undefined ? {} : { selectionBackground: destaque }),
    ...(borda === undefined ? {} : { selectionInactiveBackground: borda }),
  }
}
