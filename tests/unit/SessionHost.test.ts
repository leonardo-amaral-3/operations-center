import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTING_SOURCES, SessionHost } from '../../src/core/session/SessionHost'
import type { SessionHandle } from '../../src/core/session/SessionHandle'
import type { SessionState } from '../../src/core/session/state'
import { assistantMessage, createFakeQuery, successResult } from '../fakes/fakeQuery'
import type { FakeQuery } from '../fakes/fakeQuery'

const CWD = '/tmp/sessao'

/** Espera o estado que interessa. Sem timer: quem acorda o teste é o próprio canal da sessão. */
function untilState(
  handle: SessionHandle,
  matches: (state: SessionState) => boolean,
): Promise<SessionState> {
  return new Promise((resolve) => {
    if (matches(handle.state)) {
      resolve(handle.state)
      return
    }

    const off = handle.on('state', (state) => {
      if (!matches(state)) return
      off()
      resolve(state)
    })
  })
}

const isKind =
  (kind: SessionState['kind']) =>
  (state: SessionState): boolean =>
    state.kind === kind

function start(fake: FakeQuery, model?: string): SessionHandle {
  return new SessionHost({ query: fake.query, model }).start({ cwd: CWD })
}

describe('SessionHost', () => {
  it('chama o query com as opções que o SDK precisa ver — e sem as que matariam o canUseTool', () => {
    const fake = createFakeQuery()
    start(fake, 'modelo-barato')

    const options = fake.options
    expect(options?.cwd).toBe(CWD)
    expect(options?.model).toBe('modelo-barato')
    expect(options?.permissionMode).toBe('default')
    expect(options?.includePartialMessages).toBe(false)
    expect(options?.canUseTool).toBeTypeOf('function')

    // `settingSources` explícito, e o default carrega as settings e os CLAUDE.md do usuário: uma
    // sessão isolada seria um Claude Code amputado, incapaz de rodar as skills que o app hospeda.
    expect(options?.settingSources).toEqual([...DEFAULT_SETTING_SOURCES])

    // Ferramenta pré-aprovada não dispara o `canUseTool`, e sem ele a decisao nunca chega à tela.
    // Chave de API e binário fixado também ficam de fora: as credenciais são as do Claude Code local.
    expect(options?.allowedTools).toBeUndefined()
    expect(options?.pathToClaudeCodeExecutable).toBeUndefined()
    expect(options?.env).toBeUndefined()
  })

  it('respeita o settingSources que o host receber — é assim que o smoke se isola', () => {
    const fake = createFakeQuery()
    new SessionHost({ query: fake.query, settingSources: [] }).start({ cwd: CWD })

    expect(fake.options?.settingSources).toEqual([])
  })

  it('apresenta a sessão quando o init chega, e passa a trabalhar', async () => {
    const fake = createFakeQuery({ init: { model: 'fake-model', apiKeySource: 'none' } })
    const handle = start(fake)

    const visto = new Promise((resolve) => {
      handle.on('init', resolve)
    })
    await untilState(handle, isKind('working'))

    expect(handle.init).toEqual({
      sessionId: 'fake-session',
      model: 'fake-model',
      cwd: '/tmp/fake-cwd',
      apiKeySource: 'none',
    })
    expect(await visto).toEqual(handle.init)
  })

  it('entrega ao query o que o usuário enviou, na ordem', async () => {
    const fake = createFakeQuery()
    const handle = start(fake)

    handle.send('primeira')
    handle.send('segunda')
    await untilState(handle, () => handle.messages.length === 4)

    expect(fake.received).toEqual(['primeira', 'segunda'])
    expect(handle.state).toEqual({ kind: 'awaiting_input' })
  })

  it('acumula a conversa: o que foi enviado e o que o assistente respondeu', async () => {
    const fake = createFakeQuery({
      turn: (text) => Promise.resolve([assistantMessage(`li: ${text}`), successResult()]),
    })
    const handle = start(fake)

    const anunciadas: string[] = []
    handle.on('message', (message) => anunciadas.push(message.text))

    handle.send('oi')
    await untilState(handle, isKind('awaiting_input'))

    expect(handle.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
      { role: 'user', text: 'oi' },
      { role: 'assistant', text: 'li: oi' },
    ])
    expect(anunciadas).toEqual(['oi', 'li: oi'])
  })

  it('mantém a sessão trabalhando enquanto houver turnos na fila', async () => {
    const fake = createFakeQuery({
      turn: (text) => Promise.resolve([assistantMessage(`li: ${text}`), successResult(1)]),
    })
    const handle = start(fake)

    handle.send('oi')
    await untilState(handle, (state) => state.kind === 'working' && handle.messages.length === 2)

    expect(handle.state).toEqual({ kind: 'working' })
  })

  it('close() termina o query e fecha a sessão', async () => {
    const fake = createFakeQuery()
    const handle = start(fake)
    await untilState(handle, isKind('working'))

    await handle.close()

    expect(fake.finished).toBe(true)
    expect(handle.state).toEqual({ kind: 'closed' })
  })

  it('a permissão pendente espera a decisao e a devolve ao SDK', async () => {
    const decisoes: string[] = []
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        const decisao = await tools.askPermission({
          toolName: 'Write',
          toolUseID: 'toolu_01',
          title: 'Claude wants to write smoke.txt',
          displayName: 'Write file',
        })
        decisoes.push(decisao.behavior)
        return [assistantMessage(`escrito: ${text}`), successResult()]
      },
    })
    const handle = start(fake)

    handle.send('crie o arquivo')
    const esperando = await untilState(handle, isKind('awaiting_decision'))

    expect(esperando).toEqual({
      kind: 'awaiting_decision',
      request: {
        id: 'toolu_01',
        toolName: 'Write',
        title: 'Claude wants to write smoke.txt',
        displayName: 'Write file',
        description: undefined,
      },
    })
    // O turno está parado: sem decisao humana, nada de resposta.
    expect(decisoes).toEqual([])

    handle.respondPermission('toolu_01', 'allow')
    await untilState(handle, isKind('awaiting_input'))

    expect(decisoes).toEqual(['allow'])
    expect(handle.messages.at(-1)?.text).toBe('escrito: crie o arquivo')
  })

  it('negar devolve a recusa ao SDK e a sessão volta a trabalhar', async () => {
    const decisoes: string[] = []
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        decisoes.push(
          (await tools.askPermission({ toolName: 'Write', toolUseID: 'toolu_02' })).behavior,
        )
        return [assistantMessage(`sem escrever: ${text}`), successResult()]
      },
    })
    const handle = start(fake)

    handle.send('crie o arquivo')
    await untilState(handle, isKind('awaiting_decision'))
    handle.respondPermission('toolu_02', 'deny')

    await untilState(handle, isKind('awaiting_input'))
    expect(decisoes).toEqual(['deny'])
  })

  it('fechar com uma permissão pendente nega o pedido em vez de travar o turno', async () => {
    const decisoes: string[] = []
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        decisoes.push(
          (await tools.askPermission({ toolName: 'Write', toolUseID: 'toolu_03' })).behavior,
        )
        return [assistantMessage(text), successResult()]
      },
    })
    const handle = start(fake)

    handle.send('crie o arquivo')
    await untilState(handle, isKind('awaiting_decision'))

    await handle.close()

    expect(decisoes).toEqual(['deny'])
    expect(fake.finished).toBe(true)
    expect(handle.state).toEqual({ kind: 'closed' })
  })

  it('um AskUserQuestion vira pergunta na tela, e a resposta volta ao SDK do jeito exato', async () => {
    const resultados: PermissionResult[] = []
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        resultados.push(
          await tools.askQuestion({
            toolUseID: 'toolu_04',
            questions: [
              {
                question: 'Qual cor?',
                header: 'Cor',
                multiSelect: false,
                options: [
                  { label: 'Azul', description: 'o céu' },
                  { label: 'Verde', description: 'o mato' },
                ],
              },
            ],
          }),
        )
        return [assistantMessage(`escolhido: ${text}`), successResult()]
      },
    })
    const handle = start(fake)

    handle.send('escolha uma cor')
    const esperando = await untilState(handle, isKind('awaiting_answer'))

    expect(esperando).toEqual({
      kind: 'awaiting_answer',
      request: {
        id: 'toolu_04',
        questions: [
          {
            question: 'Qual cor?',
            header: 'Cor',
            multiSelect: false,
            options: [
              { label: 'Azul', description: 'o céu' },
              { label: 'Verde', description: 'o mato' },
            ],
          },
        ],
      },
    })
    // O turno está parado esperando a pessoa, como na permissão.
    expect(resultados).toEqual([])

    handle.answerQuestion('toolu_04', { 'Qual cor?': 'Azul' })
    await untilState(handle, isKind('awaiting_input'))

    // A forma exata importa: `allow` puro executa a ferramenta sem quem a desenhe e o modelo ouve
    // "the user did not answer"; `deny` com a resposta na mensagem marca o tool_result como erro.
    expect(resultados).toEqual([
      {
        behavior: 'allow',
        updatedInput: {
          questions: [
            {
              question: 'Qual cor?',
              header: 'Cor',
              multiSelect: false,
              options: [
                { label: 'Azul', description: 'o céu' },
                { label: 'Verde', description: 'o mato' },
              ],
            },
          ],
          answers: { 'Qual cor?': 'Azul' },
        },
      },
    ])
    expect(handle.messages.at(-1)?.text).toBe('escolhido: escolha uma cor')
  })

  it('o questions volta cru, e não a versão que a tela desenhou', async () => {
    const resultados: PermissionResult[] = []
    // Campos que o `Question` da ponte não carrega: se o handle devolvesse a tradução, sumiriam.
    const cru = [
      {
        question: 'Qual cor?',
        header: 'Cor',
        multiSelect: false,
        options: [{ label: 'Azul', description: 'o céu', extra: 'campo do futuro' }],
        futuro: 42,
      },
    ]
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        resultados.push(await tools.askQuestion({ toolUseID: 'toolu_05', questions: cru }))
        return [assistantMessage(text), successResult()]
      },
    })
    const handle = start(fake)

    handle.send('pergunte')
    await untilState(handle, isKind('awaiting_answer'))
    handle.answerQuestion('toolu_05', { 'Qual cor?': 'Azul' })
    await untilState(handle, isKind('awaiting_input'))

    const primeiro = resultados[0]
    expect(primeiro?.behavior === 'allow' && primeiro.updatedInput?.['questions']).toEqual(cru)
  })

  it('multi-seleção junta os rótulos escolhidos por vírgula', async () => {
    const resultados: PermissionResult[] = []
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        resultados.push(
          await tools.askQuestion({
            toolUseID: 'toolu_06',
            questions: [
              {
                question: 'Quais linguagens?',
                header: 'Stack',
                multiSelect: true,
                options: [
                  { label: 'TypeScript', description: 'a daqui' },
                  { label: 'Rust', description: 'a outra' },
                  { label: 'Go', description: 'a terceira' },
                ],
              },
            ],
          }),
        )
        return [assistantMessage(text), successResult()]
      },
    })
    const handle = start(fake)

    handle.send('pergunte')
    const esperando = await untilState(handle, isKind('awaiting_answer'))

    expect(
      esperando.kind === 'awaiting_answer' && esperando.request.questions[0]?.multiSelect,
    ).toBe(true)

    // O formato que o próprio SDK documenta para o `answers` da ferramenta: uma string por
    // pergunta, com os rótulos separados por vírgula. O core devolve o que recebeu, sem re-chavear.
    handle.answerQuestion('toolu_06', { 'Quais linguagens?': 'TypeScript, Rust' })
    await untilState(handle, isKind('awaiting_input'))

    const primeiro = resultados[0]
    expect(primeiro?.behavior === 'allow' && primeiro.updatedInput?.['answers']).toEqual({
      'Quais linguagens?': 'TypeScript, Rust',
    })
  })

  it('o texto livre entra no lugar do rótulo, sem precisar casar com opção nenhuma', async () => {
    const resultados: PermissionResult[] = []
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        resultados.push(
          await tools.askQuestion({
            toolUseID: 'toolu_07',
            questions: [
              {
                question: 'Qual cor?',
                header: 'Cor',
                multiSelect: false,
                options: [{ label: 'Azul', description: 'o céu' }],
              },
            ],
          }),
        )
        return [assistantMessage(text), successResult()]
      },
    })
    const handle = start(fake)

    handle.send('pergunte')
    await untilState(handle, isKind('awaiting_answer'))
    handle.answerQuestion('toolu_07', { 'Qual cor?': 'Roxo, que não estava na lista' })
    await untilState(handle, isKind('awaiting_input'))

    const primeiro = resultados[0]
    expect(primeiro?.behavior === 'allow' && primeiro.updatedInput?.['answers']).toEqual({
      'Qual cor?': 'Roxo, que não estava na lista',
    })
  })

  it('o que só decora a tela pode faltar: header, description e multiSelect têm default', async () => {
    const fake = createFakeQuery({
      // Sem `await`: a pergunta fica pendente de propósito, e o turno só volta no `close()`.
      turn: (text, tools) => {
        void tools.askQuestion({
          toolUseID: 'toolu_08',
          questions: [{ question: 'Qual cor?', options: [{ label: 'Azul' }] }],
        })
        return Promise.resolve([assistantMessage(text), successResult()])
      },
    })
    const handle = start(fake)

    handle.send('pergunte')
    const esperando = await untilState(handle, isKind('awaiting_answer'))

    expect(esperando).toEqual({
      kind: 'awaiting_answer',
      request: {
        id: 'toolu_08',
        questions: [
          {
            question: 'Qual cor?',
            header: '',
            multiSelect: false,
            options: [{ label: 'Azul', description: '' }],
          },
        ],
      },
    })

    await handle.close()
  })

  it('payload irreconhecível cai no caminho da permissão, em vez de quebrar a sessão', async () => {
    const tortos: unknown[] = [
      'nem array nem objeto',
      [],
      [{ header: 'Cor', options: [{ label: 'Azul' }] }],
      [{ question: 'Qual cor?' }],
      [{ question: 'Qual cor?', options: [] }],
      [{ question: 'Qual cor?', options: [{ description: 'sem rótulo' }] }],
    ]

    for (const [indice, questions] of tortos.entries()) {
      const decisoes: string[] = []
      const id = `toolu_torto_${String(indice)}`
      const fake = createFakeQuery({
        turn: async (text, tools) => {
          decisoes.push((await tools.askQuestion({ toolUseID: id, questions })).behavior)
          return [assistantMessage(text), successResult()]
        },
      })
      const handle = start(fake)

      handle.send('pergunte')
      const esperando = await untilState(handle, isKind('awaiting_decision'))

      // Vira permissão comum, com o nome cru da ferramenta — e negar continua possível.
      expect(esperando).toEqual({
        kind: 'awaiting_decision',
        request: {
          id,
          toolName: 'AskUserQuestion',
          title: undefined,
          displayName: undefined,
          description: undefined,
        },
      })

      handle.respondPermission(id, 'deny')
      await untilState(handle, isKind('awaiting_input'))
      expect(decisoes).toEqual(['deny'])
    }
  })

  it('answerQuestion e respondPermission não se confundem: cada um só conhece o seu', async () => {
    const fake = createFakeQuery({
      // Sem `await`: a pergunta fica pendente de propósito, e o turno só volta no `close()`.
      turn: (text, tools) => {
        void tools.askQuestion({
          toolUseID: 'toolu_10',
          questions: [
            {
              question: 'Qual cor?',
              header: 'Cor',
              multiSelect: false,
              options: [{ label: 'Azul', description: 'o céu' }],
            },
          ],
        })
        return Promise.resolve([assistantMessage(text), successResult()])
      },
    })
    const handle = start(fake)

    handle.send('pergunte')
    await untilState(handle, isKind('awaiting_answer'))

    // O id existe, mas no outro mapa: responder pelo canal errado é no-op, e o estado não anda.
    handle.respondPermission('toolu_10', 'allow')
    handle.answerQuestion('nem existe', { 'Qual cor?': 'Azul' })

    expect(handle.state.kind).toBe('awaiting_answer')

    await handle.close()
  })

  it('fechar com uma pergunta pendente nega a ferramenta em vez de travar o turno', async () => {
    const resultados: PermissionResult[] = []
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        resultados.push(
          await tools.askQuestion({
            toolUseID: 'toolu_11',
            questions: [
              {
                question: 'Qual cor?',
                header: 'Cor',
                multiSelect: false,
                options: [{ label: 'Azul', description: 'o céu' }],
              },
            ],
          }),
        )
        return [assistantMessage(text), successResult()]
      },
    })
    const handle = start(fake)

    handle.send('pergunte')
    await untilState(handle, isKind('awaiting_answer'))

    await handle.close()

    expect(resultados.map((resultado) => resultado.behavior)).toEqual(['deny'])
    expect(fake.finished).toBe(true)
    expect(handle.state).toEqual({ kind: 'closed' })
  })

  it('um query que não sobe deixa o motivo visível, em vez de fechar em silêncio', async () => {
    const fake = createFakeQuery({ failWith: new Error('claude não encontrado') })
    const handle = start(fake)

    await untilState(handle, isKind('failed'))

    expect(handle.state).toEqual({ kind: 'failed', reason: 'claude não encontrado' })
  })
})
