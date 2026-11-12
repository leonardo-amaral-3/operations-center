import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { GraphQLFn } from '../../core/board/types'
import { createGitHubGraphQL } from '../github/graphql'
import { createGhTokenSource } from '../github/token'
import { dataValida, gerarRelatorio } from './gerar'

/**
 * O comando `yarn relatorio` (#120, spec-p1 §8): o relatório de um dia da fábrica em markdown no
 * stdout. Só lê (cofre, board e git); nada daqui escreve em nenhum dos três. O relatório é o da
 * fábrica, que é este repo (Technical Decisions, 11).
 */

const USO = 'uso: yarn relatorio [AAAA-MM-DD] [--cofre <pasta>]'

export interface DepsDoCli {
  argv: readonly string[]
  agora: () => Date
  home: string
  cwd: string
  existe: (caminho: string) => boolean
  listarPasta: (pasta: string) => Promise<string[]>
  lerArquivo: (caminho: string) => Promise<string>
  git: (args: readonly string[], cwd: string) => Promise<string>
  graphql: GraphQLFn
  escrever: (texto: string) => void
  avisar: (texto: string) => void
}

type Argumentos = { dia: string | null; cofre: string | null } | { erro: string[] }

function lerArgumentos(argv: readonly string[]): Argumentos {
  let dia: string | null = null
  let cofre: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string

    if (arg === '--cofre') {
      const valor = argv[i + 1]

      if (valor === undefined) return { erro: ['relatorio: --cofre precisa de uma pasta', USO] }
      cofre = valor
      i++
    } else if (!arg.startsWith('-') && dia === null) {
      dia = arg
    } else {
      return { erro: [`relatorio: argumento desconhecido: ${arg}`, USO] }
    }
  }

  return { dia, cofre }
}

export async function executar(deps: DepsDoCli): Promise<number> {
  const args = lerArgumentos(deps.argv)

  if ('erro' in args) {
    for (const linha of args.erro) deps.avisar(linha)

    return 1
  }

  const dia = args.dia ?? deps.agora().toISOString().slice(0, 10)

  if (args.dia !== null && !dataValida(args.dia)) {
    deps.avisar(`relatorio: data inválida: ${args.dia} (use AAAA-MM-DD)`)

    return 1
  }

  const pastaDoCofre = args.cofre ?? join(deps.home, 'notoria', 'claude', 'decisoes')

  if (!deps.existe(pastaDoCofre)) {
    deps.avisar(`relatorio: a pasta do cofre não existe: ${pastaDoCofre}`)

    return 1
  }

  try {
    const { markdown, semFonte } = await gerarRelatorio(deps, {
      dia,
      pastaDoCofre,
      pastaDoRepo: deps.cwd,
      geradoEm: deps.agora().toISOString(),
    })

    deps.escrever(markdown)
    if (semFonte === 1) deps.avisar('relatorio: 1 linha sem fonte ficou de fora')
    else if (semFonte > 1) deps.avisar(`relatorio: ${semFonte} linhas sem fonte ficaram de fora`)

    return 0
  } catch (erro) {
    deps.avisar(`relatorio: ${erro instanceof Error ? erro.message : String(erro)}`)

    return 1
  }
}

const execFileAsync = promisify(execFile)

export async function main(): Promise<void> {
  const deps: DepsDoCli = {
    argv: process.argv.slice(2),
    agora: () => new Date(),
    home: homedir(),
    cwd: process.cwd(),
    existe: existsSync,
    listarPasta: (pasta) => readdir(pasta),
    lerArquivo: (caminho) => readFile(caminho, 'utf8'),
    git: async (args, cwd) =>
      (await execFileAsync('git', [...args], { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout,
    graphql: createGitHubGraphQL(createGhTokenSource()),
    escrever: (texto) => {
      process.stdout.write(texto)
    },
    avisar: (texto) => {
      process.stderr.write(texto + '\n')
    },
  }

  process.exitCode = await executar(deps)
}
