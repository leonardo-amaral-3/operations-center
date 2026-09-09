import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { parseOklch, parseThemes } from '../../src/main/sheet'
import type { Theme } from '../../src/shared/theme'
import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'

/**
 * O smoke do tema: a combinação de cores escolhida é a que a tela desenha.
 *
 * É o único lugar do repo que prova o trilho inteiro — `OC_THEME` no main → `--oc-theme=` em
 * `additionalArguments` → `window.oc.theme` no preload → `data-theme` no `<html>` → a cascata
 * pintando três superfícies. Tudo antes disso o `yarn test` cobre; isto aqui exige um Chromium de
 * verdade, e por isso é smoke.
 *
 * **Não toca a rede, não pede token e não consome cota**: como o smoke do kanban, as únicas fontes
 * de dado são `tests/fixtures/boards.json` (a descoberta) e `tests/fixtures/board.json` (o board da
 * aba). O que ele custa é o tempo de subir o Electron três vezes.
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

/** A folha do design system, lida do disco — a mesma que o main importa como texto. */
const FOLHA_PATH = join(REPO_ROOT, 'src', 'renderer', 'index.css')

const COMBINACOES = parseThemes(readFileSync(FOLHA_PATH, 'utf8'))

/** O que uma subida do app tem a dizer sobre a sua combinação de cores. */
interface Medida {
  readonly theme: string | null
  readonly canvas: string
  readonly cabecalho: string
  readonly face: string
  /** A cor do polegar da barra de rolagem — o que muda de uma combinação para a outra. */
  readonly barra: string
  /** A largura que a regra declara: `12px` com o bloco na folha, `auto` sem ele. */
  readonly barraLargura: string
  /** O espaço que o contêiner nº 1 reserva de fato — a barra observada, não a regra lida. */
  readonly gutter: number
  /** A `color` computada do `<h2>` do cabeçalho de coluna — a tinta do acento, e não a do canvas. */
  readonly tintaDoTitulo: string
  /** A `color` computada da face de cartão, que é `--foreground`. É dela que a do `<h2>` se separa. */
  readonly tintaDaFace: string
}

