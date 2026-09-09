import { describe, expect, it } from 'vitest'

import {
  DIFF_MAX_LINES,
  INTERRUPTED_NOTICE,
  commandOf,
  diffOf,
  replay,
} from '../../src/core/session/transcript'
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

  describe('CA-5 — a conversa restaurada não regride', () => {
    it('o Edit relido volta com o status certo e sem diff', () => {
      // O diff é **ao vivo só**, e não por escolha de conveniência: `getSessionMessages()` devolve
      // `SessionMessage`, que não tem `tool_use_result` — nem no tipo (`sdk.d.ts`) nem medido (0 de
      // 43 mensagens numa sessão real). O `replay` nem chega a chamar o `diffOf`; a entrada nasce
      // com `diff: null` pelo `toolUses` e assim fica.
      const messages = replay([
        assistente('a1', chamada('toolu_edit', 'Edit', { file_path: '/repo/src/app.ts' })),
        resultado('u1', 'toolu_edit'),
      ])

      expect(ferramentas(messages)).toEqual([
        {
          id: 'toolu_edit',
          role: 'tool',
          name: 'Edit',
          detail: '/repo/src/app.ts',
          headline: '',
          parentId: null,
          status: 'done',
          diff: null,
        },
      ])
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
        diff: null,
      },
      { id: 'a2', role: 'assistant', text: 'tudo verde' },
    ])
  })
})

/** Um trecho do `structuredPatch`, com os dois lados de partida separados de propósito. */
function trecho(newStart: number, oldStart: number, lines: readonly unknown[]): unknown {
  return { newStart, oldStart, lines }
}

