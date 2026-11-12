import { describe, expect, it } from 'vitest'
import {
  boardPadrao,
  motivoSemMandato,
  nomeDoRepo,
  parseConfiguracao,
  resolverBoard,
} from '../../src/core/fabrica/configuracao'
import { avaliarComando, caminhosProibidos } from '../../src/core/fabrica/mandato'
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
    [
      'pastaDoEstado repetida com barra final',
      mexer((m) => {
        m.boards[0]!.pastaDoEstado = '~/a'
        m.boards.push({ ...m.boards[0]!, projeto: 2, pastaDoEstado: '~/a/' })
      }),
      'boards[1].pastaDoEstado: repetida',
    ],
    ['padrao', mexer((m) => (m.padrao = 'z/9')), 'padrao'],
  ]
  it.each(casos)('%s', (_n, bruto, onde) => {
    expect(() => parseConfiguracao(bruto, HOME)).toThrow(
      new Error(`fabrica/boards.json ilegível: ${onde}`),
    )
  })

  it.each([
    ['~/x', '/home/u/x'],
    ['~/x/', '/home/u/x'],
    ['/x', '/x'],
    ['/x/', '/x'],
  ])('lê %s como %s em todos os campos de caminho', (valor, esperado) => {
    const m = minimo()
    const b0 = m.boards[0]!
    b0.workspace = valor
    b0.checkoutPrincipal = valor
    b0.pastaDoEstado = valor
    b0.proibidos = { ...b0.proibidos, caminhos: [valor] }
    const b = boardPadrao(parseConfiguracao(m, HOME))
    expect([b.workspace, b.checkoutPrincipal, b.pastaDoEstado, ...b.proibidos.caminhos]).toEqual([
      esperado,
      esperado,
      esperado,
      esperado,
    ])
  })
  it('~ e ~/ são a home, / é a raiz', () => {
    const m = minimo()
    m.boards[0]!.workspace = '~'
    m.boards[0]!.checkoutPrincipal = '~/'
    m.boards[0]!.pastaDoEstado = '/'
    const b = boardPadrao(parseConfiguracao(m, HOME))
    expect([b.workspace, b.checkoutPrincipal, b.pastaDoEstado]).toEqual([HOME, HOME, '/'])
    const m2 = minimo()
    m2.boards[0]!.workspace = '~'
    expect(boardPadrao(parseConfiguracao(m2, '/home/u/')).workspace).toBe('/home/u')
    expect(boardPadrao(parseConfiguracao(m2, '/home/u//')).workspace).toBe('/home/u')
  })
  it('o proibido ~/notoria/ sai igual ao ~/notoria e barra o caminho absoluto', () => {
    const com = minimo()
    com.boards[0]!.proibidos = { ...com.boards[0]!.proibidos, caminhos: ['~/notoria/'] }
    const sem = minimo()
    sem.boards[0]!.proibidos = { ...sem.boards[0]!.proibidos, caminhos: ['~/notoria'] }
    const b = boardPadrao(parseConfiguracao(com, HOME))
    expect(b.proibidos.caminhos).toEqual(['/home/u/notoria'])
    expect(boardPadrao(parseConfiguracao(sem, HOME)).proibidos.caminhos).toEqual([
      '/home/u/notoria',
    ])
    expect(avaliarComando('/gm-card /home/u/notoria', caminhosProibidos(HOME, b))).toEqual({
      ok: false,
      motivo: 'o argumento aponta para m',
    })
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
