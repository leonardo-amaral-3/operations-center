import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTING_SOURCES, SessionHost } from '../../src/core/session/SessionHost'
import { INTERRUPTED_NOTICE } from '../../src/core/session/SessionHandle'
import type { SessionHandle, TurnPulseCore } from '../../src/core/session/SessionHandle'
import type { SessionState } from '../../src/core/session/state'
import type { ChatMessage, ChatToolUse } from '../../src/shared/session'
import {
  abortedResult,
  assistantMessage,
  assistantToolUse,
  createFakeQuery,
  successResult,
  taskStarted,
  thinkingTokens,
  toolResult,
  userEcho,
} from '../fakes/fakeQuery'
import type { FakeQuery, FakeTurn } from '../fakes/fakeQuery'

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

/**
 * O texto que uma mensagem mostra. A união tem dois lados e só um deles tem `text`; a entrada de
 * ferramenta responde com o nome, que é o que ela leva para a tela.
 */
function textOf(message: ChatMessage): string {
  return message.role === 'tool' ? message.name : message.text
}

/** Só a trilha de ferramentas, já estreitada — o resto da conversa não interessa a estes casos. */
function trilha(handle: SessionHandle): ChatToolUse[] {
  return handle.messages.filter((message): message is ChatToolUse => message.role === 'tool')
}

function start(fake: FakeQuery, model?: string): SessionHandle {
  return new SessionHost({ query: fake.query, model }).start({ cwd: CWD })
}

/**
 * O turno que não termina sozinho: fica estacionado até a parada chegar, e então volta pelo
 * iterador como o `result` de erro com que o SDK relata um turno abortado.
 */
const turnoParado: FakeTurn = async (_text, tools) => {
  await tools.untilInterrupt()
  return [abortedResult()]
}

/** Grava tudo que o canal de estado publicar, na ordem — é assim que se prova o que **não** apareceu. */
function gravarEstados(handle: SessionHandle): SessionState[] {
  const vistos: SessionState[] = []
  handle.on('state', (state) => vistos.push(state))
  return vistos
}

/** Um pedido do roteiro concorrente. O `toolName` só importa onde o caso o inspeciona. */
type PedidoConcorrente =
  { tipo: 'permissao'; id: string; toolName?: string } | { tipo: 'pergunta'; id: string }

/** O payload de uma pergunta simples — o mínimo que o `readQuestions` aceita desenhar. */
function perguntaCrua(texto: string): unknown {
  return [
    {
      question: texto,
      header: 'Cor',
      multiSelect: false,
      options: [
        { label: 'Azul', description: 'o céu' },
        { label: 'Verde', description: 'o mato' },
      ],
    },
  ]
}

interface Concorrentes {
  readonly turn: FakeTurn
  /** Resolve quando **todos** os pedidos já estão em voo: o ponto em que a fila já está formada. */
  readonly asked: Promise<void>
  /** O `behavior` que cada ferramenta recebeu, na ordem em que os pedidos foram disparados. */
  readonly behaviors: string[]
}

/**
 * O roteiro dos casos concorrentes: dispara os pedidos **sem `await` entre eles** e avisa por uma
 * promise quando todos já estão em voo.
 *
 * Sem temporizador de propósito. `askPermission`/`askQuestion` chamam o `canUseTool` de forma
 * síncrona antes do primeiro `await`, então quando `asked` resolve os pedidos já entraram na fila,
 * na ordem em que foram disparados — que é justamente a ordem sob teste. Um `setTimeout` no lugar
 * disso provaria o relógio da máquina, não a FIFO.
 */
