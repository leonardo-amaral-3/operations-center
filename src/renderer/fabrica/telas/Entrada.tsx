import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import type { EntradaNaSala, ItemNaEntrada } from '../../../shared/fabrica'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { cn } from '../../ui/cn'
import { Textarea } from '../../ui/textarea'
import { cardCitado } from '../emVoo'
import { horaCurta } from '../linha'
import { CabecalhoInterno } from '../Moldura'
import { trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'

/** O limite do texto de um item da entrada. O renderer não importa `src/core/`: é o literal da spec. */
const LIMITE = 4000

type Fonte = 'Tudo' | 'Slack' | 'Suporte' | 'Vigia' | 'Você'

const FONTES: { nome: Fonte; slug: string }[] = [
  { nome: 'Tudo', slug: 'tudo' },
  { nome: 'Slack', slug: 'slack' },
  { nome: 'Suporte', slug: 'suporte' },
  { nome: 'Vigia', slug: 'vigia' },
  { nome: 'Você', slug: 'voce' },
]

const NAO_LIDAS: Partial<Record<Fonte, string>> = {
  Slack: 'o Slack',
  Suporte: 'o suporte',
  Vigia: 'o Vigia',
}

const PASSOS = [
  'Você conta aqui o que te reportaram.',
  'O app grava pelo yarn fabrica entrada, na pasta da fábrica.',
  'O yarn fabrica estado mostra à orquestradora o que ainda não foi triado.',
  'Ela faz a triagem com o /gm-triage, que sugere tipo, severidade e rota.',
  'E marca o item com yarn fabrica triar, dizendo no que ele virou.',
]

// Padrão local da tela (§F4.9): o Card tem o seu, e a F3 tem os dela em `item.tsx`.
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

function ItemDaEntrada({ item, ir }: { item: ItemNaEntrada; ir: PropsDaTela['ir'] }): JSX.Element {
  const triado = item.triadoEm !== null
  const resolucao = item.resolucao ?? ''
  const citado = triado ? cardCitado(resolucao) : null
  return (
    <Card
      data-testid="fabrica-entrada-item"
      data-id={item.id}
      data-estado={triado ? 'triado' : 'aberto'}
      className="gap-2.5 bg-secondary-background p-4"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral">Você</Badge>
        <span className="text-xs text-foreground/75">
          {`contado em ${horaCurta(item.criadoEm)} · ${item.id}`}
        </span>
      </div>
      <div className="whitespace-pre-wrap rounded-base border-2 border-dashed border-border bg-main/10 px-3 py-2.5 text-[13px] leading-[18px]">
        {item.texto}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {triado ? (
          <>
            <Badge className="bg-attention text-attention-foreground">triada</Badge>
            <span className="flex-[1_1_300px] text-sm leading-5">
              {`Triada em ${horaCurta(item.triadoEm ?? '')}: ${resolucao}`}
            </span>
            {citado !== null && (
              <Button
                variant="neutral"
                data-testid="fabrica-entrada-ver"
                onClick={() => ir({ tela: 'card', card: citado })}
              >
                {`Ver #${citado}`}
              </Button>
            )}
          </>
        ) : (
          <>
            <Badge className="bg-warning text-warning-foreground">esperando triagem</Badge>
            <span className="flex-[1_1_300px] text-sm leading-5">
              Está na pasta da fábrica. A orquestradora vê no yarn fabrica estado e faz a triagem; o
              app não cria card.
            </span>
          </>
        )}
      </div>
    </Card>
  )
}

export function Entrada({ tela, sala, ir, comando, emVoo }: PropsDaTela): JSX.Element {
  const lidoEm = sala?.lidoEm

  const [entrada, setEntrada] = useState<EntradaNaSala | null>(null)
  const [fonte, setFonte] = useState<Fonte>('Tudo')
  const [texto, setTexto] = useState('')
  const [mandando, setMandando] = useState(false)
  const geracao = useRef(0)
  const atual = useRef<EntradaNaSala | null>(null)

  /**
   * A leitura com número de geração: o efeito e o passo 3 do Mandar pedem por aqui. Uma resposta mais
   * velha que a última pedida não é aplicada à lista; quem pediu recebe a sua resposta de qualquer jeito.
   */
  const ler = useCallback(async (): Promise<EntradaNaSala> => {
    const minha = ++geracao.current
    let lida: EntradaNaSala
    try {
      lida = await window.oc.readFabricaEntrada()
    } catch (e) {
      lida = { kind: 'ilegivel', erro: e instanceof Error ? e.message : String(e) }
    }
    if (minha === geracao.current) {
      atual.current = lida
      setEntrada(lida)
    }
    return lida
  }, [])

  useEffect(() => {
    void ler()
  }, [ler, lidoEm])

  const mandar = async (): Promise<void> => {
    setMandando(true)
    const antes = new Set(atual.current?.kind === 'ok' ? atual.current.itens.map((i) => i.id) : [])
    const enviado = texto
    try {
      await comando({ tipo: 'entrada', texto: enviado })
      const nova = await ler()
      if (
        nova.kind === 'ok' &&
        nova.itens.some((i) => !antes.has(i.id) && i.texto === enviado.trim())
      ) {
        setTexto('')
      }
    } finally {
      setMandando(false)
    }
  }

  const tamanho = texto.trim().length
  const longo = tamanho > LIMITE

  const naoLida = NAO_LIDAS[fonte]
  let lista: JSX.Element
  if (naoLida !== undefined) {
    lista = (
      <Vazio testid="fabrica-entrada-fonte-vazia">
        {`A fábrica não lê ${naoLida} nesta prova: o que chega à entrada é o que você conta.`}
      </Vazio>
    )
  } else if (entrada === null) {
    lista = <p className="text-sm">Lendo a entrada…</p>
  } else if (entrada.kind === 'ilegivel') {
    lista = (
      <p role="alert" data-testid="fabrica-entrada-erro" className="text-sm">
        {`Não deu para ler a entrada: ${entrada.erro}`}
      </p>
    )
  } else if (entrada.itens.length === 0) {
    lista = (
      <Vazio testid="fabrica-entrada-vazia">
        Nada chegou ainda. Conte abaixo o que te reportaram.
      </Vazio>
    )
  } else {
    const mais = entrada.total - entrada.itens.length
    lista = (
      <>
        {entrada.itens.map((item) => (
          <ItemDaEntrada key={item.id} item={item} ir={ir} />
        ))}
        {mais > 0 && (
          <p className="text-xs text-foreground/75">{`e mais ${mais} antigos no entrada.json`}</p>
        )}
      </>
    )
  }

  return (
    <>
      <CabecalhoInterno
        trilha={trilhaDa(tela, new Date())}
        onIr={ir}
        direita={
          <Badge variant="neutral" data-testid="fabrica-entrada-aviso">
            Grava pelo yarn fabrica entrada · o app não cria card
          </Badge>
        }
      />
      <div className="flex flex-wrap items-start gap-5">
        <main className="flex min-w-0 flex-[999_1_680px] flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-heading text-2xl">O que chegou</h1>
            <div role="group" aria-label="Fontes" className="flex flex-wrap gap-2">
              {FONTES.map((f) => {
                const on = f.nome === fonte
                return (
                  <button
                    key={f.slug}
                    type="button"
                    aria-pressed={on}
                    data-testid={`fabrica-entrada-fonte-${f.slug}`}
                    onClick={() => setFonte(f.nome)}
                    className={cn(
                      'min-h-10 rounded-base border-2 border-border px-3.5 text-[13px] font-bold',
                      on ? 'bg-main text-main-foreground' : 'bg-secondary-background',
                    )}
                  >
                    {f.nome}
                  </button>
                )
              })}
            </div>
          </div>
          {lista}
          <Card className="gap-2.5 bg-secondary-background p-4">
            <label htmlFor="fabrica-entrada-novo" className="font-heading text-base font-bold">
              Contar algo que te reportaram
            </label>
            <Textarea
              id="fabrica-entrada-novo"
              data-testid="fabrica-entrada-texto"
              rows={3}
              placeholder="Visão de produto, feedback do gestor, pedido de secretaria…"
              className="resize-y"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            <div>
              <Button
                data-testid="fabrica-entrada-mandar"
                className="min-h-10 bg-main text-main-foreground"
                disabled={tamanho === 0 || longo || emVoo || mandando}
                onClick={() => void mandar()}
              >
                Mandar para a entrada
              </Button>
            </div>
            <p className="text-xs text-foreground/75">
              Grava pelo yarn fabrica entrada, na pasta da fábrica.
              {longo && ` O texto passa de ${LIMITE} caracteres.`}
            </p>
          </Card>
        </main>
        <aside className="flex max-w-[400px] flex-[1_1_300px] flex-col gap-4">
          <Card className="gap-3 bg-secondary-background p-4">
            <h2 className="font-heading text-base">Como a entrada trabalha</h2>
            {PASSOS.map((passo, i) => (
              <div key={i} className="flex gap-2.5 text-[13px] leading-[18px]">
                <span className="flex size-6 flex-none items-center justify-center rounded-full border-2 border-border bg-secondary-background text-xs font-bold">
                  {i + 1}
                </span>
                <span>{passo}</span>
              </div>
            ))}
          </Card>
          <Card className="gap-2 bg-main p-4 text-main-foreground">
            <h2 className="font-heading text-base">O que ela não faz</h2>
            <p className="text-[13px] leading-[18px]">
              Não cria card nem escreve no board: o app só lê o board. Não lê Slack, suporte nem
              Vigia nesta prova.
            </p>
          </Card>
        </aside>
      </div>
    </>
  )
}
