import type { JSX, ReactNode } from 'react'

import type { BoardCard, BoardsSnapshot } from '../../../shared/board'
import type {
  BoardNaFabricaOk,
  DecisaoNaSala,
  DespachoNaSala,
  ItemNaSala,
  RecursosDaFabrica,
  SalaDaFabrica,
} from '../../../shared/fabrica'
import { FieldBadge } from '../../components/FieldBadge'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { cn } from '../../ui/cn'
import { abrirAoClicar } from '../cartao'
import {
  COLUNAS_DA_LINHA,
  ROTULO_DA_ESTACAO,
  ROTULO_DO_PASSO,
  colunaDaEstacao,
  estadoNaLinha,
  gigas,
  horaCurta,
  plural,
  rotuloDoCard,
  skillDoComando,
} from '../linha'
import { repoDaFabrica } from '../boardDaFabrica'
import { abaDaLinha, cardsDaLinha, mostraAFabrica, type CardNaLinha } from '../linhaDoBoard'
import { CabecalhoDaSala, ListaComTeto } from '../Moldura'
import { rotaDoItem, type TelaDaFabrica } from '../rotas'
import type { PropsDaTela } from '../telas'
import { useCardsDoBoard } from '../useCardsDoBoard'
import { useRetratoDosBoards } from '../useRetratoDosBoards'

type SalaOk = Extract<SalaDaFabrica, { kind: 'ok' }>
type Ir = PropsDaTela['ir']
type Cards = ReadonlyMap<string, BoardCard>

/** O `.empty` do protótipo, o mesmo do marcador de tela por vir. */
const VAZIO =
  'rounded-base border-2 border-dashed border-border bg-secondary-background/45 p-3 text-xs text-foreground/75'

/** A caixa de nível (`.lvl`); a pequena é a da lista de decisões. */
const NIVEL =
  'inline-flex items-center justify-center rounded-[4px] border-2 border-border bg-secondary-background font-bold'

function Nivel({
  texto,
  cor,
  pequeno = false,
}: {
  texto: string
  cor?: string
  pequeno?: boolean
}): JSX.Element {
  const tamanho = pequeno ? 'mr-1.5 size-[18px] text-[11px]' : 'size-[22px] text-xs'

  return <span className={cn(NIVEL, tamanho, cor)}>{texto}</span>
}

/** O ponto de estado das linhas e dos cartões. */
function Ponto({ cor }: { cor: string }): JSX.Element {
  return (
    <span
      aria-hidden
      className={`inline-block size-2.5 rounded-full border-2 border-border ${cor}`}
    />
  )
}

function corDoPonto(d: DespachoNaSala): string {
  if (d.viva === false) return 'bg-danger'
  if (d.estado === 'rodando') return 'bg-attention'
  if (d.estado === 'lancando') return 'bg-warning'
  return 'bg-secondary-background'
}

/** Tipo antes de Rota, só do que o board do app sabe; card fora do board fica sem etiqueta. */
function Etiquetas({ card }: { card: BoardCard | undefined }): JSX.Element | null {
  if (card === undefined) return null
  const campos = ['Tipo', 'Rota']
    .map((nome) => card.fields.find((f) => f.name === nome))
    .filter((f) => f !== undefined)
  if (campos.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {campos.map((campo) => (
        <FieldBadge key={campo.name} field={campo} />
      ))}
    </div>
  )
}

/** O cadeado da suíte de smoke (`.chip` do protótipo). */
function BadgeDaSuite({ testid }: { testid?: string }): JSX.Element {
  return (
    <Badge variant="neutral" data-testid={testid} className="self-start">
      <svg
        viewBox="0 0 24 24"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden
      >
        <rect x="5" y="11" width="14" height="10" rx="1" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      suíte de smoke
    </Badge>
  )
}

