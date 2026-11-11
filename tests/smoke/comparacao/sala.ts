import { NAVEGACAO_DA_SALA } from '../../../src/renderer/fabrica/rotas'
import { FIXTURE_DA_SALA, abrirFabrica } from './comum'
import type { TelaDoHarness } from './comum'

export const sala: TelaDoHarness = {
  fixture: FIXTURE_DA_SALA,
  comoChegar: abrirFabrica,
  rotulos: [
    ...NAVEGACAO_DA_SALA.map(({ rotulo }) => rotulo),
    'Operations Center',
    'Sala de controle da fábrica',
  ],
}
