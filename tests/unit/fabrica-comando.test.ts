import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ComandoDaFabrica } from '../../src/shared/fabrica'
import type { DepsDoCli } from '../../src/main/fabrica/cli'
import {
  SUBCOMANDOS_DO_APP,
  argvDoComando,
  criarExecutorDeComando,
} from '../../src/main/fabrica/comando'

/**
 * O canal de escrita da fábrica (#129, F1.3, CA-1.2 e CA-E3). A pasta de teste fica em
 * `node_modules/` (o `yarn fabrica` recusa `/tmp` para escrita, P10) e nunca é a pasta real.
 */

const RAIZ = join(__dirname, '..', '..')
const AGORA = '2026-11-11T10:00:00.000Z'

let pasta = ''
beforeEach(() => {
  pasta = mkdtempSync(join(RAIZ, 'node_modules', '.oc-fabrica-teste-'))
})
afterEach(() => {
  rmSync(pasta, { recursive: true, force: true })
})

function base(env: NodeJS.ProcessEnv): Omit<DepsDoCli, 'argv' | 'escrever' | 'avisar'> {
  return {
    raizDoRepo: RAIZ,
    env,
    platform: 'linux',
    home: homedir(),
    agora: () => AGORA,
    lerMandato: () => Promise.reject(new Error('mandato não esperado')),
    graphql: () => Promise.reject(new Error('graphql não esperado')),
    intervaloMs: 100,
    sinal: new AbortController().signal,
  }
}

describe('argvDoComando', () => {
  it('pausar e retomar viram o subcomando', () => {
    expect(argvDoComando({ tipo: 'pausar' })).toEqual(['pausar'])
    expect(argvDoComando({ tipo: 'retomar' })).toEqual(['retomar'])
  })

  it.each([
    { tipo: 'rodar' },
    { tipo: 'estado' },
    { tipo: 'desconhecido' },
    {},
    { tipo: 1 },
    'pausar',
    42,
    null,
    undefined,
    ['pausar'],
  ])('%j → null', (pedido) => {
    expect(argvDoComando(pedido)).toBeNull()
  })

  it('para cada membro da união, o argv é não vazio e está na lista fechada', () => {
    const uniao: ComandoDaFabrica[] = [{ tipo: 'pausar' }, { tipo: 'retomar' }]
    for (const pedido of uniao) {
      const argv = argvDoComando(pedido)
      expect(argv).not.toBeNull()
      expect(argv?.length).toBeGreaterThan(0)
      expect(SUBCOMANDOS_DO_APP as readonly string[]).toContain(argv?.[0])
    }
  })

  it('a lista fechada não tem rodar nem estado', () => {
    const lista: readonly string[] = SUBCOMANDOS_DO_APP
    expect(lista).not.toContain('rodar')
    expect(lista).not.toContain('estado')
  })
})

describe('o executor', () => {
  it('pausar e retomar numa pasta fora do /tmp criam e apagam pausa.json', async () => {
    const executor = criarExecutorDeComando(base({ OC_FABRICA_DIR: pasta }))
    const pausou = await executor({ tipo: 'pausar' })
    expect(pausou.ok).toBe(true)
    expect(pausou.codigo).toBe(0)
    expect(pausou.argv).toEqual(['pausar'])
    expect(pausou.saida).toContain('fábrica pausada')
    expect(existsSync(join(pasta, 'pausa.json'))).toBe(true)

    const retomou = await executor({ tipo: 'retomar' })
    expect(retomou).toMatchObject({ ok: true, codigo: 0, argv: ['retomar'], erro: '' })
    expect(retomou.saida).toContain('fábrica retomada')
    expect(existsSync(join(pasta, 'pausa.json'))).toBe(false)
  })

  it('pedido desconhecido não chama o executar', async () => {
    let chamadas = 0
    const executor = criarExecutorDeComando(base({ OC_FABRICA_DIR: pasta }), () => {
      chamadas += 1
      return Promise.resolve(0)
    })
    for (const pedido of [{ tipo: 'rodar' }, { tipo: 'estado' }, 'rodar', null, undefined]) {
      expect(await executor(pedido)).toEqual({
        ok: false,
        codigo: 1,
        argv: [],
        saida: '',
        erro: 'comando desconhecido',
      })
    }
    expect(chamadas).toBe(0)
  })

  it('a segunda guarda vale sozinha: um argv vazio ou fora da lista não chega ao executar', async () => {
    let chamadas = 0
    const contar = (): Promise<number> => {
      chamadas += 1
      return Promise.resolve(0)
    }
    const vazio = criarExecutorDeComando(base({ OC_FABRICA_DIR: pasta }), contar, () => [])
    expect(await vazio({ tipo: 'pausar' })).toMatchObject({
      ok: false,
      argv: [],
      erro: 'comando desconhecido',
    })
    const rodar = criarExecutorDeComando(base({ OC_FABRICA_DIR: pasta }), contar, () => ['rodar'])
    expect(await rodar({ tipo: 'pausar' })).toMatchObject({ ok: false, argv: ['rodar'] })
    expect(chamadas).toBe(0)
  })

  it('duas chamadas simultâneas rodam em série', async () => {
    const eventos: string[] = []
    let ativas = 0
    let pico = 0
    const executor = criarExecutorDeComando(base({ OC_FABRICA_DIR: pasta }), async (deps) => {
      ativas += 1
      pico = Math.max(pico, ativas)
      eventos.push(`começa ${deps.argv[0] ?? ''}`)
      await new Promise((r) => setTimeout(r, 20))
      eventos.push(`termina ${deps.argv[0] ?? ''}`)
      ativas -= 1
      return 0
    })
    await Promise.all([executor({ tipo: 'pausar' }), executor({ tipo: 'retomar' })])
    expect(pico).toBe(1)
    expect(eventos).toEqual([
      'começa pausar',
      'termina pausar',
      'começa retomar',
      'termina retomar',
    ])
  })

  it('exceção do executar vira resultado, com o que já foi escrito, e a fila segue', async () => {
    let n = 0
    const executor = criarExecutorDeComando(base({ OC_FABRICA_DIR: pasta }), (deps) => {
      n += 1
      if (n === 1) {
        deps.escrever('antes')
        return Promise.reject(new Error('quebrou'))
      }
      return Promise.resolve(0)
    })
    expect(await executor({ tipo: 'pausar' })).toEqual({
      ok: false,
      codigo: 1,
      argv: ['pausar'],
      saida: 'antes',
      erro: 'quebrou',
    })
    expect((await executor({ tipo: 'retomar' })).ok).toBe(true)
  })

  it('/tmp → ok false, código 2, e nada é escrito', async () => {
    const tmp = join('/tmp', `oc-comando-${String(process.pid)}`)
    mkdirSync(tmp, { recursive: true })
    try {
      const executor = criarExecutorDeComando(base({ OC_FABRICA_DIR: tmp }))
      const r = await executor({ tipo: 'pausar' })
      expect(r).toMatchObject({ ok: false, codigo: 2, argv: ['pausar'] })
      expect(r.erro).toContain('/tmp')
      expect(existsSync(join(tmp, 'pausa.json'))).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
