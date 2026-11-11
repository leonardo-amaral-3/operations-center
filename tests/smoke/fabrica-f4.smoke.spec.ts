import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'
import { launchSmokeApp } from './smoke-app'
import { REPO_ROOT } from './smoke-env'

/**
 * O smoke da F4 (#133): o Card em voo, a Entrada e o Assumir, pela tela, numa subida só do app.
 * A pasta da fábrica é uma cópia em `test-results/` (a Entrada escreve nela pelo `yarn fabrica`).
 * Não sobe sessão do Claude e não toca a rede, o board real nem a pasta real da fábrica.
 */

const FIXTURE_F4 = join(REPO_ROOT, 'tests', 'fixtures', 'fabrica', 'f4')

const limpar: string[] = []

test.afterEach(() => {
  for (const pasta of limpar.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

test('card em voo, entrada e assumir pela tela', async () => {
  const raiz = join(REPO_ROOT, 'test-results')
  mkdirSync(raiz, { recursive: true })
  const pasta = join(raiz, `fabrica-f4-${randomUUID()}`)
  expect(pasta).toContain('/test-results/')
  cpSync(FIXTURE_F4, pasta, { recursive: true })
  rmSync(join(pasta, 'cards.json'))
  limpar.push(pasta)
  const estadoAntes = readFileSync(join(pasta, 'estado.json'))

  const stateDir = mkdtempSync(join(tmpdir(), 'oc-f4-estado-'))
  limpar.push(stateDir)
  const app = await launchSmokeApp({
    stateDir,
    env: {
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      OC_CARD_FIXTURE: join(FIXTURE_F4, 'cards.json'),
      OC_FABRICA_DIR: pasta,
    },
  })

  try {
    const janela = await app.firstWindow()

    // 3 · o card em voo
    await janela.getByTestId('fabrica-toggle').click()
    await expect(janela.getByTestId('fabrica-sala')).toBeVisible()
    await janela.getByTestId('fabrica-em-voo').filter({ hasText: /^#4 / }).first().click()
    await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'card')
    await expect(janela.getByTestId('fabrica-trilha')).toContainText('#4')
    const estacoes = janela.getByTestId('fabrica-estacao')
    await expect(estacoes).toHaveCount(9)
    const esperados = [
      'feita',
      'feita',
      'feita',
      'feita',
      'atual',
      'por-vir',
      'por-vir',
      'por-vir',
      'por-vir',
    ]
    for (const [i, estado] of esperados.entries()) {
      await expect(estacoes.nth(i)).toHaveAttribute('data-estado', estado)
    }
    const tasks = janela.getByTestId('fabrica-task')
    await expect(tasks).toHaveCount(5)
    await expect(tasks.nth(0)).toHaveAttribute('data-estado', 'feita')
    await expect(tasks.nth(1)).not.toHaveAttribute('data-estado', 'feita')
    await expect(janela.getByTestId('fabrica-card-decisao')).toHaveCount(3)
    await expect(janela.getByTestId('fabrica-card-sessao-titulo')).toHaveText(
      'Sessão do d-0005, rodando',
    )
    await expect(janela.getByTestId('fabrica-card-log')).toContainText('/gm-implement')
    await expect(janela.getByTestId('fabrica-card-assumir')).toBeDisabled()
    await expect(janela.getByTestId('fabrica-card-mensagem')).toBeDisabled()
    await expect(janela.getByTestId('fabrica-card-parar')).toBeDisabled()

    // 4 · a Entrada
    await janela.getByTestId('fabrica-trilha-0').click()
    await janela.getByTestId('fabrica-nav-entrada').click()
    await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'entrada')
    const itens = janela.getByTestId('fabrica-entrada-item')
    await expect(itens).toHaveCount(3)
    await expect(itens.first()).toHaveAttribute('data-id', 'e-0003')
    await expect(itens.and(janela.locator('[data-id="e-0001"]'))).toHaveAttribute(
      'data-estado',
      'triado',
    )
    await janela.getByTestId('fabrica-entrada-fonte-slack').click()
    await expect(janela.getByTestId('fabrica-entrada-fonte-vazia')).toBeVisible()
    await expect(itens).toHaveCount(0)
    await janela.getByTestId('fabrica-entrada-fonte-tudo').click()
    await expect(itens).toHaveCount(3)

    // 5 · mandar para a entrada, pelo `yarn fabrica entrada`
    const texto = 'o suporte pediu para exportar a fila em CSV'
    await janela.getByTestId('fabrica-entrada-texto').fill(texto)
    await janela.getByTestId('fabrica-entrada-mandar').click()
    await expect(itens).toHaveCount(4)
    await expect(itens.first()).toHaveAttribute('data-id', 'e-0004')
    await expect(itens.first()).toContainText(texto)
    await expect(janela.getByTestId('fabrica-entrada-texto')).toHaveValue('')
    const entrada = JSON.parse(readFileSync(join(pasta, 'entrada.json'), 'utf8')) as {
      contador: number
      itens: Array<{ id: string; fonte: string; triadoEm: string | null }>
    }
    expect(entrada.contador).toBe(4)
    const novo = entrada.itens.find((i) => i.id === 'e-0004')
    expect(novo).toMatchObject({ fonte: 'voce', triadoEm: null })
    expect(readFileSync(join(pasta, 'estado.json'))).toEqual(estadoAntes)

    // 6 · ver o #906 e tentar assumir uma sessão sem transcript
    await itens.last().getByTestId('fabrica-entrada-ver').click()
    await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'card')
    await expect(janela.getByTestId('fabrica-trilha')).toContainText('#906')
    await expect(janela.getByTestId('fabrica-card-sessao-titulo')).toHaveText(
      'Sessão do d-0007, terminada',
    )
    await expect(janela.getByTestId('fabrica-card-resultado')).toContainText('Portão local')
    await expect(janela.getByTestId('fabrica-card-fim')).toHaveText(
      '■ PARADA: PR #930 aberta na dev (Card: #906); o merge é da orquestradora',
    )
    await expect(janela.getByTestId('fabrica-card-tasks-vazio')).toContainText(
      'ainda não tem tasks',
    )
    await expect(janela.getByTestId('fabrica-card-assumir')).toBeEnabled()
    await janela.getByTestId('fabrica-card-assumir').click()
    await expect(janela.getByTestId('fabrica-card-assumir-erro')).toContainText(
      'não está nesta máquina',
    )
    const conversas = join(stateDir, 'conversations.json')
    if (existsSync(conversas)) expect(readFileSync(conversas, 'utf8')).not.toContain('sessao-906')
    expect(app.windows()).toHaveLength(1)
  } finally {
    await app.close()
  }
})
