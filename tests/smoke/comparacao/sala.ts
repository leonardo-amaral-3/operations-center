import { NAVEGACAO_DA_SALA } from '../../../src/renderer/fabrica/rotas'
import { REPO_ROOT } from '../smoke-env'
import { abrirFabrica } from './comum'
import type { TelaDoHarness } from './comum'

export const sala: TelaDoHarness = {
  fixture: `${REPO_ROOT}/tests/fixtures/fabrica/f2`,
  comoChegar: abrirFabrica,
  rotulos: [
    ...NAVEGACAO_DA_SALA.map(({ rotulo }) => rotulo),
    'Operations Center',
    'Sala de controle da fábrica',
    'esperando você',
    'Esperando você',
    'mais antiga primeiro',
    'Linha de produção',
    'A a fábrica decide · B você aprova · C só você',
    'Recursos',
    'Sessões simultâneas',
    'Suíte de smoke',
    'Cópias do Ghidra',
    'Disco',
    'Cota do plano',
    'O que a fábrica decidiu',
    'Ver mandato em vigor',
  ],
}
