import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

import { BOARDS_FIXTURE_PATH } from './boards-fixture'
import { montarGitHubDaF6 } from './fixtures-f6'
import { launchSmokeApp } from './smoke-app'
import { REPO_ROOT } from './smoke-env'

/**
 * O smoke da F6 (#135): o Briefing abre frentes pelo `yarn fabrica iniciar` e o Release lista o
 * trem. A pasta da fábrica é uma cópia em `test-results/` (sem `OC_FABRICA_DIR` o `iniciar`
 * gravaria na pasta real). Não sobe sessão do Claude e não toca a rede.
 */

const FIXTURE_F6 = join(REPO_ROOT, 'tests', 'fixtures', 'fabrica', 'f6')

const limpar: string[] = []

test.afterEach(() => {
  for (const pasta of limpar.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

interface Subida {
  app: ElectronApplication
  janela: Page
  pasta: string
}

async function subir(): Promise<Subida> {
  const raiz = join(REPO_ROOT, 'test-results')
  mkdirSync(raiz, { recursive: true })
  const pasta = join(raiz, `fabrica-f6-${randomUUID()}`)
  expect(pasta).toContain('/test-results/')
  cpSync(FIXTURE_F6, pasta, { recursive: true })
  limpar.push(pasta)

  const github = mkdtempSync(join(tmpdir(), 'oc-f6-github-'))
  limpar.push(github)
  const { board, cards } = montarGitHubDaF6(github)
  const stateDir = mkdtempSync(join(tmpdir(), 'oc-f6-estado-'))
  limpar.push(stateDir)

  const app = await launchSmokeApp({
    stateDir,
    env: {
      OC_BOARD_FIXTURE: board,
      OC_CARD_FIXTURE: cards,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      OC_FABRICA_DIR: pasta,
    },
  })
  const janela = await app.firstWindow()
  await janela.getByTestId('fabrica-toggle').click()
  await expect(janela.getByTestId('fabrica-sala')).toBeVisible()
  return { app, janela, pasta }
}

interface Estado {
  frentes: Array<{ id: string; card: number }>
  despachos: Array<{ card: number; comando: string; nota: string | null; estado: string }>
}

const lerEstado = (pasta: string): Estado =>
  JSON.parse(readFileSync(join(pasta, 'estado.json'), 'utf8')) as Estado

test('Soltar o dia abre as frentes pelo yarn fabrica iniciar', async () => {
  const { app, janela, pasta } = await subir()
  try {
    await janela.getByTestId('fabrica-nav-briefing').click()
    await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'briefing')

    const f940 = janela.locator('[data-testid="fabrica-briefing-frente"][data-card="940"]')
    const f941 = janela.locator('[data-testid="fabrica-briefing-frente"][data-card="941"]')
    const f908 = janela.locator('[data-testid="fabrica-briefing-frente"][data-card="908"]')
    await expect(f940).toHaveAttribute('data-estado', 'candidata')
    await expect(f941).toHaveAttribute('data-estado', 'candidata')
    await expect(f908).toHaveAttribute('data-estado', 'em-voo')
    await expect(f940.getByTestId('fabrica-briefing-chip')).toHaveText('📋 Backlog · /gm-spec #940')
    await expect(f941.getByTestId('fabrica-briefing-chip')).toHaveText('📥 Triagem · /gm-card #941')
    const candidatas: string[] = []
    for (const c of await janela
      .locator('[data-testid="fabrica-briefing-frente"][data-estado="candidata"]')
      .all()) {
      candidatas.push((await c.getAttribute('data-card')) ?? '')
    }
    expect(candidatas.indexOf('940')).toBeGreaterThanOrEqual(0)
    expect(candidatas.indexOf('940')).toBeLessThan(candidatas.indexOf('941'))

    await f940.getByTestId('fabrica-briefing-pronto').fill('a spec sai')
    await janela.getByTestId('fabrica-briefing-contexto').fill('dia calmo')
    await f940.getByTestId('fabrica-briefing-entra').check()
    await f941.getByTestId('fabrica-briefing-entra').check()
    await janela.getByTestId('fabrica-briefing-soltar').click()

    await expect(f940.getByTestId('fabrica-briefing-resultado')).toHaveAttribute(
      'data-resultado',
      'aberta',
    )
    await expect(f941.getByTestId('fabrica-briefing-resultado')).toHaveAttribute(
      'data-resultado',
      'aberta',
    )

    const hoje = new Date()
    const data = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}`
    const estado = lerEstado(pasta)
    expect(estado.frentes.filter((f) => f.card === 940 || f.card === 941)).toHaveLength(2)
    expect(estado.despachos.find((d) => d.card === 940)).toMatchObject({
      repo: 'leonardo-amaral-3/operations-center',
      comando: '/gm-spec #940',
      estado: 'pendente',
      nota: `Briefing do dia ${data}: pronto quando a spec sai. Contexto do dia: dia calmo.`,
    })
    expect(estado.despachos.find((d) => d.card === 941)).toMatchObject({
      repo: 'leonardo-amaral-3/operations-center',
      comando: '/gm-card #941',
      estado: 'pendente',
      nota: `Briefing do dia ${data}. Contexto do dia: dia calmo.`,
    })

    await expect(f940).toHaveAttribute('data-estado', 'em-voo')
    await expect(f941).toHaveAttribute('data-estado', 'em-voo')
    await expect(f940.getByTestId('fabrica-briefing-entra')).toHaveCount(0)
    await expect(f941.getByTestId('fabrica-briefing-entra')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a nota que cita main não abre frente, e o Release lista o trem', async () => {
  const { app, janela, pasta } = await subir()
  try {
    const antes = readFileSync(join(pasta, 'estado.json'))
    await janela.getByTestId('fabrica-nav-briefing').click()
    const f940 = janela.locator('[data-testid="fabrica-briefing-frente"][data-card="940"]')
    await f940.getByTestId('fabrica-briefing-entra').check()
    await janela.getByTestId('fabrica-briefing-contexto').fill('merge na main amanhã')
    await janela.getByTestId('fabrica-briefing-soltar').click()

    await expect(janela.getByTestId('fabrica-comando-erro')).toContainText(
      'a nota cita main, release, tag ou hotfix',
    )
    await expect(f940.getByTestId('fabrica-briefing-resultado')).toHaveAttribute(
      'data-resultado',
      'nao-abriu',
    )
    expect(readFileSync(join(pasta, 'estado.json'))).toEqual(antes)

    await janela.getByTestId('fabrica-trilha-0').click()
    await janela.getByTestId('fabrica-nav-release').click()
    await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'release')

    const cartoes = janela.getByTestId('fabrica-release-card')
    await expect(cartoes).toHaveCount(2)
    await expect(cartoes.nth(0)).toHaveAttribute('data-card', '942')
    await expect(cartoes.nth(0)).toContainText('Melhoria')
    await expect(cartoes.nth(1)).toHaveAttribute('data-card', '943')
    await expect(cartoes.nth(1)).toContainText('Bug')

    const notas = janela.getByTestId('fabrica-release-notas')
    await expect(notas).toContainText('#942 Sintético: card no trem com verificação')
    await expect(notas).toContainText('#943')

    const checks = janela.getByTestId('fabrica-release-check')
    await expect(checks).toHaveCount(2)
    await expect(checks.nth(0)).toContainText('#942: abrir o Release e ver o #942;')
    await expect(checks.nth(1)).toContainText('#942: copiar as notas.')
    await expect(janela.getByTestId('fabrica-release-sem-check')).toHaveCount(1)
    await expect(janela.getByTestId('fabrica-release-sem-check')).toContainText(
      '#943: a verificação está na spec do épico #905',
    )

    await expect(janela.getByTestId('fabrica-release-board')).toHaveAttribute(
      'href',
      'https://github.com/users/leonardo-amaral-3/projects/2',
    )
    await expect(janela.getByTestId('fabrica-release-dev-main')).toHaveAttribute(
      'href',
      'https://github.com/leonardo-amaral-3/operations-center/compare/main...dev',
    )
  } finally {
    await app.close()
  }
})
