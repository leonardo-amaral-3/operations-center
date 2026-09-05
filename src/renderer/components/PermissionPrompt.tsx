import type { JSX } from 'react'

import type { PermissionDecision, PermissionRequest } from '../../shared/session'

interface PermissionPromptProps {
  request: PermissionRequest
  onDecide: (decision: PermissionDecision) => void
}

/**
 * O pedido de permissão do `canUseTool`, com as duas saídas.
 *
 * A frase vem pronta do Claude Code quando ele a manda (`title`, e `displayName` como segunda
 * opção): remontá-la a partir do `toolName` seria reescrever pior o que o SDK já escreveu. O
 * `toolName` é o último recurso justamente porque é o único campo garantido — e continua visível
 * embaixo, porque "permitir" sem saber qual ferramenta é não é uma decisão informada. Quando a
 * frase do SDK *é* o nome da ferramenta, repeti-la embaixo não informa nada.
 */
export function PermissionPrompt({ request, onDecide }: PermissionPromptProps): JSX.Element {
  const headline = request.title ?? request.displayName ?? request.toolName

  return (
    <section
      data-testid="permission-prompt"
      className="flex items-start gap-4 border-b border-amber-500/40 bg-amber-500/10 px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words text-amber-100">{headline}</p>
        {request.description ? (
          <p className="mt-1 text-xs break-words text-amber-200/80">{request.description}</p>
        ) : null}
        {headline === request.toolName ? null : (
          <p className="mt-1 font-mono text-[11px] text-amber-200/60">{request.toolName}</p>
        )}
      </div>

      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          data-testid="permission-allow"
          onClick={() => {
            onDecide('allow')
          }}
          className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-300"
        >
          Permitir
        </button>
        <button
          type="button"
          data-testid="permission-deny"
          onClick={() => {
            onDecide('deny')
          }}
          className="rounded-md border border-amber-400/50 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/10"
        >
          Negar
        </button>
      </div>
    </section>
  )
}
