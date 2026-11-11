import { useState } from 'react'
import type { JSX } from 'react'

import type { DecisaoDoDia, PainelDoDia, RevisaoNaSala } from '../../../shared/fabrica'
import { Badge, badgeVariants } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { cn } from '../../ui/cn'
import {
  aberta,
  COR_DO_ESTADO,
  diaCurto,
  diaLongo,
  estadoDaDecisao,
  FILTROS,
  hojeEmUtc,
  objetivosDoDia,
  passaNoFiltro,
  quemDecidiu,
  rotuloDaFrente,
  rotuloDoReversivel,
  semObjetivoDoDia,
  type Filtro,
} from '../decisoes'
import { plural } from '../linha'
import { CabecalhoInterno } from '../Moldura'
import { trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'
import { useRelatorioDoDia, useRevisoes } from '../useDia'
import { BotoesDaRevisao, LinhaDaRevisao } from './revisao'

const COLUNAS =
  'grid grid-cols-[170px_130px_minmax(0,1fr)_110px_110px] items-center gap-3 border-b-2 border-border px-3.5 py-2.5 text-left text-sm'

function ChipDoEstado({ d, r }: { d: DecisaoDoDia; r: RevisaoNaSala | undefined }): JSX.Element {
  const estado = estadoDaDecisao(d, r)

  return (
    <Badge
      data-testid="fabrica-estado-da-decisao"
      className={cn(COR_DO_ESTADO[estado], 'justify-self-start text-foreground')}
    >
      {estado}
    </Badge>
  )
}

function Objetivos({ p }: { p: PainelDoDia }): JSX.Element {
  const objetivos = objetivosDoDia(p)
  const sem = semObjetivoDoDia(p)

  return (
    <section aria-label="Objetivos" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-heading text-2xl">A empresa está indo na direção certa?</h1>
        <span data-testid="fabrica-objetivos-origem" className="text-xs text-foreground/75">
          {objetivos === null
            ? 'sem fabrica/DIRECAO.md: a Direção ainda precisa ser escrita'
            : 'objetivos do fabrica/DIRECAO.md, sem medida de progresso'}
        </span>
      </div>
      <div className="flex flex-wrap gap-4">
        {objetivos === null && (
          <div
            data-testid="fabrica-objetivo-ausente"
            className="flex-[1_1_300px] rounded-base border-2 border-dashed border-border p-4 text-sm"
          >
            Sem fabrica/DIRECAO.md no repo do relatório: não há objetivo para medir.
          </div>
        )}
        {objetivos?.map((o) => (
          <Card
            key={o.codigo}
            data-testid="fabrica-objetivo"
            data-codigo={o.codigo}
            className="flex-[1_1_300px] gap-2.5 bg-secondary-background p-4"
          >
            <Badge className="self-start bg-rota-completa">objetivo</Badge>
            <h2 className="font-heading text-lg">
              {o.codigo} · {o.nome}
            </h2>
            <div className="flex justify-between text-sm font-bold">
              <span>sem medida na Direção</span>
              <span>—</span>
            </div>
            <div className="h-4 rounded-base border-2 border-dashed border-border bg-main/10" />
            <div className="text-sm">
              {o.decisoes > 0 ? (
                <>
                  Frentes: {o.frentes.join(', ')} ·{' '}
                  <b>
                    {o.decisoes} {plural(o.decisoes, 'decisão', 'decisões')} no dia
                  </b>
                </>
              ) : (
                'Nenhuma decisão do dia cita este objetivo.'
              )}
            </div>
          </Card>
        ))}
        {sem.decisoes > 0 && (
          <Card
            data-testid="fabrica-sem-objetivo"
            className="flex-[1_1_300px] gap-2.5 bg-warning/25 p-4"
          >
            <Badge className="self-start bg-danger">sem objetivo</Badge>
            <h2 className="font-heading text-lg">Sem objetivo da Direção</h2>
            <div className="text-sm">
              {sem.frentes.join(', ')} ·{' '}
              <b>
                {sem.decisoes} {plural(sem.decisoes, 'decisão', 'decisões')} no dia
              </b>
              , {Math.round((100 * sem.decisoes) / sem.doRepo)}% das do operations-center.
            </div>
            <div className="text-sm">
              Ou vira objetivo na Direção, ou é esforço fora dela. A decisão é sua.
            </div>
          </Card>
        )}
      </div>
    </section>
  )
}

function Detalhe({
  d,
  dia,
  p,
  revisoes,
  podeLer,
  ir,
  comando,
  emVoo,
  aoGravar,
}: {
  d: DecisaoDoDia | undefined
  dia: string
  p: PainelDoDia
  revisoes: ReadonlyMap<string, RevisaoNaSala> | null
  podeLer: boolean
  ir: PropsDaTela['ir']
  comando: PropsDaTela['comando']
  emVoo: boolean
  aoGravar: () => Promise<void>
}): JSX.Element {
  const caixa = 'flex-[1_1_320px] max-w-[420px] gap-2.5 bg-secondary-background p-4'
  if (d === undefined) {
    return (
      <Card data-testid="fabrica-portfolio-detalhe" className={caixa}>
        <p className="text-sm">Nenhuma decisão em {diaCurto(dia)}.</p>
      </Card>
    )
  }
  const r = revisoes?.get(d.arquivo)
  const nomes = d.objetivos.map((c) => {
    const nome = p.objetivos?.find((o) => o.codigo === c)?.nome

    return nome === undefined ? c : `${c} · ${nome}`
  })
  const objetivo =
    d.secao === 'sem-repo'
      ? 'nenhum; escopo gravado sem o repo'
      : nomes.length > 0
        ? nomes.join(', ')
        : 'nenhum'

  return (
    <Card data-testid="fabrica-portfolio-detalhe" className={caixa}>
      <span className="text-xs font-bold text-foreground/75">
        {rotuloDaFrente(d)} · {quemDecidiu(d)}
      </span>
      <h2 className="font-heading text-lg">{d.titulo}</h2>
      <p className="text-sm">
        <b>Por quê:</b> {d.porque ?? '—'}
      </p>
      <p className="text-sm">
        <b>Descartado:</b> {d.descartado ?? '—'}
      </p>
      <p className="text-sm">
        <b>Sob:</b> {d.sob ?? 'sem marca «sob:» no porquê'}
      </p>
      <p className="text-sm">
        <b>Objetivo:</b> {objetivo}
      </p>
      <LinhaDaRevisao revisao={r} />
      <p className="text-xs">
        No cofre: <code>{d.arquivo}</code>
      </p>
      <BotoesDaRevisao
        key={d.arquivo}
        decisao={d}
        revisao={r}
        podeLer={podeLer}
        comando={comando}
        emVoo={emVoo}
        aoGravar={aoGravar}
        sempre
        terceiro={
          <Button
            type="button"
            size="sm"
            variant="neutral"
            data-testid="fabrica-abrir-transcrito"
            disabled={d.card === null}
            title={
              d.card === null
                ? 'a decisão não tem card'
                : `a tela Card do #${d.card}: os despachos e as sessões do card, com Assumir a sessão`
            }
            onClick={() => {
              if (d.card !== null) ir({ tela: 'card', card: d.card })
            }}
          >
            Abrir o card
          </Button>
        }
      />
    </Card>
  )
}

function Corpo({
  dia,
  p,
  ir,
  comando,
  emVoo,
}: {
  dia: string
  p: PainelDoDia
  ir: PropsDaTela['ir']
  comando: PropsDaTela['comando']
  emVoo: boolean
}): JSX.Element {
  const { revisoes, reler } = useRevisoes()
  const [filtro, setFiltro] = useState<Filtro>('Todas')
  const [sel, setSel] = useState<string | null>(null)
  const revisaoDe = (d: DecisaoDoDia): RevisaoNaSala | undefined => revisoes?.get(d.arquivo)
  const visiveis = p.decisoes.filter((d) => passaNoFiltro(filtro, d, revisaoDe(d)))
  const escolhida =
    p.decisoes.find((d) => d.arquivo === sel) ??
    p.decisoes.find((d) => aberta(d, revisaoDe(d))) ??
    p.decisoes[0]

  return (
    <>
      <Objetivos p={p} />
      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-label="Trilha de decisões"
          className="flex min-w-0 flex-[999_1_760px] flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-lg">Trilha de decisões</h2>
            <div role="group" aria-label="Filtro" className="flex flex-wrap gap-2">
              {FILTROS.map((nome) => (
                <button
                  key={nome}
                  type="button"
                  data-testid="fabrica-filtro"
                  data-filtro={nome}
                  aria-pressed={filtro === nome}
                  className={cn(
                    'min-h-10 rounded-base border-2 border-border px-3.5 text-sm font-bold',
                    filtro === nome ? 'bg-main' : 'bg-secondary-background',
                  )}
                  onClick={() => {
                    setFiltro(nome)
                  }}
                >
                  {nome}
                </button>
              ))}
            </div>
          </div>
          <Card className="gap-0 overflow-x-auto bg-secondary-background p-0">
            <div className="min-w-[760px]">
              <div className={cn(COLUNAS, 'bg-main font-heading font-bold')}>
                <span>Frente</span>
                <span>Quem decidiu</span>
                <span>Decisão</span>
                <span>Reversível</span>
                <span>Estado</span>
              </div>
              {visiveis.length === 0 && (
                <div data-testid="fabrica-decisoes-vazia" className="px-3.5 py-2.5 text-sm">
                  Nenhuma decisão neste filtro.
                </div>
              )}
              {visiveis.map((d) => {
                const ativa = escolhida?.arquivo === d.arquivo

                return (
                  <button
                    key={d.arquivo}
                    type="button"
                    data-testid="fabrica-decisoes-linha"
                    data-arquivo={d.arquivo}
                    aria-pressed={ativa}
                    className={cn(
                      COLUNAS,
                      'w-full',
                      ativa ? 'border-l-4 border-l-main bg-main/10' : 'bg-secondary-background',
                    )}
                    onClick={() => {
                      setSel(d.arquivo)
                    }}
                  >
                    <b>{rotuloDaFrente(d)}</b>
                    <span>{quemDecidiu(d)}</span>
                    <span>{d.titulo}</span>
                    <span>{rotuloDoReversivel(d)}</span>
                    <ChipDoEstado d={d} r={revisaoDe(d)} />
                  </button>
                )
              })}
            </div>
          </Card>
          <p data-testid="fabrica-decisoes-contagem" className="text-xs text-foreground/75">
            {visiveis.length} de {p.decisoes.length} decisões de {diaCurto(dia)} neste filtro. Os
            textos vêm do cofre; os estados, das revisões gravadas pelo yarn fabrica.
          </p>
        </section>
        {/* A `key` zera a caixa de contestação ao trocar de linha: sem ela, o motivo escrito para uma
            decisão seria gravado na outra (G4 da PR #140). */}
        <Detalhe
          key={escolhida?.arquivo ?? ''}
          d={escolhida}
          dia={dia}
          p={p}
          revisoes={revisoes}
          podeLer={revisoes !== null}
          ir={ir}
          comando={comando}
          emVoo={emVoo}
          aoGravar={reler}
        />
      </div>
    </>
  )
}

export function Portfolio({ tela, ir, comando, emVoo }: PropsDaTela): JSX.Element {
  const dia = (tela.tela === 'portfolio' ? tela.dia : undefined) ?? hojeEmUtc(new Date())
  const { relatorio } = useRelatorioDoDia(dia)

  const direita = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="neutral" data-testid="fabrica-portfolio-dia">
        {diaLongo(dia)}
      </Badge>
      <button
        type="button"
        data-testid="fabrica-portfolio-relatorio"
        className={cn(badgeVariants(), 'bg-main')}
        onClick={() => {
          ir({ tela: 'relatorio', dia })
        }}
      >
        relatório do dia
      </button>
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
      {relatorio === null && (
        <p data-testid="relatorio-gerando">Gerando o relatório de {diaCurto(dia)}…</p>
      )}
      {relatorio?.kind === 'erro' && (
        <div data-testid="relatorio-erro" className="flex flex-col gap-1 text-sm">
          <p>Não foi possível gerar o relatório.</p>
          <p className="text-xs break-words text-foreground/60">{relatorio.erro}</p>
        </div>
      )}
      {relatorio?.kind === 'ok' && (
        <Corpo dia={dia} p={relatorio.painel} ir={ir} comando={comando} emVoo={emVoo} />
      )}
    </>
  )
}
