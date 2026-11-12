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

/**
 * O que o app pode rodar. Cada fase acrescenta o seu; **nenhuma** acrescenta `rodar` nem `estado`.
 * O `iniciar` do app nunca leva `--comando` nem `--ensaio`: o comando vem do board, no CLI.
 */
export const SUBCOMANDOS_DO_APP = [
  'pausar',
  'retomar',
  'fechar',
  'entrada',
  'confirmar',
  'contestar',
  'iniciar',
] as const

/** `<owner>/<nome>`, sem espaço, `#` nem barra a mais. */
const FORMA_DO_REPO = /^[\w.-]+\/[\w.-]+$/

/** O tamanho máximo da nota do `iniciar`, depois do `trim()`. */
export const LIMITE_DA_NOTA_DO_APP = 1000

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
  if (tipo === 'iniciar') {
    const { repo, card, nota } = pedido as { repo?: unknown; card?: unknown; nota?: unknown }
    // O repo do card, `<owner>/<nome>`: o CLI resolve contra o board; aqui só a forma.
    if (typeof repo !== 'string' || !FORMA_DO_REPO.test(repo)) return null
    if (typeof card !== 'number' || !Number.isSafeInteger(card) || card <= 0) return null
    if (typeof nota !== 'string') return null
    const n = nota.trim()
    // A nota vira a linha "- Nesta sessão: <nota>" do argumento do despacho (`montarPrompt`): quebra
    // de linha aqui seria linha nova no mandato, e caractere de controle quebraria o spawn. `--` no
    // começo o CLI leria como flag.
    if (n === '' || n.length > LIMITE_DA_NOTA_DO_APP || temControle(n) || n.startsWith('--')) {
      return null
    }
    return ['iniciar', `${repo}#${card}`, '--nota', n]
  }
  return null
}

/** Algum caractere de controle (U+0000–U+001F, U+007F, U+0085) ou separador de linha (U+2028, U+2029). */
function temControle(texto: string): boolean {
  for (const ch of texto) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x20 || c === 0x7f || c === 0x85 || c === 0x2028 || c === 0x2029) return true
  }
  return false
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
    // E, só para o `iniciar`, recusa toda forma que não seja `iniciar <owner>/<repo>#<card> --nota <nota>`: um
    // `--comando` ou um `--ensaio` nunca chega ao CLI.
    const formaInvalida =
      argv !== null &&
      argv[0] === 'iniciar' &&
      !(
        argv.length === 4 &&
        argv[2] === '--nota' &&
        /^[\w.-]+\/[\w.-]+#[1-9]\d*$/.test(argv[1] ?? '')
      )
    if (argv === null || argv.length === 0 || !ehSubcomandoDoApp(argv[0]) || formaInvalida) {
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
