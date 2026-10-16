import type {
  ClaudeReleasedEvent,
  ClaudeStateEvent,
  CloseClaudeRequest,
  OpenClaudeRequest,
  OpenClaudeResult,
  TerminalState,
} from '../../src/shared/claude'
import { scopeKey } from '../../src/shared/ipc'
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalInputRequest,
  TerminalResizeRequest,
  ChooseFolderResult,
  CloseRequest,
  CreateFreeResult,
  ForgetFreeRequest,
  FreeSessionCard,
  FreeSnapshot,
  LayoutSnapshot,
  OcApi,
  OpenTerminalRequest,
  OpenTerminalResult,
  RenameFreeRequest,
  TerminalPresetsSnapshot,
  SessionActivityEvent,
  SessionInitEvent,
  SessionMessageEvent,
  SessionSnapshot,
  SessionStateEvent,
  StartRequest,
  StartResult,
  WindowSnapshot,
} from '../../src/shared/ipc'
import { IDLE_ACTIVITY } from '../../src/shared/session'

/** A mesa de quem nunca abriu nada: dock fechado e vazio, painel fechado, nenhum perfil lembrado. */
const LAYOUT_VAZIO: LayoutSnapshot = {
  dock: { open: false, height: 280, terminals: [], active: null },
  side: { open: false, width: 480, active: null },
  lastPreset: null,
}

/**
 * O falso da ponte `window.oc`, para os testes que precisam de `useEffect` rodando de verdade.
 *
 * Mora em `tests/renderer/`, e **não** em `tests/fakes/`, por uma razão de tipo e não de gosto:
 * `tests/fakes/` cai no programa do Node (`tsconfig.node.json`), que não tem `lib: DOM` — um falso
 * que mexe em `window` não compilaria lá. `tests/renderer/**` está inteiro no programa web, com
 * `lib: DOM`. E o nome não termina em `.test.ts`, então o `include` do `vitest.config.ts` não o
 * coleta como suíte: ele é aparato, não afirmação.
 *
 * Ele reproduz **duas** regras do main, e são elas que dão sentido aos testes que o usam:
 *
 * 1. **`start` idempotente por escopo** — a mesma `scopeKey` devolve sempre o mesmo id
 *    (`livingSessionFor`, `src/main/ipc.ts:127-139`, e `oneStartPerScope`, `:344-358`), enquanto
 *    `start()` sem escopo cunha um id novo a cada chamada. É essa assimetria que a régua do descarte
 *    do `useSessionView` existe para respeitar, e sem ela o teste do #63 mediria outra coisa.
 * 2. **`close` leva a sessão a `closed`** — empurra o estado terminal a todos os ouvintes de
 *    `onState`, como o core faz. Sem isso o teste pararia na causa interna ("ninguém chamou
 *    `close`") em vez de percorrer o elo `close → closed → onEnded → painel fora`, que é o caminho
 *    que o usuário viu.
 *
 * A família `window:` entrou pelo #21 e **não** reproduz regra nenhuma do main, de propósito: ela
 * registra o que foi pedido e publica só quando o teste manda. Um falso que alternasse `maximized`
 * sozinho a cada `toggleMaximizeWindow` esconderia justamente o defeito que a Decisão 5 previne —
 * uma faixa que adiantasse a tela pelo próprio clique passaria verde contra ele, e continuaria
 * errando na janela de verdade toda vez que ela maximizasse por fora (duplo clique, `Win+↑`,
 * arrasto ao topo). Aqui quem move a faixa é o retrato, e o retrato é do teste.
 */
