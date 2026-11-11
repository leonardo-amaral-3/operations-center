import {
  concluirDespacho,
  emVoo,
  escolherLancamentos,
  marcarLancando,
  marcarRodando,
  ocioso,
  voltarAPendente,
} from '../../core/fabrica/despachante'
import {
  ARQUIVO_DO_RELATO,
  comandoDaTriagem,
  concluirTriagem,
  marcarTriagemLancando,
  marcarTriagemRodando,
  NOTA_DA_TRIAGEM,
  temTriagemPorFazer,
  textoDoRelato,
  triagensEmVoo,
  triagensPorLancar,
  voltarTriagemAPendente,
  type EntradaDaFabrica,
} from '../../core/fabrica/entrada'
import { marcaDaProva, marcaDoDespacho, TETO_DE_SESSOES } from '../../core/fabrica/mandato'
import type { Despacho, EstadoDaFabrica } from '../../core/fabrica/tipos'
import {
  alterarEntrada,
  alterarEstado,
  lerEntrada,
  lerPausa,
  lerSaida,
  pastaDaSessao,
  tomarRodar,
} from './arquivos'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DepsDoCli } from './cli'
import { lancar } from './lancador'
import { acharDespacho, contarSessoesDaProva, despachoVivo } from './processos'

/**
 * O laço do despachante (card 121, spec P2 §9). Sequencial de propósito: um passo termina antes de
 * o próximo começar, nunca dois ao mesmo tempo no processo (R-5). Os sinais do sistema não são
 * daqui: o `scripts/fabrica.mjs` os traduz no `sinal` das deps.
 */

export interface ContextoDoRodar {
  pasta: string
  workspace: string
  raizDoRepo: string
  proibidos: readonly string[]
  deps: DepsDoCli
}

const FALHAS_SEGUIDAS_DO_MANDATO = 3

/** Espera `ms`, ou volta na hora quando o sinal aborta. */
function esperar(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    if (sinal.aborted) return resolver()
    const fim = (): void => {
      clearTimeout(timer)
      sinal.removeEventListener('abort', fim)
      resolver()
    }
    const timer = setTimeout(fim, ms)
    sinal.addEventListener('abort', fim)
  })
}

export async function rodar(ctx: ContextoDoRodar): Promise<number> {
  const { deps } = ctx
  const dono = tomarRodar(ctx.pasta)
  if (!dono.ok) {
    deps.avisar(`fabrica: já há um yarn fabrica rodando (pid ${dono.pid})`)
    return 4
  }
  const memoria: Memoria = {
    falhasDoMandato: 0,
    ultimoN: null,
    pausaAvisada: false,
    entradaIlegivel: null,
  }
  try {
    while (!deps.sinal.aborted) {
      const codigo = await passo(ctx, memoria)
      if (codigo !== null) return codigo
      await esperar(deps.intervaloMs, deps.sinal)
    }
    return 130
  } finally {
    dono.soltar()
  }
}

interface Memoria {
  falhasDoMandato: number
  ultimoN: number | null
  pausaAvisada: boolean
  /** A última mensagem de entrada ilegível já avisada: o aviso sai uma vez por mensagem. */
  entradaIlegivel: string | null
}

function avisarEntrada(ctx: ContextoDoRodar, memoria: Memoria, erro: unknown): void {
  const mensagem = erro instanceof Error ? erro.message : String(erro)
  if (mensagem === memoria.entradaIlegivel) return
  memoria.entradaIlegivel = mensagem
  ctx.deps.avisar(`fabrica: ${mensagem}; a triagem da entrada fica parada`)
}

/** Lê o `entrada.json`; ilegível → avisa uma vez e devolve `null` (a triagem fica parada). */
function lerEntradaDoPasso(ctx: ContextoDoRodar, memoria: Memoria): EntradaDaFabrica | null {
  try {
    const e = lerEntrada(ctx.pasta)
    memoria.entradaIlegivel = null
    return e
  } catch (erro) {
    avisarEntrada(ctx, memoria, erro)
    return null
  }
}

