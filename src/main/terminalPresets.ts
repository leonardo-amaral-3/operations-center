import { dirname, join } from 'node:path'
import { parseAwsConfig } from '../core'
import type { TerminalPreset } from '../shared/ipc'

/**
 * Os perfis de terminal (spec #74 §2, CA-1): o que o humano escolhe na seta `▾` e o que cada escolha
 * põe no ambiente do shell.
 *
 * O ponto de experiência de desenvolvedor está em `aws:*`: o perfil nasce com `AWS_PROFILE`,
 * `MSYS_NO_PATHCONV` e `PYTHONIOENCODING` já no ambiente, e é isso que faz `aws sso login` seguido
 * de uma consulta rodar sem configurar nada. `git-bash` **não** leva `MSYS_NO_PATHCONV`: a decisão de
 * 2026-10-01 mediu que ele quebra o `curl.exe` do mingw e dá `STACK_FORA` falso no `e2e-local.sh`.
 */

/** O perfil como o main o conhece: o executável e o ambiente nunca atravessam a ponte. */
export interface ResolvedPreset extends TerminalPreset {
  /** Caminho **absoluto**: o `terminal:open` faz `exists(shell)`, e um nome relativo daria falso. */
  shell: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
}

/** As pontas de IO, injetadas para o teste (o mesmo desenho de `ClaudeBinProbes`). */
export interface PresetDeps {
  /** A primeira linha que o `where` devolve, ou `null` quando não acha. */
  which(exe: string): string | null
  exists(path: string): boolean
  /** O texto de `~/.aws/config`, ou `null` quando não existe. */
  awsConfig(): string | null
  programFiles: string
  systemRoot: string
}

/** Sobe a partir do `git.exe` até achar `bin\bash.exe` — cobre `Git\cmd\` e `Git\mingw64\bin\`. */
function acharBash(deps: PresetDeps): string {
  const git = deps.which('git.exe')
  if (git !== null) {
    let dir = dirname(git)
    for (;;) {
      const candidato = join(dir, 'bin', 'bash.exe')
      if (deps.exists(candidato)) return candidato
      const pai = dirname(dir)
      if (pai === dir) break
      dir = pai
    }
  }
  return join(deps.programFiles, 'Git', 'bin', 'bash.exe')
}

export function buildPresets(deps: PresetDeps): ResolvedPreset[] {
  const pwsh = deps.which('pwsh.exe')
  const bash = acharBash(deps)
  const argsBash = ['--login', '-i'] as const

  const presets: ResolvedPreset[] = [
    {
      id: 'powershell',
      label: 'PowerShell',
      group: 'shell',
      shell:
        pwsh ?? join(deps.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo'],
      env: {},
    },
    { id: 'git-bash', label: 'Git Bash', group: 'shell', shell: bash, args: argsBash, env: {} },
  ]

  for (const perfil of parseAwsConfig(deps.awsConfig() ?? '')) {
    presets.push({
      id: `aws:${perfil.name}`,
      label: `AWS · ${perfil.name}`,
      group: 'aws',
      shell: bash,
      args: argsBash,
      env: {
        AWS_PROFILE: perfil.name,
        MSYS_NO_PATHCONV: '1',
        PYTHONIOENCODING: 'utf-8',
        // A variável vence o arquivo na AWS CLI: pô-la cega mudaria a região de um perfil que
        // declara outra.
        ...(perfil.region === null ? { AWS_REGION: 'us-east-1' } : {}),
      },
    })
  }

  return presets
}

/** O ambiente herdado pelo shell: o do app, sem o que sequestraria um `yarn smoke` digitado lá. */
export function childEnv(
  preset: ResolvedPreset,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [chave, valor] of Object.entries(base)) {
    // `ELECTRON_RENDERER_URL` faria o smoke digitado no terminal carregar o dev server (pegadinha do #37).
    if (
      valor === undefined ||
      chave === 'ELECTRON_RUN_AS_NODE' ||
      chave === 'ELECTRON_RENDERER_URL'
    )
      continue
    env[chave] = valor
  }
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...preset.env }
}

/** Um `ResolvedPreset` visto do renderer: rótulo e grupo, nunca o executável nem o ambiente. */
export function toPublicPreset(preset: ResolvedPreset): TerminalPreset {
  return { id: preset.id, label: preset.label, group: preset.group }
}
