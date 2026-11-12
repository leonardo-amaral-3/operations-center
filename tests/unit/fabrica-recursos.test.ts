import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { cardDaCwd, lerProcLocks, MINIMO_DE_DISCO } from '../../src/core/fabrica/recursos'
import {
  caminhoDoCadeadoDaSuite,
  criarMarcaEmCache,
  lerRecursos,
  portasReais,
  worktreesDo,
  type EstadoDaMarca,
  type PortasDosRecursos,
} from '../../src/main/fabrica/recursos'

const RAIZ = join(__dirname, '..', '..')

// Um /proc/locks de verdade: o dono e dois à espera do inode 2222, uma trava POSIX do mesmo inode,
// um flock de outro inode e uma linha torta.
const PROC_LOCKS = [
  '1: FLOCK  ADVISORY  WRITE 4001 00:1d:2222 0 EOF',
  '1: -> FLOCK  ADVISORY  WRITE 4002 00:1d:2222 0 EOF',
  '1: -> FLOCK  ADVISORY  WRITE 4003 00:1d:2222 0 EOF',
  '2: POSIX  ADVISORY  WRITE 4004 00:1d:2222 0 EOF',
  '3: FLOCK  ADVISORY  WRITE 4005 00:1d:9999 0 EOF',
  'isto não é uma linha de /proc/locks',
  '',
].join('\n')

describe('lerProcLocks', () => {
  it('dono, mais os que esperam, só do inode pedido', () => {
    expect(lerProcLocks(PROC_LOCKS, 2222)).toEqual({ dono: 4001, esperando: 2 })
  })
  it('sem linha do inode: ninguém segura', () => {
    expect(lerProcLocks(PROC_LOCKS, 1)).toEqual({ dono: null, esperando: 0 })
    expect(lerProcLocks('', 2222)).toEqual({ dono: null, esperando: 0 })
  })
  it('não confunde um inode com o prefixo de outro', () => {
    expect(lerProcLocks(PROC_LOCKS, 222)).toEqual({ dono: null, esperando: 0 })
  })
})

describe('cardDaCwd', () => {
  it.each([
    ['/h/pessoal/operations-center-777-x/sub', 777],
    ['/h/pessoal/operations-center-131-x/test-results/operations-center-777-smoke', 777],
    ['/h/pessoal/operations-center-777-x', 777],
    ['/h/pessoal/operations-center', null],
    ['/h/operations-center-12x-y', null],
    ['', null],
  ])('%s → %s', (cwd, card) => {
    expect(cardDaCwd(cwd, ['operations-center'])?.n ?? null).toBe(card)
  })
})

describe('cardDaCwd com vários repos (#152, CA-3)', () => {
  it('devolve o nome que casou', () => {
    expect(cardDaCwd('/w/repo-b-5-y/test-results', ['repo-a', 'repo-b'])).toEqual({
      nome: 'repo-b',
      n: 5,
    })
  })
  it('a pasta mais funda vence', () => {
    expect(cardDaCwd('/w/repo-a-1-x/repo-b-2-y', ['repo-a', 'repo-b'])).toEqual({
      nome: 'repo-b',
      n: 2,
    })
  })
  it('no mesmo ponto do caminho, o nome mais longo vence', () => {
    expect(cardDaCwd('/w/app-2-5-x', ['app', 'app-2'])).toEqual({ nome: 'app-2', n: 5 })
  })
  it('nenhum nome casa → null', () => {
    expect(cardDaCwd('/w/outro-5-x', ['repo-a'])).toBeNull()
  })
})

