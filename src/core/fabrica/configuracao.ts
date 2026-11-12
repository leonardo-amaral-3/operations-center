import { join, normalize } from 'node:path/posix'

/** O arquivo versionado que é a fonte de repo, board, workspace, pasta de estado e mandato (#144). */
export const ARQUIVO_DA_CONFIGURACAO = 'fabrica/boards.json'

export interface RepoDoBoard {
  readonly owner: string
  readonly name: string
}
export interface OrigemDoMandato {
  readonly repo: RepoDoBoard
  readonly ref: string
  readonly caminho: string
  readonly aprovacao: string
}
export interface ProibidosDoBoard {
  readonly caminhos: readonly string[]
  readonly motivo: string
}
export type ReposDoBoard =
  | { readonly tipo: 'lista'; readonly repos: readonly RepoDoBoard[] } // ≥ 1, `name` sem repetição, na ordem do arquivo
  | { readonly tipo: 'owner'; readonly owner: string } // "<owner>/*"

export interface BoardDaFabrica {
  /** `${owner}/${projeto}` */
  readonly chave: string
  readonly owner: string
  readonly projeto: number
  readonly nome: string
  readonly repos: ReposDoBoard
  /** O repo, quando o board atende um só (`repo`, ou `repos` com um item); `null` com vários ou com `<owner>/*`. */
  readonly repoUnico: RepoDoBoard | null
  /** Absoluto, já expandido. */
  readonly workspace: string
  /** O declarado, só na forma `repo`; `null` na forma `repos`. Use `checkoutPrincipalDe`. */
  readonly checkoutPrincipal: string | null
  readonly pastaDoEstado: string
  /** Caminhos absolutos, já expandidos, na ordem do arquivo. */
  readonly proibidos: ProibidosDoBoard
  readonly mandato: OrigemDoMandato | null
}
export type BoardDeUmRepo = BoardDaFabrica & { readonly repoUnico: RepoDoBoard }
export type BoardComMandato = BoardDaFabrica & { readonly mandato: OrigemDoMandato }
export interface ConfiguracaoDaFabrica {
  readonly padrao: string
  readonly boards: readonly BoardDaFabrica[]
}

const RE_OWNER = /^[A-Za-z0-9-]+$/
const RE_OWNER_CURINGA = /^([A-Za-z0-9-]+)\/\*$/
const RE_REPO = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/
const RE_REF = /^[A-Za-z0-9._/-]+$/
const RE_CAMINHO_NO_REPO = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

export function nomeDoRepo(r: RepoDoBoard): string {
  return `${r.owner}/${r.name}`
}

export function motivoSemMandato(b: Pick<BoardDaFabrica, 'chave' | 'nome'>): string {
  return `o board ${b.chave} (${b.nome}) não tem mandato aprovado: falta o campo mandato em ${ARQUIVO_DA_CONFIGURACAO}`
}

