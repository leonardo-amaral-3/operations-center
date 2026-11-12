import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { GraphQLFn } from '../../core/board/types'
import {
  abertosDaEntrada,
  registrarNaEntrada,
  triarItemDaEntrada,
} from '../../core/fabrica/entrada'
import { fecharItem, iniciarFrente } from '../../core/fabrica/despachante'
import {
  contestacoesAbertas,
  lerRevisoes,
  NOME_DO_COFRE,
  novaRevisao,
} from '../../core/fabrica/revisoes'
import { comandoDaEstacao } from '../../core/fabrica/estacao'
import { avaliarComando, avaliarNota, caminhosProibidos } from '../../core/fabrica/mandato'
import {
  resolverBoard,
  type BoardDaFabrica,
  type ConfiguracaoDaFabrica,
  type OrigemDoMandato,
} from '../../core/fabrica/configuracao'
import {
  cardDoRegistro,
  lerAlvo,
  resolverAlvo,
  rotuloDoCard,
  type AlvoDoIniciar,
  type CardDaFabrica,
} from '../../core/fabrica/cardDaFabrica'
import { configuracaoDaFabrica } from './configuracao'
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
import { pastasDoRelatorio } from '../relatorio/gerar'
import { acrescentarRevisao, lerTextoDasRevisoes } from './revisoes'
import { rodar } from './rodar'

/**
 * `yarn fabrica` (card 121, spec P2 §9): a casca de linha de comando do despachante, no molde do
 * `yarn relatorio` da P1. Tudo o que o teste precisa trocar entra por `DepsDoCli`.
 */

export interface DepsDoCli {
  argv: readonly string[]
  raizDoRepo: string
  configuracao: ConfiguracaoDaFabrica
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  agora: () => string
  lerMandato: (origem: OrigemDoMandato) => Promise<string>
  graphql: GraphQLFn
  intervaloMs: number
  sinal: AbortSignal
  escrever: (texto: string) => void
  avisar: (texto: string) => void
}

const USO =
  'uso: yarn fabrica [--board <owner>/<n>] [iniciar <n>|<repo>#<n> [--comando "<cmd>"] [--nota "<texto>"] [--ensaio] | rodar | estado | fechar <item> "<resolução>" | pausar | retomar | entrada "<texto>" | triar <item> "<resolução>" | confirmar <arquivo> | contestar <arquivo> "<motivo>" | atender <arquivo> "<resolução>"]'

type Comando =
  | {
      tipo: 'iniciar'
      alvo: AlvoDoIniciar
      comando: string | null
      nota: string | null
      ensaio: boolean
    }
  | { tipo: 'rodar' }
  | { tipo: 'estado' }
  | { tipo: 'pausar' }
  | { tipo: 'retomar' }
  | { tipo: 'fechar'; item: string; resolucao: string }
  | { tipo: 'entrada'; texto: string }
  | { tipo: 'triar'; item: string; resolucao: string }
  | { tipo: 'confirmar'; arquivo: string }
  | { tipo: 'contestar'; arquivo: string; motivo: string }
  | { tipo: 'atender'; arquivo: string; resolucao: string }

/** Lê os argumentos; devolve o que estava errado, em texto, quando não servem. */
function lerArgumentos(
  argv: readonly string[],
): { board: string | null; comando: Comando } | { erro: string } {
  if (argv[0] !== '--board') return lerComando(argv, null)
  const valor = argv[1]
  if (valor === undefined) return { erro: '--board sem valor' }
  if (!/^[A-Za-z0-9-]+\/[1-9]\d*$/.test(valor)) {
    return { erro: `--board inválido: ${valor} (use <owner>/<número do Project>)` }
  }
  return lerComando(argv.slice(2), valor)
}

function lerComando(
  argv: readonly string[],
  board: string | null,
): { board: string | null; comando: Comando } | { erro: string } {
  const lido = lerSubcomando(argv)
  return 'erro' in lido ? lido : { board, comando: lido }
}

