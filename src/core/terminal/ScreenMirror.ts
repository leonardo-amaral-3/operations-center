import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/headless'

import { SCROLLBACK } from '../../shared/claude'

export interface ScreenSnapshot {
  data: string
  cols: number
  rows: number
}

/**
 * O espelho da tela de um terminal Claude (#100 §1): um xterm sem DOM, alimentado pelos mesmos
 * bytes que vão ao renderer. É ele que permite a outro WebContents adotar o terminal sem reiniciar
 * o processo: o `snapshot()` escrito num xterm de mesmo tamanho reproduz rolagem, tela e cursor.
 *
 * Pura de Electron, para o teste rodar em Node.
 */
export class ScreenMirror {
  private readonly term: Terminal
  private readonly serializer = new SerializeAddon()
  private readonly pending = new Set<() => void>()
  private disposed = false
  /** O tamanho no `dispose()`, para liquidar `snapshot()` pendente com as dimensões certas. */
  private cols = 0
  private rows = 0

  constructor(cols: number, rows: number) {
    this.term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true })
    this.term.loadAddon(this.serializer)
  }

  write(data: string): void {
    if (!this.disposed) this.term.write(data)
  }

  resize(cols: number, rows: number): void {
    if (!this.disposed) this.term.resize(cols, rows)
  }

  /** Resolve depois que tudo que foi escrito antes foi processado. */
  snapshot(): Promise<ScreenSnapshot> {
    if (this.disposed) return Promise.resolve(this.empty())
    return new Promise((resolve) => {
      const settle = (): void => {
        this.pending.delete(settle)
        resolve(this.disposed ? this.empty() : this.capture())
      }
      this.pending.add(settle)
      this.term.write('', settle)
    })
  }

  /** Liquida todo `snapshot()` pendente com tela vazia: promessa nunca fica pendurada. */
  dispose(): void {
    if (this.disposed) return
    this.cols = this.term.cols
    this.rows = this.term.rows
    const waiting = [...this.pending]
    this.disposed = true
    this.term.dispose()
    for (const settle of waiting) settle()
  }

  private capture(): ScreenSnapshot {
    return {
      data: this.serializer.serialize({ scrollback: SCROLLBACK }),
      cols: this.term.cols,
      rows: this.term.rows,
    }
  }

  private empty(): ScreenSnapshot {
    return { data: '', cols: this.cols, rows: this.rows }
  }
}
