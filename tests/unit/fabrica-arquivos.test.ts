import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { entradaVazia, registrarNaEntrada } from '../../src/core/fabrica/entrada'
import { estadoVazio } from '../../src/core/fabrica/estado'
import {
  alterarEstado,
  gravarEstado,
  alterarEntrada,
  identidade,
  lerEntrada,
  lerEstado,
  lerSaida,
  pastaDaFabrica,
  pastaDaSessao,
  recusarTemporaria,
  tomarRodar,
} from '../../src/main/fabrica/arquivos'

const RAIZ = join(__dirname, '..', '..')
let pasta = ''

beforeEach(() => {
  pasta = mkdtempSync(join(RAIZ, 'node_modules', '.oc-fabrica-teste-'))
})
afterEach(() => {
  rmSync(pasta, { recursive: true, force: true })
})

describe('recusarTemporaria e pastaDaFabrica', () => {
  it.each(['/tmp', '/tmp/a', tmpdir(), join(tmpdir(), 'b')])('recusa %s', (p) => {
    expect(() => recusarTemporaria(p)).toThrow('OC_FABRICA_DIR não pode ficar no /tmp')
  })

  it.each(['/home/x/claude/despachos-fabrica', '/tmpx'])('deixa passar %s', (p) => {
    expect(() => recusarTemporaria(p)).not.toThrow()
  })

  it('resolve a pasta pelo ambiente ou pela pasta-mãe do repo', () => {
    expect(pastaDaFabrica({}, '/w/operations-center')).toBe('/w/claude/despachos-fabrica')
    expect(pastaDaFabrica({ OC_FABRICA_DIR: 'rel' }, '/w/operations-center')).toBe(resolve('rel'))
    expect(pastaDaFabrica({ OC_FABRICA_DIR: '' }, '/w/operations-center')).toBe(
      '/w/claude/despachos-fabrica',
    )
  })

  it('nada é escrito numa pasta temporária', async () => {
    const alvo = join(tmpdir(), randomUUID())
    await expect(alterarEstado(alvo, (e) => ({ estado: e, resultado: 1 }))).rejects.toThrow('/tmp')
    expect(existsSync(alvo)).toBe(false)
    expect(() => tomarRodar(alvo)).toThrow('/tmp')
    expect(existsSync(alvo)).toBe(false)
  })
})

