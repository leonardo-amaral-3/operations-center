import type { JSX, ReactNode } from 'react'

import type {
  BoardNaFabricaOk,
  DespachoNaSala,
  ItemNaSala,
  RecursosDaFabrica,
  SessoesDaMaquina as Maquina,
} from '../../../shared/fabrica'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import {
  ROTULO_DA_ESTACAO,
  estadoNaLinha,
  gigas,
  plural,
  previsaoDosPendentes,
  rotuloDoCard,
  skillDoComando,
} from '../linha'
import { repoDaFabrica } from '../boardDaFabrica'
import { BotaoPausar, CabecalhoInterno } from '../Moldura'
import { rotaDoItem, trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'
import { useCardsDoBoard } from '../useCardsDoBoard'
import { useSessoesDaMaquina } from '../useSessoesDaMaquina'

type Ir = PropsDaTela['ir']
type Titulos = (url: string) => string | null

const TH = 'border-b-2 border-border bg-main px-3 py-2.5 text-left font-heading text-[13px]'
const TD = 'border-b-2 border-border px-3 py-2.5 align-middle text-[13px]'

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

export function Agentes({ tela, sala, ir, comando, emVoo, board }: PropsDaTela): JSX.Element {
  const cards = useCardsDoBoard()
  const titulo: Titulos = (url) => cards.get(url)?.title ?? null
  const recursos = sala?.recursos ?? null
  const maquina = useSessoesDaMaquina()
  // A `cardUrl` da sessão vem em minúsculas; a do board, não.
  const porUrl = new Map([...cards].map(([url, c]) => [url.toLowerCase(), c]))
  const tituloDaSessao: Titulos = (url) => porUrl.get(url)?.title ?? null

  return (
    <>
      <CabecalhoInterno
        padrao={board.padrao}
        trilha={trilhaDa(tela, new Date())}
        onIr={ir}
        atual={tela.tela}
        direita={
          <div className="flex flex-wrap items-center gap-2">
            {recursos !== null && <Cracha sessoes={recursos.sessoes} />}
            <BotaoPausar
              sala={sala}
              emVoo={emVoo}
              onComando={(c) => {
                void comando(c)
              }}
            />
          </div>
        }
      />
      <Corpo
        sala={sala}
        ir={ir}
        titulo={titulo}
        maquina={maquina}
        tituloDaSessao={tituloDaSessao}
        board={board}
      />
    </>
  )
}

function Cracha({ sessoes }: { sessoes: RecursosDaFabrica['sessoes'] }): JSX.Element {
  return sessoes.kind === 'ok' ? (
    <Badge variant="neutral" data-testid="fabrica-sessoes">
      {`${sessoes.vivas} de ${sessoes.teto} sessões`}
    </Badge>
  ) : (
    <Badge variant="neutral" data-testid="fabrica-sessoes" title={sessoes.motivo}>
      {`sem leitura · teto ${sessoes.teto}`}
    </Badge>
  )
}

function Corpo({
  sala,
  ir,
  titulo,
  maquina,
  tituloDaSessao,
  board,
}: {
  sala: PropsDaTela['sala']
  ir: Ir
  titulo: Titulos
  maquina: Maquina | null
  tituloDaSessao: Titulos
  board: BoardNaFabricaOk
}): JSX.Element {
  if (sala === null) {
    return (
      <p data-testid="fabrica-lendo" className="text-sm">
        Lendo o estado da fábrica…
      </p>
    )
  }

  const ok = sala.kind === 'ok' ? sala : null
  const { recursos } = sala
  const emVoo = ok?.emVoo ?? []
  const abertos = ok?.abertos ?? []

  return (
    <>
      {sala.kind === 'ilegivel' && (
        <div role="alert" data-testid="fabrica-erro" className="flex flex-col gap-1 text-sm">
          <p>Não foi possível ler o estado da fábrica.</p>
          <p className="text-xs break-words text-foreground/75">{sala.erro}</p>
        </div>
      )}
      <Sessoes emVoo={emVoo} abertos={abertos} recursos={recursos} ir={ir} titulo={titulo} />
      <SessoesDaMaquina maquina={maquina} ir={ir} titulo={tituloDaSessao} board={board} />
      <div className="flex flex-wrap items-start gap-5">
        <Cadeados recursos={recursos} />
        <Proximos sala={ok} titulo={titulo} />
        <SeOPcCair />
      </div>
    </>
  )
}

function Sessoes({
  emVoo,
  abertos,
  recursos,
  ir,
  titulo,
}: {
  emVoo: DespachoNaSala[]
  abertos: ItemNaSala[]
  recursos: RecursosDaFabrica | null
  ir: Ir
  titulo: Titulos
}): JSX.Element {
  const sessoes = recursos?.sessoes
  const suite = recursos?.suite
  const vivasNaTabela = emVoo.filter((d) => d.viva === true).length
  const fora = sessoes?.kind === 'ok' ? sessoes.vivas - vivasNaTabela : 0

  return (
    <section aria-label="Sessões" className="flex flex-col gap-3">
      <h1 className="font-heading text-2xl">Sessões da fábrica</h1>
      <Card className="overflow-x-auto bg-secondary-background p-0">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr>
              {['Card', 'Estação', 'Agente', 'Onde roda', 'Estado'].map((coluna) => (
                <th key={coluna} scope="col" className={TH}>
                  {coluna}
                </th>
              ))}
              <th scope="col" className={TH}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {emVoo.map((d) => {
              const segura = suite?.kind === 'ocupada' && suite.card === d.card
              const ativa = d.estado === 'lancando' || d.estado === 'rodando'

              return (
                <tr
                  key={d.id}
                  data-testid="fabrica-agente"
                  data-state={d.estado}
                  className="[&:last-child>td]:border-b-0"
                >
                  <td className={TD}>
                    <button
                      type="button"
                      className="font-bold underline"
                      data-testid="fabrica-agentes-card"
                      onClick={() => {
                        ir({ tela: 'card', card: d.card, repo: d.repo })
                      }}
                    >
                      {rotuloDoCard(d.card, titulo(d.cardUrl))}
                    </button>
                  </td>
                  <td className={TD}>{d.estacao === null ? '—' : ROTULO_DA_ESTACAO[d.estacao]}</td>
                  <td className={TD}>
                    <span title="o despachante não fixa o modelo: vale o padrão do claude">
                      {skillDoComando(d.comando)}
                    </span>
                  </td>
                  <td className={TD}>
                    <span className="font-mono text-xs">{d.ondeRoda}</span>
                  </td>
                  <td className={TD}>
                    <span className="inline-flex items-center gap-2">
                      <Ponto cor={corDoPonto(d)} />
                      {estadoNaLinha(d, 'agentes')}
                      {segura && ' · segura a suíte de smoke'}
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {ativa && (
                      <span className="inline-flex gap-2">
                        <Button
                          size="sm"
                          variant="neutral"
                          data-testid="fabrica-transcrito"
                          onClick={() => {
                            ir({ tela: 'card', card: d.card, repo: d.repo })
                          }}
                        >
                          Transcrito
                        </Button>
                        <Button
                          size="sm"
                          variant="neutral"
                          data-testid="fabrica-assumir"
                          onClick={() => {
                            ir({ tela: 'card', card: d.card, repo: d.repo })
                          }}
                        >
                          Assumir
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            {abertos.map((item) => (
              <tr
                key={item.id}
                data-testid="fabrica-agente-parado"
                className="bg-question/20 [&:last-child>td]:border-b-0"
              >
                <td className={TD}>
                  <button
                    type="button"
                    className="font-bold underline"
                    data-testid="fabrica-agentes-card"
                    onClick={() => {
                      ir({ tela: 'card', card: item.card, repo: item.repo })
                    }}
                  >
                    {rotuloDoCard(item.card, titulo(item.cardUrl))}
                  </button>
                </td>
                <td className={TD}>
                  {item.estacao === null ? '—' : ROTULO_DA_ESTACAO[item.estacao]}
                </td>
                <td className={TD}>{item.comando === null ? '—' : skillDoComando(item.comando)}</td>
                <td className={TD}>—</td>
                <td className={TD}>
                  <span className="inline-flex items-center gap-2">
                    <Ponto cor={item.sessaoQuebrada ? 'bg-danger' : 'bg-question'} />
                    {item.sessaoQuebrada ? 'sessão quebrada' : 'parada na sua fila'}
                  </span>
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  <Button
                    size="sm"
                    variant="neutral"
                    data-testid="fabrica-agentes-responder"
                    onClick={() => {
                      ir(rotaDoItem(item))
                    }}
                  >
                    Responder
                  </Button>
                </td>
              </tr>
            ))}
            {emVoo.length === 0 && abertos.length === 0 && (
              <tr>
                <td colSpan={6} data-testid="fabrica-agentes-vazio" className={TD}>
                  Nenhuma sessão da fábrica em voo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {fora > 0 && (
        <p data-testid="fabrica-agentes-fora" className="text-xs text-foreground/75">
          {`${fora} ${plural(fora, 'sessão', 'sessões')} da prova fora do yarn fabrica: ${plural(fora, 'conta', 'contam')} no teto e não ${plural(fora, 'aparece', 'aparecem')} nesta tabela.`}
        </p>
      )}
    </section>
  )
}

const ORIGEM: Record<'despachada' | 'sdk' | 'interativa', string> = {
  despachada: 'despachada (-p)',
  sdk: 'SDK',
  interativa: 'interativa',
}

/** Toda sessão `claude` viva na máquina (#142, §3.7). Só leitura; só card do operations-center é botão. */
function SessoesDaMaquina({
  maquina,
  ir,
  titulo,
  board,
}: {
  maquina: Maquina | null
  ir: Ir
  titulo: Titulos
  board: BoardNaFabricaOk
}): JSX.Element {
  return (
    <section
      aria-label="Sessões da máquina"
      data-testid="fabrica-maquina"
      className="flex flex-col gap-3"
    >
      <h2 className="font-heading text-lg">Sessões da máquina</h2>
      <p className="text-xs text-foreground/75">
        Toda sessão claude viva nesta máquina, de qualquer board, despachada ou não. Só leitura.
      </p>
      {maquina === null ? (
        <p data-testid="fabrica-maquina-lendo" className="text-sm">
          Lendo as sessões da máquina…
        </p>
      ) : maquina.kind === 'sem-leitura' ? (
        <p data-testid="fabrica-maquina-sem-leitura" title={maquina.motivo} className="text-sm">
          {`sem leitura: ${maquina.motivo}`}
        </p>
      ) : (
        <Card className="overflow-x-auto bg-secondary-background p-0">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                {['Card', 'Repo', 'Origem', 'Agente', 'Onde roda'].map((coluna) => (
                  <th key={coluna} scope="col" className={TH}>
                    {coluna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {maquina.sessoes.map((s) => {
                const rotulo =
                  s.card === null || s.cardUrl === null
                    ? null
                    : rotuloDoCard(s.card, titulo(s.cardUrl))
                const card = s.card
                const repo = s.repo === null ? null : repoDaFabrica(board, s.repo)

                return (
                  <tr
                    key={s.pid}
                    data-testid="fabrica-maquina-sessao"
                    data-pid={String(s.pid)}
                    data-origem={s.origem}
                    className="[&:last-child>td]:border-b-0"
                  >
                    <td className={TD}>
                      {rotulo === null || card === null ? (
                        'sem leitura'
                      ) : repo !== null ? (
                        <button
                          type="button"
                          className="font-bold underline"
                          onClick={() => {
                            ir({ tela: 'card', card, repo })
                          }}
                        >
                          {rotulo}
                        </button>
                      ) : (
                        rotulo
                      )}
                    </td>
                    <td className={TD}>{s.repo ?? 'sem leitura'}</td>
                    <td className={TD}>
                      {ORIGEM[s.origem]}
                      {s.daFabrica && (
                        <Badge variant="neutral" className="ml-2">
                          yarn fabrica
                        </Badge>
                      )}
                    </td>
                    <td className={TD}>{s.skill ?? '—'}</td>
                    <td className={TD}>
                      <span className="font-mono text-xs">{s.pasta ?? 'sem leitura'}</span>
                    </td>
                  </tr>
                )
              })}
              {maquina.sessoes.length === 0 && (
                <tr>
                  <td colSpan={5} data-testid="fabrica-maquina-vazio" className={TD}>
                    Nenhuma sessão claude viva na máquina.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  )
}

function Caixa({
  titulo,
  badge,
  children,
}: {
  titulo: string
  badge: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-base border-2 border-border px-3 py-2.5">
      <div className="flex justify-between gap-2 text-sm font-bold">
        <span>{titulo}</span>
        {badge}
      </div>
      <p className="text-xs">{children}</p>
    </div>
  )
}

const USO_DA_SUITE = 'Uma suíte por vez na máquina (yarn smoke).'

function Cadeados({ recursos }: { recursos: RecursosDaFabrica | null }): JSX.Element {
  const suite = recursos?.suite ?? { kind: 'sem-leitura' as const, motivo: 'sem leitura' }
  const disco = recursos?.disco ?? { kind: 'sem-leitura' as const, motivo: 'sem leitura' }

  return (
    <Card className="flex-[1_1_320px] gap-3 bg-secondary-background p-4">
      <h2 className="font-heading text-base">Cadeados</h2>
      <Caixa
        titulo="Suíte de smoke"
        badge={
          suite.kind === 'ocupada' ? (
            <Badge className="bg-warning text-warning-foreground">ocupada</Badge>
          ) : suite.kind === 'livre' ? (
            <Badge className="bg-attention text-attention-foreground">livre</Badge>
          ) : (
            <Badge variant="neutral">sem leitura</Badge>
          )
        }
      >
        {suite.kind === 'ocupada'
          ? `${suite.card === null ? 'Com uma pasta sem card.' : `Com o #${suite.card}.`} ${suite.esperando === 0 ? 'Fila vazia.' : `${suite.esperando} esperando.`} ${USO_DA_SUITE}`
          : suite.kind === 'livre'
            ? `Ninguém rodando a suíte. ${USO_DA_SUITE}`
            : suite.motivo}
      </Caixa>
      <Caixa titulo="Projeto do Ghidra" badge={<Badge variant="neutral">não se aplica</Badge>}>
        Esta fábrica não usa o Ghidra: não há cadeado a mostrar.
      </Caixa>
      <Caixa
        titulo="Disco"
        badge={
          disco.kind === 'ok' ? (
            <Badge
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
            <Badge variant="neutral" title={disco.motivo}>
              sem leitura
            </Badge>
          )
        }
      >
        {disco.kind === 'ok'
          ? `${gigas(disco.livres)} livres na partição da fábrica. O mínimo da esteira é 2 GB; o despachante não confere o disco antes de lançar.`
          : disco.motivo}
      </Caixa>
    </Card>
  )
}

function Proximos({
  sala,
  titulo,
}: {
  sala: Extract<PropsDaTela['sala'], { kind: 'ok' }> | null
  titulo: Titulos
}): JSX.Element {
  const pendentes = sala?.emVoo.filter((d) => d.estado === 'pendente') ?? []
  const previsao = sala === null ? [] : previsaoDosPendentes(sala)

  return (
    <Card className="flex-[1_1_320px] gap-3 bg-secondary-background p-4">
      <h2 className="font-heading text-base">Próximos despachos</h2>
      <p className="text-xs text-foreground/75">
        Ordem de chegada: o mais antigo primeiro, uma sessão por frente.
      </p>
      {pendentes.length === 0 ? (
        <p data-testid="fabrica-proximos-vazio" className="text-[13px]">
          Nada pendente. O próximo despacho nasce de um PROXIMO: de uma sessão ou de um yarn fabrica
          iniciar.
        </p>
      ) : (
        <>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-[18px]">
            {pendentes.slice(0, 5).map((d, i) => (
              <li key={d.id} data-testid="fabrica-proximo">
                <b>{rotuloDoCard(d.card, titulo(d.cardUrl))}</b>: {d.comando}, {previsao[i]}.
              </li>
            ))}
          </ol>
          {pendentes.length > 5 && (
            <p className="text-xs text-foreground/75">e mais {pendentes.length - 5}.</p>
          )}
        </>
      )}
    </Card>
  )
}

function SeOPcCair(): JSX.Element {
  return (
    <Card className="flex-[1_1_320px] gap-3 bg-main p-4">
      <h2 className="font-heading text-base">Se o PC cair</h2>
      <p className="text-[13px] leading-[18px]">
        Como na queda de 09/11/2026. O estado da fábrica fica em disco, fora do /tmp. Quando o yarn
        fabrica rodar volta, ele recolhe o que estava em voo: a sessão que morreu sem terminar vira
        item da sua fila, e o que nunca chegou a subir volta para a fila de lançamento.
      </p>
      <p className="text-[13px] leading-[18px]">
        Nada é relançado sozinho: uma sessão que pode ter rodado nunca roda de novo, para não
        repetir um commit. Cada sessão nova sobe em ambiente limpo, sem herdar as variáveis de quem
        despacha.
      </p>
    </Card>
  )
}
