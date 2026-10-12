import { createContext, useContext } from 'react'

import type { SessionScope } from '../../shared/ipc'

/**
 * "Terminal aqui" (#74 §11): abre um terminal na pasta do escopo, no último perfil.
 *
 * A mesa envolve a tela (`App.tsx`), então o callback nasce no `useMesa` e a tela o pega por aqui —
 * é a ponte entre o dono do estado e o `KanbanScreen`, que de lá o desce **por props** até o
 * `Chat`, no padrão de `onToggleDangerous`. `undefined` = sem mesa em volta (os testes que montam a
 * tela sozinha): o botão simplesmente não aparece.
 */
export const TerminalAquiContext = createContext<((scope: SessionScope) => void) | undefined>(
  undefined,
)

export function useTerminalAqui(): ((scope: SessionScope) => void) | undefined {
  return useContext(TerminalAquiContext)
}
