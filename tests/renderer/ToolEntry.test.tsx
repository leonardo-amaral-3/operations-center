import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ToolEntry } from '../../src/renderer/components/ToolEntry'
import type { ChatToolUse, DiffHunk, FileDiff } from '../../src/shared/session'

/**
 * O CA-2, o CA-3 e o CA-4 do card #15 na camada onde eles de fato moram: **a tela**.
 *
 * Os três são afirmações sobre o que a entrada mostra — "mostra `+95`", "diz que 60 ficaram de
 * fora", "não desenha nada quando não houve escrita" —, e prová-los pelo retorno do `diffOf`
 * provaria a metade errada: uma implementação que calculasse certo e desenhasse errado passaria
 * verde no core inteiro.
 *
 * O aparato é o do `MessageBubble.test.tsx`, e não uma biblioteca de teste de componente:
 * `renderToStaticMarkup` roda no `environment: 'node'` que o Vitest já usa, com `react-dom` que já
 * é devDependency — zero dependência nova, zero jsdom, zero testing-library. O que se afirma é a
 * **saída**, que é exatamente o contrato que o smoke também lê.
 */

/** Uma entrada de escrita, com o diff que o caso em questão quer. */
function entrada(diff: FileDiff | null, extras: Partial<ChatToolUse> = {}): ChatToolUse {
  return {
    id: 'tool-1',
    role: 'tool',
    name: 'Edit',
    detail: 'src/core/session/transcript.ts',
    headline: '',
    parentId: null,
    status: 'done',
    diff,
    ...extras,
  }
}

function render(entry: ChatToolUse): string {
  return renderToStaticMarkup(<ToolEntry entry={entry} />)
}

/** O texto que sobra quando as tags saem — é nele que o desenho fala. */
function semTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

/** Quantas vezes uma âncora aparece na saída. */
function quantas(html: string, marca: string): number {
  return html.split(marca).length - 1
}

const TRECHO: DiffHunk = {
  lines: [
    { kind: 'context', number: 12, text: 'export function diffOf(' },
    { kind: 'remove', number: 13, text: '  return null' },
    { kind: 'add', number: 13, text: '  return desenhar(patch)' },
  ],
}

describe('CA-2 (tela) — arquivo novo mostra tamanho, e não um `−0`', () => {
  const CRIACAO: FileDiff = { additions: 95, deletions: 0, hunks: [], truncated: 0 }

  it('desenha `+95` sem nenhuma linha de trecho', () => {
    const html = render(entrada(CRIACAO))

    expect(html).toContain('data-testid="tool-diff"')
    expect(html).toContain('data-additions="95"')
    expect(html).toContain('data-deletions="0"')
    expect(html).not.toContain('data-testid="diff-line"')
    expect(semTags(html)).toContain('+95')
  })

  it('não escreve o `−` em lugar nenhum da saída', () => {
    // **A metade que costuma faltar.** O `data-deletions="0"` continuaria certo numa implementação
    // que escrevesse `+95 −0` na linha de totais — e `−0` é dizer que algo foi removido de um
    // arquivo que não existia. A asserção é sobre o caractere, porque é ele que o olho lê.
    expect(render(entrada(CRIACAO))).not.toContain('−')
  })

  it('o `−M` volta assim que houve remoção', () => {
    // Sanidade da omissão acima: sem este caso, um componente que nunca escrevesse `−` passaria no
    // teste anterior provando o oposto do que ele quer dizer.
    const html = render(entrada({ additions: 4, deletions: 7, hunks: [], truncated: 0 }))

    expect(semTags(html)).toContain('+4 −7')
  })
})

describe('CA-3 (tela) — o corte é dito, não escondido', () => {
  it('`truncated: 60` marca o atributo e escreve a linha do corte', () => {
    const html = render(entrada({ additions: 120, deletions: 8, hunks: [TRECHO], truncated: 60 }))

    expect(html).toContain('data-truncated="60"')
    expect(semTags(html)).toContain('… mais 60 linhas')
  })

  it('`truncated: 0` marca o atributo e não escreve linha de corte nenhuma', () => {
    // O atributo é **sempre presente**, inclusive valendo `0` — mesmo trato do `data-parent`. É o
    // que deixa o teste afirmar "coube inteiro" em vez de só não achar o atributo.
    const html = render(entrada({ additions: 3, deletions: 1, hunks: [TRECHO], truncated: 0 }))

    expect(html).toContain('data-truncated="0"')
    expect(semTags(html)).not.toContain('mais')
  })
})

