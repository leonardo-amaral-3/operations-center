import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { despachoAtualDoCard, montarCard, paraDespachoDoCard } from '../../src/core/fabrica/card'
import { parseEstado } from '../../src/core/fabrica/estado'
import type { Despacho, EstadoDaFabrica } from '../../src/core/fabrica/tipos'

/** O card na fábrica (#133, F4.2, CA-4.1): a parte pura, sobre a fixture `f4`. */

const F4 = join(__dirname, '..', 'fixtures', 'fabrica', 'f4')
const estado = (): EstadoDaFabrica => parseEstado(readFileSync(join(F4, 'estado.json'), 'utf8'))
const SAIDA = readFileSync(join(F4, 'sessoes', 'd-0007', 'saida.json'), 'utf8')
const CTX = { worktrees: [] as string[], vivos: null as ReadonlySet<string> | null, saida: null }

function despacho(p: Partial<Despacho> & { id: string }): Despacho {
  return {
    frente: 'fr-0001',
    card: 7,
    comando: '/gm-spec #7',
    nota: null,
    estado: 'concluido',
    pid: null,
    criadoEm: '2026-11-11T08:00:00.000Z',
    lancadoEm: null,
    concluidoEm: null,
    sessaoClaude: null,
    desfecho: null,
    ...p,
  }
}
const comDespachos = (despachos: Despacho[]): EstadoDaFabrica => ({ ...estado(), despachos })

describe('despachoAtualDoCard', () => {
  it('o em voo vence o concluído, mesmo o mais novo', () => {
    const e = comDespachos([
      despacho({ id: 'd-0001', concluidoEm: '2026-11-11T09:00:00.000Z' }),
      despacho({ id: 'd-0002', estado: 'rodando' }),
    ])
    expect(despachoAtualDoCard(e, 7)?.id).toBe('d-0002')
  })

  it('sem em voo, o de concluidoEm maior; no empate, o de id maior', () => {
    const e = comDespachos([
      despacho({ id: 'd-0001', concluidoEm: '2026-11-11T09:00:00.000Z' }),
      despacho({ id: 'd-0002', concluidoEm: '2026-11-11T08:30:00.000Z' }),
    ])
    expect(despachoAtualDoCard(e, 7)?.id).toBe('d-0001')
    const empate = comDespachos([
      despacho({ id: 'd-0001', concluidoEm: '2026-11-11T09:00:00.000Z' }),
      despacho({ id: 'd-0003', concluidoEm: '2026-11-11T09:00:00.000Z' }),
    ])
    expect(despachoAtualDoCard(empate, 7)?.id).toBe('d-0003')
  })

  it('card sem despacho → null', () => {
    expect(despachoAtualDoCard(estado(), 1)).toBeNull()
  })
})

describe('paraDespachoDoCard', () => {
  it('os três fins e o sem desfecho, cada um com o detalhe certo', () => {
    const feito = (desfecho: Despacho['desfecho']) =>
      paraDespachoDoCard(despacho({ id: 'd-0001', sessaoClaude: 's-1', desfecho }))
    expect(feito({ tipo: 'proximo', comando: '/gm-ship x' })).toMatchObject({
      fim: 'proximo',
      detalhe: '/gm-ship x',
      sessao: 's-1',
      estacao: 'spec',
    })
    expect(feito({ tipo: 'parada', motivo: 'sem spec' })).toMatchObject({
      fim: 'parada',
      detalhe: 'sem spec',
    })
    expect(feito({ tipo: 'falha', motivo: 'saiu com 1' })).toMatchObject({
      fim: 'falha',
      detalhe: 'saiu com 1',
    })
    expect(feito(null)).toMatchObject({ fim: null, detalhe: null })
  })
})

describe('montarCard sobre a fixture f4 (o "esperado F4")', () => {
  it('#4: o d-0005 rodando, sem resultado, e os terminados do mais novo ao mais velho', () => {
    const c = montarCard(estado(), 4, { ...CTX, saida: SAIDA })
    expect(c.kind).toBe('ok')
    if (c.kind !== 'ok') return
    expect(c.atual).toMatchObject({
      id: 'd-0005',
      estado: 'rodando',
      estacao: 'implementacao',
      sessao: null,
    })
    expect(c.resultado).toBeNull()
    expect(c.terminados.map((d) => d.id)).toEqual(['d-0004', 'd-0003', 'd-0002'])
  })

  it('#906: o d-0007 concluído, com o result do saida.json', () => {
    const c = montarCard(estado(), 906, { ...CTX, saida: SAIDA })
    expect(c.kind).toBe('ok')
    if (c.kind !== 'ok') return
    expect(c.atual).toMatchObject({
      id: 'd-0007',
      estado: 'concluido',
      estacao: 'revisao',
      sessao: 'sessao-906',
      fim: 'parada',
    })
    expect(c.resultado).toContain('Portão local')
    expect(c.terminados.map((d) => d.id)).toEqual(['d-0007'])
    expect(c.viva).toBeNull()
  })

  it('#1: sem-despacho', () => {
    expect(montarCard(estado(), 1, CTX)).toEqual({
      kind: 'sem-despacho',
      card: 1,
      cardUrl: 'https://github.com/leonardo-amaral-3/operations-center/issues/1',
    })
  })

  it('viva: true/false pelo vivos, null sem vivos e nos que não estão em andamento', () => {
    const viva = (vivos: ReadonlySet<string> | null) => {
      const c = montarCard(estado(), 4, { ...CTX, vivos })
      return c.kind === 'ok' ? c.viva : 'x'
    }
    expect(viva(new Set(['d-0005']))).toBe(true)
    expect(viva(new Set())).toBe(false)
    expect(viva(null)).toBeNull()
    const pendente = comDespachos([despacho({ id: 'd-0001', estado: 'pendente' })])
    const p = montarCard(pendente, 7, { ...CTX, vivos: new Set(['d-0001']) })
    expect(p.kind === 'ok' ? p.viva : 'x').toBeNull()
  })

  it('resultado só do concluído, e null com saida torta', () => {
    const torta = montarCard(estado(), 906, { ...CTX, saida: '{não é json' })
    expect(torta.kind === 'ok' ? torta.resultado : 'x').toBeNull()
    const emVoo = montarCard(estado(), 4, { ...CTX, saida: SAIDA })
    expect(emVoo.kind === 'ok' ? emVoo.resultado : 'x').toBeNull()
  })
})
