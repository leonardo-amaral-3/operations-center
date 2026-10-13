import { memo } from 'react'
import type { JSX, MouseEvent, ReactNode } from 'react'

import type { CardComment, CardContent } from '../../shared/board'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
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
export function formatarData(iso: string): string {
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
      className="pt-1"
    >
      {/* Faixa própria, e a etiqueta vem primeiro: numa spec de 44 mil caracteres o olho que rola
          procura o tipo do trecho antes de procurar o autor. A faixa é a fronteira entre
          comentários, no lugar do filete que havia no `article`. */}
      <header className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-base border-2 border-border bg-secondary-background px-2 py-1 text-[11px] text-foreground">
        {comment.kind === null ? null : (
          <Badge
            variant="default"
            title={`marcador da esteira: gm:${comment.kind}`}
            className="rounded-base px-1.5 py-0 text-[11px] font-heading"
          >
            {comment.kind}
          </Badge>
        )}

        {/* Conta removida devolve `author: null` na API. O rótulo diz isso em vez de mostrar um
            espaço vazio, que se leria como bug. */}
        <span className="font-mono font-heading">{comment.author ?? 'autor removido'}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={comment.createdAt} className="text-foreground/70">
          {formatarData(comment.createdAt)}
        </time>
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

/** Uma entrada do índice: o que o leitor pode procurar dentro da caixa de conteúdo. */
export interface ItemDoIndice {
  /**
   * O que o item procura. É ele, e não a `chave`, que separa o corpo dos comentários: o `MARCADOR`
   * aceita `gm:descricao`, e um comentário assim teria a mesma `chave` que o item Descrição.
   */
  alvo: 'descricao' | 'comentario'
  /** 'descricao' para o corpo; a etiqueta crua para comentários marcados; '' para os sem etiqueta. */
  chave: string
  /** 'Descrição' | kind | 'comentários'. */
  rotulo: string
  /** `null` só na Descrição. */
  contagem: number | null
}

/**
 * Os itens do índice: a descrição, depois um por etiqueta na ordem da **primeira aparição**.
 *
 * O rótulo é a etiqueta crua, e não um nome traduzido: `kind` é uma string solta de propósito, e
 * um mapa para plurais quebraria em silêncio no próximo marcador da esteira. Sem comentário não há
 * o que indexar, então a lista é vazia — o índice não existe para apontar para uma descrição só.
 */
export function indiceDoConteudo(content: CardContent): ItemDoIndice[] {
  if (content.comments.length === 0) return []

  const itens: ItemDoIndice[] = []

  if (content.body !== '') {
    itens.push({ alvo: 'descricao', chave: 'descricao', rotulo: 'Descrição', contagem: null })
  }

  const porChave = new Map<string, ItemDoIndice>()

  for (const { kind } of content.comments) {
    const chave = kind ?? ''
    const existente = porChave.get(chave)

    if (existente === undefined) {
      const item: ItemDoIndice = {
        alvo: 'comentario',
        chave,
        rotulo: kind ?? 'comentários',
        contagem: 1,
      }
      porChave.set(chave, item)
      itens.push(item)
    } else {
      existente.contagem = (existente.contagem ?? 0) + 1
    }
  }

  return itens
}

/** O `scrollTop` que leva o topo do alvo ao topo da caixa; o navegador limita ao intervalo válido. */
export function deslocamentoAte(
  scrollTopAtual: number,
  topoDaCaixa: number,
  topoDoAlvo: number,
): number {
  return scrollTopAtual + (topoDoAlvo - topoDaCaixa)
}

/** O primeiro trecho daquela chave dentro da caixa. A etiqueta casa `[a-z0-9-]`: sem escape. */
export function seletorDoAlvo({ alvo, chave }: Pick<ItemDoIndice, 'alvo' | 'chave'>): string {
  return alvo === 'descricao'
    ? '[data-testid="card-content-description"]'
    : `[data-testid="card-comment"][data-comment-kind="${chave}"]`
}

/**
 * Os atalhos para cada trecho do conteúdo, **fora** da caixa que rola: o índice nunca rola para
 * longe, e saltar de um trecho a outro não obriga a voltar ao topo.
 *
 * Rola só a caixa, por conta: `scrollIntoView` rolaria também a coluna e a janela, e o cartão sairia
 * do lugar. Sem estado nem hook — o componente continua puro no sentido do `CardContentView`.
 */
function IndiceDoConteudo({
  itens,
  hidden,
}: {
  itens: ItemDoIndice[]
  hidden: boolean
}): JSX.Element {
  const irPara = (event: MouseEvent<HTMLButtonElement>, item: ItemDoIndice): void => {
    const caixa = event.currentTarget
      .closest('[data-testid="card-content"]')
      ?.querySelector<HTMLElement>('[data-testid="card-content-body"]')
    const alvo = caixa?.querySelector<HTMLElement>(seletorDoAlvo(item))

    if (!caixa || !alvo) return

    caixa.scrollTop = deslocamentoAte(
      caixa.scrollTop,
      caixa.getBoundingClientRect().top,
      alvo.getBoundingClientRect().top,
    )
  }

  return (
    <nav
      data-testid="card-content-index"
      aria-label="Índice do card"
      hidden={hidden}
      className="mt-2 flex shrink-0 flex-wrap gap-1.5"
    >
      {itens.map((item) => (
        <Button
          key={`${item.alvo}:${item.chave}`}
          type="button"
          variant="neutral"
          size="xs"
          data-testid="card-index-item"
          data-index-target={item.alvo}
          data-index-kind={item.chave}
          data-index-count={item.contagem ?? ''}
          onClick={(event) => irPara(event, item)}
        >
          {item.rotulo}
          {item.contagem === null ? null : (
            <>
              {' '}
              <span className="font-heading">{item.contagem}</span>
            </>
          )}
        </Button>
      ))}
    </nav>
  )
}

/** As duas abas do cartão expandido que tem PR (#83). */
export type AbaDoCartao = 'card' | 'pr'

/** O tablist: a aba ativa, o número que rotula a aba PR e o aviso de clique. */
export interface AbasDoCartao {
  ativa: AbaDoCartao
  numero: number
  onSelecionar: (aba: AbaDoCartao) => void
}

interface CardContentViewProps {
  state: ContentState
  /** `true` enquanto uma recarga está em voo — o conteúdo antigo fica na tela e o ⟳ desabilita. */
  pending: boolean
  open: boolean
  onToggle: () => void
  onReload: () => void
  /** Cartão expandido (#28): o corpo ocupa a altura que sobra, em vez de parar no teto de 26rem. */
  preencher?: boolean
  /**
   * Presente só no cartão expandido que tem PR. Troca o disclosure "Conteúdo" pelo tablist; sem
   * ele (ausente ou `null`) a vista desenha exatamente o que desenhava antes.
   */
  abas?: AbasDoCartao | null
  /** O painel do PR, já montado pelo contêiner. `null` até a primeira seleção da aba PR. */
  prPanel?: ReactNode
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
  preencher = false,
  abas = null,
  prPanel = null,
}: CardContentViewProps): JSX.Element {
  // Com abas não há disclosure para reabrir uma seção recolhida durante o carregamento, e a aba
  // Card ficaria vazia: o corpo é desenhado como se `open` fosse `true`, ignorando o prop.
  const aberta = abas !== null || open
  const naAbaPr = abas?.ativa === 'pr'

  return (
    <section
      data-testid="card-content"
      className={cn('mt-3 border-t-2 border-border pt-3', preencher && 'flex min-h-0 flex-col')}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Um `<button>` cru, e não a primitiva: `Button` traz casca — borda de 2px e sombra dura —,
            e uma casca aqui desenharia uma segunda caixa dentro do cartão. O que este controle é,
            é um disclosure: o rótulo, o chevron e o `aria-expanded`. */}
        {abas === null ? (
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
        ) : (
          <div role="tablist" aria-label="Card e PR" className="flex items-center gap-2">
            <Button
              type="button"
              role="tab"
              aria-selected={abas.ativa === 'card'}
              data-testid="card-tab-card"
              variant={abas.ativa === 'card' ? 'default' : 'neutral'}
              size="xs"
              onClick={() => abas.onSelecionar('card')}
            >
              Card
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={abas.ativa === 'pr'}
              data-testid="card-tab-pr"
              variant={abas.ativa === 'pr' ? 'default' : 'neutral'}
              size="xs"
              onClick={() => abas.onSelecionar('pr')}
            >
              PR #{abas.numero}
            </Button>
          </div>
        )}

        {/* Fica no cabeçalho, e portanto **também quando a seção está recolhida**: recarregar é o
            CA-7, e quem acabou de pedir um comentário à sessão não deveria ter de abrir a seção
            para trazê-lo. */}
        {/* Com a aba PR ativa o ⟳ do card sai: a aba PR tem o seu. */}
        {naAbaPr ? null : (
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
        )}
      </div>

      {/* Teto de altura e rolagem própria: o cartão vive dentro de uma coluna, e sem o teto a spec
          de 44 mil caracteres do card #6 empurraria o cartão seguinte para fora da vista — o kanban
          deixaria de ser um kanban (CA-4). O teto vale no kanban e cai no cartão expandido (#28), onde o
          corpo preenche a altura e rola sozinho. Quem rola na horizontal é o contêiner de cada tabela e
          de cada bloco de código, dentro do `Markdown`; aqui só a vertical. */}
      {aberta && state.kind === 'loaded' && state.content.comments.length > 0 ? (
        <IndiceDoConteudo itens={indiceDoConteudo(state.content)} hidden={naAbaPr} />
      ) : null}

      {aberta ? (
        <div
          data-testid="card-content-body"
          hidden={naAbaPr}
          className={cn('mt-2 overflow-y-auto', preencher ? 'min-h-0 flex-1' : 'max-h-[26rem]')}
        >
          <Corpo state={state} pending={pending} onReload={onReload} />
        </div>
      ) : null}

      {/* Montado na primeira seleção da aba PR e escondido com CSS depois, para trocar de aba não
          reler nem desmontar (CA-2 do #28). */}
      {prPanel === null ? null : (
        <div
          data-testid="card-pr-body"
          hidden={!naAbaPr}
          className="mt-2 min-h-0 flex-1 overflow-y-auto"
        >
          {prPanel}
        </div>
      )}
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
        <div data-testid="card-content-description" className="text-xs">
          <Markdown text={content.body} />
        </div>
      )}

      {/* Onde o corpo acaba e a conversa começa: sem ele, a descrição e o primeiro comentário são
          dois blocos de markdown colados. */}
      {content.comments.length === 0 ? null : (
        <h3
          data-testid="card-comments-start"
          className="border-t-2 border-border pt-2 font-heading text-[11px] tracking-wide uppercase"
        >
          Comentários · {content.comments.length}
        </h3>
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
