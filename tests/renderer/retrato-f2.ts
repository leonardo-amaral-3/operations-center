import type { BoardCard, BoardsSnapshot } from '../../src/shared/board'
import type { DecisaoNaSala, ItemNaSala, SalaDaFabrica } from '../../src/shared/fabrica'

/**
 * O "esperado F2" de `spec-f2.md` §F2.9, escrito à mão: o ramo `ok` que a fixture
 * `tests/fixtures/fabrica/f2/` produz, com os três despachos que lançam ou rodam **vivos** (no app
 * de verdade os pids da fixture não são sessões, M26) e os recursos de uma máquina saudável. As
 * telas Sala e Agentes (tasks 4 e 5) importam este retrato e `BOARDS_F2`.
 */

const URL = 'https://github.com/leonardo-amaral-3/operations-center/issues'

const q0013: ItemNaSala = {
  id: 'q-0013',
  tipo: 'pergunta',
  card: 952,
  repo: 'leonardo-amaral-3/operations-center',
  cardUrl: `${URL}/952`,
  motivo: 'o card não diz qual board é o alvo',
  despacho: 'd-0012',
  comando: '/gm-triage 952',
  sessaoClaude: null,
  criadoEm: '2026-11-11T08:20:00.000Z',
  fechadoEm: null,
  resolucao: null,
  estacao: 'entrada',
  sessaoQuebrada: false,
}

const q0016: ItemNaSala = {
  id: 'q-0016',
  tipo: 'pergunta',
  card: 953,
  repo: 'leonardo-amaral-3/operations-center',
  cardUrl: `${URL}/953`,
  motivo: 'a sessão terminou sem saída',
  despacho: 'd-0015',
  comando: '/gm-implement /home/u/pessoal/planning/953-y',
  sessaoClaude: null,
  criadoEm: '2026-11-11T08:40:00.000Z',
  fechadoEm: null,
  resolucao: null,
  estacao: 'implementacao',
  sessaoQuebrada: true,
}

const q0019: ItemNaSala = {
  id: 'q-0019',
  tipo: 'pergunta',
  card: 954,
  repo: 'leonardo-amaral-3/operations-center',
  cardUrl: `${URL}/954`,
  motivo: 'espera o segundo revisor',
  despacho: 'd-0018',
  comando: '/gm-spec #954',
  sessaoClaude: null,
  criadoEm: '2026-11-11T07:30:00.000Z',
  fechadoEm: '2026-11-11T07:45:00.000Z',
  resolucao: 'seguir sem segundo revisor',
  estacao: 'spec',
  sessaoQuebrada: false,
}

const q0022: ItemNaSala = {
  id: 'q-0022',
  tipo: 'pergunta',
  card: 955,
  repo: 'leonardo-amaral-3/operations-center',
  cardUrl: `${URL}/955`,
  motivo: 'PR #960 aberta na dev (Card: #955); o merge é da orquestradora',
  despacho: 'd-0021',
  comando: '/gm-ship /home/u/pessoal/planning/955-z',
  sessaoClaude: null,
  criadoEm: '2026-11-11T09:10:00.000Z',
  fechadoEm: null,
  resolucao: null,
  estacao: 'revisao',
  sessaoQuebrada: false,
}

const decisoes: DecisaoNaSala[] = [
  {
    tipo: 'passou',
    id: 'd-0003',
    card: 1,
    skill: 'gm-plan-tasks',
    seguinte: 'gm-implement',
    em: '2026-11-11T09:20:00.000Z',
  },
  { tipo: 'fila', id: 'q-0022', card: 955, item: q0022, em: '2026-11-11T09:10:00.000Z' },
  {
    tipo: 'passou',
    id: 'd-0002',
    card: 1,
    skill: 'gm-spec',
    seguinte: 'gm-plan-tasks',
    em: '2026-11-11T09:10:00.000Z',
  },
  { tipo: 'fila', id: 'q-0016', card: 953, item: q0016, em: '2026-11-11T08:40:00.000Z' },
  { tipo: 'fila', id: 'q-0013', card: 952, item: q0013, em: '2026-11-11T08:20:00.000Z' },
  { tipo: 'fila', id: 'q-0019', card: 954, item: q0019, em: '2026-11-11T07:30:00.000Z' },
]

