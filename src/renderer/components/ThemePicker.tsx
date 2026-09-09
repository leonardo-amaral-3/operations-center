import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { THEMES } from '../../shared/theme'
import type { Theme } from '../../shared/theme'
import { Button } from '../ui/button'

/**
 * O seletor da combinação de cores: um botão por combinação declarada, no cabeçalho do kanban.
 *
 * **A lista vem de `THEMES`, e o rótulo é o nome cru.** Uma tabela de rótulos bonitos aqui seria uma
 * segunda lista da folha, e ela divergiria no dia em que a quarta combinação nascesse — o mesmo
 * argumento que fez `THEMES` morar em `src/shared/` em vez de um enum por camada.
 *
 * **Nenhuma escolha própria**, como a `BoardTabs`: o clique só avisa o main, e a combinação corrente
 * volta no retrato. Um estado otimista aqui seria uma segunda fonte da verdade, e ela discordaria da
 * primeira no instante em que o main recusasse a troca. O `useState` daqui não é a escolha — é a
 * cópia local do último retrato, semeada com a mesma semente do primeiro paint.
 *
 * Semântica de `radiogroup`/`radio` com `aria-checked`, e **não** `tablist`: não há painel a trocar,
 * há uma opção entre três. O princípio é o que a `BoardTabs` declara — a seleção não pode existir só
 * no violeta do fundo.
 */
export function ThemePicker(): JSX.Element {
  /**
   * A combinação corrente. Semeada com `window.oc.theme` — a mesma semente que o `main.tsx` escreveu
   * no `<html>` antes do primeiro render —, e não com `THEME_DEFAULT`: os dois valores só coincidem
   * para quem abre na lavanda, e semear com a default acenderia o botão errado por um quadro em
   * quem abre na obsidiana.
   */
  const [corrente, setCorrente] = useState<Theme>(window.oc.theme)

  useEffect(() => {
    // Assinar vem **antes** de pedir, e com a mesma guarda dos três efeitos do `KanbanScreen`: uma
    // troca publicada enquanto a resposta do `readTheme` volta é mais nova que ela, e sem a guarda o
    // retrato em trânsito faria a tela retroceder para a cor de antes do clique.
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
    // Quem escreve o `data-theme` **depois do boot** é este efeito, e o `main.tsx` continua
    // escrevendo a semente antes do primeiro render. Os dois concordam por construção na abertura —
    // o main resolveu a flag do preload e a resposta do `readTheme` do mesmo valor —, então esta
    // primeira escrita reescreve o que já está lá, e as seguintes é que trocam a cor de verdade.
    //
    // No `<html>`, e não numa div desta tela: a folha declara cada combinação num seletor de
    // atributo sobre o documento, e o canvas que o CA-1 mede é o `body` — que está acima de
    // qualquer nó que este componente pudesse pintar.
    document.documentElement.dataset.theme = corrente
  }, [corrente])

  return (
    <div
      role="radiogroup"
      aria-label="Combinação de cores"
      data-testid="theme-picker"
      className="flex items-center gap-2"
    >
      {THEMES.map((theme) => {
        const escolhida = theme === corrente

        return (
          <Button
            key={theme}
            type="button"
            role="radio"
            aria-checked={escolhida}
            data-testid="theme-option"
            // Por onde o smoke acha o botão de **uma** combinação sem depender do rótulo — que é o
            // nome cru hoje, mas é texto na tela, e texto na tela não é contrato de teste.
            data-theme-name={theme}
            // A casca inteira vem da primitiva, como na `BoardTabs`: a escolhida no violeta do
            // acento, as outras no fundo secundário. Nenhuma cor decidida aqui — e nenhuma poderia
            // ser, porque o seletor é justamente o que troca a folha debaixo de si mesmo.
            variant={escolhida ? 'default' : 'neutral'}
            size="xs"
            onClick={() => {
              // Sem adiantar a tela, como o `toggleDangerous`: o botão só acende quando o retrato
              // voltar. Um `setCorrente` aqui pintaria a escolha antes de o main tê-la aceitado.
              void window.oc.setTheme({ theme })
            }}
          >
            {theme}
          </Button>
        )
      })}
    </div>
  )
}
