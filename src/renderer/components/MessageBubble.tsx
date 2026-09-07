import { memo } from 'react'
import type { JSX } from 'react'

import type { ChatMessage, ChatText } from '../../shared/session'
import { Markdown } from './Markdown'

/** `sm` na tela de chat; `xs` dentro do cartão, que vive numa coluna e não tem largura de sobra. */
export type BubbleScale = 'sm' | 'xs'

/**
 * Uma mensagem que é **fala** de alguém. Nem toda `ChatMessage` é: a `notice` é o app falando
 * *sobre* a sessão e a `tool` é uma ação que a sessão executou (`src/shared/session.ts`) — nenhuma
 * das duas é bolha de ninguém. O tipo estreito é o que impede os desvios das telas de sumirem numa
 * refatoração distraída: sem ele, uma nota do app ou uma entrada de ferramenta cairia no ramo do
 * `else` lá embaixo e apareceria na tela como fala do Claude.
 *
 * Ancorado em `ChatText`, e não mais em `ChatMessage`: desde que a mensagem virou união, uma
 * interseção com a união inteira distribuiria pelos dois braços e produziria um `ChatToolUse` de
 * `role: never` — um tipo que não existe na conversa, guardado num nome que diz que existe.
 */
export type Fala = ChatText & { role: 'user' | 'assistant' }

/**
 * O desvio das duas telas, em forma de guarda.
 *
 * **Guarda, e não a comparação direta**, e a razão sobreviveu à mensagem virar união discriminada —
 * só mudou de andar. Antes era a `ChatMessage` que era achatada; hoje ela discrimina por `role` e
 * separa `ChatToolUse` sozinha, mas o que sobra dela é `ChatText`, que continua sendo **uma
 * interface só** com um `role` de três literais. Comparar o campo ali estreita a *expressão*
 * `message.role` sem estreitar a *variável* `message`, e o `<MessageBubble>` no outro ramo não
 * compilaria. E precisa ser a forma **positiva**: negar uma guarda de `notice` não devolveria a
 * fala, porque o TypeScript só subtrai de união.
 *
 * As **duas** exclusões são deliberadas, mesmo com as telas já desviando a `tool` antes de chegar
 * aqui. Um guarda que respondesse `true` para uma ferramenta seria uma afirmação falsa que o
 * compilador aceitaria — e ele existe justamente para ser a última palavra sobre o que é fala,
 * não para repetir o que a tela já sabe.
 */
export function isFala(message: ChatMessage): message is Fala {
  return message.role !== 'notice' && message.role !== 'tool'
}

interface MessageBubbleProps {
  message: Fala
  scale: BubbleScale
}

/** As quatro peças de casca de uma bolha. Nomeá-las é o que impede uma escala de perder uma. */
interface BubbleSkin {
  user: string
  assistant: string
  label: string
  body: string
}

/**
 * As duas escalas da mesma bolha, em valores copiados sem alteração das duas telas de hoje.
 *
 * Um mapa por escala, e não dois componentes: o que muda entre a tela de chat e o cartão é o
 * enquadramento, nunca a estrutura. O conteúdo em si não tem escala nenhuma — o `Markdown` mede
 * tudo em `em` e herda a daqui.
 */
const SKINS: Record<BubbleScale, BubbleSkin> = {
  sm: {
    user: 'ml-auto max-w-[85%] rounded-lg bg-neutral-800 px-3 py-2',
    assistant: 'max-w-[85%] rounded-lg bg-neutral-900 px-3 py-2',
    label: 'mb-1 text-[11px] tracking-wide text-neutral-500 uppercase',
    body: 'text-sm',
  },
  xs: {
    user: 'ml-auto max-w-[85%] rounded-lg bg-neutral-800 px-2.5 py-1.5',
    assistant: 'max-w-[85%] rounded-lg bg-neutral-900 px-2.5 py-1.5',
    label: 'mb-0.5 text-[10px] tracking-wide text-neutral-500 uppercase',
    body: 'text-xs',
  },
}

/**
 * Uma fala da conversa, nas duas telas.
 *
 * **Memoizada, e isso não é zelo**: o `draft` da caixa de texto mora no mesmo componente que a lista
 * nas duas telas (`Chat.tsx`, `CardChat.tsx`), então sem `memo` cada tecla digitada reparsearia o
 * markdown de todas as mensagens do histórico. A comparação rasa basta porque cada `ChatMessage` é
 * o **mesmo objeto** que veio pela ponte — o redutor de `useSessionView.ts` cria array novo, nunca
 * mensagem nova — e `scale` é literal.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  scale,
}: MessageBubbleProps): JSX.Element {
  const skin = SKINS[scale]

  return (
    <article
      data-testid="message"
      data-role={message.role}
      className={message.role === 'user' ? skin.user : skin.assistant}
    >
      <p className={skin.label}>{message.role === 'user' ? 'você' : 'claude'}</p>

      {/* `div` e não `p`: markdown produz blocos (`<p>`, `<table>`, `<pre>`), e bloco dentro de
          `<p>` é HTML inválido — o navegador fecharia o parágrafo sozinho e o layout quebraria. É a
          mesma razão já registrada em `BoardCardView.tsx`. */}
      <div className={`${skin.body} text-neutral-100`}>
        <Markdown text={message.text} />
      </div>
    </article>
  )
})
