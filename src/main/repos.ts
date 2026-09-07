/**
 * O lado sujo da descoberta de pasta: `node:fs` e um subprocesso `git`.
 *
 * As duas funções que o `RepoIndex` recebe injetadas nascem aqui, pelo mesmo motivo que o token do
 * `gh` nasce em `github/token.ts` — o core não conhece disco nem processo, e é isso que mantém a
 * regra do índice testável sem uma máquina de verdade por perto.
 *
 * A varredura é **tolerante por princípio**: pasta órfã, arquivo ilegível, linha truncada e git
 * ausente são todos "esta pasta não diz de qual repo é", nunca exceção. Uma varredura que
 * explodisse na primeira anomalia derrubaria o índice inteiro por causa de uma pasta que ninguém
 * lembra de ter criado.
 */

import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'

import type { SessionFolder } from '../core'

const run = promisify(execFile)

/**
 * Quantas linhas do transcript valem a busca pelo `cwd`.
 *
 * A primeira linha do arquivo pode ser um `queue-operation`, que não tem `cwd`; toda linha de
 * mensagem tem. 50 é folga de sobra para atravessar o preâmbulo e mantém o custo em uma leitura
 * curta por pasta, mesmo quando o `.jsonl` tem dezenas de megabytes.
 */
const MAX_LINES = 50

/**
 * Onde ficam os transcripts.
 *
 * `OC_CLAUDE_PROJECTS` é a porta do smoke, o análogo do `OC_BOARD_FIXTURE`: com ela a descoberta
 * roda inteira — varredura, `git remote`, normalização — sobre um cenário descartável. Sem ela,
 * `CLAUDE_CONFIG_DIR` é honrado porque o próprio SDK o honra: ignorá-lo faria o app procurar sessão
 * onde o Claude Code não escreve.
 */
export function projectsRoot(): string {
  return (
    process.env.OC_CLAUDE_PROJECTS ||
    join(process.env.CLAUDE_CONFIG_DIR || defaultConfigDir(), 'projects')
  )
}

function defaultConfigDir(): string {
  return join(homedir(), '.claude')
}

/**
 * A varredura, pronta para virar o `scan` do `RepoIndex`.
 *
 * A raiz é resolvida uma vez, na criação: é ambiente de processo, e mudá-lo com o app de pé não é
 * caso que exista. O parâmetro está aqui para o teste, não para o produto.
 */
export function scanSessionFolders(
  root: string = projectsRoot(),
): () => Promise<readonly SessionFolder[]> {
  return async () => {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      // Raiz inexistente é o estado de uma máquina que nunca rodou o Claude Code. Índice vazio faz
      // todo cartão cair no CA-5, que é exatamente o comportamento certo ali.
      return []
    }

    const folders: SessionFolder[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const folder = await readFolder(join(root, entry.name))
      if (folder !== null) folders.push(folder)
    }

    return folders
  }
}

/**
 * O `origin` de um diretório, pelo git.
 *
 * Sem `shell`, pela mesma razão do `token.ts`: o caminho vem de uma varredura de disco e um
 * metacaractere no nome de pasta não tem por que virar comando. Qualquer falha — não é repo, não
 * tem remoto, git fora do PATH — é `null`, porque para o índice as três dizem a mesma coisa.
 */
export async function gitOrigin(path: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', path, 'remote', 'get-url', 'origin'])
    const url = stdout.trim()

    return url === '' ? null : url
  } catch {
    return null
  }
}

/**
 * Uma pasta de sessão vira `SessionFolder` pelo `.jsonl` mais recente dela.
 *
 * O nome da pasta **não** é decodificado: `C--Users-lokin-notoria-processos-modulo-processos` não
 * distingue `:\` de `\` de `-`, e uma pasta com hífen no nome não tem volta. O `cwd` de dentro do
 * arquivo é o caminho absoluto exato.
 *
 * Subpasta sem `.jsonl` nenhum é pulada em silêncio — existe na máquina hoje.
 */
async function readFolder(dir: string): Promise<SessionFolder | null> {
  const newest = await newestTranscript(dir)
  if (newest === null) return null

  const cwd = await readCwd(newest.file)

  return cwd === null ? null : { path: cwd, usedAt: newest.usedAt }
}

/** O `.jsonl` de `mtime` mais recente da pasta — a sessão mais nova dela, e a idade do desempate. */
async function newestTranscript(dir: string): Promise<{ file: string; usedAt: number } | null> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }

  let newest: { file: string; usedAt: number } | null = null

  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue

    const file = join(dir, name)
    let usedAt: number
    try {
      usedAt = (await stat(file)).mtimeMs
    } catch {
      // Arquivo que sumiu entre o `readdir` e o `stat`: o Claude Code escreve nesta pasta enquanto
      // o app roda, e uma corrida aqui não vale derrubar a pasta inteira.
      continue
    }

    if (newest === null || usedAt > newest.usedAt) newest = { file, usedAt }
  }

  return newest
}

/**
 * A primeira `cwd` do transcript.
 *
 * Lido em fluxo e abandonado assim que a resposta aparece: transcript de sessão longa passa dos
 * megabytes, e o que interessa está nas primeiras linhas.
 */
async function readCwd(file: string): Promise<string | null> {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    let read = 0

    for await (const line of lines) {
      const cwd = cwdOf(line)
      if (cwd !== null) return cwd

      read += 1
      if (read >= MAX_LINES) return null
    }

    return null
  } catch {
    return null
  } finally {
    lines.close()
    // `close()` do readline não destrói a entrada, e sair no meio de um arquivo grande deixaria o
    // descritor aberto — dezenas deles, uma vez por varredura.
    stream.destroy()
  }
}

/**
 * O `cwd` de uma linha do transcript, se ela tiver um.
 *
 * Dado de fora chega como `unknown` e passa por guarda explícita. Linha que não é JSON válido —
 * arquivo truncado no meio de uma escrita — é pulada pela mesma razão que a pasta órfã é.
 */
function cwdOf(line: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const cwd = (parsed as Record<string, unknown>)['cwd']

  return typeof cwd === 'string' && cwd !== '' ? cwd : null
}
