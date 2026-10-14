import { describe, expect, it } from 'vitest'

import {
  claudeArgs,
  claudeEnv,
  HOOK_EVENTS,
  INHERITED_SESSION_VARS,
} from '../../src/core/terminal/claudeCommand'

const SID = 'e98072e9-1111-4222-8333-444455556666'
const URL_HOOK = 'http://127.0.0.1:5555/hook/tok'
const base = { hookUrl: URL_HOOK, dangerous: false }

describe('claudeArgs', () => {
  it('retomar gera --resume <id> e nunca --fork-session', () => {
    const args = claudeArgs({ ...base, start: { kind: 'resume', sessionId: SID } })
    expect(args.slice(0, 2)).toEqual(['--resume', SID])
    expect(args).not.toContain('--fork-session')
    expect(args).not.toContain('--session-id')
  })

  it('conversa nova gera --session-id <uuid>', () => {
    const args = claudeArgs({ ...base, start: { kind: 'new', sessionId: SID } })
    expect(args.slice(0, 2)).toEqual(['--session-id', SID])
    expect(args).not.toContain('--resume')
  })

  it('a marca de perigo gera --permission-mode bypassPermissions; sem ela, nada', () => {
    const start = { kind: 'new', sessionId: SID } as const
    const perigo = claudeArgs({ ...base, start, dangerous: true })
    expect(perigo[perigo.indexOf('--permission-mode') + 1]).toBe('bypassPermissions')
    expect(claudeArgs({ ...base, start })).not.toContain('--permission-mode')
  })

  it('--model só aparece quando dado', () => {
    const start = { kind: 'new', sessionId: SID } as const
    expect(claudeArgs({ ...base, start })).not.toContain('--model')
    const args = claudeArgs({ ...base, start, model: 'haiku' })
    expect(args[args.indexOf('--model') + 1]).toBe('haiku')
  })

  it('--settings traz os seis eventos, type http e a URL', () => {
    const args = claudeArgs({ ...base, start: { kind: 'new', sessionId: SID } })
    const settings = JSON.parse(args[args.indexOf('--settings') + 1] as string) as {
      hooks: Record<string, { hooks: { type: string; url: string; timeout: number }[] }[]>
    }
    expect(Object.keys(settings.hooks)).toEqual([...HOOK_EVENTS])
    expect(HOOK_EVENTS).toHaveLength(6)
    for (const event of HOOK_EVENTS) {
      expect(settings.hooks[event]).toEqual([
        { hooks: [{ type: 'http', url: URL_HOOK, timeout: 5 }] },
      ])
    }
  })
})

describe('claudeEnv', () => {
  it('remove as 11 variáveis herdadas e preserva o resto', () => {
    expect(INHERITED_SESSION_VARS).toHaveLength(11)
    const entrada: Record<string, string> = {
      PATH: '/usr/bin',
      CLAUDE_CODE_USE_BEDROCK: '1',
      ...Object.fromEntries(INHERITED_SESSION_VARS.map((nome) => [nome, 'x'])),
    }
    const saida = claudeEnv(entrada)
    for (const nome of INHERITED_SESSION_VARS) expect(saida).not.toHaveProperty(nome)
    expect(saida).toEqual({ PATH: '/usr/bin', CLAUDE_CODE_USE_BEDROCK: '1' })
    expect(entrada.CLAUDECODE).toBe('x')
  })
})
