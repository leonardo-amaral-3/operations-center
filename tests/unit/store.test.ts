/**
 * O cofre do estado durável: a pasta, a leitura tolerante e a escrita atômica.
 *
 * Este é o único teste do projeto que toca disco de verdade, e é de propósito: o que se está
 * afirmando aqui é justamente o comportamento do sistema de arquivos — que o `.tmp` some, que a
 * pasta nasce, que o byte gravado é aquele. Um fake de `node:fs/promises` provaria só que o código
 * chama as funções que o próprio teste desenhou. `mkdtemp` custa milissegundos e prova o contrário.
 *
 * O `electron` é mockado porque a única coisa que `src/main/store.ts` usa dele é o
 * `app.getPath('userData')` — o ramo de fallback do `stateDir()`, que sem mock nem importa.
 *
 * O caso que **não pode** faltar é o byte a byte da escrita: esta extração nasceu de
 * `saveConversations`, e o `conversations.json` de quem já usa o app não pode mudar um caractere por
 * causa dela (item 4 de `## Migrations & compatibilidade` da spec).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
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

import { readState, stateDir, writeState } from '../../src/main/store'

const ARQUIVO = 'exemplo.json'

let cofre: string

beforeEach(() => {
  cofre = mkdtempSync(join(tmpdir(), 'oc-store-'))
  process.env['OC_STATE_DIR'] = cofre
})

afterEach(() => {
  delete process.env['OC_STATE_DIR']
  rmSync(cofre, { recursive: true, force: true })
})

describe('stateDir', () => {
  it('usa o OC_STATE_DIR quando ele existe', () => {
    expect(stateDir()).toBe(cofre)
  })

  it('cai no userData do Electron sem OC_STATE_DIR', () => {
    delete process.env['OC_STATE_DIR']

    expect(stateDir()).toBe('/fake/userData')
  })

  it('trata OC_STATE_DIR vazio como ausente', () => {
    // Uma variável exportada vazia é lixo de ambiente, não uma escolha: `''` como diretório faria o
    // app gravar na pasta corrente de quem o lançou.
    process.env['OC_STATE_DIR'] = ''

    expect(stateDir()).toBe('/fake/userData')
  })
})

describe('readState', () => {
  it('arquivo ausente é null', async () => {
    await expect(readState(ARQUIVO)).resolves.toBeNull()
  })

  it('JSON inválido é null', async () => {
    writeFileSync(join(cofre, ARQUIVO), '{ isto não é json', 'utf8')

    await expect(readState(ARQUIVO)).resolves.toBeNull()
  })

  it('pasta inteira ausente é null, e não erro', async () => {
    // O primeiro boot numa máquina limpa, e o smoke apontado para uma pasta que só a escrita cria.
    process.env['OC_STATE_DIR'] = join(cofre, 'ainda-nao-existe')

    await expect(readState(ARQUIVO)).resolves.toBeNull()
  })

  it('devolve o conteúdo parseado sem interpretar nada dele', async () => {
    // Forma que nenhum arquivo do app tem: o cofre não sabe — nem deve saber — o que é `version`.
    writeFileSync(join(cofre, ARQUIVO), '{"qualquer": [1, "coisa"]}', 'utf8')

    await expect(readState(ARQUIVO)).resolves.toEqual({ qualquer: [1, 'coisa'] })
  })
})

describe('writeState', () => {
  it('grava com dois espaços de recuo e quebra de linha final', async () => {
    // O byte a byte do `conversations.json`. Escrito à mão de propósito: derivá-lo do próprio
    // `JSON.stringify` do código provaria apenas que ele é igual a si mesmo.
    await writeState(ARQUIVO, { version: 1, cards: { PVTI_abc: 'sessao-1' } })

    expect(readFileSync(join(cofre, ARQUIVO), 'utf8')).toBe(
      '{\n  "version": 1,\n  "cards": {\n    "PVTI_abc": "sessao-1"\n  }\n}\n',
    )
  })

  it('cria a pasta que ainda não existe', async () => {
    process.env['OC_STATE_DIR'] = join(cofre, 'fundo', 'do', 'poco')

    await writeState(ARQUIVO, { version: 1 })

    expect(readFileSync(join(cofre, 'fundo', 'do', 'poco', ARQUIVO), 'utf8')).toBe(
      '{\n  "version": 1\n}\n',
    )
  })

  it('não deixa o temporário para trás', async () => {
    await writeState(ARQUIVO, { version: 1 })

    // O `.tmp` sobrevivente seria um vazamento silencioso: o app funcionaria, e a pasta cresceria.
    await expect(readdir(cofre)).resolves.toEqual([ARQUIVO])
  })

  it('sobrescreve o que já estava lá', async () => {
    await writeState(ARQUIVO, { version: 1, cards: { a: 'um' } })
    await writeState(ARQUIVO, { version: 1, cards: { b: 'dois' } })

    await expect(readState(ARQUIVO)).resolves.toEqual({ version: 1, cards: { b: 'dois' } })
  })

  it('rejeita quando o disco não colabora', async () => {
    // Um arquivo onde o cofre espera um diretório: o `mkdir` falha, e a rejeição precisa chegar a
    // quem chamou. Escrita que falha em silêncio é estado que o usuário acha que guardou.
    const intruso = join(cofre, 'nao-sou-pasta')
    writeFileSync(intruso, 'ocupado', 'utf8')
    process.env['OC_STATE_DIR'] = intruso

    await expect(writeState(ARQUIVO, { version: 1 })).rejects.toThrow()
  })
})
