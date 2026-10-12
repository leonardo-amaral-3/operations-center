import type { PtyProcess, PtySpawner } from '../../src/core'

/**
 * O PTY de mentira (spec #74 §3): grava o que o host faz com ele e deixa o teste empurrar `data` e
 * `exit` à mão. O `node-pty` nunca é carregado na suíte de unidade — é por isso que o `TerminalHost`
 * recebe o spawner injetado.
 */
export interface FakePty extends PtyProcess {
  writes: string[]
  resizes: Array<[number, number]>
  killed: boolean
  emitData(data: string): void
  emitExit(exitCode: number): void
}

export function createFakePty(): FakePty {
  let onData: (data: string) => void = () => {}
  let onExit: (e: { exitCode: number }) => void = () => {}
  const pty: FakePty = {
    writes: [],
    resizes: [],
    killed: false,
    onData: (cb) => void (onData = cb),
    onExit: (cb) => void (onExit = cb),
    write: (data) => void pty.writes.push(data),
    resize: (cols, rows) => void pty.resizes.push([cols, rows]),
    kill: () => void (pty.killed = true),
    emitData: (data) => onData(data),
    emitExit: (exitCode) => onExit({ exitCode }),
  }
  return pty
}

/** Um spawner que devolve PTYs falsos e guarda cada chamada, na ordem. */
export function createFakeSpawner(): {
  spawn: PtySpawner
  calls: Array<{ shell: string; args: readonly string[]; cwd: string; cols: number; rows: number }>
  ptys: FakePty[]
} {
  const calls: ReturnType<typeof createFakeSpawner>['calls'] = []
  const ptys: FakePty[] = []
  const spawn: PtySpawner = (shell, args, opts) => {
    calls.push({ shell, args, cwd: opts.cwd, cols: opts.cols, rows: opts.rows })
    const pty = createFakePty()
    ptys.push(pty)
    return pty
  }
  return { spawn, calls, ptys }
}
