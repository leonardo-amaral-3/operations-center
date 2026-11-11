import { useState } from 'react'
import type { JSX, ReactNode } from 'react'

import type { ComandoDaFabrica, PerguntaDaFila, SalaDaFabrica } from '../../../shared/fabrica'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { Textarea } from '../../ui/textarea'
import { CabecalhoInterno, LinkDoCard, quando } from '../Moldura'
import { rotaDoItem, trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'
import { ChipDaPosicao, Etiqueta, ItemFechado, TextoFinal, useItemDaFila } from './item'

/**
 * A tela Pergunta (#132, F3.5): o item da fila pelo `tela.item`, na disposição do protótipo, com o
 * botão que fecha o item pelo `yarn fabrica fechar`. As opções do protótipo não existem aqui: a
 * sessão não deixa opção estruturada, e a seção diz isso em vez de inventar (F3.6).
 */
export function Pergunta({ tela, sala, ir, comando, emVoo }: PropsDaTela): JSX.Element {
  const { id, pergunta } = useItemDaFila(tela, sala)

  return (
    <>
      <CabecalhoInterno
        trilha={trilhaDa(tela, new Date())}
        onIr={ir}
        direita={
          <div className="flex flex-wrap gap-2">
            {pergunta ? (
              <Badge
                data-testid="fabrica-chip-tipo"
                className="bg-question text-question-foreground"
              >
                Pergunta · trava o #{pergunta.item.card}
              </Badge>
            ) : null}
            <ChipDaPosicao id={id} sala={sala} />
          </div>
        }
      />
      <Corpo id={id} pergunta={pergunta} sala={sala} ir={ir} comando={comando} emVoo={emVoo} />
    </>
  )
}

function Corpo({
  id,
  pergunta,
  sala,
  ir,
  comando,
  emVoo,
}: {
  id: string | null
  pergunta: PerguntaDaFila | null | undefined
  sala: SalaDaFabrica | null
  ir: PropsDaTela['ir']
  comando: PropsDaTela['comando']
  emVoo: boolean
}): JSX.Element | null {
  // `undefined` = a resposta do item atual ainda não chegou.
  if (pergunta === undefined || id === null) return null

  if (pergunta === null) {
    return (
      <p data-testid="fabrica-item-sumiu" className="text-sm">
        O item saiu do estado da fábrica.
      </p>
    )
  }

  const { item } = pergunta
  // O despacho de origem pelo passo da frente; a Decisão usa a mesma linha.
  const skillDaOrigem =
    pergunta.passos.find((p) => p.despacho === item.despacho)?.skill ?? 'sem despacho'

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[999_1_660px] flex-col gap-5">
        <Card data-testid="fabrica-pergunta" className="gap-3 bg-secondary-background p-5">
          <div className="flex flex-wrap gap-1.5">
            <Etiqueta>
              <LinkDoCard card={item.card} url={item.cardUrl} />
            </Etiqueta>
            <Etiqueta>{skillDaOrigem}</Etiqueta>
            <Etiqueta>{item.despacho}</Etiqueta>
          </div>
          <h1 className="font-heading text-[26px] leading-8">{item.motivo}</h1>
          <TextoFinal resultado={pergunta.resultado} testid="fabrica-pergunta-sem-texto" />
        </Card>

        <Card
          data-testid="fabrica-pergunta-origem"
          className="flex-row flex-wrap items-center gap-5 bg-main/10 p-5"
        >
          <div className="flex flex-[1_1_260px] flex-col gap-2">
            <h2 className="font-heading text-base">De onde veio</h2>
            <p className="text-sm">
              O despachante pôs este item na fila quando a sessão do despacho terminou sem seguir
              sozinha.
            </p>
          </div>
          <div className="flex flex-[1_1_320px] flex-col gap-2">
            <LinhaDeRegistro rotulo="despacho">
              {item.despacho} · {item.comando ?? 'fora do estado'}
            </LinhaDeRegistro>
            <LinhaDeRegistro rotulo="sessão">
              {item.sessaoClaude ?? 'sem sessão registrada'}
            </LinhaDeRegistro>
            <LinhaDeRegistro rotulo="parou">{quando(item.criadoEm)}</LinhaDeRegistro>
          </div>
        </Card>

        <section aria-label="Opções" className="flex flex-col gap-3">
          <h2 className="font-heading text-lg">O que a fábrica faz com cada resposta</h2>
          <div
            data-testid="fabrica-sem-opcoes"
            className="rounded-base border-2 border-dashed border-border bg-secondary-background/45 p-3 text-xs text-foreground/75"
          >
            Esta sessão não deixou opções estruturadas, e a fábrica não inventa opções. Qualquer
            resposta fecha o item com ela como resolução.
          </div>
        </section>

        <Card data-testid="fabrica-resposta-caixa" className="gap-3 bg-secondary-background p-4">
          {item.fechadoEm === null ? (
            // `key={id}`: a resposta digitada num item não passa para o seguinte.
            <CaixaDaResposta key={id} id={id} comando={comando} emVoo={emVoo} />
          ) : (
            <ItemFechado item={item} />
          )}
        </Card>
      </div>

      <aside className="flex max-w-[400px] flex-[1_1_300px] flex-col gap-4">
        <OutrasNaFila id={id} sala={sala} ir={ir} />
        <Card data-testid="fabrica-por-que" className="gap-2 bg-main p-4 text-main-foreground">
          <h2 className="font-heading text-base">Por que chegou a você</h2>
          <p className="text-[13px] leading-[18px]">{porQueChegou(pergunta)}</p>
        </Card>
      </aside>
    </div>
  )
}

