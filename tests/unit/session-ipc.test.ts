/**
 * O ponto em que a retomada e a marca do modo *dangerously* se ligam ao app: o `start` do main.
 *
 * O `electron` é mockado porque a única coisa que `src/main/ipc.ts` usa dele é o `ipcMain.handle` —
 * e guardar os handlers num mapa é o que permite exercitar os canais de verdade, com o `SessionHost`
 * de verdade e o `ConversationIndex` de verdade. O que fica de mentira é só o `query()` do SDK e as
 * quatro pontas de IO do índice, que já são injetados por construção.
 *
 * O caso que **não pode** faltar aqui é a partida concorrente: dois `start` para o mesmo cartão
 * seriam dois processos do Claude Code escrevendo o mesmo transcript, que é corrupção de dado do
 * usuário — o pior modo de falha desta feature, e o único que não dá para ver depois.
 */

import { describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown, request: unknown) => unknown): void {
      handlers.set(channel, handler)
    },
  },
}))

import type { WebContents } from 'electron'

import { ConversationIndex, DangerIndex, SessionHost } from '../../src/core'
import type { QueryFn } from '../../src/core/session/SessionHost'
import type { DangerGate } from '../../src/main/danger'
import { oneStartPerScope, registerSessionIpc } from '../../src/main/ipc'
import { IPC_EVENT, IPC_INVOKE } from '../../src/shared/ipc'
import type {
  SessionScope,
  SessionSnapshot,
  SessionStateEvent,
  StartResult,
} from '../../src/shared/ipc'
import type { QuestionAnswers, SessionState } from '../../src/shared/session'
import { assistantMessage, createFakeQuery, successResult } from '../fakes/fakeQuery'
import type { FakeScript } from '../fakes/fakeQuery'

const CARTAO = 'PVTI_cartao'

/** O escopo daquele cartão: o que a tela manda no `start`, no lugar do `itemId` solto de antes. */
const ESCOPO: SessionScope = { kind: 'card', itemId: CARTAO }

/** A aba do kanban, e o escopo da triagem dela — a exceção nomeada da RN-1. */
const ABA = 'leonardo-amaral-3/2'
const TRIAGEM: SessionScope = { kind: 'triage', boardKey: ABA }

/** O `session_id` que o `fakeQuery` reporta no `init` — o vínculo que o app grava. */
const SESSAO_DO_SDK = 'fake-session'

/** O que o `resolveCwd` responderia: a pasta que o índice de repos aponta **agora**. */
const PASTA_DO_REPO = '/tmp/repo'

/** Onde a conversa de antes rodou, lida do transcript. É esta que tem de vencer. */
const PASTA_DA_CONVERSA = '/tmp/onde-a-conversa-rodou'

interface Adiada<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

/** Uma promessa cuja hora de terminar é do teste — a janela da corrida, aberta de propósito. */
function adiar<T>(): Adiada<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

/** O retrato de uma partida que subiu. Falhar aqui é o teste, não o app. */
function sessaoDe(result: StartResult): SessionSnapshot {
  if (!result.started) throw new Error(`a partida não subiu: ${result.reason}`)

  return result.session
}

interface Bancada {
  gravado?: ReadonlyMap<string, string>
  /** Os cartões que estavam marcados no `dangerous.json` quando o app abriu. */
  marcados?: readonly string[]
  /**
   * As abas cuja triagem está sem portão. Nunca vêm de disco — é o ponto: a lista nasce vazia a cada
   * abertura do app, e aqui ela é semeada à mão porque só há uma execução.
   */
  triagens?: readonly string[]
  /**
   * Arranca o `allowDangerouslySkipPermissions` do `query()`, e com ele a única forma de o SDK
   * recusar a troca de modo (M-3) — o mesmo truque do `startSemFlag` de `SessionHost.test.ts`.
   *
   * Aqui ele é o **único** jeito de a resposta da sessão divergir do que a tela pediu, que é
   * justamente a divergência que o handler tem de gravar do lado certo.
   */
  semFlag?: boolean
  inspect?: (sessionId: string) => Promise<{ cwd: string } | null>
  resolveCwd?: (scope: SessionScope | undefined) => Promise<string | null>
  /**
   * O roteiro do turno, como o fake o receberia. É o que permite parar a sessão em cada um dos
   * estados de espera — a única forma de provar *quais* transições relêem o board sem inventar um
   * `SessionHandle` de mentira no lugar do de verdade.
   */
  roteiro?: FakeScript
}

