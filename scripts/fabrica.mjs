// A ponte do `yarn fabrica` (#121, spec P2 §10): compila o CLI TypeScript com o esbuild, que já está
// na árvore (transitivo do vite, N12), e o roda. Mesma forma do `medir-espelho.mjs` e do
// `relatorio.mjs` da P1.
//
// A pasta do bundle é uma por invocação (`mkdtemp`), para dois `yarn fabrica` ao mesmo tempo não
// escreverem o mesmo arquivo (R-20). Fica dentro do repo, e não no %TEMP%, porque o bundle resolve
// os pacotes por `node_modules`. Depois de um `kill -9` a pasta fica para trás, e isso é inofensivo.
//
// Os sinais do sistema são daqui, e não do CLI: viram o `AbortController` que o laço do despachante
// observa. As sessões em voo sobem destacadas e seguem vivas (N6).

import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const pasta = mkdtempSync(join(raiz, 'node_modules', '.oc-fabrica-'))
try {
  const saida = join(pasta, 'cli.cjs')
  buildSync({
    entryPoints: [join(raiz, 'src', 'main', 'fabrica', 'cli.ts')],
    outfile: saida,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    absWorkingDir: raiz,
  })
  process.env.OC_FABRICA_RAIZ = raiz

  const controlador = new globalThis.AbortController()
  const abortar = () => {
    process.stderr.write('fabrica: as sessões em voo seguem rodando; religue com yarn fabrica\n')
    controlador.abort()
  }
  process.once('SIGINT', abortar)
  process.once('SIGTERM', abortar)

  const { main } = await import(pathToFileURL(saida).href)
  process.exitCode = await main(controlador.signal)
} finally {
  rmSync(pasta, { recursive: true, force: true })
}