/** `n` linhas com o mesmo prefixo — o jeito de construir um patch maior que o teto sem escrevê-lo. */
function repetir(prefixo: string, n: number, rotulo = 'linha'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefixo}${rotulo} ${i + 1}`)
}

/** O par `kind`/`number` de cada linha emitida, achatado — o que quase toda asserção olha. */
function linhas(diff: ReturnType<typeof diffOf>): Array<{ kind: string; number: number }> {
  return (diff?.hunks ?? []).flatMap((hunk) =>
    hunk.lines.map(({ kind, number }) => ({ kind, number })),
  )
}

/** Quantas linhas de trecho o diff emitiu ao todo, somando os trechos. */
function emitidas(diff: ReturnType<typeof diffOf>): number {
  return (diff?.hunks ?? []).reduce((soma, hunk) => soma + hunk.lines.length, 0)
}

describe('diffOf', () => {
  describe('CA-1 — o patch vira linhas numeradas', () => {
    it('conta pelos prefixos e entrega cada linha sem o dela', () => {
      const diff = diffOf({
        type: 'update',
        structuredPatch: [
          trecho(10, 10, [' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4', ' fim']),
        ],
      })

      // As contagens são **calculadas**: o `gitDiff` que traria `additions`/`deletions` prontos
      // nunca chegou populado nesta instalação, e lê-lo daria `+0 −0` em todo caso real.
      expect(diff).toEqual({
        additions: 2,
        deletions: 1,
        truncated: 0,
        hunks: [
          {
            lines: [
              { kind: 'context', number: 10, text: 'const a = 1' },
              { kind: 'remove', number: 11, text: 'const b = 2' },
              { kind: 'add', number: 11, text: 'const b = 3' },
              { kind: 'add', number: 12, text: 'const c = 4' },
              { kind: 'context', number: 13, text: 'fim' },
            ],
          },
        ],
      })
    })

    it('os dois lados andam sozinhos: add e context pelo novo, remove pelo velho', () => {
      // `oldStart` diferente de `newStart` é o que separa uma numeração de verdade de um contador
      // só: com os dois iguais, uma implementação que numerasse tudo pelo lado novo passaria.
      const diff = diffOf({
        structuredPatch: [trecho(12, 5, [' mantida', '-saiu', '+entrou', ' fim'])],
      })

      expect(linhas(diff)).toEqual([
        { kind: 'context', number: 12 },
        { kind: 'remove', number: 6 },
        { kind: 'add', number: 13 },
        { kind: 'context', number: 14 },
      ])
    })
  })

  describe('CA-2 — arquivo novo tem tamanho, não trecho', () => {
    it('a criação conta as linhas do content e não emite trecho nenhum', () => {
      const diff = diffOf({
        type: 'create',
        structuredPatch: [],
        content: repetir('', 95).join('\n'),
      })

      expect(diff).toEqual({ additions: 95, deletions: 0, hunks: [], truncated: 0 })
    })

    it('a quebra final fecha a última linha, e não abre uma vazia', () => {
      const conta = (content: string): number | undefined =>
        diffOf({ type: 'create', structuredPatch: [], content })?.additions

      expect(conta('a\nb\n')).toBe(2)
      expect(conta('\n')).toBe(1)
      expect(conta('a')).toBe(1)
    })
  })

  describe('CA-3 — diff longo não engole a conversa', () => {
    it('corta no meio do trecho, e os totais continuam sendo os do patch inteiro', () => {
      const adicoes = DIFF_MAX_LINES + 20
      const remocoes = DIFF_MAX_LINES
      const diff = diffOf({
        structuredPatch: [
          trecho(1, 1, [...repetir('+', adicoes, 'nova'), ...repetir('-', remocoes, 'velha')]),
        ],
      })

      // O número que informa é o tamanho da mudança, não o do pedaço que coube.
      expect(diff?.additions).toBe(adicoes)
      expect(diff?.deletions).toBe(remocoes)
      expect(emitidas(diff)).toBe(DIFF_MAX_LINES)
      expect(diff?.truncated).toBe(adicoes + remocoes - DIFF_MAX_LINES)
      // Um trecho só, emitido pela metade — e não descartado por não caber inteiro.
      expect(diff?.hunks).toHaveLength(1)
    })

    it('na fronteira exata, o trecho seguinte não vira um trecho vazio', () => {
      const sobra = 5
      const diff = diffOf({
        structuredPatch: [
          trecho(1, 1, repetir('+', DIFF_MAX_LINES)),
          trecho(200, 200, repetir('+', sobra)),
        ],
      })

      expect(emitidas(diff)).toBe(DIFF_MAX_LINES)
      expect(diff?.truncated).toBe(sobra)
      // O segundo trecho não coube, e não coube **inteiro**: nada de `{ lines: [] }` no array.
      expect(diff?.hunks).toHaveLength(1)
    })
  })

  describe('CA-4 — só escrita de arquivo ganha diff', () => {
    it('o que não tem forma de escrita devolve null', () => {
      expect(diffOf({ stdout: 'ok', stderr: '' })).toBeNull()
      // Patch vazio **sem** ser criação: é o que o SDK devolve quando nada mudou.
      expect(diffOf({ type: 'update', structuredPatch: [] })).toBeNull()
      // Arquivo de zero byte não tem o que mostrar, e `+0` seria a mesma mentira que o `+0 −0`.
      expect(diffOf({ type: 'create', structuredPatch: [], content: '' })).toBeNull()
    })

    it('carga ilegível devolve null sem lançar', () => {
      expect(diffOf(undefined)).toBeNull()
      expect(diffOf(null)).toBeNull()
      expect(diffOf('nem objeto é')).toBeNull()
      expect(diffOf([1, 2, 3])).toBeNull()
      expect(diffOf({ structuredPatch: 'nem array é' })).toBeNull()
    })

    it('o trecho descartado devolve null, e não um FileDiff zerado', () => {
      // Este é o caso que o guarda final existe para pegar: o trecho sem `newStart` é descartado,
      // e sem o guarda o retorno seria `+0 −0` com zero linha — indistinguível de arquivo novo.
      expect(diffOf({ structuredPatch: [{}] })).toBeNull()
      expect(diffOf({ structuredPatch: [trecho(1, 1, [])] })).toBeNull()
      expect(
        diffOf({ structuredPatch: [{ newStart: 1, oldStart: 1, lines: 'nem array' }] }),
      ).toBeNull()
      // `NaN` não é número de linha, e um `typeof` sozinho o deixaria passar.
      expect(diffOf({ structuredPatch: [trecho(Number.NaN, 1, [' a'])] })).toBeNull()
    })

    it('a linha ilegível é pulada sem deslocar a numeração das seguintes', () => {
      // Se qualquer uma das três fosse tratada como contexto, o `+dois` sairia numerado 3, 4 ou 5 —
      // um detalhe cosmético virando erro de dado, que é o motivo de a linha desconhecida ser pulada.
      const diff = diffOf({
        structuredPatch: [trecho(1, 1, [' um', 42, '', '\\ No newline at end of file', '+dois'])],
      })

      expect(linhas(diff)).toEqual([
        { kind: 'context', number: 1 },
        { kind: 'add', number: 2 },
      ])
      expect(diff?.additions).toBe(1)
    })
  })
})
