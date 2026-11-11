import type { JSX, ReactNode } from 'react'

import type { DespachoNaSala, SalaDaFabrica } from '../../../shared/fabrica'
import { Card } from '../../ui/card'
import { CabecalhoDaSala, LinkDoCard, quando } from '../Moldura'
import { rotaDoItem } from '../rotas'
import type { PropsDaTela } from '../telas'

const ESTADO_NA_TELA: Record<DespachoNaSala['estado'], string> = {
  pendente: 'pendente',
  lancando: 'lançando',
  rodando: 'rodando',
}

function Secao({
  titulo,
  total,
  children,
}: {
  titulo: string
  total: number
  children: ReactNode
}): JSX.Element {
  return (
    <Card className="gap-2 bg-secondary-background p-3">
      <h3 className="font-heading text-sm">
        {titulo} ({total})
      </h3>
      {children}
    </Card>
  )
}

function Vazio({ texto }: { texto: string }): JSX.Element {
  return <p className="text-xs text-foreground/60">{texto}</p>
}

const LINHA = 'flex flex-col gap-1 rounded-base bg-secondary-background p-2 text-left text-xs'

/**
 * A Sala (#130, §F1.7): o cabeçalho da Sala e as três listas de hoje (fila, em voo, fechados), lidas
 * do `estado.json`. **Contrato entre fases:** todo cartão da fila tem `fabrica-aberto` e todo despacho
 * em voo `fabrica-em-voo` com `data-state`, e a F2 os mantém nos cartões novos.
 */
export function Sala({ sala, ir, comando, emVoo }: PropsDaTela): JSX.Element {
  return (
    <>
      <CabecalhoDaSala sala={sala} emVoo={emVoo} onIr={ir} onComando={(c) => void comando(c)} />
      <Lista sala={sala} ir={ir} />
    </>
  )
}

function Lista({ sala, ir }: { sala: SalaDaFabrica | null; ir: PropsDaTela['ir'] }): JSX.Element {
  if (sala === null) return <p className="text-sm">Lendo o estado da fábrica…</p>

  if (sala.kind === 'sem-estado') {
    return (
      <p data-testid="fabrica-vazia" className="text-sm">
        Nenhum despacho registrado ainda.
      </p>
    )
  }

  if (sala.kind === 'ilegivel') {
    return (
      <div data-testid="fabrica-erro" className="flex flex-col gap-1 text-sm">
        <p>Não foi possível ler o estado da fábrica.</p>
        <p className="text-xs break-words text-foreground/60">{sala.erro}</p>
      </div>
    )
  }

  return (
    <>
      <Secao titulo="Fila de decisões" total={sala.abertos.length}>
        {sala.abertos.length === 0 && <Vazio texto="Nada esperando decisão." />}
        {sala.abertos.map((aberto) => (
          <button
            key={aberto.id}
            type="button"
            data-testid="fabrica-aberto"
            className={LINHA}
            onClick={() => {
              ir(rotaDoItem(aberto))
            }}
          >
            <span className="flex items-center justify-between gap-2">
              <LinkDoCard card={aberto.card} url={aberto.cardUrl} />
              <span>{quando(aberto.criadoEm)}</span>
            </span>
            <span>{aberto.motivo}</span>
            <code className="break-words">{aberto.comando ?? `despacho ${aberto.despacho}`}</code>
          </button>
        ))}
      </Secao>

      <Secao titulo="Em voo" total={sala.emVoo.length}>
        {sala.emVoo.length === 0 && <Vazio texto="Nenhum despacho em voo." />}
        {sala.emVoo.map((despacho) => (
          <button
            key={despacho.id}
            type="button"
            data-testid="fabrica-em-voo"
            data-state={despacho.estado}
            className={LINHA}
            onClick={() => {
              ir({ tela: 'card', card: despacho.card })
            }}
          >
            <span className="flex items-center gap-2">
              <LinkDoCard card={despacho.card} url={despacho.cardUrl} />
              <span>{ESTADO_NA_TELA[despacho.estado]}</span>
            </span>
            <code className="break-words">{despacho.comando}</code>
          </button>
        ))}
        <p className="text-xs text-foreground/60">{sala.frentesAbertas} frente(s) aberta(s)</p>
      </Secao>

      <Secao titulo="Fechados" total={sala.fechados.length}>
        {sala.fechados.length === 0 && <Vazio texto="Nenhum item fechado." />}
        {sala.fechados.map((fechado) => (
          <button
            key={fechado.id}
            type="button"
            data-testid="fabrica-fechado"
            className={LINHA}
            onClick={() => {
              ir(rotaDoItem(fechado))
            }}
          >
            <LinkDoCard card={fechado.card} url={fechado.cardUrl} />
            <span>{fechado.motivo}</span>
            <span>resolvido: {fechado.resolucao ?? '-'}</span>
          </button>
        ))}
      </Secao>
    </>
  )
}
