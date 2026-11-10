import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ehExecutavel, procurarNoPath } from '../../src/main/pathLookup'

describe('procurarNoPath', () => {
  it('devolve os executáveis na ordem do PATH, pulando entradas vazias', () => {
    const e = (c: string) => c === '/b/claude' || c === '/c/claude'

    expect(procurarNoPath('claude', '/a::/b:/c', e)).toEqual(['/b/claude', '/c/claude'])
  })

  it('ignora entradas relativas e a entrada vazia', () => {
    expect(procurarNoPath('claude', '.:bin:/b', () => true)).toEqual(['/b/claude'])
  })

  it('PATH indefinido devolve lista vazia', () => {
    expect(procurarNoPath('claude', undefined, () => true)).toEqual([])
  })
})

describe('ehExecutavel', () => {
  const pastas: string[] = []

  afterEach(() => {
    for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
  })

  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'oc-path-'))
    pastas.push(d)

    return d
  }

  // O bit de execução não existe no Windows; o caso é do POSIX.
  const posix = process.platform === 'win32' ? it.skip : it

  posix('arquivo com e sem permissão de execução', () => {
    const arq = join(tmp(), 'claude')
    writeFileSync(arq, '#!/bin/sh\n')
    chmodSync(arq, 0o755)
    expect(ehExecutavel(arq)).toBe(true)

    chmodSync(arq, 0o644)
    expect(ehExecutavel(arq)).toBe(false)
  })

  it('uma pasta não é executável, e o inexistente também não', () => {
    const d = tmp()

    expect(ehExecutavel(d)).toBe(false)
    expect(ehExecutavel(join(d, 'nada'))).toBe(false)
  })
})
