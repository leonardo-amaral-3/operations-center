import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT, smokeEnv } from './smoke-env'

/**
 * Um repo git descartável com um commit de 10/11 que cita o #118, o que o `git log` do relatório lê.
 * Dividido entre `fabrica.smoke.spec.ts` e `comparacao.smoke.spec.ts` (#130): quem chama dá a pasta
 * vazia (e a apaga), para que nada da máquina entre no relatório nem no print.
 */
export function repoDoRelatorio(repo: string): string {
  const env = {
    ...smokeEnv(),
    GIT_AUTHOR_DATE: '2026-11-10T15:00:00Z',
    GIT_COMMITTER_DATE: '2026-11-10T15:00:00Z',
  }
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo, env, stdio: 'ignore' })
  }
  git('init', '-b', 'dev')
  writeFileSync(join(repo, 'arquivo.txt'), 'smoke\n')
  mkdirSync(join(repo, 'fabrica'))
  copyFileSync(
    join(REPO_ROOT, 'tests', 'fixtures', 'relatorio', 'direcao.md'),
    join(repo, 'fabrica', 'DIRECAO.md'),
  )
  git('add', 'arquivo.txt', 'fabrica/DIRECAO.md')
  git(
    '-c',
    'user.name=smoke',
    '-c',
    'user.email=smoke@example.invalid',
    'commit',
    '-m',
    'Smoke do relatório',
    '-m',
    'Card: #118',
  )
  return repo
}
