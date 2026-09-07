import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { parseOklch, parseThemes } from '../../src/main/sheet'
import type { Theme } from '../../src/shared/theme'

/**
 * O smoke do tema: a combinação de cores escolhida é a que a tela desenha.
 *
 * É o único lugar do repo que prova o trilho inteiro — `OC_THEME` no main → `--oc-theme=` em
 * `additionalArguments` → `window.oc.theme` no preload → `data-theme` no `<html>` → a cascata
 * pintando três superfícies. Tudo antes disso o `yarn test` cobre; isto aqui exige um Chromium de
 * verdade, e por isso é smoke.
 *
 * **Não toca a rede, não pede token e não consome cota**: como o smoke do kanban, a única fonte de
 * dado é `tests/fixtures/board.json`. O que ele custa é o tempo de subir o Electron duas vezes.
 *
 * **Nenhum valor de cor é escrito à mão.** O que o teste sabe sobre as combinações sai de
 * `parseThemes` sobre a folha do disco — mesma disciplina que `kanban.smoke.spec.ts:15-18` declara
 * para a fixture. O que ele afirma é *diferença*, *igualdade* e *matiz*, nunca um hex esperado: os
 * valores absolutos são âncora do teste unitário (`windowBackground` das duas e a lavanda
 * congelada), e congelá-los aqui também seria pagar duas vezes por uma prova só.
 *
 * O import de `parseThemes`/`parseOklch` vem de `src/main/sheet` e **nunca** de `src/main/theme`:
 * aquele tem o `import … from '…?raw'` do Vite, e o Playwright não roda o Vite — seria
 * `MODULE_NOT_FOUND` já na coleta.
 */

// `__dirname` e não `import.meta.url`: o Playwright transpila os specs para CommonJS enquanto o
// `package.json` não for `type: module`, e `import.meta` ali é erro de sintaxe.
const REPO_ROOT = join(__dirname, '..', '..')

/** **Absoluto**, e é o ponto: o processo do Electron não roda com a `cwd` do runner. */
const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'board.json')

/** A folha do design system, lida do disco — a mesma que o main importa como texto. */
const FOLHA_PATH = join(REPO_ROOT, 'src', 'renderer', 'index.css')

const COMBINACOES = parseThemes(readFileSync(FOLHA_PATH, 'utf8'))

/** O que uma subida do app tem a dizer sobre a sua combinação de cores. */
interface Medida {
  readonly theme: string | null
  readonly canvas: string
  readonly cabecalho: string
  readonly face: string
}

test('a combinação escolhida é a que a tela desenha', async () => {
  // A ametista primeiro, a default depois: a segunda medição é a que precisa do ambiente limpo, e
  // deixá-la por último é o que garante que nada da primeira sobrou pendurado.
  const ametista = await medir('ametista')
  const lavanda = await medir()

  expect(ametista.theme, 'com `OC_THEME=ametista`, o `<html>` não carrega a ametista').toBe(
    'ametista',
  )
  expect(lavanda.theme, 'sem `OC_THEME`, o `<html>` não carrega a lavanda').toBe('lavanda')

  // Uma asserção por superfície, nomeando quem empatou: é o par que fecha CA-1 e CA-2 de uma vez —
  // uma combinação que não chegasse à tela faria os dois primeiros coincidirem, e "algo empatou" não
  // diria qual pedaço da cascata ficou para trás.
  expect(ametista.canvas, 'o canvas é o mesmo nas duas combinações').not.toBe(lavanda.canvas)
  expect(ametista.cabecalho, 'o cabeçalho de coluna é o mesmo nas duas combinações').not.toBe(
    lavanda.cabecalho,
  )

  // A face **é** a mesma nas duas, e afirmá-lo é guarda, não desistência: `--secondary-background` é
  // branco em toda combinação clara por decisão #161 — um fundo secundário escuro renderiza `Input` e
  // `Textarea` preto-no-preto. Um teste que espera igual fala no dia em que alguém mexer nisso; um
  // teste que não olha é buraco. Ver a emenda do CA-1 na spec.
  expect(ametista.face, 'a face de cartão deixou de ser o mesmo branco nas duas').toBe(lavanda.face)

  // A outra metade do CA-1, e a que só a combinação nova pode falhar: os três níveis de hierarquia
  // ainda se distinguem **sob a ametista**. Sem isto, uma ametista cujo `--main` empatasse com o
  // `--background` passaria verde — ela continuaria diferente da lavanda nos dois, e mesmo assim
  // desenharia um kanban de dois níveis. É o que `kanban.smoke.spec.ts:254-256` cobra da lavanda.
  expect(ametista.canvas, 'sob a ametista, o canvas e o cabeçalho de coluna empatam').not.toBe(
    ametista.cabecalho,
  )
  expect(ametista.cabecalho, 'sob a ametista, o cabeçalho e a face de cartão empatam').not.toBe(
    ametista.face,
  )
  expect(ametista.canvas, 'sob a ametista, o canvas e a face de cartão empatam').not.toBe(
    ametista.face,
  )

  // E o cabeçalho traz o matiz **daquela** combinação, não de uma qualquer: o Chromium serializa cor
  // computada no espaço de origem, então o oklch chega inteiro e o `h` é o que diz "esta é a
  // ametista". Mesma técnica que `kanban.smoke.spec.ts:238-241` usa para a sombra dura.
  expect(ametista.cabecalho, 'o cabeçalho de coluna não está no matiz da ametista').toMatch(
    matizDoAcento('ametista'),
  )
  expect(lavanda.cabecalho, 'o cabeçalho de coluna não está no matiz da lavanda').toMatch(
    matizDoAcento('lavanda'),
  )
})

