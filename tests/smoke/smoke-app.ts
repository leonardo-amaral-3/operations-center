/**
 * A subida do app sob teste — o **único** chamador de `electron.launch` do repo.
 *
 * Concentrar a subida, e não só o ambiente, é o que torna a garantia verificável: um
 * `electron.launch` novo que simplesmente **omitisse** a chave `env` herdaria tudo por default do
 * Playwright, e nenhuma varredura textual barata pegaria isso. Com um chamador só, a canária de
 * `tests/unit/smoke-launch.test.ts` vira uma regra exata — "nenhum outro arquivo daqui chama
 * `electron.launch`" — em vez de uma heurística.
 */

import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'

import { REPO_ROOT, smokeEnv } from './smoke-env'

export interface LaunchOptions {
  /**
   * A pasta descartável de estado do app.
   *
   * **Obrigatória de propósito**: sem ela o app escreve `preferences.json`, `danger.json` e
   * `conversations.json` no `userData` real de quem roda, e o smoke passa a depender — e a sujar —
   * a máquina. Sendo campo do tipo, esquecê-la é erro de `yarn typecheck`, e não uma canária que
   * alguém descobre meses depois.
   */
  stateDir: string
  /** As portas específicas do arquivo — `OC_BOARD_FIXTURE`, `OC_SCREEN`, `OC_MODEL`… */
  env?: Record<string, string>
}

/**
 * Sobe o app buildado com o ambiente saneado mais as portas do arquivo.
 *
 * A precedência é fixa e **nesta ordem**: herdado saneado → portas do arquivo → `OC_STATE_DIR`. A
 * porta do estado vem por último de propósito, para que um `OC_STATE_DIR` posto por engano dentro de
 * `opts.env` não consiga furar o isolamento que `stateDir` existe para garantir.
 *
 * `ANTHROPIC_API_KEY` continua herdada: apagá-la garantiria o resultado que os smokes de sessão real
 * deveriam estar provando.
 */
export async function launchSmokeApp(opts: LaunchOptions): Promise<ElectronApplication> {
  return electron.launch({
    // O app buildado, resolvido pelo `main` do `package.json`. O `yarn smoke` roda o
    // `electron-vite build` antes justamente para que `out/` exista aqui.
    args: ['.'],
    cwd: REPO_ROOT,
    env: { ...smokeEnv(), ...opts.env, OC_STATE_DIR: opts.stateDir },
  })
}
