import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseEstado } from '../../src/core/fabrica/estado'
import {
  PASSOS_NA_SALA,
  estacaoDoComando,
  montarDecisoes,
  montarPergunta,
  montarSala,
  ondeRodaDo,
  ondeRodaOComando,
  prDoMotivo,
  tipoDoItem,
  urlDaPr,
  urlDoCard,
} from '../../src/core/fabrica/sala'
import type { Desfecho, Despacho, EstadoDaFabrica, ItemDaFila } from '../../src/core/fabrica/tipos'
import type { RecursosDaFabrica } from '../../src/shared/fabrica'
import { identidade } from '../../src/main/fabrica/arquivos'
import {
  estadoDoDespachante,
  lerCardDaFabrica,
  lerEntradaDaSala,
  lerPergunta,
  lerRevisoesDaSala,
  lerSala,
  pastaDaSala,
} from '../../src/main/fabrica/sala'

const FIXTURE = join(__dirname, '..', 'fixtures', 'fabrica', 'sala')
const FIXTURE_F3 = join(__dirname, '..', 'fixtures', 'fabrica', 'f3')
const estadoDaF3 = (): EstadoDaFabrica =>
  parseEstado(readFileSync(join(FIXTURE_F3, 'estado.json'), 'utf8'))
const estadoDaFixture = (): EstadoDaFabrica =>
  parseEstado(readFileSync(join(FIXTURE, 'estado.json'), 'utf8'))
const FIXTURE_F2 = join(__dirname, '..', 'fixtures', 'fabrica', 'f2')
const estadoF2 = (): EstadoDaFabrica =>
  parseEstado(readFileSync(join(FIXTURE_F2, 'estado.json'), 'utf8'))
const RECURSOS: RecursosDaFabrica = {
  sessoes: { kind: 'ok', vivas: 1, teto: 3 },
  suite: { kind: 'livre' },
  disco: { kind: 'ok', livres: 50 * 1024 ** 3, minimo: 2 * 1024 ** 3 },
}
const CTX = {
  despachante: 'parado' as const,
  lidoEm: '2026-11-11T12:00:00.000Z',
  projeto: 'Operations Center · Project 2',
  pausa: null,
  recursos: RECURSOS,
  worktrees: [] as readonly string[],
  vivos: null as ReadonlySet<string> | null,
}
const FONTES = { recursos: () => RECURSOS, worktrees: () => [] as string[] }

describe('tipo e estação (F1.5)', () => {
  it('estacaoDoComando: as sete skills e um comando qualquer', () => {
    expect(
      [
        '/gm-triage #1',
        '/gm-card #1',
        '/gm-spec #1',
        '/gm-plan-tasks pasta',
        '/gm-implement pasta',
        '/gm-ship pasta',
        '/gm-correcao #1',
        'yarn lint',
        '',
      ].map(estacaoDoComando),
    ).toEqual([
      'entrada',
      'card',
      'spec',
      'tasks',
      'implementacao',
      'revisao',
      'implementacao',
      null,
      null,
    ])
    expect(estacaoDoComando('/gm-constructor')).toBeNull()
  })

  it('a sala da F1 segue toda pergunta (Q16) e preenche a estação', () => {
    const sala = montarSala(estadoDaFixture(), CTX)
    expect([...sala.abertos, ...sala.fechados].every((i) => i.tipo === 'pergunta')).toBe(true)
    expect(sala.emVoo.map((d) => d.estacao)).toEqual(
      sala.emVoo.map((d) => estacaoDoComando(d.comando)),
    )
  })
})