function lerSubcomando(argv: readonly string[]): Comando | { erro: string } {
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
  if (sub === 'confirmar') {
    if (resto.length < 1) return { erro: 'falta o arquivo: confirmar <arquivo>' }
    if (resto.length > 1) return { erro: `argumento a mais: ${resto[1]}` }
    return { tipo: 'confirmar', arquivo: resto[0] as string }
  }
  if (sub === 'contestar') {
    if (resto.length < 2) return { erro: 'faltam argumentos: contestar <arquivo> "<motivo>"' }
    if (resto.length > 2) return { erro: `argumento a mais: ${resto[2]}` }
    return { tipo: 'contestar', arquivo: resto[0] as string, motivo: resto[1] as string }
  }
  if (sub === 'atender') {
    if (resto.length < 2) return { erro: 'faltam argumentos: atender <arquivo> "<resolução>"' }
    if (resto.length > 2) return { erro: `argumento a mais: ${resto[2]}` }
    return { tipo: 'atender', arquivo: resto[0] as string, resolucao: resto[1] as string }
  }
  if (sub !== 'iniciar') return { erro: `subcomando desconhecido: ${sub}` }

  let alvo: AlvoDoIniciar | null = null
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
    } else if (alvo === null) {
      const lidoAlvo = lerAlvo(a)
      if (lidoAlvo === null) return { erro: `número de card inválido: ${a}` }
      alvo = lidoAlvo
    } else {
      return { erro: `argumento a mais: ${a}` }
    }
  }
  if (alvo === null) return { erro: 'falta o número do card' }
  return { tipo: 'iniciar', alvo, comando, nota, ensaio }
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}

/** Estado ilegível sai com 2; todo o resto que sobe até aqui, com 1. */
function codigoDoErro(mensagem: string): number {
  return mensagem.startsWith('estado.json ilegível') ? 2 : 1
}

export async function executar(deps: DepsDoCli): Promise<number> {
  const argumentos = lerArgumentos(deps.argv)
  if ('erro' in argumentos) {
    deps.avisar(`fabrica: ${argumentos.erro}`)
    deps.avisar(USO)
    return 1
  }
  if (deps.platform !== 'linux') {
    deps.avisar('fabrica: roda só no Linux nesta fase (P2 do #118)')
    return 2
  }

  const lido = argumentos.comando
  const resolvido = resolverBoard(deps.configuracao, argumentos.board)
  if (!resolvido.ok) {
    deps.avisar(`fabrica: ${resolvido.motivo}`)
    return 2
  }
  const board = resolvido.board
  const workspace = board.workspace
  const pasta = pastaDaFabrica(deps.env, board)
  try {
    recusarTemporaria(pasta)
  } catch (erro) {
    deps.avisar(`fabrica: ${mensagemDe(erro)}`)
    return 2
  }
  let cardIniciado: CardDaFabrica | null = null
  if (lido.tipo === 'iniciar') {
    const alvo = resolverAlvo(board, lido.alvo)
    if (!alvo.ok) {
      deps.avisar(`fabrica: ${alvo.motivo}`)
      return 1
    }
    cardIniciado = alvo.card
  }

  try {
    if (lido.tipo === 'estado') return estado(deps, pasta, board)
    if (lido.tipo === 'confirmar' || lido.tipo === 'contestar' || lido.tipo === 'atender') {
      return revisar(deps, pasta, lido)
    }
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
    if (lido.tipo === 'iniciar' && cardIniciado !== null) {
      return await iniciar(deps, pasta, board, cardIniciado, lido)
    }
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
    return await rodar({ pasta, workspace, raizDoRepo: deps.raizDoRepo, board, deps })
  } catch (erro) {
    const mensagem = mensagemDe(erro)
    deps.avisar(`fabrica: ${mensagem}`)
    return codigoDoErro(mensagem)
  }
}

