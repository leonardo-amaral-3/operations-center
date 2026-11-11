import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { gerarRelatorio } from '../../src/main/relatorio/gerar'
import { responderRelatorio, type DepsDaSalaDoRelatorio } from '../../src/main/relatorio/sala'
import { graphqlDe10de11 } from '../fixtures/relatorio/board-2026-11-10'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const COFRE = join(
  fileURLToPath(new URL('../fixtures/relatorio/', import.meta.url)),
  'cofre-2026-11-10',
)
const AGORA = '2026-11-11T12:00:00.000Z'

function deps(troca: Partial<DepsDaSalaDoRelatorio> = {}): DepsDaSalaDoRelatorio {
  return {
    env: { OC_RELATORIO_COFRE: '/cofre/falso', OC_RELATORIO_REPO: '/repo/falso' },
    home: '/home/falso',
    agora: () => new Date(AGORA),
    emVoo: new Map(),
    existe: (caminho) => caminho === '/cofre/falso' || caminho === '/repo/falso',
    listarPasta: () => Promise.resolve(readdirSync(COFRE)),
    lerArquivo: (caminho) =>
      Promise.resolve(readFileSync(join(COFRE, caminho.split('/').pop()!), 'utf8')),
    git: () => Promise.resolve(''),
    graphql: vi.fn(graphqlDe10de11),
    ...troca,
  }
}

describe('responderRelatorio (canal do relatório, spec-p3 §B2)', () => {
  it('data inválida, ou pedido sem dia, dá o erro exato', async () => {
    for (const pedido of [{ dia: '2026-02-30' }, { dia: 7 }, null, 'x']) {
      const r = await responderRelatorio(deps(), pedido)

      expect(r).toMatchObject({ kind: 'erro', erro: 'data inválida (use AAAA-MM-DD)' })
    }
    expect(await responderRelatorio(deps(), { dia: '2026-02-30' })).toMatchObject({
      dia: '2026-02-30',
    })
  })

  it('cofre ausente e repo ausente dão os erros exatos', async () => {
    const semCofre = deps({ existe: (c) => c !== '/cofre/falso' })
    const semRepo = deps({ existe: (c) => c !== '/repo/falso' })

    expect(await responderRelatorio(semCofre, { dia: '2026-11-10' })).toEqual({
      kind: 'erro',
      dia: '2026-11-10',
      erro: 'a pasta do cofre não existe: /cofre/falso',
    })
    expect(await responderRelatorio(semRepo, { dia: '2026-11-10' })).toEqual({
      kind: 'erro',
      dia: '2026-11-10',
      erro: 'a pasta do repo não existe: /repo/falso',
    })
  })

  it('sem variáveis, as pastas saem do home', async () => {
    const d = deps({ env: {}, existe: () => false })

    expect(await responderRelatorio(d, { dia: '2026-11-10' })).toMatchObject({
      erro: 'a pasta do cofre não existe: /home/falso/notoria/claude/decisoes',
    })
    d.existe = (c) => c === '/home/falso/notoria/claude/decisoes'
    expect(await responderRelatorio(d, { dia: '2026-11-10' })).toMatchObject({
      erro: 'a pasta do repo não existe: /home/falso/pessoal/operations-center',
    })
  })

  it('ok traz o markdown do gerarRelatorio', async () => {
    const d = deps()
    const esperado = await gerarRelatorio(d, {
      dia: '2026-11-10',
      pastaDoCofre: '/cofre/falso',
      pastaDoRepo: '/repo/falso',
      geradoEm: AGORA,
    })
    const r = await responderRelatorio(deps(), { dia: '2026-11-10' })

    expect(r).toEqual({
      kind: 'ok',
      dia: '2026-11-10',
      markdown: esperado.markdown,
      semFonte: esperado.semFonte,
      geradoEm: AGORA,
    })
  })

  it('uma exceção do graphql vira erro com a mensagem, sem rejeitar', async () => {
    const r = await responderRelatorio(
      deps({ graphql: () => Promise.reject(new Error('rede caiu')) }),
      { dia: '2026-11-10' },
    )

    expect(r).toEqual({ kind: 'erro', dia: '2026-11-10', erro: 'rede caiu' })
  })

  it('dois pedidos do mesmo dia com um em voo consultam o board uma vez só', async () => {
    const graphql = vi.fn(graphqlDe10de11)
    const d = deps({ graphql })
    const a = responderRelatorio(d, { dia: '2026-11-10' })
    const b = responderRelatorio(d, { dia: '2026-11-10' })

    expect(b).toBe(a)
    await Promise.all([a, b])
    const movidos = graphql.mock.calls.filter(([doc]) =>
      String(doc).includes('query RelatorioMovidos'),
    )

    expect(movidos).toHaveLength(1)
    expect(d.emVoo.size).toBe(0)
    await responderRelatorio(d, { dia: '2026-11-10' })
    expect(
      graphql.mock.calls.filter(([doc]) => String(doc).includes('query RelatorioMovidos')),
    ).toHaveLength(2)
  })
})
