import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  contestacoesAbertas,
  lerRevisoes,
  LIMITE_DA_REVISAO,
  NOME_DO_COFRE,
  novaRevisao,
} from '../../src/core/fabrica/revisoes'
import {
  acrescentarRevisao,
  ARQUIVO_DAS_REVISOES,
  lerTextoDasRevisoes,
} from '../../src/main/fabrica/revisoes'

const A = '2026-11-10-a-primeira.md'
const B = '2026-11-10-a-segunda.md'
const AGORA = '2026-11-11T10:00:00.000Z'
const linha = (o: object): string => JSON.stringify(o) + '\n'

describe('NOME_DO_COFRE', () => {
  it('aceita o dia e o slug, e recusa pasta, .. e nome sem dia', () => {
    expect(NOME_DO_COFRE.test(A)).toBe(true)
    for (const ruim of [
      '../x.md',
      'x.md',
      'a/2026-11-10-x.md',
      '2026-11-10-X.md',
      '2026-11-10-x.txt',
    ]) {
      expect(NOME_DO_COFRE.test(ruim)).toBe(false)
    }
  })
})

describe('lerRevisoes', () => {
  it('vazio', () => {
    expect(lerRevisoes('')).toEqual({ revisoes: [], ilegiveis: 0 })
  })

  it('lê as três linhas: confirmada, contestada e a atendida dela', () => {
    const texto =
      linha({ tipo: 'confirmada', arquivo: A, em: '1' }) +
      linha({ tipo: 'contestada', arquivo: B, em: '2', motivo: 'errado' }) +
      linha({ tipo: 'atendida', arquivo: B, em: '3', resolucao: 'corrigido' })
    expect(lerRevisoes(texto)).toEqual({
      revisoes: [
        { arquivo: A, veredito: 'confirmada', em: '1', motivo: null, atendida: null },
        {
          arquivo: B,
          veredito: 'contestada',
          em: '2',
          motivo: 'errado',
          atendida: { em: '3', resolucao: 'corrigido' },
        },
      ],
      ilegiveis: 0,
    })
  })

  it('a primeira de cada arquivo vence, sem contar a outra como ilegível', () => {
    const texto =
      linha({ tipo: 'contestada', arquivo: A, em: '1', motivo: 'x' }) +
      linha({ tipo: 'confirmada', arquivo: A, em: '2' }) +
      linha({ tipo: 'contestada', arquivo: A, em: '3', motivo: 'y' })
    const r = lerRevisoes(texto)
    expect(r.ilegiveis).toBe(0)
    expect(r.revisoes).toHaveLength(1)
    expect(r.revisoes[0]).toMatchObject({ veredito: 'contestada', em: '1', motivo: 'x' })
  })

  it('atendida sem contestada, ou segunda atendida, é ignorada', () => {
    const texto =
      linha({ tipo: 'atendida', arquivo: A, em: '1', resolucao: 'x' }) +
      linha({ tipo: 'confirmada', arquivo: A, em: '2' }) +
      linha({ tipo: 'atendida', arquivo: A, em: '3', resolucao: 'x' }) +
      linha({ tipo: 'contestada', arquivo: B, em: '4', motivo: 'm' }) +
      linha({ tipo: 'atendida', arquivo: B, em: '5', resolucao: 'primeira' }) +
      linha({ tipo: 'atendida', arquivo: B, em: '6', resolucao: 'segunda' })
    const r = lerRevisoes(texto)
    expect(r.ilegiveis).toBe(0)
    expect(r.revisoes[0]?.atendida).toBeNull()
    expect(r.revisoes[1]?.atendida).toEqual({ em: '5', resolucao: 'primeira' })
  })

  it('linha torta, campo faltando e nome fora do padrão contam como ilegíveis; em branco não', () => {
    const texto = [
      '{torta',
      '[]',
      '42',
      JSON.stringify({ tipo: 'confirmada', arquivo: A }),
      JSON.stringify({ tipo: 'confirmada', arquivo: A, em: '' }),
      JSON.stringify({ tipo: 'contestada', arquivo: A, em: '1' }),
      JSON.stringify({ tipo: 'contestada', arquivo: A, em: '1', motivo: '' }),
      JSON.stringify({ tipo: 'atendida', arquivo: A, em: '1' }),
      JSON.stringify({ tipo: 'confirmada', arquivo: '../x.md', em: '1' }),
      JSON.stringify({ tipo: 'outra', arquivo: A, em: '1' }),
      '',
      '   ',
      JSON.stringify({ tipo: 'confirmada', arquivo: B, em: '9' }),
    ].join('\n')
    const r = lerRevisoes(texto)
    expect(r.ilegiveis).toBe(10)
    expect(r.revisoes.map((x) => x.arquivo)).toEqual([B])
  })
})

