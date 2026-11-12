import { rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'
import { FIXTURE_DA_F3, abrirItemDoCard } from './fila-f3'

export const pergunta: TelaDoHarness = {
  fixture: FIXTURE_DA_F3,
  comoChegar: abrirItemDoCard(961),
  rotulos: [
    ...rotulosDaTrilha({ tela: 'pergunta', item: 'q-0009' }),
    'O que a fábrica faz com cada resposta',
    'De onde veio',
    'Responda com as suas palavras',
    'Responder e fechar o item',
    'Outras decisões suas na fila',
    'Decisão',
    'Por que chegou a você',
  ],
}
