import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { despachoAtualDoCard, montarCard } from '../../core/fabrica/card'
import {
  resolverAlvo,
  type AlvoDoIniciar,
  type CardDaFabrica,
} from '../../core/fabrica/cardDaFabrica'
import {
  lerRepo,
  type BoardComMandato,
  type BoardDaFabrica,
  type ConfiguracaoDaFabrica,
  type RepoDoBoard,
} from '../../core/fabrica/configuracao'
import { entradaNaSala } from '../../core/fabrica/entrada'
import { lerRevisoes } from '../../core/fabrica/revisoes'
import { montarPergunta, montarSala, urlDoCard } from '../../core/fabrica/sala'
import { TETO_DE_SESSOES, marcaDoDespacho } from '../../core/fabrica/mandato'
import type { EstadoDaFabrica } from '../../core/fabrica/tipos'
import type {
  BoardNaFabrica,
  CardNaFabrica,
  EntradaNaSala,
  EstadoDoDespachante,
  PausaDaFabrica,
  PerguntaDaFila,
  RecursosDaFabrica,
  RevisoesNaSala,
  SalaDaFabrica,
} from '../../shared/fabrica'
import { IPC_INVOKE } from '../../shared/ipc'
import { boardDoPedido, boardNaFabrica } from './boardDoApp'
import { identidade, lerEntrada, lerEstado, lerPausa, lerSaida, pastaDaFabrica } from './arquivos'
import { acharDespacho, despachoVivo } from './processos'
import { lerTextoDasRevisoes } from './revisoes'

/**
 * A leitura da sala da fábrica (card 122, spec P3 §A3). **Só lê**: das portas da P2 entram aqui as
 * quatro de leitura, e do `node:fs` só a leitura síncrona. A canária de `fabrica-sala.test.ts`
 * guarda isso.
 */

/** O app instalado não tem raiz de repo: parte de `<home>/pessoal/<repo>`, o checkout do workspace. */
export function pastaDaSala(
  env: NodeJS.ProcessEnv,
  board: Pick<BoardDaFabrica, 'pastaDoEstado'>,
): string {
  return pastaDaFabrica(env, board)
}

/**
 * O despachante está vivo quando o `rodar.pid` guarda a identidade de um processo que ainda a tem
 * (O5). A identidade vem do `/proc`, então fora do Linux a sala não afirma nada.
 */
