import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphQLFn } from '../../src/core/board/types'
import { marcarLancando } from '../../src/core/fabrica/despachante'
import { montarPrompt } from '../../src/core/fabrica/mandato'
import type { ItemDaFila } from '../../src/core/fabrica/tipos'
import {
  alterarEstado,
  lerEntrada,
  lerEstado,
  lerPausa,
  pausar,
} from '../../src/main/fabrica/arquivos'
import { executar, type DepsDoCli } from '../../src/main/fabrica/cli'
import { lerItemNoBoard } from '../../src/main/fabrica/github'
import { envLimpo } from '../../src/main/fabrica/lancador'

// O gancho da corrida: com `releitura` posta, a segunda leitura do `revisoes.jsonl` em diante devolve
// o texto dela, como se outro escritor tivesse chegado antes (spec F5 §F5.5, passo 5).
const gancho = vi.hoisted(() => ({ releitura: null as string | null, leituras: 0 }))
vi.mock('../../src/main/fabrica/revisoes', async (original) => {
  const real = await original<typeof import('../../src/main/fabrica/revisoes')>()
  return {
    ...real,
    lerTextoDasRevisoes: (pasta: string): string | null => {
      gancho.leituras += 1
      return gancho.releitura !== null && gancho.leituras >= 2
        ? gancho.releitura
        : real.lerTextoDasRevisoes(pasta)
    },
  }
})

const RAIZ = join(__dirname, '..', '..')
const COFRE = join(RAIZ, 'tests', 'fixtures', 'fabrica', 'f5-cofre')
const DECISAO = '2026-11-10-o-teto-de-sessoes-passa-a-3.md'
const OUTRA = '2026-11-10-card-46-triado.md'
const MANDATO = `MANDATO DE TESTE ${randomUUID()}\n- regra do teste\n`
const MARCA_DA_PROVA = MANDATO.split('\n')[0] as string
const AGORA = '2026-11-11T10:00:00.000Z'

let pasta = ''
let falso = ''
let saidaDoFalso = ''
const processos: ChildProcess[] = []

beforeEach(() => {
  gancho.releitura = null
  gancho.leituras = 0
  // Dentro do repo, e não no `/tmp`, que a fábrica recusa (spec P2 §6).
  pasta = mkdtempSync(join(RAIZ, 'node_modules', '.oc-fabrica-teste-'))
  saidaDoFalso = join(pasta, 'falso-saida')
  falso = join(pasta, 'claude-falso.js')
  // O `#!` mantém o `-p` no `cmdline` da sessão (o `argv[0]` é o node, e o script vem depois).
  writeFileSync(
    falso,
    `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const prompt = args[args.indexOf('-p') + 1]
const comando = prompt.split('\\n')[0]
const respostas = JSON.parse(process.env.OC_FALSO_RESPOSTAS || '{}')
const id = process.env.OC_FABRICA_DESPACHO.split('/')[1]
fs.mkdirSync(process.env.OC_FALSO_SAIDA, { recursive: true })
fs.writeFileSync(
  path.join(process.env.OC_FALSO_SAIDA, id + '.json'),
  JSON.stringify({ env: process.env, cwd: process.cwd(), prompt, comando }),
)
process.stderr.write('falso no stderr\\n')
setTimeout(() => {
  const linha = respostas[comando]
  process.stdout.write(
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'feito\\n\\n' + linha, session_id: 'sessao-' + id }),
  )
}, Number(process.env.OC_FALSO_DORME || 0))
`,
  )
  chmodSync(falso, 0o755)
})

afterEach(() => {
  for (const p of processos.splice(0)) {
    try {
      if (p.pid !== undefined) process.kill(-p.pid, 'SIGKILL')
    } catch {
      // já saiu
    }
  }
  rmSync(pasta, { recursive: true, force: true })
})

interface Montagem {
  deps: DepsDoCli
  saida: string[]
  avisos: string[]
}

function montar(
  resposta: Record<string, string> = {},
  mudar: Partial<DepsDoCli> = {},
  envExtra: NodeJS.ProcessEnv = {},
): Montagem {
  const saida: string[] = []
  const avisos: string[] = []
  const deps: DepsDoCli = {
    argv: [],
    raizDoRepo: RAIZ,
    env: {
      ...process.env,
      OC_FABRICA_DIR: pasta,
      OC_CLAUDE_BIN: falso,
      OC_FALSO_SAIDA: saidaDoFalso,
      OC_FALSO_RESPOSTAS: JSON.stringify(resposta),
      ...envExtra,
    },
    platform: 'linux',
    home: homedir(),
    agora: () => AGORA,
    lerMandato: () => Promise.resolve(MANDATO),
    graphql: () => Promise.reject(new Error('graphql não esperado')),
    intervaloMs: 100,
    sinal: new AbortController().signal,
    escrever: (t) => {
      saida.push(t)
    },
    avisar: (t) => {
      avisos.push(t)
    },
    ...mudar,
  }
  return { deps, saida, avisos }
}

const rodar = (m: Montagem, ...argv: string[]): Promise<number> =>
  executar({ ...m.deps, argv: argv.length === 0 ? ['rodar'] : argv })

async function abrirFrente(m: Montagem, card: number, comando: string): Promise<void> {
  expect(await executar({ ...m.deps, argv: ['iniciar', String(card), '--comando', comando] })).toBe(
    0,
  )
}

function sessaoFalsa(env: NodeJS.ProcessEnv, ...args: string[]): ChildProcess {
  // O `; true` impede o bash de virar o `sleep` por `exec`; `detached` para matar o grupo inteiro.
  const p = spawn('bash', ['-c', 'sleep 5; true', ...args], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: true,
  })
  processos.push(p)
  return p
}

