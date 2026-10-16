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
 * primeira no instante em que o main recusasse a troca. A combinação corrente chega por prop, do
 * `useTemaAplicado` que a tela chama na raiz: é ele quem assina o retrato e escreve o `data-theme`.
 *
 * Semântica de `radiogroup`/`radio` com `aria-checked`, e **não** `tablist`: não há painel a trocar,
 * há uma opção entre três. O princípio é o que a `BoardTabs` declara — a seleção não pode existir só
 * no violeta do fundo.
 */
export function ThemePicker({ corrente }: { readonly corrente: Theme }): JSX.Element {
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
