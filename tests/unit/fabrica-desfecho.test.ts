import { describe, expect, it } from 'vitest'
import { lerDesfecho } from '../../src/core/fabrica/desfecho'

function saida(result: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    session_id: 'sess-1',
    ...extra,
  })
}

describe('lerDesfecho', () => {
  it('saída vazia é falha, sem sessão', () => {
    expect(lerDesfecho('')).toEqual({
      desfecho: { tipo: 'falha', motivo: 'a sessão terminou sem saída' },
      sessaoClaude: null,
    })
    expect(lerDesfecho('  \n').desfecho.tipo).toBe('falha')
  })

  it('texto que não é JSON, ou JSON que não é objeto, é falha', () => {
    for (const s of ['{', '[1]', '"x"', 'null']) {
      expect(lerDesfecho(s)).toEqual({
        desfecho: { tipo: 'falha', motivo: 'a saída da sessão não é JSON' },
        sessaoClaude: null,
      })
    }
  })

  it('is_error true vira falha com o subtype, e lê o session_id', () => {
    const r = lerDesfecho(saida('x', { is_error: true, subtype: 'error_max_turns' }))
    expect(r).toEqual({
      desfecho: { tipo: 'falha', motivo: 'a sessão terminou com erro (subtype: error_max_turns)' },
      sessaoClaude: 'sess-1',
    })
  })

  it('type diferente de result, ou result que não é texto, é falha', () => {
    expect(lerDesfecho(saida('x', { type: 'system' })).desfecho.tipo).toBe('falha')
    const r = lerDesfecho(saida(null))
    expect(r.desfecho).toEqual({
      tipo: 'falha',
      motivo: 'a sessão terminou com erro (subtype: success)',
    })
  })

  it('PROXIMO na última linha, com linhas em branco e espaços depois', () => {
    const r = lerDesfecho(saida('resumo\n\nPROXIMO: /gm-spec #1  \n\n  \n'))
    expect(r).toEqual({
      desfecho: { tipo: 'proximo', comando: '/gm-spec #1' },
      sessaoClaude: 'sess-1',
    })
  })

  it('PARADA vira parada com o motivo', () => {
    const r = lerDesfecho(saida('feito\nPARADA: espera o Leonardo'))
    expect(r.desfecho).toEqual({ tipo: 'parada', motivo: 'espera o Leonardo' })
    expect(r.sessaoClaude).toBe('sess-1')
  })

  it('texto sem linha final é falha, mas guarda a sessão', () => {
    const r = lerDesfecho(saida('terminei tudo'))
    expect(r.desfecho).toEqual({
      tipo: 'falha',
      motivo: 'a sessão terminou sem linha PROXIMO: nem PARADA:',
    })
    expect(r.sessaoClaude).toBe('sess-1')
  })

  it('só a última linha vale: um PROXIMO no meio do texto não conta', () => {
    const r = lerDesfecho(saida('PROXIMO: /gm-spec #1\ndepois disso, mais texto'))
    expect(r.desfecho.tipo).toBe('falha')
  })

  it('o result real da N2, com texto livre depois do argumento, vai inteiro', () => {
    const linha =
      'PROXIMO: /gm-implement /home/leo/pessoal/planning/118-fabrica-agentica leva 1: tasks 1, 2 e 3 de tasks/fase-0 em paralelo, worktrees e branches no README de tasks/fase-0'
    const r = lerDesfecho(saida(`Tasks escritas.\n\n${linha}`))
    expect(r.desfecho).toEqual({ tipo: 'proximo', comando: linha.slice('PROXIMO: '.length) })
  })

  it('session_id que não é texto vira null', () => {
    expect(lerDesfecho(saida('PARADA: x', { session_id: 7 })).sessaoClaude).toBeNull()
  })
})
