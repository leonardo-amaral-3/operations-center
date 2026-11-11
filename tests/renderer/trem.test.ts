import { describe, expect, it } from 'vitest'

import type { BoardCard, CardContent } from '../../src/shared/board'
import type { Board } from '../../src/shared/board'
import {
  cardsDoTrem,
  itensDaSecao,
  linhasDasNotas,
  linhasDaVerificacao,
  repoDoTrem,
  specDoConteudo,
  textoDasNotas,
  tipoDoCard,
  verificacaoDoConteudo,
} from '../../src/renderer/fabrica/trem'

const COLUNAS = [
  { id: 'c-bac', name: '📋 Backlog' },
  { id: 'c-rel', name: '🚂 Release' },
]

function card(n: number, columnId: string, parcial: Partial<BoardCard> = {}): BoardCard {
  return {
    itemId: `PVTI_${n}`,
    number: n,
    title: `Card ${n}`,
    url: `https://github.com/o/r/issues/${n}`,
    repository: 'leonardo-amaral-3/operations-center',
    closed: false,
    assignees: [],
    columnId,
    fields: [],
    parent: null,
    phases: [],
    ...parcial,
  }
}

function conteudo(parcial: Partial<CardContent>): CardContent {
  return { number: 1, body: '', comments: [], truncated: false, ...parcial } as CardContent
}

const comentario = (kind: string | null, body: string) => ({
  id: 'x',
  author: null,
  createdAt: '2026-11-11T00:00:00Z',
  body,
  kind,
})

describe('cardsDoTrem', () => {
  it('só a coluna Release, na ordem, aberto ou fechado', () => {
    const board = {
      title: 't',
      columns: COLUNAS,
      cards: [card(1, 'c-rel'), card(2, 'c-bac'), card(3, 'c-rel', { closed: true })],
    } as unknown as Board
    expect(cardsDoTrem(board).map((c) => c.number)).toEqual([1, 3])
  })
})

describe('tipoDoCard', () => {
  it('rótulo sem emoji e classe do fieldLook', () => {
    const c = card(1, 'c-rel', {
      fields: [{ name: 'Tipo', value: '✨ Melhoria', optionId: 'o' }],
    })
    expect(tipoDoCard(c)).toEqual({ rotulo: 'Melhoria', classe: 'bg-tipo-melhoria' })
  })
  it('null sem Tipo', () => {
    expect(tipoDoCard(card(1, 'c-rel'))).toBeNull()
  })
})

describe('repoDoTrem e notas', () => {
  it('nomes curtos distintos, na ordem; vazio → operations-center', () => {
    expect(
      repoDoTrem([
        card(1, 'x', { repository: 'a/um' }),
        card(2, 'x', { repository: 'b/dois' }),
        card(3, 'x', { repository: 'c/um' }),
      ]),
    ).toBe('um, dois')
    expect(repoDoTrem([])).toBe('operations-center')
  })
  it('linhas e texto das notas', () => {
    const cs = [card(1, 'x'), card(2, 'x')]
    expect(linhasDasNotas(cs)).toEqual(['#1 Card 1', '#2 Card 2'])
    expect(textoDasNotas(cs)).toBe('O que muda para você\n#1 Card 1\n#2 Card 2')
    expect(textoDasNotas([])).toBe('O que muda para você')
  })
})

