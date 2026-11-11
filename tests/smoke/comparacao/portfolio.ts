import { FIXTURE_DA_SALA, porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

export const portfolio: TelaDoHarness = {
  fixture: FIXTURE_DA_SALA,
  comoChegar: porBotaoDoCabecalho('portfolio'),
  rotulos: rotulosDaTrilha({ tela: 'portfolio' }),
}
