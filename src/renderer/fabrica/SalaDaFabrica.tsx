import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import type {
  DespachoNaSala,
  ItemNaSala,
  PerguntaDaFila,
  SalaDaFabrica as Retrato,
} from '../../shared/fabrica'
import { Markdown } from '../components/Markdown'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { useSala } from './useSala'

const ESTADO_NA_TELA: Record<DespachoNaSala['estado'], string> = {
  pendente: 'pendente',
  lancando: 'lançando',
  rodando: 'rodando',
}

/** `dd/mm HH:MM`, a hora em que o item nasceu ou fechou (#122, §A6). */
function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** O `#<card>` como link da issue. O `stopPropagation` evita selecionar o item ao abrir o link. */
function LinkDoCard({ card, url }: { card: number; url: string }): JSX.Element {
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

function Secao({
  titulo,
  total,
  children,
}: {
  titulo: string
  total: number
  children: React.ReactNode
}): JSX.Element {
  return (
    <Card className="gap-2 p-3">
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

function classeDaLinha(selecionado: boolean): string {
  const base = 'flex flex-col gap-1 rounded-base p-2 text-left text-xs'

  return selecionado ? `${base} bg-main text-main-foreground` : `${base} bg-secondary-background`
}

/**
 * A sala da fábrica (#122, P3a): a fila de decisões, os despachos em voo e os itens fechados, lidos
 * do `estado.json` da P2. Só lê: fechar um item segue sendo `yarn fabrica fechar`, e a pergunta
 * mostra o comando exato.
 */
export function SalaDaFabrica(): JSX.Element {
  const sala = useSala()
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [pergunta, setPergunta] = useState<PerguntaDaFila | null | undefined>(undefined)

  const itens: ItemNaSala[] = sala?.kind === 'ok' ? [...sala.abertos, ...sala.fechados] : []
  const item = itens.find((candidato) => candidato.id === selecionado) ?? null
  // Muda quando o item selecionado é fechado por fora: a pergunta passa a mostrar a resolução.
  const fechadoEm = item?.fechadoEm ?? null
  const idDoItem = item?.id ?? null

  // A seleção some quando o `id` já não está no estado.
  useEffect(() => {
    if (selecionado !== null && sala?.kind === 'ok' && idDoItem === null) {
      setSelecionado(null)
      setPergunta(undefined)
    }
  }, [sala, selecionado, idDoItem])

  useEffect(() => {
    if (idDoItem === null) return

    let atual = true

    window.oc
      .readFabricaPergunta({ id: idDoItem })
      .then((resposta) => {
        // Uma resposta de uma seleção que já não é a atual é descartada.
        if (atual) setPergunta(resposta)
      })
      .catch(() => {
        if (atual) setPergunta(null)
      })

    return () => {
      atual = false
    }
  }, [idDoItem, fechadoEm])

  const selecionar = (id: string) => {
    if (id !== selecionado) setPergunta(undefined)
    setSelecionado(id)
  }

  return (
    <div data-testid="fabrica-sala" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-lg">Fábrica</h2>
        {sala?.kind === 'ok' && sala.despachante !== 'desconhecido' && (
          <Badge
            data-testid="fabrica-despachante"
            variant={sala.despachante === 'rodando' ? 'default' : 'neutral'}
          >
            {`despachante ${sala.despachante}`}
          </Badge>
        )}
        {sala !== null && (
          <span className="text-xs text-foreground/60">
            lido às {new Date(sala.lidoEm).toLocaleTimeString('pt-BR')}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto">
          <Lista sala={sala} selecionado={selecionado} onSelecionar={selecionar} />
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <Pergunta selecionado={selecionado} item={item} pergunta={pergunta} />
        </div>
      </div>
    </div>
  )
}

function Lista({
  sala,
  selecionado,
  onSelecionar,
}: {
  sala: Retrato | null
  selecionado: string | null
  onSelecionar: (id: string) => void
}): JSX.Element {
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
            aria-pressed={selecionado === aberto.id ? 'true' : undefined}
            className={classeDaLinha(selecionado === aberto.id)}
            onClick={() => {
              onSelecionar(aberto.id)
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
          <div
            key={despacho.id}
            data-testid="fabrica-em-voo"
            data-state={despacho.estado}
            className="flex flex-col gap-1 rounded-base bg-secondary-background p-2 text-xs"
          >
            <span className="flex items-center gap-2">
              <LinkDoCard card={despacho.card} url={despacho.cardUrl} />
              <span>{ESTADO_NA_TELA[despacho.estado]}</span>
            </span>
            <code className="break-words">{despacho.comando}</code>
          </div>
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
            aria-pressed={selecionado === fechado.id ? 'true' : undefined}
            className={classeDaLinha(selecionado === fechado.id)}
            onClick={() => {
              onSelecionar(fechado.id)
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

function Pergunta({
  selecionado,
  item,
  pergunta,
}: {
  selecionado: string | null
  item: ItemNaSala | null
  pergunta: PerguntaDaFila | null | undefined
}): JSX.Element | null {
  if (selecionado === null || item === null) {
    return (
      <p className="text-sm text-foreground/60">
        Escolha um item da fila para ver a pergunta inteira.
      </p>
    )
  }

  // `undefined` = a resposta da seleção atual ainda não chegou.
  if (pergunta === undefined) return null

  if (pergunta === null) return <p className="text-sm">O item saiu do estado da fábrica.</p>

  const { item: dado } = pergunta

  return (
    <Card data-testid="fabrica-pergunta" className="gap-3 p-4 text-sm">
      <h3 className="font-heading">
        {dado.id} · <LinkDoCard card={dado.card} url={dado.cardUrl} />
      </h3>
      <p>
        <strong>Motivo:</strong> {dado.motivo}
      </p>
      <p className="text-xs break-words">
        De: {dado.despacho} · sessão {dado.sessaoClaude ?? '-'} · {dado.comando ?? '-'}
      </p>
      <section className="flex flex-col gap-1">
        <h4 className="font-heading text-xs">Texto final da sessão</h4>
        {pergunta.resultado === null ? (
          <p data-testid="fabrica-pergunta-sem-texto">A sessão não deixou texto final.</p>
        ) : (
          <Markdown text={pergunta.resultado} />
        )}
      </section>
      {dado.fechadoEm === null ? (
        <p>
          Para fechar: <code data-testid="fabrica-pergunta-fechar">{pergunta.fechar}</code>
        </p>
      ) : (
        <p>
          Fechado em {quando(dado.fechadoEm)}: {dado.resolucao ?? '-'}
        </p>
      )}
    </Card>
  )
}
