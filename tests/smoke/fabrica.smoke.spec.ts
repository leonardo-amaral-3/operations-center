import { execFileSync, spawn } from 'node:child_process'
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
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { BOARDS_FIXTURE_PATH, BOARD_FIXTURE_PATH } from './boards-fixture'
import { repoDoRelatorio } from './repo-do-relatorio'
import { TELAS_DO_HARNESS } from './comparacao'
import { abrirFabrica } from './comparacao/comum'
import { abrirItemDoCard } from './comparacao/fila-f3'
import { tipoDoItem } from '../../src/core/fabrica/sala'
import type { EstadoDaFabrica } from '../../src/core/fabrica/tipos'
import { launchSmokeApp } from './smoke-app'
import { NAVEGACAO_DA_SALA } from '../../src/renderer/fabrica/rotas'
import type { NomeDaTela } from '../../src/renderer/fabrica/rotas'
import { REPO_ROOT, smokeEnv, smokeFabricaItem, smokeFabricaReal } from './smoke-env'

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

async function subir(fabrica: string, extra: Record<string, string> = {}) {
  const stateDir = pastaTemporaria('oc-sala-estado-')
  const app = await launchSmokeApp({
    stateDir,
    env: {
      OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
      OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
      OC_FABRICA_DIR: fabrica,
      ...extra,
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
    // O fechar é da tela (F3), mas este teste só olha: a caixa está lá e o botão espera a resposta.
    await expect(window.getByTestId('fabrica-resposta')).toBeVisible()
    await expect(window.getByTestId('fabrica-responder-fechar')).toBeDisabled()

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

const FIXTURE_F3 = join(REPO_ROOT, 'tests', 'fixtures', 'fabrica', 'f3')

interface EstadoEmDisco {
  frentes: unknown[]
  despachos: unknown[]
  fila: { id: string; resolucao: string | null; fechadoEm: string | null }[]
}

function estadoEmDisco(pasta: string): EstadoEmDisco {
  return JSON.parse(readFileSync(join(pasta, 'estado.json'), 'utf8')) as EstadoEmDisco
}

test('responder, aprovar e devolver fecham pela tela', async () => {
  // O fechar regrava o `estado.json`: a pasta da fábrica deste teste mora em `test-results/`, nunca
  // em `/tmp` (a escrita recusa) e nunca na pasta real do despachante.
  const base = join(REPO_ROOT, 'test-results', `fabrica-f3-${randomUUID()}`)
  const pasta = join(base, 'fabrica')
  expect(pasta, 'a pasta do fechar tem de morar em test-results/').toContain('/test-results/')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  pastasTemporarias.push(base)
  cpSync(FIXTURE_F3, pasta, { recursive: true })
  const original = estadoEmDisco(pasta)
  const { app, window } = await subir(pasta)

  try {
    await abrirSala(window)
    const abertos = window.getByTestId('fabrica-aberto')
    await expect(abertos).toHaveCount(4)

    // Responder: a Pergunta do #961.
    await abrirItemDoCard(961)(window)
    await expect(window.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'pergunta')
    await window.getByTestId('fabrica-resposta').fill('gravar no cofre')
    await window.getByTestId('fabrica-responder-fechar').click()
    await expect(window.getByTestId('fabrica-item-fechado')).toContainText('gravar no cofre', {
      timeout: 20_000,
    })
    expect(estadoEmDisco(pasta).fila.find((q) => q.id === 'q-0009')?.resolucao).toBe(
      'gravar no cofre',
    )

    // A Sala perdeu o item sem reiniciar.
    await window.getByTestId('fabrica-trilha-0').click()
    await expect(abertos).toHaveCount(3)

    // Aprovar: a Decisão do #962.
    await abrirItemDoCard(962)(window)
    await expect(window.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'decisao')
    await window.getByTestId('fabrica-aprovar').click()
    await expect(window.getByTestId('fabrica-item-fechado')).toBeVisible({ timeout: 20_000 })
    expect(estadoEmDisco(pasta).fila.find((q) => q.id === 'q-0013')?.resolucao).toBe('aprovado')
    await window.getByTestId('fabrica-trilha-0').click()
    await expect(abertos).toHaveCount(2)

    // Devolver: a Decisão do #964, que só vale com a nota.
    await abrirItemDoCard(964)(window)
    await expect(window.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', 'decisao')
    await expect(window.getByTestId('fabrica-devolver')).toBeDisabled()
    await window.getByTestId('fabrica-nota').fill('faltou o teste do fechar')
    await window.getByTestId('fabrica-devolver').click()
    await expect(window.getByTestId('fabrica-item-fechado')).toBeVisible({ timeout: 20_000 })
    expect(estadoEmDisco(pasta).fila.find((q) => q.id === 'q-0017')?.resolucao).toBe(
      'devolvido: faltou o teste do fechar',
    )
    await window.getByTestId('fabrica-trilha-0').click()
    await expect(abertos).toHaveCount(1)
    await expect(abertos.first()).toContainText('#963')
  } finally {
    await app.close()
  }

  // Fechar não lança nada: frentes e despachos seguem os da cópia original.
  const depois = estadoEmDisco(pasta)
  expect(depois.frentes).toEqual(original.frentes)
  expect(depois.despachos).toEqual(original.despachos)
})

const FIXTURE_F2 = join(REPO_ROOT, 'tests', 'fixtures', 'fabrica', 'f2')

test('sala e agentes com a fixture da F2', async () => {
  test.skip(process.platform !== 'linux', 'sessões e cadeado leem /proc')

  // A fábrica copiada e o cadeado moram em `test-results/`: a escrita da P2 recusa `/tmp`, e o
  // `OC_SMOKE_CADEADO` vai **só** para o app que este teste sobe, nunca para o `yarn smoke`.
  const base = join(REPO_ROOT, 'test-results', 'fabrica-f2')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  pastasTemporarias.push(base)
  const pasta = join(base, 'fabrica')
  cpSync(FIXTURE_F2, pasta, { recursive: true })
  const antes = retrato(pasta)

  // `cardDaCwd` lê o card do nome da pasta em que o `flock` roda: `operations-center-777-smoke`.
  const cwdDoFlock = join(base, 'operations-center-777-smoke')
  mkdirSync(cwdDoFlock, { recursive: true })
  const cadeado = join(base, 'suite.lock')
  writeFileSync(cadeado, '')
  const flock = spawn('flock', [cadeado, 'sleep', '60'], {
    cwd: cwdDoFlock,
    stdio: 'ignore',
    detached: true,
  })

  const { app, window } = await subir(pasta, {
    OC_FABRICA_MANDATO_FIXTURE: join(FIXTURE_F2, 'mandato.txt'),
    OC_SMOKE_CADEADO: cadeado,
  })

  try {
    await abrirSala(window)

    // O resumo. Os pids da fixture não são sessões do Claude: "trabalhando" é 0 (M26).
    await expect(window.getByTestId('fabrica-resumo-esperando')).toContainText('3', {
      timeout: RELEITURA,
    })
    await expect(window.getByTestId('fabrica-resumo-trabalhando')).toContainText('0')
    await expect(window.getByTestId('fabrica-resumo-cadeados')).toContainText('1', {
      timeout: RELEITURA,
    })
    await expect(window.getByTestId('fabrica-resumo-quebradas')).toContainText('1')

    // A Linha: o que cada coluna carrega.
    const coluna = (nome: string) =>
      window.locator(`[data-testid="fabrica-coluna"][data-coluna="${nome}"]`)
    await expect(coluna('entrada')).toContainText('#952')
    await expect(coluna('entrada')).toContainText('PARADA')
    await expect(coluna('card')).toContainText('#2')
    await expect(coluna('card')).toContainText('Débito técnico')
    await expect(coluna('spec')).toContainText('#4')
    await expect(coluna('spec')).toContainText('Melhoria')
    await expect(coluna('spec')).toContainText('Completa')
    await expect(coluna('implementacao')).toContainText('#1')
    await expect(coluna('implementacao')).toContainText('Melhoria')
    await expect(coluna('implementacao')).toContainText('#953')
    await expect(coluna('implementacao')).toContainText('FALHA')
    await expect(coluna('revisao')).toContainText('#951')
    await expect(coluna('revisao')).toContainText('#955')
    await expect(coluna('revisao')).toContainText('PARADA')
    for (const vazia of ['integracao', 'validacao', 'release', 'operacao']) {
      await expect(coluna(vazia)).not.toContainText('#')
    }

    // Os recursos: sessões contra uma marca que nenhum processo carrega, a suíte de um `flock` real.
    await expect(window.getByTestId('fabrica-recurso-sessoes')).toContainText('0 de 3', {
      timeout: RELEITURA,
    })
    await expect(window.getByTestId('fabrica-recurso-suite')).toContainText('#777 · fila vazia', {
      timeout: RELEITURA,
    })
    await expect(window.getByTestId('fabrica-recurso-disco')).toContainText('2 GB')

    // O que a fábrica decidiu: os seis itens, nesta ordem.
    const decidiu = window.locator(
      '[data-testid="fabrica-decidiu"], [data-testid="fabrica-parou"], [data-testid="fabrica-fechado"]',
    )
    await expect(decidiu).toHaveCount(6)
    await expect(decidiu.nth(0)).toContainText('#1')
    await expect(decidiu.nth(0)).toContainText('/gm-implement')
    await expect(decidiu.nth(1)).toContainText('#955')
    await expect(decidiu.nth(2)).toContainText('#1')
    await expect(decidiu.nth(2)).toContainText('/gm-plan-tasks')
    await expect(decidiu.nth(3)).toContainText('#953')
    await expect(decidiu.nth(4)).toContainText('#952')
    await expect(decidiu.nth(5)).toContainText('#954')
    await expect(decidiu.nth(5)).toContainText('resolvido: seguir sem segundo revisor')
    await expect(window.getByTestId('fabrica-fechado')).toHaveCount(1)

    // Agentes.
    await window.getByTestId('fabrica-nav-agentes').click()
    await expect(window.getByTestId('fabrica-sessoes')).toContainText('0 de 3 sessões', {
      timeout: RELEITURA,
    })
    await expect(window.getByTestId('fabrica-agente')).toHaveCount(4)
    await expect(window.getByTestId('fabrica-agente-parado')).toHaveCount(3)
    await expect(window.getByText('Com o #777. Fila vazia.', { exact: false })).toBeVisible()
    const rodando = window.locator('[data-testid="fabrica-agente"][data-state="rodando"]')
    await expect(rodando).toHaveCount(2)
    for (const linha of await rodando.all()) await expect(linha).toContainText('sem sessão viva')
  } finally {
    // O `flock` forka o `sleep`: matar só o pai deixaria o filho segurando o cadeado.
    if (flock.pid !== undefined) process.kill(-flock.pid)
    await app.close()
  }

  expect(retrato(pasta), 'a sala mudou a pasta da fábrica').toEqual(antes)
})

test('a Linha mostra a aba selecionada', async () => {
  const pasta = pastaTemporaria('oc-sala-')
  cpSync(FIXTURE_F2, pasta, { recursive: true })
  const antes = retrato(pasta)
  const { app, window } = await subir(pasta, {
    OC_FABRICA_MANDATO_FIXTURE: join(FIXTURE_F2, 'mandato.txt'),
  })
  const coluna = (nome: string) =>
    window.locator(`[data-testid="fabrica-coluna"][data-coluna="${nome}"]`)

  try {
    await abrirSala(window)
    await expect(coluna('entrada')).toContainText('#952', { timeout: RELEITURA })
    await expect(window.getByTestId('fabrica-linha-board')).toContainText('board Operations Center')

    // Trocar de aba fecha a Fábrica (a volta ao kanban de hoje); reabrir mostra a aba nova.
    await window.locator('[data-board-key="ICSF-Solutions/19"]').click()
    await expect(window.getByTestId('fabrica-sala')).toHaveCount(0)
    await window.getByTestId('fabrica-toggle').click()
    await expect(window.getByTestId('fabrica-sala')).toBeVisible()
    await expect(window.getByTestId('fabrica-linha-board')).toContainText('board Plataformas v2', {
      timeout: RELEITURA,
    })
    await expect(coluna('spec')).toContainText('#910', { timeout: RELEITURA })
    await expect(coluna('entrada')).not.toContainText('#952')

    await window.locator('[data-board-key="leonardo-amaral-3/2"]').click()
    await expect(window.getByTestId('fabrica-sala')).toHaveCount(0)
    await window.getByTestId('fabrica-toggle').click()
    await expect(coluna('entrada')).toContainText('#952', { timeout: RELEITURA })
  } finally {
    await app.close()
  }

  expect(retrato(pasta), 'a sala mudou a pasta da fábrica').toEqual(antes)
})

test('os Agentes listam as sessões da máquina', async () => {
  test.skip(process.platform !== 'linux', 'as sessões vêm do /proc')

  const base = pastaTemporaria('oc-sessoes-')
  const pastaGit = (nome: string, origin: string): string => {
    const dir = join(base, nome)
    mkdirSync(dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir })
    return dir
  }
  const dirOc = pastaGit(
    'operations-center-777-smoke',
    'https://github.com/leonardo-amaral-3/operations-center.git',
  )
  const dirIcsf = pastaGit(
    'plataformas-910-smoke',
    'https://github.com/ICSF-Solutions/plataformas.git',
  )

  const fabrica = pastaTemporaria('oc-sala-')
  cpSync(FIXTURE_F2, fabrica, { recursive: true })

  const ambiente = smokeEnv()
  delete ambiente.OC_FABRICA_DESPACHO
  const sessao = (cwd: string, extra: string[]) =>
    spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', ...extra], {
      cwd,
      argv0: 'claude',
      env: ambiente,
      stdio: 'ignore',
    })
  const despachada = sessao(dirOc, ['--', '-p', '/gm-spec #777'])
  const interativa = sessao(dirIcsf, [])

  try {
    expect(despachada.pid).toBeDefined()
    expect(interativa.pid).toBeDefined()
    const { app, window } = await subir(fabrica, {
      OC_FABRICA_MANDATO_FIXTURE: join(FIXTURE_F2, 'mandato.txt'),
    })

    try {
      await abrirSala(window)
      await window.getByTestId('fabrica-nav-agentes').click()

      const linha = (pid: number | undefined) =>
        window.locator(`[data-testid="fabrica-maquina-sessao"][data-pid="${pid}"]`)
      const a = linha(despachada.pid)
      await expect(a).toContainText('#777', { timeout: RELEITURA })
      await expect(a).toContainText('leonardo-amaral-3/operations-center')
      await expect(a).toContainText('despachada (-p)')
      await expect(a).toContainText('gm-spec')
      await expect(a).not.toContainText('yarn fabrica')

      const b = linha(interativa.pid)
      await expect(b).toContainText('#910', { timeout: RELEITURA })
      await expect(b).toContainText('icsf-solutions/plataformas')
      await expect(b).toContainText('interativa')
    } finally {
      await app.close()
    }
  } finally {
    despachada.kill()
    interativa.kill()
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

  const estado = JSON.parse(readFileSync(join(pasta, 'estado.json'), 'utf8')) as EstadoDaFabrica
  const item = estado.fila.find((q) => q.id === id)
  if (item === undefined) throw new Error(`o item ${id} não está no estado.json`)
  const origem = estado.despachos.find((d) => d.id === item.despacho)
  // A regra de Decisão é a do núcleo (#143 §G4.4): só o parecer do G4 sem bloqueante.
  const tipo = tipoDoItem(item, origem, { owner: 'leonardo-amaral-3', name: 'operations-center' })
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
    // O item pode estar aberto ou já fechado: o cartão é um dos dois.
    await window
      .locator('[data-testid="fabrica-aberto"], [data-testid="fabrica-fechado"]')
      .filter({ hasText: item.motivo })
      .click({ position: { x: 6, y: 6 } })

    await expect(window.getByTestId('fabrica-tela')).toHaveAttribute('data-tela', tipo)
    const corpo = window.getByTestId(tipo === 'decisao' ? 'fabrica-decisao' : 'fabrica-pergunta')
    await expect(corpo).toContainText(item.motivo)
    await expect(corpo).toContainText(ultima)
    await expect(window.getByTestId('fabrica-tela')).not.toContainText('yarn fabrica fechar')
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
}

test('o relatório na sala', async () => {
  const repo = repoDoRelatorioTemporario()
  const { app, window } = await subirRelatorio(join(FIXTURES_RELATORIO, 'cofre-2026-11-10'), repo)

  try {
    await gerarDoDia(window)
    await expect(window.getByTestId('fabrica-relatorio-frase')).toContainText('#118', {
      timeout: 20_000,
    })
    await expect(window.locator('[data-testid="fabrica-kpi"][data-kpi="cofre"]')).toContainText(
      '14',
    )
    await expect(window.locator('[data-testid="fabrica-kpi"][data-kpi="chaves"]')).toContainText(
      '7',
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

test('o menu está nas 11 telas e leva direto a cada uma', async () => {
  test.setTimeout(240_000)
  const botoes = NAVEGACAO_DA_SALA.map(({ tela }) => tela)
  const raiz = join(REPO_ROOT, 'tests', 'fixtures', 'relatorio')
  const temporaria = pastaTemporaria('oc-menu-')
  const repo = repoDoRelatorio(
    (() => {
      const pasta = join(temporaria, 'repo')
      mkdirSync(pasta)
      return pasta
    })(),
  )

  // Uma subida do app por grupo de fixture, como o `comparacao.smoke.spec.ts`.
  const chaveDoGrupo = (t: { fixture: string; ambiente?: Readonly<Record<string, string>> }) =>
    `${t.fixture}\u0000${JSON.stringify(t.ambiente ?? {})}`
  const grupos = new Map<
    string,
    {
      fixture: string
      ambiente: Readonly<Record<string, string>>
      telas: Array<[NomeDaTela, (typeof TELAS_DO_HARNESS)[NomeDaTela]]>
    }
  >()
  for (const [tela, modulo] of Object.entries(TELAS_DO_HARNESS) as Array<
    [NomeDaTela, (typeof TELAS_DO_HARNESS)[NomeDaTela]]
  >) {
    const chave = chaveDoGrupo(modulo)
    const grupo = grupos.get(chave) ?? {
      fixture: modulo.fixture,
      ambiente: modulo.ambiente ?? {},
      telas: [],
    }
    grupo.telas.push([tela, modulo])
    grupos.set(chave, grupo)
  }

  let conferidas = 0
  for (const [indice, grupo] of [...grupos.values()].entries()) {
    const fabrica = join(temporaria, `fabrica-${indice}`)
    cpSync(grupo.fixture, fabrica, { recursive: true })
    const app = await launchSmokeApp({
      stateDir: join(temporaria, `estado-${indice}`),
      env: {
        OC_BOARD_FIXTURE: BOARD_FIXTURE_PATH,
        OC_BOARDS_FIXTURE: BOARDS_FIXTURE_PATH,
        OC_FABRICA_DIR: fabrica,
        OC_RELATORIO_COFRE: join(raiz, 'cofre-2026-11-10'),
        OC_RELATORIO_REPO: repo,
        OC_RELATORIO_FIXTURE: join(raiz, 'smoke.json'),
        ...grupo.ambiente,
      },
    })
    try {
      const janela = await app.firstWindow()
      await janela.getByTestId('fabrica-toggle').waitFor()
      const tela = janela.getByTestId('fabrica-tela')
      const voltarASala = async (): Promise<void> => {
        const nav = janela.getByTestId('fabrica-nav-sala')
        if ((await nav.count()) > 0) await nav.click()
        else await abrirFabrica(janela)
        await expect(tela).toHaveAttribute('data-tela', 'sala')
      }

      for (const [nome, modulo] of grupo.telas) {
        if (modulo.comoChegar === null) continue
        await voltarASala()
        await modulo.comoChegar(janela)
        await expect(tela).toHaveAttribute('data-tela', nome)
        for (const botao of botoes) {
          const el = janela.getByTestId(`fabrica-nav-${botao}`)
          await expect(el, `${nome}: falta o botão ${botao}`).toBeVisible()
          if (botao === nome) await expect(el).toHaveAttribute('aria-current', 'page')
          else await expect(el).not.toHaveAttribute('aria-current', /.*/)
        }
        conferidas += 1

        for (const destino of botoes) {
          await voltarASala()
          await modulo.comoChegar(janela)
          await janela.getByTestId(`fabrica-nav-${destino}`).click()
          await expect(tela, `${nome} → ${destino}`).toHaveAttribute('data-tela', destino)
        }
      }
    } finally {
      await app.close()
    }
  }
  expect(conferidas).toBe(Object.keys(TELAS_DO_HARNESS).length)
})