/**
 * Sobe o app com o ambiente pedido, mede as três superfícies e o atributo, e **fecha**.
 *
 * Não é o `beforeAll` do kanban smoke, que sobe **uma** instância para o arquivo inteiro: aqui são
 * dois ambientes diferentes, e duas instâncias do Electron não podem coexistir. O `close()` no
 * `finally` é o que impede um Electron pendurado de travar a segunda subida quando a primeira falha.
 */
async function medir(tema?: string): Promise<Medida> {
  const app = await electron.launch({
    // O app buildado, resolvido pelo `main` do `package.json`. O `yarn smoke` roda o
    // `electron-vite build` antes justamente para que `out/` exista aqui.
    args: ['.'],
    cwd: REPO_ROOT,
    env: envDoLaunch(tema),
  })

  try {
    const janela = await app.firstWindow()
    const coluna = janela.getByTestId('column').first()
    const cartao = janela.getByTestId('board-card').first()

    // Esperar o board desenhar antes de medir: sem cartão na tela, `face` mediria um elemento que
    // ainda não existe e o vermelho falaria de timeout, não de cor.
    await expect(cartao, 'o kanban não desenhou nenhum cartão').toBeVisible()

    // Os mesmos três níveis que o CA-2 do kanban compara, e pela mesma razão: o canvas sai do `body`
    // porque é ele que o `index.css` pinta; o cabeçalho é a única superfície `bg-main` da tela; a
    // face de cartão é o branco. Se a combinação chegou, os três mudam juntos.
    return {
      theme: await janela.locator('html').getAttribute('data-theme'),
      canvas: await corDeFundo(janela.locator('body')),
      cabecalho: await corDeFundo(coluna.locator('header')),
      face: await corDeFundo(cartao),
    }
  } finally {
    await app.close()
  }
}

/**
 * O ambiente do launch, que é o do kanban smoke (`:120-133`) mais a porta do tema.
 *
 * `OC_THEME` é **apagado** do herdado e só volta quando `tema` vier definido: a medição da default
 * precisa que a variável esteja genuinamente ausente, e `inheritedEnv()` traria a do shell de quem
 * roda — que é justamente o cenário do CA-2.
 */
function envDoLaunch(tema: string | undefined): Record<string, string> {
  const env: Record<string, string> = {
    ...inheritedEnv(),
    // A porta que troca o GitHub por um arquivo. É ela que torna este smoke determinístico.
    OC_BOARD_FIXTURE: FIXTURE_PATH,
    // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell abriria a tela errada, e as três
    // superfícies que este teste mede só existem no kanban.
    OC_SCREEN: 'kanban',
    // Inertes de propósito: a fixture ignora documento e variáveis, e se um dia a fiação dela
    // quebrar o app tentará ler um board que não existe — vermelho na hora, em vez de um smoke
    // passando em silêncio contra o board de verdade.
    OC_PROJECT_OWNER: 'dono-que-a-fixture-ignora',
    OC_PROJECT_NUMBER: '999',
  }

  delete env['OC_THEME']

  if (tema !== undefined) env['OC_THEME'] = tema

  return env
}

/**
 * A regex que reconhece o acento de uma combinação pelo matiz, **construída a partir da folha**.
 *
 * Digitar `oklch(0.7028 0.1753 295.36)` aqui seria um esperado congelado que quebra no dia em que
 * alguém reafinar a paleta — vermelho que não diz nada sobre o código. O que importa é o `h`: é ele
 * que distingue uma combinação da outra, já que as duas compartilham a luminosidade.
 */
function matizDoAcento(theme: Theme): RegExp {
  const valor = COMBINACOES.get(theme)?.get('--main')

  if (valor === undefined) {
    throw new Error(`a combinação ${theme} não declara --main na folha`)
  }

  const matiz = parseOklch(valor)[2]

  return new RegExp(`oklch\\([\\d.]+ [\\d.]+ ${matiz}`)
}

/**
 * O `getComputedStyle` do navegador, declarado aqui e não importado de lugar nenhum.
 *
 * Cópia deliberada de `kanban.smoke.spec.ts:330`, e copiar é o certo: extrair um módulo de helpers
 * de smoke é refactor de três arquivos que este card não pediu, e o revisor não teria como avaliá-lo
 * junto de uma mudança de tema. O `tsconfig.node.json` que compila os smokes **não** carrega a lib
 * DOM, e não deve: `src/main`, `src/core` e `src/preload` são Node, e uma lib DOM ali deixaria um
 * `document` solto passar despercebido numa revisão.
 */
declare function getComputedStyle(element: unknown): { backgroundColor: string }

/** O `background-color` computado — a mesma cópia, pela mesma razão. */
async function corDeFundo(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor)
}

/**
 * O `process.env` do runner, pronto para o Playwright: passar `env` substitui o ambiente inteiro, e
 * sem `PATH` o Electron nem subiria. As chaves sem valor caem porque o tipo do Playwright só aceita
 * string.
 */
function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}
