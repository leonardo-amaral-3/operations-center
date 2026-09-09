// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WindowBar } from '../../src/renderer/components/WindowBar'
import { instalarOc } from './fakeOc'
import type { OcFake } from './fakeOc'

/**
 * O CA-2 pelo lado do renderer: cada botão chama o membro certo da ponte, e o do meio **diz a
 * verdade**.
 *
 * Em `jsdom`, e não no `renderToStaticMarkup` da maioria dos vizinhos, pela mesma razão escrita em
 * `triagem-sobrevive-ao-monte.test.tsx`: a substância aqui é o efeito que assina e o clique que
 * chama, e nenhum dos dois existe em SSR. O ambiente troca pelo docblock da primeira linha, arquivo
 * a arquivo — o `vitest.config.ts` continua em `environment: 'node'`.
 *
 * O `afterEach(cleanup)` é na mão porque o Vitest aqui roda sem `globals`, e sem ele a faixa de um
 * caso continuaria montada no `document` do seguinte — dois assinantes de `onWindow` no ar, e o
 * registro do falso medindo duas faixas somadas.
 *
 * **O que este arquivo não alcança**: que a faixa arraste a janela sem tirar o redimensionamento.
 * `-webkit-app-region` não existe em `jsdom` e não teria como existir — quem mede isso é o
 * `WM_NCHITTEST`, e ele é item bloqueante da validação em dev. O que dá para vigiar daqui é que os
 * botões carregam `nao-arrasta-a-janela`, e quem conta isso é a canária de `design-system.test.ts`.
 */

afterEach(cleanup)

let oc: OcFake

beforeEach(() => {
  oc = instalarOc()
})

/**
 * Monta a faixa e deixa o retrato do boot chegar.
 *
 * O `act` vazio é o que descarrega o microtask do `readWindow`: sem ele o `setMaximizada` da
 * resposta cairia fora de `act`, e o primeiro caso afirmaria sobre uma faixa que ainda não recebeu
 * retrato nenhum — verde ou vermelho por acidente de agendamento.
 */
async function montar(): Promise<void> {
  render(<WindowBar />)
  await act(async () => {})
}

/** O rótulo acessível e o glifo do botão do meio, que é o par que tem de contar a mesma história. */
function meio(): { rotulo: string | null; glifo: string } {
  const botao = screen.getByTestId('window-maximize')

  return { rotulo: botao.getAttribute('aria-label'), glifo: botao.textContent ?? '' }
}

describe('CA-2 — cada botão da faixa chama o seu membro da ponte', () => {
  it('a faixa assina antes de pedir, e não pede mais nada no monte', async () => {
    await montar()

    // A ordem é a asserção, e não a presença: é dela que depende a guarda `pushed` do efeito. Uma
    // faixa que pedisse antes de assinar perderia o retrato publicado no meio do caminho, e o
    // vermelho disso na janela de verdade é um botão que diz `Maximizar` sobre uma janela
    // maximizada.
    expect(oc.pedidosDaJanela).toEqual(['onWindow', 'readWindow'])
  })

  it('os três cliques chamam `minimize`, `toggle-maximize` e `close`, nessa ordem', async () => {
    await montar()

    fireEvent.click(screen.getByTestId('window-minimize'))
    fireEvent.click(screen.getByTestId('window-maximize'))
    fireEvent.click(screen.getByTestId('window-close'))

    // A lista inteira, e não um `toContain` por botão: assim um botão fiado no membro do vizinho —
    // fechar chamando `minimizeWindow`, que compila e é o pior modo de falha deste card — aparece
    // como diferença de posição, e não some numa asserção que só pergunta "foi chamado?".
    expect(oc.pedidosDaJanela).toEqual([
      'onWindow',
      'readWindow',
      'minimizeWindow',
      'toggleMaximizeWindow',
      'closeWindow',
    ])
  })
})

describe('CA-2 — o botão do meio diz a verdade', () => {
  it('nasce `Maximizar`, vira `Restaurar` quando o retrato diz que maximizou, e volta', async () => {
    await montar()

    // A janela nasce restaurada — `createWindow` não chama `maximize()` —, e é isso que a semente
    // do `useState` e o retrato do boot dizem, os dois.
    expect(meio()).toEqual({ rotulo: 'Maximizar', glifo: '□' })

    act(() => {
      oc.publicarJanela({ maximized: true })
    })

    // O rótulo **e** o glifo, no mesmo par: trocar só um deixaria o leitor de tela e o olho contando
    // histórias diferentes sobre o mesmo botão.
    expect(meio()).toEqual({ rotulo: 'Restaurar', glifo: '❐' })

    act(() => {
      oc.publicarJanela({ maximized: false })
    })

    expect(meio()).toEqual({ rotulo: 'Maximizar', glifo: '□' })
  })

  it('o clique sozinho não muda o rótulo — quem muda é o retrato', async () => {
    await montar()

    fireEvent.click(screen.getByTestId('window-maximize'))
    await act(async () => {})

    // A Decisão 5 pelo lado da tela. Um `setMaximizada(true)` otimista no `onClick` passaria por
    // este caso se ele afirmasse só o caminho feliz — e erraria toda vez que a janela mudasse por
    // fora da faixa (duplo clique nela mesma, `Win+↑`, arrasto ao topo), porque nenhum desses
    // caminhos manda `toggleMaximizeWindow`. O renderer manda a intenção; o estado é da janela.
    expect(meio()).toEqual({ rotulo: 'Maximizar', glifo: '□' })
  })
})
