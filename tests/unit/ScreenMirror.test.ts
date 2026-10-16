import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'

import { ScreenMirror } from '../../src/core/terminal/ScreenMirror'

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

/** Rolagem + tela linha a linha, com o cursor: o que "reproduz o buffer" quer dizer. */
function dump(term: Terminal): { lines: string[]; cursor: [number, number]; cols: number; rows: number } {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
  return { lines, cursor: [buf.cursorX, buf.cursorY], cols: term.cols, rows: term.rows }
}

const SAIDA =
  Array.from({ length: 20 }, (_, i) => `linha ${i}\r\n`).join('') +
  '\x1b[2K\r\x1b[1;31mvermelho\x1b[0m e \x1b[4msublinhado\x1b[0m\x1b[2;5H'

describe('ScreenMirror', () => {
  it('o snapshot escrito num xterm de mesmo tamanho reproduz rolagem, tela e cursor', async () => {
    const mirror = new ScreenMirror(40, 6)
    mirror.write(SAIDA)
    const snap = await mirror.snapshot()

    expect(snap.cols).toBe(40)
    expect(snap.rows).toBe(6)

    const original = new Terminal({ cols: 40, rows: 6, scrollback: 5000, allowProposedApi: true })
    await write(original, SAIDA)
    const copia = new Terminal({ cols: snap.cols, rows: snap.rows, scrollback: 5000, allowProposedApi: true })
    await write(copia, snap.data)

    expect(dump(copia)).toEqual(dump(original))
    expect(dump(copia).lines.length).toBeGreaterThan(6)
    mirror.dispose()
  })

  it('resize reflete no snapshot', async () => {
    const mirror = new ScreenMirror(40, 6)
    mirror.write('abc\r\n')
    mirror.resize(80, 10)
    const snap = await mirror.snapshot()
    expect(snap.cols).toBe(80)
    expect(snap.rows).toBe(10)
    mirror.dispose()
  })

  it('snapshot espera a escrita pendente', async () => {
    const mirror = new ScreenMirror(40, 6)
    mirror.write('primeiro\r\n')
    mirror.write('segundo')
    const snap = await mirror.snapshot()
    expect(snap.data).toContain('primeiro')
    expect(snap.data).toContain('segundo')
    mirror.dispose()
  })

  it('dispose liquida o snapshot pendente com tela vazia, sem deixar a promessa pendurada', async () => {
    const mirror = new ScreenMirror(40, 6)
    mirror.write('algo\r\n')
    const pendente = mirror.snapshot()
    mirror.dispose()
    await expect(pendente).resolves.toEqual({ data: '', cols: 40, rows: 6 })
    await expect(mirror.snapshot()).resolves.toEqual({ data: '', cols: 40, rows: 6 })
    expect(() => {
      mirror.write('x')
      mirror.resize(10, 10)
      mirror.dispose()
    }).not.toThrow()
  })
})
