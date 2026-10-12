import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'
import { launchSmokeApp } from './smoke-app'

/**
 * O smoke do terminal (#74): abrir um shell de verdade dentro do app, digitar nele, clicar numa URL e
 * ver a mesa voltar depois de fechar e reabrir.
 *
 * **Não consome cota e não toca a rede**: o board vem da fixture, e o shell é o PowerShell da
 * máquina. O que ele prova que nenhum teste unitário alcança é o encontro dos três pedaços que só
 * existem juntos no Electron real — o prebuilt do `node-pty` carregando no `out/`, o xterm no
 * renderer e a guarda de navegação do main. O **artefato empacotado** não passa por aqui (o
 * `yarn smoke` roda o `out/` com `node_modules` solto); quem o prova é a verificação pós-deploy da
 * spec, que é bloqueante por isso.
 *
 * Serial como o `retomada`: o segundo teste é o app **reaberto** e a premissa dele é o que o
 * primeiro deixou em disco.
 */

/** Um shell subindo no ConPTY e imprimindo o prompt. Generoso: o primeiro PowerShell da sessão é lento. */
const SHELL_TIMEOUT = 30_000

/** A saída que só existe se o shell **executou** o comando — ver `linhasDoTerminal`. */
const ECO = 'oc-smoke-ok'

/** A URL do CA-6. `example.com` porque `judgeNavigation` a deixa passar e ninguém a abre aqui. */
const URL_DO_LINK = 'https://example.com/oc-smoke'

/** O arquivo de layout que o app grava no `OC_STATE_DIR`. */
const LAYOUT_FILE = 'layout.json'

let app: ElectronApplication
let window: Page
let scenario: string
let state: string
/** O `data-preset` da aba no primeiro ciclo de vida; o segundo compara com ele. */
let presetDaAba: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  // `realpathSync` pelo mesmo motivo do `retomada`: a comparação é de pasta, não da grafia dela.
  scenario = realpathSync(mkdtempSync(join(tmpdir(), 'oc-terminal-')))
  state = join(scenario, 'state')
  mkdirSync(state)
  mkdirSync(join(scenario, 'projects'))
})

test.afterAll(async () => {
  await app.close()
  // Só depois de o app morrer: um PTY vivo segura handle na pasta no Windows.
  rmSync(scenario, { recursive: true, force: true, maxRetries: 3 })
})

test('CA-1 · CA-7: um clique abre o shell com o foco dentro dele, e o que se digita executa', async () => {
  await launch()

  await window.getByTestId('mesa-new-terminal').click()
  await expect(window.getByTestId('terminal-tab')).toHaveCount(1)

  // CA-7: abrir já deixa o teclado no terminal. `activeElement` e não visibilidade, porque o que
  // importa é para onde a próxima tecla vai — e o xterm a recebe num `textarea` auxiliar.
  await expect
    // Em string porque este tsconfig não tem a lib DOM: o `document` só existe do outro lado.
    .poll(() => window.evaluate(`document.activeElement?.closest('.xterm') != null`), {
      message: 'o foco não foi para dentro do .xterm ao abrir o terminal',
      timeout: SHELL_TIMEOUT,
    })
    .toBe(true)

  await expect.poll(linhasDoTerminal, { timeout: SHELL_TIMEOUT }).toContainEqual(PROMPT)

  presetDaAba = (await window.getByTestId('terminal-tab').getAttribute('data-preset')) ?? ''
  expect(presetDaAba).not.toBe('')

  // Digitado no `textarea` do xterm, que é por onde o teclado de verdade entra. O Enter vai separado
  // para a linha estar inteira antes de ser executada.
  const teclado = window.locator('.xterm-helper-textarea')
  await teclado.pressSequentially(`echo ${ECO}`)
  await teclado.press('Enter')

  // **A linha exata**, e não `toContainText`: o comando digitado (`PS C:\…> echo oc-smoke-ok`)
  // também tem o texto, e uma asserção de "contém" passaria com o shell mudo. Só a saída do
  // `echo` é uma linha que vale exatamente `oc-smoke-ok`.
  await expect
    .poll(linhasDoTerminal, { message: 'a saída do echo não apareceu', timeout: SHELL_TIMEOUT })
    .toContain(ECO)
})

