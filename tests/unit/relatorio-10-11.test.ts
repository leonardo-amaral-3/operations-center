import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { classificar } from '../../src/core/relatorio/classificar'
import { decisoesDoDia, janelaDoDia } from '../../src/core/relatorio/cofre'
import { lerObjetivos } from '../../src/core/relatorio/direcao'
import { lerCards, lerNumerosMovidos } from '../../src/core/relatorio/board'
import { emMarkdown } from '../../src/core/relatorio/markdown'
import { montarRelatorio } from '../../src/core/relatorio/montar'
import { graphqlDe10de11 } from '../fixtures/relatorio/board-2026-11-10'

const REPO = { owner: 'leonardo-amaral-3', name: 'operations-center' }
const FIXTURES = fileURLToPath(new URL('../fixtures/relatorio/', import.meta.url))
const COFRE = join(FIXTURES, 'cofre-2026-11-10')
const DIA = '2026-11-10'

/** A tabela do §9: arquivo → classe e motivo. */
const ESPERADO: readonly (readonly [string, string, string])[] = [
  ['2026-11-10-a-p2-operations-center-121-foi-promovida-em-10-11-2026-com-a.md', 'rotina', ''],
  [
    '2026-11-10-g1-do-epico-operations-center-118-fabrica-agentica-decidido-.md',
    'chave',
    'portão G1',
  ],
  [
    '2026-11-10-g2-do-epico-operations-center-118-decidido-sob-mandato-em-10.md',
    'chave',
    'portão G2',
  ],
  [
    '2026-11-10-g3-da-p0-aprovado-modo-despachado-6-tasks-em-tasks-fase-0-em.md',
    'chave',
    'portão G3',
  ],
  [
    '2026-11-10-mandato-da-prova-da-fabrica-no-operations-center-leonardo-10.md',
    'chave',
    'sem card',
  ],
  [
    '2026-11-10-os-smokes-do-operations-center-escrevem-o-userdata-do-chromi.md',
    'chave',
    'descoberta',
  ],
  [
    '2026-11-10-p0-da-prova-da-fabrica-ambiente-do-operations-center-no-linu.md',
    'chave',
    'descoberta, sem card',
  ],
  [
    '2026-11-10-pendencia-para-o-leonardo-o-mandato-da-prova-mandato-txt-que.md',
    'estacionada',
    'pendência',
  ],
  ['2026-11-10-promocao-da-p1-operations-center-120-decidida-sob-mandato-em.md', 'rotina', ''],
  [
    '2026-11-10-proposta-da-fabrica-de-software-agentica-evolucao-do-operati.md',
    'chave',
    'sem card',
  ],
  ['2026-11-10-recorte-da-p0-do-operations-center-118-corrigido-pela-medica.md', 'rotina', ''],
  ['2026-11-10-triagem-da-fabrica-agentica-um-card-epico-so-118-com-pontos-.md', 'rotina', ''],
]

async function montar() {
  const arquivos = readdirSync(COFRE).map((nome) => ({
    nome,
    texto: readFileSync(join(COFRE, nome), 'utf8'),
  }))
  const { decisoes, ilegiveis } = decisoesDoDia(arquivos, DIA, REPO)
  const janela = janelaDoDia(DIA)
  const movidos = await lerNumerosMovidos(graphqlDe10de11, {
    owner: REPO.owner,
    repo: `${REPO.owner}/${REPO.name}`,
    projeto: 2,
    inicio: janela.inicio,
  })
  const numeros = [
    ...new Set([...movidos, ...decisoes.flatMap((d) => (d.card === null ? [] : [d.card]))]),
  ]
  const cards = await lerCards(graphqlDe10de11, {
    owner: REPO.owner,
    name: REPO.name,
    projeto: 2,
    numeros,
  })
  const objetivos = lerObjetivos(readFileSync(join(FIXTURES, 'direcao.md'), 'utf8'))
  const relatorio = montarRelatorio({
    janela,
    repo: REPO,
    projeto: 2,
    pastaDoCofre: '~/notoria/claude/decisoes',
    pastaDoRepo: '~/pessoal/operations-center',
    decisoes,
    ilegiveis,
    cards,
    commits: [],
    objetivos,
  })

  return { decisoes, relatorio, markdown: emMarkdown(relatorio, '2026-11-11T09:00:00Z') }
}

describe('relatório de 10/11/2026 sobre a fixture (CA-1.3)', () => {
  it('cada um dos 12 arquivos aparece exatamente uma vez como fonte; iscas ficam de fora', async () => {
    const { markdown } = await montar()

    for (const [nome] of ESPERADO) {
      const ocorrencias = markdown.split(`cofre \`${nome}\``).length - 1

      expect(ocorrencias, nome).toBe(1)
    }
    expect(markdown).not.toContain('isca-outro-repo')
    expect(markdown).not.toContain('isca-prefixo')
    expect(markdown).not.toContain('isca-outro-dia')

    const ilegiveis = markdown.slice(
      markdown.indexOf('## Arquivos do cofre que não deram para ler'),
    )

    expect(ilegiveis).toContain('cofre `2026-11-10-isca-sem-frontmatter.md`')
    expect(markdown.split('isca-sem-frontmatter').length - 1).toBe(1)
    expect(markdown).toContain(
      '12 decisões do cofre com escopo operations-center em 2026-11-10: chave 7, provisórias 0, estacionadas 1, desvios 0, rotina 4',
    )
    expect(markdown).toContain('5 mudanças de Status no board')
  })

  it('a classe e o motivo de cada um dos 12 batem com a tabela do §9', async () => {
    const { decisoes } = await montar()

    expect(decisoes).toHaveLength(12)
    for (const [nome, classe, motivo] of ESPERADO) {
      const d = decisoes.find((x) => x.arquivo === nome)

      expect(d, nome).toBeDefined()
      expect(classificar(d as NonNullable<typeof d>), nome).toEqual({ classe, motivo })
    }
  })

  it('as frases das duas frentes são as do §9, letra por letra, e a ordem é 118 e depois sem card', async () => {
    const { relatorio } = await montar()

    expect(relatorio.frentes.map((f) => f.card)).toEqual([118, null])
    expect(relatorio.frentes[0]?.secoes.frase[0]?.texto).toBe(
      '#118 fora do board → 📋 Backlog (2 mudanças); #119 fora do board → 🎯 Especificação; #120 fora do board → 🎯 Especificação; #121 fora do board → 🎯 Especificação. 9 decisões no cofre, 0 commits. Objetivos: P0 · Fundação, P1 · Relatório do dia, P2 · Despachante sem janela, P3 · A fábrica se despacha.',
    )
    expect(relatorio.frentes[1]?.secoes.frase[0]?.texto).toBe(
      '3 decisões no cofre e 0 commits sem card.',
    )
    expect(relatorio.frentes[1]?.titulo).toBe('operations-center, sem card')
    expect(relatorio.semFonte).toBe(0)
  })

  it('CA-1.2: toda linha com `- ` do relatório de 10/11 termina a primeira linha com a fonte', async () => {
    const { markdown } = await montar()
    const itens = markdown.split('\n').filter((l) => l.startsWith('- '))

    expect(itens.length).toBeGreaterThan(12)
    for (const l of itens) expect(l, l).toContain(' — fonte: ')
  })
})