/**
 * A Sala (#131, §F2.8): o cabeçalho da Sala e, embaixo, o resumo, "Esperando você", a Linha de
 * produção e os recursos, tudo lido do retrato. **Contrato entre fases:** todo cartão da fila tem
 * `fabrica-aberto` e todo despacho em voo `fabrica-em-voo` com `data-state`.
 */
export function Sala({ sala, ir, comando, emVoo, board }: PropsDaTela): JSX.Element {
  return (
    <>
      <CabecalhoDaSala
        sala={sala}
        emVoo={emVoo}
        onIr={ir}
        onComando={(c) => void comando(c)}
        padrao={board.padrao}
      />
      <Corpo sala={sala} ir={ir} board={board} />
    </>
  )
}

function Corpo({
  sala,
  ir,
  board,
}: {
  sala: SalaDaFabrica | null
  ir: Ir
  board: BoardNaFabricaOk
}): JSX.Element {
  const cards = useCardsDoBoard()
  const boards = useRetratoDosBoards()

  if (sala === null) {
    return (
      <p data-testid="fabrica-lendo" className="text-sm">
        Lendo o estado da fábrica…
      </p>
    )
  }

  if (sala.kind === 'sem-estado') {
    return (
      <>
        <div data-testid="fabrica-vazia" className={VAZIO}>
          Nenhum despacho registrado ainda. A fábrica começa num yarn fabrica iniciar.
        </div>
        <Linha sala={null} ir={ir} cards={cards} boards={boards} board={board} />
        <Recursos recursos={sala.recursos} />
      </>
    )
  }

  if (sala.kind === 'ilegivel') {
    return (
      <>
        <div role="alert" data-testid="fabrica-erro" className="flex flex-col gap-1 text-sm">
          <p>Não foi possível ler o estado da fábrica.</p>
          <p className="text-xs break-words text-foreground/75">{sala.erro}</p>
        </div>
        <Linha sala={null} ir={ir} cards={cards} boards={boards} board={board} />
        <Recursos recursos={sala.recursos} />
      </>
    )
  }

  return (
    <>
      <Resumo sala={sala} ir={ir} />
      <div className="flex flex-wrap items-start gap-5">
        <Esperando sala={sala} ir={ir} cards={cards} />
        <Linha sala={sala} ir={ir} cards={cards} boards={boards} board={board} />
        <aside
          aria-label="Recursos e atividade"
          className="flex flex-[1_1_280px] max-w-[340px] flex-col gap-4"
        >
          <Recursos recursos={sala.recursos} />
          <Decidiu decisoes={sala.decisoes} ir={ir} />
        </aside>
      </div>
    </>
  )
}

function Numero({
  testid,
  fundo,
  numero,
  title,
  children,
}: {
  testid: string
  fundo: string
  numero: string
  title?: string
  children: ReactNode
}): JSX.Element {
  return (
    <Card
      data-testid={testid}
      title={title}
      className={`flex-[1_1_200px] flex-row items-baseline gap-2.5 px-4 py-3 ${fundo}`}
    >
      <span className="font-heading text-[32px] leading-none font-bold">{numero}</span>
      {children}
    </Card>
  )
}

