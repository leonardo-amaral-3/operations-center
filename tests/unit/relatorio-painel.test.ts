import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  decisoesDoDia,
  janelaDoDia,
  marcasDoPorque,
  montarPainel,
  montarRelatorio,
  resumirCofre,
} from '../../src/core/relatorio'
import type { Commit, EntradaDoRelatorio, Objetivo } from '../../src/core/relatorio'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const F5 = join(FIXTURES, 'fabrica', 'f5-cofre')
const P1 = join(FIXTURES, 'relatorio', 'cofre-2026-11-10')
const REPO = { owner: 'leonardo-amaral-3', name: 'operations-center' }
const DIA = '2026-11-10'

function ler(pasta: string): { nome: string; texto: string }[] {
  return readdirSync(pasta).map((nome) => ({
    nome,
    texto: readFileSync(join(pasta, nome), 'utf8'),
  }))
}

function entradaDe(
  pasta: string,
  extra: { commits?: Commit[]; objetivos?: Objetivo[] | null } = {},
): { entrada: EntradaDoRelatorio; arquivos: { nome: string; texto: string }[] } {
  const arquivos = ler(pasta)
  const { decisoes, ilegiveis } = decisoesDoDia(arquivos, DIA, REPO)

  return {
    arquivos,
    entrada: {
      janela: janelaDoDia(DIA),
      repo: REPO,
      projeto: 2,
      pastaDoCofre: pasta,
      pastaDoRepo: '/repo',
      decisoes,
      ilegiveis,
      cards: new Map(),
      commits: extra.commits ?? [],
      objetivos: extra.objetivos ?? null,
    },
  }
}

describe('resumirCofre', () => {
  it('f5-cofre: 12 no cofre, repos 8/2/1 e o escopo só número em semRepo', () => {
    const r = resumirCofre(ler(F5), DIA)

    expect(r.noCofre).toBe(12)
    expect(r.porRepo).toEqual([
      { repo: 'operations-center', decisoes: 8 },
      { repo: 'claude-brain', decisoes: 2 },
      { repo: 'extractor', decisoes: 1 },
    ])
    expect(r.semRepo.map((d) => d.escopo)).toEqual(['46'])
  })

  it('cofre-2026-11-10 da P1: 14 legíveis, operations-center-x é um repo e a sem frontmatter fica fora', () => {
    const r = resumirCofre(ler(P1), DIA)

    expect(r.noCofre).toBe(14)
    expect(r.porRepo.find((x) => x.repo === 'operations-center-x')).toEqual({
      repo: 'operations-center-x',
      decisoes: 1,
    })
    expect(r.porRepo.reduce((s, x) => s + x.decisoes, 0) + r.semRepo.length).toBe(14)
  })

  it('só conta o dia pedido, só .md, e o dono do repo cai', () => {
    const md = (data: string, escopo: string) =>
      `---\ndata: ${data}\ntipo: decisao\nescopo: ${escopo}\n---\n# t\n\nfato\n`
    const r = resumirCofre(
      [
        { nome: 'a.md', texto: md(DIA, 'leonardo-amaral-3/operations-center#1') },
        { nome: 'b.md', texto: md(DIA, 'operations-center') },
        { nome: 'c.md', texto: md('2026-11-09', 'operations-center#1') },
        { nome: 'd.txt', texto: md(DIA, 'operations-center#1') },
        { nome: 'e.md', texto: md(DIA, '#41') },
        { nome: 'f.md', texto: md(DIA, '') },
      ],
      DIA,
    )

    expect(r.noCofre).toBe(4)
    expect(r.porRepo).toEqual([
      { repo: 'operations-center', decisoes: 2 },
      { repo: 'sem escopo', decisoes: 1 },
    ])
    expect(r.semRepo.map((d) => d.arquivo)).toEqual(['e.md'])
  })

  it('empate de repos pelo nome', () => {
    const md = (escopo: string) =>
      `---\ndata: ${DIA}\ntipo: decisao\nescopo: ${escopo}\n---\n# t\n\nfato\n`
    const r = resumirCofre(
      [
        { nome: 'a.md', texto: md('zeta#1') },
        { nome: 'b.md', texto: md('alfa#1') },
      ],
      DIA,
    )

    expect(r.porRepo.map((x) => x.repo)).toEqual(['alfa', 'zeta'])
  })
})

describe('marcasDoPorque', () => {
  it('sem porquê: os dois null', () => {
    expect(marcasDoPorque(null)).toEqual({ reversivel: null, sob: null })
  })

  it('reversível sim, não, sem marca, com acento e maiúscula', () => {
    expect(marcasDoPorque('x. reversível: sim.').reversivel).toBe('sim')
    expect(marcasDoPorque('x. Reversível: NÃO.').reversivel).toBe('nao')
    expect(marcasDoPorque('x. reversivel: nao').reversivel).toBe('nao')
    expect(marcasDoPorque('nada marcado').reversivel).toBeNull()
  })

  it('sob: com e sem ponto final', () => {
    expect(marcasDoPorque('a. sob: mandato #1439.').sob).toBe('mandato #1439')
    expect(marcasDoPorque('a. sob: mandato #1439').sob).toBe('mandato #1439')
  })

  it('sob: para no fim da linha, e o resto é texto livre', () => {
    expect(marcasDoPorque('sob: mandato #1439\nmais texto.').sob).toBe('mandato #1439')
    expect(marcasDoPorque('sob: decisão da v1.2 do plano. depois mais').sob).toBe(
      'decisão da v1.2 do plano',
    )
  })

  it('sob: vazio ou sem a marca → null', () => {
    expect(marcasDoPorque('sob:\noutra linha').sob).toBeNull()
    expect(marcasDoPorque('sob: .').sob).toBeNull()
    expect(marcasDoPorque('sem marca').sob).toBeNull()
  })

  it('a decisão 3 da f5-cofre', () => {
    const d = decisoesDoDia(ler(F5), DIA, REPO).decisoes.find(
      (x) => x.arquivo === '2026-11-10-o-relatorio-agrupa-pela-raiz-da-cadeia.md',
    )

    expect(marcasDoPorque(d?.porque ?? null)).toEqual({
      reversivel: 'nao',
      sob: 'mandato #1439',
    })
  })
})

