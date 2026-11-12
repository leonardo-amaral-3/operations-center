import { porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'
import { FIXTURE_DA_F4 } from './f4'

export const entrada: TelaDoHarness = {
  fixture: FIXTURE_DA_F4,
  comoChegar: porBotaoDoCabecalho('entrada'),
  rotulos: [
    ...rotulosDaTrilha({ tela: 'entrada' }),
    'O que chegou',
    'Tudo',
    'Slack',
    'Suporte',
    'Vigia',
    'Você',
    'Contar algo que te reportaram',
    'Mandar para a entrada',
    'Como a entrada trabalha',
    'O que ela não faz',
  ],
}
