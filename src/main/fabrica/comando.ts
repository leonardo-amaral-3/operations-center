import { ipcMain } from 'electron'
import { LIMITE_DO_TEXTO_DA_ENTRADA } from '../../core/fabrica/entrada'
import { LIMITE_DA_REVISAO, NOME_DO_COFRE } from '../../core/fabrica/revisoes'
import type { ComandoDaFabrica, ResultadoDoComando } from '../../shared/fabrica'
import { IPC_INVOKE } from '../../shared/ipc'
import { executar, type DepsDoCli } from './cli'

/**
 * O canal de escrita da fábrica (#129, spec F1.3). O app só chega à pasta da fábrica por aqui, e só
 * pelo `executar` do `yarn fabrica`, com um subcomando de uma lista fechada: o renderer não manda
 * argv, manda uma união tipada, e o `rodar` e o `estado` não cabem nela.
 */

/** O que o app pode rodar. Cada fase acrescenta o seu; **nenhuma** acrescenta `rodar` nem `estado`. */
export const SUBCOMANDOS_DO_APP = [
  'pausar',
  'retomar',
  'fechar',
  'entrada',
  'confirmar',
  'contestar',
] as const

/** O pedido do renderer virado em argv; qualquer coisa fora da união → `null`. */
export function argvDoComando(pedido: unknown): string[] | null {
  if (typeof pedido !== 'object' || pedido === null) return null
  const tipo = (pedido as { tipo?: unknown }).tipo
  if (tipo === 'pausar') return ['pausar']
  if (tipo === 'retomar') return ['retomar']
  if (tipo === 'fechar') {
    // O CLI aceita resolução vazia (Q2); a guarda é do app.
    const { item, resolucao } = pedido as { item?: unknown; resolucao?: unknown }
    if (typeof item !== 'string' || !/^q-\d+$/.test(item)) return null
    if (typeof resolucao !== 'string' || resolucao.trim() === '') return null
    return ['fechar', item, resolucao.trim()]
  }
  if (tipo === 'entrada') {
    const texto = (pedido as { texto?: unknown }).texto
    if (typeof texto !== 'string') return null
    const t = texto.trim()
    // O `yarn fabrica entrada` recusa o vazio e o que passa do limite; recusar aqui poupa a ida.
    if (t === '' || t.length > LIMITE_DO_TEXTO_DA_ENTRADA) return null
    return ['entrada', t]
  }
  if (tipo === 'confirmar' || tipo === 'contestar') {
    const { arquivo, motivo } = pedido as { arquivo?: unknown; motivo?: unknown }
    if (typeof arquivo !== 'string' || !NOME_DO_COFRE.test(arquivo)) return null
    if (tipo === 'confirmar') return ['confirmar', arquivo]
    // O teto vale sobre o texto com `trim()`, como no `novaRevisao`; recusar aqui poupa a ida.
    if (typeof motivo !== 'string' || motivo.trim() === '') return null
    if (motivo.trim().length > LIMITE_DA_REVISAO) return null
    return ['contestar', arquivo, motivo.trim()]
  }
  return null
}

function ehSubcomandoDoApp(sub: string | undefined): boolean {
  return (SUBCOMANDOS_DO_APP as readonly string[]).includes(sub ?? '')
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}

export function criarExecutorDeComando(
  deps: Omit<DepsDoCli, 'argv' | 'escrever' | 'avisar'>,
  /** Troca de teste: o `executar` de verdade é o padrão. */
  rodarComando: (deps: DepsDoCli) => Promise<number> = executar,
  /** Troca de teste: a primeira guarda. */
  paraArgv: (pedido: unknown) => string[] | null = argvDoComando,
): (pedido: unknown) => Promise<ResultadoDoComando> {
  // Uma chamada de cada vez: dois cliques seguidos não correm lado a lado na mesma pasta.
  let fila: Promise<unknown> = Promise.resolve()

  async function uma(pedido: unknown): Promise<ResultadoDoComando> {
    const argv = paraArgv(pedido)
    // A segunda guarda não confia na primeira: argv vazio viraria `rodar` (P19).
    if (argv === null || argv.length === 0 || !ehSubcomandoDoApp(argv[0])) {
      return { ok: false, codigo: 1, argv: argv ?? [], saida: '', erro: 'comando desconhecido' }
    }
    const saida: string[] = []
    const erro: string[] = []
    try {
      const codigo = await rodarComando({
        ...deps,
        argv,
        escrever: (t) => saida.push(t),
        avisar: (t) => erro.push(t),
      })
      return { ok: codigo === 0, codigo, argv, saida: saida.join('\n'), erro: erro.join('\n') }
    } catch (err) {
      return { ok: false, codigo: 1, argv, saida: saida.join('\n'), erro: mensagemDe(err) }
    }
  }

  return (pedido) => {
    const vez = fila.then(() => uma(pedido))
    fila = vez.catch(() => undefined)
    return vez
  }
}

export function registerComandoIpc(
  executor: (pedido: unknown) => Promise<ResultadoDoComando>,
): void {
  ipcMain.handle(
    IPC_INVOKE.comandoFabrica,
    (_event, pedido: ComandoDaFabrica): Promise<ResultadoDoComando> => executor(pedido),
  )
}