function Resumo({ sala, ir }: { sala: SalaOk; ir: Ir }): JSX.Element {
  const trabalhando = sala.emVoo.filter(
    (d) => (d.estado === 'lancando' || d.estado === 'rodando') && d.viva !== false,
  ).length
  const { suite } = sala.recursos
  const cadeados = suite.kind === 'ocupada' ? 1 : 0
  const quebradas = sala.abertos.filter((i) => i.sessaoQuebrada).length

  return (
    <section aria-label="Resumo" className="flex flex-wrap gap-3">
      <Numero
        testid="fabrica-resumo-esperando"
        fundo="bg-warning"
        numero={String(sala.abertos.length)}
      >
        <span className="text-sm font-bold">esperando você</span>
      </Numero>
      <Numero
        testid="fabrica-resumo-trabalhando"
        fundo="bg-secondary-background"
        numero={String(trabalhando)}
      >
        <button
          type="button"
          className="text-sm font-bold underline"
          onClick={() => {
            ir({ tela: 'agentes' })
          }}
        >
          {plural(trabalhando, 'agente trabalhando', 'agentes trabalhando')}
        </button>
      </Numero>
      {suite.kind === 'sem-leitura' ? (
        <Numero
          testid="fabrica-resumo-cadeados"
          fundo="bg-secondary-background"
          numero="—"
          title={suite.motivo}
        >
          <span className="text-sm font-bold">cadeados ocupados</span>
        </Numero>
      ) : (
        <Numero
          testid="fabrica-resumo-cadeados"
          fundo="bg-secondary-background"
          numero={String(cadeados)}
        >
          <span className="text-sm font-bold">
            {plural(cadeados, 'cadeado ocupado', 'cadeados ocupados')}
          </span>
        </Numero>
      )}
      <Numero
        testid="fabrica-resumo-quebradas"
        fundo="bg-secondary-background"
        numero={String(quebradas)}
      >
        <span className="text-sm font-bold">
          {plural(quebradas, 'sessão quebrada', 'sessões quebradas')}
        </span>
      </Numero>
    </section>
  )
}

function Esperando({ sala, ir, cards }: { sala: SalaOk; ir: Ir; cards: Cards }): JSX.Element {
  return (
    <section
      aria-label="Esperando você"
      className="flex max-w-[400px] flex-[1_1_340px] flex-col gap-3"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-lg">Esperando você</h2>
        <span className="text-xs text-foreground/75">mais antiga primeiro</span>
      </div>
      {sala.abertos.length === 0 && (
        <div data-testid="fabrica-nada-esperando" className={VAZIO}>
          Nada esperando você.
        </div>
      )}
      {sala.abertos.map((item) => (
        <CartaoAberto
          key={item.id}
          item={item}
          ir={ir}
          titulo={cards.get(item.cardUrl)?.title ?? null}
        />
      ))}
    </section>
  )
}

