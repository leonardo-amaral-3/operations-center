import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { despachoAtualDoCard, montarCard } from '../../core/fabrica/card'
import type { CardDaFabrica } from '../../core/fabrica/cardDaFabrica'
import type { BoardDaFabrica, BoardDeUmRepo, RepoDoBoard } from '../../core/fabrica/configuracao'
import { entradaNaSala } from '../../core/fabrica/entrada'
import { lerRevisoes } from '../../core/fabrica/revisoes'
import { montarPergunta, montarSala, urlDoCard } from '../../core/fabrica/sala'
import { TETO_DE_SESSOES, marcaDoDespacho } from '../../core/fabrica/mandato'
import type { EstadoDaFabrica } from '../../core/fabrica/tipos'
import type {
  CardNaFabrica,
  EntradaNaSala,
  EstadoDoDespachante,
  PausaDaFabrica,
  PerguntaDaFila,
  ReadCardDaFabricaRequest,
  ReadPerguntaRequest,
  RecursosDaFabrica,
  RevisoesNaSala,
  SalaDaFabrica,
} from '../../shared/fabrica'
import { IPC_INVOKE } from '../../shared/ipc'
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

export function registerFabricaIpc(
  pasta: string,
  fontes: FontesDaSala,
  board: BoardDeUmRepo,
): void {
  ipcMain.handle(IPC_INVOKE.readFabrica, (): SalaDaFabrica =>
    lerSala(pasta, process.platform, () => new Date().toISOString(), fontes, board),
  )
  ipcMain.handle(
    IPC_INVOKE.readFabricaPergunta,
    (_event, pedido: ReadPerguntaRequest): PerguntaDaFila | null =>
      typeof pedido?.id === 'string' ? lerPergunta(pasta, pedido.id, board.repoUnico) : null,
  )
  ipcMain.handle(
    IPC_INVOKE.readFabricaCard,
    (_event, pedido: ReadCardDaFabricaRequest): CardNaFabrica =>
      Number.isInteger(pedido?.card) && pedido.card > 0
        ? lerCardDaFabrica(
            pasta,
            { repo: board.repoUnico, n: pedido.card },
            process.platform,
            fontes,
            board.repoUnico,
          )
        : { kind: 'ilegivel', card: 0, cardUrl: '', erro: 'pedido inválido' },
  )
  ipcMain.handle(IPC_INVOKE.readFabricaEntrada, (): EntradaNaSala => lerEntradaDaSala(pasta))
  ipcMain.handle(IPC_INVOKE.readFabricaRevisoes, (): RevisoesNaSala => lerRevisoesDaSala(pasta))
}
