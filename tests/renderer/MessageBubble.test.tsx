import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MessageBubble } from '../../src/renderer/components/MessageBubble'

/**
 * O CA-1, o CA-2, o CA-3, o CA-4 e o CA-6 do card #9 em forma de teste.
 *
 * O aparato é `renderToStaticMarkup` e não uma biblioteca de teste de componente: `react-dom` já é
 * devDependency e a função roda no `environment: 'node'` que o Vitest já usa — zero dependência
 * nova, zero jsdom. O que se afirma aqui é a **saída**, que é exatamente onde os cinco critérios
 * moram.
 *
 * **Uma armadilha do `renderToStaticMarkup`**: ele escapa `'` como `&#x27;` e `&` como `&amp;`. Uma
 * asserção "o texto renderizado não contém `#`" quebraria em qualquer resposta com apóstrofo, por
 * causa da entidade e não do markdown. Por isso as asserções de "a sintaxe sumiu" são sobre as
 * **sequências** (`##`, `**`, crase, `|`), que nenhuma entidade produz.
 */

/** Uma resposta com os oito elementos do CA-1, mais as duas extensões do GFM. */
const FIXTURE = [
  '## Título de nível 2',
  '',
  'Um parágrafo com **negrito**, `código inline` e ~~riscado~~.',
  '',
  '- item de lista',
  '- outro item',
  '',
  // O título separa as duas listas de propósito: coladas, o markdown as funde numa só e a lista
  // comum herdaria o `contains-task-list` da checklist.
  '### Tarefas',
  '',
  '- [x] tarefa feita',
  '- [ ] tarefa pendente',
  '',
  '| coluna a | coluna b |',
  '| -------- | -------- |',
  '| valor 1  | valor 2  |',
  '',
  '```ts',
  'const x: number = 1',
  '```',
  '',
  '> uma citação',
  '',
  '[o link](https://github.com/x)',
].join('\n')

/** O que o modelo pode escrever e não pode acontecer — a fixture do CA-6. */
const HOSTIL = [
  '<b onclick="alert(1)">negrito por html</b>',
  '',
  "<script>alert('xss')</script>",
  '',
  '<a href="javascript:alert(1)">x</a>',
  '',
  '![gato](https://exemplo.invalido/gato.png)',
].join('\n')

function render(text: string, role: 'user' | 'assistant', scale: 'sm' | 'xs' = 'sm'): string {
  return renderToStaticMarkup(<MessageBubble message={{ id: 'm1', role, text }} scale={scale} />)
}

/** O texto que sobra quando as tags saem — é nele que a sintaxe do markdown não pode aparecer. */
function semTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

describe('CA-1 — o markdown do Claude vira elemento, não caractere', () => {
  it('desenha os oito elementos do critério e as duas extensões do GFM', () => {
    const html = render(FIXTURE, 'assistant')

    expect(html).toContain('<h2')
    expect(html).toContain('<strong')
    expect(html).toContain('<ul')
    expect(html).toContain('<li')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).toContain('<code')
    expect(html).toContain('<pre')
    expect(html).toContain('<blockquote')
    expect(html).toContain('<a href="https://github.com/x"')
    expect(html).toContain('<del')

    // Regex e não string literal: a ordem dos atributos do checkbox vem do nó hast, e prendê-la
    // aqui faria o teste falhar por um detalhe que nenhum critério menciona. O que o CA-1 pede é
    // que a checklist vire caixa, e é isso que está escrito.
    expect(html).toMatch(/<input[^>]*type="checkbox"/)
    expect(html).toMatch(/<input[^>]*disabled/)
  })

  it('não deixa sobrar sequência de sintaxe no texto visível', () => {
    // **A metade que costuma faltar**: sem ela, um render que jogasse o markdown cru dentro de um
    // `<p>` passaria em todas as asserções acima — as tags do `<article>` e do rótulo bastariam.
    const texto = semTags(render(FIXTURE, 'assistant'))

    expect(texto).not.toContain('##')
    expect(texto).not.toContain('**')
    expect(texto).not.toContain('`')
    expect(texto).not.toContain('|')
  })

  it('a fixture contém, antes de renderizar, cada sequência que o teste acima cobra', () => {
    // Sanidade da fixture: uma que perdesse a tabela numa edição distraída viraria verde provando
    // menos, e ninguém notaria.
    expect(FIXTURE).toContain('##')
    expect(FIXTURE).toContain('**')
    expect(FIXTURE).toContain('`')
    expect(FIXTURE).toContain('|')
  })
})

describe('CA-2 — a bolha do usuário passa pelo mesmo caminho', () => {
  it('formata o markdown que o humano digitou', () => {
    const html = render('um **negrito** e um `código`', 'user')

    expect(html).toContain('<strong')
    expect(html).toContain('<code')
    expect(html).toContain('data-role="user"')
    expect(semTags(html)).not.toContain('**')
  })
})

describe('CA-3 — tabela e bloco de código rolam dentro da própria bolha', () => {
  it('embrulha os dois no contêiner de rolagem horizontal', () => {
    const html = render(FIXTURE, 'assistant')

    // O `<div>` imediatamente antes do elemento é o critério: sem ele a tabela larga estica a bolha
    // e a bolha estica a coluna do kanban. O teste mede o mecanismo; a legibilidade em pixel é o
    // passo 2 da verificação pós-deploy.
    expect(html).toContain('<div class="overflow-x-auto"><table')
    expect(html).toMatch(/<div class="overflow-x-auto [^"]*"><pre/)
  })
})

describe('CA-4 — as âncoras de teste seguem nos mesmos elementos', () => {
  it('mantém `data-testid` e `data-role` no `<article>` nas duas escalas', () => {
    for (const scale of ['sm', 'xs'] as const) {
      const html = render('oi', 'assistant', scale)

      expect(html).toContain('<article data-testid="message" data-role="assistant"')
    }
  })

  it('a escala muda o tamanho do corpo, e só isso', () => {
    expect(render('oi', 'assistant', 'sm')).toContain('class="text-sm text-neutral-100"')
    expect(render('oi', 'assistant', 'xs')).toContain('class="text-xs text-neutral-100"')
  })
})

describe('CA-6 — texto do modelo não executa e não busca na rede', () => {
  it('interpreta o HTML benigno embutido', () => {
    // O `rehype-raw` funcionando: sem ele o `<b>` apareceria como caractere na tela, e num app cuja
    // função é ler a resposta do Claude perder pedaço é o pior modo de falha.
    const html = render(HOSTIL, 'assistant')

    expect(html).toContain('<b')
    expect(html).toContain('negrito por html')
  })

  it('não deixa script nem manipulador de evento chegarem ao DOM', () => {
    const html = render(HOSTIL, 'assistant')

    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('href="javascript:')
  })

  it('transforma imagem em link, e não emite `<img>`', () => {
    const html = render(HOSTIL, 'assistant')

    // As duas metades importam: nenhuma requisição de rede nasce do que o modelo escreveu, **e**
    // nada some em silêncio — o texto alternativo continua na tela.
    expect(html).not.toContain('<img')
    expect(html).toContain('gato')
    expect(html).toContain('https://exemplo.invalido/gato.png')
  })
})
