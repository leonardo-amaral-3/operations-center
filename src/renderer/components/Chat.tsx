import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, JSX, KeyboardEvent } from 'react'

import type { ChatMessage } from '../../shared/session'
import { Textarea } from '../ui/textarea'
import { isFala, MessageBubble } from './MessageBubble'

interface ChatProps {
  messages: readonly ChatMessage[]
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
export function Chat({ messages, disabled, onSend }: ChatProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

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
          <p className="text-sm text-foreground/60">
            A sessão está de pé. Escreva a primeira mensagem.
          </p>
        ) : null}

        {/* Nenhuma nota nasce nesta tela hoje — ela não tem botão de parar (o parar é do cartão do
            kanban). Mas sem o desvio o ternário abaixo rotularia uma `notice` como fala do Claude, e
            deixar um render sabidamente errado esperando o dia em que a nota chegar é plantar o bug
            com data marcada. */}
        {messages.map((message) =>
          isFala(message) ? (
            <MessageBubble key={message.id} message={message} scale="sm" />
          ) : (
            <p
              key={message.id}
              data-testid="message"
              data-role="notice"
              className="py-1 text-center text-[11px] tracking-wide text-foreground/60 uppercase"
            >
              {message.text}
            </p>
          ),
        )}

        <div ref={bottom} />
      </div>

      <div className="border-t-2 border-border p-3">
        {/* Sem `min-h-0` aqui, ao contrário do cartão: esta tela é a janela inteira, e a altura
            mínima da primitiva cabe nela sem disputar largura com coluna nenhuma. */}
        <Textarea
          data-testid="chat-input"
          // A janela existe para ser digitada: abrir e ter de clicar na caixa antes é atrito puro.
          autoFocus
          value={draft}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Escreva para a sessão…  Enter envia, Shift+Enter quebra linha."
          className="resize-none"
        />
      </div>
    </main>
  )
}
