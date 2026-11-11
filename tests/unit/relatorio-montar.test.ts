import { describe, expect, it } from 'vitest'

import { ESTEIRA_STATIONS } from '../../src/core/board/query'
import { emMarkdown } from '../../src/core/relatorio/markdown'
import { montarRelatorio } from '../../src/core/relatorio/montar'
import { janelaDoDia } from '../../src/core/relatorio/cofre'
import type {
  CardLido,
  Commit,
  Decisao,
  EntradaDoRelatorio,
  EventoDeStatus,
} from '../../src/core/relatorio/tipos'

const REPO = { owner: 'leonardo-amaral-3', name: 'operations-center' }
const JANELA = janelaDoDia('2026-11-10')
const GERADO = '2026-11-11T09:00:00Z'

function decisao(arquivo: string, extra: Partial<Decisao> = {}): Decisao {
  return {
    arquivo,
    data: '2026-11-10',
    tipo: 'decisao',
    escopo: 'operations-center#118',
    card: 118,
    substitui: null,
    titulo: `Título de ${arquivo}`,
    fato: `Título de ${arquivo}`,
    porque: null,
    descartado: null,
    objetivos: [],
    provisoria: false,
    irreversivel: false,
    ...extra,
  }
}

function commit(sha: string, extra: Partial<Commit> = {}): Commit {
  return { sha, em: '2026-11-10T12:00:00Z', assunto: `assunto ${sha}`, card: 118, ...extra }
}

function evento(em: string, de: string, para: string): EventoDeStatus {
  return { em, de, para }
}

function card(numero: number, eventos: EventoDeStatus[], pai: number | null = null): CardLido {
  return {
    numero,
    titulo: `Card ${numero}`,
    url: `https://github.com/leonardo-amaral-3/operations-center/issues/${numero}`,
    pai,
    eventos,
  }
}

function entrada(extra: Partial<EntradaDoRelatorio> = {}): EntradaDoRelatorio {
  return {
    janela: JANELA,
    repo: REPO,
    projeto: 2,
    pastaDoCofre: '/cofre',
    pastaDoRepo: '/repo',
    decisoes: [],
    ilegiveis: [],
    cards: new Map(),
    commits: [],
    objetivos: null,
    ...extra,
  }
}

const cards = (...lidos: CardLido[]): Map<number, CardLido> =>
  new Map(lidos.map((c) => [c.numero, c]))

const UMA_DE_CADA: Decisao[] = [
  decisao('a-chave.md', {
    tipo: 'descoberta',
    titulo: 'Achado',
    fato: 'Achado.\n\nSegundo parágrafo do fato.',
    porque: 'porque sim',
    descartado: 'nada',
  }),
  decisao('b-provisoria.md', { provisoria: true }),
  decisao('c-estacionada.md', { tipo: 'pendencia' }),
  decisao('d-desvio.md', { substitui: '12' }),
  decisao('e-rotina.md'),
]

