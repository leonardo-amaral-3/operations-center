import { ipcMain } from 'electron'
import { ehSessaoClaude, montarSessao, type ProcessoLido } from '../../core/fabrica/sessoes'
import { parseRemote } from '../../core/repos/RepoIndex'
import type { SessoesDaMaquina } from '../../shared/fabrica'
import { IPC_INVOKE } from '../../shared/ipc'
import { gitOrigin } from '../repos'
import { ambiente, argv, cwdDoProcesso, pids } from './processos'

/**
 * As sessões `claude` vivas da máquina para a tela Agentes (#142). **Só lê**: `/proc` pelas
 * funções de `processos.ts` e o `origin` das pastas pelo git. Nada aqui escreve em lugar nenhum,
 * toca o board ou sinaliza processo; a canária de `fabrica-sala.test.ts` guarda isso.
 */

/** Tudo o que a leitura toca fica atrás desta interface, para o teste usar portas falsas. */
export interface PortasDasSessoes {
  plataforma: NodeJS.Platform
  home: string
  proprio: number // process.pid, nunca listado
  pids: () => number[]
  argv: (pid: number) => string[]
  ambiente: (pid: number) => string[]
  cwd: (pid: number) => string | null
  origem: (pasta: string) => Promise<string | null> // a URL do `origin`, já em cache
  agora: () => string
}

const APAGADA = ' (deleted)'

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Pasta apagada com o processo vivo conta como sem leitura (é assim que o kernel a devolve). */
function pastaLegivel(cwd: string | null): string | null {
  return cwd === null || cwd.endsWith(APAGADA) ? null : cwd
}

/** Nunca rejeita: falha vira `sem-leitura` com o motivo. */
export async function lerSessoesDaMaquina(p: PortasDasSessoes): Promise<SessoesDaMaquina> {
  if (p.plataforma !== 'linux') {
    return { kind: 'sem-leitura', motivo: 'a leitura de sessões lê /proc, só no Linux' }
  }
  try {
    const lidos: ProcessoLido[] = []
    for (const pid of p.pids()) {
      if (pid === p.proprio) continue
      const args = p.argv(pid)
      if (!ehSessaoClaude(args)) continue
      lidos.push({ pid, argv: args, ambiente: p.ambiente(pid), cwd: p.cwd(pid) })
    }

    const pastas = [
      ...new Set(lidos.map((l) => pastaLegivel(l.cwd)).filter((c): c is string => c !== null)),
    ]
    const repos = new Map<string, string | null>()
    await Promise.all(
      pastas.map(async (pasta) => {
        const url = await p.origem(pasta).catch(() => null)
        repos.set(pasta, url === null ? null : parseRemote(url))
      }),
    )

    const sessoes = lidos
      .map((l) => {
        const pasta = pastaLegivel(l.cwd)
        return montarSessao(l, pasta === null ? null : (repos.get(pasta) ?? null), p.home)
      })
      .sort((a, b) => a.pid - b.pid)
    return { kind: 'ok', lidoEm: p.agora(), sessoes }
  } catch (err) {
    return { kind: 'sem-leitura', motivo: mensagem(err) }
  }
}

/**
 * Cache do `origin` por pasta: a tela relê a cada 5 s e cada leitura seria um `git` por sessão.
 * Leituras simultâneas da mesma pasta dividem a mesma promessa; rejeição guarda `null`.
 */
export function criarOrigemEmCache(
  origem: (pasta: string) => Promise<string | null>,
  agora: () => number,
  validadeMs = 60_000,
): (pasta: string) => Promise<string | null> {
  const guardado = new Map<string, { url: string | null; em: number }>()
  const emVoo = new Map<string, Promise<string | null>>()
  return (pasta) => {
    const hit = guardado.get(pasta)
    if (hit !== undefined && agora() - hit.em < validadeMs) return Promise.resolve(hit.url)
    const pendente = emVoo.get(pasta)
    if (pendente !== undefined) return pendente
    const leitura = origem(pasta)
      .catch(() => null)
      .then((url) => {
        guardado.set(pasta, { url, em: agora() })
        return url
      })
      .finally(() => {
        emVoo.delete(pasta)
      })
    emVoo.set(pasta, leitura)
    return leitura
  }
}

export function portasReaisDasSessoes(home: string): PortasDasSessoes {
  return {
    plataforma: process.platform,
    home,
    proprio: process.pid,
    pids,
    argv,
    ambiente,
    cwd: cwdDoProcesso,
    origem: criarOrigemEmCache(gitOrigin, () => Date.now()),
    agora: () => new Date().toISOString(),
  }
}

export function registerSessoesIpc(ler: () => Promise<SessoesDaMaquina>): void {
  ipcMain.handle(IPC_INVOKE.readFabricaSessoes, (): Promise<SessoesDaMaquina> => ler())
}