function montar(opcoes: Bancada = {}) {
  handlers.clear()

  const conversations = new ConversationIndex({
    load: () => Promise.resolve(opcoes.gravado ?? new Map()),
    save: () => Promise.resolve(),
    inspect: opcoes.inspect ?? (() => Promise.resolve({ cwd: PASTA_DA_CONVERSA })),
    transcript: () => Promise.resolve([]),
  })

  const danger = new DangerIndex({
    load: () => Promise.resolve(new Set(opcoes.marcados ?? [])),
    save: () => Promise.resolve(),
  })

  /**
   * As duas durabilidades atrás de uma pergunta só, como o `dangerGate` de `src/main/index.ts` as
   * junta. Espelhado aqui, e não importado de lá: `index.ts` é o módulo que abre janela e lê
   * `process.argv` no import, e o que este arquivo exercita é o `registerSessionIpc` — o que ele
   * precisa do portão é o **contrato**, e o contrato é o `DangerGate`.
   *
   * O conjunto é o do main de verdade em espírito: memória pura, sem `load` e sem `save`.
   */
  const triagens = new Set(opcoes.triagens ?? [])
  const gate: DangerGate = {
    isDangerous: (scope) =>
      scope.kind === 'card'
        ? danger.isDangerous(scope.itemId)
        : Promise.resolve(triagens.has(scope.boardKey)),
    set: (scope, dangerous) => {
      if (scope.kind === 'card') danger.set(scope.itemId, dangerous)
      else if (dangerous) triagens.add(scope.boardKey)
      else triagens.delete(scope.boardKey)
    },
  }

  // As duas pontas que a triagem **não** pode tocar. Espionadas em vez de inferidas pelo
  // `recoverable()`: um `restore` que não retoma nada e um `forget` de chave inexistente não deixam
  // rastro nenhum no índice, e é justamente a chamada que não pode existir.
  const restaurar = vi.spyOn(conversations, 'restore')
  const esquecer = vi.spyOn(conversations, 'forget')

  const fake = createFakeQuery(opcoes.roteiro)
  const query: QueryFn = opcoes.semFlag
    ? ({ prompt, options }) =>
        fake.query({ prompt, options: { ...options, allowDangerouslySkipPermissions: undefined } })
    : fake.query
  const host = new SessionHost({ query })
  const criadas = vi.spyOn(host, 'start')
  const resolveCwd = vi.fn(opcoes.resolveCwd ?? (() => Promise.resolve(PASTA_DO_REPO)))

  /**
   * A ponta da releitura, sempre espiã: **quando** ela é chamada é o que o CA-3 afirma. Metade do
   * requisito é sobre chamada que não acontece — permissão e pergunta não relêem —, e isso só se vê
   * com o `vi.fn` ligado em todos os casos.
   */
  const onTurnEnd = vi.fn()

  const ipc = registerSessionIpc(host, { resolveCwd, conversations, danger: gate, onTurnEnd })

  const recebidos: string[] = []
  const estados: SessionState[] = []
  const esperas = new Map<string, () => void>()
  /** Quem espera um estado. Um conjunto, e não um mapa por `kind`: o mesmo estado se repete. */
  const porEstado = new Set<() => void>()
  const sender = {
    isDestroyed: () => false,
    send(channel: string, payload: unknown): void {
      recebidos.push(channel)

      if (channel === IPC_EVENT.state) {
        estados.push((payload as SessionStateEvent).state)
        for (const acordar of [...porEstado]) acordar()
      }

      esperas.get(channel)?.()
    },
  } as unknown as WebContents

  function invoke<T>(channel: string, request: unknown): Promise<T> {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`canal não registrado: ${channel}`)

    return Promise.resolve(handler({ sender }, request) as T)
  }

  return {
    conversations,
    danger,
    /** O que o portão volátil guarda agora. É o `boardKeys` do retrato, do lado do main. */
    triagens,
    fake,
    criadas,
    resolveCwd,
    restaurar,
    esquecer,
    ipc,
    onTurnEnd,
    estados,
    start: (scope?: SessionScope) => invoke<StartResult>(IPC_INVOKE.start, { scope }),
    close: (sessionId: string) => invoke<void>(IPC_INVOKE.close, { sessionId }),
    enviar: (sessionId: string, text: string) =>
      invoke<void>(IPC_INVOKE.send, { sessionId, text }),
    responder: (sessionId: string, requestId: string) =>
      invoke<void>(IPC_INVOKE.respondPermission, { sessionId, requestId, decision: 'allow' }),
    responderPergunta: (sessionId: string, requestId: string, answers: QuestionAnswers) =>
      invoke<void>(IPC_INVOKE.answerQuestion, { sessionId, requestId, answers }),
    marcar: (scope: SessionScope, dangerous: boolean) =>
      invoke<void>(IPC_INVOKE.setDangerous, { scope, dangerous }),
    /**
     * Espera a sessão passar por aquele estado. Sem timer, como o `ate`: quem acorda o teste é o
     * próprio canal, e é o que faz os três pontos de espera do turno serem observáveis sem relógio.
     */
    ateEstado: (kind: SessionState['kind']): Promise<void> =>
      new Promise<void>((resolve) => {
        const tentar = (): void => {
          if (!estados.some((estado) => estado.kind === kind)) return

          porEstado.delete(tentar)
          resolve()
        }

        porEstado.add(tentar)
        // Uma vez agora: o estado esperado pode já ter passado antes de alguém pedi-lo.
        tentar()
      }),
    /** Espera um evento atravessar a ponte. Sem timer: quem acorda o teste é o próprio canal. */
    ate: (channel: string): Promise<void> =>
      recebidos.includes(channel)
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            esperas.set(channel, () => {
              esperas.delete(channel)
              resolve()
            })
          }),
  }
}

