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
export interface BoardDaFabrica {
  /** `${owner}/${projeto}` */
  readonly chave: string
  readonly owner: string
  readonly projeto: number
  readonly nome: string
  readonly repo: RepoDoBoard
  /** Absoluto, já expandido. */
  readonly workspace: string
  readonly checkoutPrincipal: string
  readonly pastaDoEstado: string
  /** Caminhos absolutos, já expandidos, na ordem do arquivo. */
  readonly proibidos: ProibidosDoBoard
  readonly mandato: OrigemDoMandato | null
}
export type BoardComMandato = BoardDaFabrica & { readonly mandato: OrigemDoMandato }
export interface ConfiguracaoDaFabrica {
  readonly padrao: string
  readonly boards: readonly BoardDaFabrica[]
}

const RE_OWNER = /^[A-Za-z0-9-]+$/
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

function lerRepo(v: unknown): RepoDoBoard | null {
  if (typeof v !== 'string') return null
  const m = RE_REPO.exec(v)
  return m ? { owner: m[1]!, name: m[2]! } : null
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
  const repo = lerRepo(item.repo)
  if (!repo) throw ilegivel(`${onde}.repo`)
  const workspace = expandir(item.workspace, home)
  if (workspace === null) throw ilegivel(`${onde}.workspace`)
  const checkoutPrincipal = expandir(item.checkoutPrincipal, home)
  if (checkoutPrincipal === null) throw ilegivel(`${onde}.checkoutPrincipal`)
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
    repo,
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
  return { padrao: bruto.padrao, boards }
}

export function boardPadrao(c: ConfiguracaoDaFabrica): BoardDaFabrica {
  const b = c.boards.find((x) => x.chave === c.padrao)
  if (!b) throw ilegivel('padrao')
  return b
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