describe('tipoDoItem: Decisão só pelo parecer do G4 sem bloqueante (#143, CA-2)', () => {
  const item = (motivo: string, card = 1): ItemDaFila => ({
    id: 'q-0001',
    card,
    motivo,
    despacho: 'd-0001',
    sessaoClaude: null,
    criadoEm: '2026-11-11T09:00:00.000Z',
    fechadoEm: null,
    resolucao: null,
  })
  const origem = (comando: string, desfecho: Desfecho | null, card = 1): Despacho => ({
    id: 'd-0001',
    frente: 'fr-0001',
    card,
    comando,
    nota: null,
    estado: 'concluido',
    pid: null,
    criadoEm: '2026-11-11T09:00:00.000Z',
    lancadoEm: null,
    concluidoEm: null,
    sessaoClaude: null,
    desfecho,
  })
  const COM_PR = 'PR #970 aberta na dev (Card: #962); o merge é da orquestradora'
  const URL = 'https://github.com/leonardo-amaral-3/operations-center/pull'
  const SEM = `G4 da PR #9: sem bloqueante · parecer ${URL}/9#issuecomment-5`
  const DOIS = `G4 da PR #9: 2 bloqueantes · parecer ${URL}/9#issuecomment-5`

  it.each([
    [
      '/g4 com parecer sem bloqueante',
      origem('/g4 #1 PR #9', { tipo: 'parada', motivo: SEM }),
      SEM,
      'decisao',
    ],
    [
      '/g4 com 2 bloqueantes',
      origem('/g4 #1 PR #9', { tipo: 'parada', motivo: DOIS }),
      DOIS,
      'pergunta',
    ],
    [
      '/g4 com parecer de outro PR',
      origem('/g4 #1 PR #8', { tipo: 'parada', motivo: SEM }),
      SEM,
      'pergunta',
    ],
    [
      '/g4 com PARADA fora do contrato',
      origem('/g4 #1 PR #9', { tipo: 'parada', motivo: 'não rodou: sem acesso' }),
      'não rodou: sem acesso',
      'pergunta',
    ],
    ['/g4 com falha', origem('/g4 #1 PR #9', { tipo: 'falha', motivo: SEM }), SEM, 'pergunta'],
    [
      '/g4 com proximo',
      origem('/g4 #1 PR #9', { tipo: 'proximo', comando: '/gm-release' }),
      SEM,
      'pergunta',
    ],
    ['/g4 sem desfecho', origem('/g4 #1 PR #9', null), SEM, 'pergunta'],
    [
      '/gm-ship parada com PR (a regra antiga)',
      origem('/gm-ship /x', { tipo: 'parada', motivo: COM_PR }),
      COM_PR,
      'pergunta',
    ],
    [
      '/gm-spec parada citando PR',
      origem('/gm-spec #1', { tipo: 'parada', motivo: COM_PR }),
      COM_PR,
      'pergunta',
    ],
  ] as const)('%s → %s', (_nome, o, motivo, esperado) => {
    expect(tipoDoItem(item(motivo), o)).toBe(esperado)
  })

  it('origem /g4 #5 PR #9 num item do card 7 → pergunta', () => {
    expect(
      tipoDoItem(item(SEM, 7), origem('/g4 #5 PR #9', { tipo: 'parada', motivo: SEM }, 7)),
    ).toBe('pergunta')
  })

  it('despacho de card diferente do comando /g4 → pergunta', () => {
    expect(
      tipoDoItem(item(SEM, 1), origem('/g4 #1 PR #9', { tipo: 'parada', motivo: SEM }, 2)),
    ).toBe('pergunta')
  })

  it('origem ausente → pergunta', () => {
    expect(tipoDoItem(item(SEM), undefined)).toBe('pergunta')
  })

  it('ship histórico (q-0010, d-0009) → pergunta, e a PR segue a 128', () => {
    const motivo = 'PR #128 aberta na dev (Card: #126); o merge é da orquestradora'
    const e: EstadoDaFabrica = {
      ...estadoDaF3(),
      despachos: [
        origem('/gm-ship /home/leo/pessoal/planning/118-fabrica-agentica fase P3b (#126)', {
          tipo: 'parada',
          motivo,
        }),
      ].map((d) => ({ ...d, id: 'd-0009' })),
      fila: [{ ...item(motivo), id: 'q-0010', card: 126, despacho: 'd-0009' }],
    }
    expect(tipoDoItem(e.fila[0]!, e.despachos[0])).toBe('pergunta')
    const p = montarPergunta(e, 'q-0010', null)
    expect(p?.item.tipo).toBe('pergunta')
    expect(p?.pr).toBeNull()
  })
})

describe('ondeRodaOComando e o passo do ship para o G4 (#143)', () => {
  it('o /g4 roda sem worktree; os demais seguem a estação', () => {
    expect(ondeRodaOComando('/g4 #7 PR #9', 7, ['operations-center-7-x'])).toBe('sem worktree')
    expect(ondeRodaOComando('/gm-ship /x #7', 7, ['operations-center-7-x'])).toBe(
      'operations-center-7-x',
    )
    expect(ondeRodaOComando('/gm-spec #7', 7, [])).toBe('planning/')
  })

  it('montarDecisoes mostra o ship concluído em PARADA, sem item, como passou → g4', () => {
    const e: EstadoDaFabrica = {
      ...estadoDaF3(),
      despachos: estadoDaF3().despachos.filter((d) => d.id === 'd-0010'),
      fila: [],
    }
    const passo = montarDecisoes(e).find((x) => x.tipo === 'passou')
    expect(passo).toMatchObject({ tipo: 'passou', id: 'd-0010', skill: 'gm-ship', seguinte: 'g4' })
  })

  it('PARADA de outra skill, ou com item na fila, não vira passo', () => {
    const e = estadoDaF3()
    const passos = montarDecisoes({
      ...e,
      despachos: e.despachos.filter((d) => d.id === 'd-0005' || d.id === 'd-0002'),
    }).filter((x) => x.tipo === 'passou')
    expect(passos).toEqual([])
  })
})

describe('prDoMotivo e urlDaPr', () => {
  it.each([
    ['PR #970 aberta', 970],
    ['aberta (PR #12)', 12],
    ['PR #0', null],
    ['PRs #3', null],
    ['sem pr', null],
    ['PR #7 e PR #9', 7],
  ])('%j → %j', (motivo, esperado) => {
    expect(prDoMotivo(motivo)).toBe(esperado)
  })

  it('urlDaPr aponta para a PR no repositório da fábrica', () => {
    expect(urlDaPr(970)).toBe('https://github.com/leonardo-amaral-3/operations-center/pull/970')
  })
})

