/**
 * O lado sujo da marca: a tolerância de formato e a escrita atômica, contra um diretório temporário
 * **de verdade**.
 *
 * O `electron` é mockado como em `session-ipc.test.ts` — `src/main/danger.ts` só toca `ipcMain`, e
 * o `app` de `state.ts` nunca é chamado porque estes casos definem `OC_STATE_DIR`. Nada mais aqui é
 * de mentira: o `readFile`, o `mkdir`, o `writeFile` e o `rename` são os do sistema de arquivos.
 *
 * É por isso que este arquivo é mais do que o par de `DangerIndex.test.ts`: o `escreverAtomico` que
 * ele exercita saiu de `conversations.ts`, onde **nenhum unitário o importava** — o único exercício
 * real daquele caminho era o smoke da retomada, fora do CI. Esta é a primeira cobertura que a
 * escrita atômica do app ganha, e ela vale para os dois arquivos de estado.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: (): void => undefined },
}))

import { loadDangerous, saveDangerous } from '../../src/main/danger'

const ARQUIVO = 'dangerous.json'
const CARTAO = 'PVTI_cartao'
const OUTRO = 'PVTI_outro'

/** A versão que o módulo grava. Repetida aqui de propósito: um bump tem de quebrar este arquivo. */
const VERSAO_ATUAL = 1

/** Um por arquivo: os casos são sequenciais e cada um sobrescreve o `dangerous.json` do anterior. */
const diretorio = mkdtempSync(join(tmpdir(), 'oc-danger-'))

/** Onde `stateDir()` vai parar. Definido antes de qualquer caso — `state.ts` o lê a cada chamada. */
process.env['OC_STATE_DIR'] = diretorio

/** O que está no disco agora, cru. É a única forma de afirmar o **formato**, e não só a ida e volta. */
async function gravado(): Promise<string> {
  return readFile(join(diretorio, ARQUIVO), 'utf8')
}

async function escrever(conteudo: string): Promise<void> {
  await writeFile(join(diretorio, ARQUIVO), conteudo, 'utf8')
}

afterAll(() => {
  rmSync(diretorio, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(diretorio, ARQUIVO), { force: true })
})

describe('loadDangerous tolera tudo o que o disco pode devolver', () => {
  it('arquivo ausente é conjunto vazio', async () => {
    // O caso da máquina que abriu o app pela primeira vez — e o que faz a atualização não precisar
    // de nenhum passo de migração.
    await expect(loadDangerous()).resolves.toEqual(new Set())
  })

  it('JSON inválido é conjunto vazio, e não exceção', async () => {
    // O truncado de um desligamento no meio da escrita, que é exatamente o que `escreverAtomico`
    // existe para evitar — mas a leitura não conta com isso.
    await escrever('{"version":1,"cards":["PVTI_')

    await expect(loadDangerous()).resolves.toEqual(new Set())
  })

  it('versão desconhecida é conjunto vazio', async () => {
    // Não migra: perder as marcas uma vez é aceitável porque marca é decisão barata de refazer, e
    // porque o lado para o qual ela falha é o seguro.
    await escrever(JSON.stringify({ version: 2, cards: [CARTAO] }))

    await expect(loadDangerous()).resolves.toEqual(new Set())
  })

  it('`cards` como objeto em vez de array é conjunto vazio', async () => {
    // A forma do **outro** arquivo, chegando neste. Vale o inverso e é o que importa: a guarda daqui
    // é `Array.isArray`, e o `asRecord` de `conversations.ts` no lugar dela faria todo arquivo
    // válido — array — ser lido como vazio.
    await escrever(JSON.stringify({ version: VERSAO_ATUAL, cards: { [CARTAO]: true } }))

    await expect(loadDangerous()).resolves.toEqual(new Set())
  })

  it('entrada não-string é pulada sozinha, sem invalidar as outras', async () => {
    await escrever(
      JSON.stringify({ version: VERSAO_ATUAL, cards: [CARTAO, 42, null, '', { a: 1 }, OUTRO] }),
    )

    // As duas boas sobrevivem: uma marca ilegível custa um cartão com portão de volta, e descartar
    // as outras junto custaria todas.
    await expect(loadDangerous()).resolves.toEqual(new Set([CARTAO, OUTRO]))
  })

  it('repetido é absorvido pelo conjunto', async () => {
    await escrever(JSON.stringify({ version: VERSAO_ATUAL, cards: [CARTAO, CARTAO] }))

    await expect(loadDangerous()).resolves.toEqual(new Set([CARTAO]))
  })
})

describe('saveDangerous grava o formato que loadDangerous lê', () => {
  it('a ida e volta preserva o conjunto', async () => {
    await saveDangerous(new Set([CARTAO, OUTRO]))

    await expect(loadDangerous()).resolves.toEqual(new Set([CARTAO, OUTRO]))
  })

  it('grava `cards` como array, com a versão', async () => {
    // O formato é contrato com a `## Verificação pós-deploy`, que manda abrir o arquivo e conferir
    // "exatamente o cartão marcado, e só ele". Afirmá-lo aqui é o que impede a ida e volta de
    // passar verde com qualquer forma interna.
    await saveDangerous(new Set([CARTAO]))

    expect(JSON.parse(await gravado())).toEqual({ version: VERSAO_ATUAL, cards: [CARTAO] })
  })

  it('o conjunto vazio grava um array vazio, e não apaga o arquivo', async () => {
    // Desmarcar o último cartão é o passo 4 da verificação pós-deploy, que espera `"cards":[]`.
    await saveDangerous(new Set([CARTAO]))
    await saveDangerous(new Set())

    expect(JSON.parse(await gravado())).toEqual({ version: VERSAO_ATUAL, cards: [] })
    await expect(loadDangerous()).resolves.toEqual(new Set())
  })

  it('termina o arquivo com quebra de linha e não deixa o `.tmp` para trás', async () => {
    // As duas metades do `escreverAtomico`: o `\n` é do helper (a linha que um segundo `save*`
    // esqueceria) e o `rename` é o que faz a escrita ser atômica em vez de um truncado possível.
    await saveDangerous(new Set([CARTAO]))

    expect(await gravado()).toMatch(/\n$/)
    await expect(readFile(join(diretorio, `${ARQUIVO}.tmp`), 'utf8')).rejects.toThrow()
  })
})

describe('a escrita cria o diretório que ainda não existe', () => {
  it('um OC_STATE_DIR inexistente é criado na primeira gravação', async () => {
    // O caso do smoke, e o único em que o `mkdir` do helper importa: na máquina de quem desenvolve,
    // `userData` já existe. Sem ele, o primeiro `save` de uma rodada limpa falharia.
    const ausente = join(diretorio, 'ainda', 'nao', 'existe')
    const anterior = process.env['OC_STATE_DIR']
    process.env['OC_STATE_DIR'] = ausente

    try {
      await saveDangerous(new Set([CARTAO]))

      await expect(loadDangerous()).resolves.toEqual(new Set([CARTAO]))
    } finally {
      process.env['OC_STATE_DIR'] = anterior
    }
  })
})
