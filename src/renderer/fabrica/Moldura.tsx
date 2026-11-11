import type { JSX, ReactNode } from 'react'

import type { ComandoDaFabrica, SalaDaFabrica } from '../../shared/fabrica'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { NAVEGACAO_DA_SALA, type Migalha, type TelaDaFabrica } from './rotas'

/**
 * A moldura da fábrica (#130, F1.2): o cabeçalho da Sala, o das telas internas, o crachá de estado,
 * o botão Pausar e o marcador de tela por vir. Só primitivas de `src/renderer/ui/` e tokens; a
 * tabela de cores do protótipo para os tokens está no §F1.2 da spec do épico #129.
 */

/** A hora em que o item nasceu ou fechou, no formato do pt-BR (#122, §A6); data ruim vira o texto cru. */
export function quando(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return iso
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `dd/mm HH:MM` no fuso local, para o `title` do botão de retomar. */
function diaHora(iso: string): string {
  const d = new Date(iso)
  const dois = (n: number) => String(n).padStart(2, '0')

  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`
}

/** O `#<card>` como link da issue. O `stopPropagation` evita abrir o item ao abrir o link. */
export function LinkDoCard({ card, url }: { card: number; url: string }): JSX.Element {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="underline"
      onClick={(evento) => {
        evento.stopPropagation()
      }}
    >
      #{card}
    </a>
  )
}

/** O texto e a cor do crachá, na precedência do §F1.2: pausa, depois o estado do despachante. */
function estadoDoCracha(sala: SalaDaFabrica | null): { texto: string; classe: string } {
  if (sala === null) return { texto: 'Lendo a fábrica…', classe: '' }
  if (sala.pausa !== null) return { texto: 'Fábrica pausada', classe: 'bg-warning' }
  if (sala.despachante === 'rodando') return { texto: 'Fábrica ligada', classe: 'bg-attention' }
  if (sala.despachante === 'parado') return { texto: 'Fábrica parada', classe: '' }

  return { texto: 'Fábrica: estado desconhecido', classe: '' }
}

export function CrachaDoEstado({ sala }: { sala: SalaDaFabrica | null }): JSX.Element {
  const { texto, classe } = estadoDoCracha(sala)

  return (
    <Badge variant="neutral" data-testid="fabrica-estado" className={classe}>
      <span className="size-2.5 rounded-full border-2 border-border bg-secondary-background" />
      {texto}
    </Badge>
  )
}

export function BotaoPausar({
  sala,
  emVoo,
  onComando,
}: {
  sala: SalaDaFabrica | null
  emVoo: boolean
  onComando: (comando: ComandoDaFabrica) => void
}): JSX.Element {
  const pausada = sala?.pausa != null
  const desde = sala?.pausa?.desde ?? null

  return (
    <Button
      type="button"
      size="sm"
      data-testid="fabrica-pausar"
      disabled={emVoo || sala === null}
      title={
        desde !== null && !Number.isNaN(new Date(desde).getTime())
          ? `pausada desde ${diaHora(desde)}`
          : undefined
      }
      className={
        pausada ? 'bg-attention text-attention-foreground' : 'bg-danger text-danger-foreground'
      }
      onClick={() => {
        onComando({ tipo: pausada ? 'retomar' : 'pausar' })
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        {pausada ? <path d="M7 5l12 7-12 7z" /> : <path d="M8 5v14M16 5v14" />}
      </svg>
      {pausada ? 'Retomar fábrica' : 'Pausar fábrica'}
    </Button>
  )
}

export function CabecalhoDaSala({
  sala,
  emVoo,
  onIr,
  onComando,
}: {
  sala: SalaDaFabrica | null
  emVoo: boolean
  onIr: (tela: TelaDaFabrica) => void
  onComando: (comando: ComandoDaFabrica) => void
}): JSX.Element {
  return (
    <Card
      data-testid="fabrica-cabecalho"
      className="flex-row flex-wrap items-center justify-between gap-4 bg-secondary-background px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-base border-2 border-border bg-main">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className="size-5"
            aria-hidden="true"
          >
            <path d="M3 21V10l5 3V10l5 3V6l8 4v11z" />
          </svg>
        </div>
        <div>
          <h1 className="font-heading text-xl leading-tight">Operations Center</h1>
          <div className="text-xs text-foreground/75">Sala de controle da fábrica</div>
        </div>
      </div>

      <nav aria-label="Telas" className="flex flex-wrap items-center gap-2">
        {NAVEGACAO_DA_SALA.map(({ tela, rotulo }) => (
          <Button
            key={tela}
            type="button"
            size="sm"
            variant={tela === 'sala' ? 'default' : 'neutral'}
            data-testid={`fabrica-nav-${tela}`}
            onClick={() => {
              onIr({ tela } as TelaDaFabrica)
            }}
          >
            {rotulo}
          </Button>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        {sala !== null && (
          <Badge variant="neutral" data-testid="fabrica-projeto">
            {sala.projeto}
          </Badge>
        )}
        <CrachaDoEstado sala={sala} />
        <BotaoPausar sala={sala} emVoo={emVoo} onComando={onComando} />
      </div>
    </Card>
  )
}

export function CabecalhoInterno({
  trilha,
  direita,
  onIr,
}: {
  trilha: Migalha[]
  direita?: ReactNode
  onIr: (tela: TelaDaFabrica) => void
}): JSX.Element {
  return (
    <Card
      data-testid="fabrica-cabecalho"
      className="flex-row flex-wrap items-center justify-between gap-3 bg-secondary-background px-4 py-3"
    >
      <nav
        aria-label="Caminho"
        data-testid="fabrica-trilha"
        className="flex items-center gap-2 text-sm font-heading"
      >
        {trilha.map((migalha, indice) => (
          <span key={indice} className="flex items-center gap-2">
            {indice > 0 && <span aria-hidden="true">/</span>}
            {migalha.para === null ? (
              <span>{migalha.rotulo}</span>
            ) : (
              <button
                type="button"
                className="underline"
                data-testid={`fabrica-trilha-${indice}`}
                onClick={() => {
                  if (migalha.para !== null) onIr(migalha.para)
                }}
              >
                {migalha.rotulo}
              </button>
            )}
          </span>
        ))}
      </nav>
      {direita}
    </Card>
  )
}

export function TelaPorVir({ fase }: { fase: string }): JSX.Element {
  return (
    <div
      data-testid="fabrica-por-vir"
      className="rounded-base border-2 border-dashed border-border bg-secondary-background/45 p-3 text-xs text-foreground/75"
    >
      Esta tela chega na {fase} do épico #129.
    </div>
  )
}
