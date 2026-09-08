import { randomUUID } from 'node:crypto'

import type { SettingSource } from '@anthropic-ai/claude-agent-sdk'

import { SessionHandle } from './SessionHandle'
import type { ChatMessage } from './types'

/** O `query()` do SDK, pelo tipo. É este contrato que o fake dos testes cumpre. */
export type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk').query

export interface SessionHostDeps {
  /**
   * Injetado: é o que torna o core inteiro testável sem rede, sem modelo e sem cota — e por isso o
   * `yarn test` roda no CI enquanto o `yarn smoke` não.
   */
  query: QueryFn
  /** Modelo da sessão. Vem de `OC_MODEL`, lido pelo main: o core não lê ambiente. */
  model?: string
  settingSources?: SettingSource[]
}

export interface StartSessionInput {
  cwd: string
  /**
   * O `session_id` do Claude Code a retomar. Ausente: conversa nova.
   *
   * Vai sozinho, **sem `forkSession`**: foi medido que o `resume` puro mantém o mesmo `session_id`
   * no `init`, e é disso que o vínculo durável depende — um fork silencioso escreveria os turnos
   * seguintes noutro transcript, e o registro ficaria apontando para uma conversa que parou.
   */
  resume?: string
  /**
   * A conversa de antes, já traduzida. Semeia a sessão porque o `resume` **não** reemite o
   * histórico pelo stream (medido): sem isto o cartão retomado reabriria em branco, com o contexto
   * intacto do lado do modelo e nada do lado de quem olha.
   */
  history?: readonly ChatMessage[]
  /**
   * Nasce sem o portão do `canUseTool`. Vem da marca do cartão, lida pelo main antes do `start`.
   *
   * Decidido **no nascimento**, e não por um `setPermissionMode` logo depois: entre subir o
   * `query()` e o control request chegar existe uma janela em que o primeiro turno já pode ter
   * pedido a primeira ferramenta — e um cartão marcado que ainda assim pergunta é o CA-1 falhando
   * na única volta em que ninguém está olhando.
   */
  dangerous?: boolean
}

/**
 * O default **não** é `[]`.
 *
 * A doc do SDK diz que a lista precisa conter `'project'` para carregar os `CLAUDE.md`, e o produto
 * depende disso: o app não reimplementa skill nenhuma, ele hospeda os chats onde as skills `gm-*`
 * rodam. Uma sessão sem `CLAUDE.md` e sem as settings do usuário seria um Claude Code amputado.
 *
 * Omitir a opção daria o mesmo resultado hoje (o SDK carrega tudo por padrão), mas escrevê-la
 * registra que essa herança é requisito — e é o que impede alguém, depois, de "isolar" a sessão
 * achando que está endurecendo o app. Quem passa `[]` é só o smoke, para não herdar allowlist
 * pessoal nenhuma.
 */
export const DEFAULT_SETTING_SOURCES: readonly SettingSource[] = ['user', 'project', 'local']

/**
 * Cria sessões. Sabe do SDK e de mais nada: nem de Electron, nem de IPC, nem de onde vieram a pasta
 * de trabalho e o modelo.
 */
export class SessionHost {
  readonly #deps: SessionHostDeps

  constructor(deps: SessionHostDeps) {
    this.#deps = deps
  }

  start(input: StartSessionInput): SessionHandle {
    const { query, model, settingSources = [...DEFAULT_SETTING_SOURCES] } = this.#deps

    return new SessionHandle(
      randomUUID(),
      ({ prompt, canUseTool }) =>
        query({
          prompt,
          options: {
            cwd: input.cwd,
            // Sem `forkSession`: ver `StartSessionInput.resume`. Ausente, o SDK abre conversa nova.
            resume: input.resume,
            model,
            permissionMode: input.dangerous === true ? 'bypassPermissions' : 'default',
            /**
             * **Sempre `true`, inclusive nascendo em `'default'`.**
             *
             * Ela não afrouxa nada sozinha — foi medido (M-4) que uma sessão com a flag e em
             * `'default'` pede permissão exatamente como hoje. O que ela faz é destrancar o
             * `setPermissionMode` do `SessionHandle`: sem ela o control request rejeita com
             * "session was not launched with --dangerously-skip-permissions" (M-3), e o modo
             * deixaria de ser reversível numa sessão viva — só ligável em sessão nova.
             */
            allowDangerouslySkipPermissions: true,
            settingSources,
            // A ponte que leva a decisão até a tela **enquanto o modo estiver desligado**: em
            // `bypassPermissions` o SDK executa a ferramenta sem passar por aqui (M-1), e é essa a
            // escolha explícita do cartão. `allowedTools` continua de fora por outra razão — ele
            // não é reversível numa sessão viva nem separável por cartão.
            canUseTool,
            // Streaming token a token é card do RF-6, não desta fatia.
            includePartialMessages: false,
          },
        }),
      input.history,
      input.dangerous ?? false,
    )
  }
}
