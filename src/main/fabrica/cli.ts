import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { GraphQLFn } from '../../core/board/types'
import {
  abertosDaEntrada,
  registrarNaEntrada,
  triarItemDaEntrada,
} from '../../core/fabrica/entrada'
import { fecharItem, iniciarFrente } from '../../core/fabrica/despachante'
import { comandoDaEstacao } from '../../core/fabrica/estacao'
import {
  avaliarComando,
  avaliarNota,
  caminhosProibidos,
  REPO_DA_FABRICA,
} from '../../core/fabrica/mandato'
import { createGhTokenSource } from '../github/token'
import { createGitHubGraphQL } from '../github/graphql'
import {
  alterarEntrada,
  alterarEstado,
  lerEntrada,
  lerEstado,
  lerPausa,
  pastaDaFabrica,
  pausar,
  recusarTemporaria,
  retomar,
} from './arquivos'
import { lerItemNoBoard, lerMandato } from './github'
import { rodar } from './rodar'

/**
 * `yarn fabrica` (card 121, spec P2 §9): a casca de linha de comando do despachante, no molde do
 * `yarn relatorio` da P1. Tudo o que o teste precisa trocar entra por `DepsDoCli`.
 */

export interface DepsDoCli {
  argv: readonly string[]
  raizDoRepo: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  agora: () => string
  lerMandato: () => Promise<string>
  graphql: GraphQLFn
  intervaloMs: number
  sinal: AbortSignal
  escrever: (texto: string) => void
  avisar: (texto: string) => void
}

const USO =
  'uso: yarn fabrica [iniciar <n> [--comando "<cmd>"] [--nota "<texto>"] [--ensaio] | rodar | estado | fechar <item> "<resolução>" | pausar | retomar | entrada "<texto>" | triar <item> "<resolução>"]'

type Comando =
  | { tipo: 'iniciar'; card: number; comando: string | null; nota: string | null; ensaio: boolean }
  | { tipo: 'rodar' }
  | { tipo: 'estado' }
  | { tipo: 'pausar' }
  | { tipo: 'retomar' }
  | { tipo: 'fechar'; item: string; resolucao: string }
  | { tipo: 'entrada'; texto: string }
  | { tipo: 'triar'; item: string; resolucao: string }

/** Lê os argumentos; devolve o que estava errado, em texto, quando não servem. */
function lerArgumentos(argv: readonly string[]): Comando | { erro: string } {
  const sub = argv[0] ?? 'rodar'
  const resto = argv.slice(1)
  if (sub === 'rodar' || sub === 'estado' || sub === 'pausar' || sub === 'retomar') {
    return resto.length === 0 ? { tipo: sub } : { erro: `argumento a mais: ${resto[0]}` }
  }
  if (sub === 'fechar') {
    if (resto.length < 2) return { erro: 'faltam argumentos: fechar <item> "<resolução>"' }
    if (resto.length > 2) return { erro: `argumento a mais: ${resto[2]}` }
    return { tipo: 'fechar', item: resto[0] as string, resolucao: resto[1] as string }
  }
  if (sub === 'entrada') {
    if (resto.length < 1) return { erro: 'falta o texto: entrada "<texto>"' }
    if (resto.length > 1) return { erro: `argumento a mais: ${resto[1]}` }
    return { tipo: 'entrada', texto: resto[0] as string }
  }
  if (sub === 'triar') {
    if (resto.length < 2) return { erro: 'faltam argumentos: triar <item> "<resolução>"' }
    if (resto.length > 2) return { erro: `argumento a mais: ${resto[2]}` }
    return { tipo: 'triar', item: resto[0] as string, resolucao: resto[1] as string }
  }
  if (sub !== 'iniciar') return { erro: `subcomando desconhecido: ${sub}` }

  let card: number | null = null
  let comando: string | null = null
  let nota: string | null = null
  let ensaio = false
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i] as string
    if (a === '--ensaio') {
      if (ensaio) return { erro: 'argumento a mais: --ensaio' }
      ensaio = true
    } else if (a === '--comando' || a === '--nota') {
      const valor = resto[i + 1]
      if (valor === undefined || valor.startsWith('--')) return { erro: `${a} sem valor` }
      if ((a === '--comando' ? comando : nota) !== null) return { erro: `argumento a mais: ${a}` }
      if (a === '--comando') comando = valor
      else nota = valor
      i += 1
    } else if (a.startsWith('--')) {
      return { erro: `flag desconhecida: ${a}` }
    } else if (card === null) {
      if (!/^[1-9]\d*$/.test(a)) return { erro: `número de card inválido: ${a}` }
      card = Number(a)
    } else {
      return { erro: `argumento a mais: ${a}` }
    }
  }
  if (card === null) return { erro: 'falta o número do card' }
  return { tipo: 'iniciar', card, comando, nota, ensaio }
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}

