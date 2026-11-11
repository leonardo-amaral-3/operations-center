import { FIXTURE_DA_SALA, abrirFabrica, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

export const pergunta: TelaDoHarness = {
  fixture: FIXTURE_DA_SALA,
  comoChegar: async (janela) => {
    await abrirFabrica(janela)
    await janela.getByTestId('fabrica-aberto').first().click()
  },
  rotulos: rotulosDaTrilha({ tela: 'pergunta', item: 'q-0003' }),
}
