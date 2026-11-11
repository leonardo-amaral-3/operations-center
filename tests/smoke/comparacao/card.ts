import { FIXTURE_DA_SALA, abrirFabrica, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

export const card: TelaDoHarness = {
  fixture: FIXTURE_DA_SALA,
  comoChegar: async (janela) => {
    await abrirFabrica(janela)
    await janela.getByTestId('fabrica-em-voo').first().click()
  },
  // O primeiro despacho em voo da fixture é o do #903.
  rotulos: rotulosDaTrilha({ tela: 'card', card: 903 }),
}