/** Toda escrita do `rodar` na entrada passa por aqui: erro vira aviso e `undefined`, nunca derruba. */
async function naEntrada<R>(
  ctx: ContextoDoRodar,
  memoria: Memoria,
  f: (e: EntradaDaFabrica) => { estado: EntradaDaFabrica | null; resultado: R },
): Promise<R | undefined> {
  try {
    return await alterarEntrada(ctx.pasta, f)
  } catch (erro) {
    avisarEntrada(ctx, memoria, erro)
    return undefined
  }
}

/** Um passo. Devolve o código de saída quando o laço deve terminar, ou `null` para seguir. */
async function passo(ctx: ContextoDoRodar, memoria: Memoria): Promise<number | null> {
  const { deps, pasta } = ctx
  const hora = (): string => new Date(deps.agora()).toTimeString().slice(0, 8)
  const linha = (texto: string): void => deps.escrever(`${hora()} ${texto}`)

  // 1. Recolher: o que terminou vira o próximo despacho ou item da fila, numa gravação só.
  const { eventos, parado, instancia } = await alterarEstado(pasta, (e) => {
    let estado = e
    const eventos: string[] = []
    const concluir = (id: string, saida: string): void => {
      estado = concluirDespacho(estado, id, {
        saida,
        agora: deps.agora(),
        proibidos: ctx.proibidos,
      })
      eventos.push(descrever(estado, id))
    }
    for (const d of emVoo(e)) {
      const marca = marcaDoDespacho(e.instancia, d.id)
      if (d.estado === 'rodando') {
        if (d.pid !== null && despachoVivo(d.pid, marca)) continue
        concluir(d.id, lerSaida(pasta, d.id) ?? '')
        continue
      }
      // `lancando`: a queda foi entre o início do lançamento e a gravação do pid.
      const pid = acharDespacho(marca)
      if (pid !== null) {
        estado = marcarRodando(estado, d.id, pid)
        continue
      }
      const saida = lerSaida(pasta, d.id)
      // Sem `saida.json` o `spawn` não aconteceu. Com ele, nunca se relança: a sessão pode ter
      // rodado e morrido, e relançá-la poderia repetir um commit.
      if (saida === null) estado = voltarAPendente(estado, d.id)
      else concluir(d.id, saida)
    }
    return { estado, resultado: { eventos, parado: ocioso(estado), instancia: e.instancia } }
  })
  eventos.forEach(linha)

  // 1b. Recolher as triagens da entrada, pela mesma regra dos despachos.
  const emVooNaEntrada = lerEntradaDoPasso(ctx, memoria)
  if (emVooNaEntrada !== null && triagensEmVoo(emVooNaEntrada).length > 0) {
    const eventosDaEntrada = await naEntrada(ctx, memoria, (e) => {
      let estado = e
      const eventos: string[] = []
      let mudou = false
      const concluir = (id: string, saida: string): void => {
        const r = concluirTriagem(estado, id, { saida, agora: deps.agora() })
        estado = r.estado
        eventos.push(r.evento)
        mudou = true
      }
      for (const item of triagensEmVoo(e)) {
        const t = item.triagem
        if (t === null) continue
        const marca = t.marca ?? marcaDoDespacho(instancia, item.id)
        if (t.estado === 'rodando') {
          if (t.pid !== null && despachoVivo(t.pid, marca)) continue
          concluir(item.id, lerSaida(pasta, item.id) ?? '')
          continue
        }
        const pid = acharDespacho(marca)
        if (pid !== null) {
          estado = marcarTriagemRodando(estado, item.id, pid)
          mudou = true
          continue
        }
        const saida = lerSaida(pasta, item.id)
        if (saida === null) {
          estado = voltarTriagemAPendente(estado, item.id)
          mudou = true
        } else concluir(item.id, saida)
      }
      return { estado: mudou ? estado : null, resultado: eventos }
    })
    eventosDaEntrada?.forEach(linha)
  }
  const entrada = lerEntradaDoPasso(ctx, memoria)

  // 2. Ocioso: nada pendente nem em voo (nem triagem por fazer), o despachante termina.
  if (parado && !temTriagemPorFazer(entrada)) {
    linha('nada pendente nem em voo; fim')
    return 0
  }

  // Pausada: o recolher acima rodou igual, mas nada novo é lançado. Avisa uma vez por pausa.
  if (lerPausa(pasta) !== null) {
    if (!memoria.pausaAvisada) linha('pausada: nada novo é despachado')
    memoria.pausaAvisada = true
    return null
  }
  memoria.pausaAvisada = false

  // 3. Lançar, só com algum pendente.
  const temPendente = await alterarEstado(pasta, (e) => ({
    estado: e,
    resultado: e.despachos.some((d) => d.estado === 'pendente'),
  }))
  if (!temPendente && triagensPorLancar(entrada).length === 0) return null

  let mandato: string
  let marcaDaProvaAtual: string
  try {
    mandato = await deps.lerMandato()
    marcaDaProvaAtual = marcaDaProva(mandato)
  } catch (erro) {
    memoria.falhasDoMandato += 1
    const mensagem = erro instanceof Error ? erro.message : String(erro)
    deps.avisar(`${hora()} ${mensagem}; nada foi despachado neste passo`)
    return memoria.falhasDoMandato >= FALHAS_SEGUIDAS_DO_MANDATO ? 3 : null
  }
  memoria.falhasDoMandato = 0

  const n = contarSessoesDaProva(marcaDaProvaAtual)
  if (n >= TETO_DE_SESSOES && n !== memoria.ultimoN) {
    linha(`esperando vaga: ${n} sessões da prova vivas (teto ${TETO_DE_SESSOES})`)
  }
  memoria.ultimoN = n

  const ids = await alterarEstado(pasta, (e) => ({
    estado: e,
    resultado: escolherLancamentos(e, n),
  }))
  for (const id of ids) {
    // Depois de Ctrl-C ou SIGTERM nada novo nasce; o que sobrou continua pendente.
    if (deps.sinal.aborted) break
    // Uma pausa gravada enquanto o `lerMandato` ia à rede: o que sobrou continua pendente.
    if (lerPausa(pasta) !== null) break
    const preparado = await alterarEstado(pasta, (e) => {
      const d = e.despachos.find((x) => x.id === id)
      if (d === undefined || d.estado !== 'pendente') return { estado: e, resultado: null }
      const estado = marcarLancando(e, id, deps.agora())
      return {
        estado,
        resultado: {
          despacho: estado.despachos.find((x) => x.id === id) as Despacho,
          marca: marcaDoDespacho(e.instancia, id),
        },
      }
    })
    if (preparado === null) continue

    const resultado = await lancar(preparado.despacho, {
      pasta,
      workspace: ctx.workspace,
      raizDoRepo: ctx.raizDoRepo,
      mandato,
      marca: preparado.marca,
      env: deps.env,
      claudeBin: claudeDe(deps.env),
    })
    if ('pid' in resultado) {
      await alterarEstado(pasta, (e) => ({
        estado: marcarRodando(e, id, resultado.pid),
        resultado: null,
      }))
      linha(
        `lançado ${id} #${preparado.despacho.card} ${preparado.despacho.comando} (pid ${resultado.pid})`,
      )
    } else {
      const saida = JSON.stringify({ type: 'result', is_error: true, subtype: resultado.erro })
      const evento = await alterarEstado(pasta, (e) => {
        const estado = concluirDespacho(e, id, {
          saida,
          agora: deps.agora(),
          proibidos: ctx.proibidos,
        })
        return { estado, resultado: descrever(estado, id) }
      })
      linha(evento)
    }
  }

  // 4. As triagens da entrada, nas vagas que os despachos deixaram.
  const vagasDaTriagem = Math.max(0, TETO_DE_SESSOES - n - ids.length)
  const porLancar = triagensPorLancar(lerEntradaDoPasso(ctx, memoria)).slice(0, vagasDaTriagem)
  for (const item of porLancar) {
    if (deps.sinal.aborted || lerPausa(pasta) !== null) break
    const sessao = pastaDaSessao(pasta, item.id)
    const comando = comandoDaTriagem(sessao)
    const marca = marcaDoDespacho(instancia, item.id)
    // Este comando não passa pelo `avaliarComando`: a skill é constante e o caminho é da própria pasta.
    const marcada = await naEntrada(ctx, memoria, (e) => {
      const atual = e.itens.find((i) => i.id === item.id)
      if (atual === undefined || atual.triadoEm !== null || atual.triagem !== null) {
        return { estado: null, resultado: false }
      }
      return {
        estado: marcarTriagemLancando(e, item.id, { marca, agora: deps.agora() }),
        resultado: true,
      }
    })
    if (marcada === undefined) break
    if (!marcada) continue

    const concluirComErro = async (subtype: string): Promise<void> => {
      const saida = JSON.stringify({ type: 'result', is_error: true, subtype })
      const evento = await naEntrada(ctx, memoria, (e) => {
        const r = concluirTriagem(e, item.id, { saida, agora: deps.agora() })
        return { estado: r.estado, resultado: r.evento }
      })
      if (evento !== undefined) linha(evento)
    }

    if (lerSaida(pasta, item.id) !== null) {
      await concluirComErro(
        `já existe sessoes/${item.id}/saida.json de outra sessão; o item não foi relançado`,
      )
      continue
    }
    try {
      mkdirSync(sessao, { recursive: true })
      writeFileSync(join(sessao, ARQUIVO_DO_RELATO), textoDoRelato(item))
    } catch (erro) {
      await concluirComErro(
        `não foi possível preparar o relato: ${erro instanceof Error ? erro.message : String(erro)}`,
      )
      continue
    }
    const resultado = await lancar(
      { id: item.id, comando, nota: NOTA_DA_TRIAGEM },
      {
        pasta,
        workspace: ctx.workspace,
        raizDoRepo: ctx.raizDoRepo,
        mandato,
        marca,
        env: deps.env,
        claudeBin: claudeDe(deps.env),
      },
    )
    if ('pid' in resultado) {
      await naEntrada(ctx, memoria, (e) => ({
        estado: marcarTriagemRodando(e, item.id, resultado.pid),
        resultado: null,
      }))
      linha(`lançada a triagem ${item.id} (pid ${resultado.pid})`)
    } else {
      await concluirComErro(resultado.erro)
    }
  }
  return null
}

function claudeDe(env: NodeJS.ProcessEnv): string {
  const configurado = env.OC_CLAUDE_BIN
  return configurado !== undefined && configurado !== '' ? configurado : 'claude'
}

/** A linha de evento de um despacho recém-concluído: o próximo passo da frente, ou o item da fila. */
function descrever(estado: EstadoDaFabrica, id: string): string {
  const item = estado.fila.find((q) => q.despacho === id)
  if (item !== undefined) return `${id} terminou: fila ${item.id} — ${item.motivo}`
  const d = estado.despachos.find((x) => x.id === id)
  if (d?.desfecho?.tipo === 'parada') {
    const g4 = estado.despachos.findLast((x) => x.frente === d.frente && x.estado === 'pendente')
    return `${id} terminou: segue para o G4 (${g4?.comando ?? ''})`
  }
  const comando = d?.desfecho?.tipo === 'proximo' ? d.desfecho.comando : ''
  return `${id} terminou: PROXIMO ${comando}`
}
