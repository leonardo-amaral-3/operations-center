import { describe, expect, it } from 'vitest'

import type { ItemNaSala } from '../../src/shared/fabrica'
import {
  ARQUIVO_DO_PROTOTIPO,
  NAVEGACAO_DA_SALA,
  rotaDoItem,
  trilhaDa,
  type NomeDaTela,
  type TelaDaFabrica,
} from '../../src/renderer/fabrica/rotas'

const HOJE = new Date('2026-11-11T23:30:00.000Z')
const SALA = { tela: 'sala' } as const
const rotulos = (t: TelaDaFabrica) => trilhaDa(t, HOJE).map((m) => m.rotulo)

describe('trilhaDa', () => {
  it('a Sala não tem trilha', () => {
    expect(trilhaDa(SALA, HOJE)).toEqual([])
  })

  it('as 10 telas além da Sala, com o texto literal do protótipo', () => {
    const casos: Array<[TelaDaFabrica, string[]]> = [
      [{ tela: 'agentes' }, ['Sala de controle', 'Agentes']],
      [{ tela: 'pergunta', item: 'q-1' }, ['Sala de controle', 'Esperando você', 'Pergunta']],
      [
        { tela: 'decisao', item: 'q-1' },
        ['Sala de controle', 'Esperando você', 'Validação em dev'],
      ],
      [{ tela: 'card', card: 129 }, ['Sala de controle', 'Linha', '#129']],
      [{ tela: 'entrada' }, ['Sala de controle', 'Entrada']],
      [{ tela: 'relatorio' }, ['Sala de controle', 'Relatório de 11/11']],
      [{ tela: 'portfolio' }, ['Sala de controle', 'Portfólio']],
      [{ tela: 'mandato' }, ['Sala de controle', 'Mandato']],
      [{ tela: 'briefing' }, ['Sala de controle', 'Briefing do dia']],
      [{ tela: 'release' }, ['Sala de controle', 'Release']],
    ]
    for (const [tela, esperado] of casos) expect(rotulos(tela)).toEqual(esperado)
  })

  it('relatório com dia usa o dia, sem dia usa hoje em UTC', () => {
    expect(rotulos({ tela: 'relatorio', dia: '2026-03-07' })[1]).toBe('Relatório de 07/03')
    expect(rotulos({ tela: 'relatorio' })[1]).toBe('Relatório de 11/11')
  })

  it('as duas primeiras migalhas voltam à Sala e a última é a tela atual', () => {
    const pergunta = trilhaDa({ tela: 'pergunta', item: 'q-1' }, HOJE)
    expect(pergunta.map((m) => m.para)).toEqual([SALA, SALA, null])
    const card = trilhaDa({ tela: 'card', card: 7 }, HOJE)
    expect(card.map((m) => m.para)).toEqual([SALA, SALA, null])
    expect(trilhaDa({ tela: 'agentes' }, HOJE).map((m) => m.para)).toEqual([SALA, null])
  })
})

describe('rotaDoItem', () => {
  const item = (tipo: ItemNaSala['tipo']): ItemNaSala => ({
    id: 'q-0003',
    tipo,
    card: 1,
    cardUrl: 'u',
    motivo: 'm',
    despacho: 'd-1',
    comando: null,
    sessaoClaude: null,
    criadoEm: '2026-11-11T00:00:00.000Z',
    fechadoEm: null,
    resolucao: null,
    estacao: null,
    sessaoQuebrada: false,
  })

  it('a rota segue o tipo do item', () => {
    expect(rotaDoItem(item('pergunta'))).toEqual({ tela: 'pergunta', item: 'q-0003' })
    expect(rotaDoItem(item('decisao'))).toEqual({ tela: 'decisao', item: 'q-0003' })
  })
})

describe('NAVEGACAO_DA_SALA e ARQUIVO_DO_PROTOTIPO', () => {
  it('os oito botões, na ordem do protótipo', () => {
    expect(NAVEGACAO_DA_SALA.map((b) => b.rotulo)).toEqual([
      'Sala de controle',
      'Briefing',
      'Relatório',
      'Portfólio',
      'Entrada',
      'Agentes',
      'Release',
      'Mandato e placar',
    ])
  })

  it('cada uma das 11 telas tem um arquivo .dc.html', () => {
    const telas = Object.keys(ARQUIVO_DO_PROTOTIPO) as NomeDaTela[]
    expect(telas).toHaveLength(11)
    expect(telas.every((t) => ARQUIVO_DO_PROTOTIPO[t].endsWith('.dc.html'))).toBe(true)
    expect(ARQUIVO_DO_PROTOTIPO.sala).toBe('Main.dc.html')
  })
})