/** Uma linha de registro do protótipo (`.rc`): a etiqueta e o valor em fonte monoespaçada. */
function LinhaDeRegistro({
  rotulo,
  children,
}: {
  rotulo: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-[4px] border-2 border-border bg-secondary-background px-2.5 py-1.5 font-mono text-[13px]">
      <Etiqueta>{rotulo}</Etiqueta>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

/** A frase de "Por que chegou a você", pelo desfecho do despacho de origem (F3.5). */
function porQueChegou(pergunta: PerguntaDaFila): string {
  const { item, fim } = pergunta
  const comando = item.comando ?? item.despacho

  if (fim === 'parada' && item.comando?.startsWith('/g4 ')) {
    return `O G4 da ${comando} terminou sem aprovar a PR para o merge (${item.motivo}), e o despachante encerrou a frente do #${item.card}.`
  }

  if (fim === 'parada') {
    return `A sessão do ${comando} terminou com PARADA em vez de decidir sozinha, e o despachante encerrou a frente do #${item.card}.`
  }

  if (fim === 'falha') {
    return `A sessão do ${comando} terminou sem um fim que a fábrica entenda (${item.motivo}). O despachante não relança sozinho.`
  }

  if (fim === 'proximo') {
    return `A sessão do ${comando} pediu um próximo passo que a fábrica não aceita (${item.motivo}), e a frente parou aqui.`
  }

  return `O despacho de origem (${item.despacho}) não está no estado da fábrica.`
}

/** A caixa de resposta aberta: o texto vira a resolução do `fechar`, aparado. */
function CaixaDaResposta({
  id,
  comando,
  emVoo,
}: {
  id: string
  comando: (c: ComandoDaFabrica) => Promise<void>
  emVoo: boolean
}): JSX.Element {
  const [resposta, setResposta] = useState('')

  return (
    <>
      <label htmlFor="fabrica-resposta" className="text-sm font-bold">
        Responda com as suas palavras
      </label>
      <Textarea
        id="fabrica-resposta"
        data-testid="fabrica-resposta"
        rows={3}
        placeholder="A sua resposta vira a resolução do item."
        value={resposta}
        onChange={(evento) => {
          setResposta(evento.target.value)
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          data-testid="fabrica-responder-fechar"
          className="min-h-11 bg-question text-question-foreground"
          disabled={resposta.trim() === '' || emVoo}
          onClick={() => {
            void comando({ tipo: 'fechar', item: id, resolucao: resposta.trim() })
          }}
        >
          Responder e fechar o item
        </Button>
        <span className="text-[13px] text-foreground/75">
          A resposta fecha o item pelo yarn fabrica fechar, com ela como resolução. Ela não vai para
          o cofre nem para o card, e nenhuma sessão retoma sozinha.
        </span>
      </div>
    </>
  )
}

/** "Outras decisões suas na fila": os outros itens abertos, do mais antigo ao mais novo. */
function OutrasNaFila({
  id,
  sala,
  ir,
}: {
  id: string
  sala: SalaDaFabrica | null
  ir: PropsDaTela['ir']
}): JSX.Element {
  const outros = sala?.kind === 'ok' ? sala.abertos.filter((aberto) => aberto.id !== id) : []

  return (
    <Card className="gap-2.5 bg-secondary-background p-4">
      <h2 className="font-heading text-base">Outras decisões suas na fila</h2>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className="border-b-2 border-border py-1.5 text-left">
              Decisão
            </th>
            <th scope="col" className="border-b-2 border-border py-1.5 text-right">
              Card
            </th>
          </tr>
        </thead>
        <tbody>
          {outros.map((outro, i) => {
            const borda = i < outros.length - 1 ? 'border-b border-border' : ''

            return (
              <tr key={outro.id}>
                <td className={`py-1.5 ${borda}`}>
                  <button
                    type="button"
                    data-testid="fabrica-outra"
                    className="text-left"
                    onClick={() => {
                      ir(rotaDoItem(outro))
                    }}
                  >
                    {outro.motivo}
                  </button>
                </td>
                <td className={`py-1.5 text-right font-bold ${borda}`}>#{outro.card}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {outros.length === 0 ? (
        <p data-testid="fabrica-outras-vazio" className="text-xs">
          Nenhum outro item aberto.
        </p>
      ) : null}
      <p className="text-xs text-foreground/75">
        Cada linha é um item aberto da fila, do mais antigo ao mais novo.
      </p>
    </Card>
  )
}
