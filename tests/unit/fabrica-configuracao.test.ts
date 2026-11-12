import { describe, expect, it } from 'vitest'
import {
  boardPadrao,
  checkoutPrincipalDe,
  descreverRepos,
  lerRepo,
  mesmoRepo,
  motivoSemMandato,
  nomeDoRepo,
  parseConfiguracao,
  repoDoBoard,
  resolverBoard,
  type ReposDoBoard,
} from '../../src/core/fabrica/configuracao'
import { configuracaoDaFabrica } from '../../src/main/fabrica/configuracao'
import { boardFicticio, configuracaoDeTeste } from './fabrica-board-de-teste'

const HOME = '/home/u'

type Obj = Record<string, unknown>
interface Board extends Obj {
  proibidos: Obj
  mandato?: Obj
}
interface Cru extends Obj {
  boards: Board[]
}

function minimo(): Cru {
  return {
    versao: 1,
    padrao: 'a/1',
    boards: [
      {
        owner: 'a',
        projeto: 1,
        nome: 'A',
        repo: 'a/r',
        workspace: '/w',
        checkoutPrincipal: '/w/r',
        pastaDoEstado: '/w/estado',
        proibidos: { caminhos: ['/w/vivo'], motivo: 'm' },
        mandato: { repo: 'a/r', ref: 'dev', caminho: 'f/M.md', aprovacao: 'x' },
      },
    ],
  }
}

describe('o boards.json versionado', () => {
  const c = configuracaoDaFabrica(HOME)
  it('parseia, com uma entrada só, que é o padrão', () => {
    expect(c.boards).toHaveLength(1)
    expect(c.padrao).toBe('leonardo-amaral-3/2')
    expect(boardPadrao(c)).toBe(c.boards[0])
  })
  it('traz os valores do operations-center', () => {
    const b = boardPadrao(c)
    expect(b.repo).toEqual({ owner: 'leonardo-amaral-3', name: 'operations-center' })
    expect(b.repoUnico).toEqual({ owner: 'leonardo-amaral-3', name: 'operations-center' })
    expect(b.repos).toEqual({ tipo: 'lista', repos: [b.repoUnico] })
    expect(checkoutPrincipalDe(b, b.repoUnico)).toBe('/home/u/pessoal/operations-center')
    expect(b.projeto).toBe(2)
    expect(b.nome).toBe('Operations Center')
    expect(b.workspace).toBe('/home/u/pessoal')
    expect(b.checkoutPrincipal).toBe('/home/u/pessoal/operations-center')
    expect(b.pastaDoEstado).toBe('/home/u/pessoal/claude/despachos-fabrica')
    expect(b.mandato).toMatchObject({ ref: 'dev', caminho: 'fabrica/MANDATO.md' })
    expect(b.proibidos.caminhos).toEqual([
      '/home/u/.local/bin/operations-center',
      '/home/u/.config/operations-center',
      '/home/u/notoria',
    ])
    expect(b.proibidos.motivo).toBe(
      'a instalação viva, o checkout principal ou os repos da Notoria',
    )
  })
})

