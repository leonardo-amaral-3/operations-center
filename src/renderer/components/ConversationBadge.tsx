import type { JSX } from 'react'

import { Badge } from '../ui/badge'

/**
 * O sinal de que este cartão tem conversa a retomar (CA-1).
 *
 * Aparece no cartão **colapsado**, e só quando não há sessão viva: enquanto ela existe, quem informa
 * mais é o `StateBadge`.
 *
 * **Cor neutra, e não um dos quatro tokens de estado.** Os tokens marcam *o que a sessão quer de
 * você* — `bg-attention` é "sua vez", `bg-warning` é "decisão pendente" — e uma conversa dormente
 * não quer nada: ela só existe. Pintá-la com um deles faria o kanban gritar por atenção que ninguém
 * pediu, e é justamente a divisão semântica que o card #8 fixou.
 *
 * A casca — canto, borda de 2px, sombra — vem da primitiva `Badge`; nada dela é redesenhado aqui.
 */
export function ConversationBadge(): JSX.Element {
  return (
    <Badge
      variant="neutral"
      data-testid="conversation-badge"
      title="Há conversa a retomar neste cartão"
      // Mais apagado que o `StateBadge` de uma sessão viva, pelo mesmo motivo da cor neutra:
      // dormente é o segundo plano do cartão, não a manchete dele.
      className="text-foreground/70"
    >
      Conversa
    </Badge>
  )
}
