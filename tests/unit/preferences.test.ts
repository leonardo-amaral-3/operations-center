/**
 * A aba lembrada em disco: a leitura tolerante e a gravação versionada.
 *
 * Toca disco de verdade, pelo mesmo motivo de `store.test.ts`: o que estes casos afirmam é o
 * comportamento na fronteira com o sistema de arquivos, e um fake de `node:fs/promises` provaria
 * apenas que o código chama as funções que o próprio teste desenhou.
 *
 * O `electron` é mockado porque `src/main/store.ts` — de onde vêm as duas pontas de IO — usa
 * `app.getPath('userData')` no fallback do `stateDir()`.
 *
 * A metade que **não** está aqui é a atomicidade: ela é do cofre, e `store.test.ts` já a cobre
 * (o `.tmp` que some, a pasta que nasce, a rejeição que chega). O que se prova aqui é a regra
 * **deste** formato — a versão que não migra e o campo torto que vira "sem aba lembrada" —, mais o
 * byte a byte do arquivo novo, que é o contrato que outra versão do app vai encontrar em disco.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath(name: string): string {
      return `/fake/${name}`
    },
  },
}))

import { loadActiveBoard, saveActiveBoard } from '../../src/main/preferences'

const ARQUIVO = 'preferences.json'
const CHAVE = 'leonardo-amaral-3/2'

let cofre: string

function gravar(conteudo: string): void {
  writeFileSync(join(cofre, ARQUIVO), conteudo, 'utf8')
}

function lerCru(): string {
  return readFileSync(join(cofre, ARQUIVO), 'utf8')
}

beforeEach(() => {
  cofre = mkdtempSync(join(tmpdir(), 'oc-preferences-'))
  process.env['OC_STATE_DIR'] = cofre
})

afterEach(() => {
  delete process.env['OC_STATE_DIR']
  rmSync(cofre, { recursive: true, force: true })
})

describe('loadActiveBoard', () => {
  it('devolve a chave gravada', async () => {
    gravar(`{"version": 1, "activeBoard": "${CHAVE}"}`)

    await expect(loadActiveBoard()).resolves.toBe(CHAVE)
  })

  it('arquivo ausente é null', async () => {
    // A máquina que abriu o app pela primeira vez. Vale a primeira aba da ordem, e não um erro.
    await expect(loadActiveBoard()).resolves.toBeNull()
  })

  const tortos = [
    { nome: 'JSON inválido', conteudo: '{ isto não é json' },
    { nome: 'versão desconhecida', conteudo: `{"version": 2, "activeBoard": "${CHAVE}"}` },
    { nome: 'sem versão', conteudo: `{"activeBoard": "${CHAVE}"}` },
    { nome: 'versão como string', conteudo: `{"version": "1", "activeBoard": "${CHAVE}"}` },
    { nome: 'sem activeBoard', conteudo: '{"version": 1}' },
    { nome: 'activeBoard nulo', conteudo: '{"version": 1, "activeBoard": null}' },
    { nome: 'activeBoard numérico', conteudo: '{"version": 1, "activeBoard": 2}' },
    { nome: 'activeBoard vazio', conteudo: '{"version": 1, "activeBoard": ""}' },
    { nome: 'raiz que é lista', conteudo: `["${CHAVE}"]` },
    { nome: 'raiz que é string', conteudo: `"${CHAVE}"` },
  ]

  it.each(tortos)('$nome é null, sem erro', async ({ conteudo }) => {
    gravar(conteudo)

    await expect(loadActiveBoard()).resolves.toBeNull()
  })

  it('devolve a chave sem julgar se aquele board ainda existe', async () => {
    // A chave sai daqui **opaca**. Quem tolera o lembrado que sumiu do GitHub é o `pickActive`, com
    // a lista descoberta na mão — este módulo não tem como saber, e fingir que sabe o faria
    // descartar uma preferência boa num dia de org fora do ar.
    gravar('{"version": 1, "activeBoard": "dono-que-nao-existe/999"}')

    await expect(loadActiveBoard()).resolves.toBe('dono-que-nao-existe/999')
  })

  it('não reescreve o arquivo que não entendeu', async () => {
    // O outro lado do CA-4: nem a leitura nem a versão desconhecida podem apagar a preferência
    // gravada. Só a ação do humano escreve neste arquivo (Decisão 14).
    const cru = `{"version": 2, "activeBoard": "${CHAVE}"}`
    gravar(cru)

    await loadActiveBoard()

    expect(lerCru()).toBe(cru)
  })
})

describe('saveActiveBoard', () => {
  it('grava a chave num arquivo versionado', async () => {
    // O formato escrito à mão de propósito: derivá-lo do `JSON.stringify` do próprio código
    // provaria apenas que ele é igual a si mesmo. É este byte a byte que outra versão do app — ou
    // um humano com o arquivo aberto — vai encontrar.
    await saveActiveBoard(CHAVE)

    expect(lerCru()).toBe(`{\n  "version": 1,\n  "activeBoard": "${CHAVE}"\n}\n`)
  })

  it('o que grava, o load lê de volta', async () => {
    await saveActiveBoard('ICSF-Solutions/19')

    await expect(loadActiveBoard()).resolves.toBe('ICSF-Solutions/19')
  })

  it('a gravação seguinte substitui a anterior', async () => {
    // Uma aba ativa, não um histórico: trocar de aba duas vezes não pode deixar duas preferências.
    await saveActiveBoard(CHAVE)
    await saveActiveBoard('ICSF-Solutions/19')

    await expect(loadActiveBoard()).resolves.toBe('ICSF-Solutions/19')
  })

  it('rejeita quando o disco não colabora', async () => {
    // A rejeição do cofre atravessa esta ponta em vez de virar `void`: preferência que falha em
    // silêncio é estado que o usuário acha que guardou. Quem decide o que fazer com ela é o
    // `boards.ts`, que sabe se aquilo custa um aviso ou nada.
    const intruso = join(cofre, 'nao-sou-pasta')
    writeFileSync(intruso, 'ocupado', 'utf8')
    process.env['OC_STATE_DIR'] = intruso

    await expect(saveActiveBoard(CHAVE)).rejects.toThrow()
  })
})