describe('parseConfiguracao', () => {
  const mexer = (f: (m: Cru) => void): unknown => {
    const m = minimo()
    f(m)
    return m
  }
  const casos: [string, unknown, string][] = [
    ['não é um objeto (null)', null, 'não é um objeto'],
    ['não é um objeto (array)', [], 'não é um objeto'],
    ['versao', mexer((m) => (m.versao = 2)), 'versao'],
    ['boards vazio', mexer((m) => (m.boards = [])), 'boards'],
    ['boards[i] não objeto', mexer((m) => ((m as Obj).boards = [1])), 'boards[0]'],
    ['owner', mexer((m) => (m.boards[0]!.owner = 'a b')), 'boards[0].owner'],
    ['projeto', mexer((m) => (m.boards[0]!.projeto = 0)), 'boards[0].projeto'],
    ['nome', mexer((m) => (m.boards[0]!.nome = '  ')), 'boards[0].nome'],
    ['repo', mexer((m) => (m.boards[0]!.repo = 'sem-barra')), 'boards[0].repo'],
    ['workspace', mexer((m) => (m.boards[0]!.workspace = 'rel')), 'boards[0].workspace'],
    [
      'checkoutPrincipal',
      mexer((m) => delete m.boards[0]!.checkoutPrincipal),
      'boards[0].checkoutPrincipal',
    ],
    ['pastaDoEstado', mexer((m) => (m.boards[0]!.pastaDoEstado = 3)), 'boards[0].pastaDoEstado'],
    ['proibidos', mexer((m) => ((m.boards[0] as Obj).proibidos = 'x')), 'boards[0].proibidos'],
    [
      'proibidos.caminhos[j]',
      mexer((m) => (m.boards[0]!.proibidos.caminhos = ['/ok', 'rel'])),
      'boards[0].proibidos.caminhos[1]',
    ],
    [
      'proibidos.motivo',
      mexer((m) => (m.boards[0]!.proibidos.motivo = '')),
      'boards[0].proibidos.motivo',
    ],
    ['mandato não objeto', mexer((m) => ((m.boards[0] as Obj).mandato = 'x')), 'boards[0].mandato'],
    ['mandato.repo', mexer((m) => (m.boards[0]!.mandato!.repo = 'x')), 'boards[0].mandato.repo'],
    ['mandato.ref', mexer((m) => (m.boards[0]!.mandato!.ref = 'a b')), 'boards[0].mandato.ref'],
    [
      'mandato.caminho com ..',
      mexer((m) => (m.boards[0]!.mandato!.caminho = 'a/../b')),
      'boards[0].mandato.caminho',
    ],
    [
      'mandato.caminho absoluto',
      mexer((m) => (m.boards[0]!.mandato!.caminho = '/a')),
      'boards[0].mandato.caminho',
    ],
    [
      'mandato.aprovacao',
      mexer((m) => (m.boards[0]!.mandato!.aprovacao = '')),
      'boards[0].mandato.aprovacao',
    ],
    [
      'chave repetida',
      mexer((m) => {
        const b = { ...m.boards[0]!, pastaDoEstado: '/w/outra' }
        m.boards.push(b)
      }),
      'boards[1]: chave repetida a/1',
    ],
    [
      'pastaDoEstado repetida',
      mexer((m) => m.boards.push({ ...m.boards[0]!, projeto: 2 })),
      'boards[1].pastaDoEstado: repetida',
    ],
    ['padrao', mexer((m) => (m.padrao = 'z/9')), 'padrao'],
  ]
  it.each(casos)('%s', (_n, bruto, onde) => {
    expect(() => parseConfiguracao(bruto, HOME)).toThrow(
      new Error(`fabrica/boards.json ilegível: ${onde}`),
    )
  })

  it('expande ~, ~/x e /x/', () => {
    const m = minimo()
    m.boards[0]!.workspace = '~'
    m.boards[0]!.checkoutPrincipal = '~/x'
    m.boards[0]!.pastaDoEstado = '/x/'
    const b = boardPadrao(parseConfiguracao(m, HOME))
    expect([b.workspace, b.checkoutPrincipal, b.pastaDoEstado]).toEqual([HOME, '/home/u/x', '/x'])
  })
  it('ignora campo desconhecido, e mandato ausente vira null', () => {
    const m = minimo()
    m.boards[0]!.extra = 1
    delete m.boards[0]!.mandato
    m.boards[0]!.mandatos = { repo: 'a/r' }
    expect(boardPadrao(parseConfiguracao(m, HOME)).mandato).toBeNull()
  })
})

