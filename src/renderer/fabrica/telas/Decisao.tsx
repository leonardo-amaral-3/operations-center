import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import type { PassoDaFrente, PerguntaDaFila } from '../../../shared/fabrica'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { Input } from '../../ui/input'
import { CabecalhoInterno, LinkDoCard, quando } from '../Moldura'
import { trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'
import { ChipDaPosicao, Etiqueta, ItemFechado, TextoFinal, useItemDaFila } from './item'

/**
 * A tela Decisão (#132, §F3.5): o item da fila que é o parecer do G4 sem bloqueante de uma PR aberta
 * pelo `/gm-ship`, esperando a aprovação de quem lê. As três ações (aprovar, devolver) rodam só `fechar`, com a resolução
 * `aprovado`, `aprovado: <nota>` ou `devolvido: <nota>`; o app não faz merge nem mexe no board.
 */
export function Decisao({ tela, sala, ir, comando, emVoo, board }: PropsDaTela): JSX.Element {
  const { id, pergunta } = useItemDaFila(tela, sala, board.chave)

  return (
    <>
      <CabecalhoInterno
        trilha={trilhaDa(tela, new Date())}
        onIr={ir}
        atual={tela.tela}
        padrao={board.padrao}
        direita={
          <div className="flex flex-wrap gap-2">
            <Badge data-testid="fabrica-chip-tipo" className="bg-warning text-warning-foreground">
              Você aprova
            </Badge>
            <ChipDaPosicao id={id} sala={sala} />
          </div>
        }
      />
      {pergunta === null ? (
        <p data-testid="fabrica-item-sumiu" className="text-sm">
          O item saiu do estado da fábrica.
        </p>
      ) : pergunta === undefined || id === null ? null : (
        <Corpo
          key={id}
          pergunta={pergunta}
          emVoo={emVoo}
          onFechar={(resolucao) => {
            void comando({ tipo: 'fechar', item: id, resolucao })
          }}
        />
      )}
    </>
  )
}

function Corpo({
  pergunta,
  emVoo,
  onFechar,
}: {
  pergunta: PerguntaDaFila
  emVoo: boolean
  onFechar: (resolucao: string) => void
}): JSX.Element {
  const { item, pr, prUrl, passos } = pergunta
  // A nota é do item aberto: o `key` do pai a zera ao trocar de `id`; este efeito a zera ao fechar.
  const [nota, setNota] = useState('')
  const aberto = item.fechadoEm === null
  const limpa = nota.trim()
  const skillDaOrigem = passos.find((p) => p.despacho === item.despacho)?.skill ?? 'sem despacho'

  useEffect(() => {
    if (!aberto) setNota('')
  }, [aberto])

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-5">
        <Card data-testid="fabrica-decisao" className="gap-2.5 bg-secondary-background p-5">
          <div className="flex flex-wrap gap-1.5">
            <Etiqueta>
              <LinkDoCard card={item.card} url={item.cardUrl} />
            </Etiqueta>
            {pr !== null && prUrl !== null && (
              <Etiqueta>
                <a href={prUrl} target="_blank" rel="noreferrer" className="underline">
                  {`PR #${pr}`}
                </a>
              </Etiqueta>
            )}
            <Etiqueta>{skillDaOrigem}</Etiqueta>
          </div>
          <h1 className="font-heading text-[26px] leading-8">{item.motivo}</h1>
          <TextoFinal resultado={pergunta.resultado} testid="fabrica-decisao-sem-texto" />
        </Card>

        <section aria-label="Conferido pelo agente" className="flex flex-col gap-3">
          <h2 className="font-heading text-lg">Conferido pelo agente</h2>
          <Vazio testid="fabrica-sem-evidencia">
            A fábrica não anexa evidência. O que a sessão diz ter conferido está no texto final
            dela, acima, e cada passo da frente está em «Como chegou aqui».
          </Vazio>
        </section>

        <section aria-label="Precisa do seu olho" className="flex flex-col gap-3">
          <h2 className="font-heading text-lg">Precisa do seu olho</h2>
          {pr !== null && prUrl !== null ? (
            <Card
              data-testid="fabrica-olho"
              className="flex-row flex-wrap items-center gap-3 bg-warning/25 px-4 py-3.5"
            >
              <Badge className="bg-warning text-warning-foreground">sem conferência</Badge>
              <div className="flex-[1_1_320px] text-sm leading-5">
                <b>A PR #{pr}.</b> A fábrica não faz merge nem confere a PR por você: quem aprova
                olha a PR.
              </div>
              <Button asChild variant="neutral" className="min-h-10">
                <a href={prUrl} target="_blank" rel="noreferrer" data-testid="fabrica-abrir-pr">
                  Abrir a PR
                </a>
              </Button>
            </Card>
          ) : (
            <Vazio>O motivo não cita uma PR.</Vazio>
          )}
        </section>

        <Card
          aria-label="Decisão"
          data-testid="fabrica-decidir"
          className="flex-row flex-wrap items-center gap-3 bg-secondary-background p-4"
        >
          {aberto ? (
            <>
              <Button
                data-testid="fabrica-aprovar"
                className="min-h-11 bg-attention text-attention-foreground"
                disabled={emVoo}
                onClick={() => onFechar(limpa === '' ? 'aprovado' : `aprovado: ${limpa}`)}
              >
                Aprovar e fechar o item
              </Button>
              <Button
                data-testid="fabrica-devolver"
                variant="neutral"
                className="min-h-11"
                disabled={emVoo || limpa === ''}
                onClick={() => onFechar(`devolvido: ${limpa}`)}
              >
                Devolver com correção
              </Button>
              <label htmlFor="fabrica-nota" className="sr-only">
                Nota para a fábrica
              </label>
              <Input
                id="fabrica-nota"
                data-testid="fabrica-nota"
                className="min-h-11 flex-[1_1_260px]"
                placeholder="Nota para a fábrica (opcional para aprovar, obrigatória para devolver)"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
            </>
          ) : (
            <ItemFechado item={item} />
          )}
        </Card>
      </div>

      <aside className="flex max-w-[380px] flex-[1_1_300px] flex-col gap-4">
        <Card data-testid="fabrica-se-aprovar" className="gap-2.5 bg-main p-4 text-main-foreground">
          <h2 className="font-heading text-base">Se você aprovar</h2>
          <Passo n={1}>
            O item sai da fila com a resolução «aprovado», e a sua nota junto, se houver.
          </Passo>
          <Passo n={2}>
            {`O merge da PR${pr === null ? '' : ` #${pr}`} na dev continua da orquestradora: o app não faz merge nem mexe no board.`}
          </Passo>
          <Passo n={3}>A validação em dev, o merge na main e a produção continuam seus (G5).</Passo>
        </Card>

        <Card className="gap-3 bg-secondary-background p-4">
          <h2 className="font-heading text-base">Como chegou aqui</h2>
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-[13px] leading-[18px]">
            {passos.map((passo) => (
              <li key={passo.despacho} data-testid="fabrica-passo" className="flex gap-2">
                <Etiqueta className="shrink-0">{passo.skill}</Etiqueta>
                <span>
                  {textoDoPasso(passo)}
                  {passo.em !== null && ` (${quando(passo.em)})`}
                </span>
              </li>
            ))}
            <li data-testid="fabrica-passo-fila" className="flex gap-2">
              <Etiqueta className="shrink-0 bg-warning text-warning-foreground">fila</Etiqueta>
              <span>
                {item.fechadoEm === null
                  ? `Na sua fila desde ${quando(item.criadoEm)}`
                  : `Fechado em ${quando(item.fechadoEm)}`}
              </span>
            </li>
          </ol>
        </Card>

        <Card className="gap-2 bg-secondary-background p-4 text-[13px]">
          <h2 className="font-heading text-base">Linhagem</h2>
          <a href={item.cardUrl} target="_blank" rel="noreferrer" className="underline">
            Card #{item.card}
          </a>
          {pr !== null && prUrl !== null && (
            <a href={prUrl} target="_blank" rel="noreferrer" className="underline">
              PR #{pr}
            </a>
          )}
          <span>Decisões do card: no cofre, fora do app.</span>
        </Card>
      </aside>
    </div>
  )
}

/** O texto de um passo da frente pelo desfecho do despacho. */
function textoDoPasso(passo: PassoDaFrente): string {
  switch (passo.fim) {
    case 'proximo':
      return `seguiu para ${passo.detalhe ?? '-'}`
    case 'parada':
      return `PARADA: ${passo.detalhe ?? '-'}`
    case 'falha':
      return `falha: ${passo.detalhe ?? '-'}`
    default:
      return 'sem fim registrado'
  }
}

function Passo({ n, children }: { n: number; children: string }): JSX.Element {
  return (
    <div className="flex gap-2.5 text-[13px] leading-[18px]">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-border bg-secondary-background text-xs font-bold text-foreground">
        {n}
      </span>
      <span>{children}</span>
    </div>
  )
}

/** O aviso tracejado do protótipo (`.empty`). */
function Vazio({ children, testid }: { children: string; testid?: string }): JSX.Element {
  return (
    <div
      data-testid={testid}
      className="rounded-base border-2 border-dashed border-border bg-secondary-background/45 p-3 text-xs text-foreground/75"
    >
      {children}
    </div>
  )
}
