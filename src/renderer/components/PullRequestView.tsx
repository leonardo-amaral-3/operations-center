import { memo } from 'react'
import type { JSX, ReactNode } from 'react'

import type {
  PrArquivo,
  PrArquivoStatus,
  PrAuthor,
  PrChecks,
  PrThreadComment,
  PrTimelineEntry,
  PullRequestView as PullRequestData,
} from '../../shared/board'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { cn } from '../ui/cn'
import { formatarData } from './CardContentView'
import { DiffView } from './DiffView'
import { Markdown } from './Markdown'

/** O que a tela sabe da leitura do PR — a mesma forma do `ContentState`, com o PR no lugar do card. */
export type PullRequestState =
  { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'loaded'; pr: PullRequestData }

interface PullRequestViewProps {
  state: PullRequestState
  /** `true` enquanto uma leitura está em voo — o conteúdo antigo fica na tela e o ⟳ desabilita. */
  pending: boolean
  onReload: () => void
  /** O `caminho` do arquivo com o patch aberto, ou `null`. */
  arquivoAberto: string | null
  onArquivo: (caminho: string) => void
}

const STATUS_DO_ARQUIVO: Record<PrArquivoStatus, string> = {
  added: 'adicionado',
  removed: 'removido',
  modified: 'modificado',
  renamed: 'renomeado',
  copied: 'copiado',
  changed: 'alterado',
  unchanged: 'sem mudança',
}

const ESTADO_DO_CI: Record<NonNullable<PrChecks['state']>, string> = {
  SUCCESS: 'CI passou',
  FAILURE: 'CI falhou',
  ERROR: 'CI com erro',
  PENDING: 'CI em andamento',
  EXPECTED: 'CI esperado',
}

const ESTADO_DA_REVISAO = {
  APPROVED: 'aprovou',
  CHANGES_REQUESTED: 'pediu mudanças',
  COMMENTED: 'comentou',
  DISMISSED: 'descartada',
} as const

/** Link que sai para o navegador: o `setWindowOpenHandler` do main cuida do `_blank`. */
function Externo({ href, children }: { href: string; children: string }): JSX.Element {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  )
}

function Etiqueta({ children }: { children: string }): JSX.Element {
  return (
    <Badge variant="neutral" className="rounded-base px-1.5 py-0 text-[10px] font-normal">
      {children}
    </Badge>
  )
}

/**
 * Selo com glifo e cor. `variant="neutral"` sempre, como o `StateBadge`: a cor vem do `className`,
 * nunca do `bg-main` da variante default (que só o selo de PR mergeado usa, sem passar por aqui).
 */
function Selo({
  className,
  glifo,
  children,
  ...data
}: {
  className?: string
  glifo?: string
  children: string
  'data-testid'?: string
  'data-state'?: string
}): JSX.Element {
  return (
    <Badge
      variant="neutral"
      className={cn('rounded-base px-1.5 py-0 text-[10px] font-normal', className)}
      {...data}
    >
      {glifo === undefined ? null : <span aria-hidden="true">{glifo}</span>}
      {children}
    </Badge>
  )
}

function estadoDoPr(pr: PullRequestData): string {
  if (pr.state === 'MERGED') {
    return pr.mergedAt === null ? 'Mergeado' : `Mergeado em ${formatarData(pr.mergedAt)}`
  }

  if (pr.state === 'CLOSED') return 'Fechado sem merge'

  return pr.isDraft ? 'Rascunho' : 'Aberto'
}

const MERGEAVEL: Record<PullRequestData['mergeable'], string> = {
  MERGEABLE: 'Mergeável',
  CONFLICTING: 'Com conflito',
  UNKNOWN: 'O GitHub ainda está calculando — recarregue',
}