describe('a estação e a sessão quebrada dos itens (F2.2)', () => {
  const sala = montarSala(estadoF2(), CTX)
  const item = (id: string) => sala.abertos.find((i) => i.id === id)

  it('estacao vem do comando do despacho de origem', () => {
    expect(item('q-0013')?.estacao).toBe('entrada')
    expect(item('q-0016')?.estacao).toBe('implementacao')
    expect(item('q-0022')?.estacao).toBe('revisao')
  })

  it('sem despacho de origem: estacao null e não quebrada', () => {
    const s = montarSala({ ...estadoF2(), despachos: [] }, CTX)
    expect(s.abertos.every((i) => i.estacao === null && !i.sessaoQuebrada)).toBe(true)
  })

  it('sessaoQuebrada só com desfecho falha', () => {
    expect(sala.abertos.map((i) => [i.id, i.sessaoQuebrada])).toEqual([
      ['q-0013', false],
      ['q-0016', true],
      ['q-0022', false],
    ])
  })
})

describe('ondeRodaDo (F2.2)', () => {
  const wt = ['operations-center-119-c', 'operations-center-119-a', 'operations-center-119-b']
  it('spec e tasks rodam em planning/', () => {
    expect(ondeRodaDo('spec', 4, wt)).toBe('planning/')
    expect(ondeRodaDo('tasks', 4, wt)).toBe('planning/')
  })
  it.each(['implementacao', 'revisao'] as const)('%s: 0, 1 e 3 worktrees', (e) => {
    expect(ondeRodaDo(e, 119, [])).toBe('worktree ainda não criada')
    expect(ondeRodaDo(e, 119, ['operations-center-119-a'])).toBe('operations-center-119-a')
    expect(ondeRodaDo(e, 119, wt)).toBe('operations-center-119-a +2')
  })
  it('não casa o prefixo de outro card (1190 não é 119)', () => {
    expect(ondeRodaDo('implementacao', 119, ['operations-center-1190-x'])).toBe(
      'worktree ainda não criada',
    )
  })
  it.each(['entrada', 'card', 'integracao', null] as const)('%s: sem worktree', (e) => {
    expect(ondeRodaDo(e, 119, wt)).toBe('sem worktree')
  })
})

describe('viva e ondeRoda no retrato (F2.2)', () => {
  const vivas = (vivos: ReadonlySet<string> | null) =>
    Object.fromEntries(montarSala(estadoF2(), { ...CTX, vivos }).emVoo.map((d) => [d.id, d.viva]))

  it('pendente → null; vivos null → null', () => {
    expect(vivas(null)).toEqual({ 'd-0004': null, 'd-0006': null, 'd-0008': null, 'd-0010': null })
  })
  it('no conjunto → true; fora → false; pendente segue null', () => {
    expect(vivas(new Set(['d-0004', 'd-0010']))).toEqual({
      'd-0004': true,
      'd-0006': false,
      'd-0008': null,
      'd-0010': true,
    })
  })
  it('ondeRoda de cada despacho da fixture f2', () => {
    const s = montarSala(estadoF2(), CTX)
    expect(Object.fromEntries(s.emVoo.map((d) => [d.id, d.ondeRoda]))).toEqual({
      'd-0004': 'worktree ainda não criada',
      'd-0006': 'planning/',
      'd-0008': 'sem worktree',
      'd-0010': 'worktree ainda não criada',
    })
  })
})

describe('montarDecisoes (F2.2)', () => {
  const ordem = (e: EstadoDaFabrica): string[] => montarDecisoes(e).map((d) => d.id)

  it('a fixture f2 dá os seis itens, nesta ordem', () => {
    expect(ordem(estadoF2())).toEqual(['d-0003', 'q-0022', 'd-0002', 'q-0016', 'q-0013', 'q-0019'])
    const d = montarDecisoes(estadoF2())
    expect(d[0]).toEqual({
      tipo: 'passou',
      id: 'd-0003',
      card: 1,
      skill: 'gm-plan-tasks',
      seguinte: 'gm-implement',
      em: '2026-11-11T09:20:00.000Z',
    })
    expect(d[5]).toMatchObject({ tipo: 'fila', item: { resolucao: 'seguir sem segundo revisor' } })
  })

  it('PROXIMO recusado (com item da fila) não vira passou', () => {
    const e = estadoF2()
    const fila = [
      ...e.fila,
      {
        id: 'q-0030',
        card: 1,
        motivo: 'recusado',
        despacho: 'd-0002',
        sessaoClaude: null,
        criadoEm: '2026-11-11T09:11:00.000Z',
        fechadoEm: null,
        resolucao: null,
      },
    ]
    const d = montarDecisoes({ ...e, fila })
    expect(d.some((x) => x.tipo === 'passou' && x.id === 'd-0002')).toBe(false)
    expect(d.some((x) => x.tipo === 'fila' && x.id === 'q-0030')).toBe(true)
  })

  it('empate de em → id decrescente', () => {
    const e = estadoF2()
    const igual = '2026-11-11T10:00:00.000Z'
    const despachos = e.despachos.map((d) =>
      d.id === 'd-0002' || d.id === 'd-0003' ? { ...d, concluidoEm: igual } : d,
    )
    const d = montarDecisoes({ ...e, despachos, fila: [] })
    // sem fila, o ship d-0021 (PARADA, sem item) também é passo: o G4 nasceu dele (#143)
    expect(d.map((x) => x.id)).toEqual(['d-0003', 'd-0002', 'd-0021'])
  })

  it('12 passos → só os 8 mais recentes', () => {
    const e = estadoF2()
    const despachos = Array.from({ length: 12 }, (_, i) => ({
      ...e.despachos[0]!,
      id: `d-${String(100 + i)}`,
      concluidoEm: `2026-11-12T${String(i).padStart(2, '0')}:00:00.000Z`,
    }))
    const d = montarDecisoes({ ...e, despachos, fila: [] })
    expect(PASSOS_NA_SALA).toBe(8)
    expect(d).toHaveLength(8)
    expect(d[0]?.id).toBe('d-111')
    expect(d[7]?.id).toBe('d-104')
  })

  it('12 fechados → só os 10 de fechadoEm mais recente; todo aberto sempre entra', () => {
    const e = estadoF2()
    const extras: ItemDaFila[] = Array.from({ length: 12 }, (_, i) => ({
      id: `q-${String(100 + i)}`,
      card: 953,
      motivo: 'm',
      despacho: 'd-0015',
      sessaoClaude: null,
      criadoEm: `2026-11-10T09:${String(i).padStart(2, '0')}:00.000Z`,
      fechadoEm: `2026-11-11T12:${String(i).padStart(2, '0')}:00.000Z`,
      resolucao: 'ok',
    }))
    const d = montarDecisoes({ ...e, despachos: [], fila: [...e.fila, ...extras] })
    const fechados = d.filter((x) => x.tipo === 'fila' && x.item.fechadoEm !== null)
    expect(fechados).toHaveLength(10)
    expect(fechados.map((x) => x.id)).not.toContain('q-100')
    expect(d.filter((x) => x.tipo === 'fila' && x.item.fechadoEm === null)).toHaveLength(3)
  })

  it('montarSala leva recursos e decisoes', () => {
    const s = montarSala(estadoF2(), CTX)
    expect(s.recursos).toEqual(RECURSOS)
    expect(s.decisoes.map((d) => d.id)).toEqual(ordem(estadoF2()))
  })
})