test('CA-6: clicar numa URL no terminal entrega ao navegador e não abre segunda janela', async () => {
  // A premissa a provar (spec, plano de testes): `shell` é um objeto comum e o main resolve
  // `shell.openExternal` na hora da chamada, então trocar a propriedade pega. Provada em vez de
  // suposta — se não pegar, o teste cai no plano B declarado na spec e **diz** que caiu.
  const urlAntes = window.url()
  const stubPegou = await app.evaluate(({ shell }) => {
    const abertas: string[] = []
    ;(globalThis as { __ocAbertas?: string[] }).__ocAbertas = abertas
    const stub = (url: string): Promise<void> => {
      abertas.push(url)

      return Promise.resolve()
    }
    try {
      Object.defineProperty(shell, 'openExternal', { value: stub, configurable: true })
    } catch {
      return false
    }

    return shell.openExternal === stub
  })

  const teclado = window.locator('.xterm-helper-textarea')
  await teclado.pressSequentially(`echo ${URL_DO_LINK}`)
  await teclado.press('Enter')

  // A saída do echo, e não o comando digitado: as duas têm a URL, e clicar na digitada também
  // renderia link — mas só a saída prova que o shell rodou e que o link sobrevive a isso.
  const saida = window.locator('.xterm-rows > div').filter({ hasText: URL_DO_LINK }).last()
  await expect.poll(linhasDoTerminal).toContain(URL_DO_LINK)

  // Por coordenada da página, e não `saida.click()`: o `.xterm-screen` fica por cima das linhas e
  // intercepta o ponteiro — é ele que o xterm escuta, e o Playwright recusa clicar "através" dele.
  // Perto do começo da linha, onde a URL está; o `move` antes do `click` é o que dá ao addon o
  // `hover` que ativa o link.
  const caixa = await saida.boundingBox()
  if (caixa === null) throw new Error('a linha da URL não tem caixa na tela')
  const alvo = { x: caixa.x + 24, y: caixa.y + caixa.height / 2 }

  await window.mouse.move(alvo.x, alvo.y)
  await window.mouse.move(alvo.x + 1, alvo.y)
  await window.mouse.click(alvo.x + 1, alvo.y)

  if (stubPegou) {
    await expect
      .poll(() => app.evaluate(() => (globalThis as { __ocAbertas?: string[] }).__ocAbertas ?? []), {
        message: 'o clique no link não chegou a shell.openExternal',
      })
      .toContain(URL_DO_LINK)
  } else {
    test.info().annotations.push({
      type: 'plano B',
      description:
        'shell.openExternal não aceitou o stub; a entrega ao navegador fica provada por judgeNavigation',
    })
  }

  // Valem nos dois caminhos: o app tem uma janela só, e ela não virou o site clicado.
  expect(app.windows()).toHaveLength(1)
  expect(window.url()).toBe(urlAntes)
})

test('CA-3: fechar e reabrir devolve a aba com o mesmo preset, e o prompt reaparece ao clicar', async () => {
  // O layout é gravado com debounce pelo renderer: fechar antes dele escreveria um teste que
  // passa ou falha pela velocidade da máquina. Espera o arquivo dizer que a aba está lá.
  await expect.poll(abasGravadas, { message: `${LAYOUT_FILE} não recebeu a aba` }).toBe(1)

  await app.close()
  await launch()

  const aba = window.getByTestId('terminal-tab')
  await expect(aba).toHaveCount(1)
  await expect(aba).toHaveAttribute('data-preset', presetDaAba)

  // A aba volta **sem** shell (o PTY morreu com o app); clicar nela é o que sobe um novo.
  await aba.click()
  await expect.poll(linhasDoTerminal, { timeout: SHELL_TIMEOUT }).toContainEqual(PROMPT)
})

