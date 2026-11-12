import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import type { CardComment } from '../../../shared/board'
import type { AssumirDespachoResult, CardNaFabrica, DespachoDoCard } from '../../../shared/fabrica'
import { FieldBadge } from '../../components/FieldBadge'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { cn } from '../../ui/cn'
import {
  ESTACOES_DO_CARD,
  estadosDasEstacoes,
  estadosDasTasks,
  linhaDoFim,
  rotuloDoEstado,
  tasksDoComentario,
  textoDaDecisao,
  type TaskDoCard,
} from '../emVoo'
import { ROTULO_DO_PASSO, horaCurta, skillDoComando } from '../linha'
import { CabecalhoInterno } from '../Moldura'
import { trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'
import { useCardsDoBoard } from '../useCardsDoBoard'

/** As tasks do card, como a tela as tem: lendo, sem board, com erro, ou lidas do `gm:tasks`. */
type TasksLidas =
  | { kind: 'lendo' }
  | { kind: 'fora-do-board' }
  | { kind: 'erro'; motivo: string }
  | { kind: 'ok'; tasks: TaskDoCard[] | null; truncado: boolean }

// Padrões locais da tela (§F4.9): a Entrada tem os seus, e a F3 tem os dela em `item.tsx`.
function Etiqueta({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[4px] border-[1.5px] border-border bg-secondary-background px-1.5 text-[11px] font-bold leading-[18px]',
        className,
      )}
    >
      {children}
    </span>
  )
}

function Vazio({ testid, children }: { testid: string; children: ReactNode }): JSX.Element {
  return (
    <div
      data-testid={testid}
      className="rounded-base border-2 border-dashed border-border bg-secondary-background/45 p-3 text-xs text-foreground/75"
    >
      {children}
    </div>
  )
}

/** O chip de onde a sessão roda: depois do ship a worktree pode ter sido removida. */
function textoDoOnde(d: DespachoDoCard, ondeRoda: string): string {
  if (/^operations-center-\d+-/.test(ondeRoda)) return `worktree ${ondeRoda}`
  if (d.estado === 'concluido' && ondeRoda === 'worktree ainda não criada') return 'sem worktree'
  return ondeRoda
}

const FRASE_FIXA =
  ' Mandar uma mensagem e Parar o turno precisam falar com a sessão enquanto ela roda, e a fábrica não expõe isso.'

function notaDoAssumir(atual: DespachoDoCard, itemId: string | null): string {
  if (atual.estado !== 'concluido') {
    return 'Assumir libera quando a sessão terminar: o id dela só existe no fim (saída JSON), e duas sessões no mesmo transcript se atropelam.'
  }
  if (atual.sessao === null) {
    return 'Este despacho terminou sem id de sessão: não há o que retomar.'
  }
  if (itemId === null) {
    return 'O card não está num board aberto no app: Assumir abre a sessão no cartão dele.'
  }
  return 'Assumir abre o mesmo terminal que o cartão abre hoje, retomando a sessão deste despacho. Com a frente encerrada, a fábrica só volta a este card por yarn fabrica iniciar.'
}

