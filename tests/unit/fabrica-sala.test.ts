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
  tipoDoItem,
  urlDoCard,
} from '../../src/core/fabrica/sala'
import type { RecursosDaFabrica } from '../../src/shared/fabrica'
import type { EstadoDaFabrica, ItemDaFila } from '../../src/core/fabrica/tipos'
import { identidade } from '../../src/main/fabrica/arquivos'
import {
  estadoDoDespachante,
  lerCardDaFabrica,
  lerEntradaDaSala,
  lerPergunta,
  lerSala,
  pastaDaSala,
} from '../../src/main/fabrica/sala'

const FIXTURE = join(__dirname, '..', 'fixtures', 'fabrica', 'sala')
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

  it('tipoDoItem é sempre pergunta na F1, e a sala o preenche', () => {
    const e = estadoDaFixture()
    expect(e.fila.map(tipoDoItem).every((t) => t === 'pergunta')).toBe(true)
    const sala = montarSala(e, CTX)
    expect([...sala.abertos, ...sala.fechados].every((i) => i.tipo === 'pergunta')).toBe(true)
    expect(sala.emVoo.map((d) => d.estacao)).toEqual(
      sala.emVoo.map((d) => estacaoDoComando(d.comando)),
    )
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
    expect(d.map((x) => x.id)).toEqual(['d-0003', 'd-0002'])
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
  // O app não escreve na pasta da fábrica: fechar um item é `yarn fabrica fechar`, que passa pelo
  // cadeado do estado.json (spec P3 §A3, CA-3a.3). Por isso o arquivo da sala não pode nem citar uma
  // porta de escrita; o teste procura no texto inteiro, comentário incluído.
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
  it.each(['sala.ts', 'comando.ts', 'recursos.ts'])(
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
