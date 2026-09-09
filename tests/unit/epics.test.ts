import { describe, expect, it } from 'vitest'

import { SEM_FASES, linkPhases } from '../../src/core/board/epics'
import type { BoardCard, BoardColumn } from '../../src/core/board/types'
import { STATUS_OPTIONS } from '../fakes/fakeGraphQL'

/**
 * A inversão sozinha, sem envelope, sem leitor e sem tela.
 *
 * Ela recebe `BoardCard`s já traduzidos, então o teste os constrói à mão — é o mesmo tratamento que
 * `stations.test.ts` dá à régua de estação: a regra de produto é exercitada pelo seu próprio
 * vocabulário, e não pela forma crua da API, que já tem quem a cubra em `BoardReader.test.ts`.
 *
 * Duas coisas aqui são asserção de decisão, e não de comportamento visível: a **ordem** por número
 * crescente (decisão 7, provada aqui porque na tela ela chega pronta na prop) e o **retorno por
 * referência** de quem não tem fase (decisão 12).
 */

const REPO = 'leonardo-amaral-3/operations-center'
/** O segundo repo que o board hospeda de verdade — está na fixture desde a captura de 2026-09-05. */
const FORASTEIRO = 'leonardo-amaral-3/repo-forasteiro'

/** As colunas do mesmo retrato: é delas que sai o `columnName` de cada fase. */
const COLUNAS: readonly BoardColumn[] = STATUS_OPTIONS.map((option) => ({ ...option }))

const ESPECIFICACAO = STATUS_OPTIONS[2]
const IMPLEMENTACAO = STATUS_OPTIONS[3]
const REVISAO = STATUS_OPTIONS[4]

interface CartaoInput {
  number: number
  columnId?: string
  repository?: string
  /** O pai. `repository` omitido cai no repo do próprio cartão, que é o caso normal. */
  parent?: { number: number; title?: string; repository?: string }
}

function cartao(input: CartaoInput): BoardCard {
  const { number, columnId = IMPLEMENTACAO.id, repository = REPO, parent } = input

  return {
    itemId: `PVTI_${repository}_${number}`,
    number,
    title: `Card ${number}`,
    url: `https://github.com/${repository}/issues/${number}`,
    repository,
    closed: false,
    assignees: [],
    columnId,
    fields: [],
    parent: parent
      ? {
          number: parent.number,
          title: parent.title ?? `Épico ${parent.number}`,
          repository: parent.repository ?? repository,
        }
      : null,
    phases: SEM_FASES,
  }
}

/**
 * Acha o cartão no **retorno**, e não na entrada: quem tem fase vira objeto novo, e conferir a
 * entrada provaria o oposto do que se quer.
 */
function achar(cards: readonly BoardCard[], number: number, repository = REPO): BoardCard {
  const card = cards.find((c) => c.number === number && c.repository === repository)
  if (!card) throw new Error(`o retorno não tem o cartão #${number} de ${repository}`)

  return card
}

