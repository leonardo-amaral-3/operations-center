import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { Button } from '../ui/button'

/**
 * A faixa que tomou o lugar da barra de título do sistema: a alça de arrasto da janela e os três
 * botões que a comandam.
 *
 * **O nome é `WindowBar` e não `TitleBar`** porque não há título nela. O nome do app não volta para
 * a tela — a barra de tarefas e o `Alt+Tab` já o dizem, e o `title` continua declarado em
 * `createWindow` —, e chamar de barra de título uma faixa sem título seria o arquivo mentindo no
 * próprio nome.
 *
 * **Nenhuma escolha própria sobre maximizar**, como a `ThemePicker` sobre a cor: o botão do meio
 * manda a *intenção* pelo canal `toggle` e espera o retrato voltar. Um estado otimista aqui erraria
 * toda vez que a janela mudasse por fora — duplo clique na própria faixa, `Win+↑`, arrasto para o
 * topo —, porque nenhum desses caminhos passa por este componente.
 */
export function WindowBar(): JSX.Element {
  /**
   * A semente é `false`, e não há semente melhor: ao contrário do tema, o preload não carrega a
   * resposta por `additionalArguments`, e a janela **nasce restaurada** — `createWindow` não chama
   * `maximize()`. O primeiro retrato chega no mesmo microtask do monte e corrige, se for o caso.
   */
  const [maximizada, setMaximizada] = useState(false)

  useEffect(() => {
    // Assinar vem **antes** de pedir, e com a mesma guarda do `ThemePicker` e dos quatro efeitos do
    // `KanbanScreen`: uma maximização publicada enquanto a resposta do `readWindow` volta é mais
    // nova que ela, e sem a guarda o retrato em trânsito faria o botão retroceder ao rótulo de
    // antes — dizendo `Maximizar` sobre uma janela que já está maximizada.
    let pushed = false

    const unsubscribe = window.oc.onWindow((next) => {
      pushed = true
      setMaximizada(next.maximized)
    })

    void window.oc.readWindow().then((next) => {
      if (!pushed) setMaximizada(next.maximized)
    })

    return unsubscribe
  }, [])

  return (
    <div
      data-testid="window-bar"
      // `h-10` (40px) e não `h-9`: os botões são `size="xs"` (`h-7`) e trazem `shadow-shadow`, que é
      // 4px para baixo e para a direita. Com 40px sobram 6px acima e 6 abaixo — os 4 da sombra mais
      // 2 de folga —, e são esses 6px que põem a borda superior dos botões **abaixo** dos 5px que o
      // `WM_NCHITTEST` reserva para `HTTOP`: medido, é o que faz a faixa arrastar sem tirar o
      // redimensionamento pela borda de cima.
      //
      // `justify-end` e nada à esquerda: a faixa é alça de arrastar e mais nada. O separador
      // `border-b-2 border-border` é o mesmo de todo cabeçalho do app, e o fundo é canvas, como o
      // cabeçalho logo abaixo dela.
      className="arrasta-a-janela flex h-10 shrink-0 items-center justify-end gap-2 border-b-2 border-border bg-background px-2"
    >
      {/*
       * `nao-arrasta-a-janela` nos três, e ela é obrigatória e não decorativa: um elemento dentro de
       * uma região de arrasto para de receber clique, então sem ela os botões seriam alça de
       * arrastar e nenhum deles funcionaria. Quem vigia isso é a canária de `design-system.test.ts`,
       * que conta um arrasto e três negações neste arquivo.
       *
       * Os glifos são texto em `<span aria-hidden>`, que é o idioma do projeto — `TurnPulse.tsx:71`,
       * `CardContentView.tsx:137`, `ToolEntry.tsx:22-24`, de onde o `✕` já vem. Não há biblioteca de
       * ícone no `package.json` e não há um `<svg>` em `src/renderer/` inteiro.
       */}
      <Button
        type="button"
        variant="neutral"
        size="xs"
        data-testid="window-minimize"
        aria-label="Minimizar"
        className="nao-arrasta-a-janela"
        onClick={() => {
          void window.oc.minimizeWindow()
        }}
      >
        <span aria-hidden>—</span>
      </Button>

      <Button
        type="button"
        variant="neutral"
        size="xs"
        data-testid="window-maximize"
        // O botão **diz a verdade**: o rótulo e o glifo saem do retrato da janela, e não da última
        // intenção enviada. `□` (U+25A1) e não `▢` (U+25A2), que tem canto arredondado — e este card
        // existe justamente para acabar com canto arredondado.
        aria-label={maximizada ? 'Restaurar' : 'Maximizar'}
        className="nao-arrasta-a-janela"
        onClick={() => {
          void window.oc.toggleMaximizeWindow()
        }}
      >
        <span aria-hidden>{maximizada ? '❐' : '□'}</span>
      </Button>

      <Button
        type="button"
        variant="neutral"
        size="xs"
        data-testid="window-close"
        aria-label="Fechar"
        // O mesmo par que `card-end-session` usa nas suas duas ocorrências (`Chat.tsx:155-158` e
        // `:375-378`): é assim que este app pinta ação destrutiva sem inventar variante nova na
        // primitiva. E fechar **é** destrutivo aqui — leva junto toda sessão viva.
        className="nao-arrasta-a-janela bg-danger text-danger-foreground"
        onClick={() => {
          void window.oc.closeWindow()
        }}
      >
        <span aria-hidden>✕</span>
      </Button>
    </div>
  )
}