describe('caminhoDoCadeadoDaSuite', () => {
  it('OC_SMOKE_CADEADO manda', () => {
    expect(caminhoDoCadeadoDaSuite({ OC_SMOKE_CADEADO: '/x/c.lock' }, 1000, () => true)).toBe(
      '/x/c.lock',
    )
  })
  it('com /run/user/<uid>, o cadeado mora lá; OC_SMOKE_CADEADO vazio não conta', () => {
    expect(caminhoDoCadeadoDaSuite({ OC_SMOKE_CADEADO: '' }, 1000, () => true)).toBe(
      '/run/user/1000/operations-center-smoke.lock',
    )
  })
  it('sem /run/user/<uid>, cai no /tmp', () => {
    expect(caminhoDoCadeadoDaSuite({}, 1000, () => false)).toBe(
      '/tmp/operations-center-smoke-1000.lock',
    )
  })
  it('canária: o scripts/smoke.mjs ainda usa os mesmos nomes', () => {
    const texto = readFileSync(join(RAIZ, 'scripts', 'smoke.mjs'), 'utf8')
    for (const trecho of [
      'OC_SMOKE_CADEADO',
      '/run/user/',
      'operations-center-smoke.lock',
      '/tmp/operations-center-smoke-',
    ]) {
      expect(texto, `scripts/smoke.mjs perdeu ${trecho}`).toContain(trecho)
    }
  })
})

function portas(muda: Partial<PortasDosRecursos> = {}): PortasDosRecursos {
  return {
    plataforma: 'linux',
    env: { OC_SMOKE_CADEADO: '/x/c.lock' },
    nomesDosRepos: ['operations-center'],
    uid: 1000,
    pastaDaFabrica: '/w/claude/despachos-fabrica',
    marca: () => ({ kind: 'ok', marca: 'MANDATO' }),
    contarSessoes: () => 1,
    existe: () => true,
    inodeDe: () => 2222,
    procLocks: () => PROC_LOCKS,
    cwdDe: () => '/h/pessoal/operations-center-777-x',
    livresEm: () => 50 * 1024 ** 3,
    ...muda,
  }
}

describe('lerRecursos', () => {
  it('no Linux, com tudo à mão: sessões, suíte ocupada e disco', () => {
    expect(lerRecursos(portas())).toEqual({
      sessoes: { kind: 'ok', vivas: 1, teto: 3 },
      suite: { kind: 'ocupada', card: 777, esperando: 2 },
      disco: { kind: 'ok', livres: 50 * 1024 ** 3, minimo: MINIMO_DE_DISCO },
    })
  })

  it('fora do Linux: sessões e suíte sem leitura, disco ok', () => {
    const r = lerRecursos(portas({ plataforma: 'darwin' }))
    expect(r.sessoes).toEqual({
      kind: 'sem-leitura',
      motivo: 'a contagem de sessões lê /proc, só no Linux',
      teto: 3,
    })
    expect(r.suite).toEqual({
      kind: 'sem-leitura',
      motivo: 'o cadeado da suíte só existe no Linux',
    })
    expect(r.disco.kind).toBe('ok')
  })

  it.each([
    [{ kind: 'lendo' }, 'sem-leitura', 'lendo o mandato da dev'],
    [{ kind: 'erro', erro: 'sem rede' }, 'sem-leitura', 'sem rede'],
  ] as [EstadoDaMarca, string, string][])('marca %j', (marca, kind, motivo) => {
    expect(lerRecursos(portas({ marca: () => marca })).sessoes).toEqual({ kind, motivo, teto: 3 })
  })

  it('a contagem vem do contarSessoes, com a marca do mandato', () => {
    let recebida = ''
    const r = lerRecursos(
      portas({
        contarSessoes: (m) => {
          recebida = m
          return 2
        },
      }),
    )
    expect(recebida).toBe('MANDATO')
    expect(r.sessoes).toEqual({ kind: 'ok', vivas: 2, teto: 3 })
  })

  it('arquivo do cadeado inexistente: livre', () => {
    expect(lerRecursos(portas({ inodeDe: () => null })).suite).toEqual({ kind: 'livre' })
  })

  it('sem dono no /proc/locks: livre', () => {
    expect(lerRecursos(portas({ procLocks: () => '' })).suite).toEqual({ kind: 'livre' })
  })

  it('dono sem cwd legível: ocupada sem card', () => {
    expect(lerRecursos(portas({ cwdDe: () => null })).suite).toEqual({
      kind: 'ocupada',
      card: null,
      esperando: 2,
    })
  })

  it('inodeDe que lança EACCES: só a suíte fica sem leitura', () => {
    const r = lerRecursos(
      portas({
        inodeDe: () => {
          throw new Error('EACCES: permission denied')
        },
      }),
    )
    expect(r.suite).toEqual({ kind: 'sem-leitura', motivo: 'EACCES: permission denied' })
    expect(r.sessoes.kind).toBe('ok')
    expect(r.disco.kind).toBe('ok')
  })

  it('livresEm que lança: só o disco fica sem leitura', () => {
    const r = lerRecursos(
      portas({
        livresEm: () => {
          throw new Error('ENOSYS')
        },
      }),
    )
    expect(r.disco).toEqual({ kind: 'sem-leitura', motivo: 'ENOSYS' })
    expect(r.suite.kind).toBe('ocupada')
  })

  it('contarSessoes que lança: só as sessões ficam sem leitura', () => {
    const r = lerRecursos(
      portas({
        contarSessoes: () => {
          throw new Error('proc sumiu')
        },
      }),
    )
    expect(r.sessoes).toEqual({ kind: 'sem-leitura', motivo: 'proc sumiu', teto: 3 })
  })

  it('pasta da fábrica inexistente: mede o pai', () => {
    const medidas: string[] = []
    lerRecursos(
      portas({
        existe: (c) => c !== '/w/claude/despachos-fabrica',
        livresEm: (c) => {
          medidas.push(c)
          return 1
        },
      }),
    )
    expect(medidas).toEqual(['/w/claude'])
  })
})

