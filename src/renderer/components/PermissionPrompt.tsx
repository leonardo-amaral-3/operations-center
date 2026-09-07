import type { JSX } from 'react'

import type { PermissionDecision, PermissionRequest } from '../../shared/session'
import { Button } from '../ui/button'
import { Card } from '../ui/card'

interface PermissionPromptProps {
  request: PermissionRequest
  onDecide: (decision: PermissionDecision) => void
  /** Quantos pedidos esperam **atrás** deste na fila do `SessionHandle`. `0` quando é o único. */
  queued: number
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
export function PermissionPrompt({
  request,
  onDecide,
  queued,
}: PermissionPromptProps): JSX.Element {
  const headline = request.title ?? request.displayName ?? request.toolName

  return (
    // O âmbar é o mesmo `bg-warning` do `awaiting_decision` no `StateBadge`: a cor do painel **é** a
    // sinalização, e é ela que deixa separar permissão de pergunta sem ler nem passar o mouse.
    //
    // `flex-row` derruba o `flex-col` da primitiva pelo `twMerge` (conflito de `flex-direction`): a
    // casca empilha por padrão, e este painel é o texto de um lado e as duas saídas do outro.
    <Card asChild className="flex-row items-start gap-4 bg-warning px-4 py-3">
      {/* `data-request` não é enfeite de teste: com a fila, dois pedidos seguidos deixam o
          `data-state` do crachá parado em `awaiting_decision`, e esta âncora é a única forma de um
          observador de fora distinguir "o pedido mudou" de "nada aconteceu". É dela que o laço dos
          smokes depende. */}
      <section data-testid="permission-prompt" data-request={request.id}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{headline}</p>
          {request.description ? (
            <p className="mt-1 text-xs break-words text-foreground/70">{request.description}</p>
          ) : null}
          {headline === request.toolName ? null : (
            <p className="mt-1 font-mono text-[11px] text-foreground/70">{request.toolName}</p>
          )}
          {/* Quantos ainda vêm **depois** deste, e não o total: é o número que a pessoa precisa na
              hora de clicar. Com o total, o pedido único mostraria `1`. */}
          {queued > 0 ? (
            <p data-testid="prompt-queued" className="mt-1 text-[11px] text-foreground/70">
              mais {queued} esperando
            </p>
          ) : null}
        </div>

        {/* Violet em "Permitir" e branco em "Negar": um botão de acento sobre o âmbar lê como *a*
            ação, e dois botões brancos lado a lado não distinguiriam o sim da recusa.

            `xs` e não `sm` porque este é **o mesmo componente** nas duas telas: dentro do cartão ele
            fica ao lado dos botões `xs` do `CardChat`, e um `sm` ali seria o único botão graúdo da
            coluna de 288px que o CA-3 defende. */}
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            data-testid="permission-allow"
            size="xs"
            onClick={() => {
              onDecide('allow')
            }}
          >
            Permitir
          </Button>
          <Button
            type="button"
            data-testid="permission-deny"
            variant="neutral"
            size="xs"
            onClick={() => {
              onDecide('deny')
            }}
          >
            Negar
          </Button>
        </div>
      </section>
    </Card>
  )
}
