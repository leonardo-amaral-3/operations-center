import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { criarLeiturasDaFabrica, type FontesDaSala } from '../../src/main/fabrica/sala'
import { configuracaoComDoisBoards } from './fabrica-board-de-teste'

const FIXTURE = join(__dirname, '..', 'fixtures', 'fabrica', 'sala')
const pastas: string[] = []
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
})

const FONTES: FontesDaSala = {
  recursos: () => ({
    sessoes: { kind: 'ok', vivas: 0, teto: 3 },
    suite: { kind: 'livre' },
    disco: { kind: 'ok', livres: 50 * 1024 ** 3, minimo: 2 * 1024 ** 3 },
  }),
  worktrees: () => [],
}

/** O Project 2 com o estado da fixture em `estado1`; o `fulano/8` com `estado2` ainda sem arquivo. */
function montar(p: { semMandato?: boolean } = {}) {
  const raiz = mkdtempSync(join(process.cwd(), 'node_modules', '.oc-leituras-'))
  pastas.push(raiz)
  mkdirSync(join(raiz, 'estado1'))
  cpSync(join(FIXTURE, 'estado.json'), join(raiz, 'estado1', 'estado.json'))
  const pedidas: string[] = []
  const l = criarLeiturasDaFabrica({
    configuracao: configuracaoComDoisBoards({ raiz, home: '/h', semMandato: p.semMandato }),
    env: {},
    plataforma: 'darwin',
    agora: () => '2026-11-12T12:00:00.000Z',
    fontes: (_b, pasta) => {
      pedidas.push(pasta)
      return FONTES
    },
  })
  return { raiz, l, pedidas }
}

describe('criarLeiturasDaFabrica · board servido (CA-1)', () => {
  it('cada leitura vai à pasta do board pedido', () => {
    const { l } = montar()
    expect(l.sala({ board: 'leonardo-amaral-3/2' }).kind).toBe('ok')
    expect(l.sala({ board: null }).kind).toBe('ok')
    expect(l.sala({ board: 'fulano/8' }).kind).toBe('sem-estado')
    expect(l.entrada({ board: 'fulano/8' }).kind).toBe('ok')
    expect(l.revisoes({ board: 'fulano/8' }).kind).toBe('ok')
  })

  it('a pergunta lê pelo id e devolve null para id torto', () => {
    const { l } = montar()
    expect(l.pergunta({ board: 'fulano/8', id: 'q-1' })).toBeNull()
    expect(l.pergunta({ board: 'fulano/8', id: 7 })).toBeNull()
    expect(l.pergunta({ board: null })).toBeNull()
  })

  it('o card de um board de vários repos usa o repo do pedido', () => {
    const { l } = montar()
    const r = l.card({ board: 'fulano/8', repo: 'fulano/repo-b', card: 5 })
    expect(r).toMatchObject({
      kind: 'sem-estado',
      card: 5,
      cardUrl: 'https://github.com/fulano/repo-b/issues/5',
    })
  })

  it('repo null vale o repo único; sem repo único, recusa com o motivo do resolverAlvo', () => {
    const { l } = montar()
    expect(l.card({ board: null, repo: null, card: 3 })).toMatchObject({
      kind: 'sem-despacho',
      card: 3,
    })
    const r = l.card({ board: 'fulano/8', repo: null, card: 5 })
    expect(r).toEqual({
      kind: 'ilegivel',
      card: 5,
      cardUrl: '',
      erro: 'o board fulano/8 (Board de Dois Repos) atende vários repos: diga o repo do card, iniciar <repo>#5',
    })
  })

  it('repo de outro board ou torto, e card inválido, são recusados', () => {
    const { l } = montar()
    const fora = l.card({ board: 'fulano/8', repo: 'fulano/outro', card: 5 })
    expect(fora).toMatchObject({ kind: 'ilegivel', card: 5, cardUrl: '' })
    expect('erro' in fora && fora.erro).toMatch(/não é do board fulano\/8/)
    for (const repo of ['torto', 7, undefined]) {
      expect(l.card({ board: 'fulano/8', repo, card: 5 })).toEqual({
        kind: 'ilegivel',
        card: 0,
        cardUrl: '',
        erro: 'pedido inválido',
      })
    }
    for (const card of [0, -1, 1.5, '5', undefined]) {
      expect(l.card({ board: null, repo: null, card })).toMatchObject({
        kind: 'ilegivel',
        card: 0,
        erro: 'pedido inválido',
      })
    }
  })
})

describe('criarLeiturasDaFabrica · board recusado (CA-3)', () => {
  it('as cinco leituras devolvem o motivo e nenhuma pasta nasce', () => {
    const { raiz, l, pedidas } = montar()
    const motivo =
      'o board ICSF-Solutions/19 não está configurado em fabrica/boards.json: falta a entrada dele (repo, workspace, pasta de estado e mandato)'
    const pedido = { board: 'ICSF-Solutions/19' }
    const sala = l.sala(pedido)
    expect(sala).toMatchObject({
      kind: 'ilegivel',
      lidoEm: '2026-11-12T12:00:00.000Z',
      projeto: '',
      despachante: 'desconhecido',
      pausa: null,
      erro: motivo,
    })
    expect(sala.kind === 'ilegivel' && sala.recursos.disco).toEqual({ kind: 'sem-leitura', motivo })
    expect(l.pergunta({ ...pedido, id: 'q-1' })).toBeNull()
    expect(l.card({ ...pedido, repo: null, card: 9 })).toEqual({
      kind: 'ilegivel',
      card: 9,
      cardUrl: '',
      erro: motivo,
    })
    expect(l.entrada(pedido)).toEqual({ kind: 'ilegivel', erro: motivo })
    expect(l.revisoes(pedido)).toEqual({ kind: 'ilegivel', erro: motivo })
    expect(pedidas).toEqual([])
    expect(existsSync(join(raiz, 'estado2'))).toBe(false)
  })

  it('sem mandato e pedido torto também recusam', () => {
    const { l } = montar({ semMandato: true })
    const r = l.entrada({ board: 'fulano/8' })
    expect(r.kind === 'ilegivel' && r.erro).toBe(
      'o board fulano/8 (Board de Dois Repos) não tem mandato aprovado: falta o campo mandato em fabrica/boards.json',
    )
    expect(l.entrada(undefined)).toEqual({ kind: 'ilegivel', erro: 'pedido inválido: board' })
    expect(l.board({ board: 'x' })).toEqual({
      kind: 'recusado',
      chave: '',
      motivo: 'pedido inválido: board',
    })
  })
})
