import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { executar, type DepsDoCli } from '../../src/main/relatorio/cli'
import { dataValida, gerarRelatorio, type DepsDoRelatorio } from '../../src/main/relatorio/gerar'
import { graphqlDe10de11 } from '../fixtures/relatorio/board-2026-11-10'

const FIXTURES = fileURLToPath(new URL('../fixtures/relatorio/', import.meta.url))
const COFRE = join(FIXTURES, 'cofre-2026-11-10')
const COFRE_FALSO = '/cofre/falso'
const G = '2026-11-11T12:00:00.000Z'

function depsDoRelatorio(git = ''): DepsDoRelatorio {
  return {
    existe: (caminho) => caminho === COFRE_FALSO,
    listarPasta: () => Promise.resolve(readdirSync(COFRE)),
    lerArquivo: (caminho) =>
      Promise.resolve(readFileSync(join(COFRE, caminho.split('/').pop()!), 'utf8')),
    git: () => Promise.resolve(git),
    graphql: graphqlDe10de11,
  }
}

async function viaCli(git: string): Promise<{ saida: string[]; avisos: string[] }> {
  const saida: string[] = []
  const avisos: string[] = []
  const deps: DepsDoCli = {
    ...depsDoRelatorio(git),
    argv: ['2026-11-10', '--cofre', COFRE_FALSO],
    agora: () => new Date(G),
    home: '/home/falso',
    cwd: '/repo/falso',
    escrever: (texto) => saida.push(texto),
    avisar: (texto) => avisos.push(texto),
  }

  expect(await executar(deps)).toBe(0)

  return { saida, avisos }
}

describe('gerarRelatorio (spec-p3 §B1)', () => {
  it('CA-3b.1: dá o mesmo markdown que o `yarn relatorio` escreve com o mesmo geradoEm', async () => {
    const r = await gerarRelatorio(depsDoRelatorio(), {
      dia: '2026-11-10',
      pastaDoCofre: COFRE_FALSO,
      pastaDoRepo: '/repo/falso',
      geradoEm: G,
    })
    const cli = await viaCli('')

    expect(cli.saida).toEqual([r.markdown])
    expect(r.markdown).toMatch(/^# Relatório do dia 2026-11-10 · /)
    expect(r.semFonte).toBe(0)
  })

  it('o semFonte devolvido é o que o aviso do comando conta', async () => {
    const git = '\x1f2026-11-10T12:00:00-03:00\x1fassunto\x1f\x1e'
    const r = await gerarRelatorio(depsDoRelatorio(git), {
      dia: '2026-11-10',
      pastaDoCofre: COFRE_FALSO,
      pastaDoRepo: '/repo/falso',
      geradoEm: G,
    })
    const cli = await viaCli(git)

    expect(r.semFonte).toBe(1)
    expect(cli.avisos).toEqual(['relatorio: 1 linha sem fonte ficou de fora'])
  })

  it('a exceção de uma leitura sobe, sem ser engolida', async () => {
    const deps = { ...depsDoRelatorio(), git: () => Promise.reject(new Error('git quebrou')) }

    await expect(
      gerarRelatorio(deps, {
        dia: '2026-11-10',
        pastaDoCofre: COFRE_FALSO,
        pastaDoRepo: '/repo/falso',
        geradoEm: G,
      }),
    ).rejects.toThrow('git quebrou')
  })
})

describe('dataValida', () => {
  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '10/11/2026', ''])('%s é inválida', (d) => {
    expect(dataValida(d)).toBe(false)
  })

  it('aceita uma data que existe', () => {
    expect(dataValida('2026-11-10')).toBe(true)
    expect(dataValida('2028-02-29')).toBe(true)
  })
})
