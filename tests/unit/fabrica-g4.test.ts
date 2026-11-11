import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  comandoDoG4,
  lerComandoDoG4,
  lerParecer,
  prAbertaDoShip,
  promptDoG4,
} from '../../src/core/fabrica/g4'

const URL9 = 'https://github.com/leonardo-amaral-3/operations-center/pull/9#issuecomment-5'

describe('comandoDoG4 / lerComandoDoG4', () => {
  it('ida e volta', () => {
    expect(comandoDoG4(7, 9)).toBe('/g4 #7 PR #9')
    expect(lerComandoDoG4(comandoDoG4(143, 141))).toEqual({ card: 143, pr: 141 })
  })
  it.each(['/g4 #0 PR #1', '/g4 #1', '/gm-ship #1', '/g4 #1 PR #2 x'])('%s → null', (c) => {
    expect(lerComandoDoG4(c)).toBeNull()
  })
})

describe('prAbertaDoShip', () => {
  it('lê a forma de PR aberta', () => {
    expect(prAbertaDoShip('PR #9 aberta na dev (Card: #7); o merge é da orquestradora')).toBe(9)
  })
  it.each(['verificação vermelha na PR #9', 'PR #0 aberta', 'sem PR'])('%s → null', (m) => {
    expect(prAbertaDoShip(m)).toBeNull()
  })
})

describe('lerParecer', () => {
  it('sem bloqueante → 0', () => {
    expect(lerParecer(`G4 da PR #9: sem bloqueante · parecer ${URL9}`)).toEqual({
      pr: 9,
      bloqueantes: 0,
      url: URL9,
    })
  })
  it('1 bloqueante e 3 bloqueantes', () => {
    expect(lerParecer(`G4 da PR #9: 1 bloqueante · parecer ${URL9}`)?.bloqueantes).toBe(1)
    expect(lerParecer(`G4 da PR #9: 3 bloqueantes · parecer ${URL9}`)?.bloqueantes).toBe(3)
    expect(lerParecer(`G4 da PR #9: 1 bloqueantes · parecer ${URL9}`)?.bloqueantes).toBe(1)
    expect(lerParecer(`G4 da PR #9: 2 bloqueante · parecer ${URL9}`)?.bloqueantes).toBe(2)
  })
  it.each([
    ['0 bloqueantes', `G4 da PR #9: 0 bloqueantes · parecer ${URL9}`],
    ['PR da URL diferente', `G4 da PR #8: sem bloqueante · parecer ${URL9}`],
    [
      'outro repo',
      'G4 da PR #9: sem bloqueante · parecer https://github.com/outro/repo/pull/9#issuecomment-5',
    ],
    ['sem URL', 'G4 da PR #9: sem bloqueante · parecer'],
    ['não rodou', 'G4 da PR #9 não rodou: PR fechada'],
    ['texto depois da URL', `G4 da PR #9: sem bloqueante · parecer ${URL9} ok`],
  ])('%s → null', (_n, motivo) => {
    expect(lerParecer(motivo)).toBeNull()
  })
})

describe('promptDoG4', () => {
  const p = promptDoG4(7, 9)
  it('começa pela revisão e não por barra', () => {
    expect(p.startsWith('Revisão G4 da PR #9 do card #7')).toBe(true)
    expect(p.startsWith('/')).toBe(false)
  })
  it('leva o marcador e as duas linhas de fim', () => {
    expect(p).toContain('<!-- gm:g4 -->')
    expect(p).toContain('PARADA: G4 da PR #9: sem bloqueante · parecer <url do comentário>')
    expect(p).toContain('PARADA: G4 da PR #9: <N> bloqueante(s) · parecer <url do comentário>')
    expect(p.endsWith('\n')).toBe(false)
  })
})

describe('fabrica/README.md', () => {
  it('descreve a estação G4 antes de "Por que não no CLAUDE.md"', () => {
    const readme = readFileSync('fabrica/README.md', 'utf8')
    const g4 = readme.indexOf('## A estação G4 do yarn fabrica')
    const claude = readme.indexOf('## Por que não no CLAUDE.md')
    expect(g4).toBeGreaterThan(-1)
    expect(claude).toBeGreaterThan(g4)
  })
})
