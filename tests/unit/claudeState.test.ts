import { describe, expect, it } from 'vitest'

import { nextTerminalState, parseHookBody } from '../../src/core/terminal/claudeState'
import type { ClaudeSignal } from '../../src/core/terminal/claudeState'
import type { TerminalState } from '../../src/shared/claude'

const SID = 'e98072e9-1111-4222-8333-444455556666'
const kinds: TerminalState['kind'][] = [
  'starting',
  'working',
  'awaiting_input',
  'awaiting_decision',
  'awaiting_answer',
  'closed',
]
const at = (kind: TerminalState['kind']): TerminalState => ({ kind })

describe('nextTerminalState', () => {
  it('o primeiro byte tira o processo de starting; depois disso output é identidade', () => {
    expect(nextTerminalState(at('starting'), { name: 'output' })).toEqual({
      state: at('awaiting_input'),
      turnEnded: false,
    })
    for (const kind of kinds.filter((k) => k !== 'starting')) {
      const current = at(kind)
      const out = nextTerminalState(current, { name: 'output' })
      expect(out.state).toBe(current)
      expect(out.turnEnded).toBe(false)
    }
  })

  it('prompt e ferramenta levam a working', () => {
    const sinais: ClaudeSignal[] = [
      { name: 'UserPromptSubmit', sessionId: SID, transcriptPath: 'x' },
      { name: 'PreToolUse', sessionId: SID },
      { name: 'PostToolUse', sessionId: SID },
    ]
    for (const sinal of sinais) {
      expect(nextTerminalState(at('awaiting_input'), sinal)).toEqual({
        state: at('working'),
        turnEnded: false,
      })
    }
  })

  it('PermissionRequest: AskUserQuestion é pergunta, o resto é decisão', () => {
    const ask = nextTerminalState(at('working'), {
      name: 'PermissionRequest',
      sessionId: SID,
      toolName: 'AskUserQuestion',
    })
    expect(ask.state.kind).toBe('awaiting_answer')
    const bash = nextTerminalState(at('working'), {
      name: 'PermissionRequest',
      sessionId: SID,
      toolName: 'Bash',
    })
    expect(bash).toEqual({ state: at('awaiting_decision'), turnEnded: false })
  })

  it('Stop encerra o turno', () => {
    expect(nextTerminalState(at('working'), { name: 'Stop', sessionId: SID })).toEqual({
      state: at('awaiting_input'),
      turnEnded: true,
    })
  })

  it('interrupted só vale com turno em aberto', () => {
    for (const kind of ['working', 'awaiting_decision', 'awaiting_answer'] as const) {
      expect(nextTerminalState(at(kind), { name: 'interrupted' })).toEqual({
        state: at('awaiting_input'),
        turnEnded: true,
      })
    }
    for (const kind of ['starting', 'awaiting_input', 'closed'] as const) {
      const current = at(kind)
      const out = nextTerminalState(current, { name: 'interrupted' })
      expect(out.state).toBe(current)
      expect(out.turnEnded).toBe(false)
    }
  })

  it('SessionEnd não muda nada: quem fecha é o exit do PTY', () => {
    const current = at('working')
    expect(nextTerminalState(current, { name: 'SessionEnd', sessionId: SID }).state).toBe(current)
  })

  it('exit fecha de qualquer estado, e closed é terminal', () => {
    for (const kind of kinds) {
      expect(nextTerminalState(at(kind), { name: 'exit' }).state.kind).toBe('closed')
    }
    const sinais: ClaudeSignal[] = [
      { name: 'output' },
      { name: 'interrupted' },
      { name: 'UserPromptSubmit', sessionId: SID, transcriptPath: 'x' },
      { name: 'PreToolUse', sessionId: SID },
      { name: 'PermissionRequest', sessionId: SID, toolName: 'Bash' },
      { name: 'Stop', sessionId: SID },
      { name: 'SessionEnd', sessionId: SID },
      { name: 'exit' },
    ]
    for (const sinal of sinais) {
      expect(nextTerminalState(at('closed'), sinal)).toEqual({
        state: at('closed'),
        turnEnded: false,
      })
    }
  })
})

describe('parseHookBody', () => {
  const body = (extra: Record<string, unknown>) => ({ session_id: SID, ...extra })

  it('aceita os seis nomes', () => {
    expect(
      parseHookBody(body({ hook_event_name: 'UserPromptSubmit', transcript_path: '/t.jsonl' })),
    ).toEqual({ name: 'UserPromptSubmit', sessionId: SID, transcriptPath: '/t.jsonl' })
    expect(parseHookBody(body({ hook_event_name: 'PreToolUse' }))).toEqual({
      name: 'PreToolUse',
      sessionId: SID,
    })
    expect(parseHookBody(body({ hook_event_name: 'PostToolUse' }))).toEqual({
      name: 'PostToolUse',
      sessionId: SID,
    })
    expect(
      parseHookBody(body({ hook_event_name: 'PermissionRequest', tool_name: 'Write' })),
    ).toEqual({ name: 'PermissionRequest', sessionId: SID, toolName: 'Write' })
    expect(parseHookBody(body({ hook_event_name: 'Stop' }))).toEqual({ name: 'Stop', sessionId: SID })
    expect(parseHookBody(body({ hook_event_name: 'SessionEnd' }))).toEqual({
      name: 'SessionEnd',
      sessionId: SID,
    })
  })

  it('recusa nome desconhecido, inclusive Notification e SessionStart', () => {
    expect(parseHookBody(body({ hook_event_name: 'Notification' }))).toBeNull()
    expect(parseHookBody(body({ hook_event_name: 'SessionStart' }))).toBeNull()
    expect(parseHookBody(body({}))).toBeNull()
  })

  it('recusa session_id ausente ou fora do formato de UUID', () => {
    expect(parseHookBody({ hook_event_name: 'Stop' })).toBeNull()
    expect(parseHookBody({ hook_event_name: 'Stop', session_id: '../../etc' })).toBeNull()
    expect(parseHookBody({ hook_event_name: 'Stop', session_id: 42 })).toBeNull()
  })

  it('recusa UserPromptSubmit sem transcript_path', () => {
    expect(parseHookBody(body({ hook_event_name: 'UserPromptSubmit' }))).toBeNull()
  })

  it('recusa o que não é objeto', () => {
    expect(parseHookBody(null)).toBeNull()
    expect(parseHookBody('Stop')).toBeNull()
  })
})