describe('montarSala sobre a fixture', () => {
  const sala = montarSala(estadoDaFixture(), CTX)

  it('abertos por criação, com o comando do despacho de origem', () => {
    expect(sala.abertos.map((i) => i.id)).toEqual(['q-0003', 'q-0006'])
    expect(sala.abertos.map((i) => i.comando)).toEqual(['/gm-spec #900', '/gm-card #901'])
  })

  it('fechados, em voo e frentes abertas', () => {
    expect(sala.fechados.map((i) => i.id)).toEqual(['q-0009'])
    expect(sala.emVoo.map((d) => [d.id, d.estado])).toEqual([
      ['d-0011', 'rodando'],
      ['d-0014', 'pendente'],
    ])
    expect(sala.frentesAbertas).toBe(2)
    expect(sala.despachante).toBe('parado')
  })

  it('o ctx novo (projeto e pausa) vai inteiro para o retrato', () => {
    const pausada = montarSala(estadoDaFixture(), {
      ...CTX,
      pausa: { desde: '2026-11-11T11:00:00Z' },
    })
    expect(pausada.projeto).toBe('Operations Center · Project 2')
    expect(pausada.pausa).toEqual({ desde: '2026-11-11T11:00:00Z' })
    expect(sala.pausa).toBeNull()
  })

  it('cardUrl aponta para o card no repositório da fábrica', () => {
    expect(sala.abertos[0]?.cardUrl).toBe(
      'https://github.com/leonardo-amaral-3/operations-center/issues/900',
    )
    expect(urlDoCard(900)).toBe(sala.abertos[0]?.cardUrl)
  })

  it('com 12 fechados mostra 10, do fechamento mais recente', () => {
    const e = estadoDaFixture()
    const extras: ItemDaFila[] = Array.from({ length: 12 }, (_, i) => ({
      id: `q-${String(100 + i)}`,
      card: 900,
      motivo: 'm',
      despacho: 'd-0002',
      sessaoClaude: null,
      criadoEm: '2026-11-11T09:00:00.000Z',
      fechadoEm: `2026-11-11T12:${String(i).padStart(2, '0')}:00.000Z`,
      resolucao: 'ok',
    }))
    const s = montarSala({ ...e, fila: [...e.fila, ...extras] }, CTX)
    expect(s.fechados).toHaveLength(10)
    expect(s.fechados[0]?.id).toBe('q-111')
    expect(s.fechados[9]?.id).toBe('q-102')
  })

  it('despacho fora do estado → comando null', () => {
    const e = estadoDaFixture()
    const s = montarSala({ ...e, despachos: [] }, CTX)
    expect(s.abertos.every((i) => i.comando === null)).toBe(true)
  })
})

describe('montarPergunta', () => {
  const e = estadoDaFixture()
  const saida = readFileSync(join(FIXTURE, 'sessoes', 'd-0002', 'saida.json'), 'utf8')

  it('devolve o result inteiro e o comando de fechar', () => {
    const p = montarPergunta(e, 'q-0003', saida)
    expect(p?.resultado).toContain('Feito o desenho.')
    expect(p?.resultado?.endsWith('PARADA: o nome do campo é escolha de produto')).toBe(true)
    expect(p?.fechar).toBe('yarn fabrica fechar q-0003 "<resolução>"')
    expect(p?.item.id).toBe('q-0003')
  })

  it.each([null, '', '{', '[]', '{"result":"  "}', '{"result":1}'])(
    'saída %j → resultado null',
    (s) => {
      expect(montarPergunta(e, 'q-0003', s)?.resultado).toBeNull()
    },
  )

  it('id desconhecido → null', () => {
    expect(montarPergunta(e, 'q-9999', saida)).toBeNull()
  })
})

