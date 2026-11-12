import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { boardComMuitosCards } from './board-com-muitos-cards'
import type { BoardComMuitosCards } from './board-com-muitos-cards'
import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'
import { abrirFabrica } from './comparacao/comum'
import { montarGitHubDaF6 } from './fixtures-f6'
import { launchSmokeApp } from './smoke-app'
import { REPO_ROOT, smokeLaunchArgs } from './smoke-env'
import { REPO_DOS_CARDS_DA_FABRICA } from '../../src/renderer/fabrica/boardDaFabrica'

/**
 * A rolagem das telas da fábrica com muitos cards (#149): a altura da tela não cresce com o número
 * de cards, o último card de cada lista com teto continua alcançável e, com a quantidade de cards do
 * protótipo, nenhuma lista rola por dentro. Não toca a rede nem sessão do Claude.
 */

const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures', 'fabrica')
const LARGURA = 1920
const ALTURA = 1000

/** O que os callbacks do `evaluate` leem do elemento (o tsconfig dos smokes não tem a lib DOM). */
interface El {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
  getAttribute(nome: string): string | null
  closest(seletor: string): El | null
}

const pastas: string[] = []
const apps: ElectronApplication[] = []

test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => undefined)
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function pasta(prefixo: string): string {
  const p = mkdtempSync(join(tmpdir(), prefixo))
  pastas.push(p)
  return p
}

async function subir(fabrica: 'f2' | 'f6', ambiente: Record<string, string>): Promise<Page> {
  const dir = pasta('oc-rolagem-fabrica-')
  cpSync(join(FIXTURES, fabrica), dir, { recursive: true })
  const app = await launchSmokeApp({
    stateDir: pasta('oc-rolagem-estado-'),
    env: { OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH, OC_FABRICA_DIR: dir, ...ambiente },
  })
  apps.push(app)
  const janela = await app.firstWindow()
  await janela.setViewportSize({ width: LARGURA, height: ALTURA })
  await abrirFabrica(janela)
  return janela
}

async function subirComMuitosCards(
  n: number,
): Promise<{ janela: Page; board: BoardComMuitosCards }> {
  const board = boardComMuitosCards(pasta('oc-rolagem-board-'), n)
  const janela = await subir('f6', { OC_BOARD_FIXTURE: board.caminho })
  return { janela, board }
}

type Tela = 'sala' | 'briefing' | 'release'

async function irPara(janela: Page, tela: Tela): Promise<void> {
  if (tela !== 'sala') await janela.getByTestId(`fabrica-nav-${tela}`).click()
  else if ((await janela.getByTestId('fabrica-nav-sala').count()) > 0) {
    await janela.getByTestId('fabrica-nav-sala').click()
  }
  await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', tela)
}

const urlDoCard = (n: number): string =>
  `https://github.com/${REPO_DOS_CARDS_DA_FABRICA}/issues/${n}`

/** Espera o último card sintético de cada tela: sem isso a medida seria a de um board ainda lendo. */
async function esperarBoard(janela: Page, tela: Tela, board: BoardComMuitosCards): Promise<void> {
  const ultimo = (lista: number[]): number => {
    const n = lista[lista.length - 1]
    if (n === undefined) throw new Error('o board sintético não tem cards na coluna')
    return n
  }
  const alvo =
    tela === 'sala'
      ? janela.locator(
          `[data-testid="fabrica-board-card"][data-card="${urlDoCard(ultimo(board.porColuna.validacao))}"]`,
        )
      : tela === 'briefing'
        ? janela.locator(
            `[data-testid="fabrica-briefing-frente"][data-abre-card="${ultimo(board.porColuna.backlog)}"]`,
          )
        : janela.locator(
            `[data-testid="fabrica-release-card"][data-card="${ultimo(board.porColuna.release)}"]`,
          )
  await expect(alvo).toBeVisible({ timeout: 20_000 })
}

async function listasDaTela(janela: Page): Promise<string[]> {
  return await janela
    .getByTestId('fabrica-lista-com-teto')
    .evaluateAll((els: El[]) => els.map((e: El) => e.getAttribute('data-lista') ?? ''))
}

async function medirTela(janela: Page): Promise<number> {
  return await janela.getByTestId('fabrica-tela').evaluate((el: El) => el.scrollHeight)
}

async function conferirTetos(janela: Page, tela: string): Promise<void> {
  const listas = await janela.getByTestId('fabrica-lista-com-teto').evaluateAll((els: El[]) =>
    els.map((e: El) => ({
      lista: e.getAttribute('data-lista') ?? '',
      teto: Number(e.getAttribute('data-teto')),
      alto: e.clientHeight,
    })),
  )
  for (const l of listas) {
    expect(l.alto, `${tela}: a lista ${l.lista} passa do teto de ${l.teto}`).toBeLessThanOrEqual(
      l.teto,
    )
  }
}

