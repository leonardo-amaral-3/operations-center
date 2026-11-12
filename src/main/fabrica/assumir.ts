import { ipcMain } from 'electron'
import {
  cardDoRegistro,
  mesmoCard,
  repoDoRegistro,
  rotuloDoCard,
} from '../../core/fabrica/cardDaFabrica'
import type { BoardComMandato } from '../../core/fabrica/configuracao'
import { urlDoCard } from '../../core/fabrica/sala'
import type { EstadoDaFabrica } from '../../core/fabrica/tipos'
import type { AssumirDespachoResult } from '../../shared/fabrica'
import { IPC_INVOKE } from '../../shared/ipc'

export interface DepsDoAssumir {
  boardDoPedido: (
    pedido: unknown,
  ) => { ok: true; board: BoardComMandato } | { ok: false; motivo: string }
  lerEstado: (board: BoardComMandato) => EstadoDaFabrica | null // lança se ilegível
  cardDoItem: (itemId: string) => { number: number; url: string } | null
  sessaoAberta: (itemId: string) => string | null // a sessão do terminal vivo do cartão, se houver
  conversaDoCartao: (itemId: string) => Promise<string | null> // a conversa lembrada do cartão
  transcriptExiste: (sessao: string) => Promise<boolean>
  janelasDePe: () => boolean // as janelas de card existem (fora do kanban e antes do whenReady, não)
  lembrar: (itemId: string, sessao: string) => void
  abrirJanela: (itemId: string) => void
}

const recusa = (motivo: string): AssumirDespachoResult => ({ ok: false, motivo })

/**
 * Assumir a sessão de um despacho terminado no cartão do card (#133). Nunca rejeita: exceção de
 * dependência vira `ok: false`. Em toda recusa, `lembrar` e `abrirJanela` não são chamados; o
 * passo 10 (janelas de pé) vem antes do 11 para que o caso conhecido de exceção não chegue depois
 * do `lembrar`.
 */
export function criarAssumir(
  deps: DepsDoAssumir,
): (pedido: unknown) => Promise<AssumirDespachoResult> {
  return async (pedido) => {
    try {
      const p = pedido as { despacho?: unknown; itemId?: unknown } | null
      if (
        typeof p !== 'object' ||
        p === null ||
        typeof p.despacho !== 'string' ||
        !/^d-\d+$/.test(p.despacho) ||
        typeof p.itemId !== 'string' ||
        p.itemId === ''
      )
        return recusa('pedido inválido')
      const id = p.despacho
      const itemId = p.itemId

      const r = deps.boardDoPedido(p)
      if (!r.ok) return recusa(r.motivo)
      const unico = r.board.repoUnico
      const e = deps.lerEstado(r.board)
      if (e === null) return recusa('a fábrica não tem estado.json')

      const d = e.despachos.find((x) => x.id === id)
      if (d === undefined) return recusa(`não há despacho ${id} na fábrica`)

      if (d.estado === 'pendente')
        return recusa(`o ${id} ainda não subiu: só dá para assumir a sessão depois que ela termina`)
      if (d.estado === 'lancando' || d.estado === 'rodando')
        return recusa(
          `a sessão do ${id} ainda está rodando: só dá para assumir depois que ela termina`,
        )

      const rotulo = rotuloDoCard(cardDoRegistro(d, unico), unico)
      const outro = e.despachos.find(
        (x) =>
          mesmoCard(cardDoRegistro(x, unico), cardDoRegistro(d, unico)) && x.estado !== 'concluido',
      )
      if (outro !== undefined)
        return recusa(
          `o ${rotulo} tem despacho em voo (${outro.id}): só dá para assumir depois que ele termina`,
        )

      const sessao = d.sessaoClaude
      if (sessao === null) return recusa(`o ${id} terminou sem id de sessão: não há o que retomar`)

      const c = deps.cardDoItem(itemId)
      if (c === null) return recusa('o card não está num board aberto no app')
      if (c.number !== d.card || c.url !== urlDoCard(d.card, repoDoRegistro(d, unico)))
        return recusa(`o card do pedido não é o ${rotulo} do ${id}`)

      const aberta = deps.sessaoAberta(itemId)
      if (aberta !== null && aberta !== sessao)
        return recusa(
          'o terminal deste card está aberto em outra conversa: feche-o antes de assumir',
        )

      if (!(await deps.transcriptExiste(sessao)))
        return recusa(`o transcript da sessão ${sessao} não está nesta máquina`)

      if (!deps.janelasDePe()) return recusa('as janelas de card não estão de pé')

      const anterior = await deps.conversaDoCartao(itemId)
      deps.lembrar(itemId, sessao)
      deps.abrirJanela(itemId)
      return { ok: true, anterior: anterior === sessao ? null : anterior }
    } catch (erro) {
      return recusa(erro instanceof Error ? erro.message : String(erro))
    }
  }
}

export function registerAssumirIpc(
  assumir: (pedido: unknown) => Promise<AssumirDespachoResult>,
): void {
  ipcMain.handle(IPC_INVOKE.assumirDespacho, (_event, pedido: unknown) => assumir(pedido))
}