test('a combinação escolhida é a que a tela desenha', async () => {
  // As duas com `OC_THEME` primeiro, a default por último: é ela que precisa do ambiente limpo, e
  // deixá-la no fim é o que garante que nada das outras sobrou pendurado.
  const ametista = await medir('ametista')
  const obsidiana = await medir('obsidiana')
  const lavanda = await medir()

  expect(ametista.theme, 'com `OC_THEME=ametista`, o `<html>` não carrega a ametista').toBe(
    'ametista',
  )
  expect(obsidiana.theme, 'com `OC_THEME=obsidiana`, o `<html>` não carrega a obsidiana').toBe(
    'obsidiana',
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

  // A obsidiana contra a lavanda, e aqui a **face** entra na conta — ao contrário do par da ametista
  // logo acima. É o que separa esta combinação das duas claras: a decisão #161 mantém
  // `--secondary-background` branco em toda combinação clara, e é essa igualdade que a obsidiana
  // existe para romper. Um bloco que esquecesse a face desenharia cartão branco sobre canvas escuro.
  expect(obsidiana.canvas, 'o canvas é o mesmo na obsidiana e na lavanda').not.toBe(lavanda.canvas)
  expect(obsidiana.face, 'a face de cartão é a mesma na obsidiana e na lavanda').not.toBe(
    lavanda.face,
  )

  // E o cabeçalho é **igual**, que é guarda e não desistência — a mesma figura que a face da ametista
  // acima. A folha declara `--main` idêntico nas duas (`index.css:155` e `:295`): a obsidiana é a
  // lavanda apagada, e um acento próprio gastaria uma quinta família de matiz num orçamento que o #8
  // fechou. Ver a Emenda 2026-09-09 do CA-1 na spec. Afirmá-lo aqui é o que faz alguém que reafine o
  // acento da escura ver vermelho em vez de silêncio.
  expect(
    obsidiana.cabecalho,
    'o cabeçalho de coluna deixou de ser o mesmo acento na obsidiana e na lavanda',
  ).toBe(lavanda.cabecalho)

  // E os três níveis de hierarquia se distinguindo **sob a obsidiana**, pela mesma razão que o bloco
  // da ametista declara: sem isto, uma obsidiana de fundo chapado passaria verde acima e desenharia
  // um kanban de um nível só. É a metade medida do CA-1 — o recorte contra a borda preta está
  // declarado em `## Technical Decisions` da spec, e não é aferido aqui.
  expect(obsidiana.canvas, 'sob a obsidiana, o canvas e o cabeçalho de coluna empatam').not.toBe(
    obsidiana.cabecalho,
  )
  expect(obsidiana.cabecalho, 'sob a obsidiana, o cabeçalho e a face de cartão empatam').not.toBe(
    obsidiana.face,
  )
  expect(obsidiana.canvas, 'sob a obsidiana, o canvas e a face de cartão empatam').not.toBe(
    obsidiana.face,
  )

  // O CA-6, e ele mede **separação**, não um valor: sob a obsidiana `--foreground` é claro e
  // `--main-foreground` é preto, então o `<h2>` que herdasse a tinta do corpo — como fazia até este
  // card — cairia branco sobre o violeta claro do cabeçalho, a 2.5:1. Afirmar a diferença em vez do
  // hex é a mesma disciplina que o topo do arquivo declara: nenhum valor de cor escrito à mão.
  expect(
    obsidiana.tintaDoTitulo,
    'sob a obsidiana, o `<h2>` do cabeçalho de coluna herdou a tinta do corpo em vez da do acento',
  ).not.toBe(obsidiana.tintaDaFace)

  // E a guarda que impede a asserção acima de virar falso-verde: nas claras as duas tintas **são** o
  // mesmo preto, e é por isso que este buraco atravessou o #29 sem nada ficar vermelho. Ela é o que
  // prova que a diferença medida em cima é de **cor** e não de grafia — as duas leituras saem de
  // tokens `oklch`, e sob a lavanda casam caractere por caractere.
  expect(
    lavanda.tintaDoTitulo,
    'na lavanda o `<h2>` e a face de cartão deixaram de compartilhar a tinta — a asserção da obsidiana perdeu o sentido',
  ).toBe(lavanda.tintaDaFace)

  // E o cabeçalho traz o matiz **daquela** combinação, não de uma qualquer: o Chromium serializa cor
  // computada no espaço de origem, então o oklch chega inteiro e o `h` é o que diz "esta é a
  // ametista". Mesma técnica que `kanban.smoke.spec.ts:238-241` usa para a sombra dura.
  expect(ametista.cabecalho, 'o cabeçalho de coluna não está no matiz da ametista').toMatch(
    matizDoAcento('ametista'),
  )
  expect(lavanda.cabecalho, 'o cabeçalho de coluna não está no matiz da lavanda').toMatch(
    matizDoAcento('lavanda'),
  )

  // A barra de rolagem, e a largura vem primeiro porque é a única das três que fala da **regra**:
  // medido, sem o bloco no fim da folha o Chromium devolve `auto` aqui e `rgba(0, 0, 0, 0)` no
  // polegar — as outras duas ficariam vermelhas sem dizer que o que sumiu foi o bloco inteiro. Mesma
  // ordem que `design-system.test.ts` pratica: a existência antes do que depende dela.
  expect(lavanda.barraLargura, 'a regra `::-webkit-scrollbar` não chegou ao app').toBe('12px')

  // A leitura não depende da combinação, e por isso é afirmada **uma** vez: repeti-la sob a ametista
  // seria pagar duas vezes pela mesma prova, a disciplina que o topo deste arquivo já declara.
  // O que a combinação decide é o polegar — e sem o bloco as duas empatariam em transparente.
  expect(ametista.barra, 'o polegar da barra é o mesmo nas duas combinações').not.toBe(
    lavanda.barra,
  )

  // E o contêiner nº 1 reservando espaço de verdade, que é o que a regra sozinha não prova. Doze
  // contra os quinze da barra nativa deste Chromium: a geometria afrouxa em 3px, e é daí que sai o
  // "nada que não clipa hoje passa a clipar".
  expect(lavanda.gutter, 'o `<main>` do kanban não reserva os 12px da barra vestida').toBe(12)
})

/**
 * Sobe o app com o ambiente pedido, mede as três superfícies e o atributo, e **fecha**.
 *
 * Não é o `beforeAll` do kanban smoke, que sobe **uma** instância para o arquivo inteiro: aqui são
 * três ambientes diferentes, e duas instâncias do Electron não podem coexistir. O `close()` no
 * `finally` é o que impede um Electron pendurado de travar a subida seguinte quando uma delas falha.
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
    // O contêiner que rola na horizontal, por tag e sem `data-testid` novo: sob `OC_SCREEN=kanban`
    // este `<main>` é único — o outro do app é o de `Chat.tsx`, e `ChatScreen` não monta aqui.
    // Locator por tag já tem precedente logo abaixo, no `header` da coluna.
    const principal = janela.locator('main')

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
      barra: await corDoPolegar(principal),
      barraLargura: await larguraDaBarra(principal),
      gutter: await gutterReservado(principal),
      // O `<h2>` dentro do `header` que já foi medido acima, e não um `data-testid` novo: é o mesmo
      // elemento cuja superfície o `cabecalho` traz, e o CA-6 é sobre a tinta **daquele** título.
      tintaDoTitulo: await corDaTinta(coluna.locator('header h2')),
      // A face de cartão, e **não** o `body`: a referência tem de ser uma superfície que declare
      // `text-foreground`, e a `Card` a declara na base (`card.tsx:29`) enquanto o `body` só declara
      // `background-color`. Medido: a `color` do `body` é o preto default do UA, que o Chromium
      // serializa `rgb(0, 0, 0)` — compará-la com o `oklch(0 0 0)` do `<h2>` daria uma diferença de
      // **grafia** e um CA-6 verde por engano, com as duas tintas pretas na tela.
      tintaDaFace: await corDaTinta(cartao),
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
    // As portas que trocam o GitHub por arquivo. São elas que tornam este smoke determinístico, e
    // são **duas**: sem `OC_BOARDS_FIXTURE` a descoberta não tem o que responder e lança, e o
    // kanban não desenha cartão nenhum para este teste medir cor em cima.
    OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
    OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
    // Fixado, e não herdado: um `OC_SCREEN=chat` esquecido no shell abriria a tela errada, e as três
    // superfícies que este teste mede só existem no kanban.
    OC_SCREEN: 'kanban',
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
 *
 * **O `pseudo?` e o `width` vieram do card das barras de rolagem, e o `color` é deste; os três são
 * gate de CI**: sem eles, `getComputedStyle(el, '::-webkit-scrollbar-thumb')` é TS2554 e `.width` e
 * `.color` são TS2339, e o `yarn typecheck` reprova o PR — este arquivo compila no programa do Node,
 * que não carrega a lib DOM. A cópia gêmea em `kanban.smoke.spec.ts` **não** cresce junto: cada
 * arquivo declara o que usa, que é o outro lado da cópia deliberada.
 */
declare function getComputedStyle(
  element: unknown,
  pseudo?: string,
): { backgroundColor: string; color: string; width: string }

/** O `background-color` computado — a mesma cópia, pela mesma razão. */
async function corDeFundo(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor)
}