describe('criarMarcaEmCache', () => {
  function montar(respostas: (() => Promise<string>)[]) {
    let agora = 1_000
    let chamadas = 0
    const marca = criarMarcaEmCache(
      () => {
        const resposta = respostas[Math.min(chamadas, respostas.length - 1)]!
        chamadas += 1
        return resposta()
      },
      () => agora,
    )
    return {
      marca,
      chamadas: () => chamadas,
      avanca: (ms: number) => (agora += ms),
    }
  }
  const assenta = () => new Promise((r) => setImmediate(r))

  it('a 1ª chamada devolve lendo e dispara uma leitura; resolvida, vira ok com a 1ª linha', async () => {
    const t = montar([() => Promise.resolve('\nMANDATO DA PROVA\nresto\n')])
    expect(t.marca()).toEqual({ kind: 'lendo' })
    expect(t.chamadas()).toBe(1)
    expect(t.marca()).toEqual({ kind: 'lendo' })
    expect(t.chamadas()).toBe(1)
    await assenta()
    expect(t.marca()).toEqual({ kind: 'ok', marca: 'MANDATO DA PROVA' })
    expect(t.chamadas()).toBe(1)
  })

  it('antes de 60 s não lê de novo; depois, lê', async () => {
    const t = montar([() => Promise.resolve('A'), () => Promise.resolve('B')])
    t.marca()
    await assenta()
    t.avanca(59_999)
    expect(t.marca()).toEqual({ kind: 'ok', marca: 'A' })
    expect(t.chamadas()).toBe(1)
    t.avanca(1)
    expect(t.marca()).toEqual({ kind: 'ok', marca: 'A' })
    expect(t.chamadas()).toBe(2)
    await assenta()
    expect(t.marca()).toEqual({ kind: 'ok', marca: 'B' })
  })

  it('rejeição com ok guardado mantém o ok e espera outros 60 s', async () => {
    const t = montar([() => Promise.resolve('A'), () => Promise.reject(new Error('sem rede'))])
    t.marca()
    await assenta()
    t.avanca(60_000)
    t.marca()
    expect(t.chamadas()).toBe(2)
    await assenta()
    expect(t.marca()).toEqual({ kind: 'ok', marca: 'A' })
    expect(t.chamadas()).toBe(2)
    t.avanca(60_000)
    t.marca()
    expect(t.chamadas()).toBe(3)
  })

  it('rejeição sem ok vira erro, e também espera 60 s', async () => {
    const t = montar([() => Promise.reject(new Error('sem rede'))])
    t.marca()
    await assenta()
    expect(t.marca()).toEqual({ kind: 'erro', erro: 'sem rede' })
    expect(t.chamadas()).toBe(1)
    t.avanca(60_000)
    t.marca()
    expect(t.chamadas()).toBe(2)
  })

  it('uma leitura que nunca resolve não trava as seguintes (e a resposta tardia cai fora)', async () => {
    let soltar: (t: string) => void = () => undefined
    const t = montar([
      () => new Promise<string>((r) => (soltar = r)),
      () => Promise.resolve('NOVO\n'),
    ])
    expect(t.marca().kind).toBe('lendo')
    t.avanca(119_000)
    t.marca()
    expect(t.chamadas()).toBe(1)
    t.avanca(1_000)
    t.marca()
    expect(t.chamadas()).toBe(2)
    await assenta()
    soltar('VELHO\n')
    await assenta()
    expect(t.marca()).toMatchObject({ kind: 'ok' })
    expect(JSON.stringify(t.marca())).not.toContain('VELHO')
  })

  it('mandato vazio vira erro', async () => {
    const t = montar([() => Promise.resolve('\n  \n')])
    t.marca()
    await assenta()
    expect(t.marca()).toEqual({ kind: 'erro', erro: 'mandato vazio' })
  })

  it('lerMandato que lança de forma síncrona também não rejeita', async () => {
    const marca = criarMarcaEmCache(
      () => {
        throw new Error('quebrou')
      },
      () => 0,
    )
    expect(marca()).toEqual({ kind: 'lendo' })
    await assenta()
    expect(marca()).toEqual({ kind: 'erro', erro: 'quebrou' })
  })
})

