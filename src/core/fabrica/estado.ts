import type { EstadoDaFabrica } from './tipos'

/**
 * O estado de uma fábrica nova. O UUID vem da casca (`randomUUID()`): o core não faz IO nem sorteia
 * nada, e é a instância que marca no ambiente cada sessão despachada (card 121).
 */
export function estadoVazio(instancia: string): EstadoDaFabrica {
  return { versao: 1, instancia, contador: 0, frentes: [], despachos: [], fila: [] }
}

/**
 * Um contador só para os três prefixos, então o primeiro despacho de um estado novo é `d-0002`
 * quando a frente nasce antes dele. Devolve estado novo, sem mutar o recebido.
 */
export function novoId(
  e: EstadoDaFabrica,
  prefixo: 'fr' | 'd' | 'q',
): { estado: EstadoDaFabrica; id: string } {
  const contador = e.contador + 1
  return { estado: { ...e, contador }, id: `${prefixo}-${String(contador).padStart(4, '0')}` }
}

/**
 * Lê o texto do `estado.json`. Confere só a forma do envelope: quem escreve o arquivo é apenas a
 * casca da fábrica, então item a item não se valida (spec P2 §1).
 */
export function parseEstado(texto: string): EstadoDaFabrica {
  let bruto: unknown
  try {
    bruto = JSON.parse(texto)
  } catch (err) {
    throw new Error(`estado.json ilegível: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    })
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    throw new Error('estado.json ilegível: não é um objeto')
  }
  const o = bruto as Record<string, unknown>
  if (o.versao !== 1) throw new Error(`estado.json ilegível: versao ${String(o.versao)}`)
  if (typeof o.instancia !== 'string' || o.instancia === '') {
    throw new Error('estado.json ilegível: instancia vazia')
  }
  if (!Number.isInteger(o.contador) || (o.contador as number) < 0) {
    throw new Error('estado.json ilegível: contador inválido')
  }
  for (const campo of ['frentes', 'despachos', 'fila'] as const) {
    if (!Array.isArray(o[campo])) throw new Error(`estado.json ilegível: ${campo} não é lista`)
  }
  return bruto as EstadoDaFabrica
}

export function serializarEstado(e: EstadoDaFabrica): string {
  return JSON.stringify(e, null, 2) + '\n'
}
