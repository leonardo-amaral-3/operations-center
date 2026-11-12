import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseConfiguracao } from '../../src/core/fabrica/configuracao'
import { configuracaoDaFabrica } from '../../src/main/fabrica/configuracao'
import {
  FORMA_DA_CHAVE,
  boardDoPedido,
  boardNaFabrica,
  fontesDoApp,
} from '../../src/main/fabrica/boardDoApp'
import { configuracaoComDoisBoards } from './fabrica-board-de-teste'

// Os mesmos campos de `tests/renderer/boardNaFabrica.ts` (`BOARD_DO_PROJECT_2`, `BOARD_DE_DOIS_REPOS`):
// `tests/unit/` roda no programa do Node e não importa de `tests/renderer/` (TS6307, ver tsconfig.node.json).
// O mapa de fixtures do renderer e este têm de dizer o mesmo; o `Fabrica.test.tsx` usa os do renderer.
const BOARD_DO_PROJECT_2 = {
  kind: 'ok',
  chave: 'leonardo-amaral-3/2',
  nome: 'Operations Center',
  projeto: 2,
  padrao: true,
  owner: 'leonardo-amaral-3',
  repos: ['leonardo-amaral-3/operations-center'],
  unico: 'leonardo-amaral-3/operations-center',
  urlDoMandato:
    'https://github.com/leonardo-amaral-3/operations-center/blob/dev/fabrica/MANDATO.md',
}
const BOARD_DE_DOIS_REPOS = {
  kind: 'ok',
  chave: 'fulano/8',
  nome: 'Board de Dois Repos',
  projeto: 8,
  padrao: false,
  owner: 'fulano',
  repos: ['fulano/repo-a', 'fulano/repo-b'],
  unico: null,
  urlDoMandato: 'https://github.com/fulano/repo-a/blob/dev/fabrica/MANDATO.md',
}

const pastas: string[] = []
function raiz(): string {
  const r = mkdtempSync(join(process.cwd(), 'node_modules', '.oc-board-do-app-'))
  pastas.push(r)
  return r
}
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
})

describe('boardDoPedido', () => {
  const c = () => configuracaoComDoisBoards({ raiz: raiz(), home: '/h' })

  it('board null é o padrão; texto é o board pedido', () => {
    const cfg = c()
    const a = boardDoPedido(cfg, { board: null })
    expect(a.ok && a.board.chave).toBe('leonardo-amaral-3/2')
    const b = boardDoPedido(cfg, { board: 'fulano/8' })
    expect(b.ok && b.board.chave).toBe('fulano/8')
  })

  it.each([
    [{}],
    [null],
    [undefined],
    ['x'],
    [{ board: 8 }],
    [{ board: 'fulano/08' }],
    [{ board: 'a/b/c' }],
  ])('pedido torto %j → pedido inválido: board', (pedido) => {
    expect(boardDoPedido(c(), pedido)).toEqual({ ok: false, motivo: 'pedido inválido: board' })
  })

  it('FORMA_DA_CHAVE', () => {
    expect(FORMA_DA_CHAVE.test('fulano/8')).toBe(true)
    expect(FORMA_DA_CHAVE.test('fulano/0')).toBe(false)
  })
})

describe('boardNaFabrica', () => {
  it('o padrão real dá exatamente o BOARD_DO_PROJECT_2', () => {
    expect(boardNaFabrica(configuracaoDaFabrica('/h'), { board: null })).toEqual(BOARD_DO_PROJECT_2)
  })

  it('o fulano/8 dá o BOARD_DE_DOIS_REPOS', () => {
    const cfg = configuracaoComDoisBoards({ raiz: raiz(), home: '/h' })
    expect(boardNaFabrica(cfg, { board: 'fulano/8' })).toEqual(BOARD_DE_DOIS_REPOS)
  })

  it('a forma fulano/* dá repos e unico nulos', () => {
    const r = raiz()
    const base = configuracaoComDoisBoards({ raiz: r, home: '/h' })
    const padrao = base.boards[0]!
    const cfg = parseConfiguracao(
      {
        versao: 1,
        padrao: padrao.chave,
        boards: [
          {
            owner: 'leonardo-amaral-3',
            projeto: 2,
            nome: 'Operations Center',
            repo: 'leonardo-amaral-3/operations-center',
            workspace: join(r, 'ws'),
            checkoutPrincipal: join(r, 'ws', 'oc'),
            pastaDoEstado: join(r, 'e1'),
            proibidos: { caminhos: [join(r, 'v')], motivo: 'm' },
            mandato: null,
          },
          {
            owner: 'fulano',
            projeto: 9,
            nome: 'Curinga',
            repos: 'fulano/*',
            workspace: join(r, 'ws9'),
            pastaDoEstado: join(r, 'e9'),
            proibidos: { caminhos: [join(r, 'v9')], motivo: 'm' },
            mandato: { repo: 'fulano/repo-a', ref: 'dev', caminho: 'M.md', aprovacao: 't' },
          },
        ],
      },
      '/h',
    )
    const b = boardNaFabrica(cfg, { board: 'fulano/9' })
    expect(b).toMatchObject({ kind: 'ok', repos: null, unico: null })
  })

  it('board fora do arquivo → recusado, com o motivo exato', () => {
    const cfg = configuracaoComDoisBoards({ raiz: raiz(), home: '/h' })
    expect(boardNaFabrica(cfg, { board: 'ICSF-Solutions/19' })).toEqual({
      kind: 'recusado',
      chave: 'ICSF-Solutions/19',
      motivo:
        'o board ICSF-Solutions/19 não está configurado em fabrica/boards.json: falta a entrada dele (repo, workspace, pasta de estado e mandato)',
    })
  })

  it('board sem mandato → recusado com o motivoSemMandato', () => {
    const cfg = configuracaoComDoisBoards({ raiz: raiz(), home: '/h', semMandato: true })
    expect(boardNaFabrica(cfg, { board: 'fulano/8' })).toEqual({
      kind: 'recusado',
      chave: 'fulano/8',
      motivo:
        'o board fulano/8 (Board de Dois Repos) não tem mandato aprovado: falta o campo mandato em fabrica/boards.json',
    })
  })

  it('pedido torto → chave vazia; null → a chave do padrão quando recusado', () => {
    const cfg = configuracaoComDoisBoards({ raiz: raiz(), home: '/h' })
    expect(boardNaFabrica(cfg, {})).toMatchObject({ kind: 'recusado', chave: '' })
  })
})

describe('fontesDoApp', () => {
  it('worktrees: sem OC_FABRICA_DIR, o workspace do board; com ela, o avô da pasta', () => {
    const r = raiz()
    mkdirSync(join(r, 'ws2', 'repo-b-7-x'), { recursive: true })
    mkdirSync(join(r, 'claude', 'estado'), { recursive: true })
    const cfg = configuracaoComDoisBoards({ raiz: r, home: '/h' })
    const b = boardDoPedido(cfg, { board: 'fulano/8' })
    if (!b.ok) throw new Error('esperava ok')
    const graphql = (() => Promise.reject(new Error('sem rede'))) as never
    const sem = fontesDoApp({ env: {}, graphql })(b.board, join(r, 'estado2'))
    expect(sem.worktrees()).toEqual(['repo-b-7-x'])
    const pasta = join(r, 'claude', 'estado')
    const com = fontesDoApp({ env: { OC_FABRICA_DIR: pasta }, graphql })(b.board, pasta)
    expect(com.worktrees()).toContain('claude')
  })
})
