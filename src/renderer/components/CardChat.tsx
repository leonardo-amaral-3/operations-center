import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'

import type { SessionState } from '../../shared/session'
import { useSessionView } from '../session/useSessionView'
import { isFala, MessageBubble } from './MessageBubble'
import { PermissionPrompt } from './PermissionPrompt'
import { QuestionPrompt } from './QuestionPrompt'
import { StateBadge } from './StateBadge'
import { ToolEntry } from './ToolEntry'
import { TurnPulse } from './TurnPulse'

/**
 * O que o kanban guarda da sessão de um cartão para continuar desenhando-a depois que o chat sai da
 * tela. É o mínimo do CA-6: uma sessão viva num cartão fechado precisa ser visível para ser gerida.
 */
export interface CardSession {
  id: string
  state: SessionState
}

/** O registro do kanban inteiro: `itemId` → a sessão daquele cartão. */
export type CardSessions = Readonly<Record<string, CardSession>>

interface CardChatProps {
  itemId: string
  /** Colapsar fecha a vista, não a conversa (CA-6) — quem encerra é o botão de encerrar. */
  onCollapse: () => void
  /** De quem é a sessão deste cartão, para o cartão fechado saber o que mostrar. */
  onSession: (itemId: string, session: CardSession) => void
}

/**
 * A conversa dentro do cartão do kanban.
 *
 * A sessão é pedida **pelo `itemId`**: quem traduz cartão em pasta é o main, e o renderer nunca
 * manda caminho. Ela também **não** morre quando este componente sai de cena — `closeOnUnmount:
 * false` é o CA-6 escrito em uma linha: colapsar não encerra nada.
 *
 * O histórico tem scroll próprio e altura máxima porque o cartão vive dentro de uma coluna: sem o
 * teto, uma conversa longa empurraria a coluna para sempre e o kanban deixaria de ser um kanban.
 */