const lancados = (): string[] => (existsSync(saidaDoFalso) ? readdirSync(saidaDoFalso).sort() : [])

const gravadoPeloFalso = (id: string): { env: NodeJS.ProcessEnv; cwd: string; prompt: string } =>
  JSON.parse(readFileSync(join(saidaDoFalso, `${id}.json`), 'utf8')) as {
    env: NodeJS.ProcessEnv
    cwd: string
    prompt: string
  }

describe('lerItemNoBoard', () => {
  const resposta =
    (issue: unknown, errors?: { message: string }[]): GraphQLFn =>
    () =>
      Promise.resolve({ data: { repository: { issue } }, errors })

  it('envia o documento com as variáveis owner, name e n', async () => {
    const enviadas: Record<string, unknown>[] = []
    const graphql: GraphQLFn = (documento, variaveis) => {
      enviadas.push(variaveis)
      expect(documento).toContain('fieldValueByName(name: "Status")')
      return Promise.resolve({
        data: { repository: { issue: { state: 'OPEN', projectItems: { nodes: [] } } } },
      })
    }
    await lerItemNoBoard(graphql, 7)
    expect(enviadas).toEqual([{ owner: 'leonardo-amaral-3', name: 'operations-center', n: 7 }])
  })

  it('errors lança a primeira mensagem', async () => {
    await expect(
      lerItemNoBoard(resposta(null, [{ message: 'quebrou' }, { message: 'b' }]), 1),
    ).rejects.toThrow('quebrou')
  })

  it('issue nula lança', async () => {
    await expect(lerItemNoBoard(resposta(null), 9)).rejects.toThrow(
      'não há issue #9 em leonardo-amaral-3/operations-center',
    )
  })

  it('card fechado lança', async () => {
    await expect(
      lerItemNoBoard(resposta({ state: 'CLOSED', projectItems: { nodes: [] } }), 9),
    ).rejects.toThrow('o #9 está fechado')
  })

  it('item só do projeto 3 é fora do projeto; o do 2 traz o Status', async () => {
    const nos = (n: { project: { number: number }; fieldValueByName: { name: string } | null }[]) =>
      resposta({ state: 'OPEN', projectItems: { nodes: n } })
    expect(
      await lerItemNoBoard(nos([{ project: { number: 3 }, fieldValueByName: { name: 'X' } }]), 1),
    ).toEqual({ noProjeto: false })
    expect(
      await lerItemNoBoard(
        nos([
          { project: { number: 3 }, fieldValueByName: { name: 'X' } },
          { project: { number: 2 }, fieldValueByName: { name: '📋 Backlog' } },
        ]),
        1,
      ),
    ).toEqual({ noProjeto: true, status: '📋 Backlog' })
    expect(
      await lerItemNoBoard(nos([{ project: { number: 2 }, fieldValueByName: null }]), 1),
    ).toEqual({ noProjeto: true, status: null })
  })
})

describe('envLimpo', () => {
  it('tira CLAUDE*, npm_*, INIT_CWD e as entradas do yarn do PATH', () => {
    const yarn = join(tmpdir(), 'yarn--1-2')
    const bin = join(RAIZ, 'node_modules', '.bin')
    const limpo = envLimpo(
      {
        CLAUDE_CODE_X: '1',
        CLAUDECODE: '1',
        npm_config_y: '1',
        INIT_CWD: '/x',
        HOME: '/h',
        PATH: ['/usr/bin', yarn, bin, '/bin'].join(delimiter),
      },
      RAIZ,
    )
    expect(limpo).toEqual({ HOME: '/h', PATH: ['/usr/bin', '/bin'].join(delimiter) })
  })
})

