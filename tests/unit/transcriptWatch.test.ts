import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { watchInterrupt } from '../../src/main/transcriptWatch'
import type { TranscriptWatch } from '../../src/main/transcriptWatch'

const MARCA = '[Request interrupted by user for tool use]'
const linha = (content: unknown): string => JSON.stringify({ type: 'user', message: { content } }) + '\n'

let dir: string
let file: string
let watch: TranscriptWatch | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'watch-'))
  file = join(dir, 't.jsonl')
})

afterEach(() => {
  watch?.stop()
  watch = null
  rmSync(dir, { recursive: true, force: true })
})

async function espera(ms = 80): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('watchInterrupt', () => {
  it('ignora o que já existia e dispara uma vez para marcador em string', async () => {
    writeFileSync(file, linha(MARCA))
    const onInterrupted = vi.fn()
    watch = watchInterrupt(file, onInterrupted, { intervalMs: 10 })

    await espera()
    expect(onInterrupted).not.toHaveBeenCalled()

    appendFileSync(file, linha(MARCA))
    await vi.waitFor(() => {
      expect(onInterrupted).toHaveBeenCalledTimes(1)
    })
    appendFileSync(file, linha(MARCA))
    await espera()
    expect(onInterrupted).toHaveBeenCalledTimes(1)
  })

  it('marcador em array de blocos de texto', async () => {
    const onInterrupted = vi.fn()
    watch = watchInterrupt(file, onInterrupted, { intervalMs: 10 })

    appendFileSync(file, linha([{ type: 'text', text: '[Request interrupted by user]' }]))

    await vi.waitFor(() => {
      expect(onInterrupted).toHaveBeenCalledTimes(1)
    })
  })

  it('linha incompleta só dispara quando se completa', async () => {
    const onInterrupted = vi.fn()
    watch = watchInterrupt(file, onInterrupted, { intervalMs: 10 })
    const inteira = linha(MARCA)

    appendFileSync(file, inteira.slice(0, 20))
    await espera()
    expect(onInterrupted).not.toHaveBeenCalled()

    appendFileSync(file, inteira.slice(20))
    await vi.waitFor(() => {
      expect(onInterrupted).toHaveBeenCalledTimes(1)
    })
  })

  it('JSON inválido e texto comum são ignorados', async () => {
    const onInterrupted = vi.fn()
    watch = watchInterrupt(file, onInterrupted, { intervalMs: 10 })

    appendFileSync(file, '{lixo\n' + linha('oi, tudo bem?') + linha(MARCA))

    await vi.waitFor(() => {
      expect(onInterrupted).toHaveBeenCalledTimes(1)
    })
  })

  it('arquivo que encolhe recomeça do zero', async () => {
    writeFileSync(file, linha('x'.repeat(200)))
    const onInterrupted = vi.fn()
    watch = watchInterrupt(file, onInterrupted, { intervalMs: 10 })

    writeFileSync(file, linha(MARCA))

    await vi.waitFor(() => {
      expect(onInterrupted).toHaveBeenCalledTimes(1)
    })
  })

  it('stop impede o disparo', async () => {
    const onInterrupted = vi.fn()
    watch = watchInterrupt(file, onInterrupted, { intervalMs: 10 })
    watch.stop()

    appendFileSync(file, linha(MARCA))
    await espera()

    expect(onInterrupted).not.toHaveBeenCalled()
  })
})