describe('worktreesDo', () => {
  it('só os nomes das pastas; erro dá lista vazia', () => {
    const base = join(RAIZ, 'node_modules', `.oc-fabrica-teste-${randomUUID()}`)
    mkdirSync(join(base, 'operations-center-1-a'), { recursive: true })
    writeFileSync(join(base, 'arquivo.txt'), '')
    try {
      expect(worktreesDo(base)).toEqual(['operations-center-1-a'])
      expect(worktreesDo(join(base, 'nao-existe'))).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('lerRecursos com o flock de verdade', () => {
  it.skipIf(process.platform !== 'linux')(
    'um flock numa pasta operations-center-777 vira ocupada, card 777',
    async () => {
      const base = join(RAIZ, 'node_modules', `.oc-fabrica-teste-${randomUUID()}`)
      const cwd = join(base, 'operations-center-777-recursos')
      mkdirSync(cwd, { recursive: true })
      const arquivo = join(base, 'suite.lock')
      writeFileSync(arquivo, '')
      let flock: ChildProcess | undefined
      try {
        flock = spawn('flock', [arquivo, 'sleep', '30'], { cwd, stdio: 'ignore' })
        const inode = statSync(arquivo).ino
        const limite = Date.now() + 10_000
        while (!new RegExp(`:${inode} `).test(readFileSync('/proc/locks', 'utf8'))) {
          if (Date.now() > limite) throw new Error('o flock não apareceu em /proc/locks')
          await new Promise((r) => setTimeout(r, 50))
        }
        const r = lerRecursos(
          portasReais({
            env: { OC_SMOKE_CADEADO: arquivo },
            pastaDaFabrica: base,
            nomesDosRepos: ['operations-center'],
            marca: () => ({ kind: 'ok', marca: 'M' }),
          }),
        )
        expect(r.suite).toEqual({ kind: 'ocupada', card: 777, esperando: 0 })
        expect(r.disco.kind).toBe('ok')
      } finally {
        flock?.kill()
        rmSync(base, { recursive: true, force: true })
      }
    },
  )
})
