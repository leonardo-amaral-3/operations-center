import { REPO_ROOT } from '../smoke-env'
import { porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

export const agentes: TelaDoHarness = {
  fixture: `${REPO_ROOT}/tests/fixtures/fabrica/f2`,
  comoChegar: porBotaoDoCabecalho('agentes'),
  rotulos: [
    ...rotulosDaTrilha({ tela: 'agentes' }),
    'Sessões da fábrica',
    'Card',
    'Estação',
    'Agente',
    'Onde roda',
    'Estado',
    'Cadeados',
    'Suíte de smoke',
    'Projeto do Ghidra',
    'Disco',
    'Próximos despachos',
    'Ordem de chegada: o mais antigo primeiro, uma sessão por frente.',
    'Se o PC cair',
  ],
}
