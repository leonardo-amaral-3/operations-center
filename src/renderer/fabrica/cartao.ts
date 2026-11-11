import type { MouseEvent } from 'react'

/**
 * O cartão de card que abre a tela Card em qualquer ponto (#145, CA-2). O clique que nasce num
 * elemento com função própria dentro do cartão é desse elemento, e o cartão não navega.
 */
export const INTERATIVO_NO_CARTAO =
  'a, button, input, textarea, select, label, [role="button"], [role="checkbox"], [role="link"]'

export function abrirAoClicar(abrir: () => void): (evento: MouseEvent<HTMLElement>) => void {
  return (evento) => {
    const alvo = evento.target
    if (alvo instanceof Element) {
      const interativo = alvo.closest(INTERATIVO_NO_CARTAO)
      if (
        interativo !== null &&
        interativo !== evento.currentTarget &&
        evento.currentTarget.contains(interativo)
      ) {
        return
      }
    }
    abrir()
  }
}