/** Confirmar, contestar ou atender uma decisão do cofre: acrescenta ao `revisoes.jsonl` (spec F5 §F5.5). */
function revisar(
  deps: DepsDoCli,
  pasta: string,
  lido: Extract<Comando, { tipo: 'confirmar' | 'contestar' | 'atender' }>,
): number {
  const { arquivo } = lido
  if (!NOME_DO_COFRE.test(arquivo)) {
    deps.avisar(`fabrica: nome de arquivo do cofre inválido: ${arquivo}`)
    return 1
  }
  const { cofre } = pastasDoRelatorio(deps.env, deps.home)
  // O `atender` não confere: a decisão pode ter saído do cofre depois da contestação.
  if (lido.tipo !== 'atender' && !existsSync(join(cofre, arquivo))) {
    deps.avisar(`fabrica: não há ${arquivo} no cofre (${cofre})`)
    return 1
  }
  const atual = lerRevisoes(lerTextoDasRevisoes(pasta) ?? '').revisoes
  const agora = deps.agora()
  const r = novaRevisao(
    atual,
    lido.tipo === 'confirmar'
      ? { tipo: 'confirmar', arquivo, agora }
      : lido.tipo === 'contestar'
        ? { tipo: 'contestar', arquivo, motivo: lido.motivo, agora }
        : { tipo: 'atender', arquivo, resolucao: lido.resolucao, agora },
  )
  if ('erro' in r) {
    deps.avisar(`fabrica: ${r.erro}`)
    return 1
  }
  acrescentarRevisao(pasta, r.linha)
  // Sem cadeado, outro escritor pode ter chegado antes; a primeira linha vence, então relê.
  const depois = lerRevisoes(lerTextoDasRevisoes(pasta) ?? '').revisoes.find(
    (x) => x.arquivo === arquivo,
  )
  if (depois === undefined) {
    deps.avisar(`fabrica: a revisão de ${arquivo} não voltou na releitura do revisoes.jsonl`)
    return 1
  }
  if (lido.tipo === 'atender') {
    if (depois.atendida?.em !== r.linha.em) {
      deps.avisar(
        `fabrica: outra revisão de ${arquivo} chegou antes: já foi atendida em ${depois.atendida?.em ?? '?'}`,
      )
      return 1
    }
  } else if (depois.veredito !== r.linha.tipo || depois.em !== r.linha.em) {
    deps.avisar(
      `fabrica: outra revisão de ${arquivo} chegou antes: ${depois.veredito} em ${depois.em}`,
    )
    return 1
  }
  deps.escrever(`${arquivo} ${r.linha.tipo}`)
  return 0
}

