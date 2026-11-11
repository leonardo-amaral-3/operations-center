import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { classificar } from '../../src/core/relatorio/classificar'
import {
  cardDoEscopo,
  decisoesDoDia,
  janelaDoDia,
  lerDecisao,
} from '../../src/core/relatorio/cofre'
import { lerObjetivos } from '../../src/core/relatorio/direcao'

const REPO = { owner: 'leonardo-amaral-3', name: 'operations-center' }
const FIXTURES = fileURLToPath(new URL('../fixtures/relatorio/', import.meta.url))
const COFRE = join(FIXTURES, 'cofre-2026-11-10')

/** Monta um arquivo do cofre no formato do `lembrar` (R1). */
function arquivo(frontmatter: string, corpo: string): string {
  return `---\n${frontmatter}\n---\n${corpo}`
}

const FM = 'data: 2026-11-10\ntipo: decisao\nescopo: operations-center#118'

describe('cardDoEscopo (spec-p1 §2)', () => {
  it.each([
    ['operations-center', true, null],
    ['operations-center#118', true, 118],
    ['leonardo-amaral-3/operations-center#5', true, 5],
    [' operations-center#119 ', true, 119],
    ['operations-center-x#1', false, null],
    ['outro/operations-center#1', false, null],
    ['claude-brain#43', false, null],
    ['118', false, null],
    ['operations-center#118 P1', false, null],
  ])('%j', (escopo, casa, card) => {
    expect(cardDoEscopo(escopo, REPO)).toEqual({ casa, card })
  })
})

describe('janelaDoDia', () => {
  it('vai de 00:00Z ao 00:00Z do dia seguinte', () => {
    expect(janelaDoDia('2026-11-10')).toEqual({
      dia: '2026-11-10',
      inicio: '2026-11-10T00:00:00Z',
      fim: '2026-11-11T00:00:00Z',
    })
  })

  it('vira o ano', () => {
    expect(janelaDoDia('2026-12-31').fim).toBe('2027-01-01T00:00:00Z')
  })
})

