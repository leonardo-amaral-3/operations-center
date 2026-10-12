import { describe, expect, it } from 'vitest'

import { shortcutFor } from '../../src/renderer/mesa/shortcuts'
import type { MesaCommand, ShortcutEvent } from '../../src/renderer/mesa/shortcuts'

/**
 * A tabela de atalhos da mesa (#74 §7, CA-5), inteira e por `code`.
 *
 * Este é o teste de DX da task: o atalho é a interface mais usada da mesa, e o que ele não pode
 * fazer é falhar em silêncio num teclado que não é o de quem escreveu. Por isso casa pelo `code`
 * físico — com Shift, `key` vira `~` no US e `Dead` no ABNT2 — e cada linha da spec está aqui, com e
 * sem o modificador que a distingue da vizinha.
 */

function evento(code: string, mod: Partial<Omit<ShortcutEvent, 'code'>> = {}): ShortcutEvent {
  return { code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mod }
}

describe('a tabela de atalhos da mesa', () => {
  const tabela: { atalho: string; evento: ShortcutEvent; comando: MesaCommand }[] = [
    { atalho: 'Ctrl+`', evento: evento('Backquote', { ctrlKey: true }), comando: 'toggle-dock' },
    {
      atalho: 'Ctrl+Shift+`',
      evento: evento('Backquote', { ctrlKey: true, shiftKey: true }),
      comando: 'new-terminal',
    },
    {
      atalho: 'Ctrl+Shift+N',
      evento: evento('KeyN', { ctrlKey: true, shiftKey: true }),
      comando: 'new-free',
    },
    {
      atalho: 'Ctrl+Shift+L',
      evento: evento('KeyL', { ctrlKey: true, shiftKey: true }),
      comando: 'toggle-side',
    },
    {
      atalho: 'Ctrl+Shift+W',
      evento: evento('KeyW', { ctrlKey: true, shiftKey: true }),
      comando: 'close-terminal',
    },
    {
      atalho: 'Ctrl+PageUp',
      evento: evento('PageUp', { ctrlKey: true }),
      comando: 'prev-terminal',
    },
    {
      atalho: 'Ctrl+PageDown',
      evento: evento('PageDown', { ctrlKey: true }),
      comando: 'next-terminal',
    },
  ]

  it.each(tabela)('$atalho → $comando', ({ evento: ev, comando }) => {
    expect(shortcutFor(ev)).toBe(comando)
  })

  it.each(tabela)('$atalho com Alt ou Meta apertado → null', ({ evento: ev }) => {
    // `Alt+<tecla>` é sequência de escape do shell e `Meta` é do sistema: nenhum é da mesa.
    expect(shortcutFor({ ...ev, altKey: true })).toBeNull()
    expect(shortcutFor({ ...ev, metaKey: true })).toBeNull()
  })

  it.each(tabela)('$atalho sem Ctrl → null', ({ evento: ev }) => {
    expect(shortcutFor({ ...ev, ctrlKey: false })).toBeNull()
  })

  it('as letras sem Shift ficam para o shell: ^N, ^L e ^W não são da mesa', () => {
    // O motivo de a tabela inteira exigir Shift nas letras: `^C`, `^L`, `^W` e `^N` são do shell
    // dentro do terminal, e roubá-los quebraria o terminal que a própria mesa abre.
    for (const code of ['KeyN', 'KeyL', 'KeyW', 'KeyC', 'KeyV']) {
      expect(shortcutFor(evento(code, { ctrlKey: true }))).toBeNull()
    }
  })

  it('PageUp e PageDown com Shift não são da mesa', () => {
    expect(shortcutFor(evento('PageUp', { ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(shortcutFor(evento('PageDown', { ctrlKey: true, shiftKey: true }))).toBeNull()
  })

  it('casa pelo `code` físico: o `key` que o ABNT2 manda com Shift não importa', () => {
    // O evento de verdade de `Ctrl+Shift+`` no ABNT2: `key` é `Dead`, `code` segue `Backquote`.
    const abnt2 = { ...evento('Backquote', { ctrlKey: true, shiftKey: true }), key: 'Dead' }

    expect(shortcutFor(abnt2)).toBe('new-terminal')
  })

  it('uma tecla qualquer não é atalho', () => {
    expect(shortcutFor(evento('KeyA', { ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(shortcutFor(evento('Enter'))).toBeNull()
  })
})
