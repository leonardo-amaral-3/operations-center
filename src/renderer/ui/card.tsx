import { Slot } from '@radix-ui/react-slot'

import * as React from 'react'

import { cn } from './cn'

/**
 * A casca do design system, e só ela: canto, borda de 2px, sombra dura, face e peso de fonte.
 *
 * `asChild` porque a mesma casca precisa ser `section` (coluna, painel), `article` (cartão aberto,
 * bolha) e `button` (cartão fechado, que é clicável). Sem ele, ou a casca seria reescrita à mão
 * nesses lugares — que é o que o card #8 existe para acabar — ou o cartão clicável viraria um
 * `div role="button"` e perderia teclado de graça.
 *
 * **Com `asChild`, todo o estilo vem por aqui**: o `Slot` concatena os dois `className` sem passar
 * pelo `twMerge`, então uma classe conflitante no filho não é resolvida, é empilhada.
 */
function Card({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'div'

  return (
    <Comp
      data-slot="card"
      className={cn(
        'rounded-base flex flex-col shadow-shadow border-2 border-border bg-background text-foreground font-base',
        className,
      )}
      {...props}
    />
  )
}

export { Card }
