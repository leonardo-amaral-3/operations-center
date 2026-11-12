import { describe, expect, it } from 'vitest'
import {
  aceitaOBoard,
  aceitaORepo,
  cardDoRegistro,
  lerAlvo,
  linhaDoRepo,
  mesmoCard,
  repoDeOutroCard,
  repoDoRegistro,
  resolverAlvo,
  rotuloDoCard,
} from '../../src/core/fabrica/cardDaFabrica'
import type { RepoDoBoard } from '../../src/core/fabrica/configuracao'

const A: RepoDoBoard = { owner: 'fulano', name: 'repo-a' }
const B: RepoDoBoard = { owner: 'fulano', name: 'repo-b' }
const DOIS = {
  chave: 'fulano/8',
  nome: 'Board de Dois Repos',
  repos: { tipo: 'lista' as const, repos: [A, B] },
  repoUnico: null,
}
const UM = {
  chave: 'fulano/7',
  nome: 'Board Um',
  repos: { tipo: 'lista' as const, repos: [A] },
  repoUnico: A,
}

describe('lerAlvo (CA-2)', () => {
  it('as três formas', () => {
    expect(lerAlvo('7')).toEqual({ owner: null, name: null, n: 7 })
    expect(lerAlvo('repo-b#7')).toEqual({ owner: null, name: 'repo-b', n: 7 })
    expect(lerAlvo('fulano/repo-b#7')).toEqual({ owner: 'fulano', name: 'repo-b', n: 7 })
  })
  it.each(['0', '07', 'a/b/c#1', '#5', 'repo#', '', '.#3', '..#3', 'fulano/..#3', 'a b#1'])(
    'recusa %j',
    (t) => {
      expect(lerAlvo(t)).toBeNull()
    },
  )
})

describe('resolverAlvo (CA-2)', () => {
  it('repo único: o número sozinho vai ao repo do board', () => {
    expect(resolverAlvo(UM, { owner: null, name: null, n: 152 })).toEqual({
      ok: true,
      card: { repo: A, n: 152 },
    })
    expect(resolverAlvo(UM, { owner: null, name: 'repo-a', n: 1 })).toEqual({
      ok: true,
      card: { repo: A, n: 1 },
    })
  })
  it('vários repos: o número sozinho é recusado, com a mensagem exata', () => {
    expect(resolverAlvo(DOIS, { owner: null, name: null, n: 7 })).toEqual({
      ok: false,
      motivo:
        'o board fulano/8 (Board de Dois Repos) atende vários repos: diga o repo do card, iniciar <repo>#7',
    })
  })
  it('vários repos: o repo do board resolve, com ou sem owner', () => {
    expect(resolverAlvo(DOIS, { owner: null, name: 'repo-b', n: 7 })).toEqual({
      ok: true,
      card: { repo: B, n: 7 },
    })
    expect(resolverAlvo(DOIS, { owner: 'fulano', name: 'repo-b', n: 7 })).toEqual({
      ok: true,
      card: { repo: B, n: 7 },
    })
  })
  it('repo que o board não atende: a mensagem exata', () => {
    expect(resolverAlvo(DOIS, { owner: null, name: 'repo-z', n: 7 })).toEqual({
      ok: false,
      motivo:
        'o repo repo-z não é do board fulano/8 (Board de Dois Repos), que atende fulano/repo-a, fulano/repo-b',
    })
    expect(resolverAlvo(DOIS, { owner: 'outro', name: 'repo-a', n: 7 })).toEqual({
      ok: false,
      motivo:
        'o repo outro/repo-a não é do board fulano/8 (Board de Dois Repos), que atende fulano/repo-a, fulano/repo-b',
    })
  })
})