/** Mergeado é a esteira (violeta): exatamente o `Badge` default, sem `variant` nem cor à mão. */
function SeloDeEstado({ pr }: { pr: PullRequestData }): JSX.Element {
  if (pr.state === 'MERGED') {
    return (
      <Badge data-testid="pr-state" className="rounded-base px-1.5 py-0 text-[10px] font-normal">
        {estadoDoPr(pr)}
      </Badge>
    )
  }

  return <Selo data-testid="pr-state">{estadoDoPr(pr)}</Selo>
}

function SeloDeMerge({ mergeable }: { mergeable: PullRequestData['mergeable'] }): JSX.Element {
  if (mergeable === 'CONFLICTING') {
    return (
      <Selo data-testid="pr-merge" glifo="✕" className="bg-danger text-danger-foreground">
        {MERGEAVEL[mergeable]}
      </Selo>
    )
  }

  return (
    <Selo
      data-testid="pr-merge"
      className={mergeable === 'UNKNOWN' ? 'text-foreground/60' : undefined}
    >
      {MERGEAVEL[mergeable]}
    </Selo>
  )
}

function Autor({ author }: { author: PrAuthor }): JSX.Element {
  return (
    <>
      {/* Conta removida devolve `author: null` na API; o rótulo diz isso em vez de um vazio. */}
      <span className="font-mono">{author.login ?? 'conta removida'}</span>
      {author.bot ? <Etiqueta>bot</Etiqueta> : null}
    </>
  )
}

function Cabecalho({
  autor,
  at,
  children,
}: {
  autor: PrAuthor
  at: string
  children?: JSX.Element | null
}): JSX.Element {
  return (
    <header className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/60">
      <Autor author={autor} />
      <span aria-hidden="true">·</span>
      <time dateTime={at}>{formatarData(at)}</time>
      {children}
    </header>
  )
}

function ComentarioDoThread({ comment }: { comment: PrThreadComment }): JSX.Element {
  return (
    <div className="mt-1 border-l-2 border-border pl-2">
      <Cabecalho autor={comment.author} at={comment.createdAt} />
      <div className="text-xs">
        <Markdown text={comment.body} />
      </div>
    </div>
  )
}

const Entrada = memo(function Entrada({ entry }: { entry: PrTimelineEntry }): JSX.Element {
  if (entry.kind === 'thread') {
    return (
      <article data-testid="pr-entry" data-kind="thread" className="border-t-2 border-border pt-2">
        <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/60">
          <span data-testid="pr-thread-loc" className="font-mono">
            {entry.line === null ? entry.caminho : `${entry.caminho}:${entry.line}`}
          </span>
          {entry.resolved ? (
            <span data-testid="pr-thread-resolved">
              <Etiqueta>Resolvido</Etiqueta>
            </span>
          ) : null}
          {entry.outdated ? <Etiqueta>Desatualizado</Etiqueta> : null}
        </p>
        {entry.comments.map((comment) => (
          <ComentarioDoThread key={comment.id} comment={comment} />
        ))}
      </article>
    )
  }

  return (
    <article
      data-testid="pr-entry"
      data-kind={entry.kind}
      className="border-t-2 border-border pt-2"
    >
      <Cabecalho autor={entry.author} at={entry.at}>
        {entry.kind === 'review' ? <Etiqueta>{ESTADO_DA_REVISAO[entry.state]}</Etiqueta> : null}
      </Cabecalho>
      <div className="text-xs">
        <Markdown text={entry.body} />
      </div>
    </article>
  )
})

