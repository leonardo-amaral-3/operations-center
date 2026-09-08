import { memo } from 'react'
import type { JSX } from 'react'

import type { CardComment, CardContent } from '../../shared/board'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Markdown } from './Markdown'

/**
 * O que a tela sabe do conteúdo daquele card, e nada além disso.
 *
 * Falha é **estado**, e não exceção: o motivo precisa ser desenhado dentro do cartão, do mesmo jeito
 * que `BoardTab.error` é a string que o kanban mostra no lugar dos cartões. Quem produz esta
 * união é o contêiner da task 5; aqui ela só é consumida.
 */
export type ContentState =
  | { kind: 'loading' }
  | { kind: 'failed'; reason: string }
  | { kind: 'loaded'; content: CardContent }

/**
 * Um formatador só, em escopo de módulo.
 *
 * Construir um `Intl.DateTimeFormat` é caro, e um card da esteira tem dezenas de comentários — um
 * por comentário seria pagar aquele preço a cada render de cada bolha. É o mesmo argumento que põe
 * o `SCHEMA` e o `COMPONENTS` do `Markdown` fora do componente.
 */
const DATA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * A data de um comentário, ou o ISO cru quando ela não é uma data.
 *
 * `Intl.format` **lança** `RangeError` sobre um `Invalid Date`, e o que chega aqui veio de fora: o
 * `CardReader` garante que `createdAt` é string, não que é ISO 8601. Sem esta guarda, um campo
 * torto na resposta da API derrubaria a árvore do React e levaria o kanban inteiro junto — a tela
 * ficaria em branco por causa de um comentário.
 */
function formatarData(iso: string): string {
  const data = new Date(iso)

  return Number.isNaN(data.getTime()) ? iso : DATA.format(data)
}

interface CardCommentViewProps {
  comment: CardComment
}

/**
 * Um comentário do card: quem escreveu, quando, a etiqueta do marcador — e o texto.
 *
 * **Memoizado, e isso não é zelo.** O kanban relê o board a cada foco de janela, e sem `memo` o
 * `react-markdown` reparsearia os 44 mil caracteres da spec do card #6 a cada releitura. A
 * comparação rasa basta porque cada `CardComment` é o mesmo objeto que veio pela ponte — quem lê o
 * conteúdo cria objeto novo só quando recarrega. É o mesmo argumento que memoiza o `MessageBubble`.
 */
export const CardCommentView = memo(function CardCommentView({
  comment,
}: CardCommentViewProps): JSX.Element {
  return (
    <article
      data-testid="card-comment"
      // Vazio quando sem marcador, e não ausente: é o que deixa o teste afirmar "este comentário
      // não tem etiqueta" em vez de só não achar o atributo. Mesma escolha do `data-card-assignees`.
      data-comment-kind={comment.kind ?? ''}
      className="border-t-2 border-border pt-2"
    >
      <header className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/60">
        {/* Conta removida devolve `author: null` na API. O rótulo diz isso em vez de mostrar um
            espaço vazio, que se leria como bug. */}
        <span className="font-mono">{comment.author ?? 'autor removido'}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={comment.createdAt}>{formatarData(comment.createdAt)}</time>

        {/* A mesma pílula das etiquetas de campo do cartão, com as mesmas classes: aberto ou
            fechado, o cartão continua parecendo um cartão só. */}
        {comment.kind === null ? null : (
          <Badge
            variant="neutral"
            title={`marcador da esteira: gm:${comment.kind}`}
            className="rounded-base px-1.5 py-0 text-[10px] font-normal"
          >
            {comment.kind}
          </Badge>
        )}
      </header>

      {/* `div` e não `p`: markdown produz blocos (`<p>`, `<table>`, `<pre>`), e bloco dentro de
          `<p>` é HTML inválido. É a mesma razão já registrada no `MessageBubble`.

          O marcador `<!-- gm:X -->` continua no `body` e **não** é desenhado: o `rehype-sanitize`
          do `Markdown` descarta nó de comentário. Quem o esconde é o pipeline, não um corte no
          texto — o core não mutila o que o GitHub tem. */}
      <div className="text-xs">
        <Markdown text={comment.body} />
      </div>
    </article>
  )
})

interface CardContentViewProps {
  state: ContentState
  /** `true` enquanto uma recarga está em voo — o conteúdo antigo fica na tela e o ⟳ desabilita. */
  pending: boolean
  open: boolean
  onToggle: () => void
  onReload: () => void
}

