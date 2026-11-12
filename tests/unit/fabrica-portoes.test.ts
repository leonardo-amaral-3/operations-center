import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import {
  PORTOES,
  REGRA_DAS_PARADAS,
  portoesDoMandato,
  regrasDoMandato,
} from '../../src/core/fabrica/portoes'
import { lerMandatoNaSala } from '../../src/main/fabrica/mandatoNaSala'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const RAIZ = fileURLToPath(new URL('../../', import.meta.url))
const DO_REPO = readFileSync(join(RAIZ, 'fabrica', 'MANDATO.md'), 'utf8')
const DA_FIXTURE = readFileSync(join(RAIZ, 'tests', 'fixtures', 'fabrica', 'f5-mandato.md'), 'utf8')

const ENTREGA =
  'Você decide sozinho os portões da sua etapa (G1, G2, G3, G4), commits e PR. O merge na dev é do braço direito (a orquestradora), não seu.'
const PROIBIDO_INICIO = 'Proibido: main, release, tag;'

const por = (texto: string) => Object.fromEntries(portoesDoMandato(texto).map((p) => [p.id, p]))

describe('portoesDoMandato sobre o mandato de verdade', () => {
  for (const [nome, texto] of [
    ['fabrica/MANDATO.md da worktree', DO_REPO],
    ['a fixture f5-mandato.md', DA_FIXTURE],
  ] as const) {
    it(`${nome}: nove portões na ordem de PORTOES`, () => {
      expect(portoesDoMandato(texto).map((p) => p.id)).toEqual(PORTOES.map((p) => p.id))
    })

    it(`${nome}: G1 a G4 e implementação em A, com a linha que os sustenta`, () => {
      const p = por(texto)

      for (const id of ['g1', 'g2', 'g3', 'g4', 'impl']) {
        expect(p[id]).toMatchObject({ quem: 'A', travado: false, fonte: ENTREGA })
      }
    })

    it(`${nome}: G5 travado em C com a linha do Proibido; os outros três não dizem`, () => {
      const p = por(texto)

      expect(p.g5).toMatchObject({ quem: 'C', travado: true })
      expect(p.g5?.fonte?.startsWith(PROIBIDO_INICIO)).toBe(true)
      for (const id of ['entrada', 'val', 'op']) {
        expect(p[id]).toMatchObject({ quem: null, travado: false, fonte: null })
      }
    })
  }

  it('a fixture é uma cópia byte a byte do mandato do repo', () => {
    expect(DA_FIXTURE).toBe(DO_REPO)
  })
})

describe('portoesDoMandato, variações', () => {
  it('só "(G1, G2)": g3 e g4 não dizem', () => {
    const p = por(ENTREGA.replace('(G1, G2, G3, G4)', '(G1, G2)'))

    expect(p.g1?.quem).toBe('A')
    expect(p.g2?.quem).toBe('A')
    expect(p.g3).toMatchObject({ quem: null, fonte: null })
    expect(p.g4).toMatchObject({ quem: null, fonte: null })
  })

  it('sem "commits": a implementação não diz', () => {
    const p = por(ENTREGA.replace('commits e PR', 'PR'))

    expect(p.impl).toMatchObject({ quem: null, fonte: null })
    expect(p.g1?.quem).toBe('A')
  })

  it('sem a linha: tudo não diz, salvo o G5', () => {
    const p = por('Outra coisa qualquer.\n- Proibido: x;')

    for (const id of ['entrada', 'g1', 'g2', 'g3', 'impl', 'g4', 'val', 'op']) {
      expect(p[id]?.quem).toBeNull()
    }
    expect(p.g5).toMatchObject({ quem: 'C', travado: true, fonte: 'Proibido: x;' })
  })

  it('sem "Proibido:": o G5 continua travado, com fonte null', () => {
    expect(por(ENTREGA).g5).toMatchObject({ quem: 'C', travado: true, fonte: null })
  })

  it('aceita CRLF e o "- " do começo da linha', () => {
    const p = por(`- ${ENTREGA}\r\n- ${PROIBIDO_INICIO} x\r\n`)

    expect(p.g2).toMatchObject({ quem: 'A', fonte: ENTREGA })
    expect(p.g5?.fonte).toBe(`${PROIBIDO_INICIO} x`)
  })

  it('só os G dentro dos parênteses valem', () => {
    const p = por('Você decide sozinho os portões da etapa (G1), e o G4 fica com você.')

    expect(p.g1?.quem).toBe('A')
    expect(p.g4?.quem).toBeNull()
  })
})

describe('regrasDoMandato', () => {
  it('a regra das paradas e, na ordem do arquivo, o Proibido e o Pare', () => {
    const r = regrasDoMandato(DO_REPO)

    expect(r).toHaveLength(3)
    expect(r[0]).toBe(REGRA_DAS_PARADAS)
    expect(r[1]?.startsWith('Proibido:')).toBe(true)
    expect(r[2]?.startsWith('Pare (PARADA) em:')).toBe(true)
  })

  it('sem as duas linhas, só a regra das paradas', () => {
    expect(regrasDoMandato('nada\naqui')).toEqual([REGRA_DAS_PARADAS])
  })
})

describe('lerMandatoNaSala', () => {
  it('leitura ok vira portões e regras', async () => {
    const r = await lerMandatoNaSala(() => Promise.resolve(DO_REPO))

    expect(r).toEqual({
      kind: 'ok',
      portoes: portoesDoMandato(DO_REPO),
      regras: regrasDoMandato(DO_REPO),
    })
  })

  it('leitura que rejeita vira erro, sem rejeitar', async () => {
    expect(await lerMandatoNaSala(() => Promise.reject(new Error('sem rede')))).toEqual({
      kind: 'erro',
      erro: 'sem rede',
    })
  })
})
