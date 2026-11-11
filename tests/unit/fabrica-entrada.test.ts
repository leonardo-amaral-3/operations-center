import { describe, expect, it } from 'vitest'
import {
  abertosDaEntrada,
  entradaNaSala,
  entradaVazia,
  parseEntrada,
  registrarNaEntrada,
  serializarEntrada,
  triarItemDaEntrada,
  type EntradaDaFabrica,
  type ItemDaEntrada,
} from '../../src/core/fabrica/entrada'

const AGORA = '2026-11-11T10:00:00.000Z'

function item(n: number, mais: Partial<ItemDaEntrada> = {}): ItemDaEntrada {
  return {
    id: `e-${String(n).padStart(4, '0')}`,
    texto: `texto ${n}`,
    fonte: 'voce',
    criadoEm: AGORA,
    triadoEm: null,
    resolucao: null,
    ...mais,
  }
}

function entrada(...itens: ItemDaEntrada[]): EntradaDaFabrica {
  return { versao: 1, contador: itens.length, itens }
}

describe('parseEntrada', () => {
  it('lê o que serializarEntrada escreve', () => {
    const e = entrada(item(1), item(2, { triadoEm: AGORA, resolucao: 'virou o #9' }))
    expect(parseEntrada(serializarEntrada(e))).toEqual(e)
    expect(serializarEntrada(e).endsWith('}\n')).toBe(true)
  })

  it('cada forma torta tem a sua mensagem', () => {
    const base = { versao: 1, contador: 1, itens: [item(1)] }
    const casos: [string, string][] = [
      ['{', 'entrada.json ilegível: '],
      ['[]', 'entrada.json ilegível: não é um objeto'],
      ['null', 'entrada.json ilegível: não é um objeto'],
      [JSON.stringify({ ...base, versao: 2 }), 'entrada.json ilegível: versão 2'],
      [JSON.stringify({ ...base, contador: -1 }), 'entrada.json ilegível: contador'],
      [JSON.stringify({ ...base, contador: 1.5 }), 'entrada.json ilegível: contador'],
      [JSON.stringify({ ...base, itens: {} }), 'entrada.json ilegível: itens'],
      [JSON.stringify({ ...base, itens: [item(1), { ...item(2), id: 'x-1' }] }), 'item 1'],
      [JSON.stringify({ ...base, itens: [{ ...item(1), texto: 3 }] }), 'item 0'],
      [JSON.stringify({ ...base, itens: [{ ...item(1), fonte: 'slack' }] }), 'item 0'],
      [JSON.stringify({ ...base, itens: [{ ...item(1), criadoEm: null }] }), 'item 0'],
      [JSON.stringify({ ...base, itens: [{ ...item(1), triadoEm: 3 }] }), 'item 0'],
      [JSON.stringify({ ...base, itens: [{ ...item(1), resolucao: 3 }] }), 'item 0'],
      [JSON.stringify({ ...base, itens: [null] }), 'item 0'],
    ]
    for (const [texto, esperado] of casos) {
      expect(() => parseEntrada(texto), texto).toThrow(esperado)
    }
  })
})

describe('registrarNaEntrada', () => {
  it('o primeiro id é e-0001 e o da fixture f4 (contador 3) é e-0004', () => {
    const r = registrarNaEntrada(entradaVazia(), { texto: 'a', agora: AGORA })
    expect('erro' in r).toBe(false)
    if ('erro' in r) return
    expect(r.id).toBe('e-0001')
    expect(r.estado.itens).toEqual([item(1, { texto: 'a' })])
    const f4 = registrarNaEntrada(entrada(item(1), item(2), item(3)), { texto: 'b', agora: AGORA })
    expect('id' in f4 && f4.id).toBe('e-0004')
  })

  it('tira os espaços das pontas e não muda o original', () => {
    const original = entradaVazia()
    const r = registrarNaEntrada(original, { texto: '  oi\n', agora: AGORA })
    expect('estado' in r && r.estado.itens[0]?.texto).toBe('oi')
    expect(original).toEqual({ versao: 1, contador: 0, itens: [] })
  })

  it('vazio e só espaços são erro; 4000 passa e 4001 não', () => {
    const erro = { erro: 'o texto da entrada está vazio' }
    expect(registrarNaEntrada(entradaVazia(), { texto: '', agora: AGORA })).toEqual(erro)
    expect(registrarNaEntrada(entradaVazia(), { texto: ' \n ', agora: AGORA })).toEqual(erro)
    expect(
      'estado' in registrarNaEntrada(entradaVazia(), { texto: 'a'.repeat(4000), agora: AGORA }),
    ).toBe(true)
    expect(registrarNaEntrada(entradaVazia(), { texto: 'a'.repeat(4001), agora: AGORA })).toEqual({
      erro: 'o texto passa de 4000 caracteres',
    })
  })
})

describe('triarItemDaEntrada', () => {
  it('marca o item com a hora e a resolução sem espaços nas pontas', () => {
    const e = entrada(item(1), item(2))
    const r = triarItemDaEntrada(e, { id: 'e-0002', resolucao: ' virou o #9 ', agora: AGORA })
    expect('estado' in r && r.estado.itens[1]).toMatchObject({
      triadoEm: AGORA,
      resolucao: 'virou o #9',
    })
    expect('estado' in r && r.estado.itens[0]?.triadoEm).toBeNull()
    expect(e.itens[1]?.triadoEm).toBeNull()
  })

  it('item inexistente, já triado e resolução vazia', () => {
    const e = entrada(item(1), item(2, { triadoEm: AGORA, resolucao: 'x' }))
    expect(triarItemDaEntrada(e, { id: 'e-0099', resolucao: 'x', agora: AGORA })).toEqual({
      erro: 'não há item e-0099 na entrada',
    })
    expect(triarItemDaEntrada(e, { id: 'e-0002', resolucao: 'x', agora: AGORA })).toEqual({
      erro: 'o item e-0002 já foi triado',
    })
    expect(triarItemDaEntrada(e, { id: 'e-0001', resolucao: '  ', agora: AGORA })).toEqual({
      erro: 'a resolução está vazia',
    })
  })
})

describe('abertosDaEntrada', () => {
  it('só os sem triagem, na ordem do arquivo', () => {
    const e = entrada(item(1), item(2, { triadoEm: AGORA, resolucao: 'x' }), item(3))
    expect(abertosDaEntrada(e).map((i) => i.id)).toEqual(['e-0001', 'e-0003'])
  })
})

describe('entradaNaSala', () => {
  it('null → vazio', () => {
    expect(entradaNaSala(null)).toEqual({ kind: 'ok', itens: [], total: 0 })
  })

  it('ordena pelo número do id, mais novo primeiro, mesmo com a hora ao contrário', () => {
    const e = entrada(
      item(1, { criadoEm: '2030-01-01T00:00:00.000Z' }),
      item(2, { criadoEm: '2020-01-01T00:00:00.000Z' }),
    )
    expect(entradaNaSala(e).itens.map((i) => i.id)).toEqual(['e-0002', 'e-0001'])
  })

  it('corta em 20 e conta o total', () => {
    const e = entrada(...Array.from({ length: 25 }, (_, i) => item(i + 1)))
    const r = entradaNaSala(e)
    expect(r.itens).toHaveLength(20)
    expect(r.itens[0]?.id).toBe('e-0025')
    expect(r.itens[19]?.id).toBe('e-0006')
    expect(r.total).toBe(25)
  })
})
