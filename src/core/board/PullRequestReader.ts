import { asArray, asNumber, asRecord, asString } from './narrow'
import { parsePatch } from './patch'
import { pickPullRequest } from './pullRequestLink'
import { PR_LINK_QUERY, PR_QUERY } from './query'
import type {
  GraphQLFn,
  PrArquivo,
  PrArquivoStatus,
  PrAuthor,
  PrCheck,
  PrChecks,
  PrThreadComment,
  PrTimelineEntry,
  PullRequestState,
  PullRequestView,
  RestGetFn,
} from './types'

export interface PullRequestReaderDeps {
  /** Injetados, como no `CardReader`: o core não fala HTTP. */
  graphql: GraphQLFn
  rest: RestGetFn
}

export interface ReadPullRequestInput {
  owner: string
  name: string
  /** O número do **card**, e não o do PR: o PR é achado pela timeline da issue. */
  number: number
}

/** Quantos arquivos a REST devolve numa leitura. Uma página, e só (regra 7 do `CardReader`). */
export const PR_MAX_FILES = 100

const STATUS_DE_ARQUIVO: readonly PrArquivoStatus[] = [
  'added',
  'removed',
  'modified',
  'renamed',
  'copied',
  'changed',
  'unchanged',
]
const ESTADOS_DE_REVIEW = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'] as const
const ESTADOS_DE_CI = ['EXPECTED', 'ERROR', 'FAILURE', 'PENDING', 'SUCCESS'] as const
const ESTADOS_DE_PR: readonly PullRequestState[] = ['OPEN', 'CLOSED', 'MERGED']
const MERGEAVEL = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN'] as const

/**
 * Lê o PR de um card e o traduz no `PullRequestView` que a aba PR desenha.
 *
 * Espelha o `CardReader` no formato: `graphql` e `rest` injetados, toda resposta passando pelas
 * guardas de `narrow.ts`. São três leituras em sequência: a issue (para achar o PR), o PR em si
 * (GraphQL) e a lista de arquivos com patch (REST, porque a GraphQL não entrega o patch).
 */
export class PullRequestReader {
  readonly #graphql: GraphQLFn
  readonly #rest: RestGetFn

  constructor(deps: PullRequestReaderDeps) {
    this.#graphql = deps.graphql
    this.#rest = deps.rest
  }

  async read(input: ReadPullRequestInput): Promise<PullRequestView> {
    const { owner, name } = input
    const onde = { owner, name }

    // Regra 1: qualquer `errors` é fatal, como no `CardReader`. Aqui não há a exceção da timeline:
    // quem pede o PR espera por ele, e um erro na descoberta não tem como virar "sem PR".
    const link = await this.#graphql(PR_LINK_QUERY, { ...onde, number: input.number })
    if (link.errors?.[0]) throw new Error(link.errors[0].message)

    // Regra 2: o mesmo erro do `CardReader`.
    const issue = asRecord(asRecord(asRecord(link.data)?.['repository'])?.['issue'])
    if (!issue) {
      throw new Error(
        `o GitHub não devolveu a issue #${input.number} de ${owner}/${name} — repo inacessível ou card removido`,
      )
    }

    const ref = pickPullRequest(issue['timelineItems'], input)
    if (!ref) throw new Error('este card não tem PR')

    const response = await this.#graphql(PR_QUERY, { ...onde, number: ref.number })
    if (response.errors?.[0]) throw new Error(response.errors[0].message)

    const pr = asRecord(asRecord(asRecord(response.data)?.['repository'])?.['pullRequest'])
    if (!pr) throw new Error(`o GitHub não devolveu o PR #${ref.number} de ${owner}/${name}`)

    const files = await this.#rest(`repos/${owner}/${name}/pulls/${ref.number}/files?per_page=${PR_MAX_FILES}`)
    if (!Array.isArray(files)) {
      throw new Error(`resposta inesperada da lista de arquivos do PR #${ref.number}`)
    }

    const comments = asRecord(pr['comments'])
    const reviews = asRecord(pr['reviews'])
    const threads = asRecord(pr['reviewThreads'])
    const timelineTruncated =
      excede(comments) || excede(reviews) || excede(threads) || asArray(threads?.['nodes']).some((t) => excede(asRecord(asRecord(t)?.['comments'])))

    const arquivos = readFiles(files)
    const totalDeArquivos = asNumber(pr['changedFiles']) ?? files.length

    return {
      number: asNumber(pr['number']) ?? ref.number,
      title: asString(pr['title']) ?? '',
      url: asString(pr['url']) ?? ref.url,
      state: oneOf(pr['state'], ESTADOS_DE_PR) ?? ref.state,
      isDraft: pr['isDraft'] === true,
      mergedAt: asString(pr['mergedAt']),
      baseRef: asString(pr['baseRefName']) ?? '',
      headRef: asString(pr['headRefName']) ?? '',
      body: asString(pr['body']) ?? '',
      mergeable: oneOf(pr['mergeable'], MERGEAVEL) ?? 'UNKNOWN',
      timeline: buildTimeline(comments, reviews, threads),
      timelineTruncated,
      checks: readChecks(pr['commits']),
      arquivos,
      totalDeArquivos,
      // Conta os itens da REST **antes** do descarte: um malformado não pode esconder o corte.
      arquivosCortados: totalDeArquivos > files.length,
    }
  }
}