function Arquivo({
  arquivo,
  aberto,
  onArquivo,
}: {
  arquivo: PrArquivo
  aberto: boolean
  onArquivo: (caminho: string) => void
}): JSX.Element {
  const totais = `+${arquivo.additions} −${arquivo.deletions}`
  const nome =
    arquivo.status === 'renamed' && arquivo.caminhoAnterior !== null
      ? `${arquivo.caminhoAnterior} → ${arquivo.caminho}`
      : arquivo.caminho

  const linha = (
    <>
      <span aria-hidden="true">{arquivo.diff === null ? '·' : aberto ? '▾' : '▸'}</span>
      <span className="min-w-0 flex-1 truncate font-mono" title={nome}>
        {nome}
      </span>
      <span className="shrink-0 text-foreground/60">{STATUS_DO_ARQUIVO[arquivo.status]}</span>
      <span className="shrink-0 font-mono text-foreground/60">{totais}</span>
    </>
  )

  return (
    <li className="border-t-2 border-border py-1 first:border-t-0">
      {/* Sem patch (binário ou grande demais) o arquivo não tem o que abrir (CA-5): a linha não é
          botão, não tem `aria-expanded` nem ▸, e o que fica é o link. */}
      {arquivo.diff === null ? (
        <div
          data-testid="pr-file"
          data-caminho={arquivo.caminho}
          className="flex w-full items-baseline gap-1.5 text-[11px]"
        >
          {linha}
        </div>
      ) : (
        <button
          type="button"
          data-testid="pr-file"
          data-caminho={arquivo.caminho}
          aria-expanded={aberto}
          onClick={() => {
            onArquivo(arquivo.caminho)
          }}
          className="flex w-full cursor-pointer items-baseline gap-1.5 text-left text-[11px]"
        >
          {linha}
        </button>
      )}

      {arquivo.diff === null && arquivo.url !== null ? (
        <p className="ml-4 text-[10px]">
          <Externo href={arquivo.url}>Ver no GitHub</Externo>
        </p>
      ) : null}

      {aberto && arquivo.diff !== null ? (
        <div className="mt-1 ml-4 overflow-hidden rounded-base border-2 border-border bg-secondary-background font-mono text-[10px]">
          <DiffView diff={arquivo.diff} />
          {arquivo.diff.truncated > 0 && arquivo.url !== null ? (
            <p className="px-1">
              <Externo href={arquivo.url}>Ver no GitHub</Externo>
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/**
 * Um bloco da aba: `Card` com faixa de título e um slot de resumo à direita. A face é a default da
 * `Card` (`bg-background`) — quem separa o bloco do vizinho é a borda e a sombra, não um `bg-*`.
 */
function Bloco({
  id,
  titulo,
  resumo,
  children,
}: {
  id: string
  titulo: string
  resumo?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <Card asChild>
      <section data-testid={id}>
        <header className="flex items-center justify-between gap-2 border-b-2 border-border px-2 py-1">
          <h3 className="text-[11px] font-heading tracking-wide uppercase">{titulo}</h3>
          {resumo}
        </header>
        <div className="space-y-1 p-2">{children}</div>
      </section>
    </Card>
  )
}

function Carregado({
  pr,
  arquivoAberto,
  onArquivo,
}: Pick<PullRequestViewProps, 'arquivoAberto' | 'onArquivo'> & {
  pr: PullRequestData
}): JSX.Element {
  return (
    <div className="space-y-3">
      <Bloco id="pr-checks" titulo="CI/CD">
        {pr.checks.state === null ? (
          <p className="text-xs">Sem checks</p>
        ) : (
          <p className="text-xs">{ESTADO_DO_CI[pr.checks.state]}</p>
        )}
        {pr.checks.checks.length === 0 && pr.checks.state !== null ? (
          <p className="text-xs">Sem checks</p>
        ) : null}
        <ul className="text-xs">
          {pr.checks.checks.map((check, i) => (
            <li key={`${check.name}-${i}`} className="flex gap-1.5">
              <span className="min-w-0 truncate">
                {check.url === null ? check.name : <Externo href={check.url}>{check.name}</Externo>}
              </span>
              <span className="text-foreground/60">{check.result}</span>
            </li>
          ))}
        </ul>
        {pr.checks.truncated ? (
          <p className="text-xs">
            <Externo href={pr.url}>Há mais checks no GitHub</Externo>
          </p>
        ) : null}
      </Bloco>

      <Bloco id="pr-body" titulo="Descrição">
        {pr.body.trim() === '' ? (
          <p className="text-xs text-foreground/60">Sem descrição</p>
        ) : (
          <div className="text-xs">
            <Markdown text={pr.body} />
          </div>
        )}
      </Bloco>

      <Bloco
        id="pr-timeline"
        titulo="Conversa"
        resumo={<Etiqueta>{`${pr.timeline.length}${pr.timelineTruncated ? '+' : ''}`}</Etiqueta>}
      >
        {pr.timeline.length === 0 ? (
          <p className="text-xs text-foreground/60">Sem comentários</p>
        ) : (
          pr.timeline.map((entry) => <Entrada key={entry.id} entry={entry} />)
        )}
        {pr.timelineTruncated ? (
          <p className="text-xs">
            <Externo href={pr.url}>Há mais comentários no GitHub</Externo>
          </p>
        ) : null}
      </Bloco>

      <Bloco
        id="pr-files"
        titulo="Arquivos"
        resumo={<Etiqueta>{`${pr.totalDeArquivos} arquivos`}</Etiqueta>}
      >
        <ul>
          {pr.arquivos.map((arquivo) => (
            <Arquivo
              key={arquivo.caminho}
              arquivo={arquivo}
              aberto={arquivoAberto === arquivo.caminho}
              onArquivo={onArquivo}
            />
          ))}
        </ul>
        {pr.arquivosCortados ? (
          <p className="text-xs text-foreground/60">
            {`Mostrando ${pr.arquivos.length} de ${pr.totalDeArquivos} arquivos`}
          </p>
        ) : null}
      </Bloco>
    </div>
  )
}

/**
 * A aba PR: o que o GitHub diz do PR do card, somente leitura.
 *
 * **Puro**, como o `CardContentView`: quem lê e quem guarda o arquivo aberto é o `PullRequest`.
 */
export function PullRequestView({
  state,
  pending,
  onReload,
  arquivoAberto,
  onArquivo,
}: PullRequestViewProps): JSX.Element {
  const pr = state.kind === 'loaded' ? state.pr : null

  return (
    // O `pr-1 pb-1` é a folga da sombra dura (4px) dentro do `overflow-y-auto` do `card-pr-body`,
    // que força `overflow-x: auto` e cortaria a sombra das `Card` de largura cheia.
    <section data-testid="pr-view" className="space-y-3 pr-1 pb-1">
      {/* Toda classe na `Card`, nenhuma no filho: com `asChild` o `Slot` empilha os dois
          `className` sem `twMerge`, e o `flex-col` da casca empilharia o título e o ⟳. */}
      <Card
        asChild
        className="flex-row items-start justify-between gap-2 bg-secondary-background p-2.5"
      >
        <header data-testid="pr-header">
          <div className="min-w-0 space-y-0.5">
            {pr === null ? null : (
              <>
                <h2 className="text-xs font-heading break-words">{`#${pr.number} ${pr.title}`}</h2>
                <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/60">
                  <SeloDeEstado pr={pr} />
                  {pr.state === 'OPEN' ? <SeloDeMerge mergeable={pr.mergeable} /> : null}
                  <span className="font-mono">{`${pr.baseRef} ← ${pr.headRef}`}</span>
                  <Externo href={pr.url}>Abrir no GitHub</Externo>
                </p>
              </>
            )}
          </div>
          <Button
            type="button"
            data-testid="pr-reload"
            aria-label="Recarregar o PR"
            title="Recarregar o PR"
            variant="neutral"
            size="xs"
            disabled={pending}
            onClick={onReload}
          >
            <span aria-hidden="true">⟳</span>
          </Button>
        </header>
      </Card>

      {state.kind === 'loading' ? <p className="text-xs text-foreground/60">Lendo o PR…</p> : null}
      {state.kind === 'failed' ? (
        <p className={cn('text-xs break-words text-foreground/70')}>
          {`Não consegui ler o PR: ${state.reason}`}
        </p>
      ) : null}
      {pr === null ? null : (
        <Carregado pr={pr} arquivoAberto={arquivoAberto} onArquivo={onArquivo} />
      )}
    </section>
  )
}