/**
 * A `color` computada — e **computada** é a palavra que faz esta helper valer o CA-6: o `<h2>` não
 * declarava classe de cor nenhuma, então o que se mede aqui é o que a cascata entregou, herança
 * inclusive. Ler o `className` do elemento provaria só que alguém escreveu a classe.
 */
async function corDaTinta(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).color)
}

/**
 * A cor do polegar da barra — uma helper por leitura, pela mesma razão de cópia declarada acima.
 *
 * **Não há fallback do pseudo-elemento para o elemento**, e é isso que torna a asserção de diferença
 * honesta: medido com o bloco ausente, isto devolve `rgba(0, 0, 0, 0)` e não a cor do próprio
 * contêiner — logo, apagar a folha empata as duas combinações em vez de disfarçar.
 */
async function corDoPolegar(locator: Locator): Promise<string> {
  return locator.evaluate(
    (element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
  )
}

/** A largura que a regra declara — `auto` quando o bloco não está na folha. */
async function larguraDaBarra(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').width)
}

/**
 * As duas alturas de que o gutter é a diferença, declaradas aqui pela mesma razão que o
 * `getComputedStyle` acima: sem a lib DOM, o tipo que o Playwright dá ao parâmetro do `evaluate` não
 * resolve, e ler `.offsetHeight` dele é acesso a membro de tipo desconhecido — o `eslint` reprova
 * (`no-unsafe-member-access`) mesmo com o `tsc` verde. Nomear as duas propriedades que o corpo usa é
 * o remendo mínimo, e não mais que ele.
 */
interface CaixaMedida {
  readonly offsetHeight: number
  readonly clientHeight: number
}

/**
 * O gutter que o contêiner reserva de fato, que é medida e não regra.
 *
 * É a **altura** que some porque a barra horizontal a ocupa: o `<main>` do kanban é
 * `overflow-x-auto` e transborda por construção — oito colunas de 288px com `gap-3` e `p-3` numa
 * janela de 1100px.
 */
async function gutterReservado(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const caixa = element as CaixaMedida

    return caixa.offsetHeight - caixa.clientHeight
  })
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
