import { ipcMain } from 'electron'
import { portoesDoMandato, regrasDoMandato } from '../../core/fabrica/portoes'
import type { MandatoNaSala } from '../../shared/fabrica'
import { IPC_INVOKE } from '../../shared/ipc'

/**
 * O mandato da `dev` para a tela Mandato (F5). **Só lê**: o texto vem de quem chama (a GraphQL que
 * a F2 já usa) e a tabela de portões sai de uma função pura. Nada aqui escreve na pasta da fábrica,
 * no board ou no repo; a canária de `fabrica-sala.test.ts` guarda isso.
 */

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Nunca rejeita: a leitura que falha vira `{ kind: 'erro' }`. */
export async function lerMandatoNaSala(lerTexto: () => Promise<string>): Promise<MandatoNaSala> {
  try {
    const t = await lerTexto()

    return { kind: 'ok', portoes: portoesDoMandato(t), regras: regrasDoMandato(t) }
  } catch (err) {
    return { kind: 'erro', erro: mensagem(err) }
  }
}

export function registerMandatoIpc(lerTexto: (pedido: unknown) => Promise<string>): void {
  ipcMain.handle(IPC_INVOKE.readFabricaMandato, (_event, pedido: unknown) =>
    lerMandatoNaSala(() => lerTexto(pedido)),
  )
}
