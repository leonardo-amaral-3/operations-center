import { describe, expect, it } from 'vitest'
import { comandoDaEstacao } from '../../src/core/fabrica/estacao'
import {
  concluirDespacho,
  emVoo,
  escolherLancamentos,
  fecharItem,
  iniciarFrente,
  marcarLancando,
  marcarRodando,
  ocioso,
  voltarAPendente,
} from '../../src/core/fabrica/despachante'
import { estadoVazio } from '../../src/core/fabrica/estado'
import { caminhosProibidos } from '../../src/core/fabrica/mandato'
import type { Despacho, EstadoDaFabrica } from '../../src/core/fabrica/tipos'

const proibidos = caminhosProibidos(
  '/home/u',
  '/home/u/pessoal',
  '/home/u/pessoal/operations-center',
)
const T0 = '2026-11-11T10:00:00.000Z'
const T1 = '2026-11-11T10:05:00.000Z'

function saida(result: string): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    session_id: 's-1',
  })
}

function comecar(card: number, comando: string, agora = T0, base = estadoVazio('u')) {
  const r = iniciarFrente(base, { card, comando, nota: null, agora })
  if ('erro' in r) throw new Error(r.erro)
  return r
}

describe('comandoDaEstacao', () => {
  it('Triagem começa pelo /gm-card', () => {
    expect(comandoDaEstacao(7, { noProjeto: true, status: '📥 Triagem' })).toEqual({
      comando: '/gm-card #7',
    })
  })
  it('Backlog começa pelo /gm-spec', () => {
    expect(comandoDaEstacao(7, { noProjeto: true, status: '📋 Backlog' })).toEqual({
      comando: '/gm-spec #7',
    })
  })
  it('fora do projeto é fase por promover: /gm-spec', () => {
    expect(comandoDaEstacao(7, { noProjeto: false })).toEqual({ comando: '/gm-spec #7' })
  })
  it('sem Status é erro', () => {
    expect(comandoDaEstacao(7, { noProjeto: true, status: null })).toEqual({
      erro: 'o #7 está no board sem Status; passe --comando',
    })
  })
  it('Especificação e Revisão são erro, com a estação no texto', () => {
    expect(comandoDaEstacao(7, { noProjeto: true, status: '🎯 Especificação' })).toEqual({
      erro: 'o #7 está em 🎯 Especificação: o próximo passo depende da pasta de planning ou é da orquestradora; passe --comando',
    })
    expect(comandoDaEstacao(7, { noProjeto: true, status: '👀 Revisão' })).toHaveProperty('erro')
  })
})

describe('iniciarFrente', () => {
  it('cria frente e despacho pendente; o primeiro despacho é d-0002', () => {
    const r = comecar(121, '/gm-spec #121')
    expect(r.frente).toBe('fr-0001')
    expect(r.despacho).toBe('d-0002')
    expect(r.estado.despachos[0]).toMatchObject({
      card: 121,
      estado: 'pendente',
      comando: '/gm-spec #121',
      pid: null,
    })
    expect(r.estado.frentes[0]).toMatchObject({ card: 121, encerradaEm: null })
  })
  it('não muta o estado recebido', () => {
    const base = estadoVazio('u')
    comecar(1, '/gm-card #1', T0, base)
    expect(base).toEqual(estadoVazio('u'))
  })
  it('recusa o card que já tem despacho em voo', () => {
    const r = comecar(2, '/gm-card #2')
    expect(
      iniciarFrente(r.estado, { card: 2, comando: '/gm-card #2', nota: null, agora: T1 }),
    ).toEqual({
      erro: 'o #2 já tem despacho em voo (d-0002)',
    })
  })
  it('recusa o comando que cita outro card', () => {
    expect(
      iniciarFrente(estadoVazio('u'), { card: 2, comando: '/gm-card #3', nota: null, agora: T0 }),
    ).toEqual({ erro: 'o comando cita o #3, e a frente é do #2' })
  })
})