describe('lerDecisao (spec-p1 §2)', () => {
  it('lê título, fato, porquê, descartado e marcas; descarta o Refs', () => {
    const d = lerDecisao(
      'x.md',
      arquivo(
        FM,
        '# Decidi isso\n\nDecidi isso. E mais.\n\n**Por quê:** porque sim. objetivo: P0..P3 reversível: sim\n\n**Descartado:** aquilo\n\n**Refs:** r\n',
      ),
    )

    expect(d).toMatchObject({
      arquivo: 'x.md',
      data: '2026-11-10',
      tipo: 'decisao',
      escopo: 'operations-center#118',
      card: 118,
      substitui: null,
      titulo: 'Decidi isso',
      fato: 'Decidi isso. E mais.',
      descartado: 'aquilo',
      objetivos: ['P0', 'P1', 'P2', 'P3'],
      provisoria: false,
      irreversivel: false,
    })
    expect(d?.porque).toContain('porque sim.')
    expect(d?.porque).not.toContain('Refs')
  })

  it('devolve null sem frontmatter, sem fechamento, sem data ou sem tipo', () => {
    expect(lerDecisao('x.md', '# Isca\n\nIsca.\n')).toBeNull()
    expect(lerDecisao('x.md', '---\ndata: 2026-11-10\ntipo: decisao\n# Isca\n')).toBeNull()
    expect(lerDecisao('x.md', arquivo('tipo: decisao', '# A\n'))).toBeNull()
    expect(lerDecisao('x.md', arquivo('data: 2026-11-10', '# A\n'))).toBeNull()
    expect(lerDecisao('x.md', arquivo('data: ontem\ntipo: decisao', '# A\n'))).toBeNull()
  })

  it('aceita \\r\\n', () => {
    const texto = arquivo(FM, '# A\n\nFato.\n\n**Por quê:** B\n').replace(/\n/g, '\r\n')

    expect(lerDecisao('x.md', texto)).toMatchObject({ titulo: 'A', fato: 'Fato.', porque: 'B' })
  })

  it('sem escopo, o escopo é vazio e o card é null', () => {
    expect(lerDecisao('x.md', arquivo('data: 2026-11-10\ntipo: decisao', '# A\n'))).toMatchObject({
      escopo: '',
      card: null,
    })
  })

  it('escopo de outro repo não preenche o card', () => {
    const d = lerDecisao(
      'x.md',
      arquivo('data: 2026-11-10\ntipo: decisao\nescopo: claude-brain#43', '# A\n'),
    )

    expect(d?.card).toBeNull()
  })

  it('substitui vazio vale como ausente', () => {
    expect(lerDecisao('x.md', arquivo(`${FM}\nsubstitui:`, '# A\n'))?.substitui).toBeNull()
  })

  it('substitui vem cru do frontmatter', () => {
    expect(lerDecisao('x.md', arquivo(`${FM}\nsubstitui: 1234`, '# A\n'))?.substitui).toBe('1234')
  })

  it('objetivo: P0, P2 vale os dois, e P0 e P1 também', () => {
    const porque = (t: string) => arquivo(FM, `# A\n\nF.\n\n**Por quê:** ${t}\n`)

    expect(lerDecisao('x.md', porque('objetivo: P0, P2'))?.objetivos).toEqual(['P0', 'P2'])
    expect(lerDecisao('x.md', porque('objetivo: P0 e P1 texto'))?.objetivos).toEqual(['P0', 'P1'])
    expect(lerDecisao('x.md', porque('objetivo: P2 e depois objetivo: p1'))?.objetivos).toEqual([
      'P1',
      'P2',
    ])
    expect(lerDecisao('x.md', porque('sem marca'))?.objetivos).toEqual([])
  })

  it('"Provisória: Sim" casa; "irreversível: não" não casa como "reversível: não"', () => {
    const porque = (t: string) => arquivo(FM, `# A\n\nF.\n\n**Por quê:** ${t}\n`)

    expect(lerDecisao('x.md', porque('Provisória: Sim'))?.provisoria).toBe(true)
    expect(lerDecisao('x.md', porque('reversível: não'))?.irreversivel).toBe(true)
    expect(lerDecisao('x.md', porque('irreversível: não'))?.irreversivel).toBe(false)
  })

  it('marca fora do porquê não casa', () => {
    const d = lerDecisao(
      'x.md',
      arquivo(FM, '# A\n\nprovisória: sim e objetivo: P1 e reversível: não\n\n**Por quê:** nada\n'),
    )

    expect(d).toMatchObject({ provisoria: false, irreversivel: false, objetivos: [] })
  })

  it('o título de duas linhas vira uma só e o fato fica inteiro', () => {
    const d = lerDecisao(
      'x.md',
      arquivo(FM, '# Achados tratados:\n- D3: x\n\nAchados tratados:\n- D3: x\n\n**Por quê:** y\n'),
    )

    expect(d?.titulo).toBe('Achados tratados: - D3: x')
    expect(d?.fato).toBe('Achados tratados:\n- D3: x')
  })

  it('sem bloco de título, o título é a primeira linha do fato', () => {
    expect(lerDecisao('x.md', arquivo(FM, '\nPrimeira.\nSegunda.\n'))?.titulo).toBe('Primeira.')
  })
})

describe('decisoesDoDia', () => {
  const arquivos = [
    { nome: 'b.md', texto: arquivo(FM, '# B\n') },
    { nome: 'a.md', texto: arquivo(FM, '# A\n') },
    { nome: 'outro-dia.md', texto: arquivo(FM.replace('10', '09'), '# C\n') },
    {
      nome: 'outro-repo.md',
      texto: arquivo(FM.replace('operations-center', 'claude-brain'), '# D\n'),
    },
    { nome: '2026-11-10-quebrado.md', texto: '# sem frontmatter\n' },
    { nome: '2026-11-09-quebrado.md', texto: '# sem frontmatter\n' },
    { nome: '2026-11-10-notas.txt', texto: 'nada' },
  ]

  it('filtra por dia e repo, ordena por nome e separa os ilegíveis do dia', () => {
    const { decisoes, ilegiveis } = decisoesDoDia(arquivos, '2026-11-10', REPO)

    expect(decisoes.map((d) => d.arquivo)).toEqual(['a.md', 'b.md'])
    expect(ilegiveis).toEqual(['2026-11-10-quebrado.md'])
  })
})

