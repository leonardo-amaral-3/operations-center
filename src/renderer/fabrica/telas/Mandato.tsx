import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import type { MandatoNaSala, PortaoDoMandato } from '../../../shared/fabrica'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { cn } from '../../ui/cn'
import { URL_DO_MANDATO_DA_FABRICA } from '../boardDaFabrica'
import { CabecalhoInterno } from '../Moldura'
import { trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'

/**
 * Cópia local das nove linhas de `PORTOES` (`src/core/fabrica/portoes.ts`): no `erro` e enquanto lê,
 * o main não devolveu nenhum `PortaoDoMandato`, e a tela ainda mostra a tabela. Mudou lá, muda aqui.
 */
const PORTOES_DA_TELA: ReadonlyArray<Pick<PortaoDoMandato, 'id' | 'nome' | 'nota'>> = [
  { id: 'entrada', nome: 'Entrada', nota: 'o que você conta na tela Entrada' },
  { id: 'g1', nome: 'G1 · card', nota: 'promover para Backlog' },
  { id: 'g2', nome: 'G2 · spec', nota: 'depois do revisor independente' },
  { id: 'g3', nome: 'G3 · tasks', nota: 'fatiar em tasks' },
  { id: 'impl', nome: 'Implementação e integração', nota: 'commits e PR' },
  { id: 'g4', nome: 'G4 · merge na dev', nota: 'CI verde e revisão tratada' },
  { id: 'val', nome: 'Validação em dev', nota: 'roteiro da spec, evidência na PR' },
  { id: 'g5', nome: 'G5 · release e produção', nota: 'merge na main e verificação pós-deploy' },
  { id: 'op', nome: 'Operação', nota: 'abrir bug com o sinal anexado' },
]

/** Cópia local de `REGRA_DAS_PARADAS` (`src/core/fabrica/portoes.ts`), que vale mesmo sem leitura. */
const REGRA_DAS_PARADAS = 'O despacho de um card pode acrescentar paradas, nunca tirar.'

const COLUNAS = [
  'Portão',
  'Rota Curta',
  'Rota Completa',
  'Toca dado, faturamento, deploy ou migration',
] as const

/**
 * A linha de base do placar: claude-brain#28 (559 sessões, 25/09 a 12/10/2026). Três números
 * contados lá; o quarto a fábrica ainda não mede.
 */
const BASE_DO_PLACAR = 'linha de base: 559 sessões, 25/09 a 12/10 (claude-brain#28)'
const PLACAR: ReadonlyArray<{ numero: string; legenda: string }> = [
  { numero: '~10', legenda: 'cards com emenda por premissa não medida' },
  { numero: '~10', legenda: 'paradas por disco cheio ou Docker caído' },
  { numero: '3', legenda: 'vezes a dev vermelha depois de merge verde' },
]

type Leitura = MandatoNaSala | null

function Celula({
  portao,
  nome,
  coluna,
}: {
  portao: PortaoDoMandato | undefined
  nome: string
  coluna: string
}): JSX.Element {
  if (portao === undefined) {
    return (
      <td data-testid="fabrica-celula" className="border-t-2 border-border p-3">
        <Badge data-quem="sem-leitura" className="bg-secondary-background">
          sem leitura
        </Badge>
      </td>
    )
  }

  let corpo: JSX.Element

  if (portao.travado) {
    corpo = (
      <Badge
        data-quem="travado"
        className="bg-danger"
        title={portao.fonte ?? 'release e produção são sempre seus'}
      >
        C · travado
      </Badge>
    )
  } else if (portao.quem !== null) {
    const quem = portao.quem

    corpo = (
      <div
        role="group"
        aria-label={`${nome}, ${coluna}`}
        data-quem={quem}
        title={portao.fonte ?? undefined}
        className="inline-flex overflow-hidden rounded-base border-2 border-border"
      >
        {(['A', 'B', 'C'] as const).map((letra) => (
          <span
            key={letra}
            data-on={letra === quem ? 'true' : 'false'}
            className={cn(
              'flex h-9 w-11 items-center justify-center border-r-2 border-border font-bold last:border-r-0',
              letra === quem ? 'bg-main' : 'bg-secondary-background',
            )}
          >
            {letra}
          </span>
        ))}
      </div>
    )
  } else {
    corpo = (
      <Badge
        data-quem="nao-diz"
        className="border-dashed bg-secondary-background"
        title="o mandato não entrega este portão: a sessão para e espera você"
      >
        não diz
      </Badge>
    )
  }

  return (
    <td data-testid="fabrica-celula" className="border-t-2 border-border p-3">
      {corpo}
    </td>
  )
}

function Tabela({ leitura }: { leitura: Leitura }): JSX.Element {
  const lidos = leitura?.kind === 'ok' ? leitura.portoes : null

  return (
    <Card className="overflow-x-auto bg-secondary-background p-0">
      <table data-testid="fabrica-portoes" className="w-full min-w-[680px] border-collapse text-sm">
        <thead className="bg-main font-heading">
          <tr>
            {COLUNAS.map((c) => (
              <th key={c} scope="col" className="p-3 text-left">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PORTOES_DA_TELA.map((base) => {
            const portao = lidos?.find((p) => p.id === base.id)
            const nome = portao?.nome ?? base.nome
            const nota = portao?.nota ?? base.nota

            return (
              <tr key={base.id} data-testid="fabrica-portao" data-portao={base.id}>
                <td className="border-t-2 border-border p-3 font-bold">
                  {nome}
                  <div className="text-xs font-normal text-foreground/75">{nota}</div>
                </td>
                {COLUNAS.slice(1).map((coluna) => (
                  <Celula key={coluna} portao={portao} nome={nome} coluna={coluna} />
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

export function Mandato({ tela, ir }: PropsDaTela): JSX.Element {
  const [leitura, setLeitura] = useState<Leitura>(null)

  useEffect(() => {
    let vivo = true

    void Promise.resolve()
      .then(() => window.oc.readFabricaMandato({ board: null }))
      .then(
        (r) => r,
        (err: unknown): MandatoNaSala => ({
          kind: 'erro',
          erro: err instanceof Error ? err.message : String(err),
        }),
      )
      .then((r) => {
        if (vivo) setLeitura(r)
      })

    return () => {
      vivo = false
    }
  }, [])

  const regras = leitura?.kind === 'ok' ? leitura.regras : [REGRA_DAS_PARADAS]

  const direita = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="neutral" data-testid="fabrica-mandato-origem">
        fabrica/MANDATO.md da dev · só leitura
      </Badge>
      <Button asChild size="sm" className="bg-attention text-attention-foreground">
        <a
          data-testid="fabrica-mandato-github"
          href={URL_DO_MANDATO_DA_FABRICA}
          target="_blank"
          rel="noreferrer"
        >
          Abrir no GitHub
        </a>
      </Button>
    </div>
  )

  return (
    <>
      <CabecalhoInterno
        trilha={trilhaDa(tela, new Date())}
        direita={direita}
        onIr={ir}
        atual={tela.tela}
      />
      <div className="flex flex-wrap items-start gap-5">
        <main className="flex min-w-0 flex-[999_1_680px] flex-col gap-3">
          <h1 className="font-heading text-2xl">Quem decide cada portão</h1>
          <p className="max-w-[720px] text-sm">
            <b>A</b> a fábrica decide e registra no card e no cofre · <b>B</b> a fábrica prepara e
            você aprova com um clique · <b>C</b> só você. Lido do fabrica/MANDATO.md da dev, que não
            separa rota nem dado: as três colunas repetem o que ele diz.
          </p>
          {leitura === null && <p data-testid="fabrica-mandato-lendo">Lendo o mandato da dev…</p>}
          {leitura?.kind === 'erro' && (
            <p role="alert" data-testid="fabrica-mandato-erro">
              Não deu para ler o fabrica/MANDATO.md da dev: {leitura.erro}
            </p>
          )}
          <Tabela leitura={leitura} />
        </main>
        <aside className="flex max-w-[420px] flex-[1_1_320px] flex-col gap-4">
          <Card data-testid="fabrica-regras" className="gap-2.5 bg-secondary-background p-4">
            <h2 className="text-base">Regras que nenhum despacho muda</h2>
            {regras.map((r, i) => (
              <p key={i} data-testid="fabrica-regra" className="text-sm">
                {r}
              </p>
            ))}
            {leitura?.kind !== 'ok' && <p className="text-sm">sem leitura do mandato</p>}
          </Card>
          <Card data-testid="fabrica-placar" className="gap-3 bg-secondary-background p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base">Placar</h2>
              <span data-testid="fabrica-placar-base" className="text-xs text-foreground/75">
                {BASE_DO_PLACAR}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {PLACAR.map((n, i) => (
                <div
                  key={i}
                  data-testid="fabrica-placar-numero"
                  className="rounded-base border-2 border-border p-2.5"
                >
                  <div className="font-heading text-2xl font-bold">{n.numero}</div>
                  <div className="text-xs">{n.legenda}</div>
                </div>
              ))}
              <div
                data-testid="fabrica-placar-numero"
                className="rounded-base border-2 border-dashed border-border bg-main/10 p-2.5"
              >
                <div className="font-heading text-2xl font-bold">—</div>
                <div className="text-xs">
                  tempo de card parado esperando você: a fábrica ainda não mede
                </div>
              </div>
            </div>
            <div
              data-testid="fabrica-rebaixamento"
              className="rounded-base border-2 border-border bg-warning/25 px-3 py-2.5 text-sm"
            >
              <b>Rebaixamento automático.</b> Ainda não existe: nenhuma estação volta de A para B
              sozinha. Mudar quem decide é decisão sua, numa PR no fabrica/MANDATO.md.
            </div>
          </Card>
        </aside>
      </div>
    </>
  )
}