describe('oneStartPerScope', () => {
  it('a segunda partida do mesmo escopo pega carona na primeira', async () => {
    const gate = oneStartPerScope<string>()
    const adiada = adiar<string>()
    let chamadas = 0

    const primeira = gate(ESCOPO, () => {
      chamadas += 1
      return adiada.promise
    })
    // **Objeto novo, mesma chave.** É o caso real: o escopo é montado no JSX a cada render, então
    // duas partidas concorrentes nunca chegam aqui com a mesma referência. Um índice por referência
    // deixaria as duas passarem — e duas sessões do mesmo cartão são dois Claude Code escrevendo o
    // mesmo transcript.
    const segunda = gate({ kind: 'card', itemId: CARTAO }, () => {
      chamadas += 1
      return Promise.resolve('a segunda subiu sozinha')
    })

    adiada.resolve('a única')

    expect(await primeira).toBe('a única')
    expect(await segunda).toBe('a única')
    expect(chamadas).toBe(1)
  })

  it('os dois espaços de chave não se cruzam: cartão e aba de mesmo nome são partidas distintas', async () => {
    // O `scopeKey` é o único lugar que compõe a chave, e é ele que mantém isto verdadeiro. Sem
    // prefixo, uma aba cujo `key` fosse igual ao `itemId` de um cartão sequestraria a partida dele.
    const gate = oneStartPerScope<string>()
    const adiada = adiar<string>()

    const doCartao = gate({ kind: 'card', itemId: ABA }, () => adiada.promise)
    const daTriagem = gate(TRIAGEM, () => Promise.resolve('a da triagem'))

    adiada.resolve('a do cartão')

    expect(await doCartao).toBe('a do cartão')
    expect(await daTriagem).toBe('a da triagem')
  })

  it('a partida que termina libera o escopo para a próxima', async () => {
    const gate = oneStartPerScope<number>()

    expect(await gate(ESCOPO, () => Promise.resolve(1))).toBe(1)
    expect(await gate(ESCOPO, () => Promise.resolve(2))).toBe(2)
  })

  it('a partida que falha também libera — escopo trancado até reiniciar seria pior', async () => {
    const gate = oneStartPerScope<number>()

    await expect(gate(ESCOPO, () => Promise.reject(new Error('não subiu')))).rejects.toThrow(
      'não subiu',
    )
    expect(await gate(ESCOPO, () => Promise.resolve(2))).toBe(2)
  })

  it('sem escopo ninguém pega carona: a tela de chat não compartilha partida', async () => {
    const gate = oneStartPerScope<number>()
    let chamadas = 0
    const conta = (valor: number) => () => {
      chamadas += 1
      return Promise.resolve(valor)
    }

    const [um, dois] = await Promise.all([gate(undefined, conta(1)), gate(undefined, conta(2))])

    expect([um, dois]).toEqual([1, 2])
    expect(chamadas).toBe(2)
  })
})