export const RETRATO_F2: Extract<SalaDaFabrica, { kind: 'ok' }> = {
  kind: 'ok',
  lidoEm: '2026-11-11T12:00:00.000Z',
  projeto: 'Operations Center · Project 2',
  despachante: 'rodando',
  pausa: null,
  recursos: {
    sessoes: { kind: 'ok', vivas: 1, teto: 3 },
    suite: { kind: 'livre' },
    disco: { kind: 'ok', livres: 50 * 1024 ** 3, minimo: 2 * 1024 ** 3 },
  },
  emVoo: [
    {
      id: 'd-0004',
      card: 1,
      repo: 'leonardo-amaral-3/operations-center',
      cardUrl: `${URL}/1`,
      comando: '/gm-implement /home/u/pessoal/planning/1-fundar',
      estacao: 'implementacao',
      estado: 'rodando',
      criadoEm: '2026-11-11T09:20:00.000Z',
      lancadoEm: '2026-11-11T09:20:00.000Z',
      ondeRoda: 'worktree ainda não criada',
      viva: true,
    },
    {
      id: 'd-0006',
      card: 4,
      repo: 'leonardo-amaral-3/operations-center',
      cardUrl: `${URL}/4`,
      comando: '/gm-spec #4',
      estacao: 'spec',
      estado: 'rodando',
      criadoEm: '2026-11-11T09:30:00.000Z',
      lancadoEm: '2026-11-11T09:30:00.000Z',
      ondeRoda: 'planning/',
      viva: true,
    },
    {
      id: 'd-0008',
      card: 2,
      repo: 'leonardo-amaral-3/operations-center',
      cardUrl: `${URL}/2`,
      comando: '/gm-card #2',
      estacao: 'card',
      estado: 'pendente',
      criadoEm: '2026-11-11T09:40:00.000Z',
      lancadoEm: null,
      ondeRoda: 'sem worktree',
      viva: null,
    },
    {
      id: 'd-0010',
      card: 951,
      repo: 'leonardo-amaral-3/operations-center',
      cardUrl: `${URL}/951`,
      comando: '/gm-ship /home/u/pessoal/planning/951-x',
      estacao: 'revisao',
      estado: 'lancando',
      criadoEm: '2026-11-11T09:50:00.000Z',
      lancadoEm: '2026-11-11T09:50:00.000Z',
      ondeRoda: 'worktree ainda não criada',
      viva: true,
    },
  ],
  abertos: [q0013, q0016, q0022],
  fechados: [q0019],
  decisoes,
  frentesAbertas: 4,
}

function cardDoBoard(
  number: number,
  title: string,
  tipo: { value: string; optionId: string },
  rota: boolean,
): BoardCard {
  return {
    itemId: `PVTI_f2_${number}`,
    number,
    title,
    url: `${URL}/${number}`,
    repository: 'leonardo-amaral-3/operations-center',
    closed: false,
    assignees: ['leonardo-amaral-3'],
    columnId: 'da732a01',
    fields: [
      { name: 'Tipo', ...tipo },
      ...(rota ? [{ name: 'Rota', value: 'Completa', optionId: '88b477d4' }] : []),
    ],
    parent: null,
    phases: [],
  }
}

const MELHORIA = { value: '✨ Melhoria', optionId: 'b6b3a417' }

/** Os cards 1, 2 e 4 do Project 2 da fixture de board (M14), com o `url` que a sala usa (M15). */
export const BOARDS_F2: BoardsSnapshot = {
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
          cardDoBoard(
            1,
            'Fundar o operations-center: objetivo, necessidades e estrutura inicial',
            MELHORIA,
            true,
          ),
          cardDoBoard(
            2,
            'Peer dependencies do claude-agent-sdk ausentes: metade dos tipos do SDK não resolve',
            { value: '🧰 Débito técnico', optionId: '353893bc' },
            false,
          ),
          cardDoBoard(
            4,
            'Ler o board do GitHub e desenhar o kanban somente-leitura',
            MELHORIA,
            true,
          ),
        ],
      },
    },
  ],
  activeKey: 'leonardo-amaral-3/2',
  discoveryError: null,
}