describe('itensDaSecao', () => {
  const T = '## Verificação pós-deploy'
  it('itens numerados, com - e com continuação de linha', () => {
    expect(
      itensDaSecao(`${T}\n1. abrir o app\n2) ver a tela\n   inteira\n- outro\n* mais um`),
    ).toEqual(['abrir o app', 'ver a tela inteira', 'outro', 'mais um'])
  })
  it('só parágrafo vira um item; o texto antes do primeiro item é ignorado', () => {
    expect(itensDaSecao(`${T}\nrode o smoke\ne confira\n`)).toEqual(['rode o smoke e confira'])
    expect(itensDaSecao(`${T}\nIntro\n\n1. um\n2. dois`)).toEqual(['um', 'dois'])
  })
  it('seção vazia é [] e sem seção é null', () => {
    expect(itensDaSecao(`${T}\n\n## Outra\nx`)).toEqual([])
    expect(itensDaSecao('## Outra\n1. x')).toBeNull()
    expect(itensDaSecao(`${T} extra\n1. x`)).toBeNull()
  })
  it('termina no ## seguinte, e # também corta', () => {
    expect(itensDaSecao(`${T}\n1. a\n## Depois\n2. b`)).toEqual(['a'])
    expect(itensDaSecao(`${T}\n1. a\n# Título\n2. b`)).toEqual(['a'])
  })
  it('bloco de código não corta a seção nem começa item', () => {
    const corpo = `${T}\n1. rode\n\`\`\`\n## nao corta\n- nao e item\n\`\`\`\n2. fim`
    expect(itensDaSecao(corpo)).toEqual(['rode ``` ## nao corta - nao e item ```', 'fim'])
  })
  it('o texto do #113: dois itens numerados', () => {
    const corpo = [
      '## Resumo',
      'x',
      '',
      '## Verificação pós-deploy',
      '',
      '1. Abrir o app e conferir que a coluna Release lista os cards.',
      '2. Confirmar que o comentário gm:spec aparece na aba do card.',
      '',
      '## Rollback',
      'reverter',
    ].join('\n')
    expect(itensDaSecao(corpo)).toEqual([
      'Abrir o app e conferir que a coluna Release lista os cards.',
      'Confirmar que o comentário gm:spec aparece na aba do card.',
    ])
  })
})

describe('verificacaoDoConteudo', () => {
  it('gm:spec com itens', () => {
    const c = conteudo({ comments: [comentario('spec', '## Verificação pós-deploy\n1. a')] })
    expect(verificacaoDoConteudo(c)).toEqual({ kind: 'itens', itens: ['a'] })
  })
  it('gm:spec sem a seção ou com ela vazia é vazia', () => {
    expect(verificacaoDoConteudo(conteudo({ comments: [comentario('spec', 'x')] }))).toEqual({
      kind: 'vazia',
    })
    expect(
      verificacaoDoConteudo(
        conteudo({ comments: [comentario('spec', '## Verificação pós-deploy\n')] }),
      ),
    ).toEqual({ kind: 'vazia' })
  })
  it('spec dividida em gm:spec + gm:spec-2: a seção só na parte 2 é achada (G4 da PR #141, bloqueante 1)', () => {
    // O formato do #133: spec-ref, a parte 1 sem a seção, a parte 2 com ela.
    const c = conteudo({
      comments: [
        comentario('spec-ref', '<!-- gm:spec-ref -->\n## F4 promovida'),
        comentario(
          'spec',
          '<!-- gm:spec -->\n> Parte 1 de 2. A parte 2 é o comentário `gm:spec-2` logo abaixo.\n\n## Implementation Details\nx',
        ),
        comentario(
          'spec-2',
          '<!-- gm:spec-2 -->\n> Parte 2 de 2 (continua o comentário `gm:spec`).\n\n## Verificação pós-deploy\n**Obrigatória.**\n1. abrir o app\n2. conferir a fila\n\n## Plano de testes\nN/A',
        ),
      ],
    })
    expect(verificacaoDoConteudo(c)).toEqual({
      kind: 'itens',
      itens: ['abrir o app', 'conferir a fila'],
    })
  })
  it('as partes vão na ordem do número, não na dos comentários; a seção pode atravessar o corte', () => {
    const c = conteudo({
      comments: [
        comentario('spec-3', '<!-- gm:spec-3 -->\n3. terceiro\n\n## Emendas\n(nenhuma)'),
        comentario('spec', '<!-- gm:spec -->\n## Verificação pós-deploy\n1. primeiro'),
        comentario('spec-2', '<!-- gm:spec-2 -->\n2. segundo'),
        comentario('spec-2', '<!-- gm:spec-2 -->\n9. repetido, ignorado'),
      ],
    })
    expect(verificacaoDoConteudo(c)).toEqual({
      kind: 'itens',
      itens: ['primeiro', 'segundo', 'terceiro'],
    })
  })
  it('spec dividida sem a seção em parte nenhuma continua vazia; spec-ref não é parte', () => {
    const c = conteudo({
      comments: [comentario('spec', '<!-- gm:spec -->\nx'), comentario('spec-2', 'y')],
    })
    expect(verificacaoDoConteudo(c)).toEqual({ kind: 'vazia' })
    expect(specDoConteudo(conteudo({ comments: [comentario('spec-ref', 'x')] }))).toBeNull()
  })
  it('spec-ref é ref; o spec vence o spec-ref', () => {
    expect(verificacaoDoConteudo(conteudo({ comments: [comentario('spec-ref', 'x')] }))).toEqual({
      kind: 'ref',
    })
    const ambos = conteudo({
      comments: [comentario('spec-ref', 'x'), comentario('spec', '## Verificação pós-deploy\n- a')],
    })
    expect(verificacaoDoConteudo(ambos).kind).toBe('itens')
  })
  it('nenhum dos dois: sem-spec, com o truncated', () => {
    expect(verificacaoDoConteudo(conteudo({ comments: [comentario(null, 'x')] }))).toEqual({
      kind: 'sem-spec',
      truncado: false,
    })
    expect(verificacaoDoConteudo(conteudo({ truncated: true }))).toEqual({
      kind: 'sem-spec',
      truncado: true,
    })
  })
})

