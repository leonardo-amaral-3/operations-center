import { describe, expect, it } from 'vitest'

import { INTERRUPTED_NOTICE, commandOf, replay } from '../../src/core/session/transcript'
import type { TranscriptEntry } from '../../src/core/session/transcript'
import type { ChatMessage, ChatToolUse } from '../../src/shared/session'

/**
 * As formas abaixo são as que os transcripts reais devolvem, e não as que seriam convenientes: o
 * `content` de usuário aparece como string crua **e** como array de blocos, e o envelope de slash
 * command aparece nas duas ordens. É por isso que cada uma tem o seu construtor aqui.
 */
function entrada(
  type: TranscriptEntry['type'],
  uuid: string,
  message: unknown,
  parentId: string | null = null,
): TranscriptEntry {
  return { type, uuid, message, parent_tool_use_id: parentId }
}

/** Fala do usuário na forma `content` string — a mais comum. */
function fala(uuid: string, text: string): TranscriptEntry {
  return entrada('user', uuid, { role: 'user', content: text })
}

/** A mesma fala na outra forma medida: `content` como array com bloco `text`. */
function falaEmBloco(uuid: string, text: string): TranscriptEntry {
  return entrada('user', uuid, { role: 'user', content: [{ type: 'text', text }] })
}

function assistente(uuid: string, ...content: readonly unknown[]): TranscriptEntry {
  return entrada('assistant', uuid, { role: 'assistant', content })
}

function texto(text: string): unknown {
  return { type: 'text', text }
}

function chamada(id: string, name: string, input: unknown = {}): unknown {
  return { type: 'tool_use', id, name, input }
}

/** O `tool_result` de uma chamada. No sucesso o SDK **não manda** `is_error`, e por isso ele falta. */
function resultado(uuid: string, toolUseId: string, isError = false): TranscriptEntry {
  const block = isError
    ? { type: 'tool_result', tool_use_id: toolUseId, is_error: true }
    : { type: 'tool_result', tool_use_id: toolUseId }

  return entrada('user', uuid, { role: 'user', content: [block] })
}

/** O par que interessa na maioria das asserções: quem falou e o quê. */
function falas(messages: readonly ChatMessage[]): Array<{ role: string; text: string }> {
  return messages
    .filter((message): message is Exclude<ChatMessage, ChatToolUse> => message.role !== 'tool')
    .map(({ role, text }) => ({ role, text }))
}

function ferramentas(messages: readonly ChatMessage[]): ChatToolUse[] {
  return messages.filter((message): message is ChatToolUse => message.role === 'tool')
}

