import { FIXTURE_DA_SALA, porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

export const briefing: TelaDoHarness = {
  fixture: FIXTURE_DA_SALA,
  comoChegar: porBotaoDoCabecalho('briefing'),
  rotulos: rotulosDaTrilha({ tela: 'briefing' }),
}
