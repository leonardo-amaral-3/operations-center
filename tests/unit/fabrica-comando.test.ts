import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    const uniao: ComandoDaFabrica[] = [
      { tipo: 'pausar' },
      { tipo: 'retomar' },
      { tipo: 'fechar', item: 'q-0009', resolucao: 'gravar no cofre' },
      { tipo: 'entrada', texto: 'o suporte pediu CSV' },
    ]
    for (const pedido of uniao) {
      const argv = argvDoComando(pedido)
      expect(argv).not.toBeNull()
      expect(argv?.length).toBeGreaterThan(0)
      expect(SUBCOMANDOS_DO_APP as readonly string[]).toContain(argv?.[0])
    }
  })

  it('fechar vira o argv com a resolução aparada, e passa inteira com quebra de linha e --flag', () => {
    expect(
      argvDoComando({ tipo: 'fechar', item: 'q-0009', resolucao: '  gravar no cofre ' }),
    ).toEqual(['fechar', 'q-0009', 'gravar no cofre'])
    expect(
      argvDoComando({ tipo: 'fechar', item: 'q-0009', resolucao: 'linha 1\nlinha 2 --flag' }),
    ).toEqual(['fechar', 'q-0009', 'linha 1\nlinha 2 --flag'])
  })

  it.each([
    { tipo: 'fechar', item: 'q-', resolucao: 'x' },
    { tipo: 'fechar', item: 'd-0005', resolucao: 'x' },
    { tipo: 'fechar', item: 'q-1 x', resolucao: 'x' },
    { tipo: 'fechar', item: 3, resolucao: 'x' },
    { tipo: 'fechar', item: 'q-0009', resolucao: '' },
    { tipo: 'fechar', item: 'q-0009', resolucao: '   ' },
    { tipo: 'fechar', item: 'q-0009', resolucao: 7 },
    { tipo: 'fechar', item: 'q-0009' },
  ])('fechar fora da forma %j → null', (pedido) => {
    expect(argvDoComando(pedido)).toBeNull()
  })

  it('a lista fechada tem fechar e não tem rodar, estado nem iniciar', () => {
    const lista: readonly string[] = SUBCOMANDOS_DO_APP
    expect(lista).toContain('fechar')
    expect(lista).not.toContain('iniciar')
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

  it('fechar fecha o item numa cópia da f3 e recusa o segundo fechar', async () => {
    // Q14: o CLI regrava o estado.json até quando recusa; a pasta nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    cpSync(join(RAIZ, 'tests', 'fixtures', 'fabrica', 'f3'), pasta, { recursive: true })
    const executor = criarExecutorDeComando(base({ OC_FABRICA_DIR: pasta }))

    const fechou = await executor({
      tipo: 'fechar',
      item: 'q-0009',
      resolucao: ' gravar no cofre ',
    })
    expect(fechou).toMatchObject({
      ok: true,
      codigo: 0,
      argv: ['fechar', 'q-0009', 'gravar no cofre'],
      saida: 'q-0009 fechado',
    })
    const estado = JSON.parse(readFileSync(join(pasta, 'estado.json'), 'utf8')) as {
      fila: { id: string; resolucao: string | null; fechadoEm: string | null }[]
    }
    const item = estado.fila.find((i) => i.id === 'q-0009')
    expect(item?.resolucao).toBe('gravar no cofre')
    expect(item?.fechadoEm).toEqual(expect.any(String))

    const denovo = await executor({ tipo: 'fechar', item: 'q-0009', resolucao: 'outra' })
    expect(denovo).toMatchObject({ ok: false, codigo: 1 })
    expect(denovo.erro).toContain('já foi fechado')
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

describe('o comando entrada (F4, CA-4.3 e CA-E3)', () => {
  it('vira ["entrada", <texto aparado>]; quebra de linha e --flag passam inteiras', () => {
    expect(argvDoComando({ tipo: 'entrada', texto: '  a  ' })).toEqual(['entrada', 'a'])
    expect(argvDoComando({ tipo: 'entrada', texto: 'a\nb' })).toEqual(['entrada', 'a\nb'])
    expect(argvDoComando({ tipo: 'entrada', texto: '--x' })).toEqual(['entrada', '--x'])
    expect(argvDoComando({ tipo: 'entrada', texto: 'a'.repeat(4000) })).not.toBeNull()
  })

  it.each([
    { tipo: 'entrada', texto: '' },
    { tipo: 'entrada', texto: '   ' },
    { tipo: 'entrada', texto: 'a'.repeat(4001) },
    { tipo: 'entrada', texto: 7 },
    { tipo: 'entrada' },
  ])('%j → null', (pedido) => {
    expect(argvDoComando(pedido)).toBeNull()
  })

  it('só entrada entra na lista fechada: triar, rodar, estado e iniciar ficam fora', () => {
    const lista: readonly string[] = SUBCOMANDOS_DO_APP
    expect(lista).toContain('entrada')
    for (const fora of ['triar', 'rodar', 'estado', 'iniciar']) expect(lista).not.toContain(fora)
  })

  it('o executor, numa cópia de f4, grava o e-0004', async () => {
    // Antes de agir: a pasta de teste nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    cpSync(join(RAIZ, 'tests', 'fixtures', 'fabrica', 'f4'), pasta, { recursive: true })
    const executor = criarExecutorDeComando(base({ OC_FABRICA_DIR: pasta }))
    const r = await executor({ tipo: 'entrada', texto: 'o suporte pediu CSV' })
    expect(r).toMatchObject({ ok: true, codigo: 0, saida: 'e-0004 na entrada' })
    const gravada = JSON.parse(readFileSync(join(pasta, 'entrada.json'), 'utf8')) as {
      contador: number
      itens: Array<{ id: string; texto: string }>
    }
    expect(gravada.contador).toBe(4)
    expect(gravada.itens[3]).toMatchObject({ id: 'e-0004', texto: 'o suporte pediu CSV' })
  })
})

describe('os comandos confirmar e contestar (F5, CA-5.2 e CA-E3)', () => {
  const ARQUIVO = '2026-11-10-a-sala-le-o-mandato-pela-graphql.md'

  it('confirmar vira ["confirmar", <arquivo>]', () => {
    expect(argvDoComando({ tipo: 'confirmar', arquivo: ARQUIVO })).toEqual(['confirmar', ARQUIVO])
  })

  it('contestar vira ["contestar", <arquivo>, <motivo aparado>]; quebra de linha e --flag passam inteiras', () => {
    expect(argvDoComando({ tipo: 'contestar', arquivo: ARQUIVO, motivo: '  não  ' })).toEqual([
      'contestar',
      ARQUIVO,
      'não',
    ])
    expect(argvDoComando({ tipo: 'contestar', arquivo: ARQUIVO, motivo: 'a\nb --x' })).toEqual([
      'contestar',
      ARQUIVO,
      'a\nb --x',
    ])
    expect(
      argvDoComando({ tipo: 'contestar', arquivo: ARQUIVO, motivo: ` ${'a'.repeat(2000)} ` }),
    ).not.toBeNull()
  })

  it.each([
    { tipo: 'confirmar' },
    { tipo: 'confirmar', arquivo: 7 },
    { tipo: 'confirmar', arquivo: '../x.md' },
    { tipo: 'confirmar', arquivo: 'x.md' },
    { tipo: 'confirmar', arquivo: `pasta/${ARQUIVO}` },
    { tipo: 'contestar', arquivo: ARQUIVO },
    { tipo: 'contestar', arquivo: ARQUIVO, motivo: '' },
    { tipo: 'contestar', arquivo: ARQUIVO, motivo: '   ' },
    { tipo: 'contestar', arquivo: ARQUIVO, motivo: 9 },
    { tipo: 'contestar', arquivo: ARQUIVO, motivo: 'a'.repeat(2001) },
    { tipo: 'contestar', arquivo: 'x.md', motivo: 'm' },
    { tipo: 'atender', arquivo: ARQUIVO, resolucao: 'feito' },
  ])('%j → null', (pedido) => {
    expect(argvDoComando(pedido)).toBeNull()
  })

  it('a lista fechada tem confirmar e contestar; atender, triar, rodar e estado ficam fora', () => {
    const lista: readonly string[] = SUBCOMANDOS_DO_APP
    expect(lista).toContain('confirmar')
    expect(lista).toContain('contestar')
    for (const fora of ['atender', 'triar', 'rodar', 'estado', 'iniciar']) {
      expect(lista).not.toContain(fora)
    }
  })

  it('o executor grava as duas linhas e devolve ok, com o cofre de fixture', async () => {
    // Antes de agir: a pasta de teste nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    const executor = criarExecutorDeComando(
      base({
        OC_FABRICA_DIR: pasta,
        OC_RELATORIO_COFRE: join(RAIZ, 'tests', 'fixtures', 'fabrica', 'f5-cofre'),
      }),
    )
    const outro = '2026-11-10-o-relatorio-agrupa-pela-raiz-da-cadeia.md'
    const a = await executor({ tipo: 'confirmar', arquivo: ARQUIVO })
    const b = await executor({
      tipo: 'contestar',
      arquivo: outro,
      motivo: 'a raiz tem de parar no épico',
    })

    expect(a).toMatchObject({ ok: true, codigo: 0, saida: `${ARQUIVO} confirmada` })
    expect(b).toMatchObject({ ok: true, codigo: 0, saida: `${outro} contestada` })
    const linhas = readFileSync(join(pasta, 'revisoes.jsonl'), 'utf8').trim().split('\n')
    expect(linhas).toHaveLength(2)
    expect(JSON.parse(linhas[0] ?? '')).toMatchObject({ tipo: 'confirmada', arquivo: ARQUIVO })
    expect(JSON.parse(linhas[1] ?? '')).toMatchObject({
      tipo: 'contestada',
      arquivo: outro,
      motivo: 'a raiz tem de parar no épico',
    })
    expect(existsSync(join(pasta, 'estado.json'))).toBe(false)
  })
})
