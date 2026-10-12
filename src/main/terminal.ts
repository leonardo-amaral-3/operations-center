import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'
import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { LoadSpawn, PtySpawner, TerminalHost } from '../core'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type {
  OpenTerminalRequest,
  OpenTerminalResult,
  SessionScope,
  TerminalCloseRequest,
  TerminalInputRequest,
  TerminalPresetsSnapshot,
  TerminalResizeRequest,
} from '../shared/ipc'
import { childEnv, toPublicPreset } from './terminalPresets'
import type { PresetDeps, ResolvedPreset } from './terminalPresets'

/**
 * Liga o `TerminalHost` ao app (spec #74 §3, CA-1 e CA-8).
 *
 * Terminal que não abre **não é exceção**: `terminal:open` devolve `opened: false` com o motivo e o
 * `detail` que o renderer desenha no lugar da aba. Nenhum handler spawna nada sozinho, então o
 * registro é incondicional — a tela `chat` continua determinística.
 */

/**
 * O `loadSpawn` do main: `import('node-pty')` **dentro de try/catch**. Lazy porque o app tem de abrir
 * mesmo com o módulo quebrado — o erro aparece quando um terminal é pedido, como `pty-unavailable`, e
 * não como tela branca no boot. O `externalizeDepsPlugin` deixa o import como `require` externo, então
 * o `catch` pega o `MODULE_NOT_FOUND` e o erro de carga do `.node`.
 */
export const loadPty: LoadSpawn = async () => {
  try {
    const pty = await import('node-pty')
    const spawn: PtySpawner = (shell, args, opts) => {
      const processo = pty.spawn(shell, [...args], {
        name: 'xterm-256color',
        cwd: opts.cwd,
        env: opts.env,
        cols: opts.cols,
        rows: opts.rows,
      })
      return {
        onData: (cb) => void processo.onData(cb),
        onExit: (cb) => void processo.onExit(({ exitCode }) => cb({ exitCode })),
        write: (data) => processo.write(data),
        resize: (cols, rows) => processo.resize(cols, rows),
        kill: () => processo.kill(),
      }
    }
    return { ok: true, spawn }
  } catch (erro) {
    return { ok: false, detail: erro instanceof Error ? erro.message : String(erro) }
  }
}

/** As pontas de IO de produção dos perfis; o `where` é do System32, como em `claudeBin.ts`. */
export function presetDepsDeProducao(): PresetDeps {
  return {
    which: (exe) => {
      try {
        return (
          execFileSync('where', [exe], { encoding: 'utf8' })
            .split(/\r?\n/)
            .map((linha) => linha.trim())
            .find((linha) => linha !== '') ?? null
        )
      } catch {
        return null
      }
    },
    exists: existsSync,
    awsConfig: () => {
      try {
        return readFileSync(join(homedir(), '.aws', 'config'), 'utf8')
      } catch {
        return null
      }
    },
    programFiles: process.env.ProgramFiles ?? 'C:\\Program Files',
    systemRoot: process.env.SystemRoot ?? 'C:\\Windows',
  }
}

export interface TerminalIpcOptions {
  /** Relido a cada pedido: `~/.aws/config` pode ganhar perfil com o app aberto. */
  presets: () => readonly ResolvedPreset[]
  /** O mesmo lambda do `registerSessionIpc`; `null` = pasta desconhecida. */
  resolveCwd: (scope: SessionScope) => Promise<string | null>
  host: TerminalHost
  /** Injetável para o teste; em produção, `existsSync`. */
  exists?: (path: string) => boolean
}

export interface TerminalIpc {
  closeAll(): void
}

export function registerTerminalIpc(options: TerminalIpcOptions): TerminalIpc {
  const { host, exists = existsSync } = options
  /** Quem abriu cada terminal: `data` e `exit` são emitidos só para esse `sender`. */
  const owners = new Map<string, WebContents>()
  const watched = new WeakSet<WebContents>()

  const emit = (sender: WebContents, channel: string, payload: unknown): void => {
    // O renderer pode morrer com o shell ainda falando; mandar a um `WebContents` destruído joga.
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }

  /** Um reload ou crash do renderer não pode deixar shell órfão para o `hydrate` subir outro por cima. */
  const closeOf = (sender: WebContents): void => {
    for (const [id, dono] of owners) {
      if (dono !== sender) continue
      owners.delete(id)
      host.close(id)
    }
  }

  const watch = (sender: WebContents): void => {
    if (watched.has(sender)) return
    watched.add(sender)
    sender.once('destroyed', () => closeOf(sender))
    sender.once('render-process-gone', () => closeOf(sender))
  }

  ipcMain.handle(IPC_INVOKE.readTerminalPresets, (): TerminalPresetsSnapshot => ({
    presets: options.presets().map(toPublicPreset),
  }))

  ipcMain.handle(
    IPC_INVOKE.openTerminal,
    async (event, request: OpenTerminalRequest): Promise<OpenTerminalResult> => {
      const preset = options.presets().find((p) => p.id === request.preset)
      if (preset === undefined) {
        return {
          opened: false,
          reason: 'shell-missing',
          detail: `perfil desconhecido: ${request.preset}`,
        }
      }
      if (!exists(preset.shell)) {
        return { opened: false, reason: 'shell-missing', detail: preset.shell }
      }

      let cwd = homedir()
      if (request.scope !== undefined) {
        const pasta = await options.resolveCwd(request.scope)
        if (pasta === null) {
          return {
            opened: false,
            reason: 'unknown-folder',
            detail: 'a pasta deste card ou sessão não é conhecida',
          }
        }
        cwd = pasta
      }

      const aberto = await host.open({
        shell: preset.shell,
        args: preset.args,
        env: childEnv(preset),
        cwd,
        cols: request.cols,
        rows: request.rows,
      })
      if (!aberto.ok) return { opened: false, reason: 'pty-unavailable', detail: aberto.detail }

      const sender = event.sender
      owners.set(aberto.id, sender)
      watch(sender)
      host.onData(aberto.id, (data) =>
        emit(sender, IPC_EVENT.terminalData, { id: aberto.id, data }),
      )
      host.onExit(aberto.id, (exitCode) => {
        owners.delete(aberto.id)
        emit(sender, IPC_EVENT.terminalExit, { id: aberto.id, exitCode })
      })

      const title =
        request.scope === undefined ? preset.label : `${preset.label} · ${win32.basename(cwd)}`
      return { opened: true, terminal: { id: aberto.id, preset: preset.id, title } }
    },
  )

  ipcMain.handle(IPC_INVOKE.writeTerminal, (_e, r: TerminalInputRequest): void =>
    host.write(r.id, r.data),
  )
  ipcMain.handle(IPC_INVOKE.resizeTerminal, (_e, r: TerminalResizeRequest): void =>
    host.resize(r.id, r.cols, r.rows),
  )
  ipcMain.handle(IPC_INVOKE.closeTerminal, (_e, r: TerminalCloseRequest): void => {
    owners.delete(r.id)
    host.close(r.id)
  })

  return {
    closeAll: () => {
      owners.clear()
      host.closeAll()
    },
  }
}