function concorrentes(...pedidos: readonly PedidoConcorrente[]): Concorrentes {
  const behaviors: string[] = []
  let todosPedidos!: () => void
  const asked = new Promise<void>((resolve) => {
    todosPedidos = resolve
  })

  const turn: FakeTurn = async (text, tools) => {
    const emVoo = pedidos.map((pedido) =>
      pedido.tipo === 'permissao'
        ? tools.askPermission({ toolName: pedido.toolName ?? 'Write', toolUseID: pedido.id })
        : tools.askQuestion({
            toolUseID: pedido.id,
            questions: perguntaCrua(`Qual cor? ${pedido.id}`),
          }),
    )
    todosPedidos()
    behaviors.push(...(await Promise.all(emVoo)).map((resultado) => resultado.behavior))
    return [assistantMessage(text), successResult()]
  }

  return { turn, asked, behaviors }
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

  it('sem retomada, nada de resume: o cwd é o único endereço da conversa nova', () => {
    const fake = createFakeQuery()
    start(fake)

    expect(fake.options?.resume).toBeUndefined()
  })

  it('retoma pelo session_id do Claude Code — e sem forkSession', () => {
    const fake = createFakeQuery()
    new SessionHost({ query: fake.query }).start({ cwd: CWD, resume: 'sessao-de-ontem' })

    expect(fake.options?.resume).toBe('sessao-de-ontem')

    // `forkSession` é o que faria o SDK abrir um transcript novo. Como o vínculo gravado é por
    // `session_id`, um fork silencioso deixaria o registro apontando para uma conversa que parou —
    // e todos os turnos seguintes se perderiam sem nenhum sinal na tela.
    expect(fake.options?.forkSession).toBeUndefined()
  })

  it('o histórico restaurado já está na conversa antes do primeiro evento', async () => {
    const fake = createFakeQuery({
      turn: (text) => Promise.resolve([assistantMessage(`li: ${text}`), successResult()]),
    })
    const history: ChatMessage[] = [
      { id: 'antes-1', role: 'user', text: 'o que eu disse ontem' },
      { id: 'antes-2', role: 'assistant', text: 'o que foi respondido ontem' },
    ]
    const handle = new SessionHost({ query: fake.query }).start({
      cwd: CWD,
      resume: 'sessao-de-ontem',
      history,
    })

    // Na mesma volta em que o `start` devolveu, antes de qualquer evento do SDK: é este retrato que
    // a tela lê ao reabrir o cartão, e um `messages` vazio aqui o reabriria em branco mesmo com a
    // retomada tendo funcionado do lado do modelo.
    expect(handle.messages.map(textOf)).toEqual([
      'o que eu disse ontem',
      'o que foi respondido ontem',
    ])

    handle.send('e agora?')
    await untilState(handle, isKind('awaiting_input'))

    // O turno novo entra **depois** do histórico, na ordem: o `resume` não reemite o que já
    // aconteceu (medido), então o que veio do transcript e o que veio do stream não se duplicam.
    expect(handle.messages.map(textOf)).toEqual([
      'o que eu disse ontem',
      'o que foi respondido ontem',
      'e agora?',
      'li: e agora?',
    ])
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
    handle.on('message', (message) => anunciadas.push(textOf(message)))

    handle.send('oi')
    await untilState(handle, isKind('awaiting_input'))

    expect(
      handle.messages.map((message) => ({ role: message.role, text: textOf(message) })),
    ).toEqual([
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
      queued: 0,
    })
    // O turno está parado: sem decisao humana, nada de resposta.
    expect(decisoes).toEqual([])

    handle.respondPermission('toolu_01', 'allow')
    await untilState(handle, isKind('awaiting_input'))

    expect(decisoes).toEqual(['allow'])
    expect(handle.messages.map(textOf).at(-1)).toBe('escrito: crie o arquivo')
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

  it('dois pedidos de permissão concorrentes: o primeiro fica na frente, o segundo espera', async () => {
    const { turn, asked } = concorrentes(
      { tipo: 'permissao', id: 'toolu_a' },
      { tipo: 'permissao', id: 'toolu_b' },
    )
    const handle = start(createFakeQuery({ turn }))

    handle.send('faça as duas coisas')
    await asked

    // Quem chegou primeiro fica na frente, e o segundo **espera** em vez de tomar o lugar dele —
    // sobrescrever o incumbente é exatamente o travamento que este card conserta.
    expect(handle.state).toMatchObject({
      kind: 'awaiting_decision',
      request: { id: 'toolu_a' },
      queued: 1,
    })

    await handle.close()
  })

  it('resolver a frente revela o de trás, e não devolve a vez', async () => {
    const { turn, asked, behaviors } = concorrentes(
      { tipo: 'permissao', id: 'toolu_a' },
      { tipo: 'permissao', id: 'toolu_b' },
    )
    const handle = start(createFakeQuery({ turn }))

    handle.send('faça as duas coisas')
    await asked

    handle.respondPermission('toolu_a', 'allow')
    // Lido logo em seguida, sem esperar canal nenhum: a republicação da frente é síncrona.
    expect(handle.state).toMatchObject({
      kind: 'awaiting_decision',
      request: { id: 'toolu_b' },
      queued: 0,
    })

    handle.respondPermission('toolu_b', 'allow')
    await untilState(handle, isKind('awaiting_input'))

    // As **duas** ferramentas receberam resposta: nenhuma ficou esperando o que não vinha.
    expect(behaviors).toEqual(['allow', 'allow'])
  })

  it('duas perguntas concorrentes seguem a mesma fila', async () => {
    const { turn, asked, behaviors } = concorrentes(
      { tipo: 'pergunta', id: 'toolu_a' },
      { tipo: 'pergunta', id: 'toolu_b' },
    )
    const handle = start(createFakeQuery({ turn }))

    handle.send('pergunte duas vezes')
    await asked

    expect(handle.state).toMatchObject({
      kind: 'awaiting_answer',
      request: { id: 'toolu_a' },
      queued: 1,
    })

    handle.answerQuestion('toolu_a', { 'Qual cor? toolu_a': 'Azul' })
    expect(handle.state).toMatchObject({
      kind: 'awaiting_answer',
      request: { id: 'toolu_b' },
      queued: 0,
    })

    handle.answerQuestion('toolu_b', { 'Qual cor? toolu_b': 'Verde' })
    await untilState(handle, isKind('awaiting_input'))

    expect(behaviors).toEqual(['allow', 'allow'])
  })

  it('o par misto: quem chegou primeiro fica na frente, seja permissão ou pergunta', async () => {
    const permissaoNaFrente = concorrentes(
      { tipo: 'permissao', id: 'toolu_a' },
      { tipo: 'pergunta', id: 'toolu_b' },
    )
    const primeiro = start(createFakeQuery({ turn: permissaoNaFrente.turn }))

    primeiro.send('decida e pergunte')
    await permissaoNaFrente.asked

    expect(primeiro.state).toMatchObject({
      kind: 'awaiting_decision',
      request: { id: 'toolu_a' },
      queued: 1,
    })

    primeiro.respondPermission('toolu_a', 'allow')
    // A fila é uma só, e a ordem entre os dois tipos é o que o par misto precisa preservar.
    expect(primeiro.state).toMatchObject({
      kind: 'awaiting_answer',
      request: { id: 'toolu_b' },
      queued: 0,
    })

    await primeiro.close()

    // E o simétrico, com a pergunta chegando primeiro.
    const perguntaNaFrente = concorrentes(
      { tipo: 'pergunta', id: 'toolu_c' },
      { tipo: 'permissao', id: 'toolu_d' },
    )
    const segundo = start(createFakeQuery({ turn: perguntaNaFrente.turn }))

    segundo.send('pergunte e decida')
    await perguntaNaFrente.asked

    expect(segundo.state).toMatchObject({
      kind: 'awaiting_answer',
      request: { id: 'toolu_c' },
      queued: 1,
    })

    segundo.answerQuestion('toolu_c', { 'Qual cor? toolu_c': 'Azul' })
    expect(segundo.state).toMatchObject({
      kind: 'awaiting_decision',
      request: { id: 'toolu_d' },
      queued: 0,
    })

    await segundo.close()
  })

  it('a sessão só volta a trabalhar quando a fila esvazia', async () => {
    const { turn, asked } = concorrentes(
      { tipo: 'permissao', id: 'toolu_a' },
      { tipo: 'pergunta', id: 'toolu_b' },
      { tipo: 'permissao', id: 'toolu_c' },
    )
    const handle = start(createFakeQuery({ turn }))
    const vistos = gravarEstados(handle)

    handle.send('faça as três coisas')
    await asked

    const antesDasRespostas = vistos.length
    handle.respondPermission('toolu_a', 'allow')
    handle.answerQuestion('toolu_b', { 'Qual cor? toolu_b': 'Azul' })

    // O `working` no meio da fila é a mentira que este card mata: o cartão diria "trabalhando"
    // enquanto ainda há gente esperando que alguém decida.
    expect(vistos.slice(antesDasRespostas).map((estado) => estado.kind)).toEqual([
      'awaiting_answer',
      'awaiting_decision',
    ])

    handle.respondPermission('toolu_c', 'allow')
    await untilState(handle, isKind('awaiting_input'))
  })

  it('responder um pedido que não está na frente não muda quem está', async () => {
    const { turn, asked, behaviors } = concorrentes(
      { tipo: 'permissao', id: 'toolu_a' },
      { tipo: 'permissao', id: 'toolu_b' },
      { tipo: 'permissao', id: 'toolu_c' },
    )
    const handle = start(createFakeQuery({ turn }))

    handle.send('faça as três coisas')
    await asked

    expect(handle.state).toMatchObject({ request: { id: 'toolu_a' }, queued: 2 })

    // A guarda da tela desatualizada: ela responde por `requestId`, e o pedido do meio pode ser
    // decidido sem que a frente tenha saído.
    handle.respondPermission('toolu_b', 'allow')

    expect(handle.state).toMatchObject({
      kind: 'awaiting_decision',
      request: { id: 'toolu_a' },
      queued: 1,
    })

    handle.respondPermission('toolu_a', 'allow')
    handle.respondPermission('toolu_c', 'allow')
    await untilState(handle, isKind('awaiting_input'))

    expect(behaviors).toEqual(['allow', 'allow', 'allow'])
  })

  it('toolUseID repetido não substitui quem já esperava', async () => {
    const { turn, asked, behaviors } = concorrentes(
      { tipo: 'permissao', id: 'toolu_a', toolName: 'Write' },
      { tipo: 'permissao', id: 'toolu_a', toolName: 'Read' },
    )
    const handle = start(createFakeQuery({ turn }))

    handle.send('faça a mesma coisa duas vezes')
    await asked

    // O incumbente segue na frente com a promise intacta, e o recém-chegado nem entra na fila:
    // `Write`, e não `Read`, é o que prova que ninguém foi substituído.
    expect(handle.state).toMatchObject({
      kind: 'awaiting_decision',
      request: { id: 'toolu_a', toolName: 'Write' },
      queued: 0,
    })

    handle.respondPermission('toolu_a', 'allow')
    await untilState(handle, isKind('awaiting_input'))

    // O repetido foi negado na hora, em vez de passar em silêncio.
    expect(behaviors).toEqual(['allow', 'deny'])
  })

  it('fechar com a fila cheia nega todos, e nenhum turno fica pendurado', async () => {
    const { turn, asked, behaviors } = concorrentes(
      { tipo: 'permissao', id: 'toolu_a' },
      { tipo: 'pergunta', id: 'toolu_b' },
      { tipo: 'permissao', id: 'toolu_c' },
    )
    const fake = createFakeQuery({ turn })
    const handle = start(fake)
    const vistos = gravarEstados(handle)

    handle.send('faça as três coisas')
    await asked

    const antesDoFecho = vistos.length
    await handle.close()

    expect(behaviors).toEqual(['deny', 'deny', 'deny'])
    expect(fake.finished).toBe(true)
    expect(handle.state).toEqual({ kind: 'closed' })
    // Negar a fila **não** publica: um `settled` no caminho pintaria "Trabalhando" numa sessão que
    // está morrendo. O que aparece é o fim natural do turno, que os `deny` destravaram.
    expect(vistos.slice(antesDoFecho).map((estado) => estado.kind)).toEqual([
      'awaiting_input',
      'closed',
    ])
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
      queued: 0,
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
    expect(handle.messages.map(textOf).at(-1)).toBe('escolhido: escolha uma cor')
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
      queued: 0,
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
        queued: 0,
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
  it('parar corta o turno e devolve a vez, sem trocar a sessão de lugar', async () => {
    const fake = createFakeQuery({ turn: turnoParado })
    const handle = start(fake)
    await untilState(handle, isKind('working'))

    const id = handle.id
    const sessionId = handle.init?.sessionId

    handle.send('conte até 200')
    handle.stop()
    await untilState(handle, isKind('awaiting_input'))

    expect(fake.interrupts).toBe(1)
    expect(handle.state).toEqual({ kind: 'awaiting_input' })
    // O que separa parar de fechar: o `query()` continua vivo e a sessão é a mesma dos dois lados
    // da ponte — nada de sessão nova nascendo no lugar da que foi interrompida.
    expect(fake.finished).toBe(false)
    expect(handle.id).toBe(id)
    expect(handle.init?.sessionId).toBe(sessionId)
  })

  it('stop() fora de working é no-op: não há vez a cortar', async () => {
    const fake = createFakeQuery({ turn: turnoParado })
    const handle = start(fake)

    // `starting`: o init ainda não chegou, e o primeiro turno não começou.
    expect(handle.state).toEqual({ kind: 'starting' })
    handle.stop()
    expect(fake.interrupts).toBe(0)

    await untilState(handle, isKind('working'))
    await handle.close()

    handle.stop()
    expect(fake.interrupts).toBe(0)
    expect(handle.state).toEqual({ kind: 'closed' })
  })

  it('dois cliques no mesmo turno pedem uma interrupção só', async () => {
    const fake = createFakeQuery({ turn: turnoParado })
    const handle = start(fake)
    await untilState(handle, isKind('working'))

    handle.send('conte até 200')
    handle.stop()
    handle.stop()
    await untilState(handle, isKind('awaiting_input'))

    expect(fake.interrupts).toBe(1)
  })

  it('o controle que rejeita deixa a sessão trabalhando, e o stop() seguinte volta a pedir', async () => {
    const fake = createFakeQuery({
      turn: turnoParado,
      interruptWith: new Error('controle fora do ar'),
    })
    const handle = start(fake)
    await untilState(handle, isKind('working'))

    handle.send('conte até 200')
    handle.stop()

    // Uma microtarefa basta: o `catch` do controle já rejeitado foi enfileirado antes deste
    // `await`, e por isso roda antes dele. Sem timer, e sem depender de sorte.
    await Promise.resolve()

    // Não parou. A bandeira baixou, a sessão segue na vez dela — e o botão volta para a tela, em
    // vez de a sessão ficar presa num pedido que não pegou.
    expect(handle.state).toEqual({ kind: 'working' })

    handle.stop()
    expect(fake.interrupts).toBe(2)

    // Sem `close()`: o turno estacionou num `interrupt()` que nunca pega, e esperar o `#pump`
    // daqui seria esperar para sempre. Não há timer nem handle aberto para vazar.
  })

  it('depois da parada a conversa continua na mesma sessão, com o histórico em pé', async () => {
    let primeiro = true
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        if (!primeiro) return [assistantMessage(`li: ${text}`), successResult()]

        primeiro = false
        await tools.untilInterrupt()
        return [abortedResult()]
      },
    })
    const handle = start(fake)
    await untilState(handle, isKind('working'))

    handle.send('conte até 200')
    handle.stop()
    await untilState(handle, isKind('awaiting_input'))

    handle.send('responda apenas: SEGUE')
    await untilState(
      handle,
      (state) => state.kind === 'awaiting_input' && handle.messages.length === 4,
    )

    // Mesma entrada, mesmo `query`: os dois textos chegaram lá, na ordem em que foram ditos.
    expect(fake.received).toEqual(['conte até 200', 'responda apenas: SEGUE'])
    expect(
      handle.messages.map((message) => ({ role: message.role, text: textOf(message) })),
    ).toEqual([
      { role: 'user', text: 'conte até 200' },
      { role: 'notice', text: INTERRUPTED_NOTICE },
      { role: 'user', text: 'responda apenas: SEGUE' },
      { role: 'assistant', text: 'li: responda apenas: SEGUE' },
    ])
  })

  it('a nota da parada entra no ponto em que o turno parou, e antes do estado', async () => {
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        await tools.untilInterrupt()
        // O que o modelo alcançou dizer antes do corte: a nota entra depois disso.
        return [assistantMessage(`comecei: ${text}`), abortedResult()]
      },
    })
    const handle = start(fake)
    await untilState(handle, isKind('working'))

    const ordem: string[] = []
    handle.on('message', (message) => ordem.push(`mensagem:${message.role}`))
    handle.on('state', (state) => ordem.push(`estado:${state.kind}`))

    handle.send('conte até 200')
    handle.stop()
    await untilState(handle, isKind('awaiting_input'))

    expect(
      handle.messages.map((message) => ({ role: message.role, text: textOf(message) })),
    ).toEqual([
      { role: 'user', text: 'conte até 200' },
      { role: 'assistant', text: 'comecei: conte até 200' },
      { role: 'notice', text: INTERRUPTED_NOTICE },
    ])
    // A nota sai pelo canal de mensagem **antes** de o estado mudar — a mesma ordem em que o texto
    // do assistente chega antes do `result` que fecha o turno.
    expect(ordem).toEqual([
      'mensagem:user',
      'mensagem:assistant',
      'mensagem:notice',
      'estado:awaiting_input',
    ])
  })

  it('turno que termina sozinho no instante do stop() devolve a vez sem inventar nota', async () => {
    const fake = createFakeQuery({
      turn: async (text, tools) => {
        await tools.untilInterrupt()
        // O pedido saiu, mas a vez já tinha acabado por conta própria: o SDK relata sucesso, e
        // anunciar interrupção aqui seria contar na conversa uma coisa que não aconteceu.
        return [assistantMessage(`li: ${text}`), successResult()]
      },
    })
    const handle = start(fake)
    await untilState(handle, isKind('working'))

    handle.send('oi')
    handle.stop()
    await untilState(handle, isKind('awaiting_input'))

    expect(fake.interrupts).toBe(1)
    expect(handle.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(handle.state).toEqual({ kind: 'awaiting_input' })
  })

  it('enviar devolve a sessão a working na hora, antes de qualquer mensagem do fake', async () => {
    const fake = createFakeQuery()
    const handle = start(fake)

    handle.send('primeira')
    await untilState(handle, isKind('awaiting_input'))

    const ordem: string[] = []
    handle.on('message', (message) => ordem.push(`mensagem:${message.role}`))
    handle.on('state', (state) => ordem.push(`estado:${state.kind}`))

    handle.send('segunda')

    // Síncrono, dentro do próprio `send()`: nada do fake rodou ainda. Sem isto, um turno que não
    // pede permissão nenhuma correria inteiro com a tela dizendo "Sua vez" — e o botão de parar,
    // que só existe em `working`, nunca apareceria do segundo turno em diante.
    expect(handle.state).toEqual({ kind: 'working' })
    expect(fake.received).toEqual(['primeira'])
    expect(ordem).toEqual(['mensagem:user', 'estado:working'])

    await untilState(handle, isKind('awaiting_input'))
  })

  it('a ferramenta vira uma entrada só, que sai de running para done sem virar duas', async () => {
    const fake = createFakeQuery({
      turn: () =>
        Promise.resolve([
          assistantMessage('vou ler o package.json'),
          assistantToolUse([
            { id: 'toolu_r1', name: 'Read', input: { file_path: '/repo/package.json' } },
          ]),
          toolResult('toolu_r1'),
          successResult(),
        ]),
    })
    const handle = start(fake)

    const degraus: string[] = []
    handle.on('message', (message) => {
      if (message.role === 'tool') degraus.push(message.status)
    })

    handle.send('leia o package.json')
    await untilState(handle, isKind('awaiting_input'))

    expect(trilha(handle)).toEqual([
      {
        id: 'toolu_r1',
        role: 'tool',
        name: 'Read',
        detail: '/repo/package.json',
        headline: '',
        parentId: null,
        status: 'done',
      },
    ])
    // Um fato só que muda de status: os dois degraus saíram pelo mesmo canal, com o mesmo id, e a
    // conversa não ganhou uma segunda linha para dizer que a mesma leitura terminou.
    expect(degraus).toEqual(['running', 'done'])
  })

  it('is_error marca erro, e a ausência do campo é sucesso', async () => {
    const fake = createFakeQuery({
      turn: () =>
        Promise.resolve([
          assistantToolUse([
            { id: 'toolu_ok', name: 'Read', input: { file_path: '/repo/package.json' } },
            { id: 'toolu_ko', name: 'Read', input: { file_path: '/repo/nao-existe.ts' } },
          ]),
          toolResult('toolu_ok'),
          toolResult('toolu_ko', true),
          successResult(),
        ]),
    })
    const handle = start(fake)

    handle.send('leia os dois')
    await untilState(handle, isKind('awaiting_input'))

    // A ordem é a do `content`, e é ela que faz a trilha se ler como a sequência que aconteceu.
    expect(trilha(handle).map((entrada) => [entrada.detail, entrada.status])).toEqual([
      ['/repo/package.json', 'done'],
      ['/repo/nao-existe.ts', 'error'],
    ])
  })

  it('o que não relatou até o result termina aborted, e nada sobrevive running', async () => {
    const fake = createFakeQuery({
      turn: () =>
        Promise.resolve([
          assistantToolUse([{ id: 'toolu_b1', name: 'Bash', input: { command: 'sleep 60' } }]),
          successResult(),
        ]),
    })
    const handle = start(fake)

    handle.send('rode o comando')
    await untilState(handle, isKind('awaiting_input'))

    // `aborted` e não `error`: ela não falhou, ela não chegou a relatar. E o estado terminal é o
    // que impede uma entrada presa em `running` de desligar para sempre o "nada está rodando".
    expect(trilha(handle).map((entrada) => entrada.status)).toEqual(['aborted'])
    expect(trilha(handle).some((entrada) => entrada.status === 'running')).toBe(false)
  })

  it('o detalhe é uma linha só, cortada — e vazia quando nenhum campo identifica a chamada', async () => {
    const comando = ['echo um', 'echo   dois', 'z'.repeat(400)].join('\n')
    const fake = createFakeQuery({
      turn: () =>
        Promise.resolve([
          assistantToolUse([
            { id: 'toolu_b2', name: 'Bash', input: { command: comando } },
            {
              id: 'toolu_q1',
              name: 'AskUserQuestion',
              // Nenhum campo da lista casa com o input dela: o que a pergunta diz já está no
              // prompt que a tela desenha logo abaixo, e repeti-lo no detalhe seria ruído.
              input: { questions: [{ question: 'qual cor?', options: [{ label: 'azul' }] }] },
            },
          ]),
          successResult(),
        ]),
    })
    const handle = start(fake)

    handle.send('rode e pergunte')
    await untilState(handle, isKind('awaiting_input'))

    const [bash, pergunta] = trilha(handle)
    // Truncar no core, e não na tela: sem isto o comando inteiro atravessaria a ponte para caber
    // numa linha de 120 caracteres.
    expect(bash?.detail).toHaveLength(121)
    expect(bash?.detail.endsWith('…')).toBe(true)
    expect(bash?.detail.startsWith('echo um echo dois z')).toBe(true)
    expect(bash?.detail).not.toMatch(/\s{2}|\n/)

    expect(pergunta?.name).toBe('AskUserQuestion')
    expect(pergunta?.detail).toBe('')
  })

  it('a trilha fica na conversa depois do turno, na posição em que nasceu', async () => {
    const fake = createFakeQuery({
      turn: () =>
        Promise.resolve([
          assistantMessage('vou ler'),
          assistantToolUse([
            { id: 'toolu_r2', name: 'Read', input: { file_path: '/repo/package.json' } },
          ]),
          toolResult('toolu_r2'),
          assistantMessage('li: é um app Electron'),
          successResult(),
        ]),
    })
    const handle = start(fake)

    handle.send('leia o package.json')
    await untilState(handle, isKind('awaiting_input'))

    // A entrada é parte do histórico, intercalada em ordem com os balões — e o `tool_result` a
    // atualizou **no lugar**, em vez de empurrá-la para o fim da conversa.
    expect(handle.messages.map((message) => `${message.role}:${textOf(message)}`)).toEqual([
      'user:leia o package.json',
      'assistant:vou ler',
      'tool:Read',
      'assistant:li: é um app Electron',
    ])
  })

  it('a ferramenta do subagente aponta para o Agent que a gerou', async () => {
    const fake = createFakeQuery({
      turn: () =>
        Promise.resolve([
          assistantToolUse([
            { id: 'toolu_a1', name: 'Agent', input: { description: 'procurar o redutor' } },
          ]),
          // O quadro do subagente: mesmo com o texto dele não encaminhado, os `tool_use` chegam,
          // com o `parent_tool_use_id` do `Agent` preenchido.
          assistantToolUse(
            [
              { id: 'toolu_s1', name: 'Bash', input: { command: 'ls src' } },
              { id: 'toolu_s2', name: 'Glob', input: { pattern: 'src/**/*.ts' } },
            ],
            'toolu_a1',
          ),
          successResult(),
        ]),
    })
    const handle = start(fake)

    handle.send('procure o redutor')
    await untilState(handle, isKind('awaiting_input'))

    expect(trilha(handle).map((entrada) => [entrada.name, entrada.parentId])).toEqual([
      ['Agent', null],
      ['Bash', 'toolu_a1'],
      ['Glob', 'toolu_a1'],
    ])
  })

  it('a frase do Claude Code vira headline, e não inventa entrada para id desconhecido', async () => {
    const fake = createFakeQuery({
      turn: () =>
        Promise.resolve([
          assistantToolUse([{ id: 'toolu_b3', name: 'Bash', input: { command: 'node timer.js' } }]),
          taskStarted('toolu_b3', 'Run node timer for 20 seconds'),
          // Id que nunca teve `tool_use`: sem nome e sem detalhe, uma entrada aqui não informaria
          // nada — por isso é no-op, e não uma linha órfã.
          taskStarted('toolu_fantasma', 'Uma tarefa que ninguém chamou'),
          successResult(),
        ]),
    })
    const handle = start(fake)

    handle.send('rode o timer')
    await untilState(handle, isKind('awaiting_input'))

    expect(trilha(handle).map((entrada) => [entrada.id, entrada.headline])).toEqual([
      ['toolu_b3', 'Run node timer for 20 seconds'],
    ])
  })

  it('o contador de raciocínio é o acumulado do SDK, e zera na fronteira do turno', async () => {
    const fake = createFakeQuery({
      turn: () =>
        Promise.resolve([
          thinkingTokens(50, 50),
          // O segundo quadro chega com um delta que **não** completa a soma — é o quadro perdido.
          // Somar deltas daria 170 aqui; ler o acumulado dá os 450 que o SDK está afirmando.
          thinkingTokens(450, 120),
          assistantMessage('pensei e respondo'),
          successResult(),
        ]),
    })
    const handle = start(fake)

    const pulsos: TurnPulseCore[] = []
    handle.on('turn', (pulso) => pulsos.push(pulso))

    handle.send('pense antes de responder')
    await untilState(handle, isKind('awaiting_input'))

    // O `result` fecha o turno: o ordinal vira 2 e o contador volta a zero, que é o que apaga a
    // linha viva do turno que acabou em vez de deixá-la contando o raciocínio do turno anterior.
    expect(pulsos).toEqual([
      { index: 1, thinkingTokens: 50 },
      { index: 1, thinkingTokens: 450 },
      { index: 2, thinkingTokens: 0 },
    ])
  })

  it('o ordinal marca a fronteira mesmo quando a fila mantém a sessão trabalhando', async () => {
    const fake = createFakeQuery({
      turn: (text) => Promise.resolve([assistantMessage(`li: ${text}`), successResult(1)]),
    })
    const handle = start(fake)

    const pulsos: TurnPulseCore[] = []
    const ordem: string[] = []
    handle.on('turn', (pulso) => {
      pulsos.push(pulso)
      ordem.push('turn')
    })
    handle.on('state', () => ordem.push('state'))

    handle.send('oi')
    await untilState(handle, (state) => state.kind === 'working' && handle.messages.length === 2)

    // A sessão **não** saiu de `working`, então "entrou em working" não serviria de fronteira: sem
    // o ordinal os dois turnos enfileirados apareceriam como um só, com o relógio somando os dois.
    expect(handle.state).toEqual({ kind: 'working' })
    expect(pulsos).toEqual([{ index: 2, thinkingTokens: 0 }])

    // O primeiro `state` é o do `init`; o segundo e o `turn` são os do `result`, **nessa** ordem. É
    // contrato, e não coincidência: o main decide o carimbo do relógio olhando o estado já
    // atualizado, e é só assim que ele distingue "o turno acabou" de "o próximo da fila começou".
    expect(ordem).toEqual(['state', 'state', 'turn'])
  })

  it('o texto que chega como mensagem de usuário não vira balão na conversa', async () => {
    const fake = createFakeQuery({
      turn: () =>
        Promise.resolve([
          assistantToolUse([
            { id: 'toolu_a2', name: 'Agent', input: { description: 'ler o mapa' } },
          ]),
          // O eco do prompt do subagente chega assim. Ler o que não é `tool_result` o poria na
          // conversa como fala de alguém — e ninguém o disse.
          userEcho('Você é um agente de exploração. Leia o mapa e volte com…'),
          toolResult('toolu_a2'),
          successResult(),
        ]),
    })
    const handle = start(fake)

    handle.send('leia o mapa')
    await untilState(handle, isKind('awaiting_input'))

    expect(handle.messages.map((message) => message.role)).toEqual(['user', 'tool'])
    expect(trilha(handle).map((entrada) => entrada.status)).toEqual(['done'])
  })
})
