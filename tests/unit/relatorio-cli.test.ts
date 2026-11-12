import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { executar, type DepsDoCli } from '../../src/main/relatorio/cli'
import { graphqlDe10de11 } from '../fixtures/relatorio/board-2026-11-10'

const FIXTURES = fileURLToPath(new URL('../fixtures/relatorio/', import.meta.url))
const COFRE = join(FIXTURES, 'cofre-2026-11-10')
const COFRE_FALSO = '/cofre/falso'

interface Rodada {
  deps: DepsDoCli
  saida: string[]
  avisos: string[]
  graphql: ReturnType<typeof vi.fn>
}

function rodada(argv: string[], troca: Partial<DepsDoCli> = {}): Rodada {
  const saida: string[] = []
  const avisos: string[] = []
  const graphql = vi.fn(graphqlDe10de11)
  const deps: DepsDoCli = {
    argv,
    agora: () => new Date('2026-11-11T12:00:00Z'),
    home: '/home/falso',
    cwd: '/repo/falso',
    existe: (caminho) =>
      caminho === COFRE_FALSO || caminho === '/home/falso/notoria/claude/decisoes',
    listarPasta: () => Promise.resolve(readdirSync(COFRE)),
    lerArquivo: (caminho) =>
      Promise.resolve(readFileSync(join(COFRE, caminho.split('/').pop()!), 'utf8')),
    git: () => Promise.resolve(''),
    graphql,
    escrever: (texto) => saida.push(texto),
    avisar: (texto) => avisos.push(texto),
    ...troca,
  }

  return { deps, saida, avisos, graphql }
}

describe('executar (CLI do relatório, spec-p1 §8)', () => {
  it('CA-1.1: fixture de 10/11 e git vazio → 0, um único escrever, com o cabeçalho', async () => {
    const r = rodada(['2026-11-10', '--cofre', COFRE_FALSO])

    expect(await executar(r.deps)).toBe(0)
    expect(r.saida).toHaveLength(1)
    expect(r.saida[0]).toMatch(
      /^# Relatório do dia 2026-11-10 · leonardo-amaral-3\/operations-center\n/,
    )
    expect(r.avisos).toEqual([])
  })

  it('CA-1.2: commit de sha vazio → 0 e o aviso no singular', async () => {
    const r = rodada(['2026-11-10', '--cofre', COFRE_FALSO], {
      git: () => Promise.resolve('\x1f2026-11-10T12:00:00-03:00\x1fassunto\x1f\x1e'),
    })

    expect(await executar(r.deps)).toBe(0)
    expect(r.avisos).toEqual(['relatorio: 1 linha sem fonte ficou de fora'])
  })

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '10/11/2026'])(
    'data inválida %s → 1',
    async (data) => {
      const r = rodada([data, '--cofre', COFRE_FALSO])

      expect(await executar(r.deps)).toBe(1)
      expect(r.avisos).toEqual([`relatorio: data inválida: ${data} (use AAAA-MM-DD)`])
      expect(r.saida).toEqual([])
    },
  )

  it('argumento desconhecido e segunda data → 1 com o uso', async () => {
    const uso = 'uso: yarn relatorio [AAAA-MM-DD] [--cofre <pasta>]'
    const a = rodada(['--x'])
    const b = rodada(['2026-11-10', '2026-11-11'])

    expect(await executar(a.deps)).toBe(1)
    expect(a.avisos).toEqual(['relatorio: argumento desconhecido: --x', uso])
    expect(await executar(b.deps)).toBe(1)
    expect(b.avisos).toEqual(['relatorio: argumento desconhecido: 2026-11-11', uso])
  })

  it('--cofre sem valor → 1', async () => {
    const r = rodada(['2026-11-10', '--cofre'])

    expect(await executar(r.deps)).toBe(1)
    expect(r.avisos[0]).toBe('relatorio: --cofre precisa de uma pasta')
    expect(r.avisos[1]).toMatch(/^uso: /)
  })

  it('pasta do cofre inexistente → 1', async () => {
    const r = rodada(['2026-11-10', '--cofre', '/nao/existe'])

    expect(await executar(r.deps)).toBe(1)
    expect(r.avisos).toEqual(['relatorio: a pasta do cofre não existe: /nao/existe'])
  })

  it('git que rejeita → 1, a mensagem e nenhum escrever', async () => {
    const r = rodada(['2026-11-10', '--cofre', COFRE_FALSO], {
      git: () => Promise.reject(new Error('git quebrou')),
    })

    expect(await executar(r.deps)).toBe(1)
    expect(r.avisos).toEqual(['relatorio: git quebrou'])
    expect(r.saida).toEqual([])
  })

  it('dia sem nada → 0, sem chamar RelatorioCards', async () => {
    const r = rodada(['2026-10-01', '--cofre', COFRE_FALSO], {
      graphql: vi.fn(() =>
        Promise.resolve({
          data: {
            organization: null,
            user: {
              projectV2: {
                items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
              },
            },
          },
        }),
      ),
    })

    expect(await executar(r.deps)).toBe(0)
    expect(r.saida).toHaveLength(1)
    const documentos = (r.deps.graphql as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    )

    expect(documentos.some((d) => d.includes('query RelatorioCards'))).toBe(false)
  })

  it('sem data, usa o dia UTC do agora (22:30 -03 de 10/11 dá 2026-11-11)', async () => {
    const r = rodada(['--cofre', COFRE_FALSO], {
      agora: () => new Date('2026-11-10T22:30:00-03:00'),
    })

    expect(await executar(r.deps)).toBe(0)
    expect(r.saida[0]).toMatch(/^# Relatório do dia 2026-11-11 · /)
  })
})
