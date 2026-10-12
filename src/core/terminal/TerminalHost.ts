import { randomUUID } from 'node:crypto'

/**
 * O host dos terminais (spec #74 §3, CA-1 e CA-8).
 *
 * Agnóstico de casca e **de `node-pty`**: o spawner chega por um thunk assíncrono, e é isso que
 * deixa o teste provar `pty-unavailable` sem tocar no módulo nativo e o app abrir mesmo com ele
 * quebrado — a falha de carga aparece quando um terminal é pedido, não como tela branca no boot.
 * O molde é o do `SessionHost`: quem abre é quem sabe fechar, e id desconhecido não é erro.
 */

export interface PtyProcess {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type PtySpawner = (
  shell: string,
  args: readonly string[],
  opts: { cwd: string; env: Record<string, string>; cols: number; rows: number },
) => PtyProcess

export type LoadSpawn = () => Promise<
  { ok: true; spawn: PtySpawner } | { ok: false; detail: string }
>

export interface OpenTerminalInput {
  shell: string
  args: readonly string[]
  env: Record<string, string>
  cwd: string
  cols: number
  rows: number
}

export type HostOpenResult = { ok: true; id: string } | { ok: false; detail: string }

interface Live {
  pty: PtyProcess
  data: Set<(data: string) => void>
  exit: Set<(exitCode: number) => void>
}

export class TerminalHost {
  readonly #loadSpawn: LoadSpawn
  /** Memoizado: o `import('node-pty')` custa uma vez, e a falha também — repetir não conserta. */
  #loaded: Promise<Awaited<ReturnType<LoadSpawn>>> | null = null
  readonly #live = new Map<string, Live>()

  constructor(loadSpawn: LoadSpawn) {
    this.#loadSpawn = loadSpawn
  }

  async open(input: OpenTerminalInput): Promise<HostOpenResult> {
    this.#loaded ??= this.#loadSpawn()
    const loaded = await this.#loaded
    if (!loaded.ok) return { ok: false, detail: loaded.detail }

    let pty: PtyProcess
    try {
      pty = loaded.spawn(input.shell, input.args, {
        cwd: input.cwd,
        env: input.env,
        cols: input.cols,
        rows: input.rows,
      })
    } catch (erro) {
      // Spawn que joga (executável sem permissão, cwd inválido) é o mesmo "não abriu" de um módulo
      // que não carregou: o motivo viaja como `detail`, e o renderer desenha o remédio.
      return { ok: false, detail: erro instanceof Error ? erro.message : String(erro) }
    }

    const id = randomUUID()
    const live: Live = { pty, data: new Set(), exit: new Set() }
    this.#live.set(id, live)

    pty.onData((data) => {
      // `data` que chega depois do `close` é descartado: a aba já não existe para recebê-lo.
      if (!this.#live.has(id)) return
      for (const cb of live.data) cb(data)
    })
    pty.onExit(({ exitCode }) => {
      if (!this.#live.delete(id)) return
      for (const cb of live.exit) cb(exitCode)
    })

    return { ok: true, id }
  }

  onData(id: string, cb: (data: string) => void): void {
    this.#live.get(id)?.data.add(cb)
  }

  onExit(id: string, cb: (exitCode: number) => void): void {
    this.#live.get(id)?.exit.add(cb)
  }

  /** Id desconhecido é no-op: a aba pode ter morrido entre o keystroke e o handler. */
  write(id: string, data: string): void {
    this.#live.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.#live.get(id)?.pty.resize(cols, rows)
  }

  close(id: string): void {
    const live = this.#live.get(id)
    if (live === undefined) return
    this.#live.delete(id)
    live.pty.kill()
  }

  closeAll(): void {
    for (const id of [...this.#live.keys()]) this.close(id)
  }
}