describe('registerSessionIpc — a retomada', () => {
  it('dois `start` simultâneos para o mesmo cartão produzem uma sessão só', async () => {
    const pasta = adiar<string | null>()
    const bancada = montar({ resolveCwd: () => pasta.promise })

    // Sem `await` entre os dois: é exatamente o duplo-monte do StrictMode, e a janela é o `await`
    // do `resolveCwd` — que aqui fica aberta até o teste mandar fechar.
    const primeira = bancada.start(ESCOPO)
    const segunda = bancada.start(ESCOPO)
    pasta.resolve(PASTA_DO_REPO)

    const [uma, outra] = await Promise.all([primeira, segunda])

    expect(bancada.criadas).toHaveBeenCalledTimes(1)
    expect(sessaoDe(uma).id).toBe(sessaoDe(outra).id)
  })

  it('a retomada vem antes do `resolveCwd`: vale a pasta em que a conversa rodou', async () => {
    const bancada = montar({ gravado: new Map([[CARTAO, 'sessao-de-ontem']]) })

    await bancada.start(ESCOPO)

    expect(bancada.resolveCwd).not.toHaveBeenCalled()
    expect(bancada.fake.options?.resume).toBe('sessao-de-ontem')
    expect(bancada.fake.options?.cwd).toBe(PASTA_DA_CONVERSA)
  })

  it('sem vínculo gravado, sobe conversa nova na pasta do repo', async () => {
    const bancada = montar()

    await bancada.start(ESCOPO)

    expect(bancada.resolveCwd).toHaveBeenCalledWith(ESCOPO)
    expect(bancada.fake.options?.resume).toBeUndefined()
    expect(bancada.fake.options?.cwd).toBe(PASTA_DO_REPO)
  })

  it('o `init` grava o vínculo com o id que o SDK reportou', async () => {
    const bancada = montar()

    await bancada.start(ESCOPO)
    await bancada.ate(IPC_EVENT.init)

    expect(bancada.conversations.recoverable()).toEqual([CARTAO])
  })

  it('encerrar a sessão esquece o vínculo — o CA-4', async () => {
    const bancada = montar()
    const sessao = sessaoDe(await bancada.start(ESCOPO))
    await bancada.ate(IPC_EVENT.init)

    await bancada.close(sessao.id)

    expect(bancada.conversations.recoverable()).toEqual([])
  })

  it('desligar o app **não** esquece: é essa a diferença que o card existe para criar', async () => {
    const bancada = montar()
    await bancada.start(ESCOPO)
    await bancada.ate(IPC_EVENT.init)

    await bancada.ipc.closeAll()

    expect(bancada.conversations.recoverable()).toEqual([CARTAO])
  })

  it('o vínculo gravado sobrevive ao id do SDK ser o mesmo depois do `resume`', async () => {
    const bancada = montar({ gravado: new Map([[CARTAO, SESSAO_DO_SDK]]) })

    await bancada.start(ESCOPO)
    await bancada.ate(IPC_EVENT.init)

    expect(bancada.conversations.recoverable()).toEqual([CARTAO])
  })
})

