import { FIXTURE_DA_SALA, porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

export const mandato: TelaDoHarness = {
  fixture: FIXTURE_DA_SALA,
  comoChegar: porBotaoDoCabecalho('mandato'),
  rotulos: rotulosDaTrilha({ tela: 'mandato' }),
}
