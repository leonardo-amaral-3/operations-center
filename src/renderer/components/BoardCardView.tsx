import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

import type { BoardCard } from '../../shared/board'
import type { TerminalState } from '../../shared/claude'
import type { SessionScope } from '../../shared/ipc'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { cn } from '../ui/cn'
import { CardContent } from './CardContent'
import { ClaudeTerminal } from './ClaudeTerminal'
import { ConversationBadge } from './ConversationBadge'
import { DangerBadge } from './DangerBadge'
import { FieldBadge } from './FieldBadge'
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
  /** O terminal Claude deste cartão, se o kanban já souber de algum. `null` = nenhum processo. */
  terminal: TerminalState | null
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
  /** Só de passagem para o `ClaudeTerminal`, que é filho deste componente e não da `Column`. */
  onToggleDangerous: (itemId: string, dangerous: boolean) => void
  /** Só de passagem para o `ClaudeTerminal`: o terminal abre no repo deste card. Ausente = sem botão. */
  onOpenTerminal?: (scope: SessionScope) => void
  /**
   * Este cartão está expandido (#28): cobre a tela do kanban, com o conteúdo e a conversa lado a
   * lado. Só tem efeito no ramo `expanded`.
   */
  maximized?: boolean
  /** Ausente = sem o botão `card-maximize`, como o `onOpenTerminal` sem o dele. */
  onMaximize?: (itemId: string) => void
  onRestore?: () => void
  /**
   * Este card está aberto numa janela própria (#100 §3): o cartão da principal vira selo ou
   * marcador, e **não monta** o `ClaudeTerminal` — o `attach` dele adotaria o terminal de volta.
   */
  detached?: boolean
  /**
   * Este cartão É o conteúdo da janela do card: sem maximizar, destacar nem recolher (não há
   * kanban para recolher para), e ocupa a janela inteira.
   */
  janela?: boolean
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
  terminal,
  dormant,
  dangerous,
  onToggle,
  onToggleDangerous,
  onOpenTerminal,
  maximized = false,
  onMaximize,
  onRestore,
  detached = false,
  janela = false,
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
   *
   * Roda também ao **recolher** (#28): expandido, o `article` sai do fluxo da lista da coluna, a
   * lista encolhe e o navegador corta o `scrollTop` dela — sem isto, um cartão do fim da coluna
   * voltaria fora da vista. Expandido, o cartão já cobre a tela, e não há o que trazer.
   */
  useEffect(() => {
    if (!expanded || maximized || janela) return

    open.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [expanded, maximized, janela])

  /**
   * `Esc` recolhe o cartão expandido (CA-2 do #28). Só registra com ele expandido.
   *
   * A tecla é do cartão apenas quando o foco está dentro dele ou em lugar nenhum (`document.body`):
   * terminal do dock, painel lateral e menu da mesa ficam com a deles. E um `Esc` que alguém já
   * tratou (`defaultPrevented`) não é nosso.
   */
  useEffect(() => {
    if (!maximized) return

    const h = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // O Esc dentro do terminal é da CLI, que o usa para interromper o turno (P18 do #97).
      if (
        event.target instanceof Element &&
        event.target.closest('[data-testid="claude-terminal"]')
      ) {
        return
      }
      if (
        event.target instanceof Node &&
        event.target !== document.body &&
        !open.current?.contains(event.target)
      ) {
        return
      }

      event.preventDefault()
      onRestore?.()
    }

    window.addEventListener('keydown', h)
    return () => {
      window.removeEventListener('keydown', h)
    }
  }, [maximized, onRestore])

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
  const live = terminal !== null && terminal.kind !== 'closed' ? terminal : null

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

        {/* O parentesco é mais um fato do cartão, e por isso veste a mesma casca das etiquetas de
            campo vizinhas em vez de casca própria. `variant="neutral"` pela razão que o
            `ConversationBadge` já enuncia: os tokens de estado marcam *o que a sessão quer de
            você*, e um parentesco não quer nada.

            Vale mesmo com o épico **fora do board** — número e título vêm do `parent` da API, e não
            da varredura do retrato. */}
        {card.parent ? (
          <Badge
            variant="neutral"
            data-testid="card-parent"
            data-parent-number={String(card.parent.number)}
            title={`Fase de #${card.parent.number} — ${card.parent.title}`}
            className="rounded-base px-1.5 py-0 text-[10px] font-normal"
          >
            ⤴ #{card.parent.number}
          </Badge>
        ) : null}

        {card.fields.map((field) => (
          // A chave é o nome do campo, não o `optionId`: um card tem no máximo uma opção por campo,
          // e o nome é o que continua único mesmo se duas opções compartilharem rótulo.
          <FieldBadge key={field.name} field={field} />
        ))}
      </div>

      {/* `line-clamp` porque a legibilidade da coluna é NFR do PRD: um título de duas linhas não
          pode empurrar o cartão seguinte para fora da vista. O `title` devolve o texto inteiro. */}
      <div title={card.title} className="mt-1.5 line-clamp-3 text-sm leading-snug">
        {card.title}
      </div>

      {/* As fases deste épico que estão neste board, uma linha cada, sem teto (decisão 9).

          **Inerte**, e `div` em vez de `ul`/`li`, pelas mesmas duas razões: navegar o board por
          épico está fora do escopo, e o corpo colapsado inteiro vive dentro de um `button`, que só
          admite frase — é o precedente que este arquivo já enuncia em cima do `body`. Um `ul`
          custaria validade sem comprar semântica: `button` torna os descendentes *presentational*
          na ARIA, então `list`/`listitem` sairiam da árvore de acessibilidade de qualquer jeito.

          A ordem chega pronta na prop — quem ordena por número crescente é a inversão, no core. */}
      {card.phases.length > 0 ? (
        <div data-testid="card-phases" className="mt-1.5 space-y-0.5">
          {card.phases.map((phase) => (
            <div
              key={phase.itemId}
              data-testid="card-phase"
              data-phase-number={String(phase.number)}
              data-phase-column={phase.columnId}
              title={phase.title}
              className="flex items-center gap-1.5 truncate text-[10px] text-foreground/70"
            >
              <span className="font-mono">#{phase.number}</span>
              {/* Vazio quando o board não declara a opção, e nenhum rótulo de recuo: escrever
                  "desconhecida" seria o app afirmar algo que ele não sabe. Sobra a linha com o
                  número sozinho, que é a informação que existe. */}
              <span className="truncate">{phase.columnName}</span>
            </div>
          ))}
        </div>
      ) : null}

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
              gerir. Aberto, quem mostra o estado é o próprio `ClaudeTerminal` — inclusive uma falha que
              aconteceu antes de haver sessão. */}
          {/* Expandido, quem diz que o card está em outra janela é o marcador do corpo. */}
          {!expanded && detached ? (
            <Badge
              variant="neutral"
              data-testid="card-detached-badge"
              className="rounded-base px-1.5 py-0 text-[10px] font-normal"
            >
              Em outra janela
            </Badge>
          ) : null}

          {!expanded && live ? (
            <div className="min-w-0">
              <StateBadge state={live} />
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
    const temConversa = conversable || live !== null || dormant
    // A janela do card é a versão "maximizada" do cartão: mesma grade e mesmo preenchimento, só que
    // ocupando a janela (`h-full`) e não a área das colunas (`absolute inset-0`).
    const cheio = maximized || janela

    return (
      // O `opacity-100` vence o `opacity-60` do cartão fechado no GitHub: expandido, ele deixaria o
      // kanban aparecer por baixo. O `shadow-none` evita que a sombra dura vaze sobre o painel
      // lateral e o dock. O `mb-0` anula o `space-y-2` da lista da coluna, que segue dando 8px de
      // margem a um filho já fora do fluxo e o deixaria 8px mais curto que a tela. O bloco de
      // contenção do `absolute` é a área das colunas do `KanbanScreen` (`kanban-area`), abaixo da
      // faixa de conversas (#100).
      <Card
        asChild
        className={cn(
          skin,
          maximized && 'absolute inset-0 z-20 mb-0 overflow-hidden opacity-100 shadow-none',
          janela && 'mb-0 h-full overflow-hidden opacity-100 shadow-none',
        )}
      >
        <article ref={open} {...anchors}>
          <div className="flex shrink-0 items-start gap-2">
            <div className="min-w-0 flex-1">{body}</div>
            {!janela && !detached ? (
              <Button
                type="button"
                data-testid="card-detach"
                variant="neutral"
                size="xs"
                title="Abrir o cartão numa janela própria"
                onClick={() => {
                  void window.oc.openCardWindow({ itemId: card.itemId, atCursor: false })
                  // Maximizado, o cartão cobria o kanban: destacado, não há mais o que cobrir.
                  if (maximized) onRestore?.()
                }}
              >
                Destacar
              </Button>
            ) : null}
            {onMaximize && !janela ? (
              <Button
                type="button"
                data-testid="card-maximize"
                variant="neutral"
                size="xs"
                aria-pressed={maximized}
                title={maximized ? 'Recolher o cartão (Esc)' : 'Expandir o cartão'}
                onClick={() => {
                  if (maximized) onRestore?.()
                  else onMaximize(card.itemId)
                }}
              >
                {maximized ? 'Recolher' : 'Expandir'}
              </Button>
            ) : null}
          </div>

          {/* O invólucro existe nos dois modos, e é isso que impede o desmonte: a árvore do React
              não muda ao expandir, então o `ClaudeTerminal` (terminal vivo) e o `CardContent` (conteúdo
              carregado) sobrevivem sem código de preservação. Só a classe muda. */}
          <div
            data-testid="card-open-body"
            className={
              cheio
                ? cn(
                    'grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4',
                    temConversa && !detached ? 'grid-cols-2' : 'grid-cols-1',
                  )
                : undefined
            }
          >
            {detached ? (
              <div
                data-testid="card-detached"
                className="flex flex-col items-start gap-3 border-t-2 border-border pt-3"
              >
                <p className="text-sm">Aberto em outra janela</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    data-testid="card-detached-show"
                    variant="neutral"
                    size="xs"
                    onClick={() => {
                      void window.oc.focusCardWindow({ itemId: card.itemId })
                    }}
                  >
                    Mostrar
                  </Button>
                  <Button
                    type="button"
                    data-testid="card-detached-bring-back"
                    variant="neutral"
                    size="xs"
                    onClick={() => {
                      void window.oc.bringBackCardWindow({ itemId: card.itemId })
                    }}
                  >
                    Trazer de volta
                  </Button>
                  {/* Sem este, o cartão expandido e destacado não teria como recolher: o botão do
                      terminal não monta enquanto o card está em outra janela. */}
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
              </div>
            ) : (
              <>
                {/* Acima da conversa, e dentro do próprio cartão: o conteúdo é o assunto, e a conversa
              acontece sobre ele. `hasSession` só escolhe se a seção nasce aberta ou recolhida — e o
              dormente conta como sessão pela regra que o próprio `CardContent` enuncia: quem clica
              num cartão com conversa guardada abriu para falar, não para ler. */}
                <CardContent
                  itemId={card.itemId}
                  hasSession={live !== null || dormant}
                  preencher={cheio}
                />

                {temConversa ? (
                  <ClaudeTerminal
                    preencher={cheio}
                    // O escopo montado aqui é objeto novo a cada render, e é seguro: o efeito do
                    // terminal depende da **chave** (`scopeKey`), não da referência.
                    scope={{ kind: 'card', itemId: card.itemId }}
                    state={terminal}
                    dangerous={dangerous}
                    semPasta="Não sei em que pasta deste computador o repo deste card vive. Aponte-a e a sessão sobe lá."
                    // O CA-6 do #6 em uma linha: colapsar fecha a vista, não a conversa.
                    {...(janela
                      ? {}
                      : {
                          onCollapse: () => {
                            onToggle(card.itemId)
                          },
                        })}
                    onToggleDangerous={(sem) => {
                      onToggleDangerous(card.itemId, sem)
                    }}
                    onOpenTerminal={
                      onOpenTerminal === undefined
                        ? undefined
                        : () => {
                            onOpenTerminal({ kind: 'card', itemId: card.itemId })
                          }
                    }
                  />
                ) : janela ? null : (
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
              </>
            )}
          </div>
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
          if (detached) void window.oc.focusCardWindow({ itemId: card.itemId })
          else onToggle(card.itemId)
        }}
      >
        {body}
      </button>
    </Card>
  )
}
