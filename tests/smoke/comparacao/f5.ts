import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { REPO_ROOT } from '../smoke-env'
import { porBotaoDoCabecalho } from './comum'

/** A pasta da fábrica da F5: só o `revisoes.jsonl`, sem `estado.json`. */
export const FIXTURE_DA_F5 = `${REPO_ROOT}/tests/fixtures/fabrica/f5`

/** O ambiente a mais da F5: o cofre de doze decisões e o mandato versionado. */
export const AMBIENTE_DA_F5 = {
  OC_RELATORIO_COFRE: `${REPO_ROOT}/tests/fixtures/fabrica/f5-cofre`,
  OC_FABRICA_MANDATO_FIXTURE: `${REPO_ROOT}/tests/fixtures/fabrica/f5-mandato.md`,
}

/** Abre o Relatório do dia dado e espera o painel dele (e não o de hoje) estar na tela. */
export function abrirRelatorioDe(dia: string) {
  return async (janela: Page): Promise<void> => {
    await porBotaoDoCabecalho('relatorio')(janela)
    await janela.getByTestId('relatorio-dia').fill(dia)
    const [, mes, diaDoMes] = dia.split('-')
    await expect(janela.getByTestId('fabrica-trilha')).toHaveText(
      new RegExp(`Relatório de ${diaDoMes}/${mes}$`),
      { timeout: 20_000 },
    )
    await expect(janela.locator('[data-testid="fabrica-kpi"][data-kpi="cofre"]')).toBeVisible({
      timeout: 20_000,
    })
  }
}
