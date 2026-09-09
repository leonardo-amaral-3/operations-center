import { describe, expect, it } from 'vitest'

import type { Board, BoardCard, BoardTab, BoardsSnapshot } from '../../src/shared/board'
import { activeTab, INITIAL_KANBAN, reduceKanban } from '../../src/renderer/screens/kanbanState'
import type { KanbanAction, KanbanState } from '../../src/renderer/screens/kanbanState'

/**
 * A parte pura do `KanbanScreen`: o retrato dos boards na tela e os cartões abertos de cada aba.
 *
 * O que se prova aqui é o que os smokes afirmam de fora — trocar de aba troca o kanban, a conversa
 * aberta não vaza de uma aba para a outra, e dentro da aba fica **um cartão aberto por coluna**
 * (#45) —, só que na regra e sem subir Electron.
 */

const AGORA = 1_700_000_000_000

const OPT_TRI = 'OPT_TRI'
const OPT_IMP = 'OPT_IMP'

/**
 * Onde cada cartão está no retrato de rotina: dois na 📥 Triagem, um na 🔨 Implementação.
 *
 * Duas colunas são o mínimo para separar "outro cartão da mesma coluna" de "outro cartão, outra
 * coluna" — que é a única distinção que esta regra faz.
 */
const POSICOES: Readonly<Record<string, string>> = {
  PVTI_A1: OPT_TRI,
  PVTI_A2: OPT_TRI,
  PVTI_A3: OPT_IMP,
}

/** O mínimo que o reducer lê de um cartão: o `itemId` e a coluna. O resto é do render. */
function card(itemId: string, columnId: string): BoardCard {
  return {
    itemId,
    number: 0,
    title: itemId,
    url: `https://example.invalid/${itemId}`,
    repository: 'leonardo-amaral-3/operations-center',
    closed: false,
    assignees: [],
    columnId,
    fields: [],
  }
}

function board(titulo: string, posicoes: Readonly<Record<string, string>> = POSICOES): Board {
  return {
    title: titulo,
    columns: [
      { id: OPT_TRI, name: '📥 Triagem', conversable: true, triage: true },
      { id: OPT_IMP, name: '🔨 Implementação', conversable: true, triage: false },
    ],
    cards: Object.entries(posicoes).map(([itemId, columnId]) => card(itemId, columnId)),
  }
}

/**
 * Uma aba. As duas nascem com os **mesmos ids** de cartão de propósito: é isso que prova que a
 * chave da aba isola de verdade, e não que os ids é que não se cruzam.
 */
function aba(
  key: string,
  title: string,
  posicoes: Readonly<Record<string, string>> = POSICOES,
): BoardTab {
  return { key, title, board: board(title, posicoes), readAt: AGORA, error: null }
}

/** Uma aba descoberta e ainda **não lida** — `board: null`, que não é "board vazio". */
function abaSemBoard(key: string, title: string): BoardTab {
  return { key, title, board: null, readAt: null, error: null }
}

const A = aba('leonardo-amaral-3/2', 'Operations Center')
const B = aba('ICSF-Solutions/7', 'Plataformas v2')

function retrato(activeKey: string | null, boards: readonly BoardTab[] = [A, B]): BoardsSnapshot {
  return { boards, activeKey, discoveryError: null }
}

function apply(...actions: KanbanAction[]): KanbanState {
  return actions.reduce<KanbanState>(reduceKanban, INITIAL_KANBAN)
}

