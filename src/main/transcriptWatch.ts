/**
 * O vigia da interrupção (#97). O Esc na TUI não dispara hook nenhum (P6, P13, P14): o único rastro
 * é uma linha `user` no JSONL que começa com `[Request interrupted by user`. Este módulo lê o fim do
 * arquivo em intervalo e avisa uma vez.
 */

import { statSync } from 'node:fs'
import { open } from 'node:fs/promises'

export interface TranscriptWatch {
  stop(): void
}

type ReadFrom = (path: string, offset: number) => Promise<{ text: string; size: number }>

const MARKER = '[Request interrupted by user'

/** Do `offset` até o fim. `size` é o tamanho do arquivo depois da leitura: vira o próximo offset. */
async function readFromDisk(path: string, offset: number): Promise<{ text: string; size: number }> {
  const handle = await open(path, 'r')
  try {
    const { size: total } = await handle.stat()
    if (total <= offset) return { text: '', size: total }
    const buffer = Buffer.alloc(total - offset)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), size: offset + bytesRead }
  } finally {
    await handle.close()
  }
}

function isInterruption(line: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false
  const entry = parsed as { type?: unknown; message?: { content?: unknown } }
  if (entry.type !== 'user') return false
  const content = entry.message?.content
  if (typeof content === 'string') return content.startsWith(MARKER)
  if (!Array.isArray(content)) return false
  return content.some((block: unknown) => {
    const b = block as { type?: unknown; text?: unknown } | null
    return b?.type === 'text' && typeof b.text === 'string' && b.text.startsWith(MARKER)
  })
}

export function watchInterrupt(
  path: string,
  onInterrupted: () => void,
  deps: { intervalMs?: number; readFrom?: ReadFrom } = {},
): TranscriptWatch {
  const readFrom = deps.readFrom ?? readFromDisk
  // Síncrono: um Esc logo depois do prompt nunca cai antes do offset.
  let offset = 0
  try {
    offset = statSync(path).size
  } catch {
    offset = 0
  }
  let pending = ''
  let reading = false
  let done = false

  const tick = async (): Promise<void> => {
    if (reading || done) return
    reading = true
    try {
      const { text, size } = await readFrom(path, offset)
      if (done) return
      if (size < offset) {
        // O arquivo ficou menor que o offset: recomeça do zero.
        offset = 0
        pending = ''
        return
      }
      offset = size
      pending += text
      const lines = pending.split('\n')
      // A última peça não tem `\n` no fim: fica para a próxima leitura.
      pending = lines.pop() ?? ''
      if (lines.some(isInterruption)) {
        stop()
        onInterrupted()
      }
    } catch {
      // Tentado de novo no próximo tique.
    } finally {
      reading = false
    }
  }

  const timer = setInterval(() => void tick(), deps.intervalMs ?? 1000)

  function stop(): void {
    done = true
    clearInterval(timer)
  }

  return { stop }
}
