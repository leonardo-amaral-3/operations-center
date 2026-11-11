import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { ipcMain } from 'electron'

import type { GraphQLFn } from '../../core/board/types'
import type { RelatorioDaSala } from '../../shared/fabrica'
import { IPC_INVOKE } from '../../shared/ipc'
import { dataValida, gerarRelatorio, REPO, type DepsDoRelatorio } from './gerar'

/**
 * O canal do relatório da sala (#126, spec-p3 §B2). Só lê (cofre, git e board) e nunca rejeita: o
 * erro vira `{ kind: 'erro' }`. As pastas saem do ambiente e nunca atravessam a ponte.
 */

export interface DepsDaSalaDoRelatorio extends DepsDoRelatorio {
  env: NodeJS.ProcessEnv
  home: string
  agora: () => Date
  /** Um voo por dia. Mora nas deps, e não no módulo, para um teste não vazar no outro. */
  emVoo: Map<string, Promise<RelatorioDaSala>>
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function gerar(
  deps: DepsDaSalaDoRelatorio,
  dia: string,
  pastaDoCofre: string,
  pastaDoRepo: string,
): Promise<RelatorioDaSala> {
  if (!deps.existe(pastaDoCofre)) {
    return { kind: 'erro', dia, erro: `a pasta do cofre não existe: ${pastaDoCofre}` }
  }
  if (!deps.existe(pastaDoRepo)) {
    return { kind: 'erro', dia, erro: `a pasta do repo não existe: ${pastaDoRepo}` }
  }
  try {
    const geradoEm = deps.agora().toISOString()
    const { markdown, semFonte } = await gerarRelatorio(deps, {
      dia,
      pastaDoCofre,
      pastaDoRepo,
      geradoEm,
    })

    return { kind: 'ok', dia, markdown, semFonte, geradoEm }
  } catch (err) {
    return { kind: 'erro', dia, erro: mensagem(err) }
  }
}

export function responderRelatorio(
  deps: DepsDaSalaDoRelatorio,
  pedido: unknown,
): Promise<RelatorioDaSala> {
  const bruto =
    typeof pedido === 'object' && pedido !== null ? (pedido as { dia?: unknown }).dia : undefined

  if (typeof bruto !== 'string' || !dataValida(bruto)) {
    return Promise.resolve({
      kind: 'erro',
      dia: String(bruto),
      erro: 'data inválida (use AAAA-MM-DD)',
    })
  }
  const dia = bruto
  const existente = deps.emVoo.get(dia)

  if (existente !== undefined) return existente

  const pastaDoCofre =
    deps.env.OC_RELATORIO_COFRE || join(deps.home, 'notoria', 'claude', 'decisoes')
  const pastaDoRepo = deps.env.OC_RELATORIO_REPO || join(deps.home, 'pessoal', REPO.name)
  const promessa = gerar(deps, dia, pastaDoCofre, pastaDoRepo).finally(() => {
    deps.emVoo.delete(dia)
  })

  deps.emVoo.set(dia, promessa)

  return promessa
}

const execFileAsync = promisify(execFile)

export function registerRelatorioIpc(deps: {
  graphql: GraphQLFn
  env: NodeJS.ProcessEnv
  home: string
  agora: () => Date
}): void {
  const completas: DepsDaSalaDoRelatorio = {
    ...deps,
    existe: existsSync,
    listarPasta: (pasta) => readdir(pasta),
    lerArquivo: (caminho) => readFile(caminho, 'utf8'),
    git: async (args, cwd) =>
      (await execFileAsync('git', [...args], { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout,
    emVoo: new Map(),
  }

  ipcMain.handle(IPC_INVOKE.readRelatorio, (_event, pedido: unknown) =>
    responderRelatorio(completas, pedido),
  )
}