describe('a fixture f3 (F3.7)', () => {
  const sala = montarSala(estadoDaF3(), CTX)

  it('montarSala: os tipos e a ordem do esperado F3', () => {
    expect(sala.abertos.map((i) => [i.id, i.card, i.tipo])).toEqual([
      ['q-0009', 961, 'pergunta'],
      ['q-0013', 962, 'decisao'],
      ['q-0016', 963, 'pergunta'],
      ['q-0017', 964, 'decisao'],
    ])
    expect(sala.fechados.map((i) => [i.id, i.tipo])).toEqual([['q-0003', 'pergunta']])
  })

  it('montarPergunta do q-0013: parada, PR 970 e os quatro passos', () => {
    const p = montarPergunta(estadoDaF3(), 'q-0013', null)
    expect(p?.fim).toBe('parada')
    expect(p?.pr).toBe(970)
    expect(p?.prUrl).toBe(urlDaPr(970))
    expect(p?.passos).toEqual([
      {
        despacho: 'd-0007',
        skill: 'gm-plan-tasks',
        comando: '/gm-plan-tasks /home/u/pessoal/planning/962-fila',
        fim: 'proximo',
        detalhe: '/gm-implement /home/u/pessoal/planning/962-fila',
        em: '2026-11-11T08:20:00.000Z',
      },
      {
        despacho: 'd-0008',
        skill: 'gm-implement',
        comando: '/gm-implement /home/u/pessoal/planning/962-fila',
        fim: 'proximo',
        detalhe: '/gm-ship /home/u/pessoal/planning/962-fila',
        em: '2026-11-11T08:45:00.000Z',
      },
      {
        despacho: 'd-0010',
        skill: 'gm-ship',
        comando: '/gm-ship /home/u/pessoal/planning/962-fila',
        fim: 'parada',
        detalhe: 'PR #970 aberta na dev (Card: #962); o merge é da orquestradora',
        em: '2026-11-11T09:00:00.000Z',
      },
      {
        despacho: 'd-0018',
        skill: 'g4',
        comando: '/g4 #962 PR #970',
        fim: 'parada',
        detalhe:
          'G4 da PR #970: sem bloqueante · parecer https://github.com/leonardo-amaral-3/operations-center/pull/970#issuecomment-1',
        em: '2026-11-11T09:04:00.000Z',
      },
    ])
  })

  it('montarPergunta do q-0009: pergunta, sem PR, um passo', () => {
    const p = montarPergunta(estadoDaF3(), 'q-0009', null)
    expect(p?.item.tipo).toBe('pergunta')
    expect(p?.pr).toBeNull()
    expect(p?.prUrl).toBeNull()
    expect(p?.fim).toBe('parada')
    expect(p?.passos.map((x) => x.despacho)).toEqual(['d-0005'])
  })

  it('origem fora do estado → fim null e passos vazios', () => {
    const p = montarPergunta({ ...estadoDaF3(), despachos: [] }, 'q-0009', null)
    expect(p?.fim).toBeNull()
    expect(p?.passos).toEqual([])
  })

  it('despacho sem desfecho na frente → fim, detalhe e em null', () => {
    const e = estadoDaF3()
    const despachos = e.despachos.map((d) =>
      d.id === 'd-0018' ? { ...d, desfecho: null, concluidoEm: null } : d,
    )
    const p = montarPergunta({ ...e, despachos }, 'q-0013', null)
    expect(p?.fim).toBeNull()
    expect(p?.item.tipo).toBe('pergunta')
    expect(p?.passos.at(-1)).toMatchObject({
      despacho: 'd-0018',
      fim: null,
      detalhe: null,
      em: null,
    })
  })

  describe('lerPergunta numa cópia da f3', () => {
    let pasta = ''
    afterEach(() => rmSync(pasta, { recursive: true, force: true }))
    it('q-0009 traz o resultado do saida.json; q-0016 não tem', () => {
      pasta = mkdtempSync(join(__dirname, '..', '..', 'node_modules', '.oc-fabrica-teste-'))
      cpSync(FIXTURE_F3, pasta, { recursive: true })
      expect(lerPergunta(pasta, 'q-0009')?.resultado).toContain('A spec do #961 está escrita')
      expect(lerPergunta(pasta, 'q-0016')?.resultado).toBeNull()
      expect(lerPergunta(pasta, 'q-0013')?.pr).toBe(970)
    })
  })
})

