import type { JSX } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

/**
 * O único arquivo do repo que importa `react-markdown`.
 *
 * O texto que chega aqui é escrito pelo modelo, e por isso o pipeline é tão política de segurança
 * quanto formatação: o que o Claude escreve não pode executar nada nem fazer a janela do app buscar
 * coisa na rede. Quem garante isso são o `SCHEMA` e o `COMPONENTS` abaixo — os dois em escopo de
 * módulo, porque recriá-los a cada render obrigaria o react-markdown a remontar o pipeline em toda
 * mensagem do histórico.
 *
 * A pele — cores, ritmo, tipografia — é assunto do card #8; aqui está só a estrutura.
 */

/**
 * O `defaultSchema` do `hast-util-sanitize` (o do GitHub: tabela, checklist e `className` de
 * linguagem já vêm permitidos, e `script` já é removido) com dois recortes.
 */
const SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  // `picture` e `source` fora: um `<source srcSet>` é a outra porta pela qual texto do modelo
  // dispararia requisição de rede a partir da janela do app. `img` **fica** — quem decide o que
  // fazer com ele é o mapa de componentes abaixo, e o que ele faz é nunca emitir um `<img>`.
  // Elemento fora do `tagNames` é desembrulhado (fica só o conteúdo), não apagado.
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => tag !== 'picture' && tag !== 'source'),
  protocols: {
    ...defaultSchema.protocols,
    // Sem `irc`/`ircs`/`xmpp`, que o default permite: `shell.openExternal` entregaria qualquer um
    // deles ao handler registrado no sistema, e nada num chat de desenvolvimento justifica isso.
    href: ['http', 'https', 'mailto'],
  },
}

/** As classes do link, compartilhadas pelo `a` e pelo `img` — que também vira link. */
const LINK_CLASSES = 'break-all text-sky-400 underline underline-offset-2 hover:text-sky-300'

/**
 * O mapa de elemento → casca.
 *
 * Toda medida é em `em`, e é isso que faz um mapa só servir a bolha `text-sm` da tela de chat e a
 * `text-xs` do cartão: a escala mora no contêiner, não aqui. Dois mapas divergiriam na primeira
 * correção que só um deles recebesse.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="text-[1.35em] font-semibold text-neutral-50">{children}</h1>,
  h2: ({ children }) => <h2 className="text-[1.2em] font-semibold text-neutral-50">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[1.1em] font-semibold text-neutral-50">{children}</h3>,
  h4: ({ children }) => <h4 className="font-semibold text-neutral-50">{children}</h4>,
  h5: ({ children }) => <h5 className="font-semibold text-neutral-50">{children}</h5>,
  h6: ({ children }) => <h6 className="font-semibold text-neutral-50">{children}</h6>,
  p: ({ children }) => <p className="break-words">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-neutral-50">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-neutral-500 line-through">{children}</del>,

  // A lista de tarefas do GFM precisa perder o marcador — o marcador dela é a caixa. O
  // `mdast-util-to-hast` põe `contains-task-list` na `ul`, e o `defaultSchema` permite essa
  // className de propósito: o componente lê o que recebeu em vez de adivinhar.
  ul: ({ className, children }) => (
    <ul
      className={
        className?.includes('contains-task-list')
          ? 'list-none space-y-1 pl-0'
          : 'list-disc space-y-1 pl-5 marker:text-neutral-500'
      }
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-5 marker:text-neutral-500">{children}</ol>
  ),
  li: ({ children }) => <li className="break-words">{children}</li>,

  // Repasse **nominal**, e não um spread: o react-markdown passa o nó hast como prop extra a todo
  // componente, e derramá-lo num elemento do DOM rende um aviso de prop desconhecida em cada
  // checkbox da tela. Listar as três que interessam é o que garante isso — e de quebra é uma
  // allowlist: o `*` do `defaultSchema` deixa passar `id`, `name` e `value` em qualquer elemento, e
  // o único `input` que este app quer desenhar é a caixa de uma checklist do GFM.
  input: ({ type, checked, disabled }) => (
    <input
      type={type}
      checked={checked}
      disabled={disabled}
      // `readOnly` explícito além do `disabled` que vem do schema: sem ele o React avisa em console
      // que há `checked` sem `onChange`.
      readOnly
      className="mr-1.5 align-middle accent-neutral-500"
    />
  ),

  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-neutral-700 pl-3 text-neutral-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-neutral-800" />,

  // A porta para fora do app. O `href` já passou pelo filtro de protocolo do `SCHEMA`, e a guarda
  // de `src/main/navigation.ts` o julga de novo do outro lado.
  a: ({ href, children }) => (
    // `target="_blank"` é o que faz o clique cair no `setWindowOpenHandler` do main em vez de
    // navegar esta janela. `rel` fecha o acesso ao `window.opener` mesmo com a janela negada.
    <a href={href} target="_blank" rel="noreferrer noopener" className={LINK_CLASSES}>
      {children}
    </a>
  ),

  // Nunca emite `<img>`: nenhuma requisição de rede nasce do que o modelo escreveu. Vira link, e
  // não some — o texto alternativo e a URL continuam na tela.
  img: ({ src, alt }) => {
    const url = typeof src === 'string' ? src : ''

    return (
      <a href={url} target="_blank" rel="noreferrer noopener" title={url} className={LINK_CLASSES}>
        {alt || url || 'imagem'}
      </a>
    )
  },

  code: ({ children }) => (
    <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[0.9em] text-neutral-100">
      {children}
    </code>
  ),

  // O bloco de código e a tabela rolam na horizontal **dentro do próprio contêiner**: é o que os
  // mantém dentro da largura da bolha do cartão sem quebrar linha de código nem desalinhar coluna.
  // `w-max min-w-full` é o par que encolhe até a bolha quando cabe e cresce até o conteúdo quando
  // não cabe. O `[&_code]` reseta a pílula que o componente de `code` inline traria para dentro do
  // bloco — seletor descendente, determinístico, sem precisar descobrir o pai a partir do nó.
  pre: ({ children }) => (
    <div className="overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950">
      <pre className="w-max min-w-full p-2.5 font-mono text-[0.9em] leading-relaxed text-neutral-200 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
        {children}
      </pre>
    </div>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-max min-w-full border-collapse text-left">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-neutral-700">{children}</thead>,
  th: ({ children }) => (
    <th className="px-2 py-1 align-top font-semibold text-neutral-200">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-t border-neutral-800 px-2 py-1 align-top text-neutral-200">{children}</td>
  ),
}

/** Desenha markdown. É o único caminho pelo qual texto de mensagem chega à tela. */
export function Markdown({ text }: { text: string }): JSX.Element {
  return (
    // `space-y-2` no contêiner, e não margem por elemento: ele aplica só aos filhos diretos, que
    // são exatamente os blocos de topo do markdown. O ritmo fino é assunto da #8.
    <div className="space-y-2 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // A ordem é **invariante de segurança**: o `rehype-raw` transforma as strings cruas de HTML
        // em nós de verdade, e só então o sanitize tem o que podar. Invertida, o sanitize passaria
        // por cima de strings intocadas e o raw as materializaria depois — ou seja, XSS.
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SCHEMA]]}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
