import { FIXTURE_DA_SALA } from './comum'
import type { TelaDoHarness } from './comum'

// A Decisão ganha entrada na F3, quando um item da fila puder ser decisão.
export const decisao: TelaDoHarness = {
  fixture: FIXTURE_DA_SALA,
  comoChegar: null,
  rotulos: [],
}