describe('a leitura da sala', () => {
  const pastas: string[] = []
  const nova = (): string => {
    const p = mkdtempSync(join(tmpdir(), 'oc-sala-'))
    pastas.push(p)
    return p
  }
  afterEach(() => {
    for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
  })
  const agora = (): string => '2026-11-11T12:00:00.000Z'

  it('sem estado.json → sem-estado', () => {
    expect(lerSala(nova(), 'linux', agora, FONTES)).toEqual({
      kind: 'sem-estado',
      lidoEm: agora(),
      projeto: 'Operations Center · Project 2',
      despachante: 'parado',
      pausa: null,
      recursos: RECURSOS,
    })
  })

  describe('a pausa, nos três ramos (F1.5)', () => {
    const comPausa = (conteudo: string | null, estado: 'nenhum' | 'torto' | 'fixture'): string => {
      const p = nova()
      if (estado === 'torto') writeFileSync(join(p, 'estado.json'), '{')
      if (estado === 'fixture') cpSync(FIXTURE, p, { recursive: true })
      if (conteudo !== null) writeFileSync(join(p, 'pausa.json'), conteudo)
      return p
    }
    it.each([
      ['sem-estado', 'nenhum'],
      ['ilegivel', 'torto'],
      ['ok', 'fixture'],
    ] as const)('ramo %s: sem pausa.json → pausa null, e o projeto vem junto', (kind, estado) => {
      const s = lerSala(comPausa(null, estado), 'linux', agora, FONTES)
      expect(s.kind).toBe(kind)
      expect(s.pausa).toBeNull()
      expect(s.projeto).toBe('Operations Center · Project 2')
      expect(s.despachante).toBe('parado')
    })
    it.each([
      ['sem-estado', 'nenhum'],
      ['ilegivel', 'torto'],
      ['ok', 'fixture'],
    ] as const)('ramo %s: com pausa.json → a data dela', (kind, estado) => {
      const s = lerSala(
        comPausa('{"desde":"2026-11-11T11:00:00Z"}\n', estado),
        'linux',
        agora,
        FONTES,
      )
      expect(s.kind).toBe(kind)
      expect(s.pausa).toEqual({ desde: '2026-11-11T11:00:00Z' })
    })
    it.each([
      ['sem-estado', 'nenhum'],
      ['ilegivel', 'torto'],
      ['ok', 'fixture'],
    ] as const)('ramo %s: pausa.json torto → desde null (na dúvida, pausada)', (kind, estado) => {
      const s = lerSala(comPausa('{torto', estado), 'linux', agora, FONTES)
      expect(s.kind).toBe(kind)
      expect(s.pausa).toEqual({ desde: null })
    })
  })

  it('recursos que lança → os três sem-leitura, nos três ramos', () => {
    const fontes = {
      recursos: (): RecursosDaFabrica => {
        throw new Error('sem /proc')
      },
      worktrees: () => [] as string[],
    }
    const esperado = {
      sessoes: { kind: 'sem-leitura', motivo: 'sem /proc', teto: 3 },
      suite: { kind: 'sem-leitura', motivo: 'sem /proc' },
      disco: { kind: 'sem-leitura', motivo: 'sem /proc' },
    }
    const torto = nova()
    writeFileSync(join(torto, 'estado.json'), '{')
    const boa = nova()
    cpSync(FIXTURE, boa, { recursive: true })
    for (const pasta of [nova(), torto, boa]) {
      expect(lerSala(pasta, 'linux', agora, fontes).recursos).toEqual(esperado)
    }
  })

  it('worktrees que lança → o retrato sai, com "worktree ainda não criada"', () => {
    const p = nova()
    cpSync(FIXTURE_F2, p, { recursive: true })
    const s = lerSala(p, 'linux', agora, {
      recursos: () => RECURSOS,
      worktrees: () => {
        throw new Error('x')
      },
    })
    expect(s.kind).toBe('ok')
  })

  it('despachos cuja sessão não existe em /proc → viva false; fora do Linux → null', () => {
    const p = nova()
    cpSync(FIXTURE_F2, p, { recursive: true })
    const linux = lerSala(p, 'linux', agora, FONTES)
    const outro = lerSala(p, 'win32', agora, FONTES)
    if (linux.kind !== 'ok' || outro.kind !== 'ok') throw new Error('esperava ok')
    expect(linux.emVoo.map((d) => d.viva)).toEqual([false, false, null, false])
    expect(outro.emVoo.map((d) => d.viva)).toEqual([null, null, null, null])
  })

  it('estado torto → ilegivel com a mensagem do parseEstado', () => {
    const p = nova()
    writeFileSync(join(p, 'estado.json'), '{')
    const s = lerSala(p, 'linux', agora, FONTES)
    expect(s.kind).toBe('ilegivel')
    if (s.kind === 'ilegivel') expect(s.erro.startsWith('estado.json ilegível')).toBe(true)
  })

  it('item torto que derruba o montarSala também vira ilegivel', () => {
    const p = nova()
    const e = estadoDaFixture()
    writeFileSync(join(p, 'estado.json'), JSON.stringify({ ...e, fila: [null] }))
    expect(lerSala(p, 'linux', agora, FONTES).kind).toBe('ilegivel')
  })

  it('a fixture copiada → ok, e a pergunta lê a saída da sessão', () => {
    const p = nova()
    cpSync(FIXTURE, p, { recursive: true })
    expect(lerSala(p, 'linux', agora, FONTES).kind).toBe('ok')
    expect(lerPergunta(p, 'q-0003')?.resultado).toContain('Feito o desenho.')
    // saída vazia (0 byte) → sem resultado, mas a pergunta existe
    expect(lerPergunta(p, 'q-0006')?.resultado).toBeNull()
  })

  it('despacho torto no estado não vira caminho: a pergunta existe, sem resultado', () => {
    const p = nova()
    cpSync(FIXTURE, p, { recursive: true })
    const e = estadoDaFixture()
    const fila = e.fila.map((i) => (i.id === 'q-0003' ? { ...i, despacho: '../../x' } : i))
    writeFileSync(join(p, 'estado.json'), JSON.stringify({ ...e, fila }))
    expect(lerPergunta(p, 'q-0003')?.resultado).toBeNull()
  })

  it('id que não é q-<n> ou não existe → null', () => {
    const p = nova()
    cpSync(FIXTURE, p, { recursive: true })
    expect(lerPergunta(p, '../x')).toBeNull()
    expect(lerPergunta(p, 'q-9999')).toBeNull()
    expect(lerPergunta(nova(), 'q-0003')).toBeNull()
  })

  describe.skipIf(process.platform !== 'linux')('estadoDoDespachante', () => {
    const comPid = (conteudo: string): string => {
      const p = nova()
      writeFileSync(join(p, 'rodar.pid'), conteudo)
      return p
    }

    it('sem rodar.pid → parado', () => {
      expect(estadoDoDespachante(nova(), 'linux')).toBe('parado')
    })

    it('com a identidade deste processo → rodando', () => {
      const id = identidade(process.pid)
      expect(id).not.toBeNull()
      expect(estadoDoDespachante(comPid(id ?? ''), 'linux')).toBe('rodando')
    })

    it('com um pid já terminado → parado', () => {
      const r = spawnSync('true')
      expect(r.pid).toBeGreaterThan(0)
      expect(estadoDoDespachante(comPid(`${String(r.pid)} 1`), 'linux')).toBe('parado')
    })

    it('com conteúdo que não é pid → desconhecido', () => {
      expect(estadoDoDespachante(comPid('abc'), 'linux')).toBe('desconhecido')
    })

    it('rodar.pid ilegível (é uma pasta) → desconhecido', () => {
      const p = nova()
      mkdirSync(join(p, 'rodar.pid'))
      expect(estadoDoDespachante(p, 'linux')).toBe('desconhecido')
    })
  })

  it('fora do Linux → desconhecido', () => {
    expect(estadoDoDespachante(nova(), 'win32')).toBe('desconhecido')
  })
})

