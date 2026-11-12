import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ITEM_NO_BOARD_QUERY } from '../../src/core/fabrica/estacao'
import type { ComandoDaFabrica } from '../../src/shared/fabrica'
import type { DepsDoCli } from '../../src/main/fabrica/cli'
import { configuracaoComDoisBoards, configuracaoDeTeste } from './fabrica-board-de-teste'
import {
  LIMITE_DA_NOTA_DO_APP,
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
    configuracao: configuracaoDeTeste({ home: homedir(), workspace: dirname(RAIZ) }),
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

type Deps = Parameters<typeof criarExecutorDeComando>
/** O executor com o pedido de hoje: o comando no `padrao` (`board: null`, #157). */
function comandar(
  ...a: Deps
): (comando: unknown) => ReturnType<ReturnType<typeof criarExecutorDeComando>> {
  const executor = criarExecutorDeComando(...a)
  return (comando) => executor({ board: null, comando })
}

const PADRAO = ['--board', 'leonardo-amaral-3/2']

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
      { tipo: 'confirmar', arquivo: '2026-11-10-a-sala-le-o-mandato-pela-graphql.md' },
      { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: 'x' },
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

  it('a lista fechada tem fechar e iniciar e não tem rodar nem estado', () => {
    const lista: readonly string[] = SUBCOMANDOS_DO_APP
    expect(lista).toContain('fechar')
    expect(lista).toContain('iniciar')
    expect(lista).not.toContain('rodar')
    expect(lista).not.toContain('estado')
  })
})

