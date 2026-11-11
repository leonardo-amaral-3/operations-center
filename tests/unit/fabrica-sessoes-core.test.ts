import { describe, expect, it } from 'vitest'
import {
  cardDoCaminho,
  ehSessaoClaude,
  montarSessao,
  origemDaSessao,
  pastaVisivel,
  skillDaSessao,
} from '../../src/core/fabrica/sessoes'

const CLI_JS = '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js'

describe('ehSessaoClaude (#142)', () => {
  it.each<[string, string[], boolean]>([
    [
      'interativa nativa',
      [
        '/home/u/.local/share/mise/installs/claude/latest/claude',
        '--dangerously-skip-permissions',
        '--resume',
        'x',
      ],
      true,
    ],
    ['despachada', ['claude', '-p', '/gm-spec #142\n…'], true],
    ['chrome-native-host', ['/x/claude', '--chrome-native-host'], false],
    ['mcp', ['claude', 'mcp', 'serve'], false],
    ['--version', ['claude', '--version'], false],
    ['filho rg', ['rg', '--no-config', '-n', 'x'], false],
    ['filho apply-seccomp', ['apply-seccomp', '…'], false],
    ['cli.js', ['node', CLI_JS, '--resume', 'x'], true],
    ['cli.js doctor', ['node', CLI_JS, 'doctor'], false],
    ['filho MCP node', ['node', '/x/brain-mcp/dist/index.js'], false],
    ['vazio', [], false],
  ])('%s', (_nome, argv, esperado) => {
    expect(ehSessaoClaude(argv)).toBe(esperado)
  })
})

describe('origemDaSessao', () => {
  it('-p e --print são despachada; stream-json é sdk; o resto é interativa', () => {
    expect(origemDaSessao(['claude', '-p', 'x'])).toBe('despachada')
    expect(origemDaSessao(['claude', '--print', 'x'])).toBe('despachada')
    expect(
      origemDaSessao(['claude', '--output-format', 'stream-json', '--input-format', 'stream-json']),
    ).toBe('sdk')
    expect(origemDaSessao(['claude', '--input-format', 'text'])).toBe('interativa')
    expect(origemDaSessao(['claude', '--resume', 'x'])).toBe('interativa')
  })
})

describe('skillDaSessao', () => {
  it('lê a skill só do prompt do -p', () => {
    expect(skillDaSessao(['claude', '-p', '/gm-spec #142\n…'])).toBe('gm-spec')
    expect(skillDaSessao(['claude', '--print', '/gm-ship'])).toBe('gm-ship')
    expect(skillDaSessao(['claude', '-p', '/home/leo/x.md resuma'])).toBeNull()
    expect(skillDaSessao(['claude', '--resume', '/gm-spec x'])).toBeNull()
    expect(skillDaSessao(['claude', '-p', 'resuma isto'])).toBeNull()
  })
})

describe('pastaVisivel', () => {
  it('home, dentro, fora e a raiz', () => {
    expect(pastaVisivel('/h', '/h')).toBe('~')
    expect(pastaVisivel('/h/pessoal/x', '/h')).toBe('~/pessoal/x')
    expect(pastaVisivel('/srv/app/dados', '/h')).toBe('dados')
    expect(pastaVisivel('/hx/y', '/h')).toBe('y')
    expect(pastaVisivel('/', '/h')).toBe('/')
  })
})

describe('cardDoCaminho', () => {
  const oc = 'leonardo-amaral-3/operations-center'
  it.each<[string, number | null]>([
    ['/h/pessoal/operations-center-142-dia', 142],
    ['/h/pessoal/operations-center', null],
    ['/h/pessoal/operations-center-fabrica-prova', null],
    ['/h/pessoal/operations-center-131-x/test-results/operations-center-777-smoke', 777],
    ['/h/pessoal/operations-center-142', 142],
  ])('%s', (cwd, esperado) => {
    expect(cardDoCaminho(cwd, oc)).toBe(esperado)
  })

  it('outro board: ICSF-Solutions/plataformas', () => {
    expect(cardDoCaminho('/h/notoria/plataformas-910-x', 'ICSF-Solutions/plataformas')).toBe(910)
  })
})

describe('montarSessao', () => {
  const home = '/h'
  it('monta pasta, repo, card e a URL', () => {
    expect(
      montarSessao(
        {
          pid: 7,
          argv: ['claude', '-p', '/gm-spec #142'],
          ambiente: ['A=1', 'OC_FABRICA_DESPACHO=/x'],
          cwd: '/h/pessoal/operations-center-142-x',
        },
        'leonardo-amaral-3/operations-center',
        home,
      ),
    ).toEqual({
      pid: 7,
      origem: 'despachada',
      daFabrica: true,
      skill: 'gm-spec',
      pasta: '~/pessoal/operations-center-142-x',
      repo: 'leonardo-amaral-3/operations-center',
      card: 142,
      cardUrl: 'https://github.com/leonardo-amaral-3/operations-center/issues/142',
    })
  })

  it('cwd apagado conta como sem leitura', () => {
    const s = montarSessao(
      {
        pid: 8,
        argv: ['claude'],
        ambiente: [],
        cwd: '/h/pessoal/operations-center-142-x (deleted)',
      },
      'leonardo-amaral-3/operations-center',
      home,
    )
    expect(s.pasta).toBeNull()
    expect(s.card).toBeNull()
    expect(s.cardUrl).toBeNull()
    expect(s.skill).toBeNull()
    expect(s.daFabrica).toBe(false)
  })

  it('sem repo ou sem cwd: card e cardUrl nulos', () => {
    const s = montarSessao({ pid: 9, argv: ['claude'], ambiente: [], cwd: null }, null, home)
    expect(s).toMatchObject({ pasta: null, repo: null, card: null, cardUrl: null })
  })
})
