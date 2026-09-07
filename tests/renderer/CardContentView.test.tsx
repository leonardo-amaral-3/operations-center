import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { CardComment, CardContent } from '../../src/shared/board'
import { CardContentView } from '../../src/renderer/components/CardContentView'
import type { ContentState } from '../../src/renderer/components/CardContentView'

/**
 * O CA-1 e o CA-2 do card #13 pelo lado da tela, mais a linha do CA-7 que se prova sem sessão.
 *
 * O aparato é o mesmo do `MessageBubble.test.tsx`: `renderToStaticMarkup` sobre o `environment:
 * 'node'` que o Vitest já usa — zero jsdom, zero dependência nova. O componente é puro justamente
 * para caber aqui, e o que se afirma é a **saída**, que é onde os dois critérios moram.
 *
 * **A armadilha herdada**: `renderToStaticMarkup` escapa `'` como `&#x27;` e `&` como `&amp;`, logo
 * asserções de "a sintaxe sumiu" são sobre as **sequências** (`##`, `**`, crase, `|`), que nenhuma
 * entidade produz.
 */

/** O corpo de uma issue com o que o CA-1 cobra: título, tabela e bloco de código. */
const CORPO = [
  '## O que muda',
  '',
  'Um parágrafo com **negrito** e `código inline`.',
  '',
  '| campo | valor |',
  '| ----- | ----- |',
  '| Rota  | Curta |',
  '',
  '```ts',
  'const x: number = 1',
  '```',
].join('\n')

function comentario(over: Partial<CardComment> = {}): CardComment {
  return {
    id: 'IC_1',
    author: 'leonardo-amaral-3',
    createdAt: '2026-09-06T20:14:00Z',
    body: 'um comentário qualquer',
    kind: null,
    ...over,
  }
}

function conteudo(over: Partial<CardContent> = {}): CardContent {
  return { number: 13, body: CORPO, comments: [], truncated: false, ...over }
}

interface RenderOptions {
  pending?: boolean
  open?: boolean
}

function render(state: ContentState, { pending = false, open = true }: RenderOptions = {}): string {
  return renderToStaticMarkup(
    <CardContentView
      state={state}
      pending={pending}
      open={open}
      onToggle={() => undefined}
      onReload={() => undefined}
    />,
  )
}

/** O texto que sobra quando as tags saem — é nele que a sintaxe do markdown não pode aparecer. */
function semTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

describe('CA-1 — o conteúdo do card vira elemento, não caractere', () => {
  it('desenha o corpo da issue com título, tabela e bloco de código', () => {
    const html = render({ kind: 'loaded', content: conteudo() })

    expect(html).toContain('<h2')
    expect(html).toContain('<strong')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).toContain('<pre')
    expect(html).toContain('<code')
  })

  it('não deixa sobrar sequência de sintaxe no texto visível', () => {
    // **A metade que costuma faltar**: sem ela, um render que jogasse o markdown cru dentro de um
    // `<p>` passaria em todas as asserções acima — as tags do cabeçalho bastariam.
    const texto = semTags(render({ kind: 'loaded', content: conteudo() }))

    expect(texto).not.toContain('##')
    expect(texto).not.toContain('**')
    expect(texto).not.toContain('`')
    expect(texto).not.toContain('|')
  })

  it('a fixture contém, antes de renderizar, cada sequência que o teste acima cobra', () => {
    // Sanidade da fixture: uma que perdesse a tabela numa edição distraída viraria verde provando
    // menos, e ninguém notaria.
    expect(CORPO).toContain('##')
    expect(CORPO).toContain('**')
    expect(CORPO).toContain('`')
    expect(CORPO).toContain('|')
  })

  it('desenha os comentários na ordem em que vieram, abaixo do corpo', () => {
    const html = render({
      kind: 'loaded',
      content: conteudo({
        comments: [
          comentario({ id: 'IC_1', body: 'primeiro a chegar' }),
          comentario({ id: 'IC_2', body: 'segundo a chegar' }),
        ],
      }),
    })

    expect(html.indexOf('O que muda')).toBeLessThan(html.indexOf('primeiro a chegar'))
    expect(html.indexOf('primeiro a chegar')).toBeLessThan(html.indexOf('segundo a chegar'))
  })

  it('a seção recolhida não desenha corpo nenhum', () => {
    // O contrato do `open`: recolher é não pagar o parse do markdown, e não escondê-lo com CSS.
    const html = render({ kind: 'loaded', content: conteudo() }, { open: false })

    expect(html).toContain('data-testid="card-content"')
    expect(html).not.toContain('data-testid="card-content-body"')
    expect(html).not.toContain('O que muda')
  })
})

