/**
 * A linha de comando e o ambiente do `claude` num PTY (#97). Puro: o main resolve o binário, a
 * pasta e a porta do hook, e entrega aqui.
 */

export const HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'SessionEnd',
] as const

/**
 * Variáveis que uma sessão-pai deixa no ambiente. Com elas a CLI filha não grava transcript (P9),
 * e o app roda dentro de uma sessão quando é desenvolvido por ela.
 */
export const INHERITED_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_PID',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_EFFORT',
] as const

export interface ClaudeCommandInput {
  start: { kind: 'resume'; sessionId: string } | { kind: 'new'; sessionId: string }
  dangerous: boolean
  hookUrl: string
  model?: string
}

/** Nunca leva `--fork-session`: retomar mantém o id da conversa (P7). */
export function claudeArgs(input: ClaudeCommandInput): string[] {
  const args = [input.start.kind === 'resume' ? '--resume' : '--session-id', input.start.sessionId]
  if (input.dangerous) args.push('--permission-mode', 'bypassPermissions')
  if (input.model !== undefined) args.push('--model', input.model)
  const hooks = Object.fromEntries(
    HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: 'http', url: input.hookUrl, timeout: 5 }] }]]),
  )
  args.push('--settings', JSON.stringify({ hooks }))
  return args
}

/** O ambiente do processo, sem o que uma sessão-pai herdaria à filha. */
export function claudeEnv(base: Record<string, string>): Record<string, string> {
  const env = { ...base }
  for (const name of INHERITED_SESSION_VARS) delete env[name]
  return env
}
