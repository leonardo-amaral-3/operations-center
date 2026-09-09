import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

import type { BoardCard } from '../../shared/board'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Chat } from './Chat'
import type { CardSession } from './Chat'
import { CardContent } from './CardContent'
import { ConversationBadge } from './ConversationBadge'
import { DangerBadge } from './DangerBadge'
import { StateBadge } from './StateBadge'

interface BoardCardViewProps {
  card: BoardCard
  /**
   * A estação tem skill `gm-*` dedicada, logo o cartão **conversa**. Vem decidido do core.
   *
   * Desde o card #13 ele não decide mais se o cartão abre — só se o chat entra. Ver a emenda ao
   * CA-4 do #6, mais abaixo.
   */
  conversable: boolean
  expanded: boolean
  /** A sessão deste cartão, se o kanban já souber de alguma. */
  session: CardSession | undefined
  /** Há conversa a retomar neste cartão — de uma execução anterior do app (CA-1). */
  dormant: boolean
  /**
   * Este cartão roda sem o portão de permissões (CA-2 do #10).
   *
   * É propriedade do **cartão**, e não da sessão: vale sem sessão nenhuma, e é por isso que ela não
   * viaja no `SessionSnapshot`.
   */
  dangerous: boolean
  onToggle: (itemId: string) => void
  onSession: (itemId: string, session: CardSession) => void
  /** Só de passagem para o `Chat`, que é filho deste componente e não da `Column`. */
  onToggleDangerous: (itemId: string, dangerous: boolean) => void
}

/**
 * O cartão: o número e as etiquetas, o título, o responsável — e, quando aberto, o que está escrito
 * no card e a conversa sobre ele.
 *
 * Card fechado recebe tratamento apagado — menos contraste — para não competir com o que ainda está
 * em voo. É o caso da coluna ✅ Produção, que tende a crescer para sempre.
 *
 * Aberto, ele **continua sendo aquele card**: o cabeçalho segue desenhado em cima do conteúdo e do
 * `Chat`, e não é substituído por eles. É o que dá sentido a ler e conversar aqui, e não num
 * modal — a posição na esteira é parte do assunto.
 */
