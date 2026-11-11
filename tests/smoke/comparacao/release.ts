import { FIXTURE_DA_F6 } from './f6'
import { porBotaoDoCabecalho, rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'

export const release: TelaDoHarness = {
  fixture: FIXTURE_DA_F6,
  comoChegar: porBotaoDoCabecalho('release'),
  rotulos: [
    ...rotulosDaTrilha({ tela: 'release' }),
    'G5 · nível C · só você',
    'No trem',
    'Notas da release, rascunho da fábrica',
    'O que muda para você',
    'Copiar notas',
    'Verificação pós-deploy',
    'Depois da produção',
    'Abrir o board no GitHub',
    'Ver dev → main no GitHub',
  ],
}
