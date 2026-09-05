import type { JSX } from 'react'

import { ChatScreen } from './screens/ChatScreen'
import { KanbanScreen } from './screens/KanbanScreen'

/**
 * A raiz: escolhe a tela e nada mais.
 *
 * `window.oc.screen` é um valor, não uma promessa — o preload o resolveu de `process.argv` antes de
 * expor a ponte —, então o primeiro render já desenha a tela certa e nenhuma outra pisca antes.
 *
 * O kanban é o app; `chat` é porta de ambiente sem representação na UI, e existe para o smoke da
 * fatia vertical continuar provando `renderer ↔ main ↔ core ↔ SDK`.
 */
export function App(): JSX.Element {
  return window.oc.screen === 'chat' ? <ChatScreen /> : <KanbanScreen />
}
