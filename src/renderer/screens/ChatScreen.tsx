import { useEffect, useReducer } from 'react'
import type { JSX } from 'react'

import type { SessionSnapshot } from '../../shared/ipc'
import type {
  ChatMessage,
  PermissionDecision,
  PermissionRequest,
  SessionInit,
  SessionState,
} from '../../shared/session'
import { Chat } from '../components/Chat'
import { PermissionPrompt } from '../components/PermissionPrompt'
import { StateBadge } from '../components/StateBadge'
import { StatusBar } from '../components/StatusBar'

/** Tudo que a tela sabe da sessão. Nada aqui é derivado: é o que chegou pela ponte, e só. */
interface SessionView {
  id: string | null
  init: SessionInit | null
  state: SessionState
  messages: readonly ChatMessage[]
  permission: PermissionRequest | null
}

type SessionAction =
  | { type: 'snapshot'; snapshot: SessionSnapshot }
  | { type: 'init'; init: SessionInit }
  | { type: 'message'; message: ChatMessage }
  | { type: 'state'; state: SessionState }
  | { type: 'permission'; request: PermissionRequest | null }

/** Antes do retrato a tela não tem sessão nenhuma — e `starting` é exatamente o que o core diz. */
const INITIAL_VIEW: SessionView = {
  id: null,
  init: null,
  state: { kind: 'starting' },
  messages: [],
  permission: null,
}

function reduce(view: SessionView, action: SessionAction): SessionView {
  switch (action.type) {
    case 'snapshot':
      // O retrato é do nascimento da sessão. Qualquer pedido de permissão pendente chega depois,
      // pelo evento — inclusive os que esperaram na fila até este retrato existir.
      return {
        id: action.snapshot.id,
        init: action.snapshot.init ?? null,
        state: action.snapshot.state,
        messages: [...action.snapshot.messages],
        permission: null,
      }
    case 'init':
      return { ...view, init: action.init }
    case 'message':
      // Mensagem já vista não entra de novo: o retrato e os eventos represados podem descrever o
      // mesmo fato, e o `id` (o `uuid` do SDK, ou o do envio) é o que decide se é o mesmo.
      return view.messages.some((message) => message.id === action.message.id)
        ? view
        : { ...view, messages: [...view.messages, action.message] }
    case 'state':
      return {
        ...view,
        state: action.state,
        // Sair de `awaiting_decision` é o que aposenta o pedido: sessão que voltou a trabalhar (ou
        // que morreu) não tem mais decisão a receber, e o prompt não pode sobreviver a ela.
        permission: action.state.kind === 'awaiting_decision' ? view.permission : null,
      }
    case 'permission':
      return { ...view, permission: action.request }
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : 'não foi possível iniciar a sessão'
}

/**
 * A tela de chat: a fatia vertical do #1, alcançável por `OC_SCREEN=chat`.
 *
 * Ela conhece `window.oc` e nada mais: nem Node, nem o SDK, nem o `core`. Tudo que aparece aqui
 * atravessou o contrato do preload.
 */
export function ChatScreen(): JSX.Element {
  const [view, dispatch] = useReducer(reduce, INITIAL_VIEW)

  useEffect(() => {
    let ownId: string | null = null
    let cancelled = false
    const held: { sessionId: string; action: SessionAction }[] = []

    /**
     * Assinar vem **antes** de `start()`: um evento disparado entre a criação da sessão e a
     * assinatura chegaria a ninguém. Enquanto o retrato não volta não dá para saber de quem é o
     * evento, então ele espera — e é no flush, já sabendo o id, que o filtro acontece.
     *
     * O filtro não é zelo abstrato: em desenvolvimento o StrictMode monta o efeito duas vezes, e
     * por um instante existem duas sessões mandando eventos para a mesma janela.
     */
    const deliver = (sessionId: string, action: SessionAction): void => {
      if (!ownId) {
        held.push({ sessionId, action })
        return
      }
      if (sessionId !== ownId) return

      dispatch(action)
    }

    const unsubscribes = [
      window.oc.onInit((event) => {
        deliver(event.sessionId, { type: 'init', init: event.init })
      }),
      window.oc.onMessage((event) => {
        deliver(event.sessionId, { type: 'message', message: event.message })
      }),
      window.oc.onState((event) => {
        deliver(event.sessionId, { type: 'state', state: event.state })
      }),
      window.oc.onPermissionRequest((event) => {
        deliver(event.sessionId, { type: 'permission', request: event.request })
      }),
    ]

    window.oc
      .start()
      .then((snapshot: SessionSnapshot) => {
        if (cancelled) {
          // A tela que pediu esta sessão já se desmontou (o duplo-monte do StrictMode, em dev).
          // Sem isto sobraria um subprocesso do Claude Code vivo sem ninguém olhando para ele.
          void window.oc.close({ sessionId: snapshot.id })
          return
        }

        ownId = snapshot.id
        dispatch({ type: 'snapshot', snapshot })
        for (const event of held) {
          if (event.sessionId === snapshot.id) dispatch(event.action)
        }
        held.length = 0
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Sem isto, uma sessão que não sobe deixa a tela em `Iniciando` para sempre — o silêncio
        // que o estado `failed` existe para quebrar.
        dispatch({ type: 'state', state: { kind: 'failed', reason: reasonOf(error) } })
      })

    return () => {
      cancelled = true
      for (const unsubscribe of unsubscribes) unsubscribe()
      if (ownId) void window.oc.close({ sessionId: ownId })
    }
  }, [])

  function handleSend(text: string): void {
    if (!view.id) return

    void window.oc.send({ sessionId: view.id, text })
  }

  function handleDecide(decision: PermissionDecision): void {
    const { id, permission } = view
    if (!id || !permission) return

    // Some da tela na hora: a confirmação volta pelo `state`, e até lá o botão continuaria clicável
    // para um pedido que já foi respondido.
    dispatch({ type: 'permission', request: null })
    void window.oc.respondPermission({ sessionId: id, requestId: permission.id, decision })
  }

  const dead = view.state.kind === 'closed' || view.state.kind === 'failed'

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight">Operations Center</h1>
        <StateBadge state={view.state} />
      </header>

      {view.permission ? (
        <PermissionPrompt request={view.permission} onDecide={handleDecide} />
      ) : null}

      <Chat messages={view.messages} disabled={dead || !view.id} onSend={handleSend} />

      <StatusBar init={view.init} />
    </div>
  )
}
