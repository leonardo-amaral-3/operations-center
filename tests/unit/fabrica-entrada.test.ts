import { describe, expect, it } from 'vitest'
import {
  ARQUIVO_DO_RELATO,
  NOTA_DA_TRIAGEM,
  abertosDaEntrada,
  comandoDaTriagem,
  concluirTriagem,
  entradaNaSala,
  marcarTriagemLancando,
  marcarTriagemRodando,
  temTriagemPorFazer,
  textoDoRelato,
  triagensEmVoo,
  triagensPorLancar,
  voltarTriagemAPendente,
  entradaVazia,
  parseEntrada,
  registrarNaEntrada,
  serializarEntrada,
  triarItemDaEntrada,
  type EntradaDaFabrica,
  type ItemDaEntrada,
  type TriagemDoItem,
} from '../../src/core/fabrica/entrada'
import { avaliarNota, caminhosProibidos } from '../../src/core/fabrica/mandato'

const AGORA = '2026-11-11T10:00:00.000Z'

function item(n: number, mais: Partial<ItemDaEntrada> = {}): ItemDaEntrada {
  return {
    id: `e-${String(n).padStart(4, '0')}`,
    texto: `texto ${n}`,
    fonte: 'voce',
    criadoEm: AGORA,
    triadoEm: null,
    resolucao: null,
    triagem: null,
    ...mais,
  }
}

function entrada(...itens: ItemDaEntrada[]): EntradaDaFabrica {
  return { versao: 1, contador: itens.length, itens }
}

function tri(mais: Partial<TriagemDoItem> = {}): TriagemDoItem {
  return {
    estado: 'rodando',
    marca: 'inst/e-0001',
    pid: 42,
    lancadoEm: AGORA,
    concluidoEm: null,
    sessaoClaude: null,
    parou: null,
    ...mais,
  }
}

function saida(result: string): string {
  return JSON.stringify({ type: 'result', is_error: false, result, session_id: 'sess-1' })
}