function conjunto(listas: string[]): string[] {
  return [...new Set(listas)].sort()
}

test('a altura das telas não depende do número de cards', async () => {
  expect(
    smokeLaunchArgs(),
    'as medidas só valem com OC_SMOKE_HEADLESS=1 (tela virtual de 1920×1080)',
  ).not.toEqual([])
  test.setTimeout(240_000)

  const alturas: Record<number, Record<Tela, number>> = {}
  for (const n of [40, 80]) {
    const { janela, board } = await subirComMuitosCards(n)
    const medidas = {} as Record<Tela, number>
    for (const tela of ['sala', 'briefing', 'release'] as const) {
      await irPara(janela, tela)
      await esperarBoard(janela, tela, board)
      const listas = await listasDaTela(janela)
      if (tela === 'sala') {
        for (const esperada of [
          'linha-card',
          'linha-validacao',
          'linha-release',
          `a-parte-${board.nomeDaColuna.backlog}`,
        ]) {
          expect(listas, `sala (N = ${n}): falta a lista ${esperada}`).toContain(esperada)
        }
        for (const l of listas) {
          expect(
            l.startsWith('linha-') || l.startsWith('a-parte-'),
            `sala (N = ${n}): lista inesperada ${l}`,
          ).toBe(true)
        }
      } else if (tela === 'briefing') {
        expect(conjunto(listas), `briefing (N = ${n})`).toEqual(['briefing-frentes'])
      } else {
        expect(conjunto(listas), `release (N = ${n})`).toEqual([
          'release-notas',
          'release-trem',
          'release-verificacao',
        ])
      }
      await conferirTetos(janela, `${tela} (N = ${n})`)
      medidas[tela] = await medirTela(janela)
    }
    alturas[n] = medidas
    console.log(`ROLAGEM N=${n} ${JSON.stringify(medidas)}`)
    for (const app of apps.splice(0)) await app.close().catch(() => undefined)
  }
  for (const tela of ['sala', 'briefing', 'release'] as const) {
    expect(
      alturas[80]?.[tela],
      `${tela}: o scrollHeight do fabrica-tela cresceu de N = 40 para N = 80`,
    ).toBe(alturas[40]?.[tela])
  }
})

/** Rola a lista até o fim, confere o último cartão dentro dela, clica e espera a tela Card. */
async function alcancarOUltimo(
  janela: Page,
  nome: string,
  lista: Locator,
  ultimo: Locator,
  numeroDe: (alvo: Locator) => Promise<number>,
): Promise<void> {
  const medidas = await lista.evaluate((el: El) => ({
    rolagem: el.scrollHeight,
    visivel: el.clientHeight,
  }))
  expect(medidas.rolagem, `${nome}: a lista não transborda`).toBeGreaterThan(medidas.visivel)
  await lista.evaluate((el: El) => {
    el.scrollTop = el.scrollHeight
  })
  expect(await lista.evaluate((el: El) => el.scrollTop), `${nome}: não rolou`).toBeGreaterThan(0)
  const caixaDaLista = await lista.boundingBox()
  const caixaDoUltimo = await ultimo.boundingBox()
  if (caixaDaLista === null || caixaDoUltimo === null) throw new Error(`${nome}: sem caixa`)
  expect(
    caixaDoUltimo.y + caixaDoUltimo.height,
    `${nome}: o último cartão ficou fora da caixa da lista`,
  ).toBeLessThanOrEqual(caixaDaLista.y + caixaDaLista.height + 1)
  const numero = await numeroDe(ultimo)
  await ultimo.click()
  await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'card')
  await expect(janela.getByTestId('fabrica-trilha')).toContainText(`#${numero}`)
}

const numeroDaUrl = (url: string | null): number => {
  const m = /\/issues\/(\d+)$/.exec(url ?? '')
  if (m?.[1] === undefined) throw new Error(`url de card sem número: ${url ?? 'null'}`)
  return Number(m[1])
}