test('sem menu, Ctrl+R é do shell; e recarregar a janela mata o shell que ela abriu', async () => {
  // Decisão 23 da spec: o menu default do Electron, mesmo escondido, recarregava a janela no Ctrl+R.
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull()

  const teclado = window.locator('.xterm-helper-textarea')
  await teclado.pressSequentially('$PID')
  await teclado.press('Enter')
  let pid = 0
  await expect
    .poll(
      async () => {
        pid = Number((await linhasDoTerminal()).find((linha) => /^\d+$/.test(linha)) ?? 0)

        return pid
      },
      { message: 'o $PID do shell não apareceu', timeout: SHELL_TIMEOUT },
    )
    .toBeGreaterThan(0)

  // Com o menu default, a janela recarregaria e a marca sumiria. Sem ele o PSReadLine recebe o ^R e
  // abre a busca reversa — a prova de que a tecla chegou ao shell, e não só de que nada aconteceu.
  await window.evaluate(`window.__ocMarca = 1`)
  await teclado.press('Control+r')
  await expect
    .poll(async () => (await linhasDoTerminal()).some((linha) => linha.includes('bck-i-search')), {
      message: 'o Ctrl+R não chegou ao PSReadLine',
      timeout: SHELL_TIMEOUT,
    })
    .toBe(true)
  await teclado.press('Escape')
  expect(await window.evaluate(`window.__ocMarca`)).toBe(1)

  // O reload troca o documento e mantém o `WebContents`: o `destroyed` não dispara, e o shell
  // ficaria órfão para o `hydrate` subir outro por cima. Quem o mata é o `did-navigate`.
  await window.reload()
  await expect
    .poll(
      () =>
        app.evaluate((_electron, alvo) => {
          try {
            process.kill(alvo, 0)

            return true
          } catch {
            return false
          }
        }, pid),
      { message: `o shell ${pid} sobreviveu ao reload da janela`, timeout: SHELL_TIMEOUT },
    )
    .toBe(false)
})

/** Uma linha de prompt do PowerShell (`PS C:\pasta>`), com ou sem o resto digitado. */
const PROMPT = expect.stringMatching(/^PS .*>/)

/**
 * O texto de cada linha do terminal, aparado.
 *
 * Lê o renderer **DOM** do xterm (`.xterm-rows`) — o default dele, e o que o `TerminalView` usa:
 * sem addon de canvas ou WebGL, cada linha é uma `div` com texto de verdade, o que torna o terminal
 * legível por teste. Se um dia o renderer trocar, é aqui que o smoke quebra primeiro, e é o aviso
 * certo.
 */
async function linhasDoTerminal(): Promise<string[]> {
  const linhas = await window.locator('.xterm-rows > div').allTextContents()

  // O xterm preenche a linha com espaço rígido (U+00A0); `trim()` o come junto com os comuns.
  return linhas.map((linha) => linha.trim())
}

/** Quantas abas o `layout.json` já tem; 0 enquanto o arquivo não existe ou não presta. */
function abasGravadas(): number {
  try {
    const layout = JSON.parse(readFileSync(join(state, LAYOUT_FILE), 'utf8')) as {
      dock?: { terminals?: unknown[] }
    }

    return layout.dock?.terminals?.length ?? 0
  } catch {
    return 0
  }
}

async function launch(): Promise<void> {
  app = await launchSmokeApp({
    stateDir: state,
    env: {
      // O board vem de arquivo: este smoke não toca a rede e não pede token.
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      // Uma raiz vazia: a varredura de repos não precisa ler o `~/.claude` de quem roda isto.
      OC_CLAUDE_PROJECTS: join(scenario, 'projects'),
      OC_SCREEN: 'kanban',
    },
  })

  window = await app.firstWindow()
}
