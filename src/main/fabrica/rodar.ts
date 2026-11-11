import {
  concluirDespacho,
  emVoo,
  escolherLancamentos,
  marcarLancando,
  marcarRodando,
  ocioso,
  voltarAPendente,
} from '../../core/fabrica/despachante'
import { marcaDaProva, marcaDoDespacho, TETO_DE_SESSOES } from '../../core/fabrica/mandato'
import type { Despacho, EstadoDaFabrica } from '../../core/fabrica/tipos'
import { alterarEstado, lerPausa, lerSaida, tomarRodar } from './arquivos'
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
  const memoria = { falhasDoMandato: 0, ultimoN: null as number | null, pausaAvisada: false }
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
}

/** Um passo. Devolve o código de saída quando o laço deve terminar, ou `null` para seguir. */
async function passo(ctx: ContextoDoRodar, memoria: Memoria): Promise<number | null> {
  const { deps, pasta } = ctx
  const hora = (): string => new Date(deps.agora()).toTimeString().slice(0, 8)
  const linha = (texto: string): void => deps.escrever(`${hora()} ${texto}`)

  // 1. Recolher: o que terminou vira o próximo despacho ou item da fila, numa gravação só.
  const { eventos, parado } = await alterarEstado(pasta, (e) => {
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
    return { estado, resultado: { eventos, parado: ocioso(estado) } }
  })
  eventos.forEach(linha)

  // 2. Ocioso: nada pendente nem em voo, o despachante termina.
  if (parado) {
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
  if (!temPendente) return null

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
  const comando = d?.desfecho?.tipo === 'proximo' ? d.desfecho.comando : ''
  return `${id} terminou: PROXIMO ${comando}`
}
