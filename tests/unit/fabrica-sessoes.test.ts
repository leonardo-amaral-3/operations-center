import { describe, expect, it, vi } from 'vitest'
import {
  criarOrigemEmCache,
  lerSessoesDaMaquina,
  type PortasDasSessoes,
} from '../../src/main/fabrica/sessoes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

interface Proc {
  argv: string[]
  ambiente?: string[]
  cwd?: string | null
}

function portas(
  procs: Record<number, Proc>,
  extra: Partial<PortasDasSessoes> = {},
): PortasDasSessoes {
  return {
    plataforma: 'linux',
    home: '/h',
    proprio: 1,
    pids: () => Object.keys(procs).map(Number),
    argv: (pid) => procs[pid]?.argv ?? [],
    ambiente: (pid) => procs[pid]?.ambiente ?? [],
    cwd: (pid) => (procs[pid]?.cwd === undefined ? null : procs[pid].cwd),
    origem: (pasta) =>
      Promise.resolve(
        pasta.includes('plataformas')
          ? 'https://github.com/ICSF-Solutions/plataformas.git'
          : 'git@github.com:leonardo-amaral-3/operations-center.git',
      ),
    agora: () => '2026-11-11T10:00:00.000Z',
    ...extra,
  }
}

describe('lerSessoesDaMaquina', () => {
  it('fora do Linux diz sem leitura com o motivo', async () => {
    const r = await lerSessoesDaMaquina(portas({}, { plataforma: 'darwin' }))
    expect(r).toEqual({ kind: 'sem-leitura', motivo: 'a leitura de sessões lê /proc, só no Linux' })
  })

  it('pids que lança vira sem leitura com a mensagem', async () => {
    const r = await lerSessoesDaMaquina(
      portas(
        {},
        {
          pids: () => {
            throw new Error('proc sumiu')
          },
        },
      ),
    )
    expect(r).toEqual({ kind: 'sem-leitura', motivo: 'proc sumiu' })
  })

  it('lista só sessões, em ordem de pid, sem o próprio processo', async () => {
    const r = await lerSessoesDaMaquina(
      portas({
        1: { argv: ['claude'], cwd: '/h/x' },
        30: { argv: ['claude', '-p', '/gm-spec #1'], cwd: '/h/pessoal/operations-center-777-x' },
        20: {
          argv: ['claude', '--resume', 'a'],
          cwd: '/h/notoria/plataformas-910-y',
          ambiente: ['OC_FABRICA_DESPACHO=1'],
        },
        40: { argv: ['node', '/x/brain-mcp/dist/index.js'] },
        50: { argv: ['rg', '-n', 'x'] },
        60: { argv: ['/x/claude', '--chrome-native-host'] },
      }),
    )
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.lidoEm).toBe('2026-11-11T10:00:00.000Z')
    expect(r.sessoes.map((s) => s.pid)).toEqual([20, 30])
    expect(r.sessoes[0]).toMatchObject({
      origem: 'interativa',
      daFabrica: true,
      repo: 'icsf-solutions/plataformas',
      card: 910,
    })
    expect(r.sessoes[1]).toMatchObject({
      origem: 'despachada',
      skill: 'gm-spec',
      daFabrica: false,
      card: 777,
      cardUrl: 'https://github.com/leonardo-amaral-3/operations-center/issues/777',
    })
  })

  it('origem que rejeita numa pasta zera o repo só nela', async () => {
    const r = await lerSessoesDaMaquina(
      portas(
        {
          2: { argv: ['claude'], cwd: '/h/a/plataformas-1-x' },
          3: { argv: ['claude'], cwd: '/h/a/operations-center-2-x' },
        },
        {
          origem: (pasta) =>
            pasta.includes('plataformas')
              ? Promise.reject(new Error('git'))
              : Promise.resolve('https://github.com/leonardo-amaral-3/operations-center'),
        },
      ),
    )
    if (r.kind !== 'ok') throw new Error('esperava ok')
    expect(r.sessoes[0]).toMatchObject({ pid: 2, repo: null, card: null })
    expect(r.sessoes[1]).toMatchObject({
      pid: 3,
      repo: 'leonardo-amaral-3/operations-center',
      card: 2,
    })
  })

  it('cwd nulo zera pasta, repo e card', async () => {
    const r = await lerSessoesDaMaquina(portas({ 2: { argv: ['claude'], cwd: null } }))
    if (r.kind !== 'ok') throw new Error('esperava ok')
    expect(r.sessoes[0]).toMatchObject({ pasta: null, repo: null, card: null, cardUrl: null })
  })

  it('cwd apagado não chega ao origem', async () => {
    const origem = vi.fn(() => Promise.resolve<string | null>('https://github.com/a/b'))
    const r = await lerSessoesDaMaquina(
      portas({ 2: { argv: ['claude'], cwd: '/h/p/b-5-x (deleted)' } }, { origem }),
    )
    expect(origem).not.toHaveBeenCalled()
    if (r.kind !== 'ok') throw new Error('esperava ok')
    expect(r.sessoes[0]).toMatchObject({ pasta: null, repo: null, card: null })
  })
})

describe('criarOrigemEmCache', () => {
  it('dois pedidos simultâneos fazem uma chamada', async () => {
    const origem = vi.fn(() => Promise.resolve<string | null>('u'))
    const c = criarOrigemEmCache(origem, () => 0)
    await Promise.all([c('/p'), c('/p')])
    expect(origem).toHaveBeenCalledTimes(1)
  })

  it('dentro da validade não chama; depois dela chama de novo', async () => {
    const origem = vi.fn(() => Promise.resolve<string | null>('u'))
    let t = 0
    const c = criarOrigemEmCache(origem, () => t, 1000)
    await c('/p')
    t = 999
    await c('/p')
    expect(origem).toHaveBeenCalledTimes(1)
    t = 1000
    await c('/p')
    expect(origem).toHaveBeenCalledTimes(2)
  })

  it('rejeição guarda null', async () => {
    const origem = vi.fn(() => Promise.reject<string | null>(new Error('x')))
    const c = criarOrigemEmCache(origem, () => 0)
    expect(await c('/p')).toBeNull()
    expect(await c('/p')).toBeNull()
    expect(origem).toHaveBeenCalledTimes(1)
  })
})
