import type { Commit, Janela } from './tipos'

/** Os argumentos do `git log` do dia (#120, spec-p1 §5). Quem roda o `git` é o `main()` do CLI. */
export function argsDoGitLog(janela: Janela): string[] {
  return [
    'log',
    '--branches',
    '--remotes',
    `--since=${janela.inicio}`,
    `--until=${janela.fim}`,
    '--format=%H%x1f%cI%x1f%s%x1f%b%x1e',
  ]
}

const TRAILER = /^Card:\s*#(\d+)\s*$/m
const MERGE_DE_PR = /^Merge pull request #\d+ from [^/\s]+\/(?:feat|fix)\/(\d+)-/
const MERGE_DE_BRANCH = /^Merge (?:remote-tracking )?branch '(?:origin\/)?(?:feat|fix)\/(\d+)-/
const MERGE_PARA_BRANCH = / into (?:feat|fix)\/(\d+)-/

/** O card do commit: trailer no corpo e depois três formas de merge no assunto (spec-p1 §5). */
function cardDoCommit(assunto: string, corpo: string): number | null {
  const achado =
    TRAILER.exec(corpo)?.[1] ??
    MERGE_DE_PR.exec(assunto)?.[1] ??
    MERGE_DE_BRANCH.exec(assunto)?.[1] ??
    MERGE_PARA_BRANCH.exec(assunto)?.[1]

  return achado === undefined ? null : Number(achado)
}

/**
 * Lê o stdout do `git log` e fica com os commits da janela, meio-aberta `[inicio, fim)`. O `--until`
 * do git é inclusivo e o `%cI` vem com o fuso local, então o corte é por instante (`Date.parse`).
 * Commit de `sha` vazio passa adiante: o corte sem fonte é da montagem (§7).
 */
export function lerCommits(stdout: string, janela: Janela): Commit[] {
  const inicio = Date.parse(janela.inicio)
  const fim = Date.parse(janela.fim)
  const vistos = new Set<string>()
  const commits: Commit[] = []

  for (const pedaco of stdout.split('\x1e')) {
    const limpo = pedaco.trim()

    if (limpo === '') continue

    const [sha = '', em = '', assunto = '', ...resto] = limpo.split('\x1f')
    const corpo = resto.join('\x1f')
    const instante = Date.parse(em.trim())

    if (!(instante >= inicio && instante < fim)) continue

    const shaLimpo = sha.trim()

    if (shaLimpo !== '') {
      if (vistos.has(shaLimpo)) continue

      vistos.add(shaLimpo)
    }

    const assuntoLimpo = assunto.trim()

    commits.push({
      sha: shaLimpo,
      em: em.trim(),
      assunto: assuntoLimpo,
      card: cardDoCommit(assuntoLimpo, corpo),
    })
  }

  return commits
}