export interface OcFake {
  /** Os `sessionId` que a tela mandou encerrar, na ordem. É a asserção central do #63. */
  readonly fechadas: readonly string[]
  /** Os ids que o `start` entregou, na ordem — prova a idempotência por escopo. */
  readonly entregues: readonly string[]
  /**
   * Os membros da família `window:` que a tela chamou, na ordem e pelo nome — a assinatura
   * inclusive, que é o que deixa a ordem `onWindow` → `readWindow` (assinar antes de pedir) ser
   * afirmada em vez de suposta.
   */
  readonly pedidosDaJanela: readonly string[]
  /** Os membros da mesa que a tela chamou (`createFree`, `openTerminal`…), na ordem e pelo nome. */
  readonly pedidosDaMesa: readonly string[]
  /** Os pedidos de `openTerminal` inteiros — o perfil e o escopo que a tela escolheu. */
  readonly terminaisAbertos: readonly OpenTerminalRequest[]
  /** Publica um retrato da janela aos assinantes de `onWindow`, como o observador do main faz. */
  publicarJanela(snapshot: WindowSnapshot): void
  /** Os pedidos de `openClaude` inteiros, na ordem (#97). */
  readonly claudeAbertos: readonly OpenClaudeRequest[]
  /** Os escopos que a tela mandou `closeClaude`, na ordem. */
  readonly claudeFechados: readonly CloseClaudeRequest[]
  /** O que a tela digitou no PTY (`writeTerminal`), na ordem. */
  readonly escritos: readonly TerminalInputRequest[]
  /** Os redimensionamentos pedidos (`resizeTerminal`), na ordem. */
  readonly redimensionados: readonly TerminalResizeRequest[]
  /**
   * Faz o próximo `openClaude` devolver este resultado em vez do `ok:true` padrão. `segurar` deixa a
   * resposta pendente até `soltar()` — é o que permite o dado chegar antes dela.
   */
  responderClaude(resultado: OpenClaudeResult): void
  segurarClaude(): { soltar(): void }
  /** Publica um `claude:state` aos assinantes de `onClaudeState`. */
  publicarEstadoClaude(event: ClaudeStateEvent): void
  /** Publica um `claude:released` aos assinantes de `onClaudeReleased`. */
  publicarLiberado(event: ClaudeReleasedEvent): void
  /** Publica saída do PTY (`terminal:data`). */
  publicarDado(event: TerminalDataEvent): void
  /** Publica o fim do PTY (`terminal:exit`). */
  publicarSaida(event: TerminalExitEvent): void
}

const ESTADO_INICIAL: TerminalState = { kind: 'starting' }

