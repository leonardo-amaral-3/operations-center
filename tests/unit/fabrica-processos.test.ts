import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acharDespacho,
  contarSessoesDaProva,
  despachoVivo,
  ehSessao,
} from '../../src/main/fabrica/processos'

const filhos: ChildProcess[] = []

/** O `; true` impede o bash de virar o `sleep` por `exec`, e o `-p` fica no `cmdline`. */
function lancar(args: string[], env: NodeJS.ProcessEnv = {}): ChildProcess {
  const f = spawn('bash', ['-c', 'sleep 5; true', ...args], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  })
  filhos.push(f)
  return f
}

function encerrar(f: ChildProcess): Promise<void> {
  return new Promise((ok) => {
    if (f.exitCode !== null || f.signalCode !== null) return ok()
    f.once('exit', () => ok())
    f.kill('SIGKILL')
  })
}

afterEach(async () => {
  await Promise.all(filhos.splice(0).map(encerrar))
})

describe.skipIf(process.platform !== 'linux')('processos da fábrica', { timeout: 20_000 }, () => {
  it('contarSessoesDaProva conta -p com a marca e ignora o que não tem -p', () => {
    const marca = `MANDATO DE TESTE ${randomUUID()}`
    expect(contarSessoesDaProva(marca)).toBe(0)
    lancar(['-p', marca])
    lancar(['--print', marca])
    lancar(['x', marca])
    lancar(['-p', 'outra coisa'])
    expect(contarSessoesDaProva(marca)).toBe(2)
  })

  it('ehSessao exige -p ou --print no argv', () => {
    const a = lancar(['-p'])
    const b = lancar(['x'])
    expect(ehSessao(a.pid as number)).toBe(true)
    expect(ehSessao(b.pid as number)).toBe(false)
    expect(ehSessao(process.pid)).toBe(false)
  })

  it('despachoVivo: marca exata no ambiente e -p; morto depois do kill', async () => {
    const f = lancar(['-p'], { OC_FABRICA_DESPACHO: 'u/d-9' })
    const pid = f.pid as number
    expect(despachoVivo(pid, 'u/d-9')).toBe(true)
    expect(despachoVivo(pid, 'u/d-8')).toBe(false)
    expect(despachoVivo(pid, 'v/d-9')).toBe(false)
    await encerrar(f)
    expect(despachoVivo(pid, 'u/d-9')).toBe(false)
  })

  it('acharDespacho devolve a sessão e não o filho que herdou a marca', async () => {
    const marca = `u/${randomUUID()}`
    const f = lancar(['-p'], { OC_FABRICA_DESPACHO: marca })
    // o filho `sleep` herda a marca mas não tem -p; espera o bash ter lançado o filho
    await new Promise((ok) => setTimeout(ok, 300))
    expect(acharDespacho(marca)).toBe(f.pid)
    expect(acharDespacho(`u/${randomUUID()}`)).toBeNull()
  })
})
