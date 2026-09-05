/**
 * De onde vem o token do GitHub.
 *
 * Do `gh`, por subprocesso, e por isso o app **nunca persiste credencial**: o segredo continua no
 * keyring do SO, que é quem o `gh` já usa. PAT em variável de ambiente deixaria o segredo em texto
 * claro; device flow seria um subsistema inteiro — OAuth App, tela de login, refresh, `safeStorage`
 * — longe do objetivo deste card.
 *
 * A consequência é aceita de olhos abertos: o token do `gh` tem escopo de escrita. Por isso o
 * "somente-leitura" do CA-2 é provado no código, pela canária, e não pela credencial.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const GH_AUSENTE = 'GitHub CLI (gh) não encontrado no PATH. Instale-o e rode `gh auth login`.'
const GH_DESLOGADO = 'gh não está autenticado. Rode `gh auth login`.'

export interface TokenSource {
  get(): Promise<string>
  /** Descarta o token em cache. Chamado quando o GitHub responde 401. */
  invalidate(): void
}

/**
 * O token é lido uma vez e guardado **em memória**, nunca em disco. O cache existe para não spawnar
 * um processo por leitura de board; `invalidate()` é o que permite ao cliente HTTP se recuperar de
 * um token que expirou com o app aberto.
 */
export function createGhTokenSource(): TokenSource {
  let cached: string | null = null

  return {
    async get(): Promise<string> {
      cached ??= await readToken()

      return cached
    },

    invalidate(): void {
      cached = null
    },
  }
}

async function readToken(): Promise<string> {
  let stdout: string

  try {
    // Sem `shell`: o gh no Windows é um `.exe` e o `execFile` o resolve pelo PATH sozinho — `shell:
    // true` só seria necessário para um shim `.cmd`, e traria interpretação de metacaracteres junto.
    ;({ stdout } = await run('gh', ['auth', 'token']))
  } catch (error) {
    throw describeFailure(error)
  }

  const token = stdout.trim()
  // `gh` logado num host que não é o github.com sai com 0 e stdout vazio.
  if (token === '') throw new Error(GH_DESLOGADO)

  return token
}

/**
 * As duas falhas que valem mensagem própria. Qualquer outra vira "não autenticado" com o stderr
 * anexado — é o que o `gh` tem a dizer, e vale mais que uma paráfrase nossa.
 */
function describeFailure(error: unknown): Error {
  if (readField(error, 'code') === 'ENOENT') return new Error(GH_AUSENTE)

  const stderr = readField(error, 'stderr')
  const detalhe = typeof stderr === 'string' ? stderr.trim() : ''

  return new Error(detalhe === '' ? GH_DESLOGADO : `${GH_DESLOGADO} (${detalhe})`)
}

function readField(error: unknown, key: string): unknown {
  if (typeof error !== 'object' || error === null) return undefined

  return (error as Record<string, unknown>)[key]
}
