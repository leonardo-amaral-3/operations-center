import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { montarPergunta, montarSala } from '../../core/fabrica/sala'
import {
  NOME_DO_PROJETO_DA_FABRICA,
  PROJETO_DA_FABRICA,
  REPO_DA_FABRICA,
} from '../../core/fabrica/mandato'
import type {
  EstadoDoDespachante,
  PausaDaFabrica,
  PerguntaDaFila,
  ReadPerguntaRequest,
  SalaDaFabrica,
} from '../../shared/fabrica'
import { IPC_INVOKE } from '../../shared/ipc'
import { identidade, lerEstado, lerPausa, lerSaida, pastaDaFabrica } from './arquivos'

/**
 * A leitura da sala da fábrica (card 122, spec P3 §A3). **Só lê**: das portas da P2 entram aqui as
 * quatro de leitura, e do `node:fs` só a leitura síncrona. A canária de `fabrica-sala.test.ts`
 * guarda isso.
 */

/** O app instalado não tem raiz de repo: parte de `<home>/pessoal/<repo>`, o checkout do workspace. */
export function pastaDaSala(env: NodeJS.ProcessEnv, home: string): string {
  return pastaDaFabrica(env, join(home, 'pessoal', REPO_DA_FABRICA.name))
}

/**
 * O despachante está vivo quando o `rodar.pid` guarda a identidade de um processo que ainda a tem
 * (O5). A identidade vem do `/proc`, então fora do Linux a sala não afirma nada.
 */
export function estadoDoDespachante(
  pasta: string,
  plataforma: NodeJS.Platform,
): EstadoDoDespachante {
  if (plataforma !== 'linux') return 'desconhecido'
  let lido: string
  try {
    lido = readFileSync(join(pasta, 'rodar.pid'), 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'parado' : 'desconhecido'
  }
  const pid = Number.parseInt(lido, 10)
  if (!Number.isInteger(pid) || pid <= 0) return 'desconhecido'
  return identidade(pid) === lido ? 'rodando' : 'parado'
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function despachanteSeguro(pasta: string, plataforma: NodeJS.Platform): EstadoDoDespachante {
  try {
    return estadoDoDespachante(pasta, plataforma)
  } catch {
    return 'desconhecido'
  }
}

/** Na dúvida, pausada: `lerPausa` já não lança, e se lançar mesmo assim o retrato diz `desde: null`. */
function pausaSegura(pasta: string): PausaDaFabrica | null {
  try {
    return lerPausa(pasta)
  } catch {
    return { desde: null }
  }
}

/** Nunca lança: o `parseEstado` valida só o envelope, e um item torto pode derrubar o `montarSala`. */
export function lerSala(
  pasta: string,
  plataforma: NodeJS.Platform,
  agora: () => string,
): SalaDaFabrica {
  const lidoEm = agora()
  const projeto = `${NOME_DO_PROJETO_DA_FABRICA} · Project ${PROJETO_DA_FABRICA}`
  // O despachante e a pausa vêm antes do estado, cada um no seu `try`: os três ramos os carregam.
  const despachante = despachanteSeguro(pasta, plataforma)
  const pausa = pausaSegura(pasta)
  try {
    const e = lerEstado(pasta)
    if (e === null) return { kind: 'sem-estado', lidoEm, projeto, despachante, pausa }
    return montarSala(e, { despachante, lidoEm, projeto, pausa })
  } catch (err) {
    return { kind: 'ilegivel', lidoEm, projeto, despachante, pausa, erro: mensagem(err) }
  }
}

/** O caminho da saída sai do `estado.json`, nunca do pedido. */
export function lerPergunta(pasta: string, id: string): PerguntaDaFila | null {
  if (!/^q-\d+$/.test(id)) return null
  try {
    const e = lerEstado(pasta)
    if (e === null) return null
    const item = e.fila.find((i) => i.id === id)
    if (item === undefined) return null
    let saida: string | null = null
    try {
      // O `despacho` vem do `estado.json`, que pode estar torto: só `d-<n>` vira nome de pasta.
      if (/^d-\d+$/.test(item.despacho)) saida = lerSaida(pasta, item.despacho)
    } catch {
      saida = null
    }
    return montarPergunta(e, id, saida)
  } catch {
    return null
  }
}

export function registerFabricaIpc(pasta: string): void {
  ipcMain.handle(IPC_INVOKE.readFabrica, (): SalaDaFabrica =>
    lerSala(pasta, process.platform, () => new Date().toISOString()),
  )
  ipcMain.handle(
    IPC_INVOKE.readFabricaPergunta,
    (_event, pedido: ReadPerguntaRequest): PerguntaDaFila | null =>
      typeof pedido?.id === 'string' ? lerPergunta(pasta, pedido.id) : null,
  )
}
