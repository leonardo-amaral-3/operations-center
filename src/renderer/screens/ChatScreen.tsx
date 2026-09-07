import type { JSX } from 'react'

import type { SessionState } from '../../shared/session'
import { Chat } from '../components/Chat'
import { PermissionPrompt } from '../components/PermissionPrompt'
import { StateBadge } from '../components/StateBadge'
import { StatusBar } from '../components/StatusBar'
import { useSessionView } from '../session/useSessionView'

/** O `unknownFolder` que esta tela nunca deveria ver. Ver o tratamento abaixo. */
const RAZAO_SEM_PASTA = 'a sessão não subiu: o main não resolveu a pasta de trabalho'

/**
 * A tela de chat: a fatia vertical do #1, alcançável por `OC_SCREEN=chat`.
 *
 * Ela conhece `window.oc` e nada mais: nem Node, nem o SDK, nem o `core`. Tudo que aparece aqui
 * atravessou o contrato do preload.
 *
 * A sessão é dela: sem cartão, roda em `OC_CWD`, e sair da tela a encerra — não há kanban por baixo
 * para continuar segurando a conversa.
 */
export function ChatScreen(): JSX.Element {
  const { view, send, decide } = useSessionView({ closeOnUnmount: true })

  // Aqui a `cwd` vem de `OC_CWD` e sempre resolve, então "não sei onde é" é impossível por
  // construção — e é exatamente por isso que não pode passar em silêncio: se um dia acontecer, é o
  // main resolvendo pasta de um jeito que esta tela não conhece.
  const state: SessionState = view.unknownFolder
    ? { kind: 'failed', reason: RAZAO_SEM_PASTA }
    : view.state

  const dead = state.kind === 'closed' || state.kind === 'failed'

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight">Operations Center</h1>
        <StateBadge state={state} />
      </header>

      {view.permission ? <PermissionPrompt request={view.permission} onDecide={decide} /> : null}

      <Chat
        messages={view.messages}
        activity={view.activity}
        disabled={dead || !view.id}
        onSend={send}
      />

      <StatusBar init={view.init} />
    </div>
  )
}