describe('escolherLancamentos (teto)', () => {
  function frentes(n: number): EstadoDaFabrica {
    let e = estadoVazio('u')
    for (let i = 1; i <= n; i++)
      e = comecar(i, `/gm-card #${i}`, `2026-11-11T10:0${i}:00.000Z`, e).estado
    return e
  }
  it('4 frentes, 0 vivas: os 3 mais antigos', () => {
    const e = frentes(4)
    const ids = escolherLancamentos(e, 0)
    expect(ids).toHaveLength(3)
    expect(ids.map((id) => e.despachos.find((d) => d.id === id)?.card)).toEqual([1, 2, 3])
  })
  it('com 2 vivas: uma vaga; com 3 ou 5: nenhuma', () => {
    const e = frentes(4)
    expect(escolherLancamentos(e, 2)).toHaveLength(1)
    expect(escolherLancamentos(e, 3)).toEqual([])
    expect(escolherLancamentos(e, 5)).toEqual([])
  })
  it('dois pendentes da mesma frente: só um', () => {
    const r = comecar(1, '/gm-card #1')
    const dois: EstadoDaFabrica = {
      ...r.estado,
      despachos: [
        ...r.estado.despachos,
        { ...(r.estado.despachos[0] as Despacho), id: 'd-0009', comando: '/gm-spec #1' },
      ],
    }
    expect(escolherLancamentos(dois, 0)).toEqual(['d-0002'])
  })
  it('frente com um despacho rodando: nenhum dela', () => {
    const r = comecar(1, '/gm-card #1')
    const rodando = marcarRodando(marcarLancando(r.estado, r.despacho, T0), r.despacho, 99)
    const outro: EstadoDaFabrica = {
      ...rodando,
      despachos: [
        ...rodando.despachos,
        { ...(rodando.despachos[0] as Despacho), id: 'd-0009', estado: 'pendente', pid: null },
      ],
    }
    expect(escolherLancamentos(outro, 0)).toEqual([])
  })
})

describe('transições', () => {
  it('pendente → lancando → rodando → concluido, com PROXIMO gerando um pendente novo', () => {
    const r = comecar(1, '/gm-card #1')
    let e = marcarLancando(r.estado, r.despacho, T0)
    expect(e.despachos[0]).toMatchObject({ estado: 'lancando', lancadoEm: T0 })
    e = marcarRodando(e, r.despacho, 4242)
    expect(e.despachos[0]).toMatchObject({ estado: 'rodando', pid: 4242 })
    expect(emVoo(e)).toHaveLength(1)
    e = concluirDespacho(e, r.despacho, {
      saida: saida('feito\nPROXIMO: /gm-spec #1\n'),
      agora: T1,
      proibidos,
    })
    expect(e.despachos[0]).toMatchObject({
      estado: 'concluido',
      concluidoEm: T1,
      sessaoClaude: 's-1',
      desfecho: { tipo: 'proximo', comando: '/gm-spec #1' },
    })
    expect(e.despachos[1]).toMatchObject({
      estado: 'pendente',
      comando: '/gm-spec #1',
      frente: r.frente,
      card: 1,
      nota: null,
    })
    expect(e.fila).toEqual([])
    expect(ocioso(e)).toBe(false)
  })
  it('voltarAPendente desfaz o lancando', () => {
    const r = comecar(1, '/gm-card #1')
    const e = voltarAPendente(marcarLancando(r.estado, r.despacho, T0), r.despacho)
    expect(e.despachos[0]).toMatchObject({ estado: 'pendente', lancadoEm: null })
  })
  it('transição fora de ordem lança', () => {
    const r = comecar(1, '/gm-card #1')
    expect(() => marcarRodando(r.estado, r.despacho, 1)).toThrow()
    expect(() => marcarLancando(r.estado, 'd-9999', T0)).toThrow()
  })
  it('concluir duas vezes lança', () => {
    const r = comecar(1, '/gm-card #1')
    const e = concluirDespacho(r.estado, r.despacho, {
      saida: saida('PARADA: x'),
      agora: T1,
      proibidos,
    })
    expect(() =>
      concluirDespacho(e, r.despacho, { saida: saida('PARADA: x'), agora: T1, proibidos }),
    ).toThrow()
  })
  it('um estado sem despachos é ocioso', () => {
    expect(ocioso(estadoVazio('u'))).toBe(true)
  })
})

