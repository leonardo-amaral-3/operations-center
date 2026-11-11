import { ipcMain } from 'electron'
import type { ComandoDaFabrica, ResultadoDoComando } from '../../shared/fabrica'
import { IPC_INVOKE } from '../../shared/ipc'
import { executar, type DepsDoCli } from './cli'

/**
 * O canal de escrita da fábrica (#129, spec F1.3). O app só chega à pasta da fábrica por aqui, e só
 * pelo `executar` do `yarn fabrica`, com um subcomando de uma lista fechada: o renderer não manda
 * argv, manda uma união tipada, e o `rodar` e o `estado` não cabem nela.
 */

/** O que o app pode rodar. Cada fase acrescenta o seu; **nenhuma** acrescenta `rodar` nem `estado`. */
export const SUBCOMANDOS_DO_APP = ['pausar', 'retomar'] as const

/** O pedido do renderer virado em argv; qualquer coisa fora da união → `null`. */
export function argvDoComando(pedido: unknown): string[] | null {
  if (typeof pedido !== 'object' || pedido === null) return null
  const tipo = (pedido as { tipo?: unknown }).tipo
  if (tipo === 'pausar') return ['pausar']
  if (tipo === 'retomar') return ['retomar']
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