test('o último card de cada lista abre a tela Card', async () => {
  expect(
    smokeLaunchArgs(),
    'as medidas só valem com OC_SMOKE_HEADLESS=1 (tela virtual de 1920×1080)',
  ).not.toEqual([])
  test.setTimeout(240_000)

  const { janela, board } = await subirComMuitosCards(40)
  const lista = (nome: string): Locator =>
    janela.locator(`[data-testid="fabrica-lista-com-teto"][data-lista="${nome}"]`)
  const numeroDoCartaoDoBoard = async (abrir: Locator): Promise<number> =>
    numeroDaUrl(
      await abrir.evaluate(
        (el: El) =>
          el.closest('[data-testid="fabrica-board-card"]')?.getAttribute('data-card') ?? null,
      ),
    )

  await irPara(janela, 'sala')
  await esperarBoard(janela, 'sala', board)
  for (const nome of ['linha-validacao', `a-parte-${board.nomeDaColuna.backlog}`]) {
    const l = lista(nome)
    await alcancarOUltimo(
      janela,
      nome,
      l,
      l.getByTestId('fabrica-board-card-abrir').last(),
      numeroDoCartaoDoBoard,
    )
    await irPara(janela, 'sala')
    await esperarBoard(janela, 'sala', board)
  }

  await irPara(janela, 'briefing')
  await esperarBoard(janela, 'briefing', board)
  const frentes = lista('briefing-frentes')
  await alcancarOUltimo(
    janela,
    'briefing-frentes',
    frentes,
    frentes.getByTestId('fabrica-briefing-frente').last(),
    async (alvo) => Number(await alvo.getAttribute('data-abre-card')),
  )

  await irPara(janela, 'release')
  await esperarBoard(janela, 'release', board)
  const trem = lista('release-trem')
  await alcancarOUltimo(
    janela,
    'release-trem',
    trem,
    trem.getByTestId('fabrica-release-card').last(),
    async (alvo) => Number(await alvo.getAttribute('data-card')),
  )
})

test('com as fixtures da comparação nenhuma lista rola por dentro', async () => {
  expect(
    smokeLaunchArgs(),
    'as medidas só valem com OC_SMOKE_HEADLESS=1 (tela virtual de 1920×1080)',
  ).not.toEqual([])
  test.setTimeout(240_000)

  const github = pasta('oc-rolagem-github-')
  const f6 = montarGitHubDaF6(github)
  const cenarios: Array<{
    nome: string
    fabrica: 'f2' | 'f6'
    ambiente: Record<string, string>
    telas: Tela[]
    frentes?: number
    trem?: number
  }> = [
    {
      nome: 'f2 + board.json',
      fabrica: 'f2',
      ambiente: { OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH },
      telas: ['sala'],
    },
    {
      nome: 'f6 + board.json',
      fabrica: 'f6',
      ambiente: { OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH },
      telas: ['sala', 'briefing', 'release'],
      frentes: 2,
      trem: 0,
    },
    {
      nome: 'f6 + board da F6',
      fabrica: 'f6',
      ambiente: { OC_BOARD_FIXTURE: f6.board, OC_CARD_FIXTURE: f6.cards },
      telas: ['sala', 'briefing', 'release'],
      frentes: 4,
      trem: 2,
    },
  ]

  for (const c of cenarios) {
    const janela = await subir(c.fabrica, c.ambiente)
    for (const tela of c.telas) {
      const onde = `${c.nome} · ${tela}`
      await irPara(janela, tela)
      if (tela === 'sala') {
        await expect(janela.getByTestId('fabrica-board-card').first()).toBeVisible({
          timeout: 20_000,
        })
        const listas = await listasDaTela(janela)
        expect(
          listas.some((l) => l.startsWith('linha-')),
          `${onde}: sem lista linha-*`,
        ).toBe(true)
      } else if (tela === 'briefing') {
        const frentes = janela.getByTestId('fabrica-briefing-frente')
        await expect(frentes).toHaveCount(c.frentes ?? 0, { timeout: 20_000 })
        expect(conjunto(await listasDaTela(janela)), onde).toEqual(['briefing-frentes'])
      } else if (c.trem === 0) {
        await expect(janela.getByTestId('fabrica-release-vazio')).toBeVisible({ timeout: 20_000 })
        expect(conjunto(await listasDaTela(janela)), onde).toEqual(['release-notas'])
      } else {
        await expect(janela.getByTestId('fabrica-release-card')).toHaveCount(c.trem ?? 0, {
          timeout: 20_000,
        })
        expect(conjunto(await listasDaTela(janela)), onde).toEqual([
          'release-notas',
          'release-trem',
          'release-verificacao',
        ])
      }
      const rolam = await janela
        .getByTestId('fabrica-lista-com-teto')
        .evaluateAll((els: El[]) =>
          els
            .filter((e: El) => e.scrollHeight > e.clientHeight)
            .map(
              (e: El) =>
                `${e.getAttribute('data-lista') ?? ''} ${e.scrollHeight}/${e.clientHeight}`,
            ),
        )
      expect(rolam, `${onde}: lista que rola por dentro`).toEqual([])
    }
    for (const app of apps.splice(0)) await app.close().catch(() => undefined)
  }
})