/**
 * O que está escrito no card, dentro do próprio cartão do kanban.
 *
 * **Puro**: sem `window.oc`, sem efeito e sem estado. Quem busca, quem guarda e quem decide se a
 * seção nasce aberta é o contêiner; o que mora aqui é só a forma. É o que torna os dois critérios
 * de tela (CA-1 e CA-2) testáveis com um `renderToStaticMarkup` e nenhum jsdom, do mesmo jeito que
 * o card #9 fez com o `judgeNavigation`.
 */
export function CardContentView({
  state,
  pending,
  open,
  onToggle,
  onReload,
}: CardContentViewProps): JSX.Element {
  return (
    <section data-testid="card-content" className="mt-3 border-t-2 border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        {/* Um `<button>` cru, e não a primitiva: `Button` traz casca — borda de 2px e sombra dura —,
            e uma casca aqui desenharia uma segunda caixa dentro do cartão. O que este controle é,
            é um disclosure: o rótulo, o chevron e o `aria-expanded`. */}
        <button
          type="button"
          data-testid="card-content-toggle"
          aria-expanded={open}
          onClick={onToggle}
          className="flex cursor-pointer items-center gap-1 text-[11px] tracking-wide text-foreground/70 uppercase"
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          Conteúdo
        </button>

        {/* Fica no cabeçalho, e portanto **também quando a seção está recolhida**: recarregar é o
            CA-7, e quem acabou de pedir um comentário à sessão não deveria ter de abrir a seção
            para trazê-lo. */}
        <Button
          type="button"
          data-testid="card-content-reload"
          aria-label="Recarregar o conteúdo"
          title="Recarregar o conteúdo"
          variant="neutral"
          size="xs"
          disabled={pending}
          onClick={onReload}
        >
          <span aria-hidden="true">⟳</span>
        </Button>
      </div>

      {/* Teto de altura e rolagem própria: o cartão vive dentro de uma coluna, e sem o teto a spec
          de 44 mil caracteres do card #6 empurraria o cartão seguinte para fora da vista — o kanban
          deixaria de ser um kanban (CA-4). Quem rola na horizontal é o contêiner de cada tabela e
          de cada bloco de código, dentro do `Markdown`; aqui só a vertical. */}
      {open ? (
        <div data-testid="card-content-body" className="mt-2 max-h-[26rem] overflow-y-auto">
          <Corpo state={state} pending={pending} onReload={onReload} />
        </div>
      ) : null}
    </section>
  )
}

/** Os três estados, separados do enquadramento para o `CardContentView` acima caber num olhar. */
function Corpo({
  state,
  pending,
  onReload,
}: Pick<CardContentViewProps, 'state' | 'pending' | 'onReload'>): JSX.Element {
  if (state.kind === 'loading') {
    return <p className="text-xs text-foreground/60">Lendo o card…</p>
  }

  if (state.kind === 'failed') {
    return (
      <div className="space-y-2">
        <p className="text-xs break-words text-foreground/70">{state.reason}</p>

        {/* Sem `data-testid`, de propósito: a âncora `card-content-reload` é do botão do cabeçalho,
            e duplicá-la aqui faria todo seletor do smoke casar com dois elementos. Este é o mesmo
            gesto, oferecido onde o olho está quando a leitura falha. */}
        <Button type="button" variant="neutral" size="xs" disabled={pending} onClick={onReload}>
          Tentar de novo
        </Button>
      </div>
    )
  }

  const { content } = state

  if (content.body === '' && content.comments.length === 0) {
    return <p className="text-xs text-foreground/60">Este card ainda não tem nada escrito.</p>
  }

  return (
    <div className="space-y-3">
      {content.body === '' ? null : (
        <div className="text-xs">
          <Markdown text={content.body} />
        </div>
      )}

      {content.comments.map((comment) => (
        <CardCommentView key={comment.id} comment={comment} />
      ))}

      {/* O número sai do que **veio**, e não do `MAX_COMMENTS`: aquela constante é do core, e o
          renderer compila contra `src/shared/` e só. Conteúdo que some em silêncio é exatamente a
          dor que este card fecha — o corte precisa aparecer. */}
      {content.truncated ? (
        <p className="text-xs text-foreground/60 italic">
          Mostrando os primeiros {content.comments.length} comentários deste card.
        </p>
      ) : null}
    </div>
  )
}
