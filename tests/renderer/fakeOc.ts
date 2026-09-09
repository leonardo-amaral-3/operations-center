import { scopeKey } from '../../src/shared/ipc'
import type {
  ChooseFolderResult,
  CloseRequest,
  OcApi,
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
  /** Publica um retrato da janela aos assinantes de `onWindow`, como o observador do main faz. */
  publicarJanela(snapshot: WindowSnapshot): void
}

/** Instala o falso em `window.oc` e devolve o registro do que a tela pediu. */
export function instalarOc(): OcFake {
  const fechadas: string[] = []
  const entregues: string[] = []
  const pedidosDaJanela: string[] = []

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
    // Cópia do registro antes de percorrer, como o `close` acima: um ouvinte que se cancele ao
    // receber o retrato não pode furar a iteração de quem ainda não recebeu.
    publicarJanela(snapshot: WindowSnapshot): void {
      for (const ouvinte of [...ouvintesDaJanela]) ouvinte(snapshot)
    },
  }
}
