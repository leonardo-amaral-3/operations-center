import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { boardPadrao, nomeDoRepo } from '../../src/core/fabrica/configuracao'
import { configuracaoDaFabrica } from '../../src/main/fabrica/configuracao'

import { normalizeStation } from '../../src/core/board/stations'
import { comandoDaEstacao } from '../../src/core/fabrica/estacao'
import {
  LIMITE_DE_DESPACHOS_POR_FRENTE as LIMITE_DO_CORE,
  SKILLS_PERMITIDAS,
  avaliarNota,
  caminhosProibidos,
} from '../../src/core/fabrica/mandato'
import { LIMITE_DA_NOTA_DO_APP } from '../../src/main/fabrica/comando'
import {
  CHAVE_DO_BOARD_DA_FABRICA,
  REPO_DOS_CARDS_DA_FABRICA,
  URL_DO_MANDATO_DA_FABRICA,
  estacaoDaColuna,
} from '../../src/renderer/fabrica/boardDaFabrica'
import {
  LIMITE_DA_NOTA,
  LIMITE_DE_DESPACHOS_POR_FRENTE,
  NAO_FAZER_HOJE,
  comandoDaFrente,
  notaDoBriefing,
} from '../../src/renderer/fabrica/briefing'
import { URL_DA_DEV_PARA_MAIN, URL_DO_BOARD_DA_FABRICA } from '../../src/renderer/fabrica/trem'

/**
 * Canárias renderer × core (#135, CA-6.4). O renderer não importa `src/core/`, então os literais
 * dele são copiados; é este teste, que roda no programa do Node, que os segura iguais.
 */

const BOARD = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/board.json', import.meta.url)), 'utf8'),
) as {
  boards: Record<
    string,
    { data: { user: { projectV2: { field: { options: { name: string }[] } } } } }
  >
}

describe('os literais do renderer são os do boards.json', () => {
  it('a chave, o repo, as URLs do board, da dev para a main e do mandato', () => {
    const board = boardPadrao(configuracaoDaFabrica('/home/u'))
    const { owner, projeto } = board
    const mandato = board.mandato
    if (mandato === null) throw new Error('o board padrão tem mandato')
    expect(CHAVE_DO_BOARD_DA_FABRICA).toBe(board.chave)
    expect(REPO_DOS_CARDS_DA_FABRICA).toBe(nomeDoRepo(board.repo))
    expect(URL_DO_BOARD_DA_FABRICA).toBe(`https://github.com/users/${owner}/projects/${projeto}`)
    expect(URL_DA_DEV_PARA_MAIN).toBe(
      `https://github.com/${nomeDoRepo(board.repo)}/compare/main...dev`,
    )
    expect(URL_DO_MANDATO_DA_FABRICA).toBe(
      `https://github.com/${nomeDoRepo(mandato.repo)}/blob/${mandato.ref}/${mandato.caminho}`,
    )
  })

  it('os limites', () => {
    expect(LIMITE_DE_DESPACHOS_POR_FRENTE).toBe(LIMITE_DO_CORE)
    expect(LIMITE_DA_NOTA).toBe(LIMITE_DA_NOTA_DO_APP)
  })

  it('comandoDaFrente é o comandoDaEstacao para Backlog e Triagem', () => {
    for (const [estacao, status] of [
      ['backlog', '📋 Backlog'],
      ['triagem', '📥 Triagem'],
    ] as const) {
      expect(comandoDaEstacao(940, { noProjeto: true, status })).toEqual({
        comando: comandoDaFrente(estacao, 940),
      })
    }
  })

  it('estacaoDaColuna concorda com o normalizeStation nas oito opções de Status', () => {
    const opcoes = BOARD.boards['leonardo-amaral-3/2']?.data.user.projectV2.field.options ?? []
    expect(opcoes).toHaveLength(8)
    for (const { name } of opcoes) {
      const doCore = normalizeStation(name)
      const esperada = ['triagem', 'backlog', 'release'].includes(doCore) ? doCore : 'outra'
      expect(estacaoDaColuna(name), name).toBe(esperada)
    }
  })
})

describe('NAO_FAZER_HOJE diz o que o código aplica', () => {
  it('o item 3 cita cada skill permitida e só elas', () => {
    const citadas = [...(NAO_FAZER_HOJE[2] ?? '').matchAll(/\/(gm-[a-z-]+)/g)].map((m) => m[1])
    expect(citadas.sort()).toEqual([...SKILLS_PERMITIDAS].sort())
  })

  it('o item 1 cita as quatro palavras do textoProibido', () => {
    for (const palavra of ['main', 'release', 'tag', 'hotfix']) {
      expect(NAO_FAZER_HOJE[0]).toContain(palavra)
      expect(avaliarNota(`cita ${palavra} aqui`, { caminhos: [], motivo: 'nenhum' }).ok).toBe(false)
    }
  })
})

describe('notaDoBriefing passa no filtro do mandato', () => {
  it('um Pronto quando e um contexto limpos', () => {
    const proibidos = caminhosProibidos(
      '/home/teste',
      boardPadrao(configuracaoDaFabrica('/home/teste')),
    )
    const nota = notaDoBriefing({
      dia: '2026-11-12',
      prontoQuando: 'a spec sai',
      contexto: 'dia calmo',
    })
    expect(avaliarNota(nota, proibidos)).toEqual({ ok: true })
  })
})