describe('registerSessionIpc — a marca do modo dangerously', () => {
  it('o cartão marcado sobe a sessão sem o portão', async () => {
    const bancada = montar({ marcados: [CARTAO] })

    await bancada.start(ESCOPO)

    expect(bancada.criadas).toHaveBeenCalledWith(expect.objectContaining({ dangerous: true }))
    // A ponta do outro lado: o que o host traduziu e mandou ao SDK. É ela que faz o CA-1 valer já no
    // primeiro turno, e não a partir de um `setPermissionMode` que chega depois dele.
    expect(bancada.fake.options?.permissionMode).toBe('bypassPermissions')
  })

  it('a retomada carrega a marca junto: a conversa volta no modo em que estava', async () => {
    const bancada = montar({ gravado: new Map([[CARTAO, 'sessao-de-ontem']]), marcados: [CARTAO] })

    await bancada.start(ESCOPO)

    // O ramo em que esquecer a leitura passaria despercebido: a sessão sobe, a conversa volta, e só
    // o portão reaparece — num cartão que o usuário marcou justamente para não vê-lo.
    expect(bancada.criadas).toHaveBeenCalledWith(
      expect.objectContaining({ resume: 'sessao-de-ontem', dangerous: true }),
    )
  })

  it('o cartão sem marca nasce com o portão de sempre', async () => {
    const bancada = montar()

    await bancada.start(ESCOPO)

    expect(bancada.criadas).toHaveBeenCalledWith(expect.objectContaining({ dangerous: false }))
    expect(bancada.fake.options?.permissionMode).toBe('default')
  })

  it('a tela de chat, sem cartão, não tem marca onde se apoiar', async () => {
    const bancada = montar({ marcados: [CARTAO] })

    await bancada.start()

    // Decisão 13: sem `itemId` não há onde a marca ter sido gravada, e ela não pode vazar do cartão
    // marcado ao lado.
    expect(bancada.criadas).toHaveBeenCalledWith(expect.objectContaining({ dangerous: false }))
  })

  it('a marca vale sem sessão viva, e a próxima sessão daquele cartão nasce com ela', async () => {
    const bancada = montar()

    await bancada.marcar(ESCOPO, true)

    expect(bancada.danger.dangerous()).toEqual([CARTAO])

    await bancada.start(ESCOPO)

    expect(bancada.criadas).toHaveBeenCalledWith(expect.objectContaining({ dangerous: true }))
  })

  it('com sessão viva, o que fica gravado é o que o SDK aceitou', async () => {
    const bancada = montar()
    await bancada.start(ESCOPO)

    await bancada.marcar(ESCOPO, true)

    expect(bancada.fake.permissionModes).toEqual(['bypassPermissions'])
    expect(bancada.danger.dangerous()).toEqual([CARTAO])
  })

  it('a recusa do SDK deixa a marca por gravar — vale o efetivo, não o pedido', async () => {
    const bancada = montar({ semFlag: true })
    await bancada.start(ESCOPO)

    await bancada.marcar(ESCOPO, true)

    // O pedido saiu (é o `permissionModes`) e voltou recusado (M-3). Gravar o pedido faria o crachá
    // prometer um cartão sem portão que o portão ainda guarda — e o CA-2 diz que o que se vê é o que
    // vigora.
    expect(bancada.fake.permissionModes).toEqual(['bypassPermissions'])
    expect(bancada.danger.dangerous()).toEqual([])
  })

  it('encerrar a sessão esquece a conversa e **não** a marca', async () => {
    const bancada = montar({ marcados: [CARTAO] })
    const sessao = sessaoDe(await bancada.start(ESCOPO))
    await bancada.ate(IPC_EVENT.init)

    await bancada.close(sessao.id)

    // O irmão do teste do vínculo lá em cima, pelo avesso: encerrar é definitivo **para a conversa**
    // (o CA-4 do #22), e a marca é uma decisão sobre o cartão. Revogá-la de carona seria o app
    // decidindo por conta própria (decisão 14).
    expect(bancada.conversations.recoverable()).toEqual([])
    expect(bancada.danger.dangerous()).toEqual([CARTAO])
  })

  it('desligar o app também não apaga a marca', async () => {
    const bancada = montar({ marcados: [CARTAO] })
    await bancada.start(ESCOPO)
    await bancada.ate(IPC_EVENT.init)

    await bancada.ipc.closeAll()

    expect(bancada.danger.dangerous()).toEqual([CARTAO])
  })
})