export function CardChat({ itemId, onCollapse, onSession }: CardChatProps): JSX.Element {
  const { view, send, decide, answer, stop, end, restart } = useSessionView({
    itemId,
    closeOnUnmount: false,
  })
  const [draft, setDraft] = useState('')
  const history = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (view.id === null) return

    onSession(itemId, { id: view.id, state: view.state })
  }, [itemId, view.id, view.state, onSession])

  // O scroll é do próprio histórico, e não um `scrollIntoView`: dentro de um cartão, pedir ao
  // navegador que traga o fim da conversa à vista arrastaria junto a coluna e o kanban inteiro.
  useEffect(() => {
    const node = history.current
    if (node) node.scrollTop = node.scrollHeight
  }, [view.messages])

  async function pickFolder(): Promise<void> {
    const { chosen } = await window.oc.chooseFolder({ itemId })
    // Só o "houve escolha" volta pela ponte; a pasta fica no main. O `restart` é o caminho de volta:
    // o mesmo `start`, agora com o índice sabendo onde o repo está.
    if (chosen) restart()
  }

  if (view.unknownFolder) {
    return (
      <div className="mt-3 border-t border-neutral-800 pt-3">
        {/* Sem `card-chat` aqui, de propósito: não há sessão e não há conversa. O cartão está aberto
            para pedir a pasta, e é só isso que ele oferece (CA-5). */}
        <p className="text-xs break-words text-neutral-400">
          Não sei em que pasta deste computador o repo deste card vive. Aponte-a e a sessão sobe lá.
        </p>

        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="card-collapse"
            onClick={onCollapse}
            className="cursor-pointer rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Fechar
          </button>
          <button
            type="button"
            data-testid="choose-folder"
            onClick={() => {
              void pickFolder()
            }}
            className="cursor-pointer rounded-md bg-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-900 hover:bg-white"
          >
            Escolher a pasta…
          </button>
        </div>
      </div>
    )
  }

  const dead = view.state.kind === 'closed' || view.state.kind === 'failed'
  // A outra metade do CA-4, e ela mora aqui porque é aqui que a lista está: silêncio com ferramenta
  // rodando é o normal de uma ferramenta demorada, e acusá-lo ensinaria a ignorar a marca.
  const somethingRunning = view.messages.some(
    (message) => message.role === 'tool' && message.status === 'running',
  )
  // A caixa trava enquanto há pergunta aberta, e **não** trava durante uma permissão: com a pergunta
  // o turno está parado esperando o `tool_result`, e o que fosse digitado aqui entraria na fila
  // atrás de uma resposta que ninguém deu. A saída para "nenhuma dessas" é o campo livre da própria
  // pergunta. Na permissão a fila de entrada do core funciona normalmente.
  const mute = dead || view.id === null || view.question !== null

  function submit(): void {
    const text = draft.trim()
    if (!text || mute) return

    setDraft('')
    send(text)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter envia, Shift+Enter quebra linha — a mesma convenção da tela de chat.
    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    submit()
  }

  return (
    <div data-testid="card-chat" className="mt-3 border-t border-neutral-800 pt-3">
      <div ref={history} className="max-h-80 space-y-2 overflow-y-auto">
        {view.messages.length === 0 ? (
          <p className="text-xs text-neutral-600">
            A sessão está de pé. Escreva a primeira mensagem.
          </p>
        ) : null}

        {/* A nota (`notice`) é o app falando sobre a sessão, e por isso não é bolha de ninguém: sem
            o desvio, o ternário abaixo a rotularia como fala do Claude. O `data-testid="message"`
            continua para ela ser contável pela mesma via dos seletores do smoke. */}
        {view.messages.map((message) => {
          // A ação entra na conversa pela mesma porta que a fala, e na posição em que aconteceu:
          // é isso que faz a trilha ser histórico, e não um painel ao lado dele.
          if (message.role === 'tool') return <ToolEntry key={message.id} entry={message} />

          return isFala(message) ? (
            <MessageBubble key={message.id} message={message} scale="xs" />
          ) : (
            <p
              key={message.id}
              data-testid="message"
              data-role="notice"
              className="py-0.5 text-center text-[10px] tracking-wide text-neutral-500 uppercase"
            >
              {message.text}
            </p>
          )
        })}
      </div>

      {view.permission ? (
        <div className="mt-2">
          <PermissionPrompt request={view.permission} onDecide={decide} />
        </div>
      ) : null}

      {view.question ? (
        <div className="mt-2">
          <QuestionPrompt request={view.question} onAnswer={answer} />
        </div>
      ) : null}

      {/* Entre o histórico e a caixa: é onde o spinner do Claude Code vive, e o único lugar em que
          o scroll da conversa não o leva embora justamente quando ele importa. */}
      <TurnPulse activity={view.activity} somethingRunning={somethingRunning} />

      <textarea
        data-testid="card-chat-input"
        value={draft}
        disabled={mute}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onKeyDown={handleKeyDown}
        rows={2}
        placeholder={
          view.question
            ? 'Responda à pergunta acima para voltar a escrever.'
            : 'Escreva para a sessão…  Enter envia, Shift+Enter quebra linha.'
        }
        className="mt-2 w-full resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
      />

      {/* A pasta na tela é o CA-3, e não enfeite: é a única forma de flagrar a olho uma sessão que
          subiu no lugar errado. Ela só aparece quando o `init` chega — a âncora posta antes disso
          deixaria um teste ler um caminho que ainda não é o da sessão. */}
      {view.init ? (
        <p
          data-testid="card-chat-cwd"
          title={view.init.cwd}
          className="mt-2 truncate font-mono text-[10px] text-neutral-500"
        >
          {view.init.cwd}
        </p>
      ) : (
        <p className="mt-2 text-[10px] text-neutral-600">Conectando à sessão do Claude Code…</p>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <StateBadge state={view.state} />
        </div>

        {/* Duas ações distintas, e é o CA-6 inteiro: colapsar devolve o cartão fechado com a sessão
            viva; encerrar mata a sessão. O app nunca faz o segundo por conta própria. */}
        <div className="flex shrink-0 gap-2">
          {/* Renderização condicional, e não `disabled`: o botão ausente é a afirmação que um teste
              faz sem ambiguidade, e o olho não precisa distinguir dois cinzas. A ação do turno vem
              antes das ações da sessão. */}
          {view.state.kind === 'working' ? (
            <button
              type="button"
              data-testid="card-stop-turn"
              onClick={stop}
              className="cursor-pointer rounded-md border border-amber-400/50 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-400/10"
            >
              Parar
            </button>
          ) : null}
          <button
            type="button"
            data-testid="card-collapse"
            onClick={onCollapse}
            className="cursor-pointer rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Colapsar
          </button>
          <button
            type="button"
            data-testid="card-end-session"
            disabled={dead || view.id === null}
            onClick={end}
            className="cursor-pointer rounded-md border border-red-500/50 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Encerrar sessão
          </button>
        </div>
      </div>
    </div>
  )
}