describe('CA-4 (tela) — sem escrita, sem diff, e o resto do desenho segue igual', () => {
  it('`diff: null` não produz bloco de diff', () => {
    const html = render(entrada(null, { name: 'Bash', detail: 'yarn test' }))

    expect(html).not.toContain('data-testid="tool-diff"')
    expect(html).not.toContain('data-testid="diff-line"')
  })

  it('o desenho de hoje continua inteiro: nome, detalhe e marca de status', () => {
    // A guarda contra o modo de falha real desta task — um bloco novo que, mal encaixado, come a
    // entrada que já existia. A entrada é a mesma nos dois casos, com e sem diff.
    const semDiff = render(entrada(null))
    const comDiff = render(entrada({ additions: 1, deletions: 0, hunks: [TRECHO], truncated: 0 }))

    for (const html of [semDiff, comDiff]) {
      expect(html).toContain('data-testid="tool-entry"')
      expect(html).toContain('data-tool="Edit"')
      expect(html).toContain('data-status="done"')
      expect(html).toContain('data-parent=""')
      expect(semTags(html)).toContain('src/core/session/transcript.ts')
      expect(semTags(html)).toContain('✓')
    }
  })
})

describe('o trecho vira linhas, e cada linha diz de que espécie é', () => {
  it('uma linha por `DiffLine`, com espécie, número e o texto já sem prefixo', () => {
    const html = render(entrada({ additions: 1, deletions: 1, hunks: [TRECHO], truncated: 0 }))

    expect(quantas(html, 'data-testid="diff-line"')).toBe(3)
    expect(html).toContain('data-diff-kind="context"')
    expect(html).toContain('data-diff-kind="remove"')
    expect(html).toContain('data-diff-kind="add"')

    const texto = semTags(html)

    // O número da linha removida é o do lado **velho** e o da adicionada é o do **novo**: os dois
    // valem 13 no `TRECHO`, e é por isso que o `12` do contexto é o que prova que a coluna desenha
    // o número que veio, e não um contador da tela.
    expect(texto).toContain('12')
    expect(texto).toContain('export function diffOf(')
    expect(texto).toContain('return desenhar(patch)')
  })

  it('o glifo sai da tabela e o texto não traz prefixo de volta', () => {
    const html = render(entrada({ additions: 1, deletions: 1, hunks: [TRECHO], truncated: 0 }))

    // O que se prova aqui é a **ausência do reencontro**: quem leu o prefixo foi o core, e o texto
    // que chegou já vem sem ele. Um componente que remontasse `'+' + text` a partir de um texto
    // ainda prefixado daria `++  return ...` — e é isso que esta asserção pega.
    expect(html).not.toContain('+  return desenhar(patch)')
    expect(semTags(html)).toContain('−')
    expect(semTags(html)).toContain('+')
  })

  it('o segundo trecho ganha a fronteira, o primeiro não', () => {
    const umTrecho = render(entrada({ additions: 1, deletions: 1, hunks: [TRECHO], truncated: 0 }))
    const doisTrechos = render(
      entrada({ additions: 2, deletions: 2, hunks: [TRECHO, TRECHO], truncated: 0 }),
    )

    // Entre dois trechos há um salto no arquivo. Sem a fronteira, a tela pediria ao olho que a
    // inferisse comparando números de linha — inferência que o dado já dispensa.
    expect(quantas(umTrecho, 'border-t')).toBe(0)
    expect(quantas(doisTrechos, 'border-t')).toBe(1)
    expect(quantas(doisTrechos, 'data-testid="diff-line"')).toBe(6)
  })

  it('a linha longa é cortada com o texto inteiro no `title`', () => {
    const LONGA = 'const x = '.repeat(40)
    const html = render(
      entrada({
        additions: 1,
        deletions: 0,
        hunks: [{ lines: [{ kind: 'add', number: 7, text: LONGA }] }],
        truncated: 0,
      }),
    )

    // Cortar e não quebrar: quebrar destruiria o alinhamento da coluna de número, e rolagem
    // horizontal aqui dentro seria o painel que o CA-6 recusa.
    expect(html).toContain('truncate')
    expect(html).toContain(`title="${LONGA}"`)
  })
})
