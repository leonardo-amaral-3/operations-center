import { randomUUID } from 'node:crypto'

import type { SettingSource } from '@anthropic-ai/claude-agent-sdk'

import { SessionHandle } from './SessionHandle'

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

    return new SessionHandle(randomUUID(), ({ prompt, canUseTool }) =>
      query({
        prompt,
        options: {
          cwd: input.cwd,
          model,
          permissionMode: 'default',
          settingSources,
          // A ponte que leva a decisão até a tela. Ela é a razão de `allowedTools` não ser passado:
          // ferramenta pré-aprovada não dispara o callback, e sem o callback o usuário deixa de ser
          // o portão da sessão.
          canUseTool,
          // Streaming token a token é card do RF-6, não desta fatia.
          includePartialMessages: false,
        },
      }),
    )
  }
}