describe('montarRelatorio e emMarkdown (spec-p1 §7)', () => {
  it('CA-1.1: uma decisão de cada classe, um commit e um evento dão as seções na ordem, com (n) e o texto inteiro', () => {
    const md = emMarkdown(
      montarRelatorio(
        entrada({
          decisoes: UMA_DE_CADA,
          commits: [commit('abcdef0123456789')],
          cards: cards(card(118, [evento('2026-11-10T10:00:00Z', '', '📥 Triagem')])),
        }),
      ),
      GERADO,
    )
    const ordem = [
      '# Relatório do dia 2026-11-10 · leonardo-amaral-3/operations-center',
      '## Contagem',
      '## [#118](',
      '### Frase do dia',
      '### Decisões-chave (1)',
      '### Provisórias (1)',
      '### Estacionadas (1)',
      '### Desvios (1)',
      '### Resto contado (2)',
    ]
    let ultimo = -1

    for (const trecho of ordem) {
      const i = md.indexOf(trecho)

      expect(i, trecho).toBeGreaterThan(ultimo)
      ultimo = i
    }
    expect(md).toContain(
      '- **Achado** — descoberta — fonte: cofre `a-chave.md`\n\n  Achado.\n\n  Segundo parágrafo do fato.\n\n  **Por quê:** porque sim\n\n  **Descartado:** nada\n',
    )
    expect(md).toContain('- 1 commit: abcdef0 assunto abcdef0')
    expect(md).toContain('Gerado em 2026-11-11T09:00:00Z.')
    expect(
      md.endsWith(
        'fonte: [abcdef0](https://github.com/leonardo-amaral-3/operations-center/commit/abcdef0123456789)\n',
      ),
    ).toBe(true)
  })

  it('CA-1.1: seção vazia sai com (0) e sem item', () => {
    const md = emMarkdown(
      montarRelatorio(entrada({ decisoes: [decisao('a.md', { tipo: 'descoberta' })] })),
      GERADO,
    )

    expect(md).toContain(
      '### Provisórias (0)\n\n### Estacionadas (0)\n\n### Desvios (0)\n\n### Resto contado (0)\n',
    )
  })

  it('CA-1.2: decisão sem arquivo e commit sem sha não aparecem, não contam e somam em semFonte', () => {
    const r = montarRelatorio(
      entrada({
        decisoes: [
          decisao(' ', { titulo: 'Sem arquivo' }),
          decisao('ok.md', { tipo: 'descoberta' }),
        ],
        commits: [commit('', { assunto: 'sem sha' }), commit('1234567890')],
      }),
    )
    const md = emMarkdown(r, GERADO)

    expect(r.semFonte).toBe(2)
    expect(md).not.toContain('Sem arquivo')
    expect(md).not.toContain('sem sha')
    expect(md).toContain('1 decisão do cofre com escopo operations-center em 2026-11-10')
    expect(md).toContain('1 commit nos refs locais e remotos, sem fetch')
  })

  it('CA-1.2: toda linha com `- ` termina a primeira linha com a fonte', () => {
    const md = emMarkdown(
      montarRelatorio(
        entrada({
          decisoes: UMA_DE_CADA,
          ilegiveis: ['quebrado.md'],
          commits: [commit('abcdef0123456789')],
          cards: cards(card(118, [evento('2026-11-10T10:00:00Z', '', '📥 Triagem')])),
        }),
      ),
      GERADO,
    )
    const itens = md.split('\n').filter((l) => l.startsWith('- '))

    expect(itens.length).toBeGreaterThan(8)
    for (const l of itens) expect(l, l).toContain(' — fonte: ')
  })

  it('a ordem das 8 estações da esteira é a que o desvio indexa', () => {
    expect([...ESTEIRA_STATIONS]).toEqual([
      'Triagem',
      'Backlog',
      'Especificação',
      'Implementação',
      'Revisão',
      'Validação em Dev',
      'Release',
      'Produção',
    ])
  })

  it('volta na esteira vira desvio; avanço e status fora da esteira não', () => {
    const r = montarRelatorio(
      entrada({
        cards: cards(
          card(7, [
            evento('2026-11-10T10:00:00Z', '🔨 Implementação', '👀 Revisão'),
            evento('2026-11-10T11:00:00Z', '👀 Revisão', '🔨 Implementação'),
            evento('2026-11-10T12:00:00Z', '🔨 Implementação', 'Cancelado'),
            evento('2026-11-10T13:00:00Z', 'Cancelado', '📥 Triagem'),
          ]),
        ),
      }),
    )
    const desvios = r.frentes[0]?.secoes.desvios ?? []

    expect(desvios.map((l) => l.texto)).toEqual([
      '#7 voltou de 👀 Revisão para 🔨 Implementação em 2026-11-10T11:00:00Z',
    ])
  })

  it('frente sem entrada no dia não aparece', () => {
    const r = montarRelatorio(
      entrada({
        cards: cards(card(9, [evento('2026-11-09T10:00:00Z', '', '📥 Triagem')])),
        decisoes: [decisao('a.md', { card: 5 })],
      }),
    )

    expect(r.frentes.map((f) => f.card)).toEqual([5])
  })

  it('frentes com card saem por volume e, no empate, por número; a sem card vem por último', () => {
    const r = montarRelatorio(
      entrada({
        decisoes: [
          decisao('a.md', { card: null }),
          decisao('b.md', { card: 30 }),
          decisao('c.md', { card: 20 }),
          decisao('d.md', { card: 10 }),
          decisao('e.md', { card: 10 }),
        ],
      }),
    )

    expect(r.frentes.map((f) => f.card)).toEqual([10, 20, 30, null])
  })

  it('card fora de `cards`: "não foi achado" e a frase cita a pasta do cofre', () => {
    const r = montarRelatorio(entrada({ decisoes: [decisao('a.md', { card: 77 })] }))
    const frase = r.frentes[0]?.secoes.frase[0]

    expect(r.frentes[0]?.titulo).toBe('#77')
    expect(frase?.texto).toBe('#77 não foi achado no GitHub. 1 decisão no cofre, 0 commits.')
    expect(frase?.fontes).toEqual([{ tipo: 'cofre', rotulo: '/cofre', url: null }])
  })

  it('a frente de uma sub-issue é a raiz, e a frase diz o movimento de cada card', () => {
    const r = montarRelatorio(
      entrada({
        cards: cards(
          card(1, [evento('2026-11-09T10:00:00Z', '', '📋 Backlog')]),
          card(
            2,
            [
              evento('2026-11-09T09:00:00Z', '', '📋 Backlog'),
              evento('2026-11-10T10:00:00Z', '📋 Backlog', '🎯 Especificação'),
            ],
            1,
          ),
        ),
      }),
    )

    expect(r.frentes).toHaveLength(1)
    expect(r.frentes[0]?.card).toBe(1)
    expect(r.frentes[0]?.secoes.frase[0]?.texto).toBe(
      '#1 segue em 📋 Backlog; #2 📋 Backlog → 🎯 Especificação. 0 decisões no cofre, 0 commits.',
    )
  })

  it('sem direção, os objetivos saem só pelo código', () => {
    const r = montarRelatorio(
      entrada({
        decisoes: [decisao('a.md', { objetivos: ['P0', 'P1'] })],
        cards: cards(card(118, [evento('2026-11-10T10:00:00Z', '', '📥 Triagem')])),
      }),
    )
    const frase = r.frentes[0]?.secoes.frase[0]

    expect(frase?.texto).toContain(' Objetivos: P0, P1.')
    expect(frase?.fontes.some((f) => f.tipo === 'direcao')).toBe(false)
  })

  it('um fato de dois parágrafos sai com a linha vazia de dentro vazia', () => {
    const md = emMarkdown(
      montarRelatorio(
        entrada({ decisoes: [decisao('a.md', { tipo: 'descoberta', fato: 'um\n\ndois' })] }),
      ),
      GERADO,
    )

    expect(md).toContain('\n\n  um\n\n  dois\n')
  })

  it('o markdown nunca tem duas linhas vazias seguidas nem linha só de espaços', () => {
    const md = emMarkdown(
      montarRelatorio(
        entrada({
          decisoes: [
            decisao('a.md', {
              tipo: 'descoberta',
              fato: 'um\n\n\n\n   \ndois',
              porque: 'x\n\n\ny',
            }),
            ...UMA_DE_CADA,
          ],
          ilegiveis: ['q.md'],
        }),
      ),
      GERADO,
    )

    expect(md).not.toMatch(/\n\n\n/)
    expect(md).not.toMatch(/^[ \t]+$/m)
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
  })

  it('semFonte soma decisão sem arquivo, commit sem sha e linha sem fonte', () => {
    const r = montarRelatorio(
      entrada({
        decisoes: [decisao('')],
        commits: [commit('')],
        ilegiveis: [''],
      }),
    )

    expect(r.semFonte).toBe(3)
    expect(r.ilegiveis).toEqual([])
  })
})
