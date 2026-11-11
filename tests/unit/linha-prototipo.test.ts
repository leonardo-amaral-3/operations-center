import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { COLUNAS_DA_LINHA } from '../../src/renderer/fabrica/linha'

/**
 * A Linha contra o protótipo (#131, CA-2.1): os nove rótulos são, na ordem, o primeiro `<span>` de
 * cada `class="colhead"` do `Main.dc.html`. Os níveis do protótipo **não** são exigidos: a F2 os lê
 * do mandato, e o protótipo traz os de antes dele.
 */
const MAIN = readFileSync(
  fileURLToPath(new URL('../fixtures/prototipo/Main.dc.html', import.meta.url)),
  'utf8',
)

describe('a Linha e o Main.dc.html', () => {
  it('os nove rótulos saem do protótipo, na ordem', () => {
    const doPrototipo = [...MAIN.matchAll(/class="colhead"[^>]*><span>([^<]*)<\/span>/g)].map(
      (m) => m[1],
    )
    expect(doPrototipo).toHaveLength(9)
    expect(COLUNAS_DA_LINHA.map((c) => c.rotulo)).toEqual(doPrototipo)
  })
})
