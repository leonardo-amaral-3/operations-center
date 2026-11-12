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
 * `null`. Um `flock` rodado em `<worktree-131>/test-results/operations-center-777-smoke` é do 777.
 */
export function cardDaCwd(cwd: string, nomeDoRepo: string): number | null {
  const padrao = new RegExp(`/${escaparRegex(nomeDoRepo)}-(\\d+)-`, 'g')
  let card: number | null = null
  for (const achou of `${cwd}/`.matchAll(padrao)) card = Number(achou[1])
  return card
}
