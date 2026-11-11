// O comando `yarn relatorio` (#120, spec-p1 §8): o relatório de um dia da fábrica, em markdown no
// stdout, a partir do cofre de decisões, do board e do git. Só lê.
//
// Roda pelo `yarn -s relatorio [AAAA-MM-DD] [--cofre <pasta>]` (o `-s` tira as linhas do próprio
// yarn do stdout). Compila `src/main/relatorio/cli.ts` para um módulo CommonJS temporário dentro do
// repo (para resolver `node_modules`), chama o `main()` e apaga a pasta temporária no fim.

import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const pasta = mkdtempSync(join(raiz, 'node_modules', '.oc-relatorio-'))

try {
  const saida = join(pasta, 'cli.cjs')
  buildSync({
    entryPoints: [join(raiz, 'src', 'main', 'relatorio', 'cli.ts')],
    outfile: saida,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    absWorkingDir: raiz,
  })
  const { main } = await import(pathToFileURL(saida).href)
  await main()
} finally {
  rmSync(pasta, { recursive: true, force: true })
}
