import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { REPO_ROOT } from '../smoke-env'
import { trilhaDa } from '../../../src/renderer/fabrica/rotas'
import type { NomeDaTela, TelaDaFabrica } from '../../../src/renderer/fabrica/rotas'

/** O que cada tela diz ao harness de comparação (#130, §F1.6). Cada fase edita só as suas telas. */
export interface TelaDoHarness {
  /** A pasta da fábrica que a tela mostra; telas com a mesma pasta dividem uma subida do app. */
  fixture: string
  /** Leva o app até a tela, partindo da Sala; `null` quando ela ainda não é alcançável. */
  comoChegar: ((janela: Page) => Promise<void>) | null
  /** Textos fixos (que não dependem de dado) que a tela tem de mostrar, um a um. */
  rotulos: string[]
}

/** A fixture da fábrica que a F1 usa em todas as telas. */
export const FIXTURE_DA_SALA = `${REPO_ROOT}/tests/fixtures/fabrica/sala`

/** Abre a sala da fábrica se ela ainda não estiver aberta (a aba de board "Operations Center" é da casca). */
export async function abrirFabrica(janela: Page): Promise<void> {
  if ((await janela.getByTestId('fabrica-sala').count()) === 0) {
    await janela.getByTestId('fabrica-toggle').click()
  }
  await expect(janela.getByTestId('fabrica-sala')).toBeVisible()
}

/** Chega a uma tela de botão do cabeçalho da Sala (as sete além da própria Sala). */
export function porBotaoDoCabecalho(tela: Exclude<NomeDaTela, 'sala'>) {
  return async (janela: Page): Promise<void> => {
    await abrirFabrica(janela)
    await janela.getByTestId(`fabrica-nav-${tela}`).click()
  }
}

/** Os rótulos de uma tela interna: "Sala de controle" na trilha e o último passo dela. */
export function rotulosDaTrilha(tela: TelaDaFabrica): string[] {
  const trilha = trilhaDa(tela, new Date())
  return ['Sala de controle', trilha[trilha.length - 1]?.rotulo ?? '']
}
