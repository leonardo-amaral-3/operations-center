import type { JSX } from 'react'

import { Badge } from '../ui/badge'

/**
 * O sinal de que este cartão roda sem o portão (CA-2).
 *
 * Aparece **aberto e colapsado**, e **não depende de sessão nenhuma** — as duas diferenças em relação
 * ao `StateBadge` e ao `ConversationBadge`, e as duas são o critério escrito em componente: a marca é
 * propriedade do **cartão**, existe antes do primeiro clique e precisa ser impossível de perder de
 * vista enquanto se varre o board.
 *
 * **Vermelho, ao contrário do `ConversationBadge`**, e o argumento é o oposto do dele: uma conversa
 * dormente não quer nada de você e por isso é neutra; um chat sem portão é a coisa que se quer ver
 * antes de tudo. `bg-danger` é o token que o `StateBadge` já usa para `failed` e o `Chat` para
 * "Encerrar sessão" — nos três casos ele marca a mesma família.
 *
 * A casca — canto, borda de 2px, sombra — vem da primitiva `Badge`; nada dela é redesenhado aqui.
 */
export function DangerBadge(): JSX.Element {
  return (
    <Badge
      variant="neutral"
      data-testid="danger-badge"
      title="Este cartão roda sem pedir permissão: as ferramentas da sessão executam sozinhas até você desligar o modo"
      className="bg-danger"
    >
      Dangerously
    </Badge>
  )
}