/** Instala o falso em `window.oc` e devolve o registro do que a tela pediu. */
export function instalarOc(
  layout: LayoutSnapshot = LAYOUT_VAZIO,
  /** As sessões livres que já estão no índice; `criaLivre` faz o `createFree` devolver uma nova. */
  opcoes: { livres?: FreeSessionCard[]; criaLivre?: boolean } = {},
): OcFake {
  const livres = opcoes.livres ?? []
  const ouvintesDeLivres: ((snapshot: FreeSnapshot) => void)[] = []
  const fechadas: string[] = []
  const entregues: string[] = []
  const pedidosDaJanela: string[] = []
  const pedidosDaMesa: string[] = []
  const terminaisAbertos: OpenTerminalRequest[] = []
  const claudeAbertos: OpenClaudeRequest[] = []
  const claudeFechados: CloseClaudeRequest[] = []
  const escritos: TerminalInputRequest[] = []
  const redimensionados: TerminalResizeRequest[] = []
  const ouvintesDeClaude: ((event: ClaudeStateEvent) => void)[] = []
  const ouvintesDeLiberado: ((event: ClaudeReleasedEvent) => void)[] = []
  const ouvintesDeDado: ((event: TerminalDataEvent) => void)[] = []
  const ouvintesDeSaida: ((event: TerminalExitEvent) => void)[] = []
  const vivosClaude = new Map<string, ClaudeStateEvent>()
  let respostaClaude: OpenClaudeResult | null = null
  let seguraClaude: Promise<void> | null = null
  let cunhadosClaude = 0

  // As sessões vivas por escopo, que é o que faz o `start` ser idempotente. Um `Map`, e não um id
  // só, porque a mesma tela pode ter dois escopos em cena ao mesmo tempo.
  const porEscopo = new Map<string, string>()
  let cunhados = 0
  const cunhar = (): string => `sess_${++cunhados}`

  // Um registro por canal. Só o de estado é emitido hoje (pelo `close`), mas os quatro guardam de
  // verdade: é o que faz o cancelamento devolvido ter o que desfazer.
  const ouvintesDeInit: ((event: SessionInitEvent) => void)[] = []
  const ouvintesDeMensagem: ((event: SessionMessageEvent) => void)[] = []
  const ouvintesDeEstado: ((event: SessionStateEvent) => void)[] = []
  const ouvintesDePulso: ((event: SessionActivityEvent) => void)[] = []
  const ouvintesDaJanela: ((snapshot: WindowSnapshot) => void)[] = []

  // Os `on*` guardam o ouvinte e devolvem o cancelamento, como a ponte de verdade — sem isso a
  // limpeza do efeito não teria o que desfazer, e um monte descartado continuaria recebendo evento.
  function assinar<E>(ouvintes: ((event: E) => void)[], ouvinte: (event: E) => void): () => void {
    ouvintes.push(ouvinte)

    return () => {
      const posicao = ouvintes.indexOf(ouvinte)
      if (posicao >= 0) ouvintes.splice(posicao, 1)
    }
  }

  // Só o que o painel toca. Encher os ~25 membros de `OcApi` com stubs não afirmaria nada — e a
  // falta de um membro que passasse a ser usado é justamente o vermelho que se quer ver.
  const api: Partial<OcApi> = {
    start(request?: StartRequest): Promise<StartResult> {
      const escopo = request?.scope
      const chave = escopo === undefined ? null : scopeKey(escopo)

      // Sem escopo, id novo a cada chamada: é a sessão da fatia vertical, que nasce do pedido e não
      // de um escopo a reencontrar.
      const viva = chave === null ? undefined : porEscopo.get(chave)
      const id = viva ?? cunhar()
      if (chave !== null && viva === undefined) porEscopo.set(chave, id)

      entregues.push(id)

      const session: SessionSnapshot = {
        id,
        scope: escopo,
        init: undefined,
        // `starting` porque é o `initialState` do core (`src/core/session/state.ts:43`) — e não é
        // detalhe: com ele o `morta` do `Chat` é falso e o input nasce habilitado, que é o portão
        // pelo qual o teste espera a sessão subir. Escrito como literal, e não importado do core,
        // porque `src/core/` não está no programa web.
        state: { kind: 'starting' },
        messages: [],
        activity: IDLE_ACTIVITY,
      }

      return Promise.resolve({ started: true, session })
    },

    close(request: CloseRequest): Promise<void> {
      fechadas.push(request.sessionId)

      // Síncrono e **antes** de resolver, como o core: quem encerra publica o estado terminal, e é
      // por ele que a tela sai de cena. Emitir depois deixaria o teste afirmar num instante em que
      // o `onEnded` ainda não teve chance de correr.
      for (const ouvinte of [...ouvintesDeEstado]) {
        ouvinte({ sessionId: request.sessionId, state: { kind: 'closed' } })
      }

      return Promise.resolve()
    },

    onInit(ouvinte: (event: SessionInitEvent) => void): () => void {
      return assinar(ouvintesDeInit, ouvinte)
    },

    onMessage(ouvinte: (event: SessionMessageEvent) => void): () => void {
      return assinar(ouvintesDeMensagem, ouvinte)
    },

    onState(ouvinte: (event: SessionStateEvent) => void): () => void {
      return assinar(ouvintesDeEstado, ouvinte)
    },

    onActivity(ouvinte: (event: SessionActivityEvent) => void): () => void {
      return assinar(ouvintesDePulso, ouvinte)
    },

    // O ramo sem pasta não é exercitado por estes testes — `start` sempre sobe. Existe para o painel
    // não esbarrar num membro ausente se aquele caminho for tocado.
    chooseFolder(): Promise<ChooseFolderResult> {
      return Promise.resolve({ chosen: false })
    },

    // O crachá do modo dangerously é do painel, e a tela não espera retorno nenhum dele.
    setDangerous(): Promise<void> {
      return Promise.resolve()
    },

    readWindow(): Promise<WindowSnapshot> {
      pedidosDaJanela.push('readWindow')

      // `false` porque é como a janela nasce — `createWindow` não chama `maximize()` —, e é este
      // retrato do boot que a faixa aplica sobre a própria semente.
      return Promise.resolve({ maximized: false })
    },

    // A assinatura também entra no registro: sem ela, "assinar antes de pedir" não teria como ser
    // afirmado, e é dessa ordem que depende a guarda `pushed` da faixa.
    onWindow(ouvinte: (snapshot: WindowSnapshot) => void): () => void {
      pedidosDaJanela.push('onWindow')

      return assinar(ouvintesDaJanela, ouvinte)
    },

    minimizeWindow(): Promise<void> {
      pedidosDaJanela.push('minimizeWindow')

      return Promise.resolve()
    },

    toggleMaximizeWindow(): Promise<void> {
      pedidosDaJanela.push('toggleMaximizeWindow')

      return Promise.resolve()
    },

    closeWindow(): Promise<void> {
      pedidosDaJanela.push('closeWindow')

      return Promise.resolve()
    },

    // A mesa (#74) também só registra: o layout que ela lê é o que o teste semeou, e o PTY que ela
    // abre é um id fixo — quem fala com um shell de verdade é o smoke, não este falso.
    readLayout(): Promise<LayoutSnapshot> {
      pedidosDaMesa.push('readLayout')

      return Promise.resolve(layout)
    },

    setLayout(): Promise<void> {
      pedidosDaMesa.push('setLayout')

      return Promise.resolve()
    },

    // A janela própria do card (#100) também só registra; quem a abre de verdade é o main.
    cardItemId: null,

    openCardWindow(): Promise<void> {
      pedidosDaMesa.push('openCardWindow')

      return Promise.resolve()
    },

    bringBackCardWindow(): Promise<void> {
      pedidosDaMesa.push('bringBackCardWindow')

      return Promise.resolve()
    },

    focusCardWindow(): Promise<void> {
      pedidosDaMesa.push('focusCardWindow')

      return Promise.resolve()
    },

    readCardWindows(): Promise<string[]> {
      return Promise.resolve([])
    },

    onCardWindows(): () => void {
      return () => {}
    },

    readTerminalPresets(): Promise<TerminalPresetsSnapshot> {
      return Promise.resolve({
        presets: [
          { id: 'powershell', label: 'PowerShell', group: 'shell' },
          { id: 'git-bash', label: 'Git Bash', group: 'shell' },
        ],
      })
    },

    openTerminal(request: OpenTerminalRequest): Promise<OpenTerminalResult> {
      pedidosDaMesa.push('openTerminal')
      terminaisAbertos.push(request)

      return Promise.resolve({
        opened: true,
        terminal: {
          id: `pty_${terminaisAbertos.length}`,
          preset: request.preset,
          title: request.preset,
        },
      })
    },

    closeTerminal(): Promise<void> {
      pedidosDaMesa.push('closeTerminal')

      return Promise.resolve()
    },

    readFree(): Promise<FreeSnapshot> {
      return Promise.resolve({ sessions: [...livres] })
    },

    // O diálogo de pasta não é dirigível: `criaLivre` diz se o humano escolheu uma ou cancelou. A
    // sessão nova é publicada por `onFree` **antes** de a chamada resolver — a ordem em que o main a
    // anuncia não está garantida, e o painel tem de funcionar nas duas.
    createFree(): Promise<CreateFreeResult> {
      pedidosDaMesa.push('createFree')
      if (opcoes.criaLivre !== true) return Promise.resolve({ created: false })

      const nova: FreeSessionCard = {
        id: `free_${livres.length + 1}`,
        title: 'projeto',
        dangerous: false,
        recoverable: false,
      }
      livres.push(nova)
      for (const ouvinte of [...ouvintesDeLivres]) ouvinte({ sessions: [...livres] })

      return Promise.resolve({ created: true, id: nova.id })
    },

    renameFree(request: RenameFreeRequest): Promise<void> {
      pedidosDaMesa.push(`renameFree:${request.id}:${request.title}`)

      return Promise.resolve()
    },

    forgetFree(request: ForgetFreeRequest): Promise<void> {
      pedidosDaMesa.push(`forgetFree:${request.id}`)

      return Promise.resolve()
    },

    onFree(ouvinte: (snapshot: FreeSnapshot) => void): () => void {
      return assinar(ouvintesDeLivres, ouvinte)
    },

    // O terminal Claude (#97): `openClaude` é idempotente por escopo como o main (segundo `open` do
    // mesmo escopo devolve o mesmo id com `spawned:false`), e o dado/saída do PTY têm emissores.
    async openClaude(request: OpenClaudeRequest): Promise<OpenClaudeResult> {
      claudeAbertos.push(request)
      if (seguraClaude !== null) await seguraClaude

      const programado = respostaClaude
      respostaClaude = null
      if (programado !== null) return programado

      const chave = scopeKey(request.scope)
      const viva = vivosClaude.get(chave)
      if (viva !== undefined) {
        return {
          ok: true,
          id: viva.id,
          state: viva.state,
          dangerous: viva.dangerous,
          spawned: false,
        }
      }

      const id = `claude_${++cunhadosClaude}`
      vivosClaude.set(chave, { scope: request.scope, id, state: ESTADO_INICIAL, dangerous: false })

      return { ok: true, id, state: ESTADO_INICIAL, dangerous: false, spawned: true }
    },

    closeClaude(request: CloseClaudeRequest): Promise<void> {
      claudeFechados.push(request)
      vivosClaude.delete(scopeKey(request.scope))

      return Promise.resolve()
    },

    readClaudeStates(): Promise<ClaudeStateEvent[]> {
      return Promise.resolve([...vivosClaude.values()])
    },

    onClaudeState(ouvinte: (event: ClaudeStateEvent) => void): () => void {
      return assinar(ouvintesDeClaude, ouvinte)
    },

    onClaudeReleased(ouvinte: (event: ClaudeReleasedEvent) => void): () => void {
      return assinar(ouvintesDeLiberado, ouvinte)
    },

    writeTerminal(request: TerminalInputRequest): Promise<void> {
      escritos.push(request)

      return Promise.resolve()
    },

    resizeTerminal(request: TerminalResizeRequest): Promise<void> {
      redimensionados.push(request)

      return Promise.resolve()
    },

    onTerminalData(ouvinte: (event: TerminalDataEvent) => void): () => void {
      return assinar(ouvintesDeDado, ouvinte)
    },

    onTerminalExit(ouvinte: (event: TerminalExitEvent) => void): () => void {
      return assinar(ouvintesDeSaida, ouvinte)
    },
  }

  // A asserção mora aqui, e não no descritor: o `value` de um `PropertyDescriptor` é `any` e
  // engoliria qualquer coisa em silêncio. Nesta linha ela é o compilador confirmando que o falso se
  // passa pela ponte inteira.
  const ponte = api as OcApi

  // `Window.oc` é declarado `readonly` (`src/shared/ipc.ts:435-438`), então atribuição direta não
  // compila; `configurable` para o próximo teste poder reinstalar por cima.
  Object.defineProperty(window, 'oc', { value: ponte, configurable: true })

  return {
    fechadas,
    entregues,
    pedidosDaJanela,
    pedidosDaMesa,
    terminaisAbertos,
    claudeAbertos,
    claudeFechados,
    escritos,
    redimensionados,
    responderClaude(resultado: OpenClaudeResult): void {
      respostaClaude = resultado
    },
    segurarClaude(): { soltar(): void } {
      let soltar = (): void => undefined
      seguraClaude = new Promise<void>((resolve) => {
        soltar = resolve
      })

      return {
        soltar: () => {
          seguraClaude = null
          soltar()
        },
      }
    },
    publicarEstadoClaude(event: ClaudeStateEvent): void {
      for (const ouvinte of [...ouvintesDeClaude]) ouvinte(event)
    },
    publicarLiberado(event: ClaudeReleasedEvent): void {
      for (const ouvinte of [...ouvintesDeLiberado]) ouvinte(event)
    },
    publicarDado(event: TerminalDataEvent): void {
      for (const ouvinte of [...ouvintesDeDado]) ouvinte(event)
    },
    publicarSaida(event: TerminalExitEvent): void {
      for (const ouvinte of [...ouvintesDeSaida]) ouvinte(event)
    },
    // Cópia do registro antes de percorrer, como o `close` acima: um ouvinte que se cancele ao
    // receber o retrato não pode furar a iteração de quem ainda não recebeu.
    publicarJanela(snapshot: WindowSnapshot): void {
      for (const ouvinte of [...ouvintesDaJanela]) ouvinte(snapshot)
    },
  }
}