describe('linkPhases — o épico recebe as fases que estão neste board', () => {
  it('agrupa as fases sob o épico, cada uma com a estação em que está', () => {
    const epico = cartao({ number: 904, columnId: ESPECIFICACAO.id })
    const primeira = cartao({ number: 905, columnId: IMPLEMENTACAO.id, parent: { number: 904 } })
    const segunda = cartao({ number: 906, columnId: REVISAO.id, parent: { number: 904 } })

    const linked = linkPhases([epico, primeira, segunda], COLUNAS)

    expect(achar(linked, 904).phases).toEqual([
      {
        itemId: primeira.itemId,
        number: 905,
        title: 'Card 905',
        columnId: IMPLEMENTACAO.id,
        columnName: IMPLEMENTACAO.name,
      },
      {
        itemId: segunda.itemId,
        number: 906,
        title: 'Card 906',
        columnId: REVISAO.id,
        columnName: REVISAO.name,
      },
    ])
  })

  it('ordena por número crescente, com o board devolvendo as fases fora de ordem', () => {
    // O `#9` no meio não é enfeite: ele separa a comparação numérica da lexicográfica, em que `'9'`
    // vem **depois** de `'905'`. Um `.sort()` sem comparador passaria nos outros casos e falharia
    // aqui — e no board de verdade, onde épico com fase de um dígito é o normal.
    const cards = [
      cartao({ number: 906, parent: { number: 904 } }),
      cartao({ number: 904 }),
      cartao({ number: 905, parent: { number: 904 } }),
      cartao({ number: 9, parent: { number: 904 } }),
    ]

    const fases = achar(linkPhases(cards, COLUNAS), 904).phases

    expect(fases.map((fase) => fase.number)).toEqual([9, 905, 906])
  })

  it('deixa `columnName` vazio quando o board não declara a opção, sem matar o vínculo', () => {
    const desconhecida = 'opt-que-este-board-nao-declara'
    const epico = cartao({ number: 904 })
    const fase = cartao({ number: 905, columnId: desconhecida, parent: { number: 904 } })

    const fases = achar(linkPhases([epico, fase], COLUNAS), 904).phases

    // A fase continua na lista, e o `columnId` continua sendo a verdade: só o rótulo falta.
    expect(fases).toEqual([
      {
        itemId: fase.itemId,
        number: 905,
        title: 'Card 905',
        columnId: desconhecida,
        columnName: '',
      },
    ])
  })

  it('não mistura o `#31` de dois repos diferentes — a chave é `repo#número`, dos dois lados', () => {
    const cards = [
      cartao({ number: 31, repository: REPO }),
      cartao({ number: 31, repository: FORASTEIRO }),
      cartao({ number: 50, repository: REPO, parent: { number: 31, repository: REPO } }),
      cartao({ number: 60, repository: FORASTEIRO, parent: { number: 31, repository: FORASTEIRO } }),
      // Fase **de fora** do repo do épico: o lado do pai é que governa o cruzamento, não o lado da
      // fase. Cruzar só por número penduraria as três sob o mesmo épico, e o kanban continuaria
      // parecendo correto.
      cartao({ number: 70, repository: FORASTEIRO, parent: { number: 31, repository: REPO } }),
    ]

    const linked = linkPhases(cards, COLUNAS)

    expect(achar(linked, 31, REPO).phases.map((fase) => fase.number)).toEqual([50, 70])
    expect(achar(linked, 31, FORASTEIRO).phases.map((fase) => fase.number)).toEqual([60])
  })

  it('deixa um cartão ser fase e épico ao mesmo tempo, sem recursão', () => {
    const cards = [
      cartao({ number: 25 }),
      cartao({ number: 31, parent: { number: 25 } }),
      cartao({ number: 33, parent: { number: 31 } }),
    ]

    const linked = linkPhases(cards, COLUNAS)
    const meio = achar(linked, 31)

    expect(meio.parent?.number).toBe(25)
    expect(meio.phases.map((fase) => fase.number)).toEqual([33])
    // Sem recursão: o de cima lista a filha direta, e a neta não sobe.
    expect(achar(linked, 25).phases.map((fase) => fase.number)).toEqual([31])
  })

  it('devolve pelo mesmo objeto quem não tem fase — `toBe`, e não `toEqual`', () => {
    const comum = cartao({ number: 700 })
    const epico = cartao({ number: 904 })
    const fase = cartao({ number: 905, parent: { number: 904 } })

    const linked = linkPhases([comum, epico, fase], COLUNAS)

    // A economia da decisão 12, em três asserções: quem não tem filha atravessa intacto (inclusive a
    // própria fase, que também não tem), só o épico é reconstruído, e o que entrou não é alterado.
    expect(linked[0]).toBe(comum)
    expect(linked[2]).toBe(fase)
    expect(linked[1]).not.toBe(epico)
    expect(epico.phases).toBe(SEM_FASES)
  })
})
