import type { JSX } from 'react'

import { WindowBar } from './components/WindowBar'
import { ChatScreen } from './screens/ChatScreen'
import { KanbanScreen } from './screens/KanbanScreen'

/**
 * A raiz: a faixa da janela acima, a tela escolhida abaixo.
 *
 * `window.oc.screen` é um valor, não uma promessa — o preload o resolveu de `process.argv` antes de
 * expor a ponte —, então o primeiro render já desenha a tela certa e nenhuma outra pisca antes.
 *
 * O kanban é o app; `chat` é porta de ambiente sem representação na UI, e existe para o smoke da
 * fatia vertical continuar provando `renderer ↔ main ↔ core ↔ SDK`.
 *
 * **A faixa é montada aqui, e não no cabeçalho de cada tela.** Ela é da *janela*, e a janela é uma
 * só: na raiz, ela existe em toda tela sem ninguém precisar lembrar — e a tela que nascer amanhã não
 * tem como esquecer os botões e deixar a janela sem como fechar. As duas telas de hoje não mudam:
 * as duas já abrem com `flex h-full flex-col`, e o `h-full` passa a medir contra a caixa do item de
 * flex em vez da raiz.
 */
export function App(): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <WindowBar />
      {/* `min-h-0` porque o filho é `h-full` e rola por dentro: sem ele o item de flex adota a
          altura do conteúdo e o kanban empurra a faixa para fora da janela. */}
      <div className="min-h-0 flex-1">
        {window.oc.screen === 'chat' ? <ChatScreen /> : <KanbanScreen />}
      </div>
    </div>
  )
}