describe('novaRevisao', () => {
  const confirmada = lerRevisoes(linha({ tipo: 'confirmada', arquivo: A, em: '1' })).revisoes
  const contestada = lerRevisoes(
    linha({ tipo: 'contestada', arquivo: A, em: '1', motivo: 'm' }),
  ).revisoes
  const atendida = lerRevisoes(
    linha({ tipo: 'contestada', arquivo: A, em: '1', motivo: 'm' }) +
      linha({ tipo: 'atendida', arquivo: A, em: '2', resolucao: 'r' }),
  ).revisoes

  it('confirmar e contestar dão a linha, com trim e em = agora', () => {
    expect(novaRevisao([], { tipo: 'confirmar', arquivo: A, agora: AGORA })).toEqual({
      linha: { tipo: 'confirmada', arquivo: A, em: AGORA },
    })
    expect(
      novaRevisao([], { tipo: 'contestar', arquivo: A, motivo: '  x  ', agora: AGORA }),
    ).toEqual({ linha: { tipo: 'contestada', arquivo: A, em: AGORA, motivo: 'x' } })
  })

  it('nome inválido', () => {
    for (const tipo of ['confirmar', 'contestar', 'atender'] as const) {
      expect(
        novaRevisao([], {
          tipo,
          arquivo: '../x.md',
          motivo: 'm',
          resolucao: 'r',
          agora: AGORA,
        }),
      ).toEqual({ erro: 'nome de arquivo do cofre inválido: ../x.md' })
    }
  })

  it('veredito existente recusa confirmar e contestar', () => {
    expect(novaRevisao(confirmada, { tipo: 'confirmar', arquivo: A, agora: AGORA })).toEqual({
      erro: `${A} já foi confirmada em 1`,
    })
    expect(
      novaRevisao(contestada, { tipo: 'contestar', arquivo: A, motivo: 'x', agora: AGORA }),
    ).toEqual({ erro: `${A} já foi contestada em 1` })
    expect(novaRevisao(contestada, { tipo: 'confirmar', arquivo: A, agora: AGORA })).toEqual({
      erro: `${A} já foi contestada em 1`,
    })
  })

  it('motivo vazio e acima do teto, com o trim', () => {
    expect(
      novaRevisao([], { tipo: 'contestar', arquivo: A, motivo: ' \n ', agora: AGORA }),
    ).toEqual({
      erro: 'falta o motivo da contestação',
    })
    expect(
      novaRevisao([], { tipo: 'contestar', arquivo: A, motivo: 'x'.repeat(2001), agora: AGORA }),
    ).toEqual({ erro: 'o motivo passa de 2000 caracteres' })
    expect(LIMITE_DA_REVISAO).toBe(2000)
    expect(
      'linha' in
        novaRevisao([], {
          tipo: 'contestar',
          arquivo: A,
          motivo: ' ' + 'x'.repeat(2000) + ' ',
          agora: AGORA,
        }),
    ).toBe(true)
  })

  it('atender: sem contestação, já atendida, resolução vazia ou longa, e o caminho feliz', () => {
    const pedido = { tipo: 'atender', arquivo: A, resolucao: ' feito ', agora: AGORA } as const
    expect(novaRevisao([], pedido)).toEqual({ erro: `${A} não tem contestação` })
    expect(novaRevisao(confirmada, pedido)).toEqual({ erro: `${A} não tem contestação` })
    expect(novaRevisao(atendida, pedido)).toEqual({ erro: `${A} já foi atendida em 2` })
    expect(novaRevisao(contestada, { ...pedido, resolucao: '  ' })).toEqual({
      erro: 'falta a resolução',
    })
    expect(novaRevisao(contestada, { ...pedido, resolucao: 'x'.repeat(2001) })).toEqual({
      erro: 'a resolução passa de 2000 caracteres',
    })
    expect(novaRevisao(contestada, pedido)).toEqual({
      linha: { tipo: 'atendida', arquivo: A, em: AGORA, resolucao: 'feito' },
    })
  })
})

