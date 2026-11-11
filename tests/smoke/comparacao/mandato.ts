import { expect } from '@playwright/test'

import { porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'
import { AMBIENTE_DA_F5, FIXTURE_DA_F5 } from './f5'

/** Os nove nomes de `PORTOES`, literais: o nome divide a célula com a nota, então o `getByText` exato não o acha. */
const NOMES_DOS_PORTOES = [
  'Entrada',
  'G1 · card',
  'G2 · spec',
  'G3 · tasks',
  'Implementação e integração',
  'G4 · merge na dev',
  'Validação em dev',
  'G5 · release e produção',
  'Operação',
]

export const mandato: TelaDoHarness = {
  fixture: FIXTURE_DA_F5,
  ambiente: AMBIENTE_DA_F5,
  comoChegar: async (janela) => {
    await porBotaoDoCabecalho('mandato')(janela)
    await expect(
      janela.locator('[data-testid="fabrica-celula"] [data-quem="A"]').first(),
    ).toBeVisible({ timeout: 20_000 })
    for (const nome of NOMES_DOS_PORTOES) {
      await expect(
        janela.getByTestId('fabrica-portao').filter({ hasText: nome }).first(),
        `Mandato: falta o portão "${nome}"`,
      ).toBeVisible()
    }
  },
  rotulos: [
    ...rotulosDaTrilha({ tela: 'mandato' }),
    'fabrica/MANDATO.md da dev · só leitura',
    'Abrir no GitHub',
    'Quem decide cada portão',
    'Portão',
    'Rota Curta',
    'Rota Completa',
    'Toca dado, faturamento, deploy ou migration',
    'C · travado',
    'Regras que nenhum despacho muda',
    'Placar',
  ],
}