/** Estado ilegível sai com 2; todo o resto que sobe até aqui, com 1. */
function codigoDoErro(mensagem: string): number {
  return mensagem.startsWith('estado.json ilegível') ? 2 : 1
}

export async function executar(deps: DepsDoCli): Promise<number> {
  const lido = lerArgumentos(deps.argv)
  if ('erro' in lido) {
    deps.avisar(`fabrica: ${lido.erro}`)
    deps.avisar(USO)
    return 1
  }
  if (deps.platform !== 'linux') {
    deps.avisar('fabrica: roda só no Linux nesta fase (P2 do #118)')
    return 2
  }

  const workspace = dirname(deps.raizDoRepo)
  const checkoutPrincipal = join(workspace, REPO_DA_FABRICA.name)
  const proibidos = caminhosProibidos(deps.home, workspace, checkoutPrincipal)
  const pasta = pastaDaFabrica(deps.env, deps.raizDoRepo)
  try {
    recusarTemporaria(pasta)
  } catch (erro) {
    deps.avisar(`fabrica: ${mensagemDe(erro)}`)
    return 2
  }

  try {
    if (lido.tipo === 'estado') return estado(deps, pasta)
    if (lido.tipo === 'iniciar' && !lido.ensaio) mkdirSync(pasta, { recursive: true })
    if (
      lido.tipo === 'rodar' ||
      lido.tipo === 'fechar' ||
      lido.tipo === 'entrada' ||
      lido.tipo === 'triar'
    ) {
      mkdirSync(pasta, { recursive: true })
    }
    if (lido.tipo === 'pausar') {
      mkdirSync(pasta, { recursive: true })
      const r = pausar(pasta, deps.agora())
      deps.escrever(
        r.jaEstava
          ? `a fábrica já estava pausada desde ${r.desde ?? '?'}`
          : 'fábrica pausada: nada novo é despachado até yarn fabrica retomar',
      )
      return 0
    }
    if (lido.tipo === 'retomar') {
      deps.escrever(retomar(pasta) ? 'fábrica retomada' : 'a fábrica não estava pausada')
      return 0
    }

    if (lido.tipo === 'entrada') {
      const r = await alterarEntrada(pasta, (e) => {
        const x = registrarNaEntrada(e, { texto: lido.texto, agora: deps.agora() })
        return { estado: 'erro' in x ? null : x.estado, resultado: x }
      })
      if ('erro' in r) {
        deps.avisar(`fabrica: ${r.erro}`)
        return 1
      }
      deps.escrever(`${r.id} na entrada`)
      return 0
    }
    if (lido.tipo === 'triar') {
      const r = await alterarEntrada(pasta, (e) => {
        const x = triarItemDaEntrada(e, {
          id: lido.item,
          resolucao: lido.resolucao,
          agora: deps.agora(),
        })
        return { estado: 'erro' in x ? null : x.estado, resultado: x }
      })
      if ('erro' in r) {
        deps.avisar(`fabrica: ${r.erro}`)
        return 1
      }
      deps.escrever(`${lido.item} triado`)
      return 0
    }
    if (lido.tipo === 'iniciar') return await iniciar(deps, pasta, proibidos, lido)
    if (lido.tipo === 'fechar') {
      const resultado = await alterarEstado(pasta, (e) => {
        const r = fecharItem(e, lido.item, lido.resolucao, deps.agora())
        return 'erro' in r
          ? { estado: e, resultado: r.erro }
          : { estado: r.estado, resultado: null }
      })
      if (resultado !== null) {
        deps.avisar(`fabrica: ${resultado}`)
        return 1
      }
      deps.escrever(`${lido.item} fechado`)
      return 0
    }
    return await rodar({ pasta, workspace, raizDoRepo: deps.raizDoRepo, proibidos, deps })
  } catch (erro) {
    const mensagem = mensagemDe(erro)
    deps.avisar(`fabrica: ${mensagem}`)
    return codigoDoErro(mensagem)
  }
}

