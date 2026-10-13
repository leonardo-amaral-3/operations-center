import { capDiff } from '../session/transcript'
import type { DiffLine, FileDiff } from '../session/types'

const CABECALHO = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Traduz o `patch` que a REST do GitHub devolve num `FileDiff`, o mesmo desenho que o chat usa.
 *
 * A contagem do cabeçalho `@@` é opcional, porque o GitHub emite `@@ -1 +1 @@` e `@@ -0,0 +1 @@`.
 * O número de linha de um `remove` é o velho e o de `add` e `context` é o novo. Sobram de fora, em
 * silêncio, o que não é linha de patch: `\ No newline at end of file`, o que vem antes do primeiro
 * `@@` e qualquer linha que não comece por `+`, `-` ou espaço.
 *
 * `additions`/`deletions` são os da REST, o total do arquivo: o corte no teto não pode encolhê-los.
 */
export function parsePatch(patch: string, additions: number, deletions: number): FileDiff {
  const linhas = patch.split(/\r?\n/)
  // O `\n` final fecha a última linha em vez de abrir uma vazia.
  if (linhas.at(-1) === '') linhas.pop()

  const trechos: DiffLine[][] = []
  let atual: DiffLine[] | null = null
  let velho = 0
  let novo = 0

  for (const linha of linhas) {
    const cabecalho = CABECALHO.exec(linha)
    if (cabecalho) {
      atual = []
      trechos.push(atual)
      velho = Number(cabecalho[1])
      novo = Number(cabecalho[2])
      continue
    }
    if (atual === null) continue

    const text = linha.slice(1)
    if (linha.startsWith('+')) {
      atual.push({ kind: 'add', number: novo, text })
      novo += 1
    } else if (linha.startsWith('-')) {
      atual.push({ kind: 'remove', number: velho, text })
      velho += 1
    } else if (linha.startsWith(' ')) {
      atual.push({ kind: 'context', number: novo, text })
      novo += 1
      velho += 1
    }
  }

  return capDiff(trechos, additions, deletions)
}
