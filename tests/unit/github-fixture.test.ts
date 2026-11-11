import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MANDATO_DA_DEV_QUERY } from '../../src/core/fabrica/mandato'
import { lerMandatoPelaGraphQL } from '../../src/main/fabrica/github'
import { RELATORIO_MOVIDOS_QUERY, lerCards } from '../../src/core/relatorio'
import { documentoDosCards } from '../../src/core/relatorio/board'
import { createFixtureGraphQL } from '../../src/main/github/fixture'

const SMOKE = join(__dirname, '..', 'fixtures', 'relatorio', 'smoke.json')
const SEM_BOARD = '/nao/existe/board.json'

describe('createFixtureGraphQL, os documentos do relatório', () => {
  it('movidos devolve o envelope do arquivo', async () => {
    const graphql = createFixtureGraphQL({ board: SEM_BOARD, relatorio: SMOKE })

    const resposta = await graphql(RELATORIO_MOVIDOS_QUERY, {})
    const data = resposta.data as { user: { projectV2: { items: { nodes: unknown[] } } } }

    expect(data.user.projectV2.items.nodes).toHaveLength(1)
    expect(resposta.errors?.[0]?.message).toContain('Organization')
  })

  it('cards com c118 presente e c999 ausente devolve o nó e o NOT_FOUND com o path', async () => {
    const graphql = createFixtureGraphQL({ board: SEM_BOARD, relatorio: SMOKE })

    const resposta = await graphql(documentoDosCards([118, 999]), {})
    const repository = (resposta.data as { repository: Record<string, { title?: string } | null> })
      .repository

    expect(repository['c118']?.title).toContain('Fábrica agêntica')
    expect(repository['c999']).toBeNull()
    expect(resposta.errors).toEqual([
      {
        message: 'Could not resolve to an issue or pull request',
        type: 'NOT_FOUND',
        path: ['repository', 'c999'],
      },
    ])
  })

  it('cards todos presentes não leva `errors`', async () => {
    const graphql = createFixtureGraphQL({ board: SEM_BOARD, relatorio: SMOKE })

    const resposta = await graphql(documentoDosCards([118]), {})

    expect('errors' in resposta).toBe(false)
  })

  it('o leitor de cards do core lê a fixture e trata o ausente', async () => {
    const graphql = createFixtureGraphQL({ board: SEM_BOARD, relatorio: SMOKE })

    const cards = await lerCards(graphql, {
      owner: 'leonardo-amaral-3',
      name: 'operations-center',
      projeto: 2,
      numeros: [118, 999],
    })

    expect([...cards.keys()]).toEqual([118])
  })

  it('sem `relatorio`, os dois documentos respondem o erro da fixture', async () => {
    const graphql = createFixtureGraphQL({ board: SEM_BOARD })
    const esperado = {
      data: null,
      errors: [{ message: 'sem fixture do relatório (OC_RELATORIO_FIXTURE)' }],
    }

    expect(await graphql(RELATORIO_MOVIDOS_QUERY, {})).toEqual(esperado)
    expect(await graphql(documentoDosCards([118]), {})).toEqual(esperado)
  })

  it('documento que não é do relatório continua indo para o board', async () => {
    const graphql = createFixtureGraphQL({ board: SEM_BOARD, relatorio: SMOKE })

    await expect(graphql('query Outro { x }', { owner: 'a', number: 1 })).rejects.toThrow()
  })
})

describe('createFixtureGraphQL, o mandato da dev', () => {
  it('com `mandato`, devolve o texto do arquivo no envelope do GitHub', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'oc-mandato-'))
    try {
      const arquivo = join(pasta, 'mandato.txt')
      writeFileSync(arquivo, 'MANDATO DA PROVA\nresto\n')
      const graphql = createFixtureGraphQL({ board: SEM_BOARD, mandato: arquivo })

      expect(await graphql(MANDATO_DA_DEV_QUERY, {})).toEqual({
        data: { repository: { object: { text: 'MANDATO DA PROVA\nresto\n' } } },
        errors: undefined,
      })
      expect(await lerMandatoPelaGraphQL(graphql)).toBe('MANDATO DA PROVA\nresto\n')
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  it('sem `mandato`, lança o aviso da fixture', async () => {
    const graphql = createFixtureGraphQL({ board: SEM_BOARD })

    await expect(graphql(MANDATO_DA_DEV_QUERY, {})).rejects.toThrow(
      'sem fixture do mandato (OC_FABRICA_MANDATO_FIXTURE)',
    )
  })
})
