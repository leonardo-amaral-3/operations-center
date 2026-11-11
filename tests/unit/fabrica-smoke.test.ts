import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * O cadeado da suíte (#121, spec-p2 §11), CA-2.1 "suíte". Só no Linux: o `flock` é do util-linux.
 * O cadeado do teste vive em `node_modules/.oc-fabrica-teste-*` (nunca em `/tmp`) e entra por
 * `OC_SMOKE_CADEADO`, para o teste não tocar o cadeado real da máquina. O comando é o `--list` do
 * Playwright, que não sobe Electron (N13).
 */
const raiz = fileURLToPath(new URL('../../', import.meta.url))
const script = join(raiz, 'scripts', 'smoke.mjs')
const spec = 'tests/smoke/tema.smoke.spec.ts'

const pastas: string[] = []
afterEach(() => {
  while (pastas.length > 0) rmSync(pastas.pop() as string, { recursive: true, force: true })
})

function pastaDeTeste(): string {
  const base = join(raiz, 'node_modules')
  mkdirSync(base, { recursive: true })
  const pasta = mkdtempSync(join(base, '.oc-fabrica-teste-'))
  pastas.push(pasta)
  return pasta
}

/** `spawnSync` bloquearia o event loop, e o `flock` do teste precisa continuar vivo: por isso `spawn`. */
function rodarSmoke(
  cadeado: string,
): Promise<{ status: number | null; stderr: string; ms: number }> {
  return new Promise((resolver, rejeitar) => {
    const inicio = Date.now()
    const filho = spawn(process.execPath, [script, '--list', spec], {
      cwd: raiz,
      env: { ...process.env, OC_SMOKE_CADEADO: cadeado },
    })
    let stderr = ''
    filho.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    filho.on('error', rejeitar)
    filho.on('close', (status) => resolver({ status, stderr, ms: Date.now() - inicio }))
  })
}

describe.skipIf(process.platform !== 'linux')('scripts/smoke.mjs', () => {
  it('com o cadeado tomado, avisa, espera e sai 0 depois que ele solta', async () => {
    const cadeado = join(pastaDeTeste(), 's.lock')
    const segurando = spawn('flock', [cadeado, 'sleep', '2'], { stdio: 'ignore' })
    // dá tempo de o flock do teste tomar o cadeado antes do script tentar
    await new Promise((r) => setTimeout(r, 400))
    try {
      const r = await rodarSmoke(cadeado)
      expect(r.stderr).toContain('outra suíte está rodando')
      expect(r.status).toBe(0)
      expect(r.ms).toBeGreaterThanOrEqual(1500)
    } finally {
      segurando.kill()
    }
  }, 20_000)

  it('sem o cadeado tomado, sai 0 sem o aviso', async () => {
    const cadeado = join(pastaDeTeste(), 's.lock')
    const r = await rodarSmoke(cadeado)
    expect(r.stderr).not.toContain('outra suíte está rodando')
    expect(r.status).toBe(0)
  }, 20_000)

  it('o flock existe na máquina (sem ele o script recusa rodar)', () => {
    expect(spawnSync('flock', ['--version']).error).toBeUndefined()
  })
})
