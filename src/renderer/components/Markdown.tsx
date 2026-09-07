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
 * A pele veio pelo card #8: toda cor daqui é token do tema, nunca família da paleta.
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

/**
 * As classes do link, compartilhadas pelo `a` e pelo `img` — que também vira link.
 *
 * **Sublinhado grosso no lugar de uma cor de link.** O tema tem uma cor de texto só, e a única
 * outra família disponível é `--main` — o violet da esteira, que é a face da bolha do usuário: um
 * link violet dentro dela desapareceria. O traço de 2px é o que distingue o link em qualquer das
 * duas faces, e é o mesmo argumento que põe `bg-background` no `th` mais abaixo.
 */
const LINK_CLASSES = 'break-all underline decoration-2 underline-offset-2'

/**
 * O mapa de elemento → casca.
 *
 * Toda medida é em `em`, e é isso que faz um mapa só servir a bolha `text-sm` da tela de chat e a
 * `text-xs` do cartão: a escala mora no contêiner, não aqui. Dois mapas divergiriam na primeira
 * correção que só um deles recebesse.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="text-[1.35em] font-heading">{children}</h1>,
  h2: ({ children }) => <h2 className="text-[1.2em] font-heading">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[1.1em] font-heading">{children}</h3>,
  h4: ({ children }) => <h4 className="font-heading">{children}</h4>,
  h5: ({ children }) => <h5 className="font-heading">{children}</h5>,
  h6: ({ children }) => <h6 className="font-heading">{children}</h6>,
  p: ({ children }) => <p className="break-words">{children}</p>,
  strong: ({ children }) => <strong className="font-heading">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-foreground/60 line-through">{children}</del>,

  // A lista de tarefas do GFM precisa perder o marcador — o marcador dela é a caixa. O
  // `mdast-util-to-hast` põe `contains-task-list` na `ul`, e o `defaultSchema` permite essa
  // className de propósito: o componente lê o que recebeu em vez de adivinhar.
  ul: ({ className, children }) => (
    <ul
      className={
        className?.includes('contains-task-list')
          ? 'list-none space-y-1 pl-0'
          : 'list-disc space-y-1 pl-5 marker:text-foreground/60'
      }
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-5 marker:text-foreground/60">{children}</ol>
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
      // `accent-foreground` e não `accent-main`: a caixa marcada precisa aparecer nas duas faces
      // de bolha, e o violet do sistema é justamente a face do usuário.
      className="mr-1.5 align-middle accent-foreground"
    />
  ),

  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-border bg-background pl-3">{children}</blockquote>
  ),
  hr: () => <hr className="border-t-2 border-border" />,

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
    <code className="rounded-base border-2 border-border bg-background px-1 py-0.5 font-mono text-[0.9em]">
      {children}
    </code>
  ),

  // O bloco de código e a tabela rolam na horizontal **dentro do próprio contêiner**: é o que os
  // mantém dentro da largura da bolha do cartão sem quebrar linha de código nem desalinhar coluna.
  // `w-max min-w-full` é o par que encolhe até a bolha quando cabe e cresce até o conteúdo quando
  // não cabe. O `[&_code]` reseta a pílula que o componente de `code` inline traria para dentro do
  // bloco — seletor descendente, determinístico, sem precisar descobrir o pai a partir do nó. O
  // `border-0` entrou nesse reset junto com a borda que o `code` inline ganhou: sem ele todo bloco
  // de código nasceria com uma segunda caixa preta desenhada por dentro da primeira.
  pre: ({ children }) => (
    <div className="overflow-x-auto rounded-base border-2 border-border bg-background">
      <pre className="w-max min-w-full p-2.5 font-mono text-[0.9em] leading-relaxed [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
        {children}
      </pre>
    </div>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-max min-w-full border-collapse border-2 border-border text-left">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b-2 border-border">{children}</thead>,
  // **`bg-background` no `th`, e não `bg-main`**: a bolha do usuário já é `bg-main`, e um cabeçalho
  // de tabela violet dentro de uma bolha violet desaparece. A lavanda recuada é a mesma superfície
  // do `code` e do `pre`, e é a única que funciona nas duas faces de bolha.
  th: ({ children }) => (
    <th className="border-2 border-border bg-background px-2 py-1 align-top font-heading">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-2 border-border px-2 py-1 align-top">{children}</td>,
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