export function CardEmVoo({ tela, sala, ir }: PropsDaTela): JSX.Element {
  // A raiz só monta esta tela com `tela: 'card'`; fora disso não há card a ler.
  const card = tela.tela === 'card' ? tela.card : 0
  const lidoEm = sala?.lidoEm

  const [dados, setDados] = useState<CardNaFabrica | null>(null)
  const geracao = useRef(0)
  const ultimoCard = useRef<number | null>(null)

  useEffect(() => {
    // `dados` só volta a `null` quando o card muda: na releitura por `lidoEm` o valor anterior
    // fica na tela até a resposta chegar.
    if (ultimoCard.current !== card) {
      ultimoCard.current = card
      setDados(null)
    }
    const minha = ++geracao.current
    const aplicar = (lido: CardNaFabrica): void => {
      // Uma resposta mais velha que a última pedida é descartada, inclusive a de outro card.
      if (minha === geracao.current) setDados(lido)
    }
    void (async () => {
      try {
        aplicar(await window.oc.readFabricaCard({ board: null, repo: null, card }))
      } catch (e) {
        aplicar({
          kind: 'ilegivel',
          card,
          cardUrl: '',
          erro: e instanceof Error ? e.message : String(e),
        })
      }
    })()
  }, [card, lidoEm])

  const cards = useCardsDoBoard()
  const doBoard = dados !== null && dados.cardUrl !== '' ? cards.get(dados.cardUrl) : undefined
  const itemId = doBoard?.itemId ?? null
  const atualId = dados?.kind === 'ok' ? dados.atual.id : null

  const [tasks, setTasks] = useState<TasksLidas>({ kind: 'lendo' })
  useEffect(() => {
    if (itemId === null) {
      setTasks({ kind: 'fora-do-board' })
      return
    }
    let vivo = true
    setTasks({ kind: 'lendo' })
    void (async () => {
      let lido: TasksLidas
      try {
        const r = await window.oc.readCard({ itemId })
        if (!r.ok) {
          lido = { kind: 'erro', motivo: r.reason }
        } else {
          const doTasks = r.content.comments.filter((c: CardComment) => c.kind === 'tasks')
          const ultimo = doTasks[doTasks.length - 1]
          lido = {
            kind: 'ok',
            tasks: ultimo === undefined ? null : tasksDoComentario(ultimo.body),
            truncado: r.content.truncated,
          }
        }
      } catch (e) {
        lido = { kind: 'erro', motivo: e instanceof Error ? e.message : String(e) }
      }
      if (vivo) setTasks(lido)
    })()
    return () => {
      vivo = false
    }
    // O GitHub não é relido a cada retrato: só quando muda o card ou o despacho atual.
  }, [itemId, atualId])

  const [assumindo, setAssumindo] = useState(false)
  const [assumido, setAssumido] = useState<AssumirDespachoResult | null>(null)
  useEffect(() => {
    setAssumindo(false)
    setAssumido(null)
  }, [card])

  const ok = dados?.kind === 'ok' ? dados : null
  const suite = sala?.recursos.suite
  const suiteDeste = suite?.kind === 'ocupada' && suite.card === card

  const assumir = async (): Promise<void> => {
    if (ok === null || itemId === null) return
    setAssumindo(true)
    let r: AssumirDespachoResult
    try {
      r = await window.oc.assumirDespacho({ board: null, despacho: ok.atual.id, itemId })
    } catch (e) {
      r = { ok: false, motivo: e instanceof Error ? e.message : String(e) }
    }
    setAssumido(r)
    setAssumindo(false)
  }

  const estacoes = estadosDasEstacoes(ok?.atual.estacao ?? null)

  return (
    <>
      <CabecalhoInterno
        trilha={trilhaDa(tela, new Date())}
        onIr={ir}
        atual={tela.tela}
        direita={
          <div className="flex flex-wrap gap-2">
            {ok !== null && (
              <Badge variant="neutral" data-testid="fabrica-card-onde">
                {textoDoOnde(ok.atual, ok.ondeRoda)}
              </Badge>
            )}
            {suiteDeste && (
              <Badge
                data-testid="fabrica-card-suite"
                className="bg-warning text-warning-foreground"
              >
                cadeado: suíte de smoke
              </Badge>
            )}
          </div>
        }
      />
      <Card data-testid="fabrica-card-cabeca" className="gap-3.5 bg-secondary-background p-5">
        <div className="flex flex-wrap items-center gap-2">
          {(['Tipo', 'Rota'] as const).map((nome) => {
            const campo = doBoard?.fields.find((f) => f.name === nome)
            return campo === undefined ? null : <FieldBadge key={nome} field={campo} />
          })}
          <Etiqueta>{`operations-center#${card}`}</Etiqueta>
          {doBoard?.parent != null && <Etiqueta>{` · fase do #${doBoard.parent.number}`}</Etiqueta>}
        </div>
        <h1 className="font-heading text-[26px] leading-8">{doBoard?.title ?? `#${card}`}</h1>
        <div role="list" aria-label="Estações" className="flex flex-wrap gap-2">
          {ESTACOES_DO_CARD.map((e, i) => {
            const estado = estacoes[i] ?? 'por-vir'
            return (
              <div
                key={e.estacao}
                role="listitem"
                data-testid="fabrica-estacao"
                data-estado={estado}
                aria-current={estado === 'atual' ? 'step' : undefined}
                className={cn(
                  'min-w-[90px] flex-[1_1_90px] rounded-base border-2 border-border p-2 text-center text-xs font-bold',
                  estado === 'feita' && 'bg-tipo-melhoria',
                  estado === 'atual' && 'bg-main text-main-foreground',
                  estado === 'por-vir' && 'bg-secondary-background',
                )}
              >
                {e.rotulo}
              </div>
            )
          })}
        </div>
      </Card>
      {dados === null && (
        <p data-testid="fabrica-card-lendo" className="text-sm">
          Lendo o card…
        </p>
      )}
      {dados?.kind === 'sem-estado' && (
        <Vazio testid="fabrica-card-sem-estado">
          A fábrica não tem estado.json: nada foi despachado ainda.
        </Vazio>
      )}
      {dados?.kind === 'sem-despacho' && (
        <Vazio testid="fabrica-card-sem-despacho">{`A fábrica não tem despacho do #${card}.`}</Vazio>
      )}
      {dados?.kind === 'ilegivel' && (
        <p role="alert" data-testid="fabrica-card-erro" className="text-sm">
          {`Não deu para ler o card na fábrica: ${dados.erro}`}
        </p>
      )}
      {ok !== null && (
        <div className="flex flex-wrap items-start gap-5">
          <section aria-label="Tasks" className="flex flex-[1_1_420px] flex-col gap-3">
            <h2 className="font-heading text-lg">Tasks do card</h2>
            <ListaDeTasks tasks={tasks} ok={ok} />
            <Decisoes terminados={ok.terminados} />
          </section>
          <section aria-label="Sessão" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 data-testid="fabrica-card-sessao-titulo" className="font-heading text-lg">
                {`Sessão do ${ok.atual.id}, ${rotuloDoEstado(ok.atual.estado)}`}
              </h2>
              <span className="text-xs text-foreground/75">
                {`${skillDoComando(ok.atual.comando)} · despachada pela fábrica`}
              </span>
            </div>
            <Log ok={ok} />
            <div className="flex flex-wrap gap-2.5">
              <Button
                data-testid="fabrica-card-assumir"
                className="min-h-11 bg-main text-main-foreground"
                disabled={
                  ok.atual.estado !== 'concluido' ||
                  ok.atual.sessao === null ||
                  itemId === null ||
                  assumindo
                }
                onClick={() => {
                  void assumir()
                }}
              >
                Assumir a sessão
              </Button>
              {/* Sem `title`: o botão desabilitado tem `pointer-events-none`; o porquê está na nota. */}
              <Button
                variant="neutral"
                data-testid="fabrica-card-mensagem"
                className="min-h-11"
                disabled
              >
                Mandar uma mensagem
              </Button>
              <Button
                variant="neutral"
                data-testid="fabrica-card-parar"
                className="min-h-11"
                disabled
              >
                Parar o turno
              </Button>
            </div>
            <p
              data-testid="fabrica-card-nota"
              className="text-[13px] leading-[18px] text-foreground/85"
            >
              {notaDoAssumir(ok.atual, itemId) + FRASE_FIXA}
            </p>
            {assumido?.ok === true && (
              <p role="status" data-testid="fabrica-card-assumido" className="text-sm">
                {'A sessão abriu na janela do card.' +
                  (assumido.anterior === null
                    ? ''
                    : ` A conversa que o cartão tinha (${assumido.anterior}) continua no disco: claude --resume ${assumido.anterior}, rodado na pasta do repo do card, a reabre.`)}
              </p>
            )}
            {assumido?.ok === false && (
              <p role="alert" data-testid="fabrica-card-assumir-erro" className="text-sm">
                {assumido.motivo}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  )
}

function ListaDeTasks({
  tasks,
  ok,
}: {
  tasks: TasksLidas
  ok: Extract<CardNaFabrica, { kind: 'ok' }>
}): JSX.Element {
  if (tasks.kind === 'lendo') {
    return <Vazio testid="fabrica-card-tasks-vazio">Lendo as tasks do card…</Vazio>
  }
  if (tasks.kind === 'fora-do-board') {
    return (
      <Vazio testid="fabrica-card-tasks-vazio">
        O card não está num board aberto no app: as tasks vêm do comentário gm:tasks dele.
      </Vazio>
    )
  }
  if (tasks.kind === 'erro') {
    return <Vazio testid="fabrica-card-tasks-vazio">{`Sem leitura do card: ${tasks.motivo}`}</Vazio>
  }
  if (tasks.tasks === null) {
    return (
      <Vazio testid="fabrica-card-tasks-vazio">
        {'O card ainda não tem tasks: o comentário gm:tasks nasce no G3.' +
          (tasks.truncado ? ' O app leu os 100 primeiros comentários.' : '')}
      </Vazio>
    )
  }
  if (tasks.tasks.length === 0) {
    return (
      <Vazio testid="fabrica-card-tasks-vazio">
        O comentário gm:tasks do card não tem linha de task.
      </Vazio>
    )
  }
  const estados = estadosDasTasks(tasks.tasks, ok.atual, ok.viva)
  return (
    <Card
      data-testid="fabrica-card-tasks"
      className="gap-0 overflow-hidden bg-secondary-background p-0"
    >
      {tasks.tasks.map((t, i) => {
        const estado = estados[i] ?? 'na-fila'
        return (
          <div
            key={t.numero}
            data-testid="fabrica-task"
            data-estado={estado}
            className={cn(
              'flex items-center gap-3 border-b-2 border-border px-3.5 py-3 text-sm last:border-b-0',
              estado === 'trabalhando' && 'bg-main/10',
            )}
          >
            <span
              className={cn(
                'flex size-7 flex-none items-center justify-center rounded-full border-2 border-border text-[13px] font-bold',
                estado === 'feita' && 'bg-attention',
                estado === 'trabalhando' && 'bg-main',
                estado === 'na-fila' && 'bg-secondary-background',
              )}
            >
              {t.numero}
            </span>
            <span className={cn('flex-1', estado === 'trabalhando' && 'font-bold')}>
              {t.titulo}
            </span>
            {estado === 'feita' && <Etiqueta>feita</Etiqueta>}
            {estado === 'trabalhando' && (
              <Badge className="bg-attention text-attention-foreground">trabalhando</Badge>
            )}
            {estado === 'na-fila' && <span className="text-xs text-foreground/75">na fila</span>}
          </div>
        )
      })}
    </Card>
  )
}

function Decisoes({ terminados }: { terminados: DespachoDoCard[] }): JSX.Element {
  const mostrados = terminados.slice(0, 6)
  return (
    <Card data-testid="fabrica-card-decisoes" className="gap-2 bg-secondary-background p-3.5">
      <h3 className="font-heading text-[15px]">Decisões deste card</h3>
      {mostrados.length === 0 && (
        <Vazio testid="fabrica-card-decisoes-vazio">
          Nenhum despacho deste card terminou ainda.
        </Vazio>
      )}
      {mostrados.map((d) => {
        const skill = skillDoComando(d.comando)
        return (
          <div key={d.id} data-testid="fabrica-card-decisao" className="text-[13px] leading-[18px]">
            <Etiqueta className="mr-1.5">{ROTULO_DO_PASSO[skill] ?? skill}</Etiqueta>
            {`${textoDaDecisao(d)} · ${horaCurta(d.concluidoEm ?? d.criadoEm)}`}
          </div>
        )
      })}
      {terminados.length > 6 && (
        <p className="text-xs text-foreground/75">{`e mais ${terminados.length - 6} no estado.json`}</p>
      )}
      <p className="text-xs text-foreground/75">Os porquês ficam no cofre, fora do app.</p>
    </Card>
  )
}

const LINHA = 'm-0 whitespace-pre-wrap font-mono text-xs leading-5'

/** A caixa escura: o comando, o estado e o fim. Não é log ao vivo (a sessão devolve JSON no fim). */
function Log({ ok }: { ok: Extract<CardNaFabrica, { kind: 'ok' }> }): JSX.Element {
  const { atual, viva, ondeRoda, resultado } = ok
  const fim = linhaDoFim(atual)
  return (
    <Card
      data-testid="fabrica-card-log"
      className="min-h-[360px] gap-1 bg-foreground p-4 text-background"
    >
      <pre className={LINHA}>{`› ${atual.comando}`}</pre>
      {atual.estado === 'pendente' && (
        <>
          <pre className={LINHA}>{`› criado em ${horaCurta(atual.criadoEm)}`}</pre>
          <pre className={cn(LINHA, 'text-main')}>● na fila de lançamento</pre>
        </>
      )}
      {(atual.estado === 'lancando' || atual.estado === 'rodando') && (
        <>
          <pre className={LINHA}>
            {`› lançado em ${horaCurta(atual.lancadoEm ?? atual.criadoEm)} · ${ondeRoda}`}
          </pre>
          <pre className={LINHA}>› o texto da sessão só chega quando ela termina (saída JSON)</pre>
          <pre className={cn(LINHA, 'text-main')}>
            {viva === false
              ? '● sem sessão viva; o despachante recolhe quando rodar'
              : atual.estado === 'lancando'
                ? '● subindo a sessão…'
                : '● rodando…'}
          </pre>
        </>
      )}
      {atual.estado === 'concluido' && (
        <>
          <pre className={LINHA}>
            {`› terminou em ${horaCurta(atual.concluidoEm ?? atual.criadoEm)}`}
          </pre>
          {resultado === null ? (
            <pre className={LINHA}>› a sessão não deixou texto final</pre>
          ) : (
            <pre data-testid="fabrica-card-resultado" className={LINHA}>
              {resultado}
            </pre>
          )}
          {fim !== null && (
            <pre data-testid="fabrica-card-fim" className={cn(LINHA, 'text-main')}>
              {fim}
            </pre>
          )}
        </>
      )}
    </Card>
  )
}
