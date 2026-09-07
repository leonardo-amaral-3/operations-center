import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

import type { BoardCard } from '../../shared/board'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { CardChat } from './CardChat'
import type { CardSession } from './CardChat'
import { StateBadge } from './StateBadge'

interface BoardCardViewProps {
  card: BoardCard
  /** A estação tem skill `gm-*` dedicada, logo o cartão conversa (CA-4). Vem decidido do core. */
  conversable: boolean
  expanded: boolean
  /** A sessão deste cartão, se o kanban já souber de alguma. */
  session: CardSession | undefined
  onToggle: (itemId: string) => void
  onSession: (itemId: string, session: CardSession) => void
}

/**
 * O cartão: o número e as etiquetas, o título, o responsável — e, quando aberto, a conversa.
 *
 * Card fechado recebe tratamento apagado — menos contraste — para não competir com o que ainda está
 * em voo. É o caso da coluna ✅ Produção, que tende a crescer para sempre.
 *
 * Aberto, ele **continua sendo aquele card**: o cabeçalho segue desenhado em cima do `CardChat`, e
 * não é substituído por ele. É o que dá sentido à conversa acontecer aqui, e não num modal — a
 * posição na esteira é parte do assunto.
 */
export function BoardCardView({
  card,
  conversable,
  expanded,
  session,
  onToggle,
  onSession,
}: BoardCardViewProps): JSX.Element {
  const open = useRef<HTMLElement>(null)

  /**
   * Ao abrir, traz o cartão inteiro para a vista.
   *
   * No clique o navegador já rolou o botão para dentro — mas ele media 288px, e a coluna alarga para
   * 544px no mesmo instante. Sem isto, um cartão perto da borda direita nasce com metade do chat
   * fora da tela: medido num cartão da 4ª coluna, a borda direita caía em 1340px numa janela de
   * 1084 — a caixa de texto e as duas ações do CA-6 do lado de fora.
   *
   * `nearest` nos dois eixos, e não `center`: o mínimo para caber é o que preserva o resto do board
   * onde o olho o deixou. Sem `behavior: 'smooth'` de propósito — o smoke da task 7 lê posição, e
   * animação em curso é vermelho intermitente.
   */
  useEffect(() => {
    if (!expanded) return

    open.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [expanded])

  const anchors = {
    'data-testid': 'board-card',
    'data-card-number': String(card.number),
    'data-card-column': card.columnId,
    'data-card-closed': card.closed ? 'true' : 'false',
    // Vazio quando sem dono, e não ausente: é o que deixa o teste afirmar "não tem responsável"
    // em vez de só não achar o atributo.
    'data-card-assignees': card.assignees.join(','),
  }

  // A sessão **viva** deste cartão, ou nenhuma. Morta não conta: quem encerrou (CA-6) não tem o que
  // gerir, e o main também já a tirou do índice — o clique seguinte sobe uma nova.
  const live =
    session && session.state.kind !== 'closed' && session.state.kind !== 'failed' ? session : null

  /**
   * Um cartão com sessão viva abre **mesmo fora de coluna conversável**.
   *
   * O CA-4 fala de *começar* conversa onde não há skill; o CA-6 exige que uma conversa já existente
   * continue alcançável quando o card anda no board — inclusive para 🧪 Validação em Dev ou ✅
   * Produção. Cartão sem sessão nessas colunas segue inerte, que é o caso do CA-4.
   */
  const clickable = conversable || live !== null

  /**
   * A face do cartão, e **só** a face: a casca — canto, borda de 2px, sombra dura — vem da `Card`.
   *
   * Um mecanismo só para o cartão fechado: o `opacity-60` apaga o cartão inteiro. Antes havia dois
   * — a opacidade e um cinza no título —, e o segundo era cor decidida no arquivo.
   */
  const skin = `bg-secondary-background px-3 py-2.5 ${card.closed ? 'opacity-60' : ''}`

  // `div` e não `p`: no cartão clicável tudo isto vive dentro de um `button`, cujo conteúdo só
  // admite frase — e o mesmo corpo serve os três casos.
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-foreground/70">#{card.number}</span>
        {card.fields.map((field) => (
          // A chave é o nome do campo, não o `optionId`: um card tem no máximo uma opção por campo,
          // e o nome é o que continua único mesmo se duas opções compartilharem rótulo.
          <Badge
            key={field.name}
            variant="neutral"
            title={`${field.name}: ${field.value}`}
            className="rounded-base px-1.5 py-0 text-[10px] font-normal"
          >
            {field.value}
          </Badge>
        ))}
      </div>

      {/* `line-clamp` porque a legibilidade da coluna é NFR do PRD: um título de duas linhas não
          pode empurrar o cartão seguinte para fora da vista. O `title` devolve o texto inteiro. */}
      <div title={card.title} className="mt-1.5 line-clamp-3 text-sm leading-snug">
        {card.title}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[11px] text-foreground/70">
          {card.assignees.length === 0 ? (
            // Visível de propósito: hoje não distingue nada neste board, mas é o campo que a RF-4
            // vai usar para decidir quem abre chat sozinho — e o cartão sem responsável é o convite
            // da F5.
            <span className="text-foreground/60 italic">sem dono</span>
          ) : (
            card.assignees.join(', ')
          )}
        </div>

        {/* O sinal de sessão viva no cartão **fechado**, e é o mínimo para o CA-6 ser operável: sem
            ele, uma conversa aberta atrás de um cartão colapsado é invisível e não há o que gerir.
            Aberto, quem mostra o estado é o próprio `CardChat` — inclusive uma falha que aconteceu
            antes de haver sessão. */}
        {!expanded && live ? (
          <div className="min-w-0">
            <StateBadge state={live.state} />
          </div>
        ) : null}
      </div>
    </>
  )

  if (expanded) {
    return (
      <Card asChild className={skin}>
        <article ref={open} {...anchors}>
          {body}
          <CardChat
            itemId={card.itemId}
            onCollapse={() => {
              onToggle(card.itemId)
            }}
            onSession={onSession}
          />
        </article>
      </Card>
    )
  }

  // Coluna sem skill dedicada e sem sessão: `article` inerte, sem handler nenhum (CA-4).
  if (!clickable) {
    return (
      <Card asChild className={skin}>
        <article {...anchors}>{body}</article>
      </Card>
    )
  }

  return (
    // O `block` derruba o `flex` da primitiva pelo `twMerge` — conflito de `display`, a última
    // vence —, e é o que preserva o empilhamento de hoje dentro do `<button>`; `text-left` desfaz a
    // centralização nativa. Tudo isso vai no `className` da `Card`, e não no `<button>`: o `Slot`
    // concatena os dois `className` sem passar pelo `twMerge`, então conflito no filho não resolve.
    <Card
      asChild
      className={`block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${skin}`}
    >
      <button
        {...anchors}
        type="button"
        onClick={() => {
          onToggle(card.itemId)
        }}
      >
        {body}
      </button>
    </Card>
  )
}