describe('CLI', () => {
  it('argumentos errados dão 1, com a linha de uso', async () => {
    for (const argv of [
      ['iniciar'],
      ['iniciar', 'x'],
      ['iniciar', '0'],
      ['voar'],
      ['estado', 'a'],
      ['iniciar', '1', '--comando'],
      ['iniciar', '1', '--tudo'],
      ['iniciar', '1', '2'],
      ['fechar', 'q-0001'],
      ['entrada'],
      ['entrada', 'a', 'b'],
      ['triar', 'e-0001'],
      ['triar', 'e-0001', 'a', 'b'],
      ['pausar', 'x'],
      ['retomar', 'x'],
    ]) {
      const m = montar()
      expect(await executar({ ...m.deps, argv }), argv.join(' ')).toBe(1)
      expect(m.avisos[0]).toMatch(/^fabrica: /)
      expect(m.avisos[1]).toMatch(/^uso: yarn fabrica/)
    }
  })

  it('fora do Linux dá 2 com a mensagem da fase', async () => {
    const m = montar({}, { platform: 'win32' })
    expect(await rodar(m, 'estado')).toBe(2)
    expect(m.avisos).toEqual(['fabrica: roda só no Linux nesta fase (P2 do #118)'])
  })

  it('iniciar --ensaio escreve o comando da estação e não cria a pasta', async () => {
    const nova = join(pasta, 'nova')
    const graphql: GraphQLFn = () =>
      Promise.resolve({
        data: {
          repository: {
            issue: {
              state: 'OPEN',
              projectItems: {
                nodes: [{ project: { number: 2 }, fieldValueByName: { name: '📋 Backlog' } }],
              },
            },
          },
        },
      })
    const m = montar({}, { graphql }, { OC_FABRICA_DIR: nova })
    expect(await rodar(m, 'iniciar', '7', '--ensaio')).toBe(0)
    expect(m.saida).toEqual(['#7: /gm-spec #7'])
    expect(existsSync(nova)).toBe(false)
  })

  it('iniciar recusa o que o mandato proíbe, e erro da estação dá 1', async () => {
    const m = montar()
    expect(await rodar(m, 'iniciar', '3', '--comando', '/gm-release')).toBe(1)
    expect(m.avisos[0]).toContain('/gm-release não é despachada pela fábrica')
    expect(
      await rodar(m, 'iniciar', '3', '--comando', '/gm-spec #3', '--nota', 'faça merge na main'),
    ).toBe(1)
    expect(m.avisos[1]).toContain('a nota cita main')
    expect(lerEstado(pasta)).toBeNull()
  })

  it('iniciar abre a frente, e um segundo no mesmo card é recusado', async () => {
    const m = montar()
    expect(await rodar(m, 'iniciar', '5', '--comando', '/gm-spec #5', '--nota', 'sem pressa')).toBe(
      0,
    )
    expect(m.saida).toEqual(['frente fr-0001 aberta: d-0002 #5 /gm-spec #5'])
    expect(lerEstado(pasta)?.despachos[0]?.nota).toBe('sem pressa')
    expect(await rodar(m, 'iniciar', '5', '--comando', '/gm-spec #5')).toBe(1)
    expect(m.avisos[0]).toBe('fabrica: o #5 já tem despacho em voo (d-0002)')
  })

  it('estado: sem estado.json, nada registrado; com item aberto, lista o q; fechar fecha', async () => {
    const m = montar()
    expect(await rodar(m, 'estado')).toBe(0)
    expect(m.saida).toEqual(['nada registrado'])

    await abrirFrente(m, 4, '/gm-spec #4')
    const item: ItemDaFila = {
      id: 'q-0009',
      card: 4,
      motivo: 'espera o Leonardo',
      despacho: 'd-0002',
      sessaoClaude: null,
      criadoEm: AGORA,
      fechadoEm: null,
      resolucao: null,
    }
    await alterarEstado(pasta, (e) => ({ estado: { ...e, fila: [item] }, resultado: null }))
    m.saida.length = 0
    expect(await rodar(m, 'estado')).toBe(0)
    expect(m.saida).toEqual([
      `fr-0001 #4 aberta em ${AGORA}`,
      'd-0002 #4 pendente /gm-spec #4',
      'q-0009 #4 espera o Leonardo (de d-0002, sessão -)',
    ])

    m.saida.length = 0
    expect(await rodar(m, 'fechar', 'q-0009', 'feito')).toBe(0)
    expect(m.saida).toEqual(['q-0009 fechado'])
    expect(lerEstado(pasta)?.fila[0]).toMatchObject({ fechadoEm: AGORA, resolucao: 'feito' })
    expect(await rodar(m, 'fechar', 'q-0009', 'de novo')).toBe(1)
    expect(await rodar(m, 'fechar', 'q-7777', 'x')).toBe(1)
    expect(m.avisos).toEqual([
      'fabrica: o item q-0009 já foi fechado',
      'fabrica: não há item q-7777 na fila',
    ])
  })

  describe('entrada e triar', () => {
    it('entrada grava e-0001 e não toca no estado.json', async () => {
      const m = montar()
      expect(await rodar(m, 'entrada', '  o Slack caiu  ')).toBe(0)
      expect(m.saida).toEqual(['e-0001 na entrada'])
      expect(lerEntrada(pasta)?.itens).toEqual([
        {
          id: 'e-0001',
          texto: 'o Slack caiu',
          fonte: 'voce',
          criadoEm: AGORA,
          triadoEm: null,
          resolucao: null,
        },
      ])
      expect(existsSync(join(pasta, 'estado.json'))).toBe(false)
    })

    it('texto vazio dá 1 sem criar o arquivo; --x é texto', async () => {
      const m = montar()
      expect(await rodar(m, 'entrada', '  ')).toBe(1)
      expect(m.avisos).toEqual(['fabrica: o texto da entrada está vazio'])
      expect(existsSync(join(pasta, 'entrada.json'))).toBe(false)
      expect(await rodar(m, 'entrada', '--x')).toBe(0)
      expect(lerEntrada(pasta)?.itens[0]?.texto).toBe('--x')
    })

    it('triar marca, e de novo ou um id inexistente dá 1', async () => {
      const m = montar()
      await rodar(m, 'entrada', 'a')
      m.saida.length = 0
      expect(await rodar(m, 'triar', 'e-0001', 'virou o #9')).toBe(0)
      expect(m.saida).toEqual(['e-0001 triado'])
      expect(await rodar(m, 'triar', 'e-0001', 'de novo')).toBe(1)
      expect(await rodar(m, 'triar', 'e-0099', 'x')).toBe(1)
      expect(m.avisos).toEqual([
        'fabrica: o item e-0001 já foi triado',
        'fabrica: não há item e-0099 na entrada',
      ])
      expect(lerEntrada(pasta)?.itens[0]).toMatchObject({ resolucao: 'virou o #9' })
    })

    it('estado lista os abertos com a primeira linha cortada em 80, e só entrada não é "nada registrado"', async () => {
      const m = montar()
      await rodar(m, 'entrada', 'curto')
      await rodar(m, 'entrada', 'b'.repeat(100) + '\nsegunda linha')
      await rodar(m, 'entrada', 'triado')
      await rodar(m, 'triar', 'e-0003', 'x')
      m.saida.length = 0
      expect(await rodar(m, 'estado')).toBe(0)
      expect(m.saida).toEqual([
        `e-0001 na entrada desde ${AGORA}: curto`,
        `e-0002 na entrada desde ${AGORA}: ${'b'.repeat(79)}…`,
      ])
    })

    it('estado com entrada.json torto avisa e sai 0', async () => {
      writeFileSync(join(pasta, 'entrada.json'), '{')
      const m = montar()
      expect(await rodar(m, 'estado')).toBe(0)
      expect(m.saida).toEqual([])
      expect(m.avisos[0]).toMatch(/^fabrica: entrada\.json ilegível/)
    })

    it('entrada.json torto não é sobrescrito', async () => {
      writeFileSync(join(pasta, 'entrada.json'), '{')
      const m = montar()
      expect(await rodar(m, 'entrada', 'a')).toBe(1)
      expect(readFileSync(join(pasta, 'entrada.json'), 'utf8')).toBe('{')
    })

    it('no /tmp dá 2 e a pasta não nasce', async () => {
      const dentro = join(tmpdir(), randomUUID())
      const m = montar({}, {}, { OC_FABRICA_DIR: dentro })
      expect(await rodar(m, 'entrada', 'a')).toBe(2)
      expect(existsSync(dentro)).toBe(false)
    })
  })

  describe('revisões: confirmar, contestar e atender', () => {
    const montarRevisoes = (): Montagem => montar({}, {}, { OC_RELATORIO_COFRE: COFRE })
    const jsonl = (): string => readFileSync(join(pasta, 'revisoes.jsonl'), 'utf8')

    it('confirmar grava, escreve <arquivo> confirmada e sai 0; de novo recusa e não mexe no arquivo', async () => {
      expect(pasta).toContain('.oc-fabrica-teste-')
      const m = montarRevisoes()
      expect(await rodar(m, 'confirmar', DECISAO)).toBe(0)
      expect(m.saida).toEqual([`${DECISAO} confirmada`])
      const antes = jsonl()
      expect(JSON.parse(antes)).toEqual({ tipo: 'confirmada', arquivo: DECISAO, em: AGORA })
      expect(await rodar(m, 'confirmar', DECISAO)).toBe(1)
      expect(m.avisos).toEqual([`fabrica: ${DECISAO} já foi confirmada em ${AGORA}`])
      expect(jsonl()).toBe(antes)
      expect(existsSync(join(pasta, 'estado.json'))).toBe(false)
    })

    it('contestar sem motivo dá 1; com motivo grava', async () => {
      const m = montarRevisoes()
      expect(await rodar(m, 'contestar', DECISAO, '  ')).toBe(1)
      expect(m.avisos).toEqual(['fabrica: falta o motivo da contestação'])
      expect(existsSync(join(pasta, 'revisoes.jsonl'))).toBe(false)
      expect(await rodar(m, 'contestar', DECISAO, ' o teto é 5 ')).toBe(0)
      expect(m.saida).toEqual([`${DECISAO} contestada`])
      expect(JSON.parse(jsonl())).toEqual({
        tipo: 'contestada',
        arquivo: DECISAO,
        em: AGORA,
        motivo: 'o teto é 5',
      })
    })

    it('arquivo fora do cofre dá 1 sem gravar; nome inválido dá 1 antes de olhar o cofre', async () => {
      const m = montarRevisoes()
      expect(await rodar(m, 'confirmar', '2026-11-10-nao-existe.md')).toBe(1)
      expect(m.avisos[0]).toBe(`fabrica: não há 2026-11-10-nao-existe.md no cofre (${COFRE})`)
      expect(await rodar(m, 'contestar', '2026-11-10-nao-existe.md', 'x')).toBe(1)
      for (const ruim of ['../x.md', 'x.md']) {
        m.avisos.length = 0
        expect(await rodar(m, 'confirmar', ruim)).toBe(1)
        expect(m.avisos).toEqual([`fabrica: nome de arquivo do cofre inválido: ${ruim}`])
      }
      expect(existsSync(join(pasta, 'revisoes.jsonl'))).toBe(false)
    })

    it('atender sem contestação dá 1; atender fecha, e não confere o cofre', async () => {
      const m = montarRevisoes()
      expect(await rodar(m, 'atender', DECISAO, 'feito')).toBe(1)
      expect(m.avisos).toEqual([`fabrica: ${DECISAO} não tem contestação`])
      await rodar(m, 'contestar', DECISAO, 'errado')
      m.saida.length = 0
      m.avisos.length = 0
      // O cofre da montagem não tem o arquivo: o atender não olha.
      const sem = montar({}, {}, { OC_RELATORIO_COFRE: join(pasta, 'cofre-vazio') })
      expect(await rodar(sem, 'atender', DECISAO, ' corrigido ')).toBe(0)
      expect(sem.saida).toEqual([`${DECISAO} atendida`])
      expect(JSON.parse(jsonl().trim().split('\n')[1] as string)).toEqual({
        tipo: 'atendida',
        arquivo: DECISAO,
        em: AGORA,
        resolucao: 'corrigido',
      })
      expect(await rodar(sem, 'atender', DECISAO, 'de novo')).toBe(1)
      expect(sem.avisos).toEqual([`fabrica: ${DECISAO} já foi atendida em ${AGORA}`])
    })

    it('argumentos a mais e a menos dão 1, com a linha de uso', async () => {
      const m = montarRevisoes()
      const casos: [string[], string][] = [
        [['confirmar'], 'fabrica: falta o arquivo: confirmar <arquivo>'],
        [['confirmar', 'a', 'b'], 'fabrica: argumento a mais: b'],
        [['contestar', 'a'], 'fabrica: faltam argumentos: contestar <arquivo> "<motivo>"'],
        [['contestar', 'a', 'b', 'c'], 'fabrica: argumento a mais: c'],
        [['atender', 'a'], 'fabrica: faltam argumentos: atender <arquivo> "<resolução>"'],
        [['atender', 'a', 'b', 'c'], 'fabrica: argumento a mais: c'],
      ]
      for (const [argv, aviso] of casos) {
        m.avisos.length = 0
        expect(await rodar(m, ...argv)).toBe(1)
        expect(m.avisos[0]).toBe(aviso)
        expect(m.avisos[1]).toMatch(
          /^uso: yarn fabrica .*confirmar <arquivo> \| contestar <arquivo> "<motivo>" \| atender <arquivo> "<resolução>"\]$/,
        )
      }
    })

    it('a corrida: outra revisão do mesmo arquivo chega antes e a primeira vence', async () => {
      const m = montarRevisoes()
      gancho.releitura =
        JSON.stringify({
          tipo: 'contestada',
          arquivo: DECISAO,
          em: '2026-11-11T09:59:59.000Z',
          motivo: 'x',
        }) +
        '\n' +
        JSON.stringify({ tipo: 'confirmada', arquivo: DECISAO, em: AGORA }) +
        '\n'
      expect(await rodar(m, 'confirmar', DECISAO)).toBe(1)
      expect(m.saida).toEqual([])
      expect(m.avisos).toEqual([
        `fabrica: outra revisão de ${DECISAO} chegou antes: contestada em 2026-11-11T09:59:59.000Z`,
      ])
    })

    it('a corrida no atender, e a linha que não volta na releitura', async () => {
      const m = montarRevisoes()
      await rodar(m, 'contestar', DECISAO, 'errado')
      gancho.leituras = 0
      gancho.releitura =
        jsonl() +
        JSON.stringify({
          tipo: 'atendida',
          arquivo: DECISAO,
          em: '2026-11-11T09:59:59.000Z',
          resolucao: 'x',
        }) +
        '\n'
      m.avisos.length = 0
      expect(await rodar(m, 'atender', DECISAO, 'y')).toBe(1)
      expect(m.avisos).toEqual([
        `fabrica: outra revisão de ${DECISAO} chegou antes: já foi atendida em 2026-11-11T09:59:59.000Z`,
      ])
      gancho.leituras = 0
      gancho.releitura = ''
      m.avisos.length = 0
      expect(await rodar(m, 'confirmar', OUTRA)).toBe(1)
      expect(m.avisos).toEqual([
        `fabrica: a revisão de ${OUTRA} não voltou na releitura do revisoes.jsonl`,
      ])
    })

    it('estado lista só a contestação aberta, com o motivo cortado em 80, e atender a tira', async () => {
      const m = montarRevisoes()
      await rodar(m, 'confirmar', OUTRA)
      await rodar(m, 'contestar', DECISAO, 'b'.repeat(100) + '\nsegunda linha')
      m.saida.length = 0
      expect(await rodar(m, 'estado')).toBe(0)
      expect(m.saida).toEqual([`contestada ${DECISAO} em ${AGORA}: ${'b'.repeat(79)}…`])
      await rodar(m, 'atender', DECISAO, 'feito')
      m.saida.length = 0
      expect(await rodar(m, 'estado')).toBe(0)
      expect(m.saida).toEqual(['nada registrado'])
      expect(existsSync(join(pasta, 'estado.json'))).toBe(false)
    })

    it('estado avisa as linhas ilegíveis depois do aviso da entrada, e não diz nada registrado', async () => {
      writeFileSync(join(pasta, 'entrada.json'), '{')
      writeFileSync(join(pasta, 'revisoes.jsonl'), '{torta\n')
      const m = montarRevisoes()
      expect(await rodar(m, 'estado')).toBe(0)
      expect(m.saida).toEqual([])
      expect(m.avisos[0]).toMatch(/^fabrica: entrada\.json ilegível/)
      expect(m.avisos[1]).toBe('fabrica: revisoes.jsonl tem 1 linha ilegível')
      writeFileSync(join(pasta, 'revisoes.jsonl'), '{a\n{b\n')
      m.avisos.length = 0
      rmSync(join(pasta, 'entrada.json'))
      await rodar(m, 'estado')
      expect(m.saida).toEqual([])
      expect(m.avisos).toEqual(['fabrica: revisoes.jsonl tem 2 linhas ilegíveis'])
    })

    it('estado com revisoes.jsonl que é pasta avisa o erro e não diz nada registrado', async () => {
      mkdirSync(join(pasta, 'revisoes.jsonl'))
      const m = montarRevisoes()
      expect(await rodar(m, 'estado')).toBe(0)
      expect(m.saida).toEqual([])
      expect(m.avisos).toHaveLength(1)
      expect(m.avisos[0]).toMatch(/^fabrica: revisoes\.jsonl: /)
    })

    it('estado sem revisoes.jsonl sai como antes', async () => {
      const m = montarRevisoes()
      expect(await rodar(m, 'estado')).toBe(0)
      expect(m.saida).toEqual(['nada registrado'])
      expect(m.avisos).toEqual([])
    })

    it('outro subcomando não mexe no revisoes.jsonl', async () => {
      const m = montarRevisoes()
      await rodar(m, 'contestar', DECISAO, 'x')
      const antes = jsonl()
      expect(await rodar(m, 'pausar')).toBe(0)
      expect(jsonl()).toBe(antes)
    })
  })

  it('estado ilegível dá 2 e não é sobrescrito', async () => {
    writeFileSync(join(pasta, 'estado.json'), '{')
    const m = montar()
    expect(await rodar(m, 'estado')).toBe(2)
    expect(await rodar(m, 'fechar', 'q-1', 'x')).toBe(2)
    expect(readFileSync(join(pasta, 'estado.json'), 'utf8')).toBe('{')
  })

  it('OC_FABRICA_DIR no /tmp é recusado com 2, e a pasta não nasce', async () => {
    const dentro = join(tmpdir(), randomUUID())
    const m = montar({}, {}, { OC_FABRICA_DIR: dentro })
    expect(await rodar(m, 'estado')).toBe(2)
    expect(m.avisos[0]).toContain('OC_FABRICA_DIR não pode ficar no /tmp')
    expect(existsSync(dentro)).toBe(false)
  })
})

