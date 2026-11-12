import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'
import { repoDoRelatorio } from './repo-do-relatorio'
import { launchSmokeApp } from './smoke-app'
import { REPO_ROOT } from './smoke-env'

/**
 * O smoke da F5 (#134): Relatório, Portfólio e Mandato pela tela, com Confirmar e Contestar
 * gravando no `revisoes.jsonl`. A pasta da fábrica é uma cópia em `test-results/`.
 * Não sobe sessão do Claude e não toca a rede, o board real, o cofre real nem a pasta real da fábrica.
 */

const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures')
const FIXTURE_F5 = join(FIXTURES, 'fabrica', 'f5')
const COFRE = join(FIXTURES, 'fabrica', 'f5-cofre')
const MANDATO = join(FIXTURES, 'fabrica', 'f5-mandato.md')

const ARQUIVO_2 = '2026-11-10-leitura-do-cofre-em-lotes-de-64.md'
const ARQUIVO_3 = '2026-11-10-o-relatorio-agrupa-pela-raiz-da-cadeia.md'
const ARQUIVO_4 = '2026-11-10-a-sala-le-o-mandato-pela-graphql.md'
const ARQUIVO_7 = '2026-11-10-ajuste-de-texto-no-readme.md'
const ARQUIVO_9 = '2026-11-10-card-46-triado.md'

const limpar: string[] = []

