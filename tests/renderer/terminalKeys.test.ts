import { describe, expect, it } from 'vitest'

import { terminalKeyAction } from '../../src/renderer/mesa/terminalKeys'
import type { TerminalKeyEvent } from '../../src/renderer/mesa/terminalKeys'

/**
 * CA-6 pelo lado das teclas — o teste de DX da task 5: copiar, colar e atalho da mesa dentro do
 * terminal têm de se comportar como o resto do Windows, **sem** custar o `^C` do shell.
 *
 * Puro, sem DOM: `terminalKeyAction` recebe só o pedaço do evento que lê, então o teste monta o
 * evento à mão e roda em `node`, como `shortcuts.test.ts`.
 */

function tecla(parcial: Partial<TerminalKeyEvent>): TerminalKeyEvent {
  return {
    type: 'keydown',
    code: 'KeyA',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...parcial,
  }
}

describe('CA-6 — as oito combinações da seção 9', () => {
  it('`Ctrl+C` com seleção copia, e é essa resposta que impede o `^C` de chegar ao shell', () => {
    expect(terminalKeyAction(tecla({ code: 'KeyC', ctrlKey: true }), true)).toBe('copy')
  })

  it('`Ctrl+C` sem seleção é do shell: o `^C` que interrompe o processo continua chegando', () => {
    expect(terminalKeyAction(tecla({ code: 'KeyC', ctrlKey: true }), false)).toBe('terminal')
  })

  it('`Ctrl+Shift+C` copia sempre, com ou sem seleção', () => {
    const evento = tecla({ code: 'KeyC', ctrlKey: true, shiftKey: true })

    expect(terminalKeyAction(evento, true)).toBe('copy')
    expect(terminalKeyAction(evento, false)).toBe('copy')
  })

  it('`Ctrl+V` cola', () => {
    expect(terminalKeyAction(tecla({ code: 'KeyV', ctrlKey: true }), false)).toBe('paste')
  })

  it('`Ctrl+Shift+V` cola', () => {
    expect(terminalKeyAction(tecla({ code: 'KeyV', ctrlKey: true, shiftKey: true }), false)).toBe(
      'paste',
    )
  })

  it('um atalho da mesa sobe para o `keydown` global em vez de entrar no shell', () => {
    // A crase com Ctrl: `toggle-dock`. Se virasse `terminal`, o atalho que esconde o dock não
    // funcionaria justamente com o foco dentro dele.
    expect(terminalKeyAction(tecla({ code: 'Backquote', ctrlKey: true }), false)).toBe('bubble')
    expect(terminalKeyAction(tecla({ code: 'KeyW', ctrlKey: true, shiftKey: true }), false)).toBe(
      'bubble',
    )
  })

  it('uma letra solta é do shell', () => {
    expect(terminalKeyAction(tecla({ code: 'KeyA' }), false)).toBe('terminal')
  })

  it('`Alt+x` é do shell: é sequência de escape, nunca da mesa', () => {
    expect(terminalKeyAction(tecla({ code: 'KeyX', altKey: true }), false)).toBe('terminal')
  })
})

describe('CA-6 — o que protege o shell', () => {
  it('só `keydown` conta: `keypress` e `keyup` voltam ao xterm, ou a cópia rodaria três vezes', () => {
    for (const type of ['keypress', 'keyup']) {
      expect(terminalKeyAction(tecla({ type, code: 'KeyC', ctrlKey: true }), true)).toBe('terminal')
      expect(terminalKeyAction(tecla({ type, code: 'KeyV', ctrlKey: true }), false)).toBe(
        'terminal',
      )
    }
  })

  it('`Ctrl+Alt+C` e `Ctrl+Meta+V` não são cópia nem colagem', () => {
    expect(terminalKeyAction(tecla({ code: 'KeyC', ctrlKey: true, altKey: true }), true)).toBe(
      'terminal',
    )
    expect(terminalKeyAction(tecla({ code: 'KeyV', ctrlKey: true, metaKey: true }), false)).toBe(
      'terminal',
    )
  })

  it('casa pela posição física da tecla, não pela letra que o layout põe nela', () => {
    // No ABNT2 ou no Dvorak a letra da posição `KeyC` muda; o `code` não. Um `key` aqui copiaria
    // com a tecla errada em metade dos teclados.
    expect(terminalKeyAction(tecla({ code: 'KeyC', ctrlKey: true }), true)).toBe('copy')
    expect(terminalKeyAction(tecla({ code: 'KeyJ', ctrlKey: true }), true)).toBe('terminal')
  })
})
