import { escaparRegex } from './mandato'

/**
 * Leituras puras dos recursos da fábrica (F2 §F2.2): o texto do `/proc/locks` e o caminho de uma
 * pasta viram número e card. Quem lê o disco é o main.
 */

/** O mínimo de disco da esteira (CLAUDE.md do workspace, `## Convenções da esteira`). */
export const MINIMO_DE_DISCO = 2 * 1024 ** 3

const LINHA_DE_TRAVA = /^\d+:\s+(->\s+)?FLOCK\s+\S+\s+\S+\s+(\d+)\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s/

/**
 * As linhas de `/proc/locks` do inode pedido: o pid dono (a linha sem `->`) e quantos esperam
 * (`->`). Casa só pelo inode, porque o `maj:min` do `/proc/locks` não bate com o `stat` no btrfs.
 * Linha `POSIX`/`OFDLCK`, de outro inode ou torta é ignorada.
 */
export function lerProcLocks(
  texto: string,
  inode: number,
): { dono: number | null; esperando: number } {
  let dono: number | null = null
  let esperando = 0
  for (const linha of texto.split('\n')) {
    const achou = LINHA_DE_TRAVA.exec(linha)
    if (achou === null || achou[3] !== String(inode)) continue
    if (achou[1] !== undefined) esperando += 1
    else if (dono === null) dono = Number(achou[2])
  }
  return { dono, esperando }
}

/**
 * O card da pasta onde a cwd está: o **último** `/<repo>-<n>-` do caminho (a pasta mais funda), ou
 * `null`. No mesmo ponto do caminho, vence o nome de repo mais longo (`app-2` antes de `app`). O
 * retorno leva o nome que casou. Um `flock` rodado em `<worktree-131>/test-results/operations-center-777-smoke`
 * é do 777.
 */
export function cardDaCwd(
  cwd: string,
  nomes: readonly string[],
): { nome: string; n: number } | null {
  let melhor: { nome: string; n: number; indice: number } | null = null
  for (const nome of nomes) {
    const padrao = new RegExp(`/${escaparRegex(nome)}-(\\d+)-`, 'g')
    for (const achou of `${cwd}/`.matchAll(padrao)) {
      const indice = achou.index ?? 0
      if (
        melhor === null ||
        indice > melhor.indice ||
        (indice === melhor.indice && nome.length > melhor.nome.length)
      )
        melhor = { nome, n: Number(achou[1]), indice }
    }
  }
  return melhor === null ? null : { nome: melhor.nome, n: melhor.n }
}
