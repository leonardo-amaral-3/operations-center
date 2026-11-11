import { spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'
import { repoDoRelatorio } from './repo-do-relatorio'
import { launchSmokeApp } from './smoke-app'
import { REPO_ROOT, smokeFabricaItem, smokeFabricaReal } from './smoke-env'

/**
 * O smoke da sala da fábrica (#122, §A10): a tela lê a pasta da fábrica, mostra a fila e **nunca
 * escreve nela**. Os três primeiros testes usam uma cópia da fixture em `/tmp` (a leitura aceita
 * `/tmp`; quem o recusa são as portas de escrita da P2). O 4 e o 4b são da verificação pós-deploy:
 * miram a pasta de verdade e só rodam com as portas de `smoke-env.ts`.
 *
 * Não toca a rede nem sessão do Claude: o board vem das fixtures de `tests/fixtures/`.
 */

const FIXTURE_SALA = join(REPO_ROOT, 'tests', 'fixtures', 'fabrica', 'sala')

/** O prazo da releitura (CA-3a.1): a sala relê a cada 5 s. */
const RELEITURA = 8000

const pastasTemporarias: string[] = []

test.afterEach(() => {
  for (const pasta of pastasTemporarias.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function pastaTemporaria(prefixo: string): string {
  const pasta = mkdtempSync(join(tmpdir(), prefixo))
  pastasTemporarias.push(pasta)
  return pasta
}

function pastaDaFabricaCopiada(): string {
  const pasta = pastaTemporaria('oc-sala-')
  cpSync(FIXTURE_SALA, pasta, { recursive: true })
  return pasta
}

/** A lista recursiva de arquivos da pasta com o sha256 de cada um, em ordem estável. */
function retrato(pasta: string): string[] {
  const saida: string[] = []
  const andar = (relativo: string): void => {
    for (const nome of readdirSync(join(pasta, relativo)).sort()) {
      const rel = join(relativo, nome)
      if (statSync(join(pasta, rel)).isDirectory()) andar(rel)
      else
        saida.push(
          `${rel} ${createHash('sha256')
            .update(readFileSync(join(pasta, rel)))
            .digest('hex')}`,
        )
    }
  }
  andar('')
  return saida
}

async function subir(fabrica: string) {
  const stateDir = pastaTemporaria('oc-sala-estado-')
  const app = await launchSmokeApp({
    stateDir,
    env: {
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      OC_FABRICA_DIR: fabrica,
    },
  })
  const window = await app.firstWindow()
  return { app, window }
}

async function abrirSala(window: Page): Promise<void> {
  await window.getByTestId('fabrica-toggle').click()
  await expect(window.getByTestId('fabrica-sala')).toBeVisible()
}

/** A troca da P2: grava um `.tmp` e renomeia por cima. */
function trocar(pasta: string, nome: string, conteudo: string): void {
  const tmp = join(pasta, `${nome}.tmp`)
  writeFileSync(tmp, conteudo)
  renameSync(tmp, join(pasta, nome))
}

/** `<pid> <campo 22 de /proc/<pid>/stat>`, a identidade que o `rodar.pid` guarda. */
function identidadeDe(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  const campos = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  return `${pid} ${campos[19]}`
}

test('a sala mostra a fila e não escreve', async () => {
  const pasta = pastaDaFabricaCopiada()
  const antes = retrato(pasta)
  const { app, window } = await subir(pasta)

  try {
    await abrirSala(window)

    const abertos = window.getByTestId('fabrica-aberto')
    await expect(abertos).toHaveCount(2)
    await expect(abertos.nth(0)).toContainText('#900')
    await expect(abertos.nth(1)).toContainText('#901')
    await expect(abertos.nth(0)).toContainText('o nome do campo é escolha de produto')
    await expect(abertos.nth(0)).toContainText('/gm-spec #900')

    const fechado = window.getByTestId('fabrica-fechado')
    await expect(fechado).toHaveCount(1)
    await expect(fechado).toContainText('#902')
    await expect(fechado).toContainText('resolvido: seguir sem segundo revisor')

    const emVoo = window.getByTestId('fabrica-em-voo')
    await expect(emVoo).toHaveCount(2)
    await expect(emVoo.nth(0)).toHaveAttribute('data-state', 'rodando')
    await expect(emVoo.nth(1)).toHaveAttribute('data-state', 'pendente')

    if (process.platform === 'linux') {
      await expect(window.getByTestId('fabrica-estado')).toContainText('Fábrica parada')
    }

    await abertos.nth(0).click()
    await expect(window.getByTestId('fabrica-pergunta')).toContainText('O nome do campo')
    await expect(window.getByTestId('fabrica-pergunta-fechar')).toHaveText(
      'yarn fabrica fechar q-0003 "<resolução>"',
    )

    // A Pergunta é uma tela: a volta à Sala é pela migalha 0 da trilha.
    await window.getByTestId('fabrica-trilha-0').click()
    await abertos.nth(1).click()
    await expect(window.getByTestId('fabrica-pergunta-sem-texto')).toBeVisible()

    // Duas releituras (a cada 5 s) antes de fechar: a leitura repetida também não escreve.
    await window.waitForTimeout(11_000)
  } finally {
    await app.close()
  }

  expect(retrato(pasta), 'a sala mudou a pasta da fábrica').toEqual(antes)
})

test('a releitura traz o que mudou', async () => {
  const pasta = pastaDaFabricaCopiada()
  const { app, window } = await subir(pasta)
  let sono: ReturnType<typeof spawn> | null = null

  try {
    await abrirSala(window)
    await expect(window.getByTestId('fabrica-aberto')).toHaveCount(2)

    const estado = JSON.parse(readFileSync(join(pasta, 'estado.json'), 'utf8')) as {
      contador: number
      fila: unknown[]
    }
    estado.contador = 15
    estado.fila.push({
      id: 'q-0015',
      card: 905,
      motivo: 'item novo da releitura',
      despacho: 'd-0014',
      sessaoClaude: null,
      criadoEm: '2026-11-11T11:20:00.000Z',
      fechadoEm: null,
      resolucao: null,
    })
    trocar(pasta, 'estado.json', JSON.stringify(estado, null, 2) + '\n')

    const abertos = window.getByTestId('fabrica-aberto')
    await expect(abertos).toHaveCount(3, { timeout: RELEITURA })
    await expect(abertos.last()).toContainText('item novo da releitura')

    if (process.platform === 'linux') {
      sono = spawn('sleep', ['30'], { stdio: 'ignore' })
      const pid = sono.pid
      if (pid === undefined) throw new Error('o sleep não subiu')
      writeFileSync(join(pasta, 'rodar.pid'), identidadeDe(pid))

      await expect(window.getByTestId('fabrica-estado')).toContainText('Fábrica ligada', {
        timeout: RELEITURA,
      })
    }
  } finally {
    sono?.kill()
    await app.close()
  }
})

test('ausente, ilegível e a volta ao kanban', async () => {
  const pasta = pastaTemporaria('oc-sala-')
  const { app, window } = await subir(pasta)

  try {
    await abrirSala(window)
    await expect(window.getByTestId('fabrica-vazia')).toBeVisible()

    writeFileSync(join(pasta, 'estado.json'), '{')
    const erro = window.getByTestId('fabrica-erro')
    await expect(erro).toContainText('Não foi possível ler o estado da fábrica.', {
      timeout: RELEITURA,
    })
    await expect(erro).toContainText('estado.json ilegível')

    await window.locator('[data-board-key]').first().click()
    await expect(window.getByTestId('fabrica-sala')).toHaveCount(0)
    await expect(window.getByTestId('column').first()).toBeVisible()
  } finally {
    await app.close()
  }
})

test('pausar e retomar pela tela', async () => {
  // A escrita recusa `/tmp` (P10): a pasta da fábrica deste teste mora em `test-results/`, nunca na
  // pasta real do despachante.
  const base = join(REPO_ROOT, 'test-results', 'fabrica-pausa')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  pastasTemporarias.push(base)
  const pasta = join(base, 'fabrica')
  cpSync(FIXTURE_SALA, pasta, { recursive: true })
  const { app, window } = await subir(pasta)

  try {
    await abrirSala(window)
    const estado = window.getByTestId('fabrica-estado')
    const botao = window.getByTestId('fabrica-pausar')
    await expect(estado).toContainText('Fábrica parada')
    await expect(botao).toContainText('Pausar fábrica')

    await botao.click()
    await expect(estado).toContainText('Fábrica pausada', { timeout: 20_000 })
    await expect(botao).toContainText('Retomar fábrica')
    expect(existsSync(join(pasta, 'pausa.json')), 'pausa.json não foi criado').toBe(true)

    await botao.click()
    await expect(estado).toContainText('Fábrica parada', { timeout: 20_000 })
    await expect(botao).toContainText('Pausar fábrica')
    expect(existsSync(join(pasta, 'pausa.json')), 'pausa.json não foi apagado').toBe(false)
  } finally {
    await app.close()
  }
})

const FABRICA_REAL = smokeFabricaReal()
const ITEM_REAL = smokeFabricaItem()

test('na pasta de verdade', async () => {
  test.skip(FABRICA_REAL === null, 'só na verificação pós-deploy: OC_SMOKE_FABRICA_REAL=<pasta>')
  const pasta = FABRICA_REAL as string
  const antes = retrato(pasta)
  const { app, window } = await subir(pasta)

  try {
    await abrirSala(window)

    if (existsSync(join(pasta, 'estado.json'))) {
      const estado = JSON.parse(readFileSync(join(pasta, 'estado.json'), 'utf8')) as {
        fila: { fechadoEm: string | null }[]
      }
      const abertos = estado.fila.filter((item) => item.fechadoEm === null).length
      await expect(window.getByTestId('fabrica-aberto')).toHaveCount(abertos)
    } else {
      await expect(window.getByTestId('fabrica-vazia')).toBeVisible()
    }
    await expect(window.getByTestId('fabrica-erro')).toHaveCount(0)

    await window.waitForTimeout(6000)
  } finally {
    await app.close()
  }

  expect(retrato(pasta), 'a sala mudou a pasta da fábrica').toEqual(antes)
})

test('um item da pasta de verdade', async () => {
  test.skip(
    FABRICA_REAL === null || ITEM_REAL === null,
    'só na verificação pós-deploy: OC_SMOKE_FABRICA_ITEM=<q>',
  )
  const pasta = FABRICA_REAL as string
  const id = ITEM_REAL as string
  const antes = retrato(pasta)

  const estado = JSON.parse(readFileSync(join(pasta, 'estado.json'), 'utf8')) as {
    fila: { id: string; motivo: string; despacho: string }[]
  }
  const item = estado.fila.find((q) => q.id === id)
  if (item === undefined) throw new Error(`o item ${id} não está no estado.json`)
  const saida = JSON.parse(
    readFileSync(join(pasta, 'sessoes', item.despacho, 'saida.json'), 'utf8'),
  ) as { result: string }
  const ultima =
    saida.result
      .split('\n')
      .filter((linha) => linha.trim() !== '')
      .pop() ?? ''

  const { app, window } = await subir(pasta)

  try {
    await abrirSala(window)
    await window.getByTestId('fabrica-aberto').filter({ hasText: item.motivo }).click()

    const pergunta = window.getByTestId('fabrica-pergunta')
    await expect(pergunta).toContainText(item.motivo)
    await expect(pergunta).toContainText(ultima)
    await expect(window.getByTestId('fabrica-pergunta-fechar')).toHaveText(
      `yarn fabrica fechar ${id} "<resolução>"`,
    )
  } finally {
    await app.close()
  }

  expect(retrato(pasta), 'a sala mudou a pasta da fábrica').toEqual(antes)
})

const FIXTURES_RELATORIO = join(REPO_ROOT, 'tests', 'fixtures', 'relatorio')

function repoDoRelatorioTemporario(): string {
  return repoDoRelatorio(pastaTemporaria('oc-relatorio-repo-'))
}

async function subirRelatorio(cofre: string, repo: string) {
  const app = await launchSmokeApp({
    stateDir: pastaTemporaria('oc-sala-estado-'),
    env: {
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      OC_FABRICA_DIR: pastaTemporaria('oc-sala-'),
      OC_RELATORIO_COFRE: cofre,
      OC_RELATORIO_REPO: repo,
      OC_RELATORIO_FIXTURE: join(FIXTURES_RELATORIO, 'smoke.json'),
    },
  })
  const window = await app.firstWindow()
  return { app, window }
}

async function gerarDoDia(window: Page): Promise<void> {
  await abrirSala(window)
  await window.getByTestId('fabrica-nav-relatorio').click()
  await window.getByTestId('relatorio-dia').fill('2026-11-10')
  await window.getByTestId('relatorio-gerar').click()
}

test('o relatório na sala', async () => {
  const repo = repoDoRelatorioTemporario()
  const { app, window } = await subirRelatorio(join(FIXTURES_RELATORIO, 'cofre-2026-11-10'), repo)

  try {
    await gerarDoDia(window)
    const corpo = window.getByTestId('relatorio-corpo')
    await expect(corpo).toContainText('Relatório do dia 2026-11-10', { timeout: 20_000 })
    await expect(corpo).toContainText(
      'Fábrica agêntica: o Operations Center despacha, governa e presta contas',
    )
  } finally {
    await app.close()
  }

  const ausente = join(pastaTemporaria('oc-relatorio-vazio-'), 'nao-existe')
  const segundo = await subirRelatorio(ausente, repo)

  try {
    await gerarDoDia(segundo.window)
    await expect(segundo.window.getByTestId('relatorio-erro')).toContainText(
      'a pasta do cofre não existe',
      { timeout: 20_000 },
    )
  } finally {
    await segundo.app.close()
  }
})
