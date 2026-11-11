import type { EntradaNaSala } from '../../shared/fabrica'

/**
 * A entrada da fábrica (F4 do #129): o que Leonardo conta para a fábrica pelo `yarn fabrica entrada`,
 * num `entrada.json` próprio, separado do `estado.json` (formato da P2). Puro: quem lê e grava o
 * arquivo é a casca, no molde do `estado.ts`.
 */

export interface ItemDaEntrada {
  id: string
  texto: string
  fonte: 'voce'
  criadoEm: string
  triadoEm: string | null
  resolucao: string | null
}

export interface EntradaDaFabrica {
  versao: 1
  contador: number
  itens: ItemDaEntrada[]
}

export const LIMITE_DO_TEXTO_DA_ENTRADA = 4000
export const ITENS_DA_ENTRADA_NA_TELA = 20

export function entradaVazia(): EntradaDaFabrica {
  return { versao: 1, contador: 0, itens: [] }
}

function ehTextoOuNulo(v: unknown): boolean {
  return v === null || typeof v === 'string'
}

/** Confere o envelope e cada item: o arquivo é de um escritor só, mas um torto não pode virar tela. */
export function parseEntrada(texto: string): EntradaDaFabrica {
  let bruto: unknown
  try {
    bruto = JSON.parse(texto)
  } catch (err) {
    throw new Error(`entrada.json ilegível: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    })
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    throw new Error('entrada.json ilegível: não é um objeto')
  }
  const o = bruto as Record<string, unknown>
  if (o.versao !== 1) throw new Error(`entrada.json ilegível: versão ${String(o.versao)}`)
  if (typeof o.contador !== 'number' || !Number.isInteger(o.contador) || o.contador < 0) {
    throw new Error('entrada.json ilegível: contador')
  }
  if (!Array.isArray(o.itens)) throw new Error('entrada.json ilegível: itens')
  o.itens.forEach((x: unknown, i: number) => {
    const it = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>
    const ok =
      typeof it.id === 'string' &&
      /^e-\d+$/.test(it.id) &&
      typeof it.texto === 'string' &&
      it.fonte === 'voce' &&
      typeof it.criadoEm === 'string' &&
      ehTextoOuNulo(it.triadoEm) &&
      ehTextoOuNulo(it.resolucao)
    if (!ok) throw new Error(`entrada.json ilegível: item ${i}`)
  })
  return bruto as EntradaDaFabrica
}

export function serializarEntrada(e: EntradaDaFabrica): string {
  return JSON.stringify(e, null, 2) + '\n'
}

/** Registra um texto no fim da entrada. Não muda `e`; o contador só cresce. */
export function registrarNaEntrada(
  e: EntradaDaFabrica,
  p: { texto: string; agora: string },
): { estado: EntradaDaFabrica; id: string } | { erro: string } {
  const t = p.texto.trim()
  if (t === '') return { erro: 'o texto da entrada está vazio' }
  if (t.length > LIMITE_DO_TEXTO_DA_ENTRADA) return { erro: 'o texto passa de 4000 caracteres' }
  const n = e.contador + 1
  const id = 'e-' + String(n).padStart(4, '0')
  const item: ItemDaEntrada = {
    id,
    texto: t,
    fonte: 'voce',
    criadoEm: p.agora,
    triadoEm: null,
    resolucao: null,
  }
  return { estado: { ...e, contador: n, itens: [...e.itens, item] }, id }
}

/** Marca um item como triado. Não muda `e`. */
export function triarItemDaEntrada(
  e: EntradaDaFabrica,
  p: { id: string; resolucao: string; agora: string },
): { estado: EntradaDaFabrica } | { erro: string } {
  const alvo = e.itens.find((i) => i.id === p.id)
  if (alvo === undefined) return { erro: `não há item ${p.id} na entrada` }
  if (alvo.triadoEm !== null) return { erro: `o item ${p.id} já foi triado` }
  const r = p.resolucao.trim()
  if (r === '') return { erro: 'a resolução está vazia' }
  return {
    estado: {
      ...e,
      itens: e.itens.map((i) => (i === alvo ? { ...i, triadoEm: p.agora, resolucao: r } : i)),
    },
  }
}

/** Os que esperam triagem, na ordem do arquivo. `null` (sem arquivo) não tem nenhum. */
export function abertosDaEntrada(e: EntradaDaFabrica | null): ItemDaEntrada[] {
  return e === null ? [] : e.itens.filter((i) => i.triadoEm === null)
}

/**
 * A leitura da tela: os mais novos primeiro. A ordem é pelo número do id e não pela hora, porque o
 * contador só cresce e o relógio pode estar atrás do de uma fixture.
 */
export function entradaNaSala(e: EntradaDaFabrica | null): Extract<EntradaNaSala, { kind: 'ok' }> {
  if (e === null) return { kind: 'ok', itens: [], total: 0 }
  const numero = (id: string): number => Number(id.slice(2))
  const itens = [...e.itens]
    .sort((a, b) => numero(b.id) - numero(a.id))
    .slice(0, ITENS_DA_ENTRADA_NA_TELA)
    .map((i) => ({
      id: i.id,
      texto: i.texto,
      fonte: i.fonte,
      criadoEm: i.criadoEm,
      triadoEm: i.triadoEm,
      resolucao: i.resolucao,
    }))
  return { kind: 'ok', itens, total: e.itens.length }
}