describe('G4 depois do /gm-ship', () => {
  const SHIP = '/gm-ship /x #7'
  const PARADA_DO_SHIP = 'PR #9 aberta na dev (Card: #7); o merge é da orquestradora'
  const concluir = (comando: string, resultado: string, base?: EstadoDaFabrica) => {
    const r = comecar(7, comando, T0, base)
    return {
      r,
      e: concluirDespacho(r.estado, r.despacho, { saida: saida(resultado), agora: T1, proibidos }),
    }
  }

  it('PARADA do /gm-ship com PR aberta vira despacho /g4 pendente na mesma frente, sem item', () => {
    const { r, e } = concluir(SHIP, `feito\nPARADA: ${PARADA_DO_SHIP}`)
    expect(e.fila).toEqual([])
    expect(e.frentes[0]?.encerradaEm).toBeNull()
    expect(e.despachos).toHaveLength(2)
    expect(e.despachos[1]).toMatchObject({
      estado: 'pendente',
      comando: '/g4 #7 PR #9',
      frente: r.frente,
      card: 7,
      nota: `o /gm-ship terminou com: PARADA: ${PARADA_DO_SHIP}`,
    })
  })
  it('PARADA do /gm-ship sem PR vira item, como antes', () => {
    const { e } = concluir(SHIP, 'PARADA: faltou o gate')
    expect(e.despachos).toHaveLength(1)
    expect(e.fila).toHaveLength(1)
    expect(e.fila[0]?.motivo).toBe('faltou o gate')
    expect(e.frentes[0]?.encerradaEm).toBe(T1)
  })
  it('PARADA do /gm-ship que cita PR fora da forma vira item, sem G4', () => {
    const { e } = concluir(SHIP, 'PARADA: verificação vermelha na PR #9')
    expect(e.despachos).toHaveLength(1)
    expect(e.fila).toHaveLength(1)
  })
  it('PARADA de outra skill com PR aberta vira item, sem G4', () => {
    const { e } = concluir('/gm-implement /x', `PARADA: ${PARADA_DO_SHIP}`)
    expect(e.despachos).toHaveLength(1)
    expect(e.fila[0]?.motivo).toBe(PARADA_DO_SHIP)
  })
  it('o limite da frente impede o G4 e vira item da origem ship', () => {
    const r = comecar(7, SHIP)
    const cheio: EstadoDaFabrica = {
      ...r.estado,
      despachos: [
        ...r.estado.despachos,
        ...Array.from({ length: 19 }, (_, i): Despacho => {
          const base = r.estado.despachos[0] as Despacho
          return { ...base, id: `d-9${String(i).padStart(3, '0')}`, estado: 'concluido' }
        }),
      ],
    }
    const e = concluirDespacho(cheio, r.despacho, {
      saida: saida(`PARADA: ${PARADA_DO_SHIP}`),
      agora: T1,
      proibidos,
    })
    expect(e.despachos).toHaveLength(20)
    expect(e.fila).toHaveLength(1)
    expect(e.fila[0]).toMatchObject({
      despacho: r.despacho,
      motivo: 'a frente passou de 20 despachos: /g4 #7 PR #9',
    })
  })
  it('G4 que termina em PROXIMO vira item e nenhum despacho nasce', () => {
    const { e } = concluir('/g4 #7 PR #9', 'PROXIMO: /gm-spec #7')
    expect(e.despachos).toHaveLength(1)
    expect(e.fila[0]?.motivo).toBe(
      'o G4 terminou com PROXIMO, e a revisão só fecha com PARADA: /gm-spec #7',
    )
    expect(e.frentes[0]?.encerradaEm).toBe(T1)
  })
})