describe('contestacoesAbertas', () => {
  it('só as contestadas sem atendida, na ordem do arquivo', () => {
    const c = lerRevisoes(
      linha({ tipo: 'contestada', arquivo: B, em: '1', motivo: 'm' }) +
        linha({ tipo: 'confirmada', arquivo: A, em: '2' }) +
        linha({ tipo: 'contestada', arquivo: '2026-11-10-c.md', em: '3', motivo: 'm' }) +
        linha({ tipo: 'atendida', arquivo: B, em: '4', resolucao: 'r' }),
    ).revisoes
    expect(contestacoesAbertas(c).map((x) => x.arquivo)).toEqual(['2026-11-10-c.md'])
  })
})

describe('acrescentarRevisao', () => {
  let pasta = ''
  beforeEach(() => {
    pasta = mkdtempSync(join(__dirname, '..', '..', 'node_modules', '.oc-fabrica-teste-'))
  })
  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true })
  })

  it('cria o arquivo, acrescenta, e lerTextoDasRevisoes devolve null sem ele', () => {
    expect(pasta).toContain('.oc-fabrica-teste-')
    expect(lerTextoDasRevisoes(pasta)).toBeNull()
    acrescentarRevisao(pasta, { tipo: 'confirmada', arquivo: A, em: '1' })
    acrescentarRevisao(pasta, { tipo: 'contestada', arquivo: B, em: '2', motivo: 'm' })
    expect(readFileSync(join(pasta, ARQUIVO_DAS_REVISOES), 'utf8')).toBe(
      linha({ tipo: 'confirmada', arquivo: A, em: '1' }) +
        linha({ tipo: 'contestada', arquivo: B, em: '2', motivo: 'm' }),
    )
    expect(lerRevisoes(lerTextoDasRevisoes(pasta) as string).revisoes).toHaveLength(2)
  })

  it('cria a pasta que falta', () => {
    const funda = join(pasta, 'a', 'b')
    acrescentarRevisao(funda, { tipo: 'confirmada', arquivo: A, em: '1' })
    expect(lerTextoDasRevisoes(funda)).toContain(A)
  })

  it('arquivo que termina sem \\n ganha o \\n antes da linha nova', () => {
    writeFileSync(join(pasta, ARQUIVO_DAS_REVISOES), '{"tipo":"confirm')
    acrescentarRevisao(pasta, { tipo: 'confirmada', arquivo: A, em: '1' })
    const texto = readFileSync(join(pasta, ARQUIVO_DAS_REVISOES), 'utf8')
    expect(texto).toBe('{"tipo":"confirm\n' + linha({ tipo: 'confirmada', arquivo: A, em: '1' }))
    expect(lerRevisoes(texto)).toMatchObject({ ilegiveis: 1 })
  })

  it('o /tmp é recusado e nada nasce', () => {
    const dentro = join(tmpdir(), randomUUID())
    expect(() => {
      acrescentarRevisao(dentro, { tipo: 'confirmada', arquivo: A, em: '1' })
    }).toThrow('OC_FABRICA_DIR não pode ficar no /tmp')
  })

  it('outro erro de leitura sobe (o arquivo é uma pasta)', () => {
    mkdirSync(join(pasta, ARQUIVO_DAS_REVISOES))
    expect(() => lerTextoDasRevisoes(pasta)).toThrow()
  })
})