describe('reduceKanban', () => {
  it('substitui o retrato inteiro, e a aba ativa sai do `activeKey`', () => {
    const state = apply({ type: 'snapshot', snapshot: retrato(B.key) })

    expect(state.snapshot.boards).toHaveLength(2)
    // A tela não escolhe aba: `activeTab` segue o `activeKey` que o main mandou, e é isso que faz
    // trocar de aba trocar o kanban inteiro.
    expect(activeTab(state.snapshot)).toBe(B)

    const trocada = reduceKanban(state, { type: 'snapshot', snapshot: retrato(A.key) })
    expect(activeTab(trocada.snapshot)).toBe(A)
  })

  it('sem `activeKey` — ou com uma chave que não está na lista — não há aba ativa', () => {
    expect(activeTab(retrato(null))).toBeNull()
    expect(activeTab(retrato('dono/404'))).toBeNull()
    // Antes da descoberta não há lista onde procurar, e o `null` do `boards` é o que separa isso de
    // "descobri e não achei nada".
    expect(activeTab(INITIAL_KANBAN.snapshot)).toBeNull()
  })

  it('colunas diferentes ficam as duas abertas, na ordem de abertura (RA-1)', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A3' },
    )

    // A regra do #45 numa asserção: um cartão por **coluna**, não por aba. Com um id só, a segunda
    // linha apagaria a primeira e as duas conversas nunca conviveriam.
    expect(state.expanded).toEqual({ [A.key]: ['PVTI_A1', 'PVTI_A3'] })
  })

  it('os cartões abertos são por aba: abrir na B não mexe na lista da A (RA-3)', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A3' },
      // O **mesmo** id da A, e ele não pode encostar na lista dela: as duas abas têm cartões de
      // mesmo `itemId` justamente para isso não passar por acaso.
      { type: 'toggle', key: B.key, itemId: 'PVTI_A1' },
    )

    expect(state.expanded).toEqual({
      [A.key]: ['PVTI_A1', 'PVTI_A3'],
      [B.key]: ['PVTI_A1'],
    })
  })

  it('na mesma coluna o segundo fecha o primeiro, e a outra coluna não sente (RA-2)', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A3' },
      // `PVTI_A2` mora na 📥 Triagem, como o `PVTI_A1`.
      { type: 'toggle', key: A.key, itemId: 'PVTI_A2' },
    )

    // O da 🔨 Implementação ficou onde estava; quem saiu foi só o vizinho de coluna.
    expect(state.expanded).toEqual({ [A.key]: ['PVTI_A3', 'PVTI_A2'] })
  })

  it('com dois abertos na mesma coluna, o clique seguinte fecha **os dois** (RA-2)', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A3' },
      // A esteira andou e o `PVTI_A3` caiu na 📥 Triagem: agora há dois abertos na mesma coluna, o
      // estado que só a releitura sabe produzir (RA-4).
      {
        type: 'snapshot',
        snapshot: retrato(A.key, [
          aba(A.key, 'Operations Center', { ...POSICOES, PVTI_A3: OPT_TRI }),
          B,
        ]),
      },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A2' },
    )

    expect(state.expanded).toEqual({ [A.key]: ['PVTI_A2'] })
  })

  it('clicar no cartão aberto fecha só ele, e o último remove a chave da aba', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A3' },
      { type: 'toggle', key: B.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
    )

    // Fechar um não arrasta o vizinho de outra coluna junto.
    expect(state.expanded).toEqual({ [A.key]: ['PVTI_A3'], [B.key]: ['PVTI_A1'] })

    const vazia = reduceKanban(state, { type: 'toggle', key: A.key, itemId: 'PVTI_A3' })

    // Ausente, e não lista vazia: "nenhum aberto naquela aba" é a chave não estar lá.
    expect(vazia.expanded).toEqual({ [B.key]: ['PVTI_A1'] })
    expect(A.key in vazia.expanded).toBe(false)
  })

  it('cartão fora do retrato abre e não fecha ninguém — coluna irresolvível não é regra', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      // Nenhuma coluna a resolver. Apagar por precaução seria adivinhar em cima de não saber.
      { type: 'toggle', key: A.key, itemId: 'PVTI_FANTASMA' },
    )

    expect(state.expanded).toEqual({ [A.key]: ['PVTI_A1', 'PVTI_FANTASMA'] })
  })

  it('a releitura não fecha cartão que mudou de coluna, mesmo caindo numa já ocupada (RA-4)', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A3' },
      // A cada foco da janela o board é relido. Aqui o `PVTI_A3` chega na coluna que o `PVTI_A1` já
      // ocupava: fechar um deles seria fechar a conversa no exato evento que o app existe para
      // acompanhar.
      {
        type: 'snapshot',
        snapshot: retrato(A.key, [
          aba(A.key, 'Operations Center', { ...POSICOES, PVTI_A3: OPT_TRI }),
          B,
        ]),
      },
    )

    expect(state.expanded).toEqual({ [A.key]: ['PVTI_A1', 'PVTI_A3'] })
    expect(state.snapshot.boards?.[0]?.board?.title).toBe('Operations Center')
  })

  it('a releitura poda o cartão que sumiu do board — e só ele', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A3' },
      // Tirado do Project, ou sem `Status`: ele não está mais no retrato daquela aba.
      {
        type: 'snapshot',
        snapshot: retrato(A.key, [
          aba(A.key, 'Operations Center', { PVTI_A2: OPT_TRI, PVTI_A3: OPT_IMP }),
          B,
        ]),
      },
    )

    // Sem a poda o id ficaria preso para sempre — nenhum clique futuro o filtraria, e ele
    // renasceria expandido se o cartão voltasse ao board.
    expect(state.expanded).toEqual({ [A.key]: ['PVTI_A3'] })
  })

  it('a poda esvaziou a aba: a chave sai, não fica lista vazia', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'snapshot', snapshot: retrato(A.key, [aba(A.key, 'Operations Center', {}), B]) },
    )

    expect(state.expanded).toEqual({})
    expect(A.key in state.expanded).toBe(false)
  })

  it('aba sem board lido mantém a lista intacta — "sumiu" e "ainda não sei" são diferentes', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      // `board: null` é o retrato de quem ainda vai carregar. Podar aqui fecharia tudo no meio da
      // primeira leitura, que é exatamente quando não dá para distinguir as duas coisas.
      { type: 'snapshot', snapshot: retrato(A.key, [abaSemBoard(A.key, 'Operations Center'), B]) },
    )

    expect(state.expanded).toEqual({ [A.key]: ['PVTI_A1'] })
  })

  it('nada a podar devolve a **mesma referência** de `expanded`', () => {
    const antes = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A3' },
    )
    const depois = reduceKanban(antes, { type: 'snapshot', snapshot: retrato(A.key) })

    // O retrato de rotina chega a cada foco da janela. Um objeto novo a cada um deles redesenharia
    // toda `Column` sem nada ter mudado.
    expect(depois.expanded).toBe(antes.expanded)
  })
})