describe('registerSessionIpc — o escopo da triagem', () => {
  it('o retrato devolve o escopo, e não um `itemId` que a triagem não tem', async () => {
    const bancada = montar()

    const sessao = sessaoDe(await bancada.start(TRIAGEM))

    expect(sessao.scope).toEqual(TRIAGEM)
  })

  it('a triagem daquela aba tem *a* sua sessão: o segundo `start` devolve a mesma', async () => {
    const bancada = montar()

    const primeira = sessaoDe(await bancada.start(TRIAGEM))
    // Objeto novo, mesma aba — como o painel remonta a cada render.
    const segunda = sessaoDe(await bancada.start({ kind: 'triage', boardKey: ABA }))

    expect(segunda.id).toBe(primeira.id)
    expect(bancada.criadas).toHaveBeenCalledTimes(1)
  })

  it('a triagem não retoma conversa nenhuma: sem card não há vínculo a que voltar', async () => {
    // O vínculo gravado tem a `key` da aba como chave — a colisão que um `itemId` sintético teria
    // criado. Mesmo assim ninguém o procura: o ramo da retomada é do cartão, e só dele.
    const bancada = montar({ gravado: new Map([[ABA, 'sessao-de-ontem']]) })

    await bancada.start(TRIAGEM)

    expect(bancada.restaurar).not.toHaveBeenCalled()
    expect(bancada.resolveCwd).toHaveBeenCalledWith(TRIAGEM)
    expect(bancada.fake.options?.resume).toBeUndefined()
  })

  it('o `init` da triagem não grava vínculo: nenhum crachá de conversa órfão no kanban', async () => {
    const bancada = montar()

    await bancada.start(TRIAGEM)
    await bancada.ate(IPC_EVENT.init)

    expect(bancada.conversations.recoverable()).toEqual([])
  })

  it('encerrar a triagem não esquece vínculo nenhum — não há o que esquecer', async () => {
    const bancada = montar()
    const sessao = sessaoDe(await bancada.start(TRIAGEM))
    await bancada.ate(IPC_EVENT.init)

    await bancada.close(sessao.id)

    // `forget` de uma chave que nunca existiu não deixaria rastro no índice, e por isso o teste é
    // sobre a **chamada**: é ela que não pode acontecer.
    expect(bancada.esquecer).not.toHaveBeenCalled()
  })

  it('sem pasta conhecida, a triagem cai no CA-5 como o cartão', async () => {
    const bancada = montar({ resolveCwd: () => Promise.resolve(null) })

    expect(await bancada.start(TRIAGEM)).toEqual({ started: false, reason: 'unknown-folder' })
    expect(bancada.criadas).not.toHaveBeenCalled()
  })

  it('com a triagem daquela aba marcada, a sessão nova nasce sem o portão', async () => {
    const bancada = montar({ triagens: [ABA] })

    await bancada.start(TRIAGEM)

    // O CA-4 pelo lado do nascimento: a pergunta é a mesma do cartão, e a resposta chega pelo mesmo
    // caminho — a diferença de durabilidade fica toda do lado de lá do `DangerGate`.
    expect(bancada.criadas).toHaveBeenCalledWith(expect.objectContaining({ dangerous: true }))
    expect(bancada.fake.options?.permissionMode).toBe('bypassPermissions')
  })

  it('a marca de um cartão não vaza para a triagem da aba, nem o contrário', async () => {
    const bancada = montar({ marcados: [CARTAO], triagens: [] })

    await bancada.start(TRIAGEM)

    // Dois espaços de chave separados, e o teste que os mantém assim: um `Set` só, indexado pela
    // chave crua, faria o cartão marcado responder por uma aba que nunca foi marcada.
    expect(bancada.criadas).toHaveBeenCalledWith(expect.objectContaining({ dangerous: false }))
  })

  it('marcar a triagem escreve no portão volátil, e nunca no índice que vai a disco', async () => {
    const bancada = montar()
    await bancada.start(TRIAGEM)

    await bancada.marcar(TRIAGEM, true)

    expect(bancada.fake.permissionModes).toEqual(['bypassPermissions'])
    expect([...bancada.triagens]).toEqual([ABA])
    // A metade que o CA-4 proíbe: nenhum `itemId` sintético no índice que grava o `dangerous.json`.
    expect(bancada.danger.dangerous()).toEqual([])
  })

  it('a recusa do SDK também vale na triagem: o volátil guarda o efetivo, não o pedido', async () => {
    const bancada = montar({ semFlag: true })
    await bancada.start(TRIAGEM)

    await bancada.marcar(TRIAGEM, true)

    // O handler é um só para os dois escopos, e é ele que decide o que gravar. Sem este caso, uma
    // regressão que gravasse o pedido só apareceria no cartão — e passaria batida na triagem.
    expect(bancada.fake.permissionModes).toEqual(['bypassPermissions'])
    expect([...bancada.triagens]).toEqual([])
  })
})

