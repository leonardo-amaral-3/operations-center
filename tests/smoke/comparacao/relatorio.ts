import { rotulosDaTrilha } from './comum'
import type { TelaDoHarness } from './comum'
import { AMBIENTE_DA_F5, FIXTURE_DA_F5, abrirRelatorioDe } from './f5'

export const relatorio: TelaDoHarness = {
  fixture: FIXTURE_DA_F5,
  ambiente: AMBIENTE_DA_F5,
  comoChegar: abrirRelatorioDe('2026-11-10'),
  rotulos: [
    ...rotulosDaTrilha({ tela: 'relatorio', dia: '2026-11-10' }),
    'montado do cofre, do board e do git',
    'ver trilha completa',
    'EM UMA FRASE',
    'decisões no cofre',
    'decisões-chave abaixo',
    'provisórias para você',
    'estacionadas esperando você',
    'gravadas com escopo sem repo',
    'Para onde foi o esforço',
    'Decisões-chave',
    'Confirmar',
    'Contestar',
    'Ver no cofre',
    'Estacionadas esperando você',
    'Amanhã',
    'Abrir o Briefing',
    'gerar de novo',
  ],
}
