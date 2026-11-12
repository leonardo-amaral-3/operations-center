import type { BoardCard, BoardsSnapshot, CardContent } from '../../src/shared/board'
import type { CardNaFabrica, DespachoDoCard } from '../../src/shared/fabrica'

/**
 * O "esperado F4" de `spec-f4.md` §F4.10, escrito à mão: o que `readFabricaCard` devolve para o #4
 * (em voo) e o #906 (parada) sobre a fixture `f4`. O `viva` do #4 é `true`, como numa máquina em que
 * o pid da fixture fosse uma sessão (no app de verdade ele sai `false`, M26 da F2).
 */

const URL = 'https://github.com/leonardo-amaral-3/operations-center/issues'
const PLAN = '/gm-plan-tasks /home/u/pessoal/planning/4-board fase F1 (#4)'
const IMPL = '/gm-implement /home/u/pessoal/planning/4-board fase F1 (#4)'

function despacho(
  d: Partial<DespachoDoCard> & Pick<DespachoDoCard, 'id' | 'comando'>,
): DespachoDoCard {
  return {
    estacao: null,
    estado: 'concluido',
    criadoEm: '2026-11-11T08:00:00.000Z',
    lancadoEm: null,
    concluidoEm: null,
    sessao: null,
    fim: null,
    detalhe: null,
    ...d,
  }
}

const d0002 = despacho({
  id: 'd-0002',
  comando: '/gm-spec #4',
  estacao: 'spec',
  lancadoEm: '2026-11-11T08:00:05.000Z',
  concluidoEm: '2026-11-11T08:10:00.000Z',
  sessao: 'sessao-4-spec',
  fim: 'proximo',
  detalhe: PLAN,
})
const d0003 = despacho({
  id: 'd-0003',
  comando: PLAN,
  estacao: 'tasks',
  criadoEm: '2026-11-11T08:10:00.000Z',
  lancadoEm: '2026-11-11T08:10:05.000Z',
  concluidoEm: '2026-11-11T08:20:00.000Z',
  sessao: 'sessao-4-tasks',
  fim: 'proximo',
  detalhe: IMPL,
})
const d0004 = despacho({
  id: 'd-0004',
  comando: IMPL,
  estacao: 'implementacao',
  criadoEm: '2026-11-11T08:20:00.000Z',
  lancadoEm: '2026-11-11T08:20:05.000Z',
  concluidoEm: '2026-11-11T08:40:00.000Z',
  sessao: 'sessao-4-impl-1',
  fim: 'proximo',
  detalhe: IMPL,
})
const d0005 = despacho({
  id: 'd-0005',
  comando: IMPL,
  estacao: 'implementacao',
  estado: 'rodando',
  criadoEm: '2026-11-11T08:40:00.000Z',
  lancadoEm: '2026-11-11T08:40:05.000Z',
})
const d0007 = despacho({
  id: 'd-0007',
  comando: '/gm-ship /home/u/pessoal/planning/906-y fase F1 (#906)',
  estacao: 'revisao',
  criadoEm: '2026-11-11T09:00:00.000Z',
  lancadoEm: '2026-11-11T09:00:05.000Z',
  concluidoEm: '2026-11-11T09:20:00.000Z',
  sessao: 'sessao-906',
  fim: 'parada',
  detalhe: 'PR #930 aberta na dev (Card: #906); o merge é da orquestradora',
})

export const RESULTADO_906 =
  'PR #930 está aberta na `dev`, com `Card: #906` na primeira linha.\n\n- **Portão local:** `yarn lint`, `yarn typecheck` e `yarn test` passaram.\n- **CI:** pendente.\n\nPARADA: PR #930 aberta na dev (Card: #906); o merge é da orquestradora'

export const CARD_4_EM_VOO: Extract<CardNaFabrica, { kind: 'ok' }> = {
  kind: 'ok',
  card: 4,
  cardUrl: `${URL}/4`,
  atual: d0005,
  ondeRoda: 'worktree ainda não criada',
  viva: true,
  resultado: null,
  terminados: [d0004, d0003, d0002],
}

export const CARD_906_PARADO: Extract<CardNaFabrica, { kind: 'ok' }> = {
  kind: 'ok',
  card: 906,
  cardUrl: `${URL}/906`,
  atual: d0007,
  ondeRoda: 'worktree ainda não criada',
  viva: null,
  resultado: RESULTADO_906,
  terminados: [d0007],
}

export const CORPO_TASKS_4 = [
  '<!-- gm:tasks -->',
  '### Tasks',
  '- [x] 1 — O leitor do board e o contrato',
  '- [ ] 2 — As colunas pela opção do Status',
  '- [ ] 3 — O cartão com os campos',
  '- [ ] 4 — A aba do board',
  '- [ ] 5 — Smoke e README',
].join('\n')

/** O conteúdo do #4 na fixture `f4/cards.json`: um comentário `gm:tasks`. */
export const CONTEUDO_DO_4: CardContent = {
  number: 4,
  body: '',
  comments: [
    {
      id: 'IC_f4_tasks',
      author: 'leonardo-amaral-3',
      createdAt: '2026-11-11T08:20:00Z',
      body: CORPO_TASKS_4,
      kind: 'tasks',
    },
  ],
  truncated: false,
  pullRequest: null,
}

function cardDoBoard(number: number, title: string, rota: boolean, epico: boolean): BoardCard {
  return {
    itemId: `PVTI_f4_${number}`,
    number,
    title,
    url: `${URL}/${number}`,
    repository: 'leonardo-amaral-3/operations-center',
    closed: false,
    assignees: ['leonardo-amaral-3'],
    columnId: 'da732a01',
    fields: [
      { name: 'Tipo', value: '✨ Melhoria', optionId: 'b6b3a417' },
      ...(rota ? [{ name: 'Rota', value: 'Completa', optionId: '88b477d4' }] : []),
    ],
    parent: epico
      ? { number: 905, title: 'Épico sintético', repository: 'leonardo-amaral-3/operations-center' }
      : null,
    phases: [],
  }
}

/** Os cards 4 e 906 do Project 2 da fixture de board (M20). */
export const BOARDS_F4: BoardsSnapshot = {
  boards: [
    {
      key: 'leonardo-amaral-3/2',
      title: 'Operations Center',
      readAt: 1,
      error: null,
      board: {
        title: 'Operations Center',
        columns: [{ id: 'da732a01', name: '🔨 Implementação', conversable: true, triage: false }],
        cards: [
          cardDoBoard(4, 'Ler o board do GitHub e desenhar o kanban somente-leitura', true, false),
          cardDoBoard(906, 'Sintético: fase de um épico que está no board', false, true),
        ],
      },
    },
  ],
  activeKey: 'leonardo-amaral-3/2',
  discoveryError: null,
}
