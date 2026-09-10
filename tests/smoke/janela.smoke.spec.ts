import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'
import { launchSmokeApp } from './smoke-app'

/**
 * O smoke da janela: os três botões da faixa comandam a `BrowserWindow` de verdade.
 *
 * **É o único teste que fecha o pior modo de falha do #21.** Um `WindowBar` que suma de `App.tsx`,
 * um `registerWindowIpc()` que ninguém chame, um canal renomeado num lado só da ponte — cada um
 * desses deixa a janela **sem como fechar**, e nenhum é erro de compilação, de lint ou de unitário.
 * Com `frame: false` não há mais o `✕` do sistema atrás para salvar: a saída do app passou a ser
 * código nosso, e o que é código nosso precisa de prova mecânica. Clicar `window-close` numa janela
 * de verdade e ver o processo encerrar é essa prova.
 *
 * **O que ele lê não é DOM, e é esse o ponto.** O rótulo do botão do meio trocar de `Maximizar` para
 * `Restaurar` já é afirmado por `tests/renderer/WindowBar.test.tsx` com a ponte dublada, e os quatro
 * canais por `tests/unit/janela.test.ts` com a `BrowserWindow` dublada. Os dois passariam verdes com
 * a ponte desligada nas pontas. O que só existe aqui é o trilho inteiro — clique no renderer →
 * `invoke` pelo preload → `ipcMain.handle` no main → a janela do Windows mudando de estado —, e por
 * isso toda asserção deste arquivo sai de `electronApp.evaluate` sobre a janela real, nunca do que a
 * tela diz sobre si mesma.
 *
 * **Não toca a rede, não pede token e não consome cota**: como o do kanban e o do tema, as únicas
 * fontes de dado são `tests/fixtures/boards.json` e `tests/fixtures/board.json`. A faixa mora na
 * raiz da árvore e é desenhada em qualquer tela, então o kanban de fixture serve — e é o mais barato
 * que serve. O que ele custa é uma subida do Electron.
 *
 * **Uma subida só, e um `test` só.** A sequência é uma narrativa com estado — maximiza, restaura,
 * minimiza, restaura, fecha — e o último passo mata o app: partida em vários `test`, a ordem viraria
 * contrato implícito do arquivo e o último rodaria contra um processo morto.
 */

/**
 * O prazo de uma mudança de estado da janela pedida por clique.
 *
 * Generoso perto do que se espera de fato — um `invoke` local e uma chamada de API do Windows —, e
 * curto perto do prazo do teste. Ele existe porque **nada aqui é síncrono com o clique**: o clique
 * volta assim que o evento de mouse sai, e a maximização acontece um round trip de IPC depois, com a
 * animação do Windows por cima. Ler o estado logo após o clique leria o de antes.
 */
const MUDANCA_TIMEOUT = 15_000

/**
 * O prazo do encerramento. Mais folgado que o de cima porque não é uma chamada só: o `close()` do
 * main dispara `window-all-closed`, e é ali que `sessionIpc.closeAll()` e `app.quit()` moram desde o
 * #1 — o processo só morre depois que aquele encerramento correr.
 */
const ENCERRAMENTO_TIMEOUT = 30_000

/** O que a janela de verdade tem a dizer sobre si — lido no main, num round trip só. */
interface Retrato {
  readonly visivel: boolean
  readonly maximizada: boolean
  readonly minimizada: boolean
}

let app: ElectronApplication
let janela: Page
/** Descartável, e não o `userData` real: sem `preferences.json`, `pickActive` cai no primeiro. */
let state: string
/**
 * Se o app já morreu pelo clique — que é o desfecho **esperado** deste arquivo.
 *
 * O `afterAll` fecha o app só quando esta bandeira for falsa, e ela é a diferença entre limpeza e
 * ruído: num teste que passa não há o que fechar, e num que falhe antes do último clique há um
 * Electron pendurado que precisa morrer para o `rmSync` conseguir apagar o cofre.
 */
let encerrouSozinho = false

test.beforeAll(async () => {
  state = mkdtempSync(join(tmpdir(), 'oc-janela-'))

  app = await launchSmokeApp({
    stateDir: state,
    env: {
      // As portas que trocam o GitHub por arquivo, e são elas que mantêm este smoke fora da rede.
      // São **duas**: sem `OC_BOARDS_FIXTURE` a descoberta não tem o que responder e lança.
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell de quem roda abriria a tela
      // que **sobe sessão real**, e este arquivo inteiro existe para não custar cota. A faixa é a
      // mesma nas duas telas — a raiz a desenha —, então fixar a barata não perde nada.
      OC_SCREEN: 'kanban',
    },
  })

  janela = await app.firstWindow()
})

test.afterAll(async () => {
  if (!encerrouSozinho) await app.close()

  // Depois do app morto: enquanto um Electron vive, o Windows segura handles na pasta. O
  // `maxRetries` é a mesma folga dos outros smokes, para o caso de ele ainda estar soltando o
  // último.
  rmSync(state, { recursive: true, force: true, maxRetries: 3 })
})

