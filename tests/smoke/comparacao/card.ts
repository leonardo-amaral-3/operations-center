import { abrirFabrica, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'
import { FIXTURE_DA_F4 } from './f4'

export const card: TelaDoHarness = {
  fixture: FIXTURE_DA_F4,
  comoChegar: async (janela) => {
    await abrirFabrica(janela)
    await janela.getByTestId('fabrica-em-voo').filter({ hasText: /^#4 / }).first().click()
  },
  // Literais de propósito: o harness não importa do renderer além de `rotas.ts`.
  // Exceção declarada: a subida do harness não tem `OC_CARD_FIXTURE`, então a caixa "Tasks do card"
  // do `Card-app.png` mostra o Vazio "Sem leitura do card"; as tasks são afirmadas no smoke da F4.
  rotulos: [
    ...rotulosDaTrilha({ tela: 'card', card: 4, repo: null }),
    'Tasks do card',
    'Decisões deste card',
    'Assumir a sessão',
    'Mandar uma mensagem',
    'Parar o turno',
    'Entrada',
    'Card · G1',
    'Spec · G2',
    'Tasks · G3',
    'Implementação',
    'Integração',
    'Revisão · G4',
    'Validação',
    'Release · G5',
  ],
}
