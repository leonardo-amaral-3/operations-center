import { useEffect, useReducer, useState } from 'react'
import type { JSX } from 'react'

import type { BoardCard, BoardsSnapshot } from '../../shared/board'
import { BoardCardView } from '../components/BoardCardView'
import { Button } from '../ui/button'
import { useTemaAplicado } from '../useTemaAplicado'
import { reduceTerminals } from './KanbanScreen'
import { useBoardFeeds } from './useBoardFeeds'

/** O card e o que só a coluna dele sabe dizer: se a estação conversa. */
interface Achado {
  readonly card: BoardCard
  readonly conversable: boolean
}

/**
 * Acha o card por `itemId` em **todos** os boards do retrato — o card destacado pode ser de uma aba
 * que não é a ativa da principal —, junto com a `conversable` da coluna dele.
 */
function achar(snapshot: BoardsSnapshot, itemId: string): Achado | null {
  for (const tab of snapshot.boards ?? []) {
    const card = tab.board?.cards.find((candidato) => candidato.itemId === itemId)
    if (card === undefined || tab.board === null) continue

    const coluna = tab.board.columns.find((c) => c.id === card.columnId)

    return { card, conversable: coluna?.conversable ?? false }
  }

  return null
}

/**
 * A janela do card (#100 §3): uma faixa própria em cima e, embaixo, o **mesmo** `BoardCardView` da
 * principal, com `janela`.
 *
 * **Fora da `Mesa`**, e é de propósito: a janela de card não hidrata o dock nem o painel e não
 * disputa o `layout.json` com a principal. Por isso a faixa é própria — e não a `WindowBar`, que
 * carrega os botões da mesa — e repete, pelos mesmos canais, os três da janela.
 *
 * Reusar o cartão é o que traz junto a regra `temConversa`: o `ClaudeTerminal` só monta, e só faz
 * spawn, quando o cartão já montaria na principal. Card sem conversa abre sem processo nenhum.
 *
 * Sem mudança de estado própria: tudo que o cartão mostra vem dos mesmos feeds do kanban, e as
 * ações (perigoso, trazer de volta) vão ao main, que republica.
 */
export function CardScreen(): JSX.Element {
  // O preload só entrega `card` com o `--oc-card=`; `null` é inalcançável aqui e cai em "sumiu".
  const itemId = window.oc.cardItemId
  const [snapshot, setSnapshot] = useState<BoardsSnapshot | null>(null)
  const [terminais, dispatchTerminal] = useReducer(reduceTerminals, {})
  const { conversations, dangerous } = useBoardFeeds({
    onSnapshot: setSnapshot,
    onClaudeState: dispatchTerminal,
  })
  useTemaAplicado()

  // Semente `false`, como a da `WindowBar`: a janela nasce restaurada e o primeiro retrato corrige.
  const [maximizada, setMaximizada] = useState(false)

  useEffect(() => {
    // Assina antes de pedir, e o evento mais novo vence a resposta em trânsito (idem `WindowBar`).
    let pushed = false

    const unsubscribe = window.oc.onWindow((next) => {
      pushed = true
      setMaximizada(next.maximized)
    })

    void window.oc.readWindow().then((next) => {
      if (!pushed) setMaximizada(next.maximized)
    })

    return unsubscribe
  }, [])

  const achado = snapshot === null || itemId === null ? null : achar(snapshot, itemId)

  return (
    <div
      data-testid="card-screen"
      className="flex h-full flex-col bg-background font-base text-foreground"
    >
      <div
        data-testid="card-window-bar"
        // Mesma altura e mesma razão da `WindowBar` (`h-10`): a sombra dos botões `xs` precisa caber
        // abaixo da borda de 5px que o `WM_NCHITTEST` reserva para o redimensionamento de cima.
        className="arrasta-a-janela flex h-10 shrink-0 items-center justify-between gap-2 border-b-2 border-border bg-background px-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          {achado ? (
            <span
              data-testid="card-window-title"
              className="truncate text-sm font-heading"
              title={achado.card.title}
            >
              #{achado.card.number} {achado.card.title}
            </span>
          ) : null}
          {achado && itemId !== null ? (
            <Button
              type="button"
              variant="neutral"
              size="xs"
              data-testid="card-bring-back"
              title="Fechar esta janela e devolver o card ao kanban"
              className="nao-arrasta-a-janela shrink-0"
              onClick={() => {
                void window.oc.bringBackCardWindow({ itemId })
              }}
            >
              Trazer de volta
            </Button>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="neutral"
            size="xs"
            data-testid="window-minimize"
            aria-label="Minimizar"
            className="nao-arrasta-a-janela"
            onClick={() => {
              void window.oc.minimizeWindow()
            }}
          >
            <span aria-hidden>—</span>
          </Button>

          <Button
            type="button"
            variant="neutral"
            size="xs"
            data-testid="window-maximize"
            aria-label={maximizada ? 'Restaurar' : 'Maximizar'}
            className="nao-arrasta-a-janela"
            onClick={() => {
              void window.oc.toggleMaximizeWindow()
            }}
          >
            <span aria-hidden>{maximizada ? '❐' : '□'}</span>
          </Button>

          <Button
            type="button"
            variant="neutral"
            size="xs"
            data-testid="window-close"
            aria-label="Fechar"
            className="nao-arrasta-a-janela bg-danger text-danger-foreground"
            onClick={() => {
              void window.oc.closeWindow()
            }}
          >
            <span aria-hidden>✕</span>
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {achado && itemId !== null ? (
          <BoardCardView
            card={achado.card}
            conversable={achado.conversable}
            expanded
            terminal={terminais[itemId] ?? null}
            dormant={conversations.includes(itemId)}
            dangerous={dangerous.itemIds.includes(itemId)}
            maximized={false}
            janela
            // Na janela o cartão não alterna nem recolhe: não há kanban para recolher para.
            onToggle={() => {}}
            onToggleDangerous={(id, next) => {
              void window.oc.setDangerous({ scope: { kind: 'card', itemId: id }, dangerous: next })
            }}
          />
        ) : snapshot === null || snapshot.boards === null ? (
          // Antes do primeiro retrato (ou da descoberta) ainda não dá para dizer que o card sumiu.
          <p className="p-4 text-sm text-foreground/60">Lendo o board…</p>
        ) : (
          <p data-testid="card-gone" className="p-4 text-sm text-foreground/60">
            Este card não está mais no board
          </p>
        )}
      </div>
    </div>
  )
}
