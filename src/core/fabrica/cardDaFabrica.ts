import {
  descreverRepos,
  lerRepo,
  mesmoRepo,
  nomeDoRepo,
  repoDoBoard,
  type BoardDaFabrica,
  type RepoDoBoard,
} from './configuracao'

/**
 * O card de um repo (#152): a frente da fábrica deixa de ser um número e passa a ser `repo` + `n`.
 * Puro; importa só de `./configuracao`.
 */

export interface CardDaFabrica {
  readonly repo: RepoDoBoard
  readonly n: number
}
export interface AlvoDoIniciar {
  readonly owner: string | null
  readonly name: string | null
  readonly n: number
}

const RE_ALVO = /^(?:(?:([A-Za-z0-9-]+)\/)?([A-Za-z0-9._-]+)#)?([1-9]\d*)$/

/** `<n>`, `<name>#<n>` ou `<owner>/<name>#<n>`, n ≥ 1 sem zero à esquerda; `name` `.` ou `..` e outra forma → null. */
export function lerAlvo(texto: string): AlvoDoIniciar | null {
  const m = RE_ALVO.exec(texto)
  if (m === null) return null
  const name = m[2] ?? null
  if (name === '.' || name === '..') return null
  return { owner: m[1] ?? null, name, n: Number(m[3]) }
}

export function resolverAlvo(
  b: Pick<BoardDaFabrica, 'chave' | 'nome' | 'repos' | 'repoUnico'>,
  a: AlvoDoIniciar,
): { ok: true; card: CardDaFabrica } | { ok: false; motivo: string } {
  if (a.name === null) {
    if (b.repoUnico !== null) return { ok: true, card: { repo: b.repoUnico, n: a.n } }
    return {
      ok: false,
      motivo: `o board ${b.chave} (${b.nome}) atende vários repos: diga o repo do card, iniciar <repo>#${a.n}`,
    }
  }
  const repo = repoDoBoard(b, a.owner, a.name)
  if (repo === null) {
    const citado = a.owner === null ? a.name : `${a.owner}/${a.name}`
    return {
      ok: false,
      motivo: `o repo ${citado} não é do board ${b.chave} (${b.nome}), que atende ${descreverRepos(b.repos)}`,
    }
  }
  return { ok: true, card: { repo, n: a.n } }
}

/**
 * O repo de um registro do `estado.json`: o gravado, ou o único do board (registro de antes do #152).
 * Sem `repo` e sem repo único: lança; `repo` que não casa `RE_REPO`: lança.
 */
export function repoDoRegistro(
  r: { readonly id: string; readonly repo?: unknown },
  unico: RepoDoBoard | null,
): RepoDoBoard {
  if (r.repo === undefined) {
    if (unico !== null) return unico
    throw new Error(`estado.json ilegível: o ${r.id} não diz o repo, e o board atende vários repos`)
  }
  const repo = lerRepo(r.repo)
  if (repo === null) {
    throw new Error(
      `estado.json ilegível: o ${r.id} tem repo inválido: ${typeof r.repo === 'string' ? r.repo : JSON.stringify(r.repo)}`,
    )
  }
  return repo
}

export function cardDoRegistro(
  r: { readonly id: string; readonly repo?: unknown; readonly card: number },
  unico: RepoDoBoard | null,
): CardDaFabrica {
  return { repo: repoDoRegistro(r, unico), n: r.card }
}

export function mesmoCard(a: CardDaFabrica, b: CardDaFabrica): boolean {
  return mesmoRepo(a.repo, b.repo) && a.n === b.n
}

/** `#<n>` quando o board tem repo único (o texto de hoje); `<owner>/<name>#<n>` quando não tem. */
export function rotuloDoCard(c: CardDaFabrica, unico: RepoDoBoard | null): string {
  return unico !== null ? `#${c.n}` : `${nomeDoRepo(c.repo)}#${c.n}`
}

/** A linha que nomeia o repo no argumento do despacho; só se usa em board sem repo único. */
export function linhaDoRepo(c: CardDaFabrica): string {
  return `- Repo do card: ${nomeDoRepo(c.repo)}. Este board atende vários repos: o #${c.n} e todo card citado sem repo neste despacho são desse repo.`
}

/** Aceita só o repo dado: `name` ou `owner/name`. */
export function aceitaORepo(r: RepoDoBoard): (citado: string) => boolean {
  return (citado) => citado === r.name || citado === nomeDoRepo(r)
}

/** Aceita os repos do board: `citado` vira `(owner|null, name)` pelo último `/` e vai a `repoDoBoard`. */
export function aceitaOBoard(b: Pick<BoardDaFabrica, 'repos'>): (citado: string) => boolean {
  return (citado) => {
    const i = citado.lastIndexOf('/')
    const owner = i < 0 ? null : citado.slice(0, i)
    const name = i < 0 ? citado : citado.slice(i + 1)
    return repoDoBoard(b, owner, name) !== null
  }
}

/**
 * O primeiro repo citado junto a um card que `aceita` recusa, ou `null`.
 * Pega as duas formas que a `/gm-*` usa: `<repo>#n` (`claude-brain#43`,
 * `leonardo-amaral-3/claude-brain#43`) e `#n (<repo>)`. O `#n` sozinho é do repo do despacho; o
 * parêntese só conta quando parece um repo (tem `-` ou `/`), para `#12 (comentado)` não virar repo.
 */
export function repoDeOutroCard(texto: string, aceita: (citado: string) => boolean): string | null {
  const candidatos = [
    ...Array.from(texto.matchAll(/((?:[\w.-]+\/)?[\w.-]+)#\d+/g), (m) => m[1] ?? ''),
    ...Array.from(
      texto.matchAll(/#\d+\s*\(\s*((?:[\w.-]+\/)?[\w.-]*-[\w.-]*|[\w.-]+\/[\w.-]+)\s*\)/g),
      (m) => m[1] ?? '',
    ),
  ]
  return candidatos.find((r) => r !== '' && !aceita(r)) ?? null
}
