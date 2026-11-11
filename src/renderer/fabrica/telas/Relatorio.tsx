import { useState } from 'react'
import type { JSX } from 'react'

import type { DecisaoDoDia, PainelDoDia } from '../../../shared/fabrica'
import { Badge, badgeVariants } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { cn } from '../../ui/cn'
import { Input } from '../../ui/input'
import {
  COR_DO_ESTADO,
  diaCurto,
  ehChave,
  estadoDaDecisao,
  hojeEmUtc,
  numerosDoDia,
  quemDecidiu,
  rotuloDaFrente,
  rotuloDoReversivel,
  segmentosDoEsforco,
  semObjetivoDoDia,
  tiposDoDia,
} from '../decisoes'
import { plural } from '../linha'
import { CabecalhoInterno } from '../Moldura'
import { trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'
import { useRelatorioDoDia, useRevisoes } from '../useDia'
import { BotoesDaRevisao, LinhaDaRevisao } from './revisao'

const DIA = /^\d{4}-\d{2}-\d{2}$/

function textoSemFonte(total: number): string {
  return total === 1
    ? '1 linha sem fonte ficou de fora'
    : `${total} linhas sem fonte ficaram de fora`
}

function Kpi({
  nome,
  n,
  rotulo,
  classe,
}: {
  nome: string
  n: number
  rotulo: string
  classe?: string
}): JSX.Element {
  return (
    <Card
      data-testid="fabrica-kpi"
      data-kpi={nome}
      className={cn('flex-[1_1_180px] gap-0.5 bg-secondary-background px-4 py-3', classe)}
    >
      <b className="font-heading text-3xl">{n}</b>
      <span className="text-sm">{rotulo}</span>
    </Card>
  )
}

function Sinais({ p }: { p: PainelDoDia }): JSX.Element {
  const { decisoes: sem, doRepo } = semObjetivoDoDia(p)
  const semRepo = p.decisoes.filter((d) => d.secao === 'sem-repo')
  const fora = p.noCofre - doRepo - semRepo.length
  const escopos = [...new Set(semRepo.map((d) => d.escopo.replace(/^#/, '')))]

  let direcao: string
  if (p.objetivos === null) {
    direcao =
      'Sem fabrica/DIRECAO.md no repo do relatório, nenhuma decisão tem objetivo escrito a citar.'
  } else if (doRepo === 0) {
    direcao = 'Nenhuma decisão do operations-center no dia.'
  } else {
    direcao = `${sem} de ${doRepo} ${plural(doRepo, 'decisão', 'decisões')} do operations-center ${plural(doRepo, 'não cita', 'não citam')} objetivo da Direção.`
  }
  if (p.objetivos !== null) {
    if (fora > 0) {
      direcao += ` Fora dele, o cofre teve ${fora} no dia, que não apontam para nenhum objetivo escrito.`
    }
    direcao += ' Pode estar certo; a Direção é que precisa dizer.'
  } else if (fora > 0) {
    direcao += ` Fora dele, o cofre teve ${fora} no dia, que não apontam para nenhum objetivo escrito.`
  }

  const governanca =
    semRepo.length > 0
      ? `${semRepo.length} ${plural(semRepo.length, 'decisão foi gravada', 'decisões foram gravadas')} com escopo sem o repo: ${escopos.map((e) => `«${e}»`).join(', ')}. O comentário de decisão pode cair no card de outro repo.`
      : 'Nenhuma decisão do dia foi gravada com escopo sem o repo.'

  const caixa = 'flex-[1_1_280px] rounded-base border-2 border-border px-3 py-2.5'

  return (
    <div className="flex flex-wrap gap-3 text-sm">
      <div data-testid="fabrica-sinal" data-sinal="direcao" className={cn(caixa, 'bg-warning/25')}>
        <b>Sinal de direção.</b> {direcao}
      </div>
      <div
        data-testid="fabrica-sinal"
        data-sinal="governanca"
        className={cn(caixa, semRepo.length > 0 ? 'bg-danger/25' : 'bg-secondary-background')}
      >
        <b>Sinal de governança.</b> {governanca}
      </div>
      <div
        data-testid="fabrica-sinal"
        data-sinal="briefing"
        className={cn(caixa, 'bg-secondary-background')}
      >
        <b>Desvio do briefing.</b> A fábrica ainda não registra o briefing do dia: sem teto de
        tempo, não há desvio a medir.
      </div>
    </div>
  )
}

function DecisaoChave({
  d,
  revisoes,
  podeLer,
  comando,
  emVoo,
  aoGravar,
}: {
  d: DecisaoDoDia
  revisoes: ReturnType<typeof useRevisoes>['revisoes']
  podeLer: boolean
  comando: PropsDaTela['comando']
  emVoo: boolean
  aoGravar: () => Promise<void>
}): JSX.Element {
  const [noCofre, setNoCofre] = useState(false)
  const r = revisoes?.get(d.arquivo)
  const estado = estadoDaDecisao(d, r)
  const tag = 'rounded-[4px] border px-1.5 text-[11px]'

  return (
    <Card
      data-testid="fabrica-relatorio-chave"
      data-arquivo={d.arquivo}
      data-estado={estado}
      className="gap-2 bg-secondary-background p-4"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral" className={tag}>
          {rotuloDaFrente(d)}
        </Badge>
        <Badge variant="neutral" className={tag}>
          {quemDecidiu(d)}
        </Badge>
        <Badge variant="neutral" className={cn(tag, d.reversivel === 'nao' && 'bg-warning/25')}>
          {rotuloDoReversivel(d)}
        </Badge>
        <Badge
          data-testid="fabrica-estado-da-decisao"
          className={cn(COR_DO_ESTADO[estado], 'text-foreground')}
        >
          {estado}
        </Badge>
      </div>
      <h3 className="text-base font-bold">{d.titulo}</h3>
      <p className="text-sm">
        <b>Por quê:</b> {d.porque ?? '—'}
      </p>
      {d.descartado !== null && (
        <p className="text-sm text-foreground/85">
          <b>Descartado:</b> {d.descartado}
        </p>
      )}
      <LinhaDaRevisao revisao={r} />
      <BotoesDaRevisao
        decisao={d}
        revisao={r}
        podeLer={podeLer}
        comando={comando}
        emVoo={emVoo}
        aoGravar={aoGravar}
        sempre={false}
        terceiro={
          <>
            <Button
              type="button"
              size="sm"
              variant="neutral"
              data-testid="fabrica-ver-no-cofre"
              onClick={() => {
                setNoCofre((v) => !v)
              }}
            >
              Ver no cofre
            </Button>
          </>
        }
      />
      {noCofre && (
        <p data-testid="fabrica-no-cofre" className="text-xs">
          No cofre: <code>{d.arquivo}</code>
        </p>
      )}
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
  const { revisoes, erro, ilegiveis, reler } = useRevisoes()
  const mapa = revisoes ?? new Map()
  const n = numerosDoDia(p, mapa)
  const segmentos = segmentosDoEsforco(p)
  const chaves = p.decisoes.filter(ehChave)
  const estacionadas = p.decisoes.filter((d) => d.secao === 'estacionada')
  const rotina = p.decisoes.filter((d) => d.secao === 'rotina').length

  return (
    <>
      <Card data-testid="fabrica-relatorio-frase" className="gap-2 bg-secondary-background p-5">
        <span className="text-xs font-bold text-foreground/75">EM UMA FRASE</span>
        <h1 className="max-w-[980px] font-heading text-2xl">
          {p.frases[0]?.texto ??
            `Nada do operations-center no cofre, no board nem no git em ${diaCurto(dia)}.`}
        </h1>
        {p.frases.slice(1).map((f, i) => (
          <p key={i} data-testid="fabrica-relatorio-frase-mais" className="text-sm">
            {f.texto}
          </p>
        ))}
      </Card>

      <section aria-label="Números do dia" className="flex flex-wrap gap-3">
        <Kpi nome="cofre" n={n.cofre} rotulo="decisões no cofre" />
        <Kpi nome="chaves" n={n.chaves} rotulo="decisões-chave abaixo" />
        <Kpi
          nome="provisorias"
          n={n.provisorias}
          rotulo="provisórias para você"
          classe="bg-warning"
        />
        <Kpi
          nome="estacionadas"
          n={n.estacionadas}
          rotulo="estacionadas esperando você"
          classe="bg-question"
        />
        <Kpi
          nome="sem-repo"
          n={n.semRepo}
          rotulo="gravadas com escopo sem repo"
          classe="bg-danger"
        />
      </section>

      <Card data-testid="fabrica-esforco" className="gap-3 bg-secondary-background p-4">
        <h2 className="font-heading text-lg">Para onde foi o esforço</h2>
        <span className="text-xs font-bold">Decisões por repo ({p.noCofre})</span>
        {segmentos.length === 0 ? (
          <p className="text-sm">Nenhuma decisão no cofre em {diaCurto(dia)}.</p>
        ) : (
          <div
            data-testid="fabrica-esforco-barra"
            className="flex overflow-hidden rounded-base border-2 border-border"
          >
            {segmentos.map((s) => (
              <div
                key={s.rotulo}
                data-testid="fabrica-esforco-segmento"
                aria-label={s.semRepo ? s.rotulo : undefined}
                title={s.semRepo ? s.rotulo : undefined}
                className={cn(
                  'flex h-7 items-center overflow-hidden border-r-2 border-border pl-2 text-xs font-bold whitespace-nowrap last:border-r-0',
                  s.classe,
                )}
                style={{ width: `${s.largura}%` }}
              >
                {s.semRepo ? null : s.rotulo}
              </div>
            ))}
          </div>
        )}
        <span className="text-xs text-foreground/75">{tiposDoDia(p)}</span>
        <Sinais p={p} />
      </Card>

      <section aria-label="Decisões-chave" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-lg">Decisões-chave</h2>
          <span className="text-xs text-foreground/75">
            do operations-center; confirmar ou contestar grava na fábrica, e a orquestradora
            substitui no cofre o que você contestar
          </span>
        </div>
        {erro !== null && (
          <p role="alert" data-testid="fabrica-revisoes-erro" className="text-sm">
            Não deu para ler as revisões: {erro}
          </p>
        )}
        {ilegiveis > 0 && (
          <p data-testid="fabrica-revisoes-ilegiveis" className="text-sm">
            {ilegiveis === 1
              ? '1 linha do revisoes.jsonl não deu para ler'
              : `${ilegiveis} linhas do revisoes.jsonl não deram para ler`}
          </p>
        )}
        {chaves.length === 0 ? (
          <p data-testid="fabrica-relatorio-sem-chave" className="text-sm">
            Nenhuma decisão-chave do operations-center em {diaCurto(dia)}.
          </p>
        ) : (
          chaves.map((d) => (
            <DecisaoChave
              key={d.arquivo}
              d={d}
              revisoes={revisoes}
              podeLer={revisoes !== null}
              comando={comando}
              emVoo={emVoo}
              aoGravar={reler}
            />
          ))
        )}
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <Card
          data-testid="fabrica-relatorio-estacionadas"
          className="flex-[1_1_380px] gap-2.5 bg-secondary-background p-4"
        >
          <h2 className="font-heading text-lg">Estacionadas esperando você</h2>
          {estacionadas.length === 0 ? (
            <p className="text-sm">Nenhuma pendência gravada em {diaCurto(dia)}.</p>
          ) : (
            estacionadas.map((d) => (
              <div key={d.arquivo} data-testid="fabrica-relatorio-estacionada" className="text-sm">
                <b>{rotuloDaFrente(d)}</b> · {d.titulo}
              </div>
            ))
          )}
        </Card>
        <Card
          data-testid="fabrica-relatorio-rotina"
          className="flex-[1_1_380px] gap-2.5 bg-secondary-background p-4"
        >
          <h2 className="font-heading text-lg">E mais {rotina} de rotina</h2>
          <p className="text-sm">
            Decisões sem sinal de chave, contadas por frente e a um clique na trilha
            {p.commits === 1 && ', e 1 commit no git'}
            {p.commits > 1 && `, e ${p.commits} commits no git`}.
          </p>
          <button
            type="button"
            data-testid="fabrica-relatorio-abrir-trilha"
            className="self-start text-sm font-bold underline"
            onClick={() => {
              ir({ tela: 'portfolio', dia })
            }}
          >
            Abrir a trilha de {diaCurto(dia)}
          </button>
        </Card>
        <Card
          data-testid="fabrica-relatorio-amanha"
          className="flex-[1_1_380px] gap-2.5 bg-main p-4"
        >
          <h2 className="font-heading text-lg">Amanhã</h2>
          <p className="text-sm">
            A fábrica ainda não escreve o plano de amanhã de cada frente: o relatório só conta o que
            aconteceu.
          </p>
          <Button
            type="button"
            variant="neutral"
            className="self-start"
            data-testid="fabrica-relatorio-briefing"
            onClick={() => {
              ir({ tela: 'briefing' })
            }}
          >
            Abrir o Briefing
          </Button>
        </Card>
      </div>
    </>
  )
}

export function Relatorio({ tela, ir, comando, emVoo }: PropsDaTela): JSX.Element {
  const dia = (tela.tela === 'relatorio' ? tela.dia : undefined) ?? hojeEmUtc(new Date())
  const { relatorio, gerarDeNovo } = useRelatorioDoDia(dia)

  const direita = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="neutral">montado do cofre, do board e do git</Badge>
      <Input
        type="date"
        data-testid="relatorio-dia"
        aria-label="Dia do relatório"
        className="h-8 w-40"
        value={dia}
        onChange={(evento) => {
          const valor = evento.target.value
          if (DIA.test(valor) && valor !== dia) ir({ tela: 'relatorio', dia: valor })
        }}
      />
      {relatorio?.kind === 'ok' && relatorio.semFonte > 0 && (
        <Badge variant="neutral" data-testid="relatorio-sem-fonte">
          {textoSemFonte(relatorio.semFonte)}
        </Badge>
      )}
      <button
        type="button"
        data-testid="relatorio-gerar"
        className="text-xs underline"
        disabled={relatorio === null}
        onClick={gerarDeNovo}
      >
        gerar de novo
      </button>
      <button
        type="button"
        data-testid="fabrica-relatorio-trilha"
        className={cn(badgeVariants(), 'bg-main')}
        onClick={() => {
          ir({ tela: 'portfolio', dia })
        }}
      >
        ver trilha completa
      </button>
    </div>
  )

  return (
    <>
      <CabecalhoInterno trilha={trilhaDa(tela, new Date())} direita={direita} onIr={ir} />
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
