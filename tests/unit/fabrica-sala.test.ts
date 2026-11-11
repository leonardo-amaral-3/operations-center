import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseEstado } from '../../src/core/fabrica/estado'
import { montarPergunta, montarSala, urlDoCard } from '../../src/core/fabrica/sala'
import type { EstadoDaFabrica, ItemDaFila } from '../../src/core/fabrica/tipos'
import { identidade } from '../../src/main/fabrica/arquivos'
import { estadoDoDespachante, lerPergunta, lerSala, pastaDaSala } from '../../src/main/fabrica/sala'

const FIXTURE = join(__dirname, '..', 'fixtures', 'fabrica', 'sala')
const estadoDaFixture = (): EstadoDaFabrica =>
  parseEstado(readFileSync(join(FIXTURE, 'estado.json'), 'utf8'))
const CTX = { despachante: 'parado', lidoEm: '2026-11-11T12:00:00.000Z' } as const

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
    expect(lerSala(nova(), 'linux', agora)).toEqual({ kind: 'sem-estado', lidoEm: agora() })
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
  it('src/main/fabrica/sala.ts não nomeia nenhuma porta de escrita', () => {
    const texto = readFileSync(
      join(__dirname, '..', '..', 'src', 'main', 'fabrica', 'sala.ts'),
      'utf8',
    )
    const achados = PROIBIDOS.filter((nome) => texto.includes(nome))
    expect(
      achados,
      `a sala da fábrica só lê (#122, CA-3a.3): ${achados.join(', ')} é porta de escrita. Fechar um item é do \`yarn fabrica fechar\`, que passa pelo cadeado do estado.json`,
    ).toEqual([])
  })
})