describe('pastaDaSala', () => {
  it('o default é a pasta-irmã do checkout do workspace', () => {
    expect(pastaDaSala({}, '/h')).toBe('/h/pessoal/claude/despachos-fabrica')
  })
  it('OC_FABRICA_DIR manda', () => {
    expect(pastaDaSala({ OC_FABRICA_DIR: '/x/y' }, '/h')).toBe('/x/y')
  })
})

describe('a sala só lê', () => {
  // O app escreve na pasta da fábrica só pelo `executar` do canal de comando (`comando.ts`), que passa
  // pelo cadeado do estado.json (spec P3 §A3, CA-3a.3; F3). O `sala.ts` continua sem porta de
  // escrita: o teste procura no texto inteiro, comentário incluído.
  const PROIBIDOS = [
    'alterarEstado',
    'gravarEstado',
    'alterarEntrada',
    'gravarEntrada',
    'acrescentarRevisao',
    'criarCadeado',
    'tomarSeMorto',
    'tomarRodar',
    'writeFile',
    'appendFile',
    'rename',
    'unlink',
    'mkdir',
    'rmSync',
    'linkSync',
    'copyFile',
    'openSync',
  ]
  // O `comando.ts` entra na mesma lista (#129): ele só chega à pasta pelo `executar` do CLI. O
  // `assumir.ts` (#133) também: ele grava a conversa do cartão no `conversations.json` do app, por
  // dependência injetada, e não nomeia porta de escrita da pasta da fábrica. O `mandatoNaSala.ts`
  // (#134) também: só lê o mandato da `dev`. As revisões são escritas só pelo `revisoes.ts`, chamado
  // pelo `executar` do CLI; o `lerRevisoesDaSala` do `sala.ts` só lê.
  it.each(['sala.ts', 'comando.ts', 'recursos.ts', 'assumir.ts', 'mandatoNaSala.ts'])(
    'src/main/fabrica/%s não nomeia nenhuma porta de escrita',
    (arquivo) => {
      const texto = readFileSync(
        join(__dirname, '..', '..', 'src', 'main', 'fabrica', arquivo),
        'utf8',
      )
      const achados = PROIBIDOS.filter((nome) => texto.includes(nome))
      expect(
        achados,
        `${arquivo} só chega à pasta da fábrica pelo \`executar\` (#122, CA-3a.3): ${achados.join(', ')} é porta de escrita. Fechar um item é do \`yarn fabrica fechar\`, que passa pelo cadeado do estado.json`,
      ).toEqual([])
    },
  )
})

