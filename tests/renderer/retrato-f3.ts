import type {
  ItemNaSala,
  PassoDaFrente,
  PerguntaDaFila,
  SalaDaFabrica,
} from '../../src/shared/fabrica'

/**
 * Os literais da fixture `tests/fixtures/fabrica/f3` (spec da F3, §F3.7), à mão e sem passar pelo
 * core: o teste de tela compara contra o que a spec diz, não contra o que o código calcula. As telas
 * da Pergunta e da Decisão e o teste da raiz importam daqui.
 */

const URL_DO_CARD = 'https://github.com/leonardo-amaral-3/operations-center/issues'
const URL_DA_PR = 'https://github.com/leonardo-amaral-3/operations-center/pull'

const TEXTO_DO_961 =
  'A spec do #961 está escrita até o Q&A.\n\n- **Onde parou:** a resposta da pergunta tem de ir para algum lugar, e o card não diz qual.\n- **O que muda:** gravar no board exige escrita no GitHub; gravar no cofre não.\n\nPARADA: o card não diz se a resposta vai para o board ou para o cofre'

const TEXTO_DO_962 =
  'Revisei a PR #970 contra a spec do #962.\n\n- **Portão local:** não roda no G4; o diff traz os testes que a spec pede.\n- **Parecer:** comentado na PR.\n\nPARADA: G4 da PR #970: sem bloqueante · parecer https://github.com/leonardo-amaral-3/operations-center/pull/970#issuecomment-1'

const q0003: ItemNaSala = {
  id: 'q-0003',
  tipo: 'pergunta',
  card: 965,
  cardUrl: `${URL_DO_CARD}/965`,
  motivo: 'o card não diz qual board é o alvo',
  despacho: 'd-0002',
  comando: '/gm-card #965',
  sessaoClaude: 'sessao-965',
  criadoEm: '2026-11-11T07:20:00.000Z',
  fechadoEm: '2026-11-11T07:30:00.000Z',
  resolucao: 'o board da fábrica (Project 2)',
  estacao: 'card',
  sessaoQuebrada: false,
}

const q0009: ItemNaSala = {
  id: 'q-0009',
  tipo: 'pergunta',
  card: 961,
  cardUrl: `${URL_DO_CARD}/961`,
  motivo: 'o card não diz se a resposta vai para o board ou para o cofre',
  despacho: 'd-0005',
  comando: '/gm-spec #961',
  sessaoClaude: 'sessao-961',
  criadoEm: '2026-11-11T08:30:00.000Z',
  fechadoEm: null,
  resolucao: null,
  estacao: 'spec',
  sessaoQuebrada: false,
}

const q0013: ItemNaSala = {
  id: 'q-0013',
  tipo: 'decisao',
  card: 962,
  cardUrl: `${URL_DO_CARD}/962`,
  motivo:
    'G4 da PR #970: sem bloqueante · parecer https://github.com/leonardo-amaral-3/operations-center/pull/970#issuecomment-1',
  despacho: 'd-0018',
  comando: '/g4 #962 PR #970',
  sessaoClaude: 'sessao-962-g4',
  criadoEm: '2026-11-11T09:04:00.000Z',
  fechadoEm: null,
  resolucao: null,
  estacao: 'revisao',
  sessaoQuebrada: false,
}

const q0016: ItemNaSala = {
  id: 'q-0016',
  tipo: 'pergunta',
  card: 963,
  cardUrl: `${URL_DO_CARD}/963`,
  motivo: 'a sessão terminou sem saída',
  despacho: 'd-0012',
  comando: '/gm-implement /home/u/pessoal/planning/963-y',
  sessaoClaude: null,
  criadoEm: '2026-11-11T09:05:00.000Z',
  fechadoEm: null,
  resolucao: null,
  estacao: 'implementacao',
  sessaoQuebrada: true,
}

const q0017: ItemNaSala = {
  id: 'q-0017',
  tipo: 'decisao',
  card: 964,
  cardUrl: `${URL_DO_CARD}/964`,
  motivo:
    'G4 da PR #971: sem bloqueante · parecer https://github.com/leonardo-amaral-3/operations-center/pull/971#issuecomment-2',
  despacho: 'd-0019',
  comando: '/g4 #964 PR #971',
  sessaoClaude: 'sessao-964-g4',
  criadoEm: '2026-11-11T09:14:00.000Z',
  fechadoEm: null,
  resolucao: null,
  estacao: 'revisao',
  sessaoQuebrada: false,
}

