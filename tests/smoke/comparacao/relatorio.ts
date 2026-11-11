import { FIXTURE_DA_SALA, porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

export const relatorio: TelaDoHarness = {
  fixture: FIXTURE_DA_SALA,
  comoChegar: porBotaoDoCabecalho('relatorio'),
  rotulos: rotulosDaTrilha({ tela: 'relatorio' }),
}