describe.skipIf(process.platform !== 'linux')('o laço do despachante', { timeout: 20_000 }, () => {
  it('ambiente: a sessão sobe sem CLAUDE*, npm_*, INIT_CWD nem o PATH do yarn', async () => {
    const yarn = join(tmpdir(), 'yarn--1-2')
    const bin = join(RAIZ, 'node_modules', '.bin')
    const m = montar(
      { '/gm-card #1': 'PARADA: fim' },
      {},
      {
        CLAUDE_CODE_X: '1',
        npm_config_y: '1',
        INIT_CWD: '/x',
        PATH: [yarn, bin, process.env.PATH ?? ''].join(delimiter),
      },
    )
    await abrirFrente(m, 1, '/gm-card #1')
    expect(await rodar(m)).toBe(0)

    const gravado = gravadoPeloFalso('d-0002')
    const chaves = Object.keys(gravado.env)
    expect(chaves.filter((c) => /^CLAUDE|^npm_|^INIT_CWD$/.test(c))).toEqual([])
    expect(gravado.env.PATH?.split(delimiter)).not.toContain(yarn)
    expect(gravado.env.PATH?.split(delimiter)).not.toContain(bin)
    expect(gravado.env.OC_FABRICA_DESPACHO).toBe(`${lerEstado(pasta)?.instancia}/d-0002`)
    expect(realpathSync(gravado.cwd)).toBe(realpathSync(dirname(RAIZ)))
    expect(gravado.prompt).toBe(montarPrompt('/gm-card #1', MANDATO, null))

    const dirSessao = join(pasta, 'sessoes', 'd-0002')
    expect(readFileSync(join(dirSessao, 'erro.txt'), 'utf8')).toContain('falso no stderr')
    expect(readFileSync(join(dirSessao, 'prompt.txt'), 'utf8')).toBe(gravado.prompt)
    expect(JSON.parse(readFileSync(join(dirSessao, 'saida.json'), 'utf8'))).toMatchObject({
      type: 'result',
      session_id: 'sessao-d-0002',
    })
  })

  it('cadeia: PROXIMO vira a próxima sessão e a PARADA vira item da fila', async () => {
    const m = montar({ '/gm-card #1': 'PROXIMO: /gm-spec #1', '/gm-spec #1': 'PARADA: fim' })
    await abrirFrente(m, 1, '/gm-card #1')
    expect(await rodar(m)).toBe(0)
    const e = lerEstado(pasta)
    expect(e?.despachos.map((d) => [d.id, d.comando, d.estado])).toEqual([
      ['d-0002', '/gm-card #1', 'concluido'],
      ['d-0003', '/gm-spec #1', 'concluido'],
    ])
    expect(e?.fila).toHaveLength(1)
    expect(e?.fila[0]).toMatchObject({ card: 1, motivo: 'fim', despacho: 'd-0003' })
    expect(e?.frentes[0]?.encerradaEm).toBe(AGORA)
    expect(m.saida.some((l) => l.includes('d-0002 terminou: PROXIMO /gm-spec #1'))).toBe(true)
    expect(m.saida.some((l) => l.includes('d-0003 terminou: fila q-0004 — fim'))).toBe(true)
    expect(m.saida.at(-1)).toContain('nada pendente nem em voo; fim')
  })

  it('ceiling: com 3 sessões da prova vivas, espera vaga uma vez e não lança', async () => {
    for (let i = 0; i < 3; i += 1) sessaoFalsa({}, '-p', MARCA_DA_PROVA)
    const controlador = new AbortController()
    const m = montar({}, { sinal: controlador.signal })
    await abrirFrente(m, 1, '/gm-card #1')
    setTimeout(() => {
      controlador.abort()
    }, 450)
    expect(await rodar(m)).toBe(130)
    expect(
      m.saida.filter((l) => l.includes('esperando vaga: 3 sessões da prova vivas (teto 3)')),
    ).toHaveLength(1)
    expect(m.saida.filter((l) => l.includes('lançado'))).toEqual([])
    expect(lancados()).toEqual([])
    expect(lerEstado(pasta)?.despachos[0]?.estado).toBe('pendente')
  })

  describe('mandato ilegível', () => {
    it.each([
      ['lança', () => Promise.reject(new Error('mandato ilegível na dev: vazio'))],
      ['vem vazio', () => Promise.resolve('  \n')],
    ])('quando o mandato %s, três passos dão 3 e nada é lançado', async (_nome, lerMandato) => {
      let chamadas = 0
      const m = montar(
        {},
        {
          lerMandato: () => {
            chamadas += 1
            return lerMandato()
          },
        },
      )
      await abrirFrente(m, 1, '/gm-card #1')
      expect(await rodar(m)).toBe(3)
      expect(chamadas).toBe(3)
      expect(m.avisos.filter((a) => a.includes('nada foi despachado neste passo'))).toHaveLength(3)
      expect(lancados()).toEqual([])
      expect(lerEstado(pasta)?.despachos[0]?.estado).toBe('pendente')
      expect(existsSync(join(pasta, 'rodar.pid'))).toBe(false)
    })

    it('uma falha seguida de sucesso lança', async () => {
      let chamadas = 0
      const m = montar(
        { '/gm-card #1': 'PARADA: fim' },
        {
          lerMandato: () => {
            chamadas += 1
            return chamadas === 1 ? Promise.reject(new Error('rede')) : Promise.resolve(MANDATO)
          },
        },
      )
      await abrirFrente(m, 1, '/gm-card #1')
      expect(await rodar(m)).toBe(0)
      expect(m.avisos).toHaveLength(1)
      expect(lancados()).toEqual(['d-0002.json'])
    })
  })

  describe('quedas', () => {
    const lancando = (): Promise<void> =>
      alterarEstado(pasta, (e) => ({
        estado: marcarLancando(e, 'd-0002', AGORA),
        resultado: undefined,
      }))

    it('(a) lancando sem processo e sem saida.json volta a pendente e é lançado uma vez', async () => {
      const m = montar({ '/gm-card #1': 'PARADA: fim' })
      await abrirFrente(m, 1, '/gm-card #1')
      await lancando()
      expect(await rodar(m)).toBe(0)
      expect(lancados()).toEqual(['d-0002.json'])
      expect(lerEstado(pasta)?.despachos[0]?.estado).toBe('concluido')
    })

    it('(b) lancando com um processo que tem a marca vira rodando, sem relançar', async () => {
      const controlador = new AbortController()
      const m = montar({}, { sinal: controlador.signal })
      await abrirFrente(m, 1, '/gm-card #1')
      await lancando()
      const instancia = lerEstado(pasta)?.instancia as string
      // o bash tem `-p` e a marca; o `sleep` filho herda a marca (N5) mas não tem `-p`
      const sessao = sessaoFalsa({ OC_FABRICA_DESPACHO: `${instancia}/d-0002` }, '-p')
      setTimeout(() => {
        controlador.abort()
      }, 450)
      expect(await rodar(m)).toBe(130)
      const d = lerEstado(pasta)?.despachos[0]
      expect(d).toMatchObject({ estado: 'rodando', pid: sessao.pid })
      expect(lancados()).toEqual([])
    })

    it('(c) lancando sem processo e com saida.json vazio vira item "sem saída", sem relançar', async () => {
      const m = montar({ '/gm-card #1': 'PARADA: fim' })
      await abrirFrente(m, 1, '/gm-card #1')
      await lancando()
      mkdirSync(join(pasta, 'sessoes', 'd-0002'), { recursive: true })
      writeFileSync(join(pasta, 'sessoes', 'd-0002', 'saida.json'), '')
      expect(await rodar(m)).toBe(0)
      expect(lancados()).toEqual([])
      const e = lerEstado(pasta)
      expect(e?.despachos[0]?.estado).toBe('concluido')
      expect(e?.fila[0]?.motivo).toBe('a sessão terminou sem saída')
    })
  })

  it('religar: o kill do despachante não mata a sessão, e o segundo a adota sem duplicar comando', async () => {
    const primeiro = new AbortController()
    const m = montar(
      { '/gm-card #1': 'PROXIMO: /gm-spec #1', '/gm-spec #1': 'PARADA: fim' },
      { sinal: primeiro.signal },
      { OC_FALSO_DORME: '2000' },
    )
    m.deps.escrever = (t) => {
      m.saida.push(t)
      if (t.includes('lançado')) primeiro.abort()
    }
    await abrirFrente(m, 1, '/gm-card #1')
    expect(await rodar(m)).toBe(130)
    expect(existsSync(join(pasta, 'rodar.pid'))).toBe(false)
    expect(lerEstado(pasta)?.despachos[0]?.estado).toBe('rodando')

    const m2 = montar(
      { '/gm-card #1': 'PROXIMO: /gm-spec #1', '/gm-spec #1': 'PARADA: fim' },
      {},
      { OC_FALSO_DORME: '2000' },
    )
    expect(await rodar(m2)).toBe(0)
    const e = lerEstado(pasta)
    expect(e?.despachos.map((d) => d.comando)).toEqual(['/gm-card #1', '/gm-spec #1'])
    expect(e?.fila).toHaveLength(1)
    expect(lancados()).toEqual(['d-0002.json', 'd-0003.json'])
    expect(m2.saida.filter((l) => l.includes('lançado'))).toHaveLength(1)
  })

  it('um segundo despachante vivo na mesma pasta sai com 4', async () => {
    const controlador = new AbortController()
    const m = montar({}, { sinal: controlador.signal })
    await abrirFrente(m, 1, '/gm-card #1')
    const m1 = montar(
      {},
      { sinal: controlador.signal, lerMandato: () => Promise.reject(new Error('x')) },
    )
    const primeiro = rodar(m1)
    await new Promise((ok) => setTimeout(ok, 150))
    const m2 = montar()
    expect(await rodar(m2)).toBe(4)
    expect(m2.avisos[0]).toMatch(/^fabrica: já há um yarn fabrica rodando \(pid \d+\)$/)
    controlador.abort()
    expect(await primeiro).toBe(130)
  })

  describe('pausa', () => {
    const arquivo = (): string => join(pasta, 'pausa.json')

    it('pausar cria pausa.json com desde e sai 0; de novo diz que já estava e não muda o arquivo', async () => {
      const m = montar()
      expect(await executar({ ...m.deps, argv: ['pausar'] })).toBe(0)
      expect(JSON.parse(readFileSync(arquivo(), 'utf8'))).toEqual({ desde: AGORA })
      expect(m.saida).toEqual(['fábrica pausada: nada novo é despachado até yarn fabrica retomar'])
      expect(existsSync(arquivo() + '.tmp')).toBe(false)

      const depois = montar({}, { agora: () => '2026-11-12T00:00:00.000Z' })
      expect(await executar({ ...depois.deps, argv: ['pausar'] })).toBe(0)
      expect(depois.saida).toEqual([`a fábrica já estava pausada desde ${AGORA}`])
      expect(JSON.parse(readFileSync(arquivo(), 'utf8'))).toEqual({ desde: AGORA })
    })

    it('retomar apaga e sai 0; de novo diz que não estava pausada', async () => {
      const m = montar()
      await executar({ ...m.deps, argv: ['pausar'] })
      m.saida.length = 0
      expect(await executar({ ...m.deps, argv: ['retomar'] })).toBe(0)
      expect(existsSync(arquivo())).toBe(false)
      expect(await executar({ ...m.deps, argv: ['retomar'] })).toBe(0)
      expect(m.saida).toEqual(['fábrica retomada', 'a fábrica não estava pausada'])
    })

    it('pausar no /tmp é recusado com 2, sem criar a pasta', async () => {
      const fora = join(tmpdir(), `oc-pausa-${randomUUID()}`)
      const m = montar({}, {}, { OC_FABRICA_DIR: fora })
      expect(await executar({ ...m.deps, argv: ['pausar'] })).toBe(2)
      expect(existsSync(fora)).toBe(false)
    })

    it('estado com pausa começa por "pausada desde", com ou sem estado.json', async () => {
      const m = montar()
      await executar({ ...m.deps, argv: ['pausar'] })
      m.saida.length = 0
      expect(await executar({ ...m.deps, argv: ['estado'] })).toBe(0)
      expect(m.saida).toEqual([`pausada desde ${AGORA}`])

      await abrirFrente(m, 1, '/gm-card #1')
      m.saida.length = 0
      await executar({ ...m.deps, argv: ['estado'] })
      expect(m.saida[0]).toBe(`pausada desde ${AGORA}`)
      expect(m.saida.length).toBeGreaterThan(1)
    })

    it('pausa.json torto ou que é pasta vira { desde: null } sem lançar', () => {
      expect(lerPausa(pasta)).toBeNull()
      writeFileSync(arquivo(), '{torto')
      expect(lerPausa(pasta)).toEqual({ desde: null })
      writeFileSync(arquivo(), '{"desde":7}')
      expect(lerPausa(pasta)).toEqual({ desde: null })
      rmSync(arquivo())
      mkdirSync(arquivo())
      expect(lerPausa(pasta)).toEqual({ desde: null })
      expect(pausar(pasta, AGORA)).toEqual({ jaEstava: true, desde: null })
    })

    it('rodar pausada: nada é lançado, uma linha de aviso em dois passos, e o recolher roda igual', async () => {
      const controlador = new AbortController()
      const m = montar({}, { sinal: controlador.signal })
      await abrirFrente(m, 1, '/gm-card #1')
      await abrirFrente(m, 2, '/gm-card #2')
      // O do card 2 caiu no meio do lançamento e deixou saida.json: o recolher o conclui mesmo pausada.
      const ids: string[] = (lerEstado(pasta)?.despachos ?? []).map((d) => d.id)
      const [primeiro, segundo] = [ids[0] as string, ids[1] as string]
      await alterarEstado(pasta, (e) => ({
        estado: marcarLancando(e, segundo, AGORA),
        resultado: undefined,
      }))
      mkdirSync(join(pasta, 'sessoes', segundo), { recursive: true })
      writeFileSync(join(pasta, 'sessoes', segundo, 'saida.json'), '')
      pausar(pasta, AGORA)
      setTimeout(() => {
        controlador.abort()
      }, 350)
      expect(await rodar(m)).toBe(130)
      expect(m.saida.filter((l) => l.includes('pausada: nada novo é despachado'))).toHaveLength(1)
      expect(m.saida.filter((l) => l.includes('lançado'))).toEqual([])
      expect(lancados()).toEqual([])
      const e = lerEstado(pasta)
      expect(e?.despachos.map((d) => [d.id, d.estado])).toEqual([
        [primeiro, 'pendente'],
        [segundo, 'concluido'],
      ])
    })

    it('retomada, o rodar volta a lançar e avisa de novo numa pausa seguinte', async () => {
      const m = montar({ '/gm-card #1': 'PARADA: fim' })
      await abrirFrente(m, 1, '/gm-card #1')
      pausar(pasta, AGORA)
      const controlador = new AbortController()
      m.deps.sinal = controlador.signal
      setTimeout(() => {
        rmSync(arquivo())
      }, 250)
      expect(await rodar(m)).toBe(0)
      expect(lancados()).toEqual(['d-0002.json'])
    })

    it('uma pausa gravada enquanto o lerMandato ia à rede não deixa lançar nada', async () => {
      const m = montar({ '/gm-card #1': 'PARADA: fim' })
      m.deps.lerMandato = () => {
        pausar(pasta, AGORA)
        return Promise.resolve(MANDATO)
      }
      const controlador = new AbortController()
      m.deps.sinal = controlador.signal
      await abrirFrente(m, 1, '/gm-card #1')
      setTimeout(() => {
        controlador.abort()
      }, 350)
      expect(await rodar(m)).toBe(130)
      expect(lancados()).toEqual([])
      expect(lerEstado(pasta)?.despachos[0]?.estado).toBe('pendente')
    })
  })

  it('concorrência: um iniciar entre o passo 1 e o 3 do rodar não se perde', async () => {
    let primeira = true
    const m = montar({ '/gm-card #1': 'PARADA: fim', '/gm-card #2': 'PARADA: fim' })
    m.deps.lerMandato = async () => {
      if (primeira) {
        primeira = false
        expect(
          await executar({ ...m.deps, argv: ['iniciar', '2', '--comando', '/gm-card #2'] }),
        ).toBe(0)
      }
      return MANDATO
    }
    await abrirFrente(m, 1, '/gm-card #1')
    expect(await rodar(m)).toBe(0)
    const e = lerEstado(pasta)
    expect(e?.frentes.map((f) => f.card).sort()).toEqual([1, 2])
    expect(e?.despachos.map((d) => [d.card, d.estado]).sort()).toEqual([
      [1, 'concluido'],
      [2, 'concluido'],
    ])
  })
})