/** O retrato `ok` que a fixture `f3` dá: quatro itens abertos, um fechado, nada em voo. */
export const RETRATO_F3: SalaDaFabrica = {
  kind: 'ok',
  lidoEm: '2026-11-11T12:00:00.000Z',
  projeto: 'Operations Center · Project 2',
  despachante: 'parado',
  pausa: null,
  recursos: {
    sessoes: { kind: 'ok', vivas: 0, teto: 3 },
    suite: { kind: 'livre' },
    disco: { kind: 'ok', livres: 50 * 1024 ** 3, minimo: 2 * 1024 ** 3 },
  },
  emVoo: [],
  abertos: [q0009, q0013, q0016, q0017],
  fechados: [q0003],
  decisoes: [],
  frentesAbertas: 0,
}

const passo = (
  despacho: string,
  skill: string,
  comando: string,
  fim: PassoDaFrente['fim'],
  detalhe: string,
  em: string,
): PassoDaFrente => ({ despacho, skill, comando, fim, detalhe, em })

const fechar = (id: string): string => `yarn fabrica fechar ${id} "<resolução>"`

/** A `PerguntaDaFila` de cada item da fixture `f3`, por id. */
export const PERGUNTAS_F3: Record<string, PerguntaDaFila> = {
  'q-0003': {
    item: q0003,
    resultado: null,
    fechar: fechar('q-0003'),
    fim: 'parada',
    pr: null,
    prUrl: null,
    passos: [
      passo(
        'd-0002',
        'gm-card',
        '/gm-card #965',
        'parada',
        'o card não diz qual board é o alvo',
        '2026-11-11T07:20:00.000Z',
      ),
    ],
  },
  'q-0009': {
    item: q0009,
    resultado: TEXTO_DO_961,
    fechar: fechar('q-0009'),
    fim: 'parada',
    pr: null,
    prUrl: null,
    passos: [
      passo(
        'd-0005',
        'gm-spec',
        '/gm-spec #961',
        'parada',
        'o card não diz se a resposta vai para o board ou para o cofre',
        '2026-11-11T08:30:00.000Z',
      ),
    ],
  },
  'q-0013': {
    item: q0013,
    resultado: TEXTO_DO_962,
    fechar: fechar('q-0013'),
    fim: 'parada',
    pr: 970,
    prUrl: `${URL_DA_PR}/970`,
    passos: [
      passo(
        'd-0007',
        'gm-plan-tasks',
        '/gm-plan-tasks /home/u/pessoal/planning/962-fila',
        'proximo',
        '/gm-implement /home/u/pessoal/planning/962-fila',
        '2026-11-11T08:20:00.000Z',
      ),
      passo(
        'd-0008',
        'gm-implement',
        '/gm-implement /home/u/pessoal/planning/962-fila',
        'proximo',
        '/gm-ship /home/u/pessoal/planning/962-fila',
        '2026-11-11T08:45:00.000Z',
      ),
      passo(
        'd-0010',
        'gm-ship',
        '/gm-ship /home/u/pessoal/planning/962-fila',
        'parada',
        'PR #970 aberta na dev (Card: #962); o merge é da orquestradora',
        '2026-11-11T09:00:00.000Z',
      ),
      passo(
        'd-0018',
        'g4',
        '/g4 #962 PR #970',
        'parada',
        'G4 da PR #970: sem bloqueante · parecer https://github.com/leonardo-amaral-3/operations-center/pull/970#issuecomment-1',
        '2026-11-11T09:04:00.000Z',
      ),
    ],
  },
  'q-0016': {
    item: q0016,
    resultado: null,
    fechar: fechar('q-0016'),
    fim: 'falha',
    pr: null,
    prUrl: null,
    passos: [
      passo(
        'd-0012',
        'gm-implement',
        '/gm-implement /home/u/pessoal/planning/963-y',
        'falha',
        'a sessão terminou sem saída',
        '2026-11-11T09:05:00.000Z',
      ),
    ],
  },
  'q-0017': {
    item: q0017,
    resultado: null,
    fechar: fechar('q-0017'),
    fim: 'parada',
    pr: 971,
    prUrl: `${URL_DA_PR}/971`,
    passos: [
      passo(
        'd-0015',
        'gm-ship',
        '/gm-ship /home/u/pessoal/planning/964-z',
        'parada',
        'PR #971 aberta na dev (Card: #964); o merge é da orquestradora',
        '2026-11-11T09:10:00.000Z',
      ),
      passo(
        'd-0019',
        'g4',
        '/g4 #964 PR #971',
        'parada',
        'G4 da PR #971: sem bloqueante · parecer https://github.com/leonardo-amaral-3/operations-center/pull/971#issuecomment-2',
        '2026-11-11T09:14:00.000Z',
      ),
    ],
  },
}
