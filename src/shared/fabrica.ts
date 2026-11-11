/**
 * O vocabulário da sala da fábrica (#122), do lado de cá da ponte.
 *
 * Só tipos, sem import de `electron` nem do SDK, como `src/shared/board.ts`.
 */
export type EstadoDoDespachante = 'rodando' | 'parado' | 'desconhecido'

export interface ItemNaSala {
  id: string // 'q-0003'
  card: number
  cardUrl: string
  motivo: string
  despacho: string
  comando: string | null // o do despacho de origem; null se ele não está no estado
  sessaoClaude: string | null
  criadoEm: string
  fechadoEm: string | null
  resolucao: string | null
}

export interface DespachoNaSala {
  id: string
  card: number
  cardUrl: string
  comando: string
  estado: 'pendente' | 'lancando' | 'rodando'
  criadoEm: string
  lancadoEm: string | null
}

export type SalaDaFabrica =
  | { kind: 'sem-estado'; lidoEm: string }
  | { kind: 'ilegivel'; lidoEm: string; erro: string }
  | {
      kind: 'ok'
      lidoEm: string
      despachante: EstadoDoDespachante
      emVoo: DespachoNaSala[]
      abertos: ItemNaSala[]
      fechados: ItemNaSala[]
      frentesAbertas: number
    }

export interface PerguntaDaFila {
  item: ItemNaSala
  resultado: string | null // o `result` do saida.json da sessão de origem
  fechar: string // 'yarn fabrica fechar q-0003 "<resolução>"'
}

export interface ReadPerguntaRequest {
  id: string
}

export interface ReadRelatorioRequest {
  dia: string
}

export type RelatorioDaSala =
  | { kind: 'ok'; dia: string; markdown: string; semFonte: number; geradoEm: string }
  | { kind: 'erro'; dia: string; erro: string }
