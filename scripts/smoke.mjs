// A suíte de smoke com cadeado (#121, spec-p2 §11).
//
// Roda o Playwright pelo CLI dele, com o Node e sem shell. No Linux, uma `flock` da máquina inteira
// garante que duas suítes nunca rodem juntas: as sessões da fábrica e o Leonardo disputam o mesmo
// Electron, a mesma cota e as mesmas portas, e duas suítes ao mesmo tempo dão falha que não é do código
// (N7, N8). Fora do Linux o comportamento é o de sempre, sem cadeado.
//
// Uso: `node scripts/smoke.mjs [args do playwright test]`. O build (`electron-vite build`) fica fora do
// cadeado, porque cada worktree compila no seu `out/`; o que não pode correr junto é a suíte. Quem
// chama `npx playwright test` direto passa por fora do cadeado; o README manda usar `yarn smoke`.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const cmd = [
  process.execPath,
  join(raiz, 'node_modules', '@playwright', 'test', 'cli.js'),
  'test',
  ...process.argv.slice(2),
]

/** Saída do `flock -n -E` quando o cadeado está tomado; escolhida para não colidir com a do Playwright. */
const CADEADO_TOMADO = 75

/** Caminho do cadeado: não depende de `TMPDIR` nem de `XDG_RUNTIME_DIR`, para todas as sessões chegarem ao mesmo arquivo (N8). */
function caminhoDoCadeado() {
  const dePorta = process.env.OC_SMOKE_CADEADO
  if (dePorta) return dePorta
  const { uid } = userInfo()
  const runtime = `/run/user/${uid}`
  return existsSync(runtime)
    ? join(runtime, 'operations-center-smoke.lock')
    : `/tmp/operations-center-smoke-${uid}.lock`
}

function rodar() {
  if (process.platform !== 'linux') {
    const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' })
    return r.status ?? 1
  }

  const cadeado = caminhoDoCadeado()
  // `-o`: o cadeado some com o Playwright, mesmo que um Electron ou shell órfão continue vivo (N7).
  const primeira = spawnSync('flock', ['-o', '-n', '-E', String(CADEADO_TOMADO), cadeado, ...cmd], {
    stdio: 'inherit',
  })
  if (primeira.error) {
    console.error(
      'yarn smoke: o flock (util-linux) não foi encontrado; sem ele duas suítes rodariam juntas',
    )
    return 1
  }
  if (primeira.status !== CADEADO_TOMADO) return primeira.status ?? 1

  console.error(`yarn smoke: outra suíte está rodando (${cadeado}); esperando ela terminar`)
  const segunda = spawnSync('flock', ['-o', cadeado, ...cmd], { stdio: 'inherit' })
  return segunda.status ?? 1
}

process.exit(rodar())
