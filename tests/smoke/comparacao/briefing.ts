import { expect } from '@playwright/test'

import { FIXTURE_DA_F6 } from './f6'
import { porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

const irParaOBriefing = porBotaoDoCabecalho('briefing')

export const briefing: TelaDoHarness = {
  fixture: FIXTURE_DA_F6,
  comoChegar: async (janela) => {
    await irParaOBriefing(janela)
    // o print sai com os passos do plano
    await expect(janela.getByTestId('fabrica-briefing-passo').first()).toBeVisible()
  },
  rotulos: [
    ...rotulosDaTrilha({ tela: 'briefing' }),
    'Eu acompanho',
    'Dia autônomo',
    'O que a fábrica toca hoje sem você',
    'Não fazer hoje',
    'Contexto do dia',
    'Soltar o dia',
    'Plano devolvido',
    'você não precisa aprovar',
    'Para que serve o plano',
    'Pronto quando',
    'Entra no dia',
  ],
}