test.afterEach(() => {
  for (const pasta of limpar.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

const kpi = (janela: Page, nome: string) =>
  janela.locator(`[data-testid="fabrica-kpi"][data-kpi="${nome}"]`)
const chave = (janela: Page, arquivo: string) =>
  janela.locator(`[data-testid="fabrica-relatorio-chave"][data-arquivo="${arquivo}"]`)

async function abrirRelatorio(janela: Page): Promise<void> {
  await janela.getByTestId('fabrica-toggle').click()
  await expect(janela.getByTestId('fabrica-sala')).toBeVisible()
  await janela.getByTestId('fabrica-nav-relatorio').click()
  await janela.getByTestId('relatorio-dia').fill('2026-11-10')
  await expect(janela.getByTestId('fabrica-trilha')).toHaveText(/Relatório de 10\/11$/, {
    timeout: 20_000,
  })
}

function linhasDoJsonl(pasta: string): Array<Record<string, unknown>> {
  return readFileSync(join(pasta, 'revisoes.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

test('relatório, portfólio e mandato pela tela', async () => {
  test.setTimeout(240_000)

  // 1 · a pasta da fábrica é uma cópia em test-results/, afirmada antes de subir o app
  const raiz = join(REPO_ROOT, 'test-results')
  mkdirSync(raiz, { recursive: true })
  const pasta = join(raiz, `fabrica-f5-${randomUUID()}`)
  expect(pasta).toContain('/test-results/')
  cpSync(FIXTURE_F5, pasta, { recursive: true })
  limpar.push(pasta)

  const temporaria = mkdtempSync(join(tmpdir(), 'oc-f5-'))
  limpar.push(temporaria)
  const repoPasta = join(temporaria, 'repo')
  mkdirSync(repoPasta)
  const repo = repoDoRelatorio(repoPasta)

  // 2 · o app, só com fixtures
  const env = {
    OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
    OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
    OC_FABRICA_DIR: pasta,
    OC_RELATORIO_COFRE: COFRE,
    OC_RELATORIO_REPO: repo,
    OC_RELATORIO_FIXTURE: join(FIXTURES, 'relatorio', 'smoke.json'),
    OC_FABRICA_MANDATO_FIXTURE: MANDATO,
  }
  const app = await launchSmokeApp({ stateDir: join(temporaria, 'estado-1'), env })

  try {
    const janela = await app.firstWindow()

    // 3 · o Relatório de 10/11
    await abrirRelatorio(janela)
    await expect(kpi(janela, 'cofre')).toContainText('12')
    await expect(kpi(janela, 'chaves')).toContainText('5')
    await expect(kpi(janela, 'provisorias')).toContainText('2')
    await expect(kpi(janela, 'estacionadas')).toContainText('1')
    await expect(kpi(janela, 'sem-repo')).toContainText('1')
    const segmentos = janela.getByTestId('fabrica-esforco-segmento')
    await expect(segmentos).toHaveCount(4)
    await expect(segmentos.filter({ hasText: /outros/i })).toHaveCount(0)
    await expect(
      janela.locator('[data-testid="fabrica-esforco-segmento"][aria-label="sem repo, 1"]'),
    ).toHaveCount(1)
    await expect(janela.getByTestId('fabrica-relatorio-chave')).toHaveCount(5)
    await expect(janela.getByTestId('fabrica-confirmar')).toHaveCount(2)
    await expect(chave(janela, ARQUIVO_2).getByTestId('fabrica-confirmar')).toBeVisible()
    await expect(chave(janela, ARQUIVO_3).getByTestId('fabrica-confirmar')).toBeVisible()
    await expect(chave(janela, ARQUIVO_4)).toHaveAttribute('data-estado', 'confirmada')

    // 4 · confirmar o 2
    await chave(janela, ARQUIVO_2).getByTestId('fabrica-confirmar').click()
    await expect(chave(janela, ARQUIVO_2)).toHaveAttribute('data-estado', 'confirmada')
    await expect(chave(janela, ARQUIVO_2).getByTestId('fabrica-confirmar')).toHaveCount(0)
    await expect(kpi(janela, 'provisorias')).toContainText('1')
    const depoisDoConfirmar = linhasDoJsonl(pasta)
    expect(depoisDoConfirmar).toHaveLength(2)
    expect(depoisDoConfirmar[1]).toMatchObject({ tipo: 'confirmada', arquivo: ARQUIVO_2 })

    // 5 · contestar o 3
    await chave(janela, ARQUIVO_3).getByTestId('fabrica-contestar').click()
    await janela.getByTestId('fabrica-contestar-motivo').fill('a raiz tem de parar no épico')
    await janela.getByTestId('fabrica-contestar-gravar').click()
    await expect(chave(janela, ARQUIVO_3)).toHaveAttribute('data-estado', 'contestada')
    await expect(chave(janela, ARQUIVO_3).getByTestId('fabrica-revisao')).toContainText(
      'a raiz tem de parar no épico',
    )
    const depoisDoContestar = linhasDoJsonl(pasta)
    expect(depoisDoContestar).toHaveLength(3)
    expect(depoisDoContestar[2]).toMatchObject({
      tipo: 'contestada',
      arquivo: ARQUIVO_3,
      motivo: 'a raiz tem de parar no épico',
    })

    // 6 · o Portfólio
    await janela.getByTestId('fabrica-relatorio-trilha').click()
    await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'portfolio')
    await expect(janela.getByTestId('fabrica-portfolio-dia')).toContainText('10/11/2026')
    await expect(janela.getByTestId('fabrica-objetivo')).toHaveCount(4)
    await expect(janela.getByTestId('fabrica-sem-objetivo')).toBeVisible()
    const linhas = janela.getByTestId('fabrica-decisoes-linha')
    await expect(linhas).toHaveCount(9)
    const filtro = async (nome: RegExp | string, quantas: number) => {
      await janela.getByTestId('fabrica-filtro').filter({ hasText: nome }).click()
      if (quantas === 0) {
        await expect(janela.getByTestId('fabrica-decisoes-vazia')).toBeVisible()
      }
      await expect(linhas).toHaveCount(quantas)
    }
    await filtro(/^Provisórias/, 0)
    await filtro(/^Suas/, 3)
    await filtro(/^Alertas/, 1)
    await expect(linhas.first()).toHaveAttribute('data-arquivo', ARQUIVO_9)
    await filtro(/^Sem objetivo/, 2)
    await expect(linhas.and(janela.locator(`[data-arquivo="${ARQUIVO_7}"]`))).toHaveCount(1)
    await expect(linhas.and(janela.locator(`[data-arquivo="${ARQUIVO_9}"]`))).toHaveCount(1)
    await filtro(/^Chave/, 5)
    await filtro(/^Todas/, 9)
    await linhas.and(janela.locator(`[data-arquivo="${ARQUIVO_9}"]`)).click()
    const detalhe = janela.getByTestId('fabrica-portfolio-detalhe')
    await expect(detalhe).toContainText('46 (sem repo)')
    await expect(detalhe).toContainText('nenhum; escopo gravado sem o repo')
    await expect(detalhe.getByTestId('fabrica-confirmar')).toBeDisabled()
    await expect(detalhe.getByTestId('fabrica-contestar')).toBeDisabled()
    await expect(detalhe.getByTestId('fabrica-abrir-transcrito')).toBeDisabled()

    // 7 · o Mandato
    await janela.getByTestId('fabrica-trilha-0').click()
    await janela.getByTestId('fabrica-nav-mandato').click()
    await expect(janela.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'mandato')
    await expect(janela.getByTestId('fabrica-portao')).toHaveCount(9, { timeout: 20_000 })
    const quem = async (portao: string, esperado: string) => {
      const celulas = janela.locator(
        `[data-testid="fabrica-portao"][data-portao="${portao}"] [data-testid="fabrica-celula"]`,
      )
      await expect(celulas).toHaveCount(3)
      for (let i = 0; i < 3; i++)
        await expect(celulas.nth(i).locator('[data-quem]')).toHaveAttribute('data-quem', esperado)
    }
    for (const p of ['g1', 'g2', 'g3', 'impl', 'g4']) await quem(p, 'A')
    await quem('g5', 'travado')
    for (const p of ['entrada', 'val', 'op']) await quem(p, 'nao-diz')
    const regras = janela.getByTestId('fabrica-regra')
    await expect(regras).toHaveCount(3)
    await expect(regras.nth(1)).toContainText(/^Proibido:/)
    await expect(janela.getByTestId('fabrica-placar-base')).toContainText('claude-brain#28')
    await expect(janela.getByTestId('fabrica-mandato-github')).toHaveAttribute(
      'href',
      /github\.com\/.+\/blob\/dev\/fabrica\/MANDATO\.md$/,
    )
  } finally {
    await app.close()
  }

  // 8 · as revisões reaparecem ao reabrir (CA-5.2)
  const segundo = await launchSmokeApp({ stateDir: join(temporaria, 'estado-2'), env })
  try {
    const janela = await segundo.firstWindow()
    await abrirRelatorio(janela)
    await expect(chave(janela, ARQUIVO_2)).toHaveAttribute('data-estado', 'confirmada')
    await expect(chave(janela, ARQUIVO_3)).toHaveAttribute('data-estado', 'contestada')
  } finally {
    await segundo.close()
  }

  // 9 · nenhum estado.json foi criado na cópia (CA-E3)
  expect(existsSync(join(pasta, 'estado.json'))).toBe(false)
})
