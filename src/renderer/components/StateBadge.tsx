import type { JSX } from 'react'

import type { SessionState } from '../../shared/session'
import { Badge } from '../ui/badge'
import { cn } from '../ui/cn'

interface StateBadgeProps {
  state: SessionState
}

/**
 * O rótulo e a cor de cada estado.
 *
 * `awaiting_input`, `awaiting_decision` e `awaiting_answer` são os únicos coloridos, de propósito:
 * são os estados em que a sessão parou para esperar uma pessoa. É o embrião do RF-8 — quando houver muitas sessões
 * num kanban, "quem está me esperando" precisa ser respondido pela cor, sem leitura.
 *
 * É aqui que a divisão semântica do tema vira código: os quatro tokens de estado marcam **o que a
 * sessão quer de você**, e o acento violet (`--main`) fica de fora — ele marca a esteira. Por isso
 * nenhum destes é a variante default do `Badge`, que é `bg-main`.
 */
const LOOKS: Record<SessionState['kind'], { label: string; className: string }> = {
  starting: {
    label: 'Iniciando',
    className: 'bg-secondary-background text-foreground/70',
  },
  working: {
    label: 'Trabalhando',
    className: 'bg-secondary-background text-foreground',
  },
  awaiting_input: {
    label: 'Sua vez',
    className: 'bg-attention text-attention-foreground',
  },
  awaiting_decision: {
    label: 'Decisão pendente',
    className: 'bg-warning text-warning-foreground',
  },
  awaiting_answer: {
    label: 'Pergunta pendente',
    className: 'bg-question text-question-foreground',
  },
  closed: {
    label: 'Encerrada',
    className: 'bg-secondary-background text-foreground/50',
  },
  failed: {
    label: 'Falhou',
    className: 'bg-danger text-danger-foreground',
  },
}

/**
 * O sinal visível da sessão. O `data-state` carrega o `kind` cru porque é ele que o smoke lê: a
 * asserção do CA-2 é sobre o estado da máquina, não sobre a frase que ela virou na tela.
 */
export function StateBadge({ state }: StateBadgeProps): JSX.Element {
  const look = LOOKS[state.kind]
  // Derivado aqui, e não lido do `SessionView`, de propósito: este componente também desenha o
  // cartão **colapsado** do kanban (`BoardCardView.tsx`), que só tem um `SessionState` na mão.
  const queued =
    state.kind === 'awaiting_decision' || state.kind === 'awaiting_answer' ? state.queued : 0
  // O motivo da falha e o tamanho da fila são as duas informações que o rótulo sozinho não dá.
  const label =
    state.kind === 'failed'
      ? `${look.label}: ${state.reason}`
      : queued > 0
        ? `${look.label} · +${queued}`
        : look.label

  return (
    // `variant="neutral"` nos sete, e não a default: a default é `bg-main`, e usá-la faria os quatro
    // estados coloridos dependerem do `twMerge` para apagar um violet que nunca deveria ter sido
    // pedido. A borda de 2px preta vem da primitiva.
    <Badge
      variant="neutral"
      data-testid="state-badge"
      data-state={state.kind}
      data-queued={String(queued)}
      title={label}
      className={cn('max-w-80 truncate', look.className)}
    >
      {label}
    </Badge>
  )
}