async function iniciar(
  deps: DepsDoCli,
  pasta: string,
  proibidos: readonly string[],
  p: Extract<Comando, { tipo: 'iniciar' }>,
): Promise<number> {
  let comando = p.comando
  if (comando === null) {
    const proposto = comandoDaEstacao(p.card, await lerItemNoBoard(deps.graphql, p.card))
    if ('erro' in proposto) {
      deps.avisar(`fabrica: ${proposto.erro}`)
      return 1
    }
    comando = proposto.comando
  }
  const comandoAvaliado = avaliarComando(comando, proibidos)
  if (!comandoAvaliado.ok) {
    deps.avisar(`fabrica: ${comandoAvaliado.motivo}`)
    return 1
  }
  if (p.nota !== null) {
    const notaAvaliada = avaliarNota(p.nota, proibidos)
    if (!notaAvaliada.ok) {
      deps.avisar(`fabrica: ${notaAvaliada.motivo}`)
      return 1
    }
  }
  if (p.ensaio) {
    deps.escrever(`#${p.card}: ${comando}`)
    return 0
  }
  const comandoFinal = comando
  type Aberta = ReturnType<typeof iniciarFrente>
  const resultado = await alterarEstado<Aberta>(pasta, (e) => {
    const r = iniciarFrente(e, {
      card: p.card,
      comando: comandoFinal,
      nota: p.nota,
      agora: deps.agora(),
    })
    return { estado: 'erro' in r ? e : r.estado, resultado: r }
  })
  if ('erro' in resultado) {
    deps.avisar(`fabrica: ${resultado.erro}`)
    return 1
  }
  deps.escrever(`frente ${resultado.frente} aberta: ${resultado.despacho} #${p.card} ${comando}`)
  return 0
}

/** Sem cadeado: a troca atômica do `estado.json` garante uma leitura inteira. */
function estado(deps: DepsDoCli, pasta: string): number {
  const e = lerEstado(pasta)
  const pausa = lerPausa(pasta)
  let entrada: ReturnType<typeof lerEntrada> = null
  let ilegivel: string | null = null
  try {
    entrada = lerEntrada(pasta)
  } catch (erro) {
    ilegivel = mensagemDe(erro)
  }
  if (pausa !== null) deps.escrever(`pausada desde ${pausa.desde ?? '?'}`)
  if (e !== null) {
    for (const f of e.frentes.filter((x) => x.encerradaEm === null)) {
      deps.escrever(`${f.id} #${f.card} aberta em ${f.criadaEm}`)
    }
    for (const d of e.despachos.filter((x) => x.estado !== 'concluido')) {
      deps.escrever(`${d.id} #${d.card} ${d.estado} ${d.comando}`)
    }
    for (const q of e.fila.filter((x) => x.fechadoEm === null)) {
      deps.escrever(
        `${q.id} #${q.card} ${q.motivo} (de ${q.despacho}, sessão ${q.sessaoClaude ?? '-'})`,
      )
    }
  }
  const abertos = abertosDaEntrada(entrada)
  for (const i of abertos) {
    const primeira = i.texto.split('\n')[0] as string
    const resumo = primeira.length > 80 ? primeira.slice(0, 79) + '…' : primeira
    deps.escrever(`${i.id} na entrada desde ${i.criadoEm}: ${resumo}`)
  }
  if (ilegivel !== null) deps.avisar(`fabrica: ${ilegivel}`)
  if (e === null && pausa === null && abertos.length === 0 && ilegivel === null) {
    deps.escrever('nada registrado')
  }
  return 0
}

/** As deps de produção. A raiz do repo vem do `scripts/fabrica.mjs`, porque o bundle mora em `node_modules`. */
export async function main(sinal: AbortSignal): Promise<number> {
  const raiz = process.env.OC_FABRICA_RAIZ
  if (raiz === undefined || raiz === '') {
    process.stderr.write('fabrica: rode pelo yarn fabrica (falta OC_FABRICA_RAIZ)\n')
    return 2
  }
  return await executar({
    argv: process.argv.slice(2),
    raizDoRepo: resolve(raiz),
    env: process.env,
    platform: process.platform,
    home: homedir(),
    agora: () => new Date().toISOString(),
    lerMandato,
    graphql: createGitHubGraphQL(createGhTokenSource()),
    intervaloMs: 5000,
    sinal,
    escrever: (t) => {
      process.stdout.write(t + '\n')
    },
    avisar: (t) => {
      process.stderr.write(t + '\n')
    },
  })
}