describe('resolverBoard', () => {
  const c = configuracaoDeTeste({
    home: HOME,
    workspace: '/w',
    extras: [boardFicticio({ home: HOME, raiz: '/r', mandato: false })],
  })
  it('null → o padrão', () => {
    const r = resolverBoard(c, null)
    expect(r.ok && r.board.chave).toBe('leonardo-amaral-3/2')
  })
  it('chave desconhecida', () => {
    expect(resolverBoard(c, 'ninguem/9')).toEqual({
      ok: false,
      motivo:
        'o board ninguem/9 não está configurado em fabrica/boards.json: falta a entrada dele (repo, workspace, pasta de estado e mandato)',
    })
  })
  it('sem mandato', () => {
    const esperado =
      'o board fulano/7 (Board Fictício) não tem mandato aprovado: falta o campo mandato em fabrica/boards.json'
    expect(resolverBoard(c, 'fulano/7')).toEqual({ ok: false, motivo: esperado })
    expect(motivoSemMandato({ chave: 'fulano/7', nome: 'Board Fictício' })).toBe(esperado)
  })
  it('com mandato, devolve o board', () => {
    const c2 = configuracaoDeTeste({
      home: HOME,
      workspace: '/w',
      extras: [boardFicticio({ home: HOME, raiz: '/r', mandato: true })],
    })
    const r = resolverBoard(c2, 'fulano/7')
    expect(r.ok && nomeDoRepo(r.board.mandato.repo)).toBe('fulano/repo-x')
  })
})

describe('os helpers de repo do board (CA-1)', () => {
  const A = { owner: 'fulano', name: 'repo-a' }
  const B = { owner: 'fulano', name: 'repo-b' }
  const lista: ReposDoBoard = { tipo: 'lista', repos: [A, B] }
  const dono: ReposDoBoard = { tipo: 'owner', owner: 'fulano' }

  it('lerRepo e mesmoRepo', () => {
    expect(lerRepo('fulano/repo-a')).toEqual(A)
    expect(lerRepo('repo-a')).toBeNull()
    expect(lerRepo(7)).toBeNull()
    expect(mesmoRepo(A, { ...A })).toBe(true)
    expect(mesmoRepo(A, B)).toBe(false)
    expect(mesmoRepo(A, { owner: 'Fulano', name: 'repo-a' })).toBe(false)
  })
  it('checkoutPrincipalDe: o declarado só para o repo único', () => {
    const declarado = { workspace: '/w', checkoutPrincipal: '/x/a', repoUnico: A }
    expect(checkoutPrincipalDe(declarado, A)).toBe('/x/a')
    expect(checkoutPrincipalDe(declarado, B)).toBe('/w/repo-b')
    expect(
      checkoutPrincipalDe({ workspace: '/w', checkoutPrincipal: '/x/a', repoUnico: null }, B),
    ).toBe('/w/repo-b')
  })
  it('descreverRepos', () => {
    expect(descreverRepos(lista)).toBe('fulano/repo-a, fulano/repo-b')
    expect(descreverRepos(dono)).toBe('qualquer repo de fulano')
  })
  it('repoDoBoard: lista com e sem owner', () => {
    expect(repoDoBoard({ repos: lista }, null, 'repo-b')).toEqual(B)
    expect(repoDoBoard({ repos: lista }, 'fulano', 'repo-a')).toEqual(A)
    expect(repoDoBoard({ repos: lista }, 'outro', 'repo-a')).toBeNull()
    expect(repoDoBoard({ repos: lista }, null, 'repo-z')).toBeNull()
  })
  it('repoDoBoard: forma owner', () => {
    expect(repoDoBoard({ repos: dono }, null, 'qualquer')).toEqual({
      owner: 'fulano',
      name: 'qualquer',
    })
    expect(repoDoBoard({ repos: dono }, 'fulano', 'x.y_z')).toEqual({
      owner: 'fulano',
      name: 'x.y_z',
    })
    expect(repoDoBoard({ repos: dono }, 'outro', 'x')).toBeNull()
    expect(repoDoBoard({ repos: dono }, null, '..')).toBeNull()
    expect(repoDoBoard({ repos: dono }, null, '.')).toBeNull()
    expect(repoDoBoard({ repos: dono }, null, 'a b')).toBeNull()
  })
  it('boardPadrao lança se o board não tem repo único', () => {
    const c = parseConfiguracao(minimo(), HOME)
    const sem = { ...c, boards: [{ ...c.boards[0]!, repoUnico: null }] }
    expect(() => boardPadrao(sem)).toThrow(new Error('fabrica/boards.json ilegível: padrao'))
  })
})