describe('parseEntrada', () => {
  it('item sem triagem sai com triagem null e campo desconhecido é preservado', () => {
    const velho: Record<string, unknown> = { ...item(1) }
    delete velho.triagem
    const bruto = { versao: 1, contador: 1, extra: 'x', itens: [{ ...velho, novo: 7 }] }
    const e = parseEntrada(JSON.stringify(bruto))
    expect(e.itens[0]?.triagem).toBeNull()
    expect((e.itens[0] as unknown as Record<string, unknown>).novo).toBe(7)
    expect((e as unknown as Record<string, unknown>).extra).toBe('x')
  })

  it('lê uma triagem válida', () => {
    const e = entrada(item(1, { triagem: tri() }))
    expect(parseEntrada(serializarEntrada(e))).toEqual(e)
  })

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
      [
        JSON.stringify({ ...base, itens: [{ ...item(1), triagem: { ...tri(), estado: 'x' } }] }),
        'item 0',
      ],
      [
        JSON.stringify({ ...base, itens: [{ ...item(1), triagem: { ...tri(), pid: '7' } }] }),
        'item 0',
      ],
      [JSON.stringify({ ...base, itens: [{ ...item(1), triagem: 3 }] }), 'item 0'],
      [
        JSON.stringify({ ...base, itens: [{ ...item(1), triagem: { ...tri(), lancadoEm: 1 } }] }),
        'item 0',
      ],
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

describe('triagem do item', () => {
  it('registrarNaEntrada cria com triagem null', () => {
    const r = registrarNaEntrada(entradaVazia(), { texto: 'oi', agora: AGORA })
    if ('erro' in r) throw new Error(r.erro)
    expect(r.estado.itens[0]?.triagem).toBeNull()
  })

  it('triarItemDaEntrada recusa com triagem rodando e lancando, aceita com concluida', () => {
    for (const estado of ['rodando', 'lancando'] as const) {
      const e = entrada(item(1, { triagem: tri({ estado }) }))
      expect(triarItemDaEntrada(e, { id: 'e-0001', resolucao: 'x', agora: AGORA })).toEqual({
        erro: 'o item e-0001 está em triagem pela fábrica',
      })
    }
    const e = entrada(item(1, { triagem: tri({ estado: 'concluida', parou: 'x' }) }))
    expect('estado' in triarItemDaEntrada(e, { id: 'e-0001', resolucao: 'x', agora: AGORA })).toBe(
      true,
    )
  })

  it('textoDoRelato: origem, linha em branco, texto', () => {
    expect(textoDoRelato(item(1))).toBe(
      `Origem: Leonardo, pela tela Entrada do app da fábrica, em ${AGORA} (item e-0001).\n\ntexto 1\n`,
    )
  })

  it('comandoDaTriagem e a nota', () => {
    expect(comandoDaTriagem('/p/sessoes/e-0001')).toBe(
      `/gm-triage /p/sessoes/e-0001/${ARQUIVO_DO_RELATO}`,
    )
    expect(NOTA_DA_TRIAGEM).not.toContain('\n')
    const proibidos = caminhosProibidos(
      '/home/u',
      '/home/u/pessoal',
      '/home/u/pessoal/operations-center',
    )
    expect(avaliarNota(NOTA_DA_TRIAGEM, proibidos).ok).toBe(true)
  })

  it('transições e seletores', () => {
    let e = entrada(item(3), item(1), item(2, { triadoEm: AGORA, resolucao: 'x' }))
    expect(triagensPorLancar(e).map((i) => i.id)).toEqual(['e-0001', 'e-0003'])
    expect(() => marcarTriagemLancando(e, 'e-0002', { marca: 'm', agora: AGORA })).toThrow()
    expect(() => marcarTriagemLancando(e, 'e-0009', { marca: 'm', agora: AGORA })).toThrow()
    e = marcarTriagemLancando(e, 'e-0001', { marca: 'm', agora: AGORA })
    expect(() => marcarTriagemLancando(e, 'e-0001', { marca: 'm', agora: AGORA })).toThrow()
    expect(triagensPorLancar(e).map((i) => i.id)).toEqual(['e-0003'])
    expect(triagensEmVoo(e).map((i) => i.id)).toEqual(['e-0001'])
    expect(() => voltarTriagemAPendente(entrada(item(1)), 'e-0001')).toThrow()
    const volta = voltarTriagemAPendente(e, 'e-0001')
    expect(volta.itens.find((i) => i.id === 'e-0001')?.triagem).toBeNull()
    e = marcarTriagemRodando(e, 'e-0001', 77)
    expect(e.itens.find((i) => i.id === 'e-0001')?.triagem).toMatchObject({
      estado: 'rodando',
      pid: 77,
    })
    expect(() => marcarTriagemRodando(e, 'e-0001', 78)).toThrow()
    expect(() => concluirTriagem(entrada(item(1)), 'e-0001', { saida: '', agora: AGORA })).toThrow()
    expect(temTriagemPorFazer(e)).toBe(true)
    expect(temTriagemPorFazer(null)).toBe(false)
    expect(temTriagemPorFazer(entrada(item(1, { triagem: tri({ estado: 'concluida' }) })))).toBe(
      false,
    )
  })

  const conclui = (s: string, mais: Partial<ItemDaEntrada> = {}) =>
    concluirTriagem(entrada(item(1, { triagem: tri(), ...mais })), 'e-0001', {
      saida: s,
      agora: AGORA,
    })

  it('concluirTriagem: PROXIMO com card fecha o item', () => {
    const r = conclui(saida('feito\nPROXIMO: /gm-card #150'))
    const i = r.estado.itens[0]
    expect(i).toMatchObject({
      triadoEm: AGORA,
      resolucao: 'virou o #150, em 📥 Triagem pela /gm-triage',
    })
    expect(i?.triagem).toMatchObject({
      estado: 'concluida',
      concluidoEm: AGORA,
      sessaoClaude: 'sess-1',
      parou: null,
    })
    expect(r.evento).toBe('e-0001 triado: virou o #150, em 📥 Triagem pela /gm-triage')
    expect(conclui(saida('PROXIMO: /gm-hotfix #151')).estado.itens[0]?.resolucao).toContain('#151')
  })

  it('concluirTriagem: duplicata fecha o item', () => {
    const r = conclui(saida('PARADA: duplicata de #12, comentei o relato'))
    expect(r.estado.itens[0]?.resolucao).toBe(
      'duplicata do #12: a /gm-triage registrou o relato nele',
    )
  })

  it('concluirTriagem: os demais fins deixam o item aberto, com o motivo', () => {
    const parou = (s: string) => conclui(s).estado.itens[0]
    const a = parou(saida('PARADA: isso é suporte'))
    expect(a?.triadoEm).toBeNull()
    expect(a?.triagem?.parou).toBe('PARADA: isso é suporte')
    expect(parou('')?.triagem?.parou).toBe('a sessão terminou sem saída')
    expect(parou(saida('PROXIMO: /gm-card'))?.triagem?.parou).toBe('PROXIMO sem card: /gm-card')
    expect(conclui(saida('PARADA: x')).evento).toBe('e-0001 parou na triagem: PARADA: x')
  })

  it('concluirTriagem: item já triado mantém a resolução', () => {
    const r = conclui(saida('PARADA: isso é suporte'), {
      triadoEm: '2026-11-11T09:00:00.000Z',
      resolucao: 'à mão',
    })
    expect(r.estado.itens[0]).toMatchObject({
      triadoEm: '2026-11-11T09:00:00.000Z',
      resolucao: 'à mão',
    })
    expect(r.estado.itens[0]?.triagem).toMatchObject({ estado: 'concluida', parou: null })
  })

  it('entradaNaSala: os quatro estados', () => {
    const e = entrada(
      item(1),
      item(2, { triagem: tri() }),
      item(3, { triagem: tri({ estado: 'concluida', parou: 'PARADA: x' }) }),
      item(4, { triagem: tri({ estado: 'concluida' }) }),
      item(5, { triadoEm: AGORA, resolucao: 'x', triagem: tri({ estado: 'concluida' }) }),
    )
    const por = Object.fromEntries(entradaNaSala(e).itens.map((i) => [i.id, i]))
    expect(por['e-0001']).toMatchObject({ triagem: 'esperando', parou: null })
    expect(por['e-0002']).toMatchObject({ triagem: 'triando', parou: null })
    expect(por['e-0003']).toMatchObject({ triagem: 'parou', parou: 'PARADA: x' })
    expect(por['e-0004']).toMatchObject({
      triagem: 'parou',
      parou: 'a triagem terminou sem resolução',
    })
    expect(por['e-0005']).toMatchObject({ triagem: null, parou: null })
  })
})
