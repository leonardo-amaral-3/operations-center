import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { SCROLLBACK } from '../../shared/claude'
import { oklchToSrgb, parseOklch, toHex } from '../../shared/color'
import { terminalKeyAction } from '../mesa/terminalKeys'

/**
 * A infraestrutura xterm que o dock (`TerminalView`) e o terminal Claude (`claudeTerminals`)
 * dividem (#97 §8). Foi extraída do `TerminalView` sem mudar comportamento: as mesmas opções, as
 * mesmas teclas, o mesmo tema.
 */

/** O `Terminal` com o `FitAddon` e os links já carregados, ainda sem `open`. */
export function createXterm(): { term: Terminal; fit: FitAddon } {
  const term = new Terminal({
    cursorBlink: true,
    scrollback: SCROLLBACK,
    fontFamily: 'Cascadia Mono, Consolas, ui-monospace, monospace',
    theme: themeFromTokens(),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // `window.open` cai no `setWindowOpenHandler` do main (`src/main/index.ts`), que entrega
  // `http(s)`/`mailto` ao navegador do sistema e **nega** a janela: zero canal novo, e a guarda
  // que o markdown já usa continua sendo a única.
  term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))

  return { term, fit }
}

/** Copiar/colar e o roteamento de teclas do terminal. Devolve a limpeza. */
export function wireClipboardAndKeys(term: Terminal, host: HTMLElement): () => void {
  term.attachCustomKeyEventHandler((event) => {
    switch (terminalKeyAction(event, term.hasSelection())) {
      case 'copy':
        event.preventDefault()
        // `Ctrl+Shift+C` sem seleção ainda é `copy` (não pode virar `^C` no shell), mas não há o
        // que copiar: escrever a seleção vazia apagaria o que a pessoa tinha na área de transferência.
        if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())

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

  return () => host.removeEventListener('contextmenu', aoClicarComODireito)
}

/**
 * O `ThemePicker` escreve o `data-theme` num `useEffect`, **depois** do ouvinte do evento de
 * tema: ler as variáveis no evento pegaria a combinação antiga. O atributo é a fonte, então é
 * ele que se observa. Devolve a limpeza.
 */
export function followTheme(term: Terminal): () => void {
  const observador = new MutationObserver(() => {
    term.options.theme = themeFromTokens()
  })
  observador.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  return () => observador.disconnect()
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
export function themeFromTokens(): ITheme {
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