test('CA-2: os três botões da faixa comandam a janela, e o de fechar encerra o app', async () => {
  // A precondição, e ela não é cerimônia: `createWindow` abre com `show: false` e só chama `show()`
  // no `ready-to-show`, enquanto `firstWindow()` resolve assim que o renderer existe. Playwright
  // considera o botão clicável já aí — o DOM está pintado —, e um `maximize()` pedido a uma janela
  // que o Windows ainda não mostrou é a corrida que faria este arquivo piscar vermelho sem ter nada
  // a ver com a ponte.
  await esperarRetrato('visivel', true, 'a janela não chegou a aparecer na tela')

  // O ponto de partida declarado, e não presumido: `createWindow` não chama `maximize()`, então a
  // janela nasce restaurada. Sem esta linha, um app que já abrisse maximizado faria a asserção
  // seguinte passar sem que clique nenhum tivesse feito nada.
  expect(await retratoDaJanela(), 'a janela não nasceu restaurada').toMatchObject({
    maximizada: false,
    minimizada: false,
  })

  await janela.getByTestId('window-maximize').click()
  await esperarRetrato('maximizada', true, 'o clique no botão do meio não maximizou a janela')

  // O mesmo botão de novo, e é o que prova a Decisão 5: o canal é `toggle`, e quem escolhe entre
  // maximizar e restaurar é o main lendo `isMaximized()` da própria janela. Um renderer que
  // escolhesse pelo estado que ele guarda passaria na linha de cima e falharia aqui.
  await janela.getByTestId('window-maximize').click()
  await esperarRetrato(
    'maximizada',
    false,
    'o segundo clique no botão do meio não restaurou a janela',
  )

  await janela.getByTestId('window-minimize').click()
  await esperarRetrato('minimizada', true, 'o clique no botão da esquerda não minimizou a janela')

  // Restaurar **pelo `evaluate`**, e não por um quarto botão: a faixa não tem botão de restaurar de
  // minimizada — quem tem é a barra de tarefas do Windows, que o Playwright não alcança. O que se
  // desfaz aqui é só o efeito colateral da asserção de cima, para o clique seguinte acontecer numa
  // janela que está na tela.
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) throw new Error('o main não tem janela nenhuma para restaurar')

    window.restore()
  })
  await esperarRetrato('minimizada', false, 'a janela não voltou da minimização')

  // A escuta **antes** do clique, e não depois: o `waitForEvent` do Playwright não olha para trás, e
  // um app que morresse rápido demais deixaria a espera pendurada até o prazo — um vermelho de
  // "encerrou tarde" contando a história de um app que encerrou na hora.
  const encerrou = app.waitForEvent('close', { timeout: ENCERRAMENTO_TIMEOUT })

  await janela.getByTestId('window-close').click()

  // A única asserção deste arquivo que não é sobre estado de janela, e a mais importante das cinco:
  // com `frame: false` não há mais um `✕` do sistema atrás desta linha. Se ela cair, o app não tem
  // saída — e quem rodar o `yarn dev` a partir daí vai ter de matar o processo pelo gerenciador de
  // tarefas para descobrir por quê.
  await encerrou
  encerrouSozinho = true
})

/**
 * O retrato lido no processo principal, e o único caminho deste arquivo até a verdade.
 *
 * Sai como um objeto de três campos, e não três chamadas: os três saem do mesmo instante da mesma
 * janela, então nenhuma asserção pode ficar comparando estados colhidos em momentos diferentes.
 *
 * A janela vem de `getAllWindows()` porque o app tem exatamente uma e o smoke sobe uma instância só.
 * Não haver nenhuma é a falha que este arquivo mais precisa nomear em voz alta — depois do clique de
 * fechar é o desfecho certo, e antes dele é o app tendo morrido sozinho.
 */
async function retratoDaJanela(): Promise<Retrato> {
  return app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) throw new Error('o main não tem janela nenhuma')

    return {
      visivel: window.isVisible(),
      maximizada: window.isMaximized(),
      minimizada: window.isMinimized(),
    }
  })
}

/**
 * Espera um campo do retrato chegar ao valor pedido, relendo até o prazo.
 *
 * `expect.poll` e não uma leitura seca: o clique volta antes de a janela mudar, e entre os dois há o
 * round trip do IPC e a animação do Windows. Repetir é o que torna a espera barata quando ela chega
 * rápido — que é sempre — sem transformar o teste numa soma de esperas fixas chutadas.
 */
async function esperarRetrato(
  campo: keyof Retrato,
  esperado: boolean,
  mensagem: string,
): Promise<void> {
  await expect
    .poll(async () => (await retratoDaJanela())[campo], {
      message: mensagem,
      timeout: MUDANCA_TIMEOUT,
    })
    .toBe(esperado)
}