describe('lerObjetivos (spec-p1 §6)', () => {
  it('lê os quatro objetivos da direção', () => {
    const texto = readFileSync(join(FIXTURES, 'direcao.md'), 'utf8')

    expect(lerObjetivos(texto)).toEqual([
      { codigo: 'P0', nome: 'Fundação' },
      { codigo: 'P1', nome: 'Relatório do dia' },
      { codigo: 'P2', nome: 'Despachante sem janela' },
      { codigo: 'P3', nome: 'A fábrica se despacha' },
    ])
  })

  it('texto sem objetivo dá lista vazia', () => {
    expect(lerObjetivos('# nada\n')).toEqual([])
  })
})

/**
 * A tabela do §9: o que cada uma das 12 decisões sintéticas tem de dar (CA-1.3, a metade de leitura). O
 * número é o `card` do escopo; a frente (a raiz 118 das fases 119, 120 e 121) é da task 4.
 */
const TABELA: readonly [string, number | null, string, string][] = [
  ['2026-11-10-a-p2-operations-center-121-foi-promovida-em-10-11-2026-com-a.md', 121, 'rotina', ''],
  [
    '2026-11-10-g1-do-epico-operations-center-118-fabrica-agentica-decidido-.md',
    118,
    'chave',
    'portão G1',
  ],
  [
    '2026-11-10-g2-do-epico-operations-center-118-decidido-sob-mandato-em-10.md',
    118,
    'chave',
    'portão G2',
  ],
  [
    '2026-11-10-g3-da-p0-aprovado-modo-despachado-6-tasks-em-tasks-fase-0-em.md',
    119,
    'chave',
    'portão G3',
  ],
  [
    '2026-11-10-mandato-da-prova-da-fabrica-no-operations-center-leonardo-10.md',
    null,
    'chave',
    'sem card',
  ],
  [
    '2026-11-10-os-smokes-do-operations-center-escrevem-o-userdata-do-chromi.md',
    118,
    'chave',
    'descoberta',
  ],
  [
    '2026-11-10-p0-da-prova-da-fabrica-ambiente-do-operations-center-no-linu.md',
    null,
    'chave',
    'descoberta, sem card',
  ],
  [
    '2026-11-10-pendencia-para-o-leonardo-o-mandato-da-prova-mandato-txt-que.md',
    119,
    'estacionada',
    'pendência',
  ],
  ['2026-11-10-promocao-da-p1-operations-center-120-decidida-sob-mandato-em.md', 120, 'rotina', ''],
  [
    '2026-11-10-proposta-da-fabrica-de-software-agentica-evolucao-do-operati.md',
    null,
    'chave',
    'sem card',
  ],
  ['2026-11-10-recorte-da-p0-do-operations-center-118-corrigido-pela-medica.md', 118, 'rotina', ''],
  ['2026-11-10-triagem-da-fabrica-agentica-um-card-epico-so-118-com-pontos-.md', 118, 'rotina', ''],
]

describe('a fixture de 10/11/2026 (spec-p1 §9)', () => {
  const nomes = readdirSync(COFRE)
  const arquivos = nomes.map((nome) => ({ nome, texto: readFileSync(join(COFRE, nome), 'utf8') }))
  const { decisoes, ilegiveis } = decisoesDoDia(arquivos, '2026-11-10', REPO)

  it('tem 12 decisões e uma isca ilegível; as outras iscas ficam de fora', () => {
    expect(decisoes).toHaveLength(12)
    expect(decisoes.map((d) => d.arquivo).sort()).toEqual(TABELA.map(([nome]) => nome).sort())
    expect(ilegiveis).toEqual(['2026-11-10-isca-sem-frontmatter.md'])
  })

  it.each(TABELA)('%s', (nome, card, classe, motivo) => {
    const d = decisoes.find((x) => x.arquivo === nome)

    expect(d?.card).toBe(card)
    expect(classificar(d!)).toEqual({ classe, motivo })
  })

  it('a decisão do G1 traz título, fato, porquê, descartado e os quatro objetivos', () => {
    const g1 = decisoes.find((d) => d.arquivo.startsWith('2026-11-10-g1-'))

    expect(g1?.titulo).not.toBe('')
    expect(g1?.fato).not.toBe('')
    expect(g1?.porque).not.toBeNull()
    expect(g1?.descartado).not.toBeNull()
    expect(g1?.objetivos).toEqual(['P0', 'P1', 'P2', 'P3'])
  })
})
