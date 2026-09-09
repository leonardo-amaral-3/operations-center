/**
 * O ambiente com que os smokes sobem o app — o **único** lugar de `tests/smoke/` que lê
 * `process.env`, e o único que sabe o que o app sob teste não pode herdar do shell de quem roda.
 *
 * Vive separado de `smoke-app.ts` por uma razão só, e ela é de dependência: a canária de
 * `tests/unit/smoke-launch.test.ts` precisa importar este construtor, e ela roda no Vitest — que não
 * pode arrastar `@playwright/test` para dentro do `yarn test`. Por isso aqui só entram `node:path` e
 * `process.env`; quem chama o Playwright é o módulo ao lado.
 */

import { join } from 'node:path'

// `__dirname` e não `import.meta.url`: o Playwright transpila os specs para CommonJS enquanto o
// `package.json` não for `type: module`, e `import.meta` ali é erro de sintaxe. Do outro lado, o
// Vitest — que importa este módulo como ESM — define `__dirname` no seu runner (medido em
// 2026-09-09), então a mesma linha serve aos dois.
export const REPO_ROOT = join(__dirname, '..', '..')

/**
 * As variáveis que o app sob teste **nunca** pode herdar do shell de quem roda.
 *
 * Duas, e cada uma por uma razão diferente — é por isso que a lista não é um bloco só:
 *
 * - **`ELECTRON_RENDERER_URL`** é o defeito do #57. `src/main/index.ts:153` a lê e, com valor,
 *   carrega `loadURL(devServerUrl)` em vez de `loadFile(indexFile)`: um `yarn smoke` disparado de um
 *   shell nascido de `yarn dev` mediria o renderer do dev server, e não o buildado que ele acabou de
 *   compilar. Ler a variável é o comportamento **correto** do app; o defeito sempre foi o teste
 *   passá-la adiante.
 * - **`OC_THEME`** já era apagada por `tema.smoke.spec.ts`, que precisa da combinação *default*
 *   genuinamente ausente para medi-la. Trazer o `delete` para cá é o que preserva aquele critério e,
 *   de quebra, fecha o mesmo buraco nos outros smokes, que hoje a herdam em silêncio.
 *
 * **As três outras variáveis que uma sessão de `yarn dev` carrega ficam de fora de propósito** — e
 * este parágrafo existe para que quem topar com o contorno de quatro `-u` no histórico não as
 * acrescente de volta achando que corrige algo:
 *
 * - `NODE_ENV_ELECTRON_VITE` não contamina o build. O `electron-vite build` a reescreve para
 *   `production` na primeira linha, antes de resolver a config, então o `base: './'` do renderer —
 *   que é o que faria o `file://` quebrar — está a salvo mesmo herdando `development`.
 * - `ELECTRON_CLI_ARGS` e `ELECTRON_EXEC_PATH` só são lidas pelo CLI do próprio electron-vite. Nem
 *   `src/` nem o `electron.launch` do Playwright as consultam.
 *
 * Apagá-las seria três deletes inertes que ninguém saberia revisar depois.
 */
const NAO_HERDAVEIS = ['ELECTRON_RENDERER_URL', 'OC_THEME'] as const

/**
 * O `process.env` do runner saneado, pronto para o Playwright: passar `env` substitui o ambiente
 * inteiro, e sem `PATH` o Electron nem subiria. As chaves sem valor caem porque o tipo do Playwright
 * só aceita string.
 *
 * O `delete` é **casamento exato**, e isso basta: a cópia perde a insensibilidade a maiúsculas que
 * `process.env` tem no Windows, mas quem escreve estas duas variáveis as escreve com o nome exato —
 * o electron-vite por atribuição direta, os smokes por literal. Generalizar para varredura
 * case-insensitive sem um caso real que a exija seria inventar defeito.
 */
export function smokeEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )

  for (const chave of NAO_HERDAVEIS) delete env[chave]

  return env
}