describe('estado.json em disco', () => {
  it('grava e lê o mesmo objeto, sem deixar temporário', () => {
    const e = { ...estadoVazio('u-1'), contador: 3 }
    gravarEstado(pasta, e)
    expect(lerEstado(pasta)).toEqual(e)
    expect(readdirSync(pasta).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('sem estado.json devolve null', () => {
    expect(lerEstado(pasta)).toBeNull()
  })

  it('estado ilegível lança e o arquivo continua igual', async () => {
    writeFileSync(join(pasta, 'estado.json'), '{')
    expect(() => lerEstado(pasta)).toThrow('estado.json ilegível')
    await expect(alterarEstado(pasta, (e) => ({ estado: e, resultado: 1 }))).rejects.toThrow(
      'estado.json ilegível',
    )
    expect(readFileSync(join(pasta, 'estado.json'), 'utf8')).toBe('{')
  })

  it('versao 2 lança', () => {
    writeFileSync(join(pasta, 'estado.json'), JSON.stringify({ ...estadoVazio('u'), versao: 2 }))
    expect(() => lerEstado(pasta)).toThrow('versao 2')
  })

  it('lerSaida e pastaDaSessao', () => {
    expect(pastaDaSessao(pasta, 'd-1')).toBe(join(pasta, 'sessoes', 'd-1'))
    expect(lerSaida(pasta, 'd-1')).toBeNull()
    mkdirSync(pastaDaSessao(pasta, 'd-1'), { recursive: true })
    writeFileSync(join(pastaDaSessao(pasta, 'd-1'), 'saida.json'), '')
    expect(lerSaida(pasta, 'd-1')).toBe('')
  })
})

describe.skipIf(process.platform !== 'linux')('cadeados', { timeout: 20_000 }, () => {
  it('cria o estado vazio na primeira alteração e solta o cadeado', async () => {
    const instancia = await alterarEstado(pasta, (e) => ({ estado: e, resultado: e.instancia }))
    expect(instancia).not.toBe('')
    expect(lerEstado(pasta)?.instancia).toBe(instancia)
    expect(existsSync(join(pasta, 'estado.lock'))).toBe(false)
  })

  it('duas alterações concorrentes rodam em série', async () => {
    const soma = (e: ReturnType<typeof estadoVazio>) => ({
      estado: { ...e, contador: e.contador + 1 },
      resultado: e.contador,
    })
    const [a, b] = await Promise.all([alterarEstado(pasta, soma), alterarEstado(pasta, soma)])
    expect([a, b].sort()).toEqual([0, 1])
    expect(lerEstado(pasta)?.contador).toBe(2)
  })

  it('solta o cadeado mesmo quando f lança', async () => {
    await expect(
      alterarEstado(pasta, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(existsSync(join(pasta, 'estado.lock'))).toBe(false)
  })

  it('toma o cadeado de um processo já terminado', async () => {
    const morto = spawnSync('true')
    writeFileSync(join(pasta, 'estado.lock'), `${morto.pid} 1`)
    await expect(alterarEstado(pasta, (e) => ({ estado: e, resultado: 'ok' }))).resolves.toBe('ok')
    expect(readdirSync(pasta).filter((n) => n.includes('.morto.'))).toEqual([])
  })

  it('com dono vivo espera e depois lança "preso pelo processo"', async () => {
    writeFileSync(join(pasta, 'estado.lock'), identidade(process.pid) as string)
    await expect(alterarEstado(pasta, (e) => ({ estado: e, resultado: 1 }), 200)).rejects.toThrow(
      `preso pelo processo ${process.pid}`,
    )
  })

  it('estado.lock vazio conta como vivo', async () => {
    writeFileSync(join(pasta, 'estado.lock'), '')
    await expect(alterarEstado(pasta, (e) => ({ estado: e, resultado: 1 }), 200)).rejects.toThrow(
      'preso pelo processo',
    )
    expect(readFileSync(join(pasta, 'estado.lock'), 'utf8')).toBe('')
  })

  it('tomarRodar: a segunda falha com o pid, e soltar libera', () => {
    const a = tomarRodar(pasta)
    expect(a.ok).toBe(true)
    expect(tomarRodar(pasta)).toEqual({ ok: false, pid: process.pid })
    if (a.ok) a.soltar()
    expect(existsSync(join(pasta, 'rodar.pid'))).toBe(false)
    const c = tomarRodar(pasta)
    expect(c.ok).toBe(true)
    if (c.ok) c.soltar()
  })

  it('rodar.pid com o pid do teste e outro starttime é pid reciclado', () => {
    writeFileSync(join(pasta, 'rodar.pid'), `${process.pid} 1`)
    const t = tomarRodar(pasta)
    expect(t.ok).toBe(true)
    if (t.ok) t.soltar()
  })

  it('soltar não apaga o cadeado que passou a ser de outro', () => {
    const t = tomarRodar(pasta)
    expect(t.ok).toBe(true)
    writeFileSync(join(pasta, 'rodar.pid'), `${process.pid} 1`)
    if (t.ok) t.soltar()
    expect(existsSync(join(pasta, 'rodar.pid'))).toBe(true)
  })

  it('identidade: própria tem o formato "pid starttime"; pid inexistente é null', () => {
    expect(identidade(process.pid)).toMatch(new RegExp(`^${process.pid} \\d+$`))
    const morto = spawnSync('true')
    expect(identidade(morto.pid)).toBeNull()
  })
})

describe.skipIf(process.platform !== 'linux')('entrada.json em disco', { timeout: 20_000 }, () => {
  const arquivo = (): string => join(pasta, 'entrada.json')
  const acrescenta = (texto: string) => (e: ReturnType<typeof entradaVazia>) => {
    const r = registrarNaEntrada(e, { texto, agora: '2026-11-11T10:00:00.000Z' })
    return 'erro' in r ? { estado: null, resultado: r.erro } : { estado: r.estado, resultado: r.id }
  }

  it('lerEntrada: sem arquivo é null; torto lança', () => {
    expect(lerEntrada(pasta)).toBeNull()
    writeFileSync(arquivo(), '{')
    expect(() => lerEntrada(pasta)).toThrow('entrada.json ilegível')
  })

  it('alterarEntrada grava, solta o cadeado e não toca no estado.json', async () => {
    expect(await alterarEntrada(pasta, acrescenta('a'))).toBe('e-0001')
    expect(await alterarEntrada(pasta, acrescenta('b'))).toBe('e-0002')
    expect(lerEntrada(pasta)?.itens.map((i) => i.texto)).toEqual(['a', 'b'])
    expect(existsSync(join(pasta, 'entrada.lock'))).toBe(false)
    expect(existsSync(join(pasta, 'estado.json'))).toBe(false)
    expect(readdirSync(pasta).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('com estado: null não cria o arquivo', async () => {
    expect(await alterarEntrada(pasta, acrescenta('   '))).toBe('o texto da entrada está vazio')
    expect(existsSync(arquivo())).toBe(false)
  })

  it('entrada ilegível lança sem sobrescrever e solta o cadeado', async () => {
    writeFileSync(arquivo(), '{')
    await expect(alterarEntrada(pasta, acrescenta('a'))).rejects.toThrow('entrada.json ilegível')
    expect(readFileSync(arquivo(), 'utf8')).toBe('{')
    expect(existsSync(join(pasta, 'entrada.lock'))).toBe(false)
  })

  it('espera o entrada.lock de um vivo e lança com a mensagem da entrada', async () => {
    writeFileSync(join(pasta, 'entrada.lock'), identidade(process.pid) as string)
    await expect(alterarEntrada(pasta, acrescenta('a'), 200)).rejects.toThrow(
      `a entrada está presa pelo processo ${process.pid} (${pasta}/entrada.lock)`,
    )
  })

  it('alterarEstado continua com a mensagem de hoje', async () => {
    writeFileSync(join(pasta, 'estado.lock'), identidade(process.pid) as string)
    await expect(alterarEstado(pasta, (e) => ({ estado: e, resultado: 1 }), 200)).rejects.toThrow(
      `o estado está preso pelo processo ${process.pid} (${pasta}/estado.lock)`,
    )
  })
})