describe('replay de um transcript', () => {
  describe('CA-6.1 — o slash command aparece como a pessoa o digitou', () => {
    it('lê por tag, e não por posição: as duas ordens de envelope dão o mesmo comando', () => {
      const mensagemAntes = [
        '<command-message>gm-spec</command-message>',
        '<command-name>/gm-spec</command-name>',
        '<command-args>#11</command-args>',
      ].join('\n')

      const nomeAntes = [
        '<command-name>/gm-spec</command-name>',
        '<command-message>gm-spec</command-message>',
        '<command-args>#11</command-args>',
      ].join('\n')

      const messages = replay([fala('u1', mensagemAntes), fala('u2', nomeAntes)])

      expect(falas(messages)).toEqual([
        { role: 'user', text: '/gm-spec #11' },
        { role: 'user', text: '/gm-spec #11' },
      ])
    })

    it('sem argumento, mostra só o nome do comando', () => {
      const envelope = [
        '<command-name>/clear</command-name>',
        '<command-message>clear</command-message>',
        '<command-args></command-args>',
        '<local-command-stdout></local-command-stdout>',
      ].join('\n')

      expect(falas(replay([fala('u1', envelope)]))).toEqual([{ role: 'user', text: '/clear' }])
    })

    it('texto que não é envelope continua sendo a fala crua', () => {
      expect(commandOf('faz o que eu pedi')).toBeNull()
      expect(falas(replay([fala('u1', 'faz o que eu pedi')]))).toEqual([
        { role: 'user', text: 'faz o que eu pedi' },
      ])
    })
  })

  describe('CA-6.2 — a interrupção é nota, e não fala do usuário', () => {
    it('vira notice nas duas formas em que o texto chega', () => {
      const messages = replay([
        fala('u1', '[Request interrupted by user]'),
        falaEmBloco('u2', '[Request interrupted by user for tool use]'),
      ])

      expect(falas(messages)).toEqual([
        { role: 'notice', text: INTERRUPTED_NOTICE },
        { role: 'notice', text: INTERRUPTED_NOTICE },
      ])
    })

    it('a notificação de tarefa também é nota, mas mantém o próprio texto', () => {
      const aviso = '<task-notification>o agente terminou</task-notification>'

      expect(falas(replay([fala('u1', aviso)]))).toEqual([{ role: 'notice', text: aviso }])
    })
  })

  describe('CA-6.3 — nenhuma entrada de ferramenta fica rodando', () => {
    it('o resultado decide o degrau: sem is_error é done, com ele é error', () => {
      const messages = replay([
        assistente('a1', chamada('toolu_ok', 'Read', { file_path: '/tmp/a.ts' })),
        resultado('u1', 'toolu_ok'),
        assistente('a2', chamada('toolu_err', 'Bash', { command: 'yarn test' })),
        resultado('u2', 'toolu_err', true),
      ])

      expect(
        ferramentas(messages).map(({ name, detail, status }) => ({ name, detail, status })),
      ).toEqual([
        { name: 'Read', detail: '/tmp/a.ts', status: 'done' },
        { name: 'Bash', detail: 'yarn test', status: 'error' },
      ])
    })

    it('a chamada que nunca relatou volta como aborted, e não como running', () => {
      const messages = replay([
        assistente('a1', chamada('toolu_cortada', 'Bash', { command: 'yarn dev' })),
        fala('u1', '[Request interrupted by user]'),
      ])

      expect(ferramentas(messages).map((tool) => tool.status)).toEqual(['aborted'])
    })
  })

  describe('CA-6.4 — o ruído do transcript não vira bolha', () => {
    it('o raciocínio não é fala, e a entrada de sistema não é nada', () => {
      const messages = replay([
        assistente('a1', { type: 'thinking', thinking: 'deixa eu ver' }),
        entrada('system', 's1', { subtype: 'init', session_id: 'abc' }),
        assistente('a2', texto('achei')),
      ])

      expect(messages).toEqual([{ id: 'a2', role: 'assistant', text: 'achei' }])
    })

    it('resultado sem a chamada correspondente é no-op', () => {
      const messages = replay([
        assistente('a1', texto('vou ler o arquivo')),
        resultado('u1', 'toolu_de_outra_sessao'),
      ])

      expect(messages).toEqual([{ id: 'a1', role: 'assistant', text: 'vou ler o arquivo' }])
    })
  })

  it('devolve a conversa na ordem em que ela aconteceu', () => {
    const messages = replay([
      fala('u1', 'roda os testes'),
      assistente('a1', texto('vou rodar'), chamada('toolu_01', 'Bash', { command: 'yarn test' })),
      resultado('u2', 'toolu_01'),
      assistente('a2', texto('tudo verde')),
    ])

    expect(messages).toEqual([
      { id: 'u1', role: 'user', text: 'roda os testes' },
      { id: 'a1', role: 'assistant', text: 'vou rodar' },
      {
        id: 'toolu_01',
        role: 'tool',
        name: 'Bash',
        detail: 'yarn test',
        headline: '',
        parentId: null,
        status: 'done',
      },
      { id: 'a2', role: 'assistant', text: 'tudo verde' },
    ])
  })
})
