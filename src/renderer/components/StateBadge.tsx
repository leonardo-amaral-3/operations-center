import type { JSX } from 'react'

import type { SessionState } from '../../shared/session'

interface StateBadgeProps {
  state: SessionState
}

/**
 * O rótulo e a cor de cada estado.
 *
 * `awaiting_input` e `awaiting_decision` são os dois únicos coloridos, de propósito: são os estados
 * em que a sessão parou para esperar uma pessoa. É o embrião do RF-8 — quando houver muitas sessões
 * num kanban, "quem está me esperando" precisa ser respondido pela cor, sem leitura.
 */
const LOOKS: Record<SessionState['kind'], { label: string; className: string }> = {
  starting: {
    label: 'Iniciando',
    className: 'border-neutral-700 bg-neutral-900 text-neutral-400',
  },
  working: {
    label: 'Trabalhando',
    className: 'border-neutral-700 bg-neutral-900 text-neutral-300',
  },
  awaiting_input: {
    label: 'Sua vez',
    className: 'border-emerald-500 bg-emerald-500/15 text-emerald-300',
  },
  awaiting_decision: {
    label: 'Decisão pendente',
    className: 'border-amber-400 bg-amber-400/15 text-amber-200',
  },
  closed: {
    label: 'Encerrada',
    className: 'border-neutral-800 bg-neutral-900 text-neutral-500',
  },
  failed: {
    label: 'Falhou',
    className: 'border-red-500 bg-red-500/15 text-red-300',
  },
}

/**
 * O sinal visível da sessão. O `data-state` carrega o `kind` cru porque é ele que o smoke lê: a
 * asserção do CA-2 é sobre o estado da máquina, não sobre a frase que ela virou na tela.
 */
export function StateBadge({ state }: StateBadgeProps): JSX.Element {
  const look = LOOKS[state.kind]
  // O motivo da falha só existe neste estado, e é a única informação que o rótulo sozinho não dá.
  const label = state.kind === 'failed' ? `${look.label}: ${state.reason}` : look.label

  return (
    <span
      data-testid="state-badge"
      data-state={state.kind}
      title={label}
      className={`max-w-80 truncate rounded-full border px-3 py-1 text-xs font-medium ${look.className}`}
    >
      {label}
    </span>
  )
}
