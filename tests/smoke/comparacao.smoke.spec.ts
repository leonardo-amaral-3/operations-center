import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'
import { TELAS_DO_HARNESS } from './comparacao'
import { repoDoRelatorio } from './repo-do-relatorio'
import { launchSmokeApp } from './smoke-app'
import { REPO_ROOT, smokeComparacaoDir, smokeLaunchArgs } from './smoke-env'
import { TELAS_DO_PROTOTIPO, renderizarPrototipo } from '../visual/prototipo'

/**
 * O harness de comparação da fábrica (#130, CA-1.3): para cada uma das 11 telas, o render estático
 * do protótipo versionado e a tela no app, lado a lado num `index.html`. Quem julga se as duas são
 * iguais é uma pessoa; aqui só se produz o par e se prova que o lado do protótipo é estável.
 *
 * Não sobe sessão do Claude, não toca a rede nem o board real: o app lê só fixtures, e nada da
 * máquina entra num print.
 */

const FIXTURES_RELATORIO = join(REPO_ROOT, 'tests', 'fixtures', 'relatorio')
const LARGURA = 1440
const MINIMO_DO_PROTOTIPO = 10 * 1024

const pastasTemporarias: string[] = []

test.afterEach(() => {
  for (const pasta of pastasTemporarias.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function pastaTemporaria(prefixo: string): string {
  const pasta = mkdtempSync(join(tmpdir(), prefixo))
  pastasTemporarias.push(pasta)
  return pasta
}

/** Uma janela do Electron só com o `.html` do protótipo e a rede cortada; devolve o PNG e a página. */
async function fotografarPrototipo(
  app: ElectronApplication,
  arquivo: string,
  altura: number,
): Promise<Buffer> {
  const nova = app.waitForEvent('window')
  await app.evaluate(
    ({ BrowserWindow, session }, { caminho, largura, alto }) => {
      // Uma sessão só desta janela: o corte de rede não alcança a casca do app.
      const sessao = session.fromPartition('oc-comparacao-prototipo')
      sessao.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => {
        cb({ cancel: true })
      })
      const janela = new BrowserWindow({
        width: largura,
        height: alto,
        useContentSize: true,
        show: false,
        webPreferences: { session: sessao },
      })
      void janela.loadFile(caminho)
    },
    { caminho: arquivo, largura: LARGURA, alto: altura },
  )
  const pagina = await nova
  try {
    await pagina.setViewportSize({ width: LARGURA, height: altura })
    await pagina.waitForLoadState('load')
    return await pagina.screenshot({ fullPage: true, animations: 'disabled' })
  } finally {
    await pagina.close()
  }
}

async function fotografarApp(janela: Page, altura: number): Promise<Buffer> {
  const tela = janela.getByTestId('fabrica-tela')
  const caixa = await tela.boundingBox()
  if (caixa === null) throw new Error('fabrica-tela sem caixa')
  const y0 = caixa.y
  await janela.setViewportSize({ width: LARGURA, height: Math.ceil(y0 + altura) })
  const medidas = await tela.evaluate((el: { scrollHeight: number; clientHeight: number }) => ({
    rolagem: el.scrollHeight,
    visivel: el.clientHeight,
  }))
  if (medidas.rolagem > medidas.visivel) {
    await janela.setViewportSize({ width: LARGURA, height: Math.ceil(y0 + medidas.rolagem) })
  }
  return await tela.screenshot({ animations: 'disabled' })
}

const sha = (png: Buffer): string => createHash('sha256').update(png).digest('hex')

test('prints do protótipo e do app, lado a lado', async () => {
  // Sem o headless a tela não é a virtual de 1920×1080 e os prints dependem do monitor.
  expect(
    smokeLaunchArgs(),
    'o harness só vale com OC_SMOKE_HEADLESS=1 (tela virtual de 1920×1080)',
  ).not.toEqual([])
  test.setTimeout(240_000)

  const saida = smokeComparacaoDir()
  rmSync(saida, { recursive: true, force: true })
  mkdirSync(saida, { recursive: true })

  const temporaria = pastaTemporaria('oc-comparacao-')
  const repo = repoDoRelatorio(
    (() => {
      const pasta = join(temporaria, 'repo')
      mkdirSync(pasta)
      return pasta
    })(),
  )

  // Uma subida do app por pasta de fixture distinta entre as telas (na F1, uma só).
  const fixtures = [...new Set(Object.values(TELAS_DO_HARNESS).map((t) => t.fixture))]
  const linhas: Array<{ arquivo: string; app: boolean }> = []
  const prototipos: string[] = []

  for (const [indice, fixture] of fixtures.entries()) {
    const fabrica = join(temporaria, `fabrica-${indice}`)
    cpSync(fixture, fabrica, { recursive: true })
    const app = await launchSmokeApp({
      stateDir: join(temporaria, `estado-${indice}`),
      env: {
        OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
        OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
        OC_FABRICA_DIR: fabrica,
        OC_RELATORIO_COFRE: join(FIXTURES_RELATORIO, 'cofre-2026-11-10'),
        OC_RELATORIO_REPO: repo,
        OC_RELATORIO_FIXTURE: join(FIXTURES_RELATORIO, 'smoke.json'),
      },
    })

    try {
      const janela = await app.firstWindow()

      for (const { tela, arquivo } of TELAS_DO_PROTOTIPO) {
        const modulo = TELAS_DO_HARNESS[tela]
        if (modulo.fixture !== fixture) continue
        const nome = arquivo.replace(/\.dc\.html$/, '')

        // O protótipo: duas janelas, o mesmo sha256 (CA-1.3).
        const { pagina, altura } = renderizarPrototipo(
          readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'prototipo', arquivo), 'utf8'),
        )
        const html = join(temporaria, `${nome}.html`)
        writeFileSync(html, pagina)
        const primeiro = await fotografarPrototipo(app, html, altura)
        const segundo = await fotografarPrototipo(app, html, altura)
        expect(sha(segundo), `${nome}: os dois prints do protótipo diferem`).toBe(sha(primeiro))
        writeFileSync(join(saida, `${nome}-prototipo.png`), primeiro)
        prototipos.push(nome)

        // O app: volta à Sala, chega à tela, mede e fotografa; sem rota, nenhum PNG.
        if (modulo.comoChegar === null) {
          linhas.push({ arquivo: nome, app: false })
          continue
        }
        await janela.getByTestId('fabrica-toggle').waitFor()
        // As telas internas voltam à Sala pela migalha 0 da trilha.
        const trilha = janela.getByTestId('fabrica-trilha-0')
        if ((await trilha.count()) > 0) await trilha.click()
        await modulo.comoChegar(janela)
        await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', tela)

        for (const rotulo of modulo.rotulos) {
          await expect(
            janela.getByTestId('fabrica-tela').getByText(rotulo, { exact: true }).first(),
            `${nome}: falta o rótulo "${rotulo}"`,
          ).toBeVisible()
        }

        writeFileSync(join(saida, `${nome}-app.png`), await fotografarApp(janela, altura))
        linhas.push({ arquivo: nome, app: true })
      }
    } finally {
      await app.close()
    }
  }

  // Na ordem de `TELAS_DO_PROTOTIPO`, não na da subida do app.
  const ordem = TELAS_DO_PROTOTIPO.map(({ arquivo }) => arquivo.replace(/\.dc\.html$/, ''))
  linhas.sort((a, b) => ordem.indexOf(a.arquivo) - ordem.indexOf(b.arquivo))
  const corpo = linhas
    .map(
      ({ arquivo, app }) => `<h2>${arquivo}</h2>
<div style="display:flex;gap:8px;align-items:flex-start">
<div style="width:50%"><img src="${arquivo}-prototipo.png" style="width:100%"></div>
<div style="width:50%">${app ? `<img src="${arquivo}-app.png" style="width:100%">` : 'sem rota no app ainda'}</div>
</div>`,
    )
    .join('\n')
  writeFileSync(
    join(saida, 'index.html'),
    `<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><title>Comparação da fábrica</title></head>\n<body style="font-family:sans-serif">\n<h1>Protótipo | App</h1>\n${corpo}\n</body></html>\n`,
  )

  expect(prototipos).toHaveLength(ordem.length)
  for (const nome of ordem) {
    expect(
      statSync(join(saida, `${nome}-prototipo.png`)).size,
      `${nome}-prototipo.png é pequeno demais`,
    ).toBeGreaterThan(MINIMO_DO_PROTOTIPO)
  }
})
