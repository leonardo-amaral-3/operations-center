import type { JSX } from 'react'

import type { BoardCard, BoardColumn } from '../../shared/board'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { BoardCardView } from './BoardCardView'
import type { CardSession, CardSessions } from './Chat'
import { TriagePanel } from './TriagePanel'

interface ColumnProps {
  column: BoardColumn
  /** Já filtrados para esta coluna, **na ordem em que o board os devolveu**. */
  cards: readonly BoardCard[]
  /**
   * Os cartões abertos **da aba ativa** — do kanban inteiro, não só desta coluna, e possivelmente
   * nenhum. A regra é um por coluna (#45), mas quem a aplica é o reducer, no clique: aqui o
   * conjunto chega inteiro e a coluna só pergunta pelo cartão que ela desenha, exatamente como já
   * faz com `conversations` e `dangerous`.
   */
  expandedItemIds: readonly string[]
  sessions: CardSessions
  /** Os cartões com conversa a retomar — do kanban inteiro, não só desta coluna. */
  conversations: readonly string[]
  /** Os cartões que rodam sem o portão — também do kanban inteiro (CA-2 do #10). */
  dangerous: readonly string[]
  /**
   * A triagem **desta** coluna, ou ausente. Quem decide se ela existe é a tela, pelo `column.triage`
   * que veio do core e pelo estado do kanban — a coluna só a desenha, como já faz com
   * `conversations` e `dangerous`.
   */
  triage?: {
    boardKey: string
    dangerous: boolean
    onEnd: () => void
    onToggleDangerous: (dangerous: boolean) => void
  }
  /** Abre a nova triagem. Ausente = esta coluna não oferece a ação (ou já tem uma aberta). */
  onStartTriage?: () => void
  onToggle: (itemId: string) => void
  onSession: (itemId: string, session: CardSession) => void
  onToggleDangerous: (itemId: string, dangerous: boolean) => void
}

/**
 * Uma estação da esteira: o cabeçalho com o nome e a contagem, e a pilha de cartões.
 *
 * Coluna sem nenhum cartão continua sendo desenhada, com a contagem em zero. O CA-1 afirma que as 8
 * estações aparecem, não que as ocupadas aparecem — e uma coluna que some ao esvaziar faria o
 * kanban mudar de forma ao longo do dia.
 *
 * Enquanto hospeda o cartão aberto ela **alarga**, e as vizinhas escorregam: 288px não sustentam
 * mensagem do Claude, descrição de opção e prompt de permissão legíveis, que é o NFR do PRD. O
 * kanban continua rolando na horizontal, como já rola com 8 colunas.
 */
export function Column({
  column,
  cards,
  expandedItemIds,
  sessions,
  conversations,
  dangerous,
  triage,
  onStartTriage,
  onToggle,
  onSession,
  onToggleDangerous,
}: ColumnProps): JSX.Element {
  // O painel alarga a coluna pelo mesmo motivo que um cartão aberto — 288px não sustentam prompt de
  // permissão legível —, e por isso entra no mesmo `hosting` em vez de ganhar uma largura própria.
  const hosting = triage !== undefined || cards.some((card) => expandedItemIds.includes(card.itemId))

  return (
    // A raia não se separa do canvas pela cor — as duas são `bg-background`, que é o que a `Card` já
    // dá. Quem a recorta é a borda de 2px e a sombra dura, e é essa a troca de pele do card #8.
    //
    // `overflow-hidden` para o `border-b-2` do cabeçalho encostar nos cantos arredondados: sem ele o
    // separador atravessa o raio e sobra um bico preto em cada ponta.
    <Card asChild className={`${hosting ? 'w-[36rem]' : 'w-90'} shrink-0 overflow-hidden`}>
      <section
        data-testid="column"
        data-column-id={column.id}
        data-column-name={column.name}
        data-column-count={String(cards.length)}
      >
        {/* O violet mora aqui e só aqui: o acento marca **a esteira**, e as cores de estado marcam o
            que a sessão quer de você. Misturar os dois é o que os tokens de estado existem para
            impedir. */}
        <header className="flex items-center justify-between gap-2 border-b-2 border-border bg-main px-3 py-2">
          <h2 className="truncate text-xs font-heading text-main-foreground" title={column.name}>
            {column.name}
          </h2>
          {/* Entre o nome e a contagem, e **só** na estação de entrada: quem decide isso é o core,
              pelo `column.triage`, e a tela só repassa o callback. Some enquanto o painel está na
              coluna — não porque abrir duas triagens seria proibido, mas porque a `key` da aba é
              uma só e a segunda seria a mesma. */}
          {onStartTriage ? (
            <Button
              type="button"
              data-testid="new-triage"
              variant="neutral"
              size="xs"
              title="Iniciar nova triagem"
              onClick={onStartTriage}
            >
              + Triagem
            </Button>
          ) : null}
          <Badge variant="neutral" className="px-2 py-0 font-mono text-[10px]">
            {cards.length}
          </Badge>
        </header>

        {/* O scroll é da coluna, não da página: as 8 estações precisam continuar lado a lado enquanto
            a mais cheia cresce.

            O `p-2` **não muda**, e é ele que faz o CA-3 fechar sem tocar em largura nenhuma: o
            recorte do `overflow` acontece na padding box, então os 8px acomodam os 4px de sombra do
            cartão sem clipá-la. */}
        <div className="flex-1 space-y-2 overflow-y-auto p-2">
          {/* No topo da pilha, e antes dos cartões: a triagem é o que ainda não virou card, e a
              coluna se lê de cima para baixo na ordem em que as coisas acontecem. A contagem do
              cabeçalho **não** o conta — ela sai de `cards.length`, e o painel não é cartão. */}
          {triage ? <TriagePanel {...triage} /> : null}

          {cards.map((card) => (
            // `itemId` e não o número: é a chave estável mesmo se a issue mudar de repo.
            <BoardCardView
              key={card.itemId}
              card={card}
              // A conversabilidade é da coluna e vem decidida do core — a tela não reimplementa a
              // regra, só a repassa ao cartão que está dentro dela.
              conversable={column.conversable}
              expanded={expandedItemIds.includes(card.itemId)}
              session={sessions[card.itemId]}
              // O conjunto vem inteiro e a coluna só pergunta por este cartão: a conversa é do
              // cartão, e ele pode ter andado de coluna desde que ela aconteceu.
              dormant={conversations.includes(card.itemId)}
              // Pelo mesmo caminho e pela mesma razão do `dormant`: o conjunto vem inteiro e a
              // coluna só pergunta por este cartão. A marca é do cartão, e ele anda de coluna.
              dangerous={dangerous.includes(card.itemId)}
              onToggle={onToggle}
              onSession={onSession}
              onToggleDangerous={onToggleDangerous}
            />
          ))}
        </div>
      </section>
    </Card>
  )
}
