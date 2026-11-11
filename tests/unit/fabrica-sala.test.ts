import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseEstado } from '../../src/core/fabrica/estado'
import {
  estacaoDoComando,
  montarPergunta,
  montarSala,
  prDoMotivo,
  tipoDoItem,
  urlDaPr,
  urlDoCard,
} from '../../src/core/fabrica/sala'
import type { Desfecho, Despacho, EstadoDaFabrica, ItemDaFila } from '../../src/core/fabrica/tipos'
import { identidade } from '../../src/main/fabrica/arquivos'
import { estadoDoDespachante, lerPergunta, lerSala, pastaDaSala } from '../../src/main/fabrica/sala'

const FIXTURE = join(__dirname, '..', 'fixtures', 'fabrica', 'sala')
const FIXTURE_F3 = join(__dirname, '..', 'fixtures', 'fabrica', 'f3')
const estadoDaF3 = (): EstadoDaFabrica =>
  parseEstado(readFileSync(join(FIXTURE_F3, 'estado.json'), 'utf8'))
const estadoDaFixture = (): EstadoDaFabrica =>
  parseEstado(readFileSync(join(FIXTURE, 'estado.json'), 'utf8'))
const CTX = {
  despachante: 'parado',
  lidoEm: '2026-11-11T12:00:00.000Z',
  projeto: 'Operations Center · Project 2',
  pausa: null,
} as const

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

describe('tipoDoItem: Decisão só pela origem (F3, CA-3.4)', () => {
  const item = (motivo: string): ItemDaFila => ({
    id: 'q-0001',
    card: 1,
    motivo,
    despacho: 'd-0001',
    sessaoClaude: null,
    criadoEm: '2026-11-11T09:00:00.000Z',
    fechadoEm: null,
    resolucao: null,
  })
  const origem = (comando: string, desfecho: Desfecho | null): Despacho => ({
    id: 'd-0001',
    frente: 'fr-0001',
    card: 1,
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

  it.each([
    [
      '/gm-ship parada com PR',
      origem('/gm-ship /x', { tipo: 'parada', motivo: COM_PR }),
      COM_PR,
      'decisao',
    ],
    [
      '/gm-ship parada sem PR',
      origem('/gm-ship /x', { tipo: 'parada', motivo: 'sem pr' }),
      'sem pr',
      'pergunta',
    ],
    [
      '/gm-ship falha citando PR',
      origem('/gm-ship /x', { tipo: 'falha', motivo: COM_PR }),
      COM_PR,
      'pergunta',
    ],
    [
      '/gm-ship com proximo citando PR',
      origem('/gm-ship /x', { tipo: 'proximo', comando: '/gm-release' }),
      COM_PR,
      'pergunta',
    ],
    ['/gm-ship sem desfecho', origem('/gm-ship /x', null), COM_PR, 'pergunta'],
    [
      '/gm-spec parada citando PR',
      origem('/gm-spec #1', { tipo: 'parada', motivo: COM_PR }),
      COM_PR,
      'pergunta',
    ],
  ] as const)('%s → %s', (_nome, o, motivo, esperado) => {
    expect(tipoDoItem(item(motivo), o)).toBe(esperado)
  })

  it('origem fora do estado → pergunta', () => {
    expect(tipoDoItem(item(COM_PR), undefined)).toBe('pergunta')
  })

  it('o item real (q-0010, d-0009; valores da Q5, escritos aqui) é decisão e a PR é a 128', () => {
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
    expect(tipoDoItem(e.fila[0]!, e.despachos[0])).toBe('decisao')
    const p = montarPergunta(e, 'q-0010', null)
    expect(p?.item.tipo).toBe('decisao')
    expect(p?.pr).toBe(128)
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

  it('montarPergunta do q-0013: parada, PR 970 e os três passos', () => {
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
      d.id === 'd-0010' ? { ...d, desfecho: null, concluidoEm: null } : d,
    )
    const p = montarPergunta({ ...e, despachos }, 'q-0013', null)
    expect(p?.fim).toBeNull()
    expect(p?.item.tipo).toBe('pergunta')
    expect(p?.passos.at(-1)).toMatchObject({
      despacho: 'd-0010',
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
    expect(lerSala(nova(), 'linux', agora)).toEqual({
      kind: 'sem-estado',
      lidoEm: agora(),
      projeto: 'Operations Center · Project 2',
      despachante: 'parado',
      pausa: null,
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
      const s = lerSala(comPausa(null, estado), 'linux', agora)
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
      const s = lerSala(comPausa('{"desde":"2026-11-11T11:00:00Z"}\n', estado), 'linux', agora)
      expect(s.kind).toBe(kind)
      expect(s.pausa).toEqual({ desde: '2026-11-11T11:00:00Z' })
    })
    it.each([
      ['sem-estado', 'nenhum'],
      ['ilegivel', 'torto'],
      ['ok', 'fixture'],
    ] as const)('ramo %s: pausa.json torto → desde null (na dúvida, pausada)', (kind, estado) => {
      const s = lerSala(comPausa('{torto', estado), 'linux', agora)
      expect(s.kind).toBe(kind)
      expect(s.pausa).toEqual({ desde: null })
    })
  })

  it('estado torto → ilegivel com a mensagem do parseEstado', () => {
    const p = nova()
    writeFileSync(join(p, 'estado.json'), '{')
    const s = lerSala(p, 'linux', agora)
    expect(s.kind).toBe('ilegivel')
    if (s.kind === 'ilegivel') expect(s.erro.startsWith('estado.json ilegível')).toBe(true)
  })

  it('item torto que derruba o montarSala também vira ilegivel', () => {
    const p = nova()
    const e = estadoDaFixture()
    writeFileSync(join(p, 'estado.json'), JSON.stringify({ ...e, fila: [null] }))
    expect(lerSala(p, 'linux', agora).kind).toBe('ilegivel')
  })

  it('a fixture copiada → ok, e a pergunta lê a saída da sessão', () => {
    const p = nova()
    cpSync(FIXTURE, p, { recursive: true })
    expect(lerSala(p, 'linux', agora).kind).toBe('ok')
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
  // O `comando.ts` entra na mesma lista (#129): ele só chega à pasta pelo `executar` do CLI.
  it.each(['sala.ts', 'comando.ts'])(
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