export function estadoDoDespachante(
  pasta: string,
  plataforma: NodeJS.Platform,
): EstadoDoDespachante {
  if (plataforma !== 'linux') return 'desconhecido'
  let lido: string
  try {
    lido = readFileSync(join(pasta, 'rodar.pid'), 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'parado' : 'desconhecido'
  }
  const pid = Number.parseInt(lido, 10)
  if (!Number.isInteger(pid) || pid <= 0) return 'desconhecido'
  return identidade(pid) === lido ? 'rodando' : 'parado'
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function despachanteSeguro(pasta: string, plataforma: NodeJS.Platform): EstadoDoDespachante {
  try {
    return estadoDoDespachante(pasta, plataforma)
  } catch {
    return 'desconhecido'
  }
}

/** Na dúvida, pausada: `lerPausa` já não lança, e se lançar mesmo assim o retrato diz `desde: null`. */
function pausaSegura(pasta: string): PausaDaFabrica | null {
  try {
    return lerPausa(pasta)
  } catch {
    return { desde: null }
  }
}

/** As leituras que a sala recebe de fora: os recursos da máquina e as worktrees do workspace. */
export interface FontesDaSala {
  recursos: () => RecursosDaFabrica
  worktrees: () => readonly string[]
}

/** Recurso que lançou: tudo `sem-leitura` com a mensagem, e nunca número (CA-2.3). */
function recursosSemLeitura(motivo: string): RecursosDaFabrica {
  return {
    sessoes: { kind: 'sem-leitura', motivo, teto: TETO_DE_SESSOES },
    suite: { kind: 'sem-leitura', motivo },
    disco: { kind: 'sem-leitura', motivo },
  }
}

function recursosSeguros(fontes: FontesDaSala): RecursosDaFabrica {
  try {
    return fontes.recursos()
  } catch (err) {
    return recursosSemLeitura(mensagem(err))
  }
}

/**
 * Os despachos com sessão viva, pela mesma conferência do recolher do `rodar`: `rodando` com o pid
 * da marca, `lancando` achado pela marca. Fora do Linux ou com erro: `null` (não se sabe).
 */
function despachosVivos(e: EstadoDaFabrica, plataforma: NodeJS.Platform): Set<string> | null {
  if (plataforma !== 'linux') return null
  try {
    const vivos = new Set<string>()
    for (const d of e.despachos) {
      const marca = marcaDoDespacho(e.instancia, d.id)
      if (d.estado === 'rodando' && d.pid !== null && despachoVivo(d.pid, marca)) vivos.add(d.id)
      if (d.estado === 'lancando' && acharDespacho(marca) !== null) vivos.add(d.id)
    }
    return vivos
  } catch {
    return null
  }
}

function worktreesSeguras(fontes: Pick<FontesDaSala, 'worktrees'>): readonly string[] {
  try {
    return fontes.worktrees()
  } catch {
    return []
  }
}

/** Nunca lança: o `parseEstado` valida só o envelope, e um item torto pode derrubar o `montarSala`. */
export function lerSala(
  pasta: string,
  plataforma: NodeJS.Platform,
  agora: () => string,
  fontes: FontesDaSala,
  board: BoardDaFabrica,
): SalaDaFabrica {
  const lidoEm = agora()
  const projeto = `${board.nome} · Project ${board.projeto}`
  // O despachante e a pausa vêm antes do estado, cada um no seu `try`: os três ramos os carregam.
  const despachante = despachanteSeguro(pasta, plataforma)
  const pausa = pausaSegura(pasta)
  const recursos = recursosSeguros(fontes)
  try {
    const e = lerEstado(pasta)
    if (e === null) return { kind: 'sem-estado', lidoEm, projeto, despachante, pausa, recursos }
    const vivos = despachosVivos(e, plataforma)
    return montarSala(e, {
      despachante,
      lidoEm,
      projeto,
      pausa,
      recursos,
      worktrees: worktreesSeguras(fontes),
      vivos,
      unico: board.repoUnico,
    })
  } catch (err) {
    return { kind: 'ilegivel', lidoEm, projeto, despachante, pausa, recursos, erro: mensagem(err) }
  }
}

/** O caminho da saída sai do `estado.json`, nunca do pedido. */
export function lerPergunta(
  pasta: string,
  id: string,
  unico: RepoDoBoard | null,
): PerguntaDaFila | null {
  if (!/^q-\d+$/.test(id)) return null
  try {
    const e = lerEstado(pasta)
    if (e === null) return null
    const item = e.fila.find((i) => i.id === id)
    if (item === undefined) return null
    let saida: string | null = null
    try {
      // O `despacho` vem do `estado.json`, que pode estar torto: só `d-<n>` vira nome de pasta.
      if (/^d-\d+$/.test(item.despacho)) saida = lerSaida(pasta, item.despacho)
    } catch {
      saida = null
    }
    return montarPergunta(e, id, saida, unico)
  } catch {
    return null
  }
}

/**
 * O card na fábrica (F4). Nunca lança. O `id` do despacho vem do `estado.json`, que pode estar
 * torto: só `d-<n>` vira nome de pasta para ler a saída.
 */
export function lerCardDaFabrica(
  pasta: string,
  card: CardDaFabrica,
  plataforma: NodeJS.Platform,
  fontes: Pick<FontesDaSala, 'worktrees'>,
  unico: RepoDoBoard | null,
): CardNaFabrica {
  const cardUrl = urlDoCard(card.n, card.repo)
  try {
    const e = lerEstado(pasta)
    if (e === null) return { kind: 'sem-estado', card: card.n, cardUrl }
    const atual = despachoAtualDoCard(e, card, unico)
    let saida: string | null = null
    if (atual?.estado === 'concluido' && /^d-\d+$/.test(atual.id)) {
      try {
        saida = lerSaida(pasta, atual.id)
      } catch {
        saida = null
      }
    }
    return montarCard(e, card, {
      worktrees: worktreesSeguras(fontes),
      vivos: despachosVivos(e, plataforma),
      saida,
      unico,
    })
  } catch (err) {
    return { kind: 'ilegivel', card: card.n, cardUrl, erro: mensagem(err) }
  }
}

/** A entrada da fábrica (F4): sem arquivo é entrada vazia; arquivo torto é `ilegivel`. */
export function lerEntradaDaSala(pasta: string): EntradaNaSala {
  try {
    return entradaNaSala(lerEntrada(pasta))
  } catch (err) {
    return { kind: 'ilegivel', erro: mensagem(err) }
  }
}

/** As revisões das decisões do cofre (F5): sem arquivo é vazio; arquivo que não abre é `ilegivel`. */
export function lerRevisoesDaSala(pasta: string): RevisoesNaSala {
  try {
    const r = lerRevisoes(lerTextoDasRevisoes(pasta) ?? '')

    return { kind: 'ok', ...r }
  } catch (err) {
    return { kind: 'ilegivel', erro: mensagem(err) }
  }
}

export interface DepsDasLeituras {
  configuracao: ConfiguracaoDaFabrica
  env: NodeJS.ProcessEnv
  plataforma: NodeJS.Platform
  agora: () => string
  fontes: (board: BoardComMandato, pasta: string) => FontesDaSala
}

export interface LeiturasDaFabrica {
  board: (pedido: unknown) => BoardNaFabrica
  sala: (pedido: unknown) => SalaDaFabrica
  pergunta: (pedido: unknown) => PerguntaDaFila | null
  card: (pedido: unknown) => CardNaFabrica
  entrada: (pedido: unknown) => EntradaNaSala
  revisoes: (pedido: unknown) => RevisoesNaSala
}

function campo(pedido: unknown, nome: string): unknown {
  return typeof pedido === 'object' && pedido !== null
    ? (pedido as Record<string, unknown>)[nome]
    : undefined
}

/** O card de um pedido: inteiro > 0, senão 0. */
function cardDoPedido(pedido: unknown): number {
  const n = campo(pedido, 'card')
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0
}

/** Nenhuma lança. A pasta de cada pedido é `pastaDaSala(d.env, board)` do board resolvido. */
export function criarLeiturasDaFabrica(d: DepsDasLeituras): LeiturasDaFabrica {
  const cardPedidoInvalido = (): CardNaFabrica => ({
    kind: 'ilegivel',
    card: 0,
    cardUrl: '',
    erro: 'pedido inválido',
  })
  return {
    board: (pedido) => boardNaFabrica(d.configuracao, pedido),
    sala: (pedido) => {
      const r = boardDoPedido(d.configuracao, pedido)
      if (!r.ok) {
        return {
          kind: 'ilegivel',
          lidoEm: d.agora(),
          projeto: '',
          despachante: 'desconhecido',
          pausa: null,
          recursos: recursosSemLeitura(r.motivo),
          erro: r.motivo,
        }
      }
      const pasta = pastaDaSala(d.env, r.board)
      return lerSala(pasta, d.plataforma, d.agora, d.fontes(r.board, pasta), r.board)
    },
    pergunta: (pedido) => {
      const r = boardDoPedido(d.configuracao, pedido)
      if (!r.ok) return null
      const id = campo(pedido, 'id')
      if (typeof id !== 'string') return null
      return lerPergunta(pastaDaSala(d.env, r.board), id, r.board.repoUnico)
    },
    card: (pedido) => {
      const r = boardDoPedido(d.configuracao, pedido)
      const card = cardDoPedido(pedido)
      if (!r.ok) return { kind: 'ilegivel', card, cardUrl: '', erro: r.motivo }
      if (card === 0) return cardPedidoInvalido()
      const repoPedido = campo(pedido, 'repo')
      let alvo: AlvoDoIniciar
      if (repoPedido === null) {
        alvo = { owner: null, name: null, n: card }
      } else {
        const repo = lerRepo(repoPedido)
        if (repo === null) return cardPedidoInvalido()
        alvo = { owner: repo.owner, name: repo.name, n: card }
      }
      const a = resolverAlvo(r.board, alvo)
      if (!a.ok) return { kind: 'ilegivel', card, cardUrl: '', erro: a.motivo }
      const pasta = pastaDaSala(d.env, r.board)
      return lerCardDaFabrica(
        pasta,
        a.card,
        d.plataforma,
        d.fontes(r.board, pasta),
        r.board.repoUnico,
      )
    },
    entrada: (pedido) => {
      const r = boardDoPedido(d.configuracao, pedido)
      if (!r.ok) return { kind: 'ilegivel', erro: r.motivo }
      return lerEntradaDaSala(pastaDaSala(d.env, r.board))
    },
    revisoes: (pedido) => {
      const r = boardDoPedido(d.configuracao, pedido)
      if (!r.ok) return { kind: 'ilegivel', erro: r.motivo }
      return lerRevisoesDaSala(pastaDaSala(d.env, r.board))
    },
  }
}

export function registerFabricaIpc(l: LeiturasDaFabrica): void {
  ipcMain.handle(IPC_INVOKE.readFabricaBoard, (_event, pedido: unknown) => l.board(pedido))
  ipcMain.handle(IPC_INVOKE.readFabrica, (_event, pedido: unknown) => l.sala(pedido))
  ipcMain.handle(IPC_INVOKE.readFabricaPergunta, (_event, pedido: unknown) => l.pergunta(pedido))
  ipcMain.handle(IPC_INVOKE.readFabricaCard, (_event, pedido: unknown) => l.card(pedido))
  ipcMain.handle(IPC_INVOKE.readFabricaEntrada, (_event, pedido: unknown) => l.entrada(pedido))
  ipcMain.handle(IPC_INVOKE.readFabricaRevisoes, (_event, pedido: unknown) => l.revisoes(pedido))
}