describe('linhasDaVerificacao', () => {
  const c = card(942, 'c-rel')
  const lido = (comments: ReturnType<typeof comentario>[], truncated = false) => ({
    ok: true as const,
    content: conteudo({ comments, truncated }),
  })

  it('lendo e falha, não marcáveis', () => {
    expect(linhasDaVerificacao(c, undefined)).toEqual([
      {
        chave: 'PVTI_942:0',
        texto: '#942: lendo a spec…',
        completo: '#942: lendo a spec…',
        marcavel: false,
      },
    ])
    const f = linhasDaVerificacao(c, { ok: false, reason: 'sem rede' })
    expect(f[0]).toMatchObject({
      texto: '#942: não deu para ler o card: sem rede',
      marcavel: false,
    })
  })
  it('itens, marcáveis, com chave por índice', () => {
    const l = linhasDaVerificacao(
      c,
      lido([comentario('spec', '## Verificação pós-deploy\n1. a\n2. b')]),
    )
    expect(l.map((x) => [x.chave, x.texto, x.marcavel])).toEqual([
      ['PVTI_942:0', '#942: a', true],
      ['PVTI_942:1', '#942: b', true],
    ])
  })
  it('vazia, ref (com e sem parent) e sem-spec (com truncado)', () => {
    expect(linhasDaVerificacao(c, lido([comentario('spec', 'x')]))[0]?.texto).toBe(
      '#942: a spec não tem a seção Verificação pós-deploy',
    )
    const ref = [comentario('spec-ref', 'x')]
    expect(linhasDaVerificacao(c, lido(ref))[0]?.texto).toBe(
      '#942: a verificação está na spec citada no gm:spec-ref',
    )
    const filho = card(943, 'c-rel', { parent: { number: 905 } as BoardCard['parent'] })
    expect(linhasDaVerificacao(filho, lido(ref))[0]?.texto).toBe(
      '#943: a verificação está na spec do épico #905',
    )
    expect(linhasDaVerificacao(c, lido([]))[0]?.texto).toBe(
      '#942: o card não tem comentário gm:spec',
    )
    expect(linhasDaVerificacao(c, lido([], true))[0]?.texto).toBe(
      '#942: o card não tem comentário gm:spec nos primeiros 100 comentários',
    )
  })
  it('corta em 160 caracteres e guarda o completo', () => {
    const longo = 'x'.repeat(300)
    const l = linhasDaVerificacao(
      c,
      lido([comentario('spec', `## Verificação pós-deploy\n1. ${longo}`)]),
    )[0]
    expect(l?.texto).toHaveLength(160)
    expect(l?.texto.endsWith('…')).toBe(true)
    expect(l?.completo).toBe(`#942: ${longo}`)
  })
})