describe('CA-2 — cada comentário se identifica', () => {
  /**
   * O **mesmo** `Intl.DateTimeFormat` do componente, e não uma data escrita à mão.
   *
   * `'06/09/2026, 17:14'` literal aqui amarraria o teste ao fuso desta máquina e à versão do ICU
   * deste Node: verde aqui, vermelho no CI, e o vermelho não seria sobre o critério. O que o CA-2
   * cobra é que a data **apareça formatada**, e é isso que esta comparação afirma.
   */
  const DATA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

  it('mostra autor, data e a etiqueta do marcador `gm:`', () => {
    const criadoEm = '2026-09-06T20:14:00Z'
    const html = render({
      kind: 'loaded',
      content: conteudo({
        comments: [comentario({ author: 'leonardo-amaral-3', createdAt: criadoEm, kind: 'spec' })],
      }),
    })

    expect(html).toContain('data-testid="card-comment"')
    expect(html).toContain('data-comment-kind="spec"')
    expect(html).toContain('leonardo-amaral-3')
    expect(html).toContain(DATA.format(new Date(criadoEm)))
    // Case-insensitive porque o atributo em HTML o é, e o que o React emite do `dateTime` do
    // JSX varia com a versão. O que o critério pede é a data legível **e** a máquina-legível.
    expect(html).toMatch(new RegExp(`datetime="${criadoEm}"`, 'i'))
  })

  it('um comentário sem marcador aparece do mesmo jeito, só sem etiqueta', () => {
    const html = render({
      kind: 'loaded',
      content: conteudo({ comments: [comentario({ body: 'sem marcador nenhum', kind: null })] }),
    })

    expect(html).toContain('data-comment-kind=""')
    expect(html).toContain('sem marcador nenhum')
    expect(html).not.toContain('data-slot="badge"')
  })

  it('o marcador não é desenhado — quem o esconde é o pipeline do markdown', () => {
    // O core **não** corta o marcador do `body` (regra 5 do `CardReader`), então a única prova de
    // que ele não chega à tela é esta: o `rehype-sanitize` descarta o nó de comentário.
    const html = render({
      kind: 'loaded',
      content: conteudo({
        body: '',
        comments: [
          comentario({ body: '<!-- gm:spec -->\n\nO conteúdo de verdade.', kind: 'spec' }),
        ],
      }),
    })

    expect(html).not.toContain('<!--')
    expect(html).toContain('O conteúdo de verdade.')
  })

  it('conta removida vira `autor removido`, e não um espaço vazio', () => {
    const html = render({
      kind: 'loaded',
      content: conteudo({ comments: [comentario({ author: null })] }),
    })

    expect(html).toContain('autor removido')
  })

  it('uma data que não é data cai no ISO cru, e não derruba a árvore', () => {
    // `Intl.format` lança `RangeError` sobre um `Invalid Date`. O que chega aqui veio da API.
    const html = render({
      kind: 'loaded',
      content: conteudo({ comments: [comentario({ createdAt: 'ontem à tarde' })] }),
    })

    expect(html).toContain('ontem à tarde')
  })
})

describe('CA-7 — recarregar não apaga o que já está na tela', () => {
  it('com `pending`, o conteúdo antigo continua desenhado e o ⟳ está desabilitado', () => {
    const html = render(
      { kind: 'loaded', content: conteudo({ comments: [comentario({ body: 'o que já veio' })] }) },
      { pending: true },
    )

    expect(html).toContain('o que já veio')
    expect(html).toContain('O que muda')
    expect(html).toMatch(/data-testid="card-content-reload"[^>]*disabled/)
  })

  it('sem `pending`, o ⟳ está clicável', () => {
    const html = render({ kind: 'loaded', content: conteudo() })

    expect(html).toContain('aria-label="Recarregar o conteúdo"')
    expect(html).not.toMatch(/data-testid="card-content-reload"[^>]*disabled/)
  })
})

describe('os estados que não são conteúdo', () => {
  it('`loading` diz que está lendo', () => {
    expect(render({ kind: 'loading' })).toContain('Lendo o card…')
  })

  it('`failed` mostra o motivo e oferece o caminho de volta', () => {
    const html = render({ kind: 'failed', reason: 'repo inacessível ou card removido' })

    expect(html).toContain('repo inacessível ou card removido')
    expect(html).toContain('Tentar de novo')
  })

  it('a âncora do ⟳ não aparece duas vezes na falha', () => {
    // O smoke lê `card-content-reload` por seletor; dois elementos com a âncora fariam todo teste
    // de clique cair em ambiguidade.
    const html = render({ kind: 'failed', reason: 'qualquer coisa' })

    expect(html.match(/data-testid="card-content-reload"/g)).toHaveLength(1)
  })

  it('card sem corpo e sem comentário diz que não há nada escrito', () => {
    const html = render({ kind: 'loaded', content: conteudo({ body: '', comments: [] }) })

    expect(html).toContain('Este card ainda não tem nada escrito.')
  })

  it('card sem corpo mas com comentário desenha o comentário, e não a frase do vazio', () => {
    const html = render({
      kind: 'loaded',
      content: conteudo({ body: '', comments: [comentario({ body: 'só o comentário' })] }),
    })

    expect(html).not.toContain('Este card ainda não tem nada escrito.')
    expect(html).toContain('só o comentário')
  })

  it('`truncated` conta os que vieram, e não o teto do core', () => {
    // O número sai de `comments.length` de propósito: `MAX_COMMENTS` é constante do core, e o
    // renderer não importa o core.
    const html = render({
      kind: 'loaded',
      content: conteudo({
        comments: [comentario({ id: 'IC_1' }), comentario({ id: 'IC_2' })],
        truncated: true,
      }),
    })

    expect(html).toContain('Mostrando os primeiros 2 comentários deste card.')
  })

  it('sem corte, a linha de truncamento não aparece', () => {
    const html = render({
      kind: 'loaded',
      content: conteudo({ comments: [comentario()], truncated: false }),
    })

    expect(html).not.toContain('Mostrando os primeiros')
  })
})