/** `totalCount` maior que os nós lidos: a conexão foi cortada. */
function excede(connection: Record<string, unknown> | null): boolean {
  return (asNumber(connection?.['totalCount']) ?? 0) > asArray(connection?.['nodes']).length
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((candidato) => candidato === value) ?? null
}

/** `author: null` é conta removida; `__typename` é o que diz bot, porque o login vem sem `[bot]`. */
function readAuthor(raw: unknown): PrAuthor {
  const author = asRecord(raw)
  return { login: asString(author?.['login']), bot: author?.['__typename'] === 'Bot' }
}

function readThreadComments(connection: unknown): readonly PrThreadComment[] {
  const comments: PrThreadComment[] = []
  for (const raw of asArray(asRecord(connection)?.['nodes'])) {
    const node = asRecord(raw)
    const id = asString(node?.['id'])
    const body = asString(node?.['body'])
    if (id === null || body === null) continue
    comments.push({
      id,
      author: readAuthor(node?.['author']),
      createdAt: asString(node?.['createdAt']) ?? '',
      body,
    })
  }
  return comments
}

/**
 * A conversa única: comentários, reviews e comentários de linha por data crescente. O `sort` é
 * estável, então o empate mantém a ordem em que foram empilhados: comentários, reviews, threads.
 *
 * Review `PENDING`, ou `COMMENTED` sem corpo, é só o envelope dos comentários de linha e fica de
 * fora; sem `submittedAt` não há onde ordená-la. Thread sem comentário não tem o que mostrar.
 */
function buildTimeline(
  comments: Record<string, unknown> | null,
  reviews: Record<string, unknown> | null,
  threads: Record<string, unknown> | null,
): readonly PrTimelineEntry[] {
  const entries: PrTimelineEntry[] = []

  for (const raw of asArray(comments?.['nodes'])) {
    const node = asRecord(raw)
    const id = asString(node?.['id'])
    const body = asString(node?.['body'])
    if (id === null || body === null) continue
    entries.push({
      kind: 'comment',
      id,
      author: readAuthor(node?.['author']),
      at: asString(node?.['createdAt']) ?? '',
      body,
    })
  }

  for (const raw of asArray(reviews?.['nodes'])) {
    const node = asRecord(raw)
    const id = asString(node?.['id'])
    const state = oneOf(node?.['state'], ESTADOS_DE_REVIEW)
    const at = asString(node?.['submittedAt'])
    if (id === null || state === null || at === null) continue
    const body = asString(node?.['body']) ?? ''
    if (state === 'COMMENTED' && body.trim() === '') continue
    entries.push({ kind: 'review', id, author: readAuthor(node?.['author']), at, state, body })
  }

  for (const raw of asArray(threads?.['nodes'])) {
    const node = asRecord(raw)
    const id = asString(node?.['id'])
    const comentarios = readThreadComments(node?.['comments'])
    const primeiro = comentarios[0]
    if (id === null || !primeiro) continue
    entries.push({
      kind: 'thread',
      id,
      at: primeiro.createdAt,
      caminho: asString(node?.['path']) ?? '',
      line: asNumber(node?.['line']) ?? asNumber(node?.['originalLine']),
      resolved: node?.['isResolved'] === true,
      outdated: node?.['isOutdated'] === true,
      comments: comentarios,
    })
  }

  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/** O CI do último commit. Sem commit ou sem rollup: `state: null` e nenhum check. */
function readChecks(commits: unknown): PrChecks {
  const commit = asRecord(asRecord(asArray(asRecord(commits)?.['nodes'])[0])?.['commit'])
  const rollup = asRecord(commit?.['statusCheckRollup'])
  if (!rollup) return { state: null, checks: [], truncated: false }

  const contexts = asRecord(rollup['contexts'])
  const checks: PrCheck[] = []

  for (const raw of asArray(contexts?.['nodes'])) {
    const node = asRecord(raw)
    if (node?.['__typename'] === 'CheckRun') {
      const nome = asString(node['name'])
      const result = asString(node['conclusion']) ?? asString(node['status'])
      if (nome === null || result === null) continue
      checks.push({ name: nome, result, url: asString(node['detailsUrl']) })
    } else if (node?.['__typename'] === 'StatusContext') {
      const nome = asString(node['context'])
      const result = asString(node['state'])
      if (nome === null || result === null) continue
      checks.push({ name: nome, result, url: asString(node['targetUrl']) })
    }
  }

  return { state: oneOf(rollup['state'], ESTADOS_DE_CI), checks, truncated: excede(contexts) }
}

/** Item sem `filename` é descartado; status desconhecido vira `changed`; sem `patch`, `diff` é `null`. */
function readFiles(files: readonly unknown[]): readonly PrArquivo[] {
  const arquivos: PrArquivo[] = []

  for (const raw of files) {
    const item = asRecord(raw)
    const caminho = asString(item?.['filename'])
    if (item === null || caminho === null) continue

    const additions = asNumber(item['additions']) ?? 0
    const deletions = asNumber(item['deletions']) ?? 0
    const patch = asString(item['patch'])

    arquivos.push({
      caminho,
      caminhoAnterior: asString(item['previous_filename']),
      status: oneOf(item['status'], STATUS_DE_ARQUIVO) ?? 'changed',
      additions,
      deletions,
      url: asString(item['blob_url']),
      diff: patch === null ? null : parsePatch(patch, additions, deletions),
    })
  }

  return arquivos
}
