import type { Desfecho } from './tipos'

/**
 * Lê a saída de uma sessão `claude -p --output-format json` e diz como ela terminou (card 121).
 *
 * A forma da saída foi medida em quatro sessões reais (N1): um objeto com `type`, `subtype`,
 * `is_error`, `result` e `session_id`. A última linha não vazia do `result` é o contrato da
 * esteira (N2): `PROXIMO: /gm-…` ou `PARADA: …`. O comando de um `PROXIMO:` vai inteiro, com o
 * texto livre que vier depois do argumento.
 */
export function lerDesfecho(saida: string): { desfecho: Desfecho; sessaoClaude: string | null } {
  if (saida.trim() === '') {
    return {
      desfecho: { tipo: 'falha', motivo: 'a sessão terminou sem saída' },
      sessaoClaude: null,
    }
  }
  let bruto: unknown
  try {
    bruto = JSON.parse(saida)
  } catch {
    bruto = undefined
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return {
      desfecho: { tipo: 'falha', motivo: 'a saída da sessão não é JSON' },
      sessaoClaude: null,
    }
  }
  const o = bruto as Record<string, unknown>
  const sessaoClaude = typeof o.session_id === 'string' ? o.session_id : null

  if (o.type !== 'result' || o.is_error !== false || typeof o.result !== 'string') {
    return {
      desfecho: {
        tipo: 'falha',
        motivo: `a sessão terminou com erro (subtype: ${String(o.subtype)})`,
      },
      sessaoClaude,
    }
  }

  const linhas = o.result
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
  const ultima = linhas.at(-1) ?? ''

  const proximo = /^PROXIMO:\s+(\/\S[\s\S]*)$/.exec(ultima)
  if (proximo) {
    return { desfecho: { tipo: 'proximo', comando: (proximo[1] ?? '').trim() }, sessaoClaude }
  }
  const parada = /^PARADA:\s+(\S[\s\S]*)$/.exec(ultima)
  if (parada) {
    return { desfecho: { tipo: 'parada', motivo: (parada[1] ?? '').trim() }, sessaoClaude }
  }
  return {
    desfecho: { tipo: 'falha', motivo: 'a sessão terminou sem linha PROXIMO: nem PARADA:' },
    sessaoClaude,
  }
}
