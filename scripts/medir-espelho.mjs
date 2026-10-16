// Mede o custo do espelho de tela (#100 §3.1 item 5): `ScreenMirror.write` é chamado a cada chunk do
// pty, no processo main, e delega ao `term.write` do xterm headless, que parseia no event loop.
//
// Não é teste e não roda na CI: é uma medição pontual, rodada à mão (`node scripts/medir-espelho.mjs`),
// cuja saída vai para a PR. Alimenta o espelho com saída parecida com a de uma TUI do Claude (linhas
// coloridas, quebras, redesenho com cursor) em chunks do tamanho de leitura de um pty, e mede:
//   - o volume e o tempo total de parse;
//   - o pior atraso do event loop (um timer de 5 ms que deveria disparar sempre no prazo);
//   - o `snapshot()` com a rolagem cheia: tempo e tamanho do que seria serializado.
//
// Argumentos opcionais: `--mb=N` (volume, padrão 20), `--chunk=N` (bytes por chunk, padrão 4096).

import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const arg = (nome, padrao) => {
  const achado = process.argv.find((a) => a.startsWith(`--${nome}=`))
  return achado ? Number(achado.split('=')[1]) : padrao
}
const MB = arg('mb', 20)
const CHUNK = arg('chunk', 4096)
const COLS = 120
const ROWS = 40

// Compila o `ScreenMirror` (TypeScript, com imports sem extensão) para um módulo CommonJS temporário (os pacotes @xterm são CJS).
const raiz = fileURLToPath(new URL('..', import.meta.url))
// Dentro do repo, e não no %TEMP%: o módulo compilado precisa resolver `@xterm/*` por node_modules.
const pasta = mkdtempSync(join(raiz, 'node_modules', '.oc-espelho-'))
const saida = join(pasta, 'ScreenMirror.cjs')
buildSync({
  entryPoints: [join(raiz, 'src', 'core', 'terminal', 'ScreenMirror.ts')],
  outfile: saida,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  absWorkingDir: raiz,
})
const { ScreenMirror } = await import(pathToFileURL(saida).href)

// A saída sintética: ~80% texto corrido colorido, ~20% redesenho de rodapé (cursor + limpar linha).
let n = 0
const linha = () => {
  n += 1
  const cor = 31 + (n % 7)
  const corpo =
    `linha ${n} de saída do assistente com texto suficiente para quebrar e colorir `.repeat(2)
  if (n % 5 === 0) return `\x1b[${ROWS};1H\x1b[2K\x1b[2m> ${corpo.slice(0, 80)}\x1b[0m\r\n`
  return `\x1b[${cor}m${corpo}\x1b[0m\r\n`
}
const gerar = () => {
  let texto = ''
  while (texto.length < CHUNK) texto += linha()
  return texto.slice(0, CHUNK)
}

const espelho = new ScreenMirror(COLS, ROWS)
const total = Math.ceil((MB * 1024 * 1024) / CHUNK)

// O monitor do event loop: um timer de 5 ms; o atraso é quanto passou além disso.
let pior = 0
let ultimo = performance.now()
const monitor = setInterval(() => {
  const agora = performance.now()
  pior = Math.max(pior, agora - ultimo - 5)
  ultimo = agora
}, 5)

// O chunk chega por um `setImmediate`, como chega do pty: o event loop respira entre um e outro.
const inicio = performance.now()
let piorWrite = 0
await new Promise((resolve) => {
  let enviados = 0
  const proximo = () => {
    const t = performance.now()
    espelho.write(gerar())
    piorWrite = Math.max(piorWrite, performance.now() - t)
    enviados += 1
    if (enviados < total) setImmediate(proximo)
    else resolve()
  }
  proximo()
})
const tempoEnvio = performance.now() - inicio

// O `snapshot()` resolve depois que tudo escrito antes foi processado: o tempo dele inclui o
// que o xterm ainda tinha na fila de parse.
const tSnap = performance.now()
const foto = await espelho.snapshot()
const tempoSnapshot = performance.now() - tSnap
const tempoTotal = performance.now() - inicio
clearInterval(monitor)

espelho.dispose()
rmSync(pasta, { recursive: true, force: true })

const fmt = (ms) => `${ms.toFixed(1)} ms`
console.log(`volume:               ${MB} MB em ${total} chunks de ${CHUNK} B (${COLS}x${ROWS})`)
console.log(
  `envio dos chunks:     ${fmt(tempoEnvio)} (${((MB * 1000) / tempoEnvio).toFixed(1)} MB/s)`,
)
console.log(`pior write síncrono:  ${fmt(piorWrite)}`)
console.log(`pior atraso do loop:  ${fmt(pior)}`)
console.log(
  `snapshot() cheio:     ${fmt(tempoSnapshot)}, ${(foto.data.length / 1024).toFixed(0)} KB serializados`,
)
console.log(`tempo total:          ${fmt(tempoTotal)}`)
