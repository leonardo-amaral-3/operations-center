import { useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import type { ReadCardResult } from '../../../shared/ipc'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { CabecalhoInterno, LinkDoCard } from '../Moldura'
import { trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'
import {
  URL_DA_DEV_PARA_MAIN,
  URL_DO_BOARD_DA_FABRICA,
  cardsDoTrem,
  linhasDaVerificacao,
  linhasDasNotas,
  repoDoTrem,
  textoDasNotas,
  tipoDoCard,
} from '../trem'
import { useBoardDaFabrica } from '../useBoardDaFabrica'

type Copia = 'nada' | 'copiadas' | { erro: string }

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

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** O trem da 🚂 Release do board e o rascunho do que o /gm-release vai conferir. Nada aqui escreve. */
export function Release({ tela, ir }: PropsDaTela): JSX.Element {
  const board = useBoardDaFabrica()
  const trem = useMemo(() => (board.kind === 'ok' ? cardsDoTrem(board.board) : []), [board])
  const [leituras, setLeituras] = useState<Map<string, ReadCardResult>>(new Map())
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [copia, setCopia] = useState<Copia>('nada')

  const chaveDoTrem = trem.map((c) => c.itemId).join(',')

  // Lê a spec de cada card do trem, um de cada vez, ao abrir e quando o trem muda.
  useEffect(() => {
    let vivo = true
    const ids = chaveDoTrem === '' ? [] : chaveDoTrem.split(',')
    setLeituras(new Map())
    const ler = async (): Promise<void> => {
      for (const itemId of ids) {
        let resposta: ReadCardResult
        try {
          resposta = await window.oc.readCard({ itemId })
        } catch (e) {
          resposta = { ok: false, reason: mensagem(e) }
        }
        if (!vivo) return
        setLeituras((antes) => new Map(antes).set(itemId, resposta))
      }
    }
    void ler()
    return () => {
      vivo = false
    }
  }, [chaveDoTrem])

  const copiar = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(textoDasNotas(trem))
      setCopia('copiadas')
    } catch (e) {
      setCopia({ erro: mensagem(e) })
    }
  }

  const alternar = (chave: string): void =>
    setMarcadas((m) => {
      const proximo = new Set(m)
      if (proximo.has(chave)) proximo.delete(chave)
      else proximo.add(chave)
      return proximo
    })

  const vazioDoTrem = board.kind === 'ok' && trem.length === 0

  let doTrem: JSX.Element
  if (board.kind === 'lendo') {
    doTrem = <p className="text-sm">Lendo o board…</p>
  } else if (board.kind === 'erro') {
    doTrem = (
      <p role="alert" data-testid="fabrica-release-erro" className="text-sm">
        {`Sem leitura do board do Operations Center: ${board.erro}`}
      </p>
    )
  } else if (vazioDoTrem) {
    doTrem = <Vazio testid="fabrica-release-vazio">Nenhum card na 🚂 Release do board.</Vazio>
  } else {
    doTrem = (
      <>
        {trem.map((c) => {
          const tipo = tipoDoCard(c)
          return (
            <Card
              key={c.itemId}
              data-testid="fabrica-release-card"
              data-card={c.number}
              className="flex-row flex-wrap items-center gap-3 bg-secondary-background px-4 py-3.5"
            >
              {tipo !== null && <Badge className={tipo.classe}>{tipo.rotulo}</Badge>}
              <span className="flex-[1_1_280px] font-bold">
                <LinkDoCard card={c.number} url={c.url} /> {c.title}
              </span>
              <Badge className="bg-attention text-attention-foreground">
                na 🚂 Release do board
              </Badge>
            </Card>
          )
        })}
      </>
    )
  }

  let notas: JSX.Element[]
  if (board.kind === 'lendo') notas = [<div key="n">Lendo o board…</div>]
  else if (board.kind === 'erro') notas = [<div key="n">Sem leitura do board: sem notas.</div>]
  else if (trem.length === 0) notas = [<div key="n">Nada no trem: sem notas.</div>]
  else notas = linhasDasNotas(trem).map((linha, i) => <div key={i}>{linha}</div>)

  let verificacao: JSX.Element
  if (board.kind === 'lendo') {
    verificacao = <p className="text-sm">Lendo o board…</p>
  } else if (board.kind === 'erro') {
    verificacao = <p className="text-sm">Sem leitura do board, sem verificação.</p>
  } else if (vazioDoTrem) {
    verificacao = (
      <Vazio testid="fabrica-release-sem-verificacao">Sem card no trem, sem verificação.</Vazio>
    )
  } else {
    verificacao = (
      <>
        {trem.flatMap((c) =>
          linhasDaVerificacao(c, leituras.get(c.itemId)).map((l) =>
            l.marcavel ? (
              <label
                key={l.chave}
                data-testid="fabrica-release-check"
                className="flex items-start gap-2.5 text-sm leading-5"
                title={l.completo}
              >
                <input
                  type="checkbox"
                  className="size-5 flex-none accent-foreground"
                  checked={marcadas.has(l.chave)}
                  onChange={() => alternar(l.chave)}
                />
                <span>{l.texto}</span>
              </label>
            ) : (
              <p
                key={l.chave}
                data-testid="fabrica-release-sem-check"
                className="text-sm leading-5 text-foreground/75"
                title={l.completo}
              >
                {l.texto}
              </p>
            ),
          ),
        )}
        <p className="text-[13px] leading-[18px]">
          Nenhum agente roda estas consultas: quem confere é você. Marcar aqui não grava em lugar
          nenhum.
        </p>
      </>
    )
  }

  return (
    <>
      <CabecalhoInterno
        trilha={trilhaDa(tela, new Date())}
        onIr={ir}
        direita={<Badge className="bg-danger text-danger-foreground">G5 · nível C · só você</Badge>}
      />
      <Card className="flex-row flex-wrap items-center justify-between gap-4 bg-secondary-background p-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-foreground/75">
            {`TREM DA 🚂 RELEASE · ${repoDoTrem(trem)} · dev → main`}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-[26px]">Release</h1>
            <Badge variant="neutral">versão: quem escolhe é o /gm-release</Badge>
          </div>
          <p className="max-w-[720px] text-sm leading-5">
            O trem é a coluna 🚂 Release do board. O app junta os cards dela e escreve o rascunho
            das notas e o checklist a partir de cada card; o merge na main, a tag e a verificação de
            produção são seus, pelo /gm-release. O app não escreve no GitHub.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button
            asChild
            variant="neutral"
            className="min-h-11"
            data-testid="fabrica-release-board"
          >
            <a href={URL_DO_BOARD_DA_FABRICA} target="_blank" rel="noreferrer">
              Abrir o board no GitHub
            </a>
          </Button>
          <Button
            asChild
            className="min-h-11 bg-danger text-danger-foreground"
            data-testid="fabrica-release-dev-main"
          >
            <a href={URL_DA_DEV_PARA_MAIN} target="_blank" rel="noreferrer">
              Ver dev → main no GitHub
            </a>
          </Button>
        </div>
      </Card>
      <div className="flex flex-wrap items-start gap-5">
        <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
          <h2 className="font-heading text-lg">No trem</h2>
          {doTrem}
          <Card className="gap-2.5 bg-secondary-background p-4">
            <h2 className="font-heading text-base">Notas da release, rascunho da fábrica</h2>
            <div
              data-testid="fabrica-release-notas"
              className="rounded-base border-2 border-dashed border-border bg-main/10 px-3.5 py-3 text-sm leading-[21px]"
            >
              <b>O que muda para você</b>
              {notas}
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="neutral"
                data-testid="fabrica-release-copiar"
                disabled={trem.length === 0}
                onClick={() => {
                  void copiar()
                }}
              >
                Copiar notas
              </Button>
              {copia !== 'nada' && (
                <span data-testid="fabrica-release-copia" className="text-xs">
                  {copia === 'copiadas'
                    ? 'Notas copiadas: cole onde quiser; o texto final é do /gm-release.'
                    : `Não deu para copiar: ${copia.erro}`}
                </span>
              )}
            </div>
          </Card>
        </main>
        <aside className="flex min-w-0 max-w-[440px] flex-[1_1_320px] flex-col gap-4">
          <Card className="gap-3 bg-secondary-background p-4">
            <h2 className="font-heading text-base">Verificação pós-deploy</h2>
            <p className="text-xs text-foreground/75">
              Bloqueante: o card não vai para Produção sem ela. Cada item vem da seção Verificação
              pós-deploy do comentário gm:spec do card.
            </p>
            {verificacao}
          </Card>
          <Card className="gap-2 bg-main p-4 text-main-foreground">
            <h2 className="font-heading text-base">Depois da produção</h2>
            <p className="text-[13px] leading-[18px]">
              A fábrica não tem agente de operação nesta prova: nada observa os cards depois da
              produção. Sinal estranho chega pela Entrada, contado por você.
            </p>
          </Card>
        </aside>
      </div>
    </>
  )
}
