/**
 * O lado sujo da sessão livre (#74 §4): o arquivo `free-sessions.json`, o canal `free:*` e o
 * seletor de pasta.
 *
 * Espelha `conversations.ts` na postura — as pontas de IO do `FreeIndex` nascem aqui, o registro de
 * IPC copia `registerConversationIpc` (assinantes, "ler também assina", retrato inteiro a cada
 * mudança) — e nada aqui derruba o app: arquivo ilegível é lista vazia, e o preço é uma aba que não
 * volta, não um app que não abre.
 */

import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { WebContents } from 'electron'

import type { FreeEntry, FreeIndex } from '../core'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type {
  CreateFreeResult,
  ForgetFreeRequest,
  FreeSnapshot,
  RenameFreeRequest,
  SessionScope,
} from '../shared/ipc'
import { readState, writeState } from './store'

/** Versão desconhecida não migra: é lida como lista vazia, como em `conversations.ts`. */
const VERSAO = 1

const ARQUIVO = 'free-sessions.json'

/** O que estava gravado, pronto para virar o `load` do `FreeIndex`. */
export async function loadFree(): Promise<readonly FreeEntry[]> {
  const raiz = asRecord(await readState(ARQUIVO))
  if (raiz === null || raiz['version'] !== VERSAO) return []

  const sessions = raiz['sessions']
  if (!Array.isArray(sessions)) return []

  const entradas: FreeEntry[] = []

  for (const crua of sessions as unknown[]) {
    // Entrada torta é pulada sozinha: custa uma aba, e descartar as outras junto custaria todas.
    const entry = asRecord(crua)
    if (entry === null) continue

    const { id, title, cwd, sessionId, dangerous, createdAt } = entry
    if (typeof id !== 'string' || id === '' || typeof cwd !== 'string' || cwd === '') continue

    entradas.push({
      id,
      title: typeof title === 'string' && title.trim() !== '' ? title : basename(cwd),
      cwd,
      sessionId: typeof sessionId === 'string' && sessionId !== '' ? sessionId : null,
      dangerous: dangerous === true,
      createdAt: typeof createdAt === 'string' ? createdAt : new Date(0).toISOString(),
    })
  }

  return entradas
}

/** A gravação, pronta para virar o `save`. Falha rejeita; quem absorve é a fila do `FreeIndex`. */
export async function saveFree(entries: readonly FreeEntry[]): Promise<void> {
  await writeState(ARQUIVO, { version: VERSAO, sessions: entries })
}

export interface FreeIpc {
  /** Dispara a verificação do boot; o que ela descobrir chega à tela pelo `publish`. */
  refresh(): void
  publish(): void
}

export interface FreeIpcOptions {
  /**
   * Fecha a sessão viva daquele escopo, se houver — a alça `closeScope` do `SessionIpc`. O
   * `free:forget` a chama **antes** de remover a entrada: esquecer uma sessão que ainda roda deixaria
   * um processo do Claude Code escrevendo num transcript que o app já não mostra.
   */
  closeScope(scope: SessionScope): Promise<void>
}

/** Liga o canal `free:*` ao índice. Cópia estrutural de `registerConversationIpc`. */
export function registerFreeIpc(index: FreeIndex, options: FreeIpcOptions): FreeIpc {
  const subscribers = new Set<WebContents>()

  function retrato(): FreeSnapshot {
    return { sessions: index.list() }
  }

  function publish(): void {
    const proximo = retrato()

    for (const sender of subscribers) {
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        continue
      }

      sender.send(IPC_EVENT.free, proximo)
    }
  }

  ipcMain.handle(IPC_INVOKE.readFree, (event: { sender: WebContents }): FreeSnapshot => {
    subscribers.add(event.sender)

    return retrato()
  })

  ipcMain.handle(
    IPC_INVOKE.createFree,
    async (event: { sender: WebContents }): Promise<CreateFreeResult> => {
      // Preso à janela que pediu, como o `chooseFolder` de `index.ts`: o seletor é modal dela.
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = await (window
        ? dialog.showOpenDialog(window, { properties: ['openDirectory'] })
        : dialog.showOpenDialog({ properties: ['openDirectory'] }))
      const [path] = result.filePaths

      if (result.canceled || path === undefined) return { created: false }

      return { created: true, id: index.create({ cwd: path, title: basename(path) }) }
    },
  )

  ipcMain.handle(IPC_INVOKE.renameFree, (_event, request: RenameFreeRequest): void => {
    index.rename(request.id, request.title)
  })

  ipcMain.handle(IPC_INVOKE.forgetFree, async (_event, request: ForgetFreeRequest): Promise<void> => {
    await options.closeScope({ kind: 'free', id: request.id })
    index.forget(request.id)
  })

  return {
    refresh(): void {
      void index.refresh()
    },
    publish,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
