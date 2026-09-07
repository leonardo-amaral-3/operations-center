import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, JSX, KeyboardEvent } from 'react'

import type { ChatMessage, TurnActivity } from '../../shared/session'
import { ToolEntry } from './ToolEntry'
import { TurnPulse } from './TurnPulse'

interface ChatProps {
  messages: readonly ChatMessage[]
  /** O pulso do turno corrente, para a linha viva acima da caixa. */
  activity: TurnActivity
  /** Sessão morta (encerrada ou falha): não há para onde mandar texto. */
  disabled: boolean
  onSend: (text: string) => void
}

/**
 * A conversa: a lista, com scroll próprio, e a caixa de texto.
 *
 * O scroll é da lista e não da janela porque o cabeçalho, o pedido de permissão e o rodapé de
 * status precisam continuar visíveis enquanto a conversa cresce — os três são sinal de estado, e
 * sinal que sai da vista não é sinal.
 *
 * A caixa **não** desabilita enquanto a sessão trabalha: o `core` tem fila de entrada, e é ela que
 * torna possível emendar uma segunda instrução sem esperar o turno terminar.
 */
export function Chat({ messages, activity, disabled, onSend }: ChatProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  // A outra metade do CA-4, e ela mora aqui porque é aqui que a lista está: silêncio com ferramenta
  // rodando é o normal de uma ferramenta demorada, e acusá-lo ensinaria a ignorar a marca.
  const somethingRunning = messages.some(
    (message) => message.role === 'tool' && message.status === 'running',
  )

  // A conversa cresce por baixo: sem isto, toda resposta nova nasce fora da vista.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  function submit(): void {
    const text = draft.trim()
    if (!text || disabled) return

    setDraft('')
    onSend(text)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter envia, Shift+Enter quebra linha — a convenção de toda caixa de chat.
    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    submit()
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setDraft(event.target.value)
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-sm text-neutral-600">
            A sessão está de pé. Escreva a primeira mensagem.
          </p>
        ) : null}

        {/* Nenhuma nota nasce nesta tela hoje — ela não tem botão de parar (o parar é do cartão do
            kanban). Mas sem o desvio o ternário abaixo rotularia uma `notice` como fala do Claude, e
            deixar um render sabidamente errado esperando o dia em que a nota chegar é plantar o bug
            com data marcada. */}
        {messages.map((message) => {
          // A ação entra na conversa pela mesma porta que a fala, e na posição em que aconteceu:
          // é isso que faz a trilha ser histórico, e não um painel ao lado dele.
          if (message.role === 'tool') return <ToolEntry key={message.id} entry={message} />

          return message.role === 'notice' ? (
            <p
              key={message.id}
              data-testid="message"
              data-role="notice"
              className="py-1 text-center text-[11px] tracking-wide text-neutral-500 uppercase"
            >
              {message.text}
            </p>
          ) : (
            <article
              key={message.id}
              data-testid="message"
              data-role={message.role}
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-[85%] rounded-lg bg-neutral-800 px-3 py-2'
                  : 'max-w-[85%] rounded-lg bg-neutral-900 px-3 py-2'
              }
            >
              <p className="mb-1 text-[11px] tracking-wide text-neutral-500 uppercase">
                {message.role === 'user' ? 'você' : 'claude'}
              </p>
              <p className="text-sm break-words whitespace-pre-wrap text-neutral-100">
                {message.text}
              </p>
            </article>
          )
        })}

        <div ref={bottom} />
      </div>

      <div className="border-t border-neutral-800 p-3">
        {/* Fora da lista que rola, entre o histórico e a caixa: é onde o spinner do Claude Code
            vive, e é o que impede a linha viva de sair da vista justamente quando ela importa. */}
        <TurnPulse activity={activity} somethingRunning={somethingRunning} />

        <textarea
          data-testid="chat-input"
          // A janela existe para ser digitada: abrir e ter de clicar na caixa antes é atrito puro.
          autoFocus
          value={draft}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Escreva para a sessão…  Enter envia, Shift+Enter quebra linha."
          className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
        />
      </div>
    </main>
  )
}
