import { rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'
import { AMBIENTE_DA_F5, FIXTURE_DA_F5, abrirRelatorioDe } from './f5'

export const portfolio: TelaDoHarness = {
  fixture: FIXTURE_DA_F5,
  ambiente: AMBIENTE_DA_F5,
  comoChegar: async (janela) => {
    await abrirRelatorioDe('2026-11-10')(janela)
    await janela.getByTestId('fabrica-relatorio-trilha').click()
  },
  rotulos: [
    ...rotulosDaTrilha({ tela: 'portfolio' }),
    'relatório do dia',
    'A empresa está indo na direção certa?',
    'objetivo',
    'Trilha de decisões',
    'Todas',
    'Chave',
    'Provisórias',
    'Suas',
    'Sem objetivo',
    'Alertas',
    'Frente',
    'Quem decidiu',
    'Decisão',
    'Reversível',
    'Estado',
    'Confirmar',
    'Contestar',
    'Abrir o card',
  ],
}