async function iniciar(
  deps: DepsDoCli,
  pasta: string,
  board: BoardDaFabrica,
  card: CardDaFabrica,
  p: Extract<Comando, { tipo: 'iniciar' }>,
): Promise<number> {
  const rotulo = rotuloDoCard(card, board.repoUnico)
  const proibidos = caminhosProibidos(deps.home, board, card.repo)
  let comando = p.comando
  if (comando === null) {
    const proposto = comandoDaEstacao(
      card.n,
      await lerItemNoBoard(deps.graphql, card, board.projeto),
    )
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
    deps.escrever(`${rotulo}: ${comando}`)
    return 0
  }
  const comandoFinal = comando
  type Aberta = ReturnType<typeof iniciarFrente>
  const resultado = await alterarEstado<Aberta>(pasta, (e) => {
    const r = iniciarFrente(e, {
      card,
      unico: board.repoUnico,
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
  deps.escrever(`frente ${resultado.frente} aberta: ${resultado.despacho} ${rotulo} ${comando}`)
  return 0
}

/** Sem cadeado: a troca atômica do `estado.json` garante uma leitura inteira. */
function estado(deps: DepsDoCli, pasta: string, board: BoardDaFabrica): number {
  const e = lerEstado(pasta)
  const pausa = lerPausa(pasta)
  let entrada: ReturnType<typeof lerEntrada> = null
  let ilegivel: string | null = null
  try {
    entrada = lerEntrada(pasta)
  } catch (erro) {
    ilegivel = mensagemDe(erro)
  }
  const rotuloDe = (x: { id: string; repo?: string; card: number }): string =>
    rotuloDoCard(cardDoRegistro(x, board.repoUnico), board.repoUnico)
  // As linhas saem todas montadas antes da primeira escrita: registro sem repo num board de vários repos lança aqui.
  const linhas: string[] = []
  if (e !== null) {
    for (const f of e.frentes.filter((x) => x.encerradaEm === null)) {
      linhas.push(`${f.id} ${rotuloDe(f)} aberta em ${f.criadaEm}`)
    }
    for (const d of e.despachos.filter((x) => x.estado !== 'concluido')) {
      linhas.push(`${d.id} ${rotuloDe(d)} ${d.estado} ${d.comando}`)
    }
    for (const q of e.fila.filter((x) => x.fechadoEm === null)) {
      linhas.push(
        `${q.id} ${rotuloDe(q)} ${q.motivo} (de ${q.despacho}, sessão ${q.sessaoClaude ?? '-'})`,
      )
    }
  }
  if (pausa !== null) deps.escrever(`pausada desde ${pausa.desde ?? '?'}`)
  for (const l of linhas) deps.escrever(l)
  let lidas: ReturnType<typeof lerRevisoes> = { revisoes: [], ilegiveis: 0 }
  let erroDasRevisoes: string | null = null
  try {
    lidas = lerRevisoes(lerTextoDasRevisoes(pasta) ?? '')
  } catch (erro) {
    erroDasRevisoes = mensagemDe(erro)
  }
  const abertos = abertosDaEntrada(entrada)
  for (const i of abertos) {
    const primeira = i.texto.split('\n')[0] as string
    const resumo = primeira.length > 80 ? primeira.slice(0, 79) + '…' : primeira
    const t = i.triagem
    let sufixo = ''
    if (t !== null && t !== undefined) {
      if (t.estado === 'concluida') {
        const motivo = (t.parou ?? '').split('\n')[0] as string
        const curto = motivo.length > 80 ? motivo.slice(0, 79) + '…' : motivo
        sufixo = ` (a triagem parou: ${curto})`
      } else {
        sufixo = ` (em triagem, pid ${t.pid ?? '-'})`
      }
    }
    deps.escrever(`${i.id} na entrada desde ${i.criadoEm}: ${resumo}${sufixo}`)
  }
  const contestadas = contestacoesAbertas(lidas.revisoes)
  for (const c of contestadas) {
    const primeira = (c.motivo ?? '').split('\n')[0] as string
    const resumo = primeira.length > 80 ? primeira.slice(0, 79) + '…' : primeira
    deps.escrever(`contestada ${c.arquivo} em ${c.em}: ${resumo}`)
  }
  if (ilegivel !== null) deps.avisar(`fabrica: ${ilegivel}`)
  if (erroDasRevisoes !== null) deps.avisar(`fabrica: revisoes.jsonl: ${erroDasRevisoes}`)
  if (lidas.ilegiveis === 1) deps.avisar('fabrica: revisoes.jsonl tem 1 linha ilegível')
  else if (lidas.ilegiveis > 1) {
    deps.avisar(`fabrica: revisoes.jsonl tem ${lidas.ilegiveis} linhas ilegíveis`)
  }
  if (
    e === null &&
    pausa === null &&
    abertos.length === 0 &&
    ilegivel === null &&
    contestadas.length === 0 &&
    erroDasRevisoes === null &&
    lidas.ilegiveis === 0
  ) {
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
  let configuracao: ConfiguracaoDaFabrica
  try {
    configuracao = configuracaoDaFabrica(homedir())
  } catch (erro) {
    process.stderr.write(`fabrica: ${mensagemDe(erro)}\n`)
    return 2
  }
  return await executar({
    argv: process.argv.slice(2),
    raizDoRepo: resolve(raiz),
    configuracao,
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
