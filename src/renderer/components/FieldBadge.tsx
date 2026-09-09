import type { JSX } from 'react'

import type { BoardCardField } from '../../shared/board'
import { Badge } from '../ui/badge'
import { cn } from '../ui/cn'
import { fieldLook } from './fieldLook'

interface FieldBadgeProps {
  field: BoardCardField
}

/**
 * A etiqueta de um campo do cartão — `Tipo`, `Severidade`, `Classe`, `Rota` — na cor da sua opção.
 *
 * É onde a divisão semântica do #8 vira componente, e ela mudou de canal: o `StateBadge` marca **o
 * que a sessão quer de você** e por isso é forte; esta marca **o que o card é** e por isso é lavada.
 * Não é gosto, é invariante medido — o croma de todo token de etiqueta cabe em metade do menor croma
 * de estado, e é isso que impede catorze cores novas de erodirem o sinal dos crachás da direita.
 *
 * **Nenhuma cor é decidida aqui.** A classe vem do `fieldLook`, que só sabe nomes de token; a
 * escolha do valor é da folha. E o desconhecido cai em **neutro**: string vazia, sem classe de
 * fundo, e a etiqueta sai exatamente como saía antes deste card. É o CA-5, e é o `??` do
 * `fieldLook` — a resposta honesta a um board cujas opções têm outros rótulos.
 *
 * A casca — canto, borda de 2px, sombra — vem da primitiva `Badge`, como no `DangerBadge`; daqui só
 * sai a geometria apertada que a fila de etiquetas do cartão já usava.
 */
export function FieldBadge({ field }: FieldBadgeProps): JSX.Element {
  return (
    // `variant="neutral"` mais a classe do campo, e é o `cn` da primitiva que resolve o encontro:
    // conflito de família, a última vence. A tinta da variante fica de pé — não há token de tinta
    // por etiqueta, pela mesma razão que não há `--attention-foreground`: os catorze são fundo, e o
    // AAA que o CA-3 cobra é `--foreground` sobre cada um deles.
    <Badge
      variant="neutral"
      // A âncora do CA-6: é por ela que o smoke acha a etiqueta de um campo sem escrever o rótulo
      // de nenhuma opção — o que deixa a fixture renomear uma opção sem levar o teste junto.
      data-field={field.name}
      title={`${field.name}: ${field.value}`}
      className={cn('rounded-base px-1.5 py-0 text-[10px] font-normal', fieldLook(field))}
    >
      {field.value}
    </Badge>
  )
}