describe('o executor', () => {
  it('pausar e retomar numa pasta fora do /tmp criam e apagam pausa.json', async () => {
    const executor = comandar(base({ OC_FABRICA_DIR: pasta }))
    const pausou = await executor({ tipo: 'pausar' })
    expect(pausou.ok).toBe(true)
    expect(pausou.codigo).toBe(0)
    expect(pausou.argv).toEqual([...PADRAO, 'pausar'])
    expect(pausou.saida).toContain('fábrica pausada')
    expect(existsSync(join(pasta, 'pausa.json'))).toBe(true)

    const retomou = await executor({ tipo: 'retomar' })
    expect(retomou).toMatchObject({ ok: true, codigo: 0, argv: [...PADRAO, 'retomar'], erro: '' })
    expect(retomou.saida).toContain('fábrica retomada')
    expect(existsSync(join(pasta, 'pausa.json'))).toBe(false)
  })

  it('fechar fecha o item numa cópia da f3 e recusa o segundo fechar', async () => {
    // Q14: o CLI regrava o estado.json até quando recusa; a pasta nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    cpSync(join(RAIZ, 'tests', 'fixtures', 'fabrica', 'f3'), pasta, { recursive: true })
    const executor = comandar(base({ OC_FABRICA_DIR: pasta }))

    const fechou = await executor({
      tipo: 'fechar',
      item: 'q-0009',
      resolucao: ' gravar no cofre ',
    })
    expect(fechou).toMatchObject({
      ok: true,
      codigo: 0,
      argv: [...PADRAO, 'fechar', 'q-0009', 'gravar no cofre'],
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
    const torto: unknown[] = [
      { board: null, comando: { tipo: 'rodar' } },
      { board: null, comando: { tipo: 'estado' } },
      { board: null, comando: 'rodar' },
      { board: null },
      'rodar',
      null,
      undefined,
    ]
    for (const pedido of torto) {
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

  it('board que não é null nem chave válida é "comando desconhecido", sem chamar o executar (#157)', async () => {
    let chamadas = 0
    const executor = criarExecutorDeComando(base({ OC_FABRICA_DIR: pasta }), () => {
      chamadas += 1
      return Promise.resolve(0)
    })
    const comando = { tipo: 'pausar' }
    for (const board of [undefined, '', 'x', 'a/b', 'a/0', 'a/b/2', 'a/2 --x', 2, {}]) {
      expect(await executor({ board, comando })).toEqual({
        ok: false,
        codigo: 1,
        argv: [],
        saida: '',
        erro: 'comando desconhecido',
      })
    }
    expect(chamadas).toBe(0)
  })

  it('o board do pedido vira --board <chave>; null vira o padrão da configuração (#157)', async () => {
    const chamadas: string[][] = []
    const executor = criarExecutorDeComando(base({}), (deps) => {
      chamadas.push([...deps.argv])
      return Promise.resolve(0)
    })
    const comando = { tipo: 'pausar' }
    await executor({ board: null, comando })
    const r = await executor({ board: 'fulano/8', comando })
    expect(chamadas).toEqual([
      [...PADRAO, 'pausar'],
      ['--board', 'fulano/8', 'pausar'],
    ])
    expect(r.argv).toEqual(['--board', 'fulano/8', 'pausar'])
  })

  it('a segunda guarda vale sozinha: um argv vazio ou fora da lista não chega ao executar', async () => {
    let chamadas = 0
    const contar = (): Promise<number> => {
      chamadas += 1
      return Promise.resolve(0)
    }
    const vazio = comandar(base({ OC_FABRICA_DIR: pasta }), contar, () => [])
    expect(await vazio({ tipo: 'pausar' })).toMatchObject({
      ok: false,
      argv: [],
      erro: 'comando desconhecido',
    })
    const rodar = comandar(base({ OC_FABRICA_DIR: pasta }), contar, () => ['rodar'])
    expect(await rodar({ tipo: 'pausar' })).toMatchObject({ ok: false, argv: ['rodar'] })
    expect(chamadas).toBe(0)
  })

  it('duas chamadas simultâneas rodam em série', async () => {
    const eventos: string[] = []
    let ativas = 0
    let pico = 0
    const executor = comandar(base({ OC_FABRICA_DIR: pasta }), async (deps) => {
      ativas += 1
      pico = Math.max(pico, ativas)
      eventos.push(`começa ${deps.argv[2] ?? ''}`)
      await new Promise((r) => setTimeout(r, 20))
      eventos.push(`termina ${deps.argv[2] ?? ''}`)
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
    const executor = comandar(base({ OC_FABRICA_DIR: pasta }), (deps) => {
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
      argv: [...PADRAO, 'pausar'],
      saida: 'antes',
      erro: 'quebrou',
    })
    expect((await executor({ tipo: 'retomar' })).ok).toBe(true)
  })

  it('/tmp → ok false, código 2, e nada é escrito', async () => {
    const tmp = join('/tmp', `oc-comando-${String(process.pid)}`)
    mkdirSync(tmp, { recursive: true })
    try {
      const executor = comandar(base({ OC_FABRICA_DIR: tmp }))
      const r = await executor({ tipo: 'pausar' })
      expect(r).toMatchObject({ ok: false, codigo: 2, argv: [...PADRAO, 'pausar'] })
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

  it('entrada e iniciar entram na lista fechada: triar, rodar e estado ficam fora', () => {
    const lista: readonly string[] = SUBCOMANDOS_DO_APP
    expect(lista).toContain('entrada')
    expect(lista).toContain('iniciar')
    for (const fora of ['triar', 'rodar', 'estado']) expect(lista).not.toContain(fora)
  })

  it('o executor, numa cópia de f4, grava o e-0004', async () => {
    // Antes de agir: a pasta de teste nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    cpSync(join(RAIZ, 'tests', 'fixtures', 'fabrica', 'f4'), pasta, { recursive: true })
    const executor = comandar(base({ OC_FABRICA_DIR: pasta }))
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
    for (const fora of ['atender', 'triar', 'rodar', 'estado']) {
      expect(lista).not.toContain(fora)
    }
  })

  it('o executor grava as duas linhas e devolve ok, com o cofre de fixture', async () => {
    // Antes de agir: a pasta de teste nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    const executor = comandar(
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

describe('o comando iniciar (F6, CA-6.2)', () => {
  it('vira ["iniciar", <repo>#<card>, "--nota", <nota aparada>]', () => {
    expect(
      argvDoComando({
        tipo: 'iniciar',
        repo: 'leonardo-amaral-3/operations-center',
        card: 940,
        nota: ' x ',
      }),
    ).toEqual(['iniciar', 'leonardo-amaral-3/operations-center#940', '--nota', 'x'])
    expect(
      argvDoComando({
        tipo: 'iniciar',
        repo: 'leonardo-amaral-3/operations-center',
        card: 940,
        nota: 'a'.repeat(1000),
      }),
    ).not.toBeNull()
    expect(LIMITE_DA_NOTA_DO_APP).toBe(1000)
  })

  it.each([
    { tipo: 'iniciar', card: 940, nota: 'x' },
    { tipo: 'iniciar', repo: '', card: 940, nota: 'x' },
    { tipo: 'iniciar', repo: 'semBarra', card: 940, nota: 'x' },
    { tipo: 'iniciar', repo: 'a b/c', card: 940, nota: 'x' },
    { tipo: 'iniciar', repo: 'a/b/c', card: 940, nota: 'x' },
    { tipo: 'iniciar', repo: 7, card: 940, nota: 'x' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 0, nota: 'x' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: -1, nota: 'x' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 1.5, nota: 'x' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: '940', nota: 'x' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: NaN, nota: 'x' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940 },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: 7 },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: '' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: '   ' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: 'a\nb' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: 'a\rb' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: 'a\u0000b' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: 'a\u0085b' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: 'a\u2028b' },
    { tipo: 'iniciar', repo: 'leonardo-amaral-3/operations-center', card: 940, nota: 'a\u2029b' },
    {
      tipo: 'iniciar',
      repo: 'leonardo-amaral-3/operations-center',
      card: 940,
      nota: '--comando x',
    },
    {
      tipo: 'iniciar',
      repo: 'leonardo-amaral-3/operations-center',
      card: 940,
      nota: 'a'.repeat(1001),
    },
  ])('%j → null', (pedido) => {
    expect(argvDoComando(pedido)).toBeNull()
  })

  it('a segunda guarda: entrada "--ensaio" chega ao executar; iniciar com --comando ou --ensaio não', async () => {
    const chamadas: string[][] = []
    const rodar = (deps: DepsDoCli): Promise<number> => {
      chamadas.push([...deps.argv])
      return Promise.resolve(0)
    }
    const com = (argv: string[]) => comandar(base({}), rodar, () => argv)

    await com(['entrada', '--ensaio'])({})
    expect(chamadas).toEqual([[...PADRAO, 'entrada', '--ensaio']])

    for (const argv of [
      ['iniciar', '940', '--comando', '/gm-ship #940'],
      ['iniciar', '940', '--ensaio'],
      ['iniciar', '940', '--nota', 'x', '--ensaio'],
      ['iniciar', '940'],
      ['iniciar', '0940', '--nota', 'x'],
      ['iniciar', '940', '--nota', 'x'],
      ['iniciar', 'x', '--nota', 'x'],
      ['iniciar', '940', '--comando', 'x'],
    ]) {
      const r = await com(argv)({})
      expect(r).toMatchObject({ ok: false, erro: 'comando desconhecido' })
    }
    expect(chamadas).toHaveLength(1)

    const r = await com(['iniciar', 'leonardo-amaral-3/operations-center#940', '--nota', 'x'])({})
    expect(r.ok).toBe(true)
    expect(chamadas).toHaveLength(2)
  })

  it('o executor grava frente + despacho pendente com a nota; nota com "main" é recusada sem gravar', async () => {
    // Antes de agir: a pasta de teste nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    const graphql = vi.fn((documento: string) => {
      expect(documento).toBe(ITEM_NO_BOARD_QUERY)
      return Promise.resolve({
        data: {
          repository: {
            issue: {
              state: 'OPEN',
              projectItems: {
                nodes: [{ project: { number: 2 }, fieldValueByName: { name: '📋 Backlog' } }],
              },
            },
          },
        },
      })
    })
    const executor = comandar({
      ...base({ OC_FABRICA_DIR: pasta }),
      graphql,
      lerMandato: () => Promise.resolve('MANDATO DE TESTE\n'),
    })

    const recusou = await executor({
      tipo: 'iniciar',
      repo: 'leonardo-amaral-3/operations-center',
      card: 940,
      nota: 'sobe na main hoje',
    })
    expect(recusou.ok).toBe(false)
    expect(recusou.erro).toContain('a nota cita main, release, tag ou hotfix')
    expect(existsSync(join(pasta, 'estado.json'))).toBe(false)

    const r = await executor({
      tipo: 'iniciar',
      repo: 'leonardo-amaral-3/operations-center',
      card: 940,
      nota: ' Pronto às 8h ',
    })
    expect(r).toMatchObject({
      ok: true,
      codigo: 0,
      argv: [
        ...PADRAO,
        'iniciar',
        'leonardo-amaral-3/operations-center#940',
        '--nota',
        'Pronto às 8h',
      ],
    })
    const estado = JSON.parse(readFileSync(join(pasta, 'estado.json'), 'utf8')) as {
      frentes: Array<{ card: number }>
      despachos: Array<{ card: number; comando: string; estado: string; nota: string | null }>
    }
    expect(estado.frentes).toHaveLength(1)
    expect(estado.frentes[0]).toMatchObject({
      card: 940,
      repo: 'leonardo-amaral-3/operations-center',
    })
    expect(estado.despachos).toHaveLength(1)
    expect(estado.despachos[0]).toMatchObject({
      card: 940,
      comando: '/gm-spec #940',
      estado: 'pendente',
      nota: 'Pronto às 8h',
    })
  })

  it('o board do pedido manda: o iniciar do fulano/repo-b grava a frente na pasta do fulano/8 e não cria a do Project 2 (#157)', async () => {
    // Antes de agir: a pasta de teste nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    mkdirSync(join(pasta, 'ws2', 'planning'), { recursive: true })
    const chamadas: unknown[] = []
    const executor = criarExecutorDeComando({
      ...base({}),
      configuracao: configuracaoComDoisBoards({ raiz: pasta, home: homedir() }),
      graphql: (_q, v) => {
        chamadas.push(v)
        return Promise.resolve({
          data: {
            repository: {
              issue: {
                state: 'OPEN',
                projectItems: {
                  nodes: [{ project: { number: 8 }, fieldValueByName: { name: '📋 Backlog' } }],
                },
              },
            },
          },
        })
      },
      lerMandato: () => Promise.resolve('MANDATO DE TESTE\n'),
    })

    const r = await executor({
      board: 'fulano/8',
      comando: { tipo: 'iniciar', repo: 'fulano/repo-b', card: 7, nota: 'Pronto às 8h' },
    })
    expect(r).toMatchObject({
      ok: true,
      codigo: 0,
      argv: ['--board', 'fulano/8', 'iniciar', 'fulano/repo-b#7', '--nota', 'Pronto às 8h'],
    })
    expect(chamadas[0]).toMatchObject({ owner: 'fulano', name: 'repo-b', n: 7 })
    const estado = JSON.parse(readFileSync(join(pasta, 'estado2', 'estado.json'), 'utf8')) as {
      frentes: Array<{ card: number; repo?: string }>
    }
    expect(estado.frentes[0]).toMatchObject({ card: 7, repo: 'fulano/repo-b' })
    expect(existsSync(join(pasta, 'estado1'))).toBe(false)

    // Board fora do arquivo: o executar recusa com o motivo, antes de criar pasta.
    const fora = await executor({ board: 'ICSF-Solutions/19', comando: { tipo: 'pausar' } })
    expect(fora).toMatchObject({ ok: false, codigo: 2 })
    expect(fora.erro).toContain('o board ICSF-Solutions/19 não está configurado')
    expect(existsSync(join(pasta, 'estado1'))).toBe(false)
  })

  it('em voo no board de dois repos: o iniciar do fulano/repo-a#5 pelo canal dá ok false com o repo no erro (#157, CA-2)', async () => {
    // Antes de agir: a pasta de teste nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    mkdirSync(join(pasta, 'ws2', 'planning'), { recursive: true })
    const executor = criarExecutorDeComando({
      ...base({}),
      configuracao: configuracaoComDoisBoards({ raiz: pasta, home: homedir() }),
      graphql: () =>
        Promise.resolve({
          data: {
            repository: {
              issue: {
                state: 'OPEN',
                projectItems: {
                  nodes: [{ project: { number: 8 }, fieldValueByName: { name: '📋 Backlog' } }],
                },
              },
            },
          },
        }),
      lerMandato: () => Promise.resolve('MANDATO DE TESTE\n'),
    })
    // O estado2 já tem o d-0001 do fulano/repo-a#5 em voo.
    const voo = {
      id: 'd-0001',
      frente: 'fr-0001',
      card: 5,
      repo: 'fulano/repo-a',
      comando: '/gm-spec #5',
      nota: null,
      estado: 'rodando',
      pid: null,
      criadoEm: AGORA,
      lancadoEm: AGORA,
      concluidoEm: null,
      sessaoClaude: null,
      desfecho: null,
    }
    mkdirSync(join(pasta, 'estado2'), { recursive: true })
    writeFileSync(
      join(pasta, 'estado2', 'estado.json'),
      JSON.stringify({
        versao: 1,
        instancia: '00000000-0000-4000-8000-000000000157',
        contador: 1,
        frentes: [
          { id: 'fr-0001', card: 5, repo: 'fulano/repo-a', criadaEm: AGORA, encerradaEm: null },
        ],
        despachos: [voo],
        fila: [],
      }),
    )
    const iniciar = {
      board: 'fulano/8',
      comando: { tipo: 'iniciar', repo: 'fulano/repo-a', card: 5, nota: 'Pronto às 8h' },
    }
    const lerDespachos = () =>
      (
        JSON.parse(readFileSync(join(pasta, 'estado2', 'estado.json'), 'utf8')) as {
          despachos: unknown[]
        }
      ).despachos

    const r = await executor(iniciar)
    expect(r.ok).toBe(false)
    expect(r.erro).toBe('fabrica: o fulano/repo-a#5 já tem despacho em voo (d-0001)')
    expect(lerDespachos()).toEqual([voo])
  })
})