function ilegivel(onde: string): Error {
  return new Error(`${ARQUIVO_DA_CONFIGURACAO} ilegível: ${onde}`)
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function textoNaoVazio(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/** `~` → home, `~/x` → home/x, `/x/` → `/x`; qualquer outro formato é inválido (`null`). */
function expandir(v: unknown, home: string): string | null {
  if (typeof v !== 'string') return null
  if (v === '~') return home
  if (v.startsWith('~/')) return join(home, v.slice(2))
  if (v.startsWith('/')) {
    const n = normalize(v)
    return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n
  }
  return null
}

/** `RE_REPO` em texto → repo; outra coisa → null. */
export function lerRepo(v: unknown): RepoDoBoard | null {
  if (typeof v !== 'string') return null
  const m = RE_REPO.exec(v)
  return m ? { owner: m[1]!, name: m[2]! } : null
}

export function mesmoRepo(a: RepoDoBoard, b: RepoDoBoard): boolean {
  return a.owner === b.owner && a.name === b.name
}

/** O declarado, se `r` é o repo único e há declarado; senão `join(workspace, r.name)` (posix). */
export function checkoutPrincipalDe(
  b: Pick<BoardDaFabrica, 'workspace' | 'checkoutPrincipal' | 'repoUnico'>,
  r: RepoDoBoard,
): string {
  if (b.repoUnico !== null && b.checkoutPrincipal !== null && mesmoRepo(b.repoUnico, r)) {
    return b.checkoutPrincipal
  }
  return join(b.workspace, r.name)
}

/** Lista: os `owner/name` juntos por ', '. Owner: `qualquer repo de <owner>`. */
export function descreverRepos(r: ReposDoBoard): string {
  return r.tipo === 'lista' ? r.repos.map(nomeDoRepo).join(', ') : `qualquer repo de ${r.owner}`
}

const RE_NOME_DE_REPO = /^[A-Za-z0-9._-]+$/

/**
 * O repo do board com esse nome. Lista: com `owner === null`, o item de mesmo `name`; com owner, o item de
 * mesmo owner e name. Forma owner: `name` casa `[A-Za-z0-9._-]+` e não é `.` nem `..`, e `owner === null`
 * ou `owner === b.repos.owner` → `{ owner: b.repos.owner, name }`. Senão `null`. Comparação exata.
 */
export function repoDoBoard(
  b: Pick<BoardDaFabrica, 'repos'>,
  owner: string | null,
  name: string,
): RepoDoBoard | null {
  if (b.repos.tipo === 'lista') {
    return (
      b.repos.repos.find((r) => r.name === name && (owner === null || r.owner === owner)) ?? null
    )
  }
  if (!RE_NOME_DE_REPO.test(name) || name === '.' || name === '..') return null
  if (owner !== null && owner !== b.repos.owner) return null
  return { owner: b.repos.owner, name }
}

function lerMandato(v: unknown, onde: string): OrigemDoMandato | null {
  if (v === undefined || v === null) return null
  if (!ehObjeto(v)) throw ilegivel(onde)
  const repo = lerRepo(v.repo)
  if (!repo) throw ilegivel(`${onde}.repo`)
  if (typeof v.ref !== 'string' || !RE_REF.test(v.ref)) throw ilegivel(`${onde}.ref`)
  if (
    typeof v.caminho !== 'string' ||
    !RE_CAMINHO_NO_REPO.test(v.caminho) ||
    v.caminho.split('/').includes('..')
  ) {
    throw ilegivel(`${onde}.caminho`)
  }
  if (!textoNaoVazio(v.aprovacao)) throw ilegivel(`${onde}.aprovacao`)
  return { repo, ref: v.ref, caminho: v.caminho, aprovacao: v.aprovacao }
}

function lerBoard(item: unknown, i: number, home: string): BoardDaFabrica {
  const onde = `boards[${i}]`
  if (!ehObjeto(item)) throw ilegivel(onde)
  if (typeof item.owner !== 'string' || !RE_OWNER.test(item.owner)) throw ilegivel(`${onde}.owner`)
  if (!Number.isSafeInteger(item.projeto) || (item.projeto as number) <= 0) {
    throw ilegivel(`${onde}.projeto`)
  }
  if (!textoNaoVazio(item.nome)) throw ilegivel(`${onde}.nome`)
  if (item.repo !== undefined && item.repos !== undefined) {
    throw ilegivel(`${onde}: use repo ou repos, não os dois`)
  }
  if (item.repo === undefined && item.repos === undefined) throw ilegivel(`${onde}.repo`)
  let repos: ReposDoBoard
  let repoUnico: RepoDoBoard | null
  if (item.repo !== undefined) {
    const repo = lerRepo(item.repo)
    if (!repo) throw ilegivel(`${onde}.repo`)
    repos = { tipo: 'lista', repos: [repo] }
    repoUnico = repo
  } else if (typeof item.repos === 'string') {
    const m = RE_OWNER_CURINGA.exec(item.repos)
    if (!m) throw ilegivel(`${onde}.repos`)
    repos = { tipo: 'owner', owner: m[1]! }
    repoUnico = null
  } else {
    if (!Array.isArray(item.repos) || item.repos.length === 0) throw ilegivel(`${onde}.repos`)
    const lista: RepoDoBoard[] = item.repos.map((x: unknown, j: number) => {
      const r = lerRepo(x)
      if (!r) throw ilegivel(`${onde}.repos[${j}]`)
      return r
    })
    const nomes = new Set<string>()
    lista.forEach((r, j) => {
      if (nomes.has(r.name)) throw ilegivel(`${onde}.repos[${j}]: nome repetido ${r.name}`)
      nomes.add(r.name)
    })
    repos = { tipo: 'lista', repos: lista }
    repoUnico = lista.length === 1 ? lista[0]! : null
  }
  const workspace = expandir(item.workspace, home)
  if (workspace === null) throw ilegivel(`${onde}.workspace`)
  let checkoutPrincipal: string | null = null
  if (item.repo !== undefined) {
    checkoutPrincipal = expandir(item.checkoutPrincipal, home)
    if (checkoutPrincipal === null) throw ilegivel(`${onde}.checkoutPrincipal`)
  } else if (item.checkoutPrincipal !== undefined) {
    throw ilegivel(`${onde}.checkoutPrincipal: só vale com repo`)
  }
  if (item.repo === undefined) {
    if (repos.tipo === 'owner') {
      if (repos.owner !== item.owner) throw ilegivel(`${onde}.repos: owner diferente do board`)
    } else {
      repos.repos.forEach((r, j) => {
        if (r.owner !== item.owner) throw ilegivel(`${onde}.repos[${j}]: owner diferente do board`)
        if (r.name === '.' || r.name === '..') throw ilegivel(`${onde}.repos[${j}]`)
        const outro = repos.repos.find((o) => o !== r && r.name.startsWith(`${o.name}-`))
        if (outro) throw ilegivel(`${onde}.repos[${j}]: nome começa com ${outro.name}-`)
      })
    }
  }
  const pastaDoEstado = expandir(item.pastaDoEstado, home)
  if (pastaDoEstado === null) throw ilegivel(`${onde}.pastaDoEstado`)

  const pr = item.proibidos
  if (!ehObjeto(pr) || !Array.isArray(pr.caminhos)) throw ilegivel(`${onde}.proibidos`)
  const caminhos = pr.caminhos.map((c, j) => {
    const e = expandir(c, home)
    if (e === null) throw ilegivel(`${onde}.proibidos.caminhos[${j}]`)
    return e
  })
  if (!textoNaoVazio(pr.motivo)) throw ilegivel(`${onde}.proibidos.motivo`)

  const mandato = lerMandato(item.mandato, `${onde}.mandato`)
  const projeto = item.projeto as number
  return {
    chave: `${item.owner}/${projeto}`,
    owner: item.owner,
    projeto,
    nome: item.nome,
    repos,
    repoUnico,
    workspace,
    checkoutPrincipal,
    pastaDoEstado,
    proibidos: { caminhos, motivo: pr.motivo },
    mandato,
  }
}

export function parseConfiguracao(bruto: unknown, home: string): ConfiguracaoDaFabrica {
  if (!ehObjeto(bruto)) throw ilegivel('não é um objeto')
  if (bruto.versao !== 1) throw ilegivel('versao')
  if (!Array.isArray(bruto.boards) || bruto.boards.length === 0) throw ilegivel('boards')
  const boards: BoardDaFabrica[] = []
  const chaves = new Set<string>()
  const pastas = new Set<string>()
  bruto.boards.forEach((item: unknown, i: number) => {
    const b = lerBoard(item, i, home)
    if (chaves.has(b.chave)) throw ilegivel(`boards[${i}]: chave repetida ${b.chave}`)
    if (pastas.has(b.pastaDoEstado)) throw ilegivel(`boards[${i}].pastaDoEstado: repetida`)
    chaves.add(b.chave)
    pastas.add(b.pastaDoEstado)
    boards.push(b)
  })
  if (typeof bruto.padrao !== 'string' || !chaves.has(bruto.padrao)) throw ilegivel('padrao')
  if (boards.find((b) => b.chave === bruto.padrao)!.repoUnico === null) {
    throw ilegivel('padrao: o board padrão atende um repo só')
  }
  return { padrao: bruto.padrao, boards }
}

export function boardPadrao(c: ConfiguracaoDaFabrica): BoardDeUmRepo {
  const b = c.boards.find((x) => x.chave === c.padrao)
  if (!b || b.repoUnico === null) throw ilegivel('padrao')
  return b as BoardDeUmRepo
}

export function resolverBoard(
  c: ConfiguracaoDaFabrica,
  chave: string | null,
): { ok: true; board: BoardComMandato } | { ok: false; motivo: string } {
  const k = chave ?? c.padrao
  const board = c.boards.find((x) => x.chave === k)
  if (!board) {
    return {
      ok: false,
      motivo: `o board ${k} não está configurado em ${ARQUIVO_DA_CONFIGURACAO}: falta a entrada dele (repo, workspace, pasta de estado e mandato)`,
    }
  }
  if (board.mandato === null) return { ok: false, motivo: motivoSemMandato(board) }
  return { ok: true, board: { ...board, mandato: board.mandato } }
}
