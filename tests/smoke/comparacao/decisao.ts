import { rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'
import { FIXTURE_DA_F3, abrirItemDoCard } from './fila-f3'

export const decisao: TelaDoHarness = {
  fixture: FIXTURE_DA_F3,
  comoChegar: abrirItemDoCard(962),
  rotulos: [
    ...rotulosDaTrilha({ tela: 'decisao', item: 'q-0013' }),
    'Você aprova',
    'Conferido pelo agente',
    'Precisa do seu olho',
    'sem conferência',
    'Abrir a PR',
    'Aprovar e fechar o item',
    'Devolver com correção',
    'Se você aprovar',
    'Como chegou aqui',
    'Linhagem',
  ],
}