function CartaoAberto({
  item,
  ir,
  titulo,
}: {
  item: ItemNaSala
  ir: Ir
  titulo: string | null
}): JSX.Element {
  // Os botões só navegam; o cartão inteiro também, e o botão não deixa o clique subir até ele.
  const navegar = (para: TelaDaFabrica) => (evento: { stopPropagation: () => void }) => {
    evento.stopPropagation()
    ir(para)
  }

  return (
    <Card asChild className="cursor-pointer gap-2 bg-secondary-background p-3.5">
      <article
        data-testid="fabrica-aberto"
        data-item={item.id}
        onClick={() => {
          ir(rotaDoItem(item))
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {item.tipo === 'pergunta' ? (
            <Badge className="bg-question text-question-foreground">Pergunta</Badge>
          ) : (
            <Badge className="bg-warning text-warning-foreground">Aprovar</Badge>
          )}
          {item.sessaoQuebrada && (
            <Badge className="bg-danger text-danger-foreground">sessão quebrada</Badge>
          )}
          <Badge variant="neutral" className="rounded-[4px] border-[1.5px] px-1.5 py-0 text-[11px]">
            #{item.card}
            {item.estacao !== null && ` · ${ROTULO_DA_ESTACAO[item.estacao]}`}
          </Badge>
        </div>
        <h3 className="text-[15px] leading-5 font-bold">{item.motivo}</h3>
        <p className="text-[13px] leading-[18px] text-foreground/85">
          {rotuloDoCard(item.card, titulo)} · parou em {item.comando ?? item.despacho} em{' '}
          {horaCurta(item.criadoEm)}
        </p>
        <div className="flex flex-wrap gap-2">
          {item.tipo === 'pergunta' ? (
            <>
              <Button
                size="sm"
                className="bg-question text-question-foreground"
                data-testid="fabrica-responder"
                onClick={navegar(rotaDoItem(item))}
              >
                Responder
              </Button>
              <Button
                size="sm"
                variant="neutral"
                data-testid="fabrica-ver-contexto"
                onClick={navegar({ tela: 'card', card: item.card, repo: item.repo })}
              >
                Ver contexto
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="bg-warning text-warning-foreground"
              data-testid="fabrica-responder"
              onClick={navegar(rotaDoItem(item))}
            >
              Revisar evidência
            </Button>
          )}
        </div>
      </article>
    </Card>
  )
}

/**
 * A Linha só leitura do board da aba, para a fábrica que recusou o board (#157, §11): sem retrato da
 * fábrica não há despacho, e os cartões do board são só os que o board mostra.
 */
export function LinhaSemFabrica(): JSX.Element {
  const cards = useCardsDoBoard()
  const boards = useRetratoDosBoards()

  return <Linha sala={null} ir={() => undefined} cards={cards} boards={boards} board={null} />
}

function Linha({
  sala,
  ir,
  cards,
  boards,
  board,
}: {
  sala: SalaOk | null
  ir: Ir
  cards: Cards
  boards: BoardsSnapshot | null
  board: BoardNaFabricaOk | null
}): JSX.Element {
  const suite = sala?.recursos.suite
  const fabrica = sala !== null && board !== null && mostraAFabrica(boards, board.chave)
  const emVoo = fabrica ? sala.emVoo : []
  const abertos = fabrica ? sala.abertos : []
  const foraDaLinha = emVoo.filter((d) => d.estacao === null)
  const aba = abaDaLinha(boards)
  const jaNaLinha = new Set(
    [...emVoo.map((d) => d.cardUrl), ...abertos.map((i) => i.cardUrl)].map((u) => u.toLowerCase()),
  )
  const doBoard = aba.kind === 'ok' ? cardsDaLinha(aba.board, jaNaLinha) : null

  return (
    <section
      aria-label="Linha de produção"
      className="flex min-w-0 flex-[999_1_600px] flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-heading text-lg">Linha de produção</h2>
          <span
            data-testid="fabrica-linha-board"
            data-board={aba.kind === 'sem-aba' ? '' : aba.key}
            title={aba.kind === 'erro' ? aba.erro : undefined}
            className="text-xs text-foreground/75"
          >
            {rotuloDaAba(aba)}
          </span>
        </div>
        <span className="text-xs text-foreground/75">
          A a fábrica decide · B você aprova · C só você
        </span>
      </div>
      <div className="overflow-x-auto pr-1.5 pb-2.5">
        <div className="grid grid-cols-[repeat(9,210px)] items-start gap-3">
          {COLUNAS_DA_LINHA.map(({ coluna, rotulo, nivel, vazio }) => {
            const despachos = emVoo.filter((d) => colunaDaEstacao(d.estacao) === coluna)
            const itens = abertos.filter((i) => colunaDaEstacao(i.estacao) === coluna)
            const doBoardNaColuna = doBoard?.porColuna.get(coluna) ?? []

            return (
              <div
                key={coluna}
                data-testid="fabrica-coluna"
                data-coluna={coluna}
                className="flex flex-col gap-2.5"
              >
                {/* O rótulo é texto direto do `div`: sem `span`, o "Entrada" da coluna não colide
                    com o botão "Entrada" da navegação no localizador estrito do harness. */}
                <div className="flex items-center justify-between gap-2 rounded-base border-2 border-border bg-main px-2.5 py-2 font-heading text-sm font-bold">
                  {rotulo}
                  <Nivel texto={nivel} />
                </div>
                {despachos.length === 0 && itens.length === 0 && doBoardNaColuna.length === 0 ? (
                  <div className={VAZIO}>{vazio}</div>
                ) : (
                  <ListaComTeto lista={`linha-${coluna}`} className="flex flex-col gap-2.5">
                    {despachos.map((d) => (
                      <CartaoDeDespacho
                        key={d.id}
                        d={d}
                        card={cards.get(d.cardUrl)}
                        segura={suite?.kind === 'ocupada' && suite.card === d.card}
                        ir={ir}
                      />
                    ))}
                    {itens.map((item) => (
                      <CartaoParado
                        key={item.id}
                        item={item}
                        card={cards.get(item.cardUrl)}
                        ir={ir}
                      />
                    ))}
                    {doBoardNaColuna.map((c) => (
                      <CartaoDoBoard key={c.card.itemId} c={c} ir={ir} board={board} />
                    ))}
                  </ListaComTeto>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {doBoard !== null && doBoard.aParte.length > 0 && (
        <section
          data-testid="fabrica-linha-a-parte"
          aria-label="Fora das estações da linha"
          className="flex flex-col gap-2"
        >
          <h3 className="text-sm font-bold">Fora das estações da linha</h3>
          {doBoard.aParte.map((g) => (
            <div
              key={g.coluna}
              data-testid="fabrica-a-parte-coluna"
              data-coluna-do-board={g.coluna}
              className="flex flex-col gap-1.5"
            >
              <span className="text-xs font-bold">
                {g.coluna === '' ? 'coluna não declarada no board' : g.coluna}
              </span>
              <ListaComTeto lista={`a-parte-${g.coluna}`} className="flex flex-wrap gap-3">
                {g.cards.map((c) => (
                  <div key={c.card.itemId} className="w-[210px]">
                    <CartaoDoBoard c={c} ir={ir} board={board} />
                  </div>
                ))}
              </ListaComTeto>
            </div>
          ))}
        </section>
      )}
      {foraDaLinha.length > 0 && (
        <p
          data-testid="fabrica-linha-fora"
          className="flex flex-wrap gap-2 text-xs text-foreground/75"
        >
          Fora da linha:
          {foraDaLinha.map((d) => (
            <button
              key={d.id}
              type="button"
              data-testid="fabrica-em-voo"
              data-state={d.estado}
              className="text-left underline"
              onClick={() => {
                ir({ tela: 'card', card: d.card, repo: d.repo })
              }}
            >
              {`${rotuloDoCard(d.card, cards.get(d.cardUrl)?.title ?? null)} ${d.comando}`}
            </button>
          ))}
        </p>
      )}
    </section>
  )
}

function rotuloDaAba(aba: ReturnType<typeof abaDaLinha>): string {
  switch (aba.kind) {
    case 'ok':
      return `board ${aba.titulo}`
    case 'lendo':
      return `board ${aba.titulo} · lendo…`
    case 'erro':
      return `board ${aba.titulo} · sem leitura`
    case 'sem-aba':
      return aba.motivo === 'lendo' ? 'lendo os boards…' : 'nenhum board selecionado'
  }
}

/** Card aberto do board da aba: só o de um repo do board da fábrica navega (os comandos da fábrica são presos a ele, CA-3). */
function CartaoDoBoard({
  c,
  ir,
  board,
}: {
  c: CardNaLinha
  ir: Ir
  board: BoardNaFabricaOk | null
}): JSX.Element {
  const rotulo = rotuloDoCard(c.card.number, c.card.title)
  const repo = board === null ? null : repoDaFabrica(board, c.card.repository)

  return (
    <Card asChild className="gap-1.5 bg-secondary-background p-2.5">
      <article
        data-testid="fabrica-board-card"
        data-card={c.card.url}
        data-coluna-do-board={c.coluna}
      >
        <Etiquetas card={c.card} />
        {repo !== null ? (
          <button
            type="button"
            data-testid="fabrica-board-card-abrir"
            className="text-left text-[13px] leading-[17px] font-bold underline"
            onClick={() => {
              ir({ tela: 'card', card: c.card.number, repo })
            }}
          >
            {rotulo}
          </button>
        ) : (
          <div className="text-[13px] leading-[17px] font-bold" title={c.card.repository}>
            {rotulo}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs">
          <Ponto cor="bg-secondary-background" />
          {c.coluna === '' ? 'coluna não declarada' : c.coluna}
        </div>
      </article>
    </Card>
  )
}

function CartaoDeDespacho({
  d,
  card,
  segura,
  ir,
}: {
  d: DespachoNaSala
  card: BoardCard | undefined
  segura: boolean
  ir: Ir
}): JSX.Element {
  return (
    <Card asChild className="cursor-pointer gap-1.5 bg-secondary-background p-2.5">
      <article
        data-abre-card={d.card}
        onClick={abrirAoClicar(() => {
          ir({ tela: 'card', card: d.card, repo: d.repo })
        })}
      >
        <Etiquetas card={card} />
        <button
          type="button"
          data-testid="fabrica-em-voo"
          data-state={d.estado}
          className="text-left text-[13px] leading-[17px] font-bold underline"
          onClick={() => {
            ir({ tela: 'card', card: d.card, repo: d.repo })
          }}
        >
          {rotuloDoCard(d.card, card?.title ?? null)}
        </button>
        <div className="flex items-center gap-1.5 text-xs">
          <Ponto cor={corDoPonto(d)} />
          {`${skillDoComando(d.comando)} · ${estadoNaLinha(d, 'sala')}`}
        </div>
        {segura && <BadgeDaSuite testid="fabrica-segura-suite" />}
      </article>
    </Card>
  )
}

function CartaoParado({
  item,
  card,
  ir,
}: {
  item: ItemNaSala
  card: BoardCard | undefined
  ir: Ir
}): JSX.Element {
  const quebrada = item.sessaoQuebrada

  return (
    <Card asChild className="cursor-pointer gap-1.5 bg-secondary-background p-2.5">
      <article
        data-testid="fabrica-linha-parada"
        data-abre-card={item.card}
        onClick={abrirAoClicar(() => {
          ir({ tela: 'card', card: item.card, repo: item.repo })
        })}
      >
        <Etiquetas card={card} />
        <div className="text-[13px] leading-[17px] font-bold">
          {rotuloDoCard(item.card, card?.title ?? null)}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Ponto cor={quebrada ? 'bg-danger' : 'bg-question'} />
          {quebrada ? 'sessão quebrada' : 'parada na sua fila'}
        </div>
        <Badge
          asChild
          className={`self-start ${quebrada ? 'bg-danger text-danger-foreground' : 'bg-question text-question-foreground'}`}
        >
          <button
            type="button"
            onClick={() => {
              ir(rotaDoItem(item))
            }}
          >
            {quebrada ? 'FALHA' : 'PARADA'}
          </button>
        </Badge>
      </article>
    </Card>
  )
}

function LinhaDoRecurso({ nome, children }: { nome: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 text-[13px]">
      <span className="font-bold">{nome}</span>
      {children}
    </div>
  )
}

function Recursos({ recursos }: { recursos: RecursosDaFabrica }): JSX.Element {
  const { sessoes, suite, disco } = recursos
  const vivas = sessoes.kind === 'ok' ? sessoes.vivas : 0

  return (
    <Card asChild className="gap-3 bg-secondary-background p-3.5">
      <section data-testid="fabrica-recursos">
        <h2 className="font-heading text-base">Recursos</h2>
        <div data-testid="fabrica-recurso-sessoes" className="flex flex-col gap-1.5">
          <LinhaDoRecurso nome="Sessões simultâneas">
            {sessoes.kind === 'ok' ? (
              <span>{`${sessoes.vivas} de ${sessoes.teto}`}</span>
            ) : (
              <span title={sessoes.motivo}>sem leitura</span>
            )}
          </LinhaDoRecurso>
          <div className="h-3.5 overflow-hidden rounded-[4px] border-2 border-border bg-secondary-background">
            {sessoes.kind === 'ok' && vivas > 0 && (
              <div
                className="h-full border-r-2 border-border bg-main"
                style={{ width: `${Math.min(100, Math.round((vivas / sessoes.teto) * 100))}%` }}
              />
            )}
          </div>
        </div>
        <LinhaDoRecurso nome="Suíte de smoke">
          {suite.kind === 'ocupada' ? (
            <Badge
              data-testid="fabrica-recurso-suite"
              className="bg-warning text-warning-foreground"
            >
              {`${suite.card === null ? 'ocupada' : `#${suite.card}`} · ${suite.esperando === 0 ? 'fila vazia' : `${suite.esperando} esperando`}`}
            </Badge>
          ) : suite.kind === 'livre' ? (
            <Badge
              data-testid="fabrica-recurso-suite"
              className="bg-attention text-attention-foreground"
            >
              livre
            </Badge>
          ) : (
            <Badge variant="neutral" data-testid="fabrica-recurso-suite" title={suite.motivo}>
              sem leitura
            </Badge>
          )}
        </LinhaDoRecurso>
        <LinhaDoRecurso nome="Cópias do Ghidra">
          <Badge variant="neutral" title="esta fábrica não usa o Ghidra">
            não se aplica
          </Badge>
        </LinhaDoRecurso>
        <LinhaDoRecurso nome="Disco">
          {disco.kind === 'ok' ? (
            <Badge
              data-testid="fabrica-recurso-disco"
              title={`${gigas(disco.livres)} livres`}
              className={
                disco.livres >= disco.minimo
                  ? 'bg-attention text-attention-foreground'
                  : 'bg-danger text-danger-foreground'
              }
            >
              {disco.livres >= disco.minimo ? 'acima de 2 GB' : 'abaixo de 2 GB'}
            </Badge>
          ) : (
            <Badge variant="neutral" data-testid="fabrica-recurso-disco" title={disco.motivo}>
              sem leitura
            </Badge>
          )}
        </LinhaDoRecurso>
        <LinhaDoRecurso nome="Cota do plano">
          <Badge variant="neutral" title="o app não lê a cota do plano do Claude">
            sem leitura
          </Badge>
        </LinhaDoRecurso>
      </section>
    </Card>
  )
}

function Decidiu({ decisoes, ir }: { decisoes: DecisaoNaSala[]; ir: Ir }): JSX.Element {
  return (
    <Card asChild className="gap-2.5 bg-secondary-background p-3.5">
      <section>
        <h2 className="font-heading text-base">O que a fábrica decidiu</h2>
        <div className="flex max-h-[420px] flex-col gap-2.5 overflow-y-auto text-xs leading-4">
          {decisoes.length === 0 && <p>Nada decidido ainda.</p>}
          {decisoes.map((decisao) =>
            decisao.tipo === 'passou' ? (
              <div key={decisao.id} data-testid="fabrica-decidiu">
                <Nivel texto="A" pequeno />
                <b>
                  {ROTULO_DO_PASSO[decisao.skill] ?? `/${decisao.skill}`} do #{decisao.card}
                </b>{' '}
                passou; o próximo passo é /{decisao.seguinte}.
              </div>
            ) : (
              <button
                key={decisao.id}
                type="button"
                className="text-left"
                data-testid={decisao.item.fechadoEm === null ? 'fabrica-parou' : 'fabrica-fechado'}
                onClick={() => {
                  ir(rotaDoItem(decisao.item))
                }}
              >
                <Nivel
                  texto={decisao.item.sessaoQuebrada ? '!' : '?'}
                  cor={decisao.item.sessaoQuebrada ? 'bg-danger' : 'bg-question'}
                  pequeno
                />
                <b>#{decisao.card}</b> parou e mandou para a sua fila: {decisao.item.motivo}.
                {decisao.item.fechadoEm !== null &&
                  decisao.item.resolucao !== null &&
                  ` resolvido: ${decisao.item.resolucao}`}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className="self-start text-xs font-bold underline"
          data-testid="fabrica-ver-mandato"
          onClick={() => {
            ir({ tela: 'mandato' })
          }}
        >
          Ver mandato em vigor
        </button>
      </section>
    </Card>
  )
}
