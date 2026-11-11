import { FIXTURE_DA_SALA, porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

export const release: TelaDoHarness = {
  fixture: FIXTURE_DA_SALA,
  comoChegar: porBotaoDoCabecalho('release'),
  rotulos: rotulosDaTrilha({ tela: 'release' }),
}