describe('repoDoRegistro e cardDoRegistro (CA-1 estado antigo)', () => {
  it('sem repo, o repo único do board', () => {
    expect(repoDoRegistro({ id: 'd-0001' }, A)).toEqual(A)
    expect(cardDoRegistro({ id: 'd-0001', card: 5 }, A)).toEqual({ repo: A, n: 5 })
  })
  it('com repo, o gravado', () => {
    expect(repoDoRegistro({ id: 'd-0001', repo: 'fulano/repo-b' }, A)).toEqual(B)
    expect(repoDoRegistro({ id: 'd-0001', repo: 'fulano/repo-b' }, null)).toEqual(B)
  })
  it('sem repo e sem repo único, lança a mensagem exata', () => {
    expect(() => repoDoRegistro({ id: 'd-0002' }, null)).toThrow(
      new Error('estado.json ilegível: o d-0002 não diz o repo, e o board atende vários repos'),
    )
  })
  it('repo torto lança a outra', () => {
    expect(() => repoDoRegistro({ id: 'd-0003', repo: 'torto' }, A)).toThrow(
      new Error('estado.json ilegível: o d-0003 tem repo inválido: torto'),
    )
    expect(() => repoDoRegistro({ id: 'd-0003', repo: 7 }, A)).toThrow(
      new Error('estado.json ilegível: o d-0003 tem repo inválido: 7'),
    )
  })
})

describe('mesmoCard, rotuloDoCard e linhaDoRepo', () => {
  it('mesmoCard compara repo e número', () => {
    expect(mesmoCard({ repo: A, n: 5 }, { repo: { ...A }, n: 5 })).toBe(true)
    expect(mesmoCard({ repo: A, n: 5 }, { repo: B, n: 5 })).toBe(false)
    expect(mesmoCard({ repo: A, n: 5 }, { repo: A, n: 6 })).toBe(false)
  })
  it('rotuloDoCard: #n com repo único, owner/name#n sem', () => {
    expect(rotuloDoCard({ repo: A, n: 5 }, A)).toBe('#5')
    expect(rotuloDoCard({ repo: B, n: 5 }, null)).toBe('fulano/repo-b#5')
  })
  it('linhaDoRepo: o texto exato', () => {
    expect(linhaDoRepo({ repo: B, n: 5 })).toBe(
      '- Repo do card: fulano/repo-b. Este board atende vários repos: o #5 e todo card citado sem repo neste despacho são desse repo.',
    )
  })
})

describe('aceitaORepo, aceitaOBoard e repoDeOutroCard', () => {
  it('aceitaORepo: name ou owner/name do repo dado', () => {
    const ok = aceitaORepo(A)
    expect(ok('repo-a')).toBe(true)
    expect(ok('fulano/repo-a')).toBe(true)
    expect(ok('repo-b')).toBe(false)
    expect(ok('outro/repo-a')).toBe(false)
  })
  it('aceitaOBoard: lista e forma owner', () => {
    const lista = aceitaOBoard(DOIS)
    expect(lista('repo-b')).toBe(true)
    expect(lista('fulano/repo-a')).toBe(true)
    expect(lista('outro/repo-a')).toBe(false)
    expect(lista('repo-z')).toBe(false)
    const dono = aceitaOBoard({ repos: { tipo: 'owner', owner: 'fulano' } })
    expect(dono('qualquer')).toBe(true)
    expect(dono('fulano/x')).toBe(true)
    expect(dono('outro/x')).toBe(false)
    expect(dono('repo_x')).toBe(true)
  })
  it('repoDeOutroCard: as duas formas, com o aceita dado', () => {
    const ok = aceitaORepo(A)
    expect(repoDeOutroCard('PROXIMO: /gm-card #3', ok)).toBeNull()
    expect(repoDeOutroCard('PROXIMO: /gm-card repo-a#3', ok)).toBeNull()
    expect(repoDeOutroCard('PROXIMO: /gm-card claude-brain#43', ok)).toBe('claude-brain')
    expect(repoDeOutroCard('PROXIMO: /gm-card #43 (claude-brain)', ok)).toBe('claude-brain')
    expect(repoDeOutroCard('PROXIMO: /gm-card #12 (comentado)', ok)).toBeNull()
    expect(repoDeOutroCard('PROXIMO: /gm-card fulano/repo-b#3', aceitaOBoard(DOIS))).toBeNull()
  })
})