describe('montarPainel sobre a f5-cofre', () => {
  const OBJETIVOS = [
    { codigo: 'P0', nome: 'Fundação' },
    { codigo: 'P1', nome: 'Relatório do dia' },
  ]
  const { entrada, arquivos } = entradaDe(F5, {
    objetivos: OBJETIVOS,
    commits: [
      { sha: 'abc1234', em: '2026-11-10T10:00:00Z', assunto: 'x', card: 122 },
      { sha: '  ', em: '2026-11-10T11:00:00Z', assunto: 'sem sha', card: null },
    ],
  })
  const relatorio = montarRelatorio(entrada)
  const painel = montarPainel(entrada, relatorio, resumirCofre(arquivos, DIA))
  const secaoDe = (arquivo: string) => painel.decisoes.find((d) => d.arquivo === arquivo)?.secao

  it('nove decisões, por arquivo, e as seções 1 a 9 do esperado F5', () => {
    expect(painel.decisoes).toHaveLength(9)
    expect(painel.decisoes.map((d) => d.arquivo)).toEqual(
      [...painel.decisoes.map((d) => d.arquivo)].sort((a, b) => a.localeCompare(b, 'en')),
    )
    expect(secaoDe('2026-11-10-g2-da-f9-decidido-sob-mandato.md')).toBe('chave')
    expect(secaoDe('2026-11-10-leitura-do-cofre-em-lotes-de-64.md')).toBe('provisoria')
    expect(secaoDe('2026-11-10-o-relatorio-agrupa-pela-raiz-da-cadeia.md')).toBe('provisoria')
    expect(secaoDe('2026-11-10-a-sala-le-o-mandato-pela-graphql.md')).toBe('provisoria')
    expect(secaoDe('2026-11-10-pendencia-a-cor-do-cracha-da-pausa.md')).toBe('estacionada')
    expect(secaoDe('2026-11-10-task-2-da-sala-entregue.md')).toBe('rotina')
    expect(secaoDe('2026-11-10-ajuste-de-texto-no-readme.md')).toBe('rotina')
    expect(secaoDe('2026-11-10-o-teto-de-sessoes-passa-a-3.md')).toBe('desvio')
    expect(secaoDe('2026-11-10-card-46-triado.md')).toBe('sem-repo')
  })

  it('a decisão sem repo leva o motivo, sem card e sem frente', () => {
    const d = painel.decisoes.find((x) => x.secao === 'sem-repo')

    expect(d).toMatchObject({ motivo: 'escopo sem repo', card: null, frente: null, escopo: '46' })
  })

  it('a frente de cada decisão é a frente da P1 em que a fonte dela caiu', () => {
    for (const d of painel.decisoes.filter((x) => x.secao !== 'sem-repo')) {
      const frente = relatorio.frentes.find((f) =>
        (['chave', 'provisorias', 'estacionadas', 'desvios', 'resto'] as const).some((s) =>
          f.secoes[s].some((l) =>
            l.fontes.some((fonte) => fonte.tipo === 'cofre' && fonte.rotulo === d.arquivo),
          ),
        ),
      )

      expect(frente).toBeDefined()
      expect(d.frente).toBe(frente?.card)
    }
  })

  it('carrega as marcas, os objetivos e o motivo da P1', () => {
    const d3 = painel.decisoes.find(
      (x) => x.arquivo === '2026-11-10-o-relatorio-agrupa-pela-raiz-da-cadeia.md',
    )

    expect(d3).toMatchObject({
      card: 120,
      tipo: 'decisao',
      objetivos: ['P1'],
      provisoria: true,
      reversivel: 'nao',
      sob: 'mandato #1439',
      motivo: 'provisória: sim',
    })
    expect(d3?.descartado).toContain('Agrupar pelo card do escopo')
  })

  it('frases na ordem das frentes, sem as vazias', () => {
    expect(painel.frases).toHaveLength(relatorio.frentes.length)
    expect(painel.frases.map((f) => f.card)).toEqual(relatorio.frentes.map((f) => f.card))
    for (const f of painel.frases) expect(f.texto).not.toBe('')
  })

  it('commits sem sha não contam; cofre e repos vêm do resumo; objetivos copiados', () => {
    expect(painel.commits).toBe(1)
    expect(painel.noCofre).toBe(12)
    expect(painel.porRepo).toHaveLength(3)
    expect(painel.objetivos).toEqual(OBJETIVOS)
    expect(painel.objetivos).not.toBe(OBJETIVOS)
  })

  it('sem DIRECAO.md os objetivos são null', () => {
    const sem = entradaDe(F5)

    expect(
      montarPainel(sem.entrada, montarRelatorio(sem.entrada), resumirCofre(sem.arquivos, DIA))
        .objetivos,
    ).toBeNull()
  })
})
