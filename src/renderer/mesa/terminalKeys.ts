/**
 * O que fazer com uma tecla apertada **dentro** do terminal (#74 §9, CA-6), pura: o evento e "há
 * seleção?" entram, uma de quatro respostas sai.
 *
 * - `copy` — a seleção vai para a área de transferência e a tecla não chega ao shell.
 * - `paste` — a área de transferência vira entrada do shell.
 * - `bubble` — é atalho da mesa (`shortcuts.ts`): o xterm solta a tecla e o `keydown` global a pega.
 * - `terminal` — é do shell, o xterm segue o caminho dele.
 *
 * **`Ctrl+C` só copia com seleção.** Sem ela é o `^C` que interrompe o processo, e roubá-lo quebraria
 * o terminal; com ela, mandar `^C` junto com a cópia mataria o que roda. `Ctrl+Shift+C` e
 * `Ctrl+Shift+V` valem **sempre**, o par que o Windows Terminal também oferece.
 *
 * **Só em `keydown`.** O xterm consulta o gancho também em `keypress` e `keyup`; sem o filtro a cópia
 * rodaria três vezes por aperto. Casa pelo `code` físico, como `shortcuts.ts`, pelo mesmo motivo: a
 * letra muda com Shift e com o teclado, a posição não.
 */

import { shortcutFor } from './shortcuts'

export type TerminalKeyAction = 'copy' | 'paste' | 'bubble' | 'terminal'

/** O pedaço de `KeyboardEvent` que importa — o suficiente para o teste não precisar de DOM. */
export interface TerminalKeyEvent {
  type: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export function terminalKeyAction(
  event: TerminalKeyEvent,
  hasSelection: boolean,
): TerminalKeyAction {
  if (event.type !== 'keydown') return 'terminal'

  // `Alt` e `Meta` são do shell (sequência de escape) e do sistema; nem a cópia nem a mesa os querem.
  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    if (event.code === 'KeyC' && (event.shiftKey || hasSelection)) return 'copy'
    if (event.code === 'KeyV') return 'paste'
  }

  return shortcutFor(event) === null ? 'terminal' : 'bubble'
}
