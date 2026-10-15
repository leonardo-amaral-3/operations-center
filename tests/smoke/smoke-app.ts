/**
 * A subida do app sob teste — o **único** chamador de `electron.launch` do repo.
 *
 * Concentrar a subida, e não só o ambiente, é o que torna a garantia verificável: um
 * `electron.launch` novo que simplesmente **omitisse** a chave `env` herdaria tudo por default do
 * Playwright, e nenhuma varredura textual barata pegaria isso. Com um chamador só, a canária de
 * `tests/unit/smoke-launch.test.ts` vira uma regra exata — "nenhum outro arquivo daqui chama
 * `electron.launch`" — em vez de uma heurística.
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect } from '@playwright/test'
import type { ElectronApplication, Locator } from '@playwright/test'

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

/**
 * A pergunta dos smokes de terminal Claude (#97): a resposta (`42`) não aparece no texto enviado,
 * então vê-la na tela prova que o modelo respondeu, e não que o eco do teclado chegou.
 */
export const PERGUNTA_17_25 = 'Responda só o resultado de 17+25'

/** A resposta de `PERGUNTA_17_25` como a TUI a desenha: o marcador de resposta, depois o texto. */
export const RESPOSTA_42 = /[●⏺]\s*42/

/** O texto visível do xterm do terminal Claude (`.xterm-rows`, o renderer DOM do xterm). */
export function xtermDe(terminal: Locator): Locator {
  return terminal.locator('.xterm-rows')
}

/**
 * Digita no xterm pelo `textarea` auxiliar, que é por onde o teclado de verdade entra, e manda Enter.
 *
 * A primeira abertura de uma pasta nunca vista mostra o diálogo de confiança da CLI (P10), e nenhum
 * hook dispara antes dele. Quem responde é a pessoa; o smoke responde por ela escolhendo "Yes, I
 * trust this folder" e só então digita.
 */
export async function digitarNoTerminal(terminal: Locator, texto: string): Promise<void> {
  const tela = xtermDe(terminal)
  const teclado = terminal.locator('.xterm-helper-textarea')

  // O xterm pausa o desenho do que está fora da janela: sem rolar até ele, a TUI roda e a tela fica em branco.
  await terminal.scrollIntoViewIfNeeded()

  await expect
    .poll(
      async () => {
        const visivel = (await tela.textContent()) ?? ''
        if (/trust this folder/i.test(visivel)) {
          // Na CLI 2.1.287 a seta já vem em "No, exit" e Enter sairia: confirma só com o "Yes"
          // marcado, e desce uma linha quando é o "No" que está marcado.
          await teclado.press(/❯\s*Yes/i.test(visivel) ? 'Enter' : 'ArrowDown')
          return false
        }

        return visivel.trim() !== ''
      },
      { message: 'a TUI do Claude não desenhou nada no terminal', timeout: 60_000 },
    )
    .toBe(true)
  await expect(tela).not.toContainText(/trust this folder/i)

  // Tecla a tecla e com folga antes do Enter: o Ink lê rajada como colagem e o Enter dela vira
  // quebra de linha, deixando o prompt escrito e nunca enviado.
  await teclado.pressSequentially(texto, { delay: 20 })
  await expect(tela).toContainText(texto)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await teclado.press('Enter')
}

/**
 * Prova que a sessão do Claude Code subiu **nesta pasta**: o transcript dela nasce em
 * `~/.claude/projects/<caminho com tudo que não é letra ou dígito trocado por "-">`, e é a pasta de
 * verdade do processo que decide onde ele cai. O cabeçalho da TUI não serve: ele encurta o caminho,
 * e o nome da pasta some no `%TEMP%` do Windows.
 */
export async function provarSessaoNaPasta(pasta: string): Promise<void> {
  const transcripts = join(homedir(), '.claude', 'projects', pasta.replace(/[^A-Za-z0-9]/g, '-'))

  await expect
    .poll(
      () => existsSync(transcripts) && readdirSync(transcripts).some((n) => n.endsWith('.jsonl')),
      {
        message: `nenhum transcript em ${transcripts}`,
        timeout: 30_000,
      },
    )
    .toBe(true)
}

/** O pedaço do DOM que a subida pela árvore toca; o tsconfig dos smokes não carrega a lib `dom`. */
type Elemento = { parentElement: Elemento | null }

declare function getComputedStyle(element: unknown): { backgroundColor: string }

/**
 * O fundo que de fato aparece atrás do elemento: o `background-color` computado dele ou, se for
 * transparente, o do ancestral mais próximo que pinta. O contêiner do xterm não pinta nada, e quem
 * veste o canvas atrás dele é o invólucro do `ClaudeTerminal`.
 */
export async function fundoEfetivo(locator: Locator): Promise<string> {
  return locator.evaluate((element: Elemento) => {
    let atual: Elemento | null = element

    while (atual !== null) {
      const cor = getComputedStyle(atual).backgroundColor
      if (cor !== 'rgba(0, 0, 0, 0)' && cor !== 'transparent') return cor
      atual = atual.parentElement
    }

    return 'rgba(0, 0, 0, 0)'
  })
}
