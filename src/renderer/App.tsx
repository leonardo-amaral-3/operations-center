import type { JSX } from 'react'

import { Mesa } from './mesa/Mesa'
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
 *
 * **A mesa (#74) envolve a tela** e é ela quem monta a faixa: os botões de terminal e de sessão livre
 * acompanham a janela, não uma tela, então moram na mesma raiz — junto do estado do dock e do painel
 * lateral, que sobrevivem à troca de tela.
 */
export function App(): JSX.Element {
  return <Mesa>{window.oc.screen === 'chat' ? <ChatScreen /> : <KanbanScreen />}</Mesa>
}
