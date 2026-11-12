import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { RepoDoBoard } from '../../core/fabrica/configuracao'
import { FERRAMENTAS_DO_G4, lerComandoDoG4, promptDoG4 } from '../../core/fabrica/g4'
import { montarPrompt } from '../../core/fabrica/mandato'
import type { Despacho } from '../../core/fabrica/tipos'
import { pastaDaSessao } from './arquivos'

/**
 * Lança uma sessão `claude -p` da fábrica (card 121, spec P2 §8). A sessão sobe **destacada**, com a
 * saída em arquivo e sem `ref` do pai: matar o despachante não mata trabalho em voo (N6), e o
 * `saida.json` aberto é a fronteira que o `rodar` usa para nunca relançar o que pode ter rodado.
 */

export interface ContextoDoLancamento {
  pasta: string
  /** O repo do board: o G4 lê a PR e o card nele. */
  repo: RepoDoBoard
  workspace: string
  raizDoRepo: string
  mandato: string
  /** O valor de `OC_FABRICA_DESPACHO`: `<instância>/<id>`. */
  marca: string
  env: NodeJS.ProcessEnv
  claudeBin: string
}

/**
 * O ambiente da sessão: sem `CLAUDE*` (o `grep -o "^CLAUDE[A-Z_]*"` do `d.sh`), sem `npm_*` nem
 * `INIT_CWD` que o yarn injeta, e com o `PATH` sem as entradas do yarn (`<tmp>/yarn--…` e o
 * `.bin` da worktree do despachante), que fariam a sessão resolver binário dentro dela (R-14).
 */
export function envLimpo(env: NodeJS.ProcessEnv, raizDoRepo: string): NodeJS.ProcessEnv {
  const prefixoDoYarn = join(tmpdir(), 'yarn--')
  const binDaWorktree = join(raizDoRepo, 'node_modules', '.bin')
  const limpo: NodeJS.ProcessEnv = {}
  for (const [chave, valor] of Object.entries(env)) {
    if (/^CLAUDE/.test(chave) || /^npm_/.test(chave) || chave === 'INIT_CWD') continue
    limpo[chave] = valor
  }
  if (limpo.PATH !== undefined) {
    limpo.PATH = limpo.PATH.split(delimiter)
      .filter((entrada) => !entrada.startsWith(prefixoDoYarn) && entrada !== binDaWorktree)
      .join(delimiter)
  }
  return limpo
}

export async function lancar(
  d: Pick<Despacho, 'id' | 'comando' | 'nota'>,
  ctx: ContextoDoLancamento,
): Promise<{ pid: number } | { erro: string }> {
  const pastaDaSessaoAtual = pastaDaSessao(ctx.pasta, d.id)
  let fdSaida: number | undefined
  let fdErro: number | undefined
  try {
    mkdirSync(pastaDaSessaoAtual, { recursive: true })
    const g4 = lerComandoDoG4(d.comando)
    const prompt = montarPrompt(
      g4 === null ? d.comando : promptDoG4(g4.card, g4.pr, ctx.repo),
      ctx.mandato,
      d.nota,
    )
    writeFileSync(join(pastaDaSessaoAtual, 'prompt.txt'), prompt)

    // Daqui em diante `saida.json` existe, e é isso que diz ao `rodar` que o lançamento aconteceu.
    fdSaida = openSync(join(pastaDaSessaoAtual, 'saida.json'), 'w')
    fdErro = openSync(join(pastaDaSessaoAtual, 'erro.txt'), 'w')
    const args = [
      '-p',
      prompt,
      '--permission-mode',
      'auto',
      '--permission-prompts',
      'none',
      ...(g4 === null ? [] : ['--tools', FERRAMENTAS_DO_G4.join(',')]),
      `--add-dir=${ctx.pasta}`,
      `--add-dir=${join(ctx.workspace, 'planning')}`,
      '--output-format',
      'json',
    ]
    const filho = spawn(ctx.claudeBin, args, {
      cwd: ctx.workspace,
      env: { ...envLimpo(ctx.env, ctx.raizDoRepo), OC_FABRICA_DESPACHO: ctx.marca },
      detached: true,
      stdio: ['ignore', fdSaida, fdErro],
    })
    // Sem `error` ouvido, um binário inexistente derrubaria o processo todo.
    const falhou = new Promise<Error>((resolver) => filho.once('error', resolver))
    if (filho.pid === undefined) {
      const err = await falhou
      return { erro: `não foi possível lançar o claude: ${err.message}` }
    }
    filho.unref()
    return { pid: filho.pid }
  } catch (err) {
    // Falha de disco ou permissão antes do spawn vira `erro`, e o `rodar` a leva à fila.
    return { erro: `não foi possível preparar o lançamento: ${(err as Error).message}` }
  } finally {
    if (fdSaida !== undefined) closeSync(fdSaida)
    if (fdErro !== undefined) closeSync(fdErro)
  }
}
