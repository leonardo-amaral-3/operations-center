import { describe, expect, it } from 'vitest'

import { parsePatch } from '../../src/core/board/patch'
import { DIFF_MAX_LINES } from '../../src/core/session/transcript'

function linhas(patch: string) {
  return parsePatch(patch, 0, 0).hunks.flatMap((h) => h.lines)
}

describe('parsePatch — numeração', () => {
  it('numera `+` e ` ` pelo contador novo e `-` pelo velho', () => {
    const patch = ['@@ -10,3 +20,3 @@', ' ctx', '-velha', '+nova', ' fim'].join('\n')

    expect(linhas(patch)).toEqual([
      { kind: 'context', number: 20, text: 'ctx' },
      { kind: 'remove', number: 11, text: 'velha' },
      { kind: 'add', number: 21, text: 'nova' },
      { kind: 'context', number: 22, text: 'fim' },
    ])
  })

  it('abre um trecho por cabeçalho, cada um com seus contadores', () => {
    const patch = ['@@ -1,1 +1,1 @@', '+a', '@@ -50,1 +60,1 @@', '+b'].join('\n')
    const { hunks } = parsePatch(patch, 2, 0)

    expect(hunks).toHaveLength(2)
    expect(hunks[0]?.lines[0]?.number).toBe(1)
    expect(hunks[1]?.lines[0]?.number).toBe(60)
  })

  it('aceita o cabeçalho sem contagem', () => {
    expect(linhas('@@ -1 +1 @@\n-a\n+b')).toEqual([
      { kind: 'remove', number: 1, text: 'a' },
      { kind: 'add', number: 1, text: 'b' },
    ])
    expect(linhas('@@ -0,0 +1 @@\n+a')).toEqual([{ kind: 'add', number: 1, text: 'a' }])
  })
})

describe('parsePatch — o que sobra de fora', () => {
  it('lê `\\r\\n` e não faz do `\\n` final uma linha', () => {
    expect(linhas('@@ -1 +1 @@\r\n+a\r\n')).toEqual([{ kind: 'add', number: 1, text: 'a' }])
  })

  it('ignora a marca de fim de arquivo e o que vem antes do primeiro cabeçalho', () => {
    const patch = ['diff solto', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b'].join('\n')

    expect(linhas(patch).map((l) => l.text)).toEqual(['a', 'b'])
  })

  it('mantém o texto sem o prefixo de um caractere', () => {
    expect(linhas('@@ -1 +1 @@\n+  indentado')[0]?.text).toBe('  indentado')
  })
})

describe('parsePatch — o corte (CA-5)', () => {
  it('corta no teto do chat e deixa os totais da REST intactos', () => {
    const total = DIFF_MAX_LINES + 15
    const patch = [`@@ -0,0 +1,${total} @@`, ...Array.from({ length: total }, (_, i) => `+l${i}`)].join('\n')
    const diff = parsePatch(patch, total, 0)

    expect(diff.hunks.flatMap((h) => h.lines)).toHaveLength(DIFF_MAX_LINES)
    expect(diff.truncated).toBe(15)
    expect(diff.additions).toBe(total)
    expect(diff.deletions).toBe(0)
  })
})
