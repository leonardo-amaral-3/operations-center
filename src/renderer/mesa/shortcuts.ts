/**
 * A tabela de atalhos da mesa (#74 §7, CA-5), pura: um evento de teclado entra, um comando ou `null`
 * sai.
 *
 * **Casa pelo `code` físico, nunca pelo `key`.** Com Shift, `key` vira `~` no teclado US e `Dead` no
 * ABNT2 (a crase é tecla morta), e `n` vira `N` — um atalho escrito sobre `key` funcionaria em um
 * teclado e não no do dono deste app. `code` é a posição da tecla, e é igual nos dois.
 *
 * **Nenhum atalho usa `Ctrl+<letra>` sem Shift**: `^C`, `^L`, `^W` e `^N` são do shell dentro do
 * terminal, e a mesa roubá-los quebraria o terminal que ela mesma abre. As letras exigem Shift; as
 * duas teclas sem letra (crase e PageUp/PageDown) não colidem com nada do shell.
 *
 * `Alt` e `Meta` apertados → `null`, sempre: `Alt+<tecla>` é sequência de escape de shell e `Meta`
 * é o atalho do sistema, nenhum dos dois é da mesa.
 */

export type MesaCommand =
  | 'toggle-dock'
  | 'new-terminal'
  | 'new-free'
  | 'toggle-side'
  | 'close-terminal'
  | 'prev-terminal'
  | 'next-terminal'

/** O pedaço de `KeyboardEvent` que importa — o suficiente para o teste não precisar de DOM. */
export interface ShortcutEvent {
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export function shortcutFor(event: ShortcutEvent): MesaCommand | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null

  switch (event.code) {
    case 'Backquote':
      return event.shiftKey ? 'new-terminal' : 'toggle-dock'
    case 'KeyN':
      return event.shiftKey ? 'new-free' : null
    case 'KeyL':
      return event.shiftKey ? 'toggle-side' : null
    case 'KeyW':
      return event.shiftKey ? 'close-terminal' : null
    case 'PageUp':
      return event.shiftKey ? null : 'prev-terminal'
    case 'PageDown':
      return event.shiftKey ? null : 'next-terminal'
    default:
      return null
  }
}

/** O atalho escrito para o `title` dos botões — uma fonte só, para a dica não divergir da tabela. */
export const SHORTCUT_LABEL = {
  'toggle-dock': 'Ctrl+`',
  'new-terminal': 'Ctrl+Shift+`',
  'new-free': 'Ctrl+Shift+N',
  'toggle-side': 'Ctrl+Shift+L',
} as const