describe('registerSessionIpc — a releitura no fim do turno', () => {
  /** A pergunta do roteiro, no formato em que o `AskUserQuestion` a manda. */
  const PERGUNTA = 'Qual a severidade?'

  it('só `awaiting_input` relê o board: trabalho, permissão e pergunta não contam', async () => {
    const bancada = montar({
      roteiro: {
        turn: async (texto, tools) => {
          await tools.askPermission({ toolName: 'Bash', toolUseID: 'toolu_01' })
          await tools.askQuestion({
            toolUseID: 'toolu_02',
            questions: [
              {
                question: PERGUNTA,
                header: 'Severidade',
                multiSelect: false,
                options: [
                  { label: 'S2', description: 'atrapalha' },
                  { label: 'S3', description: 'incomoda' },
                ],
              },
            ],
          })

          return [assistantMessage(`eco: ${texto}`), successResult()]
        },
      },
    })

    const sessao = sessaoDe(await bancada.start(ESCOPO))

    // O `init` põe a sessão em `working`: o turno **começando** não é o turno acabando, e reler
    // aqui seria uma leitura do GitHub por abertura de cartão.
    await bancada.ateEstado('working')
    expect(bancada.onTurnEnd).not.toHaveBeenCalled()

    await bancada.enviar(sessao.id, '/gm-triage')

    // As duas esperas do meio do turno. É aqui que uma régua de "parou de trabalhar" em vez de
    // "devolveu a vez" custaria caro: a `/gm-triage` roda `gh` dezenas de vezes, e cada prompt de
    // permissão viraria uma leitura do board.
    await bancada.ateEstado('awaiting_decision')
    expect(bancada.onTurnEnd).not.toHaveBeenCalled()
    await bancada.responder(sessao.id, 'toolu_01')

    await bancada.ateEstado('awaiting_answer')
    expect(bancada.onTurnEnd).not.toHaveBeenCalled()
    await bancada.responderPergunta(sessao.id, 'toolu_02', { [PERGUNTA]: 'S2' })

    await bancada.ateEstado('awaiting_input')

    // A vez voltou. **Uma** releitura, e com o escopo daquela sessão — é ele que o main traduz na
    // aba a reler.
    expect(bancada.onTurnEnd.mock.calls).toEqual([[ESCOPO]])

    // E a prova de que os três estados que não relêem de fato aconteceram: sem esta linha, um
    // roteiro que nunca chegasse a parar deixaria as asserções de cima verdes por omissão.
    expect(bancada.estados.map((estado) => estado.kind)).toEqual([
      'working',
      'awaiting_decision',
      'working',
      'awaiting_answer',
      'working',
      'awaiting_input',
    ])
  })

  it('a releitura vale para a triagem também, com a aba dela no lugar do cartão', async () => {
    const bancada = montar()
    const sessao = sessaoDe(await bancada.start(TRIAGEM))

    await bancada.enviar(sessao.id, '/gm-triage')
    await bancada.ateEstado('awaiting_input')

    // O escopo atravessa inteiro, e não um `itemId` que a triagem não tem: quem sabe traduzir
    // `boardKey` em aba é o main, e ele precisa do discriminante para escolher o ramo.
    expect(bancada.onTurnEnd.mock.calls).toEqual([[TRIAGEM]])
  })
})