describe('fila', () => {
  it('PARADA vira item e encerra a frente', () => {
    const r = comecar(5, '/gm-card #5')
    const e = concluirDespacho(r.estado, r.despacho, {
      saida: saida('x\nPARADA: espera o Leonardo'),
      agora: T1,
      proibidos,
    })
    expect(e.fila).toEqual([
      {
        id: 'q-0003',
        card: 5,
        motivo: 'espera o Leonardo',
        despacho: r.despacho,
        sessaoClaude: 's-1',
        criadoEm: T1,
        fechadoEm: null,
        resolucao: null,
      },
    ])
    expect(e.frentes[0]?.encerradaEm).toBe(T1)
    expect(ocioso(e)).toBe(true)
  })
  it('falha vira item com o motivo da falha', () => {
    const r = comecar(5, '/gm-card #5')
    const e = concluirDespacho(r.estado, r.despacho, { saida: '', agora: T1, proibidos })
    expect(e.fila[0]).toMatchObject({
      motivo: 'a sessão terminou sem saída',
      sessaoClaude: null,
    })
    expect(e.frentes[0]?.encerradaEm).toBe(T1)
  })
  it('fecharItem fecha; de novo e id desconhecido dão erro', () => {
    const r = comecar(5, '/gm-card #5')
    const e = concluirDespacho(r.estado, r.despacho, {
      saida: saida('PARADA: x'),
      agora: T1,
      proibidos,
    })
    const f = fecharItem(e, 'q-0003', 'feito', T1)
    if ('erro' in f) throw new Error(f.erro)
    expect(f.estado.fila[0]).toMatchObject({ fechadoEm: T1, resolucao: 'feito' })
    expect(fecharItem(f.estado, 'q-0003', 'feito', T1)).toEqual({
      erro: 'o item q-0003 já foi fechado',
    })
    expect(fecharItem(f.estado, 'q-0099', 'x', T1)).toEqual({ erro: 'não há item q-0099 na fila' })
  })
})

describe('cadeia', () => {
  it('PROXIMO fora do mandato: nenhum despacho novo, item na fila', () => {
    const r = comecar(5, '/gm-card #5')
    const e = concluirDespacho(r.estado, r.despacho, {
      saida: saida('PROXIMO: /gm-release'),
      agora: T1,
      proibidos,
    })
    expect(e.despachos).toHaveLength(1)
    expect(e.fila[0]?.motivo).toBe(
      'PROXIMO fora do mandato: a skill /gm-release não é despachada pela fábrica (fora do mandato): /gm-release',
    )
    expect(e.frentes[0]?.encerradaEm).toBe(T1)
  })
  it('frente com 20 despachos e PROXIMO válido: item "passou de 20"', () => {
    const r = comecar(5, '/gm-card #5')
    const base = r.estado.despachos[0] as Despacho
    const cheio: EstadoDaFabrica = {
      ...r.estado,
      despachos: [
        base,
        ...Array.from({ length: 19 }, (_, i) => ({
          ...base,
          id: `d-1${String(i).padStart(3, '0')}`,
          estado: 'concluido' as const,
        })),
      ],
    }
    const e = concluirDespacho(cheio, r.despacho, {
      saida: saida('PROXIMO: /gm-spec #5'),
      agora: T1,
      proibidos,
    })
    expect(e.despachos).toHaveLength(20)
    expect(e.fila[0]?.motivo).toBe('a frente passou de 20 despachos: /gm-spec #5')
  })
  it('o card do próximo vem do comando, e cai no da frente quando ele não cita', () => {
    const r = comecar(5, '/gm-card #5')
    const e = concluirDespacho(r.estado, r.despacho, {
      saida: saida('PROXIMO: /gm-plan-tasks /home/u/pessoal/planning/118-x'),
      agora: T1,
      proibidos,
    })
    expect(e.despachos[1]?.card).toBe(5)
  })
  it('PROXIMO que cita outro card não nasce na frente: item na fila', () => {
    const r = comecar(5, '/gm-card #5')
    const e = concluirDespacho(r.estado, r.despacho, {
      saida: saida('PROXIMO: /gm-spec #999'),
      agora: T1,
      proibidos,
    })
    expect(e.despachos).toHaveLength(1)
    expect(e.fila[0]?.motivo).toBe('PROXIMO cita o card #999, e a frente é do #5: /gm-spec #999')
  })
})