export function BoardCardView({
  card,
  conversable,
  expanded,
  session,
  dormant,
  dangerous,
  onToggle,
  onSession,
  onToggleDangerous,
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
    // Conversabilidade virou atributo porque deixou de decidir se o cartão abre (ver abaixo): é
    // como o smoke afirma o CA-3 do #13 sem reimplementar a regra que o core já decidiu.
    'data-card-conversable': conversable ? 'true' : 'false',
    // Vazio quando sem dono, e não ausente: é o que deixa o teste afirmar "não tem responsável"
    // em vez de só não achar o atributo.
    'data-card-assignees': card.assignees.join(','),
  }

  // A sessão **viva** deste cartão, ou nenhuma. Morta não conta: quem encerrou (CA-6) não tem o que
  // gerir, e o main também já a tirou do índice — o clique seguinte sobe uma nova.
  const live =
    session && session.state.kind !== 'closed' && session.state.kind !== 'failed' ? session : null

  /**
   * A face do cartão, e **só** a face: a casca — canto, borda de 2px, sombra dura — vem da `Card`.
   *
   * Um mecanismo só para o cartão fechado: o `opacity-60` apaga o cartão inteiro. Antes havia dois
   * — a opacidade e um cinza no título —, e o segundo era cor decidida no arquivo.
   */
  const skin = `bg-secondary-background px-3 py-2.5 ${card.closed ? 'opacity-60' : ''}`

  // `div` e não `p`: no cartão fechado tudo isto vive dentro de um `button`, cujo conteúdo só
  // admite frase — e o mesmo corpo serve os dois casos.
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

        {/* O grupo da direita: os três crachás em fila, e o do modo **antes** dos outros dois. */}
        <div className="flex min-w-0 items-center gap-1.5">
          {/* O sinal do CA-2 do #10, com duas diferenças em relação aos vizinhos abaixo.

              **Aparece com o cartão aberto também**: os outros dois se calam ao expandir porque o
              `Chat` conta a mesma história melhor; este não tem substituto lá dentro — o botão
              diz o que *fazer*, não o que *é* —, e a razão de ele existir é ser impossível de perder
              de vista.

              **E não depende de `live` nem de `dormant`**: é propriedade do cartão, não da sessão.
              Um cartão marcado, sem sessão nenhuma e até com o repo desconhecido precisa mostrá-lo,
              ou o CA-2 vira "visível às vezes". */}
          {dangerous ? <DangerBadge /> : null}

          {/* O sinal de sessão viva no cartão **fechado**, e é o mínimo para o CA-6 ser operável:
              sem ele, uma conversa aberta atrás de um cartão colapsado é invisível e não há o que
              gerir. Aberto, quem mostra o estado é o próprio `Chat` — inclusive uma falha que
              aconteceu antes de haver sessão. */}
          {!expanded && live ? (
            <div className="min-w-0">
              <StateBadge state={live.state} />
            </div>
          ) : null}

          {/* O sinal do CA-1: houve conversa aqui e ela volta ao clique. A sessão viva **vence** o
              dormente — enquanto ela existe, o estado dela informa mais —, e por isso os dois
              crachás nunca aparecem juntos. Expandido, quem conta a história é o próprio
              `Chat`. */}
          {!expanded && !live && dormant ? (
            <div className="min-w-0">
              <ConversationBadge />
            </div>
          ) : null}
        </div>
      </div>
    </>
  )

  /**
   * **Todo cartão abre** — emenda datada (2026-09-06) ao CA-4 do card #6, feita pelo card #13.
   *
   * Aquele critério exigia `article` inerte em coluna sem skill dedicada. O que sobrevive dele é a
   * metade que importa, e ela continua sendo obedecida logo abaixo: ali **nenhuma sessão sobe**. O
   * que cai é "não abre" — um card em ✅ Produção é justamente onde se quer ler o que subiu, e ler
   * não precisa de skill nenhuma.
   *
   * Logo: a conversabilidade decide **o chat**, e não a abertura.
   *
   * E o `dormant` decide junto com ela, pelo mesmo motivo que o `live`: o CA-6 do #6 exige que uma
   * conversa já existente continue alcançável quando o card anda no board — inclusive para 🧪
   * Validação em Dev ou ✅ Produção, que não têm skill. Um card que andou de coluna não pode
   * trancar a conversa que o levou até lá só porque o app foi reiniciado no caminho (CA-1 do #22).
   */
  if (expanded) {
    return (
      <Card asChild className={skin}>
        <article ref={open} {...anchors}>
          {body}

          {/* Acima da conversa, e dentro do próprio cartão: o conteúdo é o assunto, e a conversa
              acontece sobre ele. `hasSession` só escolhe se a seção nasce aberta ou recolhida — e o
              dormente conta como sessão pela regra que o próprio `CardContent` enuncia: quem clica
              num cartão com conversa guardada abriu para falar, não para ler. */}
          <CardContent itemId={card.itemId} hasSession={live !== null || dormant} />

          {conversable || live || dormant ? (
            <Chat
              // O escopo montado aqui é objeto novo a cada render, e é seguro: quem depende dele é
              // o `useSessionView`, e ele depende da **chave**, não da referência.
              scope={{ kind: 'card', itemId: card.itemId }}
              // O CA-6 do #6 em uma linha: colapsar fecha a vista, não a conversa.
              closeOnUnmount={false}
              dangerous={dangerous}
              semPasta="Não sei em que pasta deste computador o repo deste card vive. Aponte-a e a sessão sobe lá."
              onCollapse={() => {
                onToggle(card.itemId)
              }}
              // O `itemId` entra aqui, e não lá dentro: o `Chat` sabe de escopo, e é este componente
              // que sabe que este escopo é um cartão do kanban.
              onSession={(sessao) => {
                onSession(card.itemId, sessao)
              }}
              onToggleDangerous={(sem) => {
                onToggleDangerous(card.itemId, sem)
              }}
            />
          ) : (
            // Sem skill, sem sessão e sem conversa guardada: o cartão abriu para ser lido, e a
            // única ação que ele oferece é fechar. A âncora `card-collapse` é a mesma do `Chat`
            // de propósito — fechar um cartão é fechar um cartão, e o smoke não deve precisar saber
            // qual ramo desenhou o botão.
            <div className="mt-3 flex justify-end border-t-2 border-border pt-3">
              <Button
                type="button"
                data-testid="card-collapse"
                variant="neutral"
                size="xs"
                onClick={() => {
                  onToggle(card.itemId)
                }}
              >
                Fechar
              </Button>
            </div>
          )}
        </article>
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