describe('lerCardDaFabrica e lerEntradaDaSala (F4)', () => {
  const RAIZ = join(__dirname, '..', '..')
  const F4 = join(__dirname, '..', 'fixtures', 'fabrica', 'f4')
  const copias: string[] = []
  afterEach(() => {
    for (const c of copias.splice(0)) rmSync(c, { recursive: true, force: true })
  })
  function copiaDeF4(): string {
    const pasta = mkdtempSync(join(RAIZ, 'node_modules', '.oc-fabrica-teste-'))
    copias.push(pasta)
    // Antes de qualquer escrita: a pasta de teste nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    cpSync(F4, pasta, { recursive: true })
    return pasta
  }
  const card = (pasta: string, n: number) => lerCardDaFabrica(pasta, n, 'linux', FONTES)

  it('#4 ok sem resultado; #906 com o result; #1 sem-despacho', () => {
    const pasta = copiaDeF4()
    const quatro = card(pasta, 4)
    expect(quatro.kind === 'ok' ? quatro.resultado : 'x').toBeNull()
    expect(quatro.kind === 'ok' ? quatro.viva : 'x').toBe(false) // o pid 999999 não existe
    const nove = card(pasta, 906)
    expect(nove.kind === 'ok' ? nove.resultado : '').toContain('Portão local')
    expect(card(pasta, 1).kind).toBe('sem-despacho')
  })

  it('sem estado.json → sem-estado; estado.json torto → ilegivel', () => {
    const pasta = copiaDeF4()
    writeFileSync(join(pasta, 'entrada.json'), '{}') // não importa para o card
    rmSync(join(pasta, 'estado.json'))
    expect(card(pasta, 4)).toMatchObject({ kind: 'sem-estado', card: 4 })
    writeFileSync(join(pasta, 'estado.json'), '{torto')
    const torto = card(pasta, 4)
    expect(torto.kind).toBe('ilegivel')
    expect(torto.card).toBe(4)
  })

  it('o id torto do atual não vira nome de pasta: a saída não é lida', () => {
    const pasta = copiaDeF4()
    const caminho = join(pasta, 'estado.json')
    const e = JSON.parse(readFileSync(caminho, 'utf8')) as { despachos: Array<{ id: string }> }
    for (const d of e.despachos) if (d.id === 'd-0007') d.id = '../../x'
    writeFileSync(caminho, JSON.stringify(e))
    const c = card(pasta, 906)
    expect(c.kind === 'ok' ? c.resultado : 'x').toBeNull()
  })

  it('lerEntradaDaSala: a cópia de f4, sem arquivo e com arquivo torto', () => {
    const pasta = copiaDeF4()
    const ok = lerEntradaDaSala(pasta)
    expect(ok.kind === 'ok' ? ok.itens.map((i) => i.id) : []).toEqual([
      'e-0003',
      'e-0002',
      'e-0001',
    ])
    expect(ok.kind === 'ok' ? ok.total : 0).toBe(3)
    rmSync(join(pasta, 'entrada.json'))
    expect(lerEntradaDaSala(pasta)).toEqual({ kind: 'ok', itens: [], total: 0 })
    writeFileSync(join(pasta, 'entrada.json'), '{torto')
    expect(lerEntradaDaSala(pasta).kind).toBe('ilegivel')
  })
})

describe('lerRevisoesDaSala (F5)', () => {
  const RAIZ = join(__dirname, '..', '..')
  const F5 = join(__dirname, '..', 'fixtures', 'fabrica', 'f5')
  const copias: string[] = []
  afterEach(() => {
    for (const c of copias.splice(0)) rmSync(c, { recursive: true, force: true })
  })
  function pastaDeTeste(): string {
    const pasta = mkdtempSync(join(RAIZ, 'node_modules', '.oc-fabrica-teste-'))
    copias.push(pasta)
    // Antes de qualquer escrita: a pasta de teste nunca é a real.
    expect(pasta).toContain('/node_modules/.oc-fabrica-teste-')
    return pasta
  }

  it('sem revisoes.jsonl: ok e vazio', () => {
    expect(lerRevisoesDaSala(pastaDeTeste())).toEqual({ kind: 'ok', revisoes: [], ilegiveis: 0 })
  })

  it('com a fixture f5: a revisão confirmada', () => {
    expect(lerRevisoesDaSala(F5)).toEqual({
      kind: 'ok',
      revisoes: [
        {
          arquivo: '2026-11-10-a-sala-le-o-mandato-pela-graphql.md',
          veredito: 'confirmada',
          em: '2026-11-10T21:00:00.000Z',
          motivo: null,
          atendida: null,
        },
      ],
      ilegiveis: 0,
    })
  })

  it('com uma linha torta: ilegiveis 1, e as boas continuam', () => {
    const pasta = pastaDeTeste()
    cpSync(F5, pasta, { recursive: true })
    writeFileSync(
      join(pasta, 'revisoes.jsonl'),
      `${readFileSync(join(F5, 'revisoes.jsonl'), 'utf8')}{torta\n`,
    )
    const r = lerRevisoesDaSala(pasta)
    expect(r).toMatchObject({ kind: 'ok', ilegiveis: 1 })
    expect(r.kind === 'ok' ? r.revisoes : []).toHaveLength(1)
  })

  it('com o arquivo como pasta: ilegivel, sem lançar', () => {
    const pasta = pastaDeTeste()
    mkdirSync(join(pasta, 'revisoes.jsonl'))
    expect(lerRevisoesDaSala(pasta).kind).toBe('ilegivel')
  })
})
