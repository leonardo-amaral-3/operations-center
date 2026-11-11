import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import type { CardNaFabrica, DespachoDoCard, DespachoNaSala } from '../../../shared/fabrica'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { cn } from '../../ui/cn'
import { Input } from '../../ui/input'
import { Textarea } from '../../ui/textarea'
import {
  LIMITE_DA_NOTA,
  LIMITE_DE_DESPACHOS_POR_FRENTE,
  NAO_FAZER_HOJE,
  frentesDoBriefing,
  notaDoBriefing,
  type FrenteDoBriefing,
} from '../briefing'
import { linhaDoFim, rotuloDoEstado } from '../emVoo'
import { rotuloDoCard } from '../linha'
import { CabecalhoInterno } from '../Moldura'
import { trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'
import { useBoardDaFabrica } from '../useBoardDaFabrica'

type Resultado = 'aberta' | 'nao-abriu' | 'sem-leitura' | 'ja-em-voo' | 'nao-solta'
type Plano = CardNaFabrica | { kind: 'falha'; erro: string }

const TEXTO_DO_RESULTADO: Record<Resultado, string> = {
  aberta: 'Aberta: o despacho está pendente na fila do yarn fabrica rodar.',
  'nao-abriu': 'Não abriu: o motivo é a mensagem do yarn fabrica embaixo.',
  'sem-leitura':
    'Não deu para conferir se abriu: a leitura da fábrica falhou. Veja na Sala antes de soltar de novo.',
  'ja-em-voo': 'Já estava em voo: não foi solta de novo.',
  'nao-solta': 'Não foi solta: o dia parou na frente anterior.',
}

const MAXIMO_DE_PLANOS = 3

// Padrão local da tela (§F4.9): a função `Vazio` é copiada em cada tela.
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

/** O dia local em `AAAA-MM-DD`: em UTC a nota sairia com a data de amanhã depois das 21:00. */
function diaLocal(d: Date): string {
  const dois = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function Frente({
  frente,
  teto,
  marcada,
  pronto,
  resultado,
  onMarcar,
  onPronto,
  onVer,
}: {
  frente: FrenteDoBriefing
  teto: string
  marcada: boolean
  pronto: string
  resultado: Resultado | undefined
  onMarcar: (marcar: boolean) => void
  onPronto: (texto: string) => void
  onVer: () => void
}): JSX.Element {
  const { card, titulo, coluna, comando, emVoo } = frente
  return (
    <Card
      data-testid="fabrica-briefing-frente"
      data-card={card}
      data-estado={emVoo ? 'em-voo' : 'candidata'}
      className="gap-3 bg-secondary-background p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-[17px]">{`#${card} · ${titulo}`}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge data-testid="fabrica-briefing-chip" className="bg-rota-completa">
            {`${coluna} · ${comando}`}
          </Badge>
          {emVoo && <Badge className="bg-warning text-warning-foreground">já em voo</Badge>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-3 flex flex-col gap-1 text-xs font-bold">
          Pronto quando
          <Input
            type="text"
            data-testid="fabrica-briefing-pronto"
            className="min-h-10"
            placeholder="o que fecha a frente hoje; vai na nota"
            value={pronto}
            disabled={emVoo}
            onChange={(e) => onPronto(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold">
          Teto de tempo
          <Input type="text" className="min-h-10" readOnly value="sem teto na fábrica" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold">
          Teto de sessões
          <Input type="text" className="min-h-10" readOnly value={teto} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold">
          Autonomia
          <Input type="text" className="min-h-10" readOnly value="até a PR" />
        </label>
      </div>
      {emVoo ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-foreground/75">
            Já tem despacho em voo. A frente segue pela fábrica.
          </p>
          <Button variant="neutral" size="sm" data-testid="fabrica-briefing-ver" onClick={onVer}>
            {`Ver #${card}`}
          </Button>
        </div>
      ) : (
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            data-testid="fabrica-briefing-entra"
            className="size-5 accent-foreground"
            checked={marcada}
            onChange={(e) => onMarcar(e.target.checked)}
          />
          Entra no dia
        </label>
      )}
      {resultado !== undefined && (
        <p
          data-testid="fabrica-briefing-resultado"
          data-resultado={resultado}
          className="text-sm font-bold"
        >
          {TEXTO_DO_RESULTADO[resultado]}
        </p>
      )}
    </Card>
  )
}

/** Os passos de um card em voo: um por despacho, do mais velho ao mais novo. */
function passosDoCard(c: Extract<CardNaFabrica, { kind: 'ok' }>): DespachoDoCard[] {
  const lista = [...c.terminados].reverse()
  if (!lista.some((d) => d.id === c.atual.id)) lista.push(c.atual)
  return lista
}

function PlanoDoCard({
  card,
  titulo,
  plano,
}: {
  card: number
  titulo: string | null
  plano: Plano | undefined
}): JSX.Element {
  let corpo: JSX.Element
  if (plano === undefined) {
    corpo = <p className="text-xs text-foreground/75">{`lendo os despachos do #${card}…`}</p>
  } else if (plano.kind === 'ok') {
    corpo = (
      <>
        {passosDoCard(plano).map((d, i) => (
          <div
            key={d.id}
            data-testid="fabrica-briefing-passo"
            className="flex gap-2.5 text-[13px] leading-[18px]"
          >
            <span className="flex size-6 flex-none items-center justify-center rounded-full border-2 border-border bg-secondary-background text-xs font-bold">
              {i + 1}
            </span>
            <span>{`${d.comando} ${linhaDoFim(d) ?? `· ${rotuloDoEstado(d.estado)}`}`}</span>
          </div>
        ))}
      </>
    )
  } else {
    const erro = plano.kind === 'falha' || plano.kind === 'ilegivel' ? `: ${plano.erro}` : ''
    corpo = (
      <p className="text-xs text-foreground/75">{`sem leitura dos despachos do #${card}${erro}`}</p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">{rotuloDoCard(card, titulo)}</h3>
      {corpo}
    </div>
  )
}

export function Briefing({ tela, sala, ir, comando, emVoo }: PropsDaTela): JSX.Element {
  const board = useBoardDaFabrica()
  const [marcadas, setMarcadas] = useState<Set<number>>(() => new Set())
  const [pronto, setPronto] = useState<Record<number, string>>({})
  const [contexto, setContexto] = useState('')
  const [soltando, setSoltando] = useState(false)
  const [resultados, setResultados] = useState<Record<number, Resultado>>({})
  const [planos, setPlanos] = useState<Map<number, Plano>>(() => new Map())
  const geracao = useRef(0)

  const frentes = useMemo(
    () => (board.kind === 'ok' ? frentesDoBriefing(board.board, sala) : []),
    [board, sala],
  )
  const hoje = diaLocal(new Date())

  const emVooDaSala: DespachoNaSala[] = sala?.kind === 'ok' ? sala.emVoo : []
  const cardsEmVoo = [...new Set(emVooDaSala.map((d) => d.card))]
  const mostrados = cardsEmVoo.slice(0, MAXIMO_DE_PLANOS)
  const chaveDosMostrados = mostrados.join(',')
  const lidoEm = sala?.lidoEm

  useEffect(() => {
    const minha = ++geracao.current
    const cards = chaveDosMostrados === '' ? [] : chaveDosMostrados.split(',').map(Number)
    for (const card of cards) {
      void (async (): Promise<void> => {
        let plano: Plano
        try {
          plano = await window.oc.readFabricaCard({ card })
        } catch (e) {
          plano = { kind: 'falha', erro: mensagem(e) }
        }
        if (minha !== geracao.current) return
        setPlanos((antes) => new Map(antes).set(card, plano))
      })()
    }
  }, [chaveDosMostrados, lidoEm])

  const textoDoTeto =
    sala === null
      ? '…'
      : `${sala.recursos.sessoes.teto} ao mesmo tempo · ${LIMITE_DE_DESPACHOS_POR_FRENTE} por frente`

  const lerSala = async (): Promise<DespachoNaSala[] | null> => {
    try {
      const lida = await window.oc.readFabrica()
      if (lida.kind === 'ok') return lida.emVoo
      if (lida.kind === 'sem-estado') return []
      return null
    } catch {
      return null
    }
  }

  const marcadasNaOrdem = frentes.filter((f) => !f.emVoo && marcadas.has(f.card))
  const notaDe = (card: number): string =>
    notaDoBriefing({ dia: hoje, prontoQuando: pronto[card] ?? '', contexto })
  const passaDoLimite = marcadasNaOrdem.filter((f) => notaDe(f.card).length > LIMITE_DA_NOTA)

  const soltar = async (): Promise<void> => {
    const alvo = marcadasNaOrdem
    setSoltando(true)
    setResultados({})
    const feitos: Record<number, Resultado> = {}
    const registrar = (card: number, r: Resultado): void => {
      feitos[card] = r
      setResultados({ ...feitos })
    }
    try {
      let parou = false
      for (const f of alvo) {
        if (parou) {
          registrar(f.card, 'nao-solta')
          continue
        }
        const antes = await lerSala()
        if (antes === null) {
          registrar(f.card, 'sem-leitura')
          parou = true
          continue
        }
        if (antes.some((d) => d.card === f.card)) {
          registrar(f.card, 'ja-em-voo')
          continue
        }
        await comando({ tipo: 'iniciar', card: f.card, nota: notaDe(f.card) })
        const depois = await lerSala()
        if (depois === null) {
          registrar(f.card, 'sem-leitura')
          parou = true
          continue
        }
        const ids = new Set(antes.map((d) => d.id))
        if (depois.some((d) => d.card === f.card && !ids.has(d.id))) {
          registrar(f.card, 'aberta')
          setMarcadas((m) => {
            const proximo = new Set(m)
            proximo.delete(f.card)
            return proximo
          })
        } else {
          registrar(f.card, 'nao-abriu')
          parou = true
        }
      }
    } finally {
      setSoltando(false)
    }
  }

  const desabilitado =
    marcadasNaOrdem.length === 0 || soltando || emVoo || sala === null || passaDoLimite.length > 0

  let despachante: string | null = null
  if (sala !== null) {
    if (sala.pausa !== null) {
      despachante = 'A fábrica está pausada: as frentes soltas ficam pendentes até Retomar.'
    } else if (sala.despachante === 'parado') {
      despachante =
        'O despachante não está rodando: as frentes soltas ficam pendentes até a orquestradora ligar o yarn fabrica rodar.'
    } else if (sala.despachante === 'desconhecido') {
      despachante =
        'Não deu para saber se o despachante está rodando: as frentes soltas ficam pendentes até ele rodar.'
    }
  }

  let lista: JSX.Element
  if (board.kind === 'lendo') {
    lista = <p className="text-sm">Lendo o board…</p>
  } else if (board.kind === 'erro') {
    lista = (
      <p role="alert" data-testid="fabrica-briefing-erro" className="text-sm">
        {`Sem leitura do board do Operations Center: ${board.erro}`}
      </p>
    )
  } else if (frentes.length === 0) {
    lista = (
      <Vazio testid="fabrica-briefing-vazio">
        Nenhum card no 📋 Backlog nem na 📥 Triagem do board: não há frente para soltar hoje.
      </Vazio>
    )
  } else {
    lista = (
      <>
        {frentes.map((f) => (
          <Frente
            key={f.card}
            frente={f}
            teto={textoDoTeto}
            marcada={marcadas.has(f.card)}
            pronto={pronto[f.card] ?? ''}
            resultado={resultados[f.card]}
            onMarcar={(marcar) =>
              setMarcadas((m) => {
                const proximo = new Set(m)
                if (marcar) proximo.add(f.card)
                else proximo.delete(f.card)
                return proximo
              })
            }
            onPronto={(texto) => setPronto((p) => ({ ...p, [f.card]: texto }))}
            onVer={() => ir({ tela: 'card', card: f.card })}
          />
        ))}
      </>
    )
  }

  const titulos = new Map<number, string>(
    board.kind === 'ok' ? board.board.cards.map((c) => [c.number, c.title]) : [],
  )

  let plano: JSX.Element
  if (mostrados.length > 0) {
    const mais = cardsEmVoo.length - mostrados.length
    plano = (
      <>
        {mostrados.map((card) => (
          <PlanoDoCard
            key={card}
            card={card}
            titulo={titulos.get(card) ?? null}
            plano={planos.get(card)}
          />
        ))}
        {mais > 0 && (
          <p className="text-xs text-foreground/75">{`e mais ${mais} em voo na Sala`}</p>
        )}
      </>
    )
  } else if (sala === null) {
    plano = <p className="text-xs">Lendo a fábrica…</p>
  } else if (sala.kind === 'ilegivel') {
    plano = <p className="text-xs">{`Sem leitura do estado da fábrica: ${sala.erro}`}</p>
  } else {
    plano = (
      <Vazio testid="fabrica-briefing-sem-plano">
        Nada em voo: o plano aparece aqui quando uma frente começa.
      </Vazio>
    )
  }

  return (
    <>
      <CabecalhoInterno
        trilha={trilhaDa(tela, new Date())}
        onIr={ir}
        direita={
          <div
            role="group"
            aria-label="Modo do dia"
            className="inline-flex overflow-hidden rounded-base border-2 border-border"
          >
            <button
              type="button"
              data-testid="fabrica-briefing-modo-junto"
              aria-pressed={false}
              disabled
              title="A fábrica só despacha sessões sem janela (claude -p): acompanhar um despacho é abrir a tela Card dele."
              className="min-h-11 border-r-2 border-border bg-secondary-background px-4 text-sm font-bold"
            >
              Eu acompanho
            </button>
            <button
              type="button"
              data-testid="fabrica-briefing-modo-auto"
              aria-pressed={true}
              className={cn('min-h-11 bg-main px-4 text-sm font-bold text-main-foreground')}
            >
              Dia autônomo
            </button>
          </div>
        }
      />
      <div className="flex flex-wrap items-start gap-5">
        <main className="flex min-w-0 flex-[999_1_680px] flex-col gap-4">
          <div>
            <h1 className="font-heading text-[26px]">O que a fábrica toca hoje sem você</h1>
            <p className="max-w-[760px] text-sm leading-5">
              As frentes possíveis hoje são os cards do 📋 Backlog e da 📥 Triagem do board: os que
              o yarn fabrica iniciar sabe começar sozinho. Marque as que entram no dia; o que ficar
              de fora continua no board. O objetivo de cada card é o campo Objetivo do board, que o
              app ainda não lê.
            </p>
          </div>
          {despachante !== null && (
            <p data-testid="fabrica-briefing-despachante" className="text-sm">
              {despachante}
            </p>
          )}
          {lista}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
            <Card className="gap-2 bg-secondary-background p-4">
              <h2 className="font-heading text-base">Não fazer hoje</h2>
              <ul className="list-disc pl-[18px] text-sm leading-[22px]">
                {NAO_FAZER_HOJE.map((regra) => (
                  <li key={regra}>{regra}</li>
                ))}
              </ul>
            </Card>
            <Card className="gap-2 bg-secondary-background p-4">
              <label
                htmlFor="fabrica-briefing-contexto"
                className="font-heading text-base font-bold"
              >
                Contexto do dia
              </label>
              <Textarea
                id="fabrica-briefing-contexto"
                data-testid="fabrica-briefing-contexto"
                rows={4}
                placeholder="O que você sabe hoje e a fábrica não: conversa com o gestor, prazo de secretaria…"
                className="resize-y"
                value={contexto}
                onChange={(e) => setContexto(e.target.value)}
              />
              <p className="text-xs text-foreground/75">
                Vai na nota de cada frente, numa linha só. O Slack fica fora do app.
              </p>
            </Card>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-testid="fabrica-briefing-soltar"
              className="min-h-11 bg-main text-main-foreground"
              disabled={desabilitado}
              onClick={() => {
                void soltar()
              }}
            >
              Soltar o dia
            </Button>
            <span className="text-xs text-foreground/75">
              Roda yarn fabrica iniciar &lt;n&gt; --nota para cada frente marcada, na ordem da tela.
              {passaDoLimite.map(
                (f) => ` A nota do #${f.card} passa de ${LIMITE_DA_NOTA} caracteres.`,
              )}
            </span>
          </div>
        </main>
        <aside className="flex max-w-[420px] flex-[1_1_320px] flex-col gap-4">
          <Card className="gap-3 bg-secondary-background p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-base">Plano devolvido</h2>
              <span className="text-xs text-foreground/75">você não precisa aprovar</span>
            </div>
            {plano}
          </Card>
          <Card className="gap-2 bg-main p-4 text-main-foreground">
            <h2 className="font-heading text-base">Para que serve o plano</h2>
            <p className="text-[13px] leading-[18px]">
              A fábrica não escreve plano: o que aparece acima são os despachos de cada frente,
              lidos do estado.json. O relatório do dia ainda não compara o feito com este briefing.
            </p>
          </Card>
        </aside>
      </div>
    </>
  )
}
