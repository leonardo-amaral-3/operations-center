import { REPO_ROOT } from '../smoke-env'
import { abrirFabrica } from './comum'
import type { TelaDoHarness } from './comum'

/** A fixture da fila acionável (F3): quatro itens abertos, um fechado, nada em voo. */
export const FIXTURE_DA_F3 = `${REPO_ROOT}/tests/fixtures/fabrica/f3`

/**
 * Abre a Sala e entra no item aberto do card. O clique cai no canto de cima do cartão, dentro do
 * padding: nenhum botão de nenhum cartão (nem o da F1, nem o "Ver contexto" da F2) fica ali.
 */
export function abrirItemDoCard(card: number): NonNullable<TelaDoHarness['comoChegar']> {
  return async (janela) => {
    await abrirFabrica(janela)
    await janela
      .getByTestId('fabrica-aberto')
      .filter({ hasText: `#${card}` })
      .click({ position: { x: 6, y: 6 } })
  }
}
