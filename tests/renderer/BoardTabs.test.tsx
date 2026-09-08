import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BoardTabs } from '../../src/renderer/components/BoardTabs'
import type { BoardTab } from '../../src/shared/board'

/**
 * O CA-1 pelo lado do componente: uma aba por board descoberto, e a ativa é a que o retrato disse.
 *
 * O aparato é o mesmo do `MessageBubble.test.tsx` e do `fila-na-tela.test.tsx` —
 * `renderToStaticMarkup` dentro do `environment: 'node'` que o Vitest já usa, zero dependência nova
 * e zero jsdom. O que o smoke afirma de fora, com o app de pé, aqui se afirma na saída.
 *
 * As âncoras (`board-tabs`, `board-tab`, `data-board-key`) são contrato da spec: se uma asserção
 * não achar a âncora, quem volta ao nome certo é o componente, nunca o teste.
 */

function aba(key: string, title: string): BoardTab {
  // `board`, `readAt` e `error` não chegam à barra — ela lê `key` e `title` e mais nada. São
  // preenchidos porque o tipo os exige, e não porque o componente os enxerga.
  return { key, title, board: null, readAt: null, error: null }
}

const A = aba('leonardo-amaral-3/2', 'Operations Center')
const B = aba('ICSF-Solutions/19', 'Plataformas v2')

function barra(boards: readonly BoardTab[], activeKey: string | null): string {
  return renderToStaticMarkup(
    <BoardTabs boards={boards} activeKey={activeKey} onActivate={() => {}} />,
  )
}

/** Os `data-board-key`, na ordem em que saíram — e não um `toContain` por aba, que não veria ordem. */
function chaves(html: string): string[] {
  return [...html.matchAll(/data-board-key="([^"]*)"/g)].map(([, key]) => key ?? '')
}

describe('CA-1 — a barra desenha uma aba por board, e nenhuma a mais', () => {
  it('duas abas, na ordem do retrato, com os rótulos dos boards', () => {
    const html = barra([A, B], A.key)

    expect(html).toContain('data-testid="board-tabs"')
    expect(chaves(html)).toEqual([A.key, B.key])
    expect(html).toContain('Operations Center')
    expect(html).toContain('Plataformas v2')
  })

  it('aba única continua sendo desenhada', () => {
    // Cláusula explícita do CA-1.1: uma barra que aparece com dois boards e some com um mudaria a
    // forma do app conforme o dia.
    const html = barra([A], A.key)

    expect(html).toContain('data-testid="board-tabs"')
    expect(chaves(html)).toEqual([A.key])
  })

  it('sem board nenhum a barra fica vazia, e não some', () => {
    const html = barra([], null)

    expect(html).toContain('data-testid="board-tabs"')
    expect(chaves(html)).toEqual([])
  })
})

describe('CA-1 — a aba ativa é a do `activeKey`, e só ela', () => {
  it('`aria-selected` verdadeiro numa aba só', () => {
    const html = barra([A, B], B.key)

    // Contadas, e não procuradas por substring: `aria-selected="true"` em duas abas passaria por um
    // `toContain` e deixaria a barra dizendo que dois boards estão na tela ao mesmo tempo.
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html.match(/aria-selected="false"/g)).toHaveLength(1)
  })

  it('a selecionada é a do retrato, e o par `data-board-key`/`aria-selected` casa', () => {
    const html = barra([A, B], B.key)
    const abas = [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag)
    const selecionada = abas.find((tag) => tag.includes('aria-selected="true"'))

    expect(selecionada).toContain(`data-board-key="${B.key}"`)
  })

  it('sem aba ativa, nenhuma aba se diz selecionada', () => {
    // O retrato pode ter boards e `activeKey: null` — a barra desenha as abas e não inventa uma
    // ativa; quem escolhe é o main.
    const html = barra([A, B], null)

    expect(html).not.toContain('aria-selected="true"')
    expect(chaves(html)).toEqual([A.key, B.key])
  })

  it('uma `activeKey` que não está na lista não seleciona ninguém', () => {
    // O caso do CA-4: o board lembrado saiu dos descobertos. A barra não se defende disso — ela só
    // não mente dizendo que um board fora da lista está na tela.
    const html = barra([A, B], 'ICSF-Solutions/999')

    expect(html).not.toContain('aria-selected="true"')
  })
})

describe('a barra é navegável sem enxergar a cor', () => {
  it('`tablist` na barra e `tab` em cada aba', () => {
    const html = barra([A, B], A.key)

    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
  })

  it('cada aba é um `button` de verdade, com o título inteiro no `title`', () => {
    // `<button>` e não `<div role="button">`: é o que dá teclado de graça. E o `title` porque o
    // rótulo trunca — sem ele, um board de nome longo fica sem recurso.
    const html = barra([A], A.key)

    expect(html).toContain('type="button"')
    expect(html).toContain(`title="${A.title}"`)
  })
})
