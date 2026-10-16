import { useEffect, useState } from 'react'

import type { Theme } from '../shared/theme'

/**
 * Aplica a combinação de cores corrente no `<html>` e a devolve.
 *
 * Chamado na **raiz** de cada tela, e não dentro da `ThemePicker`: a janela do card não tem seletor
 * e precisa pintar a mesma combinação, e quem escreve o `data-theme` não pode depender de haver um
 * botão montado.
 *
 * Semeado com `window.oc.theme` — a semente que o `main.tsx` escreveu antes do primeiro render —, e
 * não com `THEME_DEFAULT`: os dois só coincidem para quem abre na lavanda. Assina **antes** de
 * pedir, e o evento mais novo vence a resposta em trânsito do `readTheme`.
 *
 * Nenhuma escolha própria: a combinação só muda quando o main publica, como no seletor.
 */
export function useTemaAplicado(): Theme {
  const [corrente, setCorrente] = useState<Theme>(window.oc.theme)

  useEffect(() => {
    let pushed = false

    const unsubscribe = window.oc.onTheme((next) => {
      pushed = true
      setCorrente(next.theme)
    })

    void window.oc.readTheme().then((next) => {
      if (!pushed) setCorrente(next.theme)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    // O `main.tsx` escreve a semente antes do primeiro render e os dois concordam por construção na
    // abertura; as escritas seguintes é que trocam a cor de verdade. No `<html>`, e não numa div: a
    // folha declara cada combinação num seletor de atributo sobre o documento, e o canvas que o CA-1
    // mede é o `body`.
    document.documentElement.dataset.theme = corrente
  }, [corrente])

  return corrente
}
