/**
 * O registro de preferências em disco: a leitura tolerante, a gravação versionada e a fusão.
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
 * **deste** formato — a versão que não migra, o campo torto que não contamina o vizinho e a fusão
 * que impede uma preferência de apagar a outra —, mais o byte a byte do arquivo, que é o contrato
 * que outra versão do app vai encontrar em disco.
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

import { loadActiveBoard, loadTheme, saveActiveBoard, saveTheme } from '../../src/main/preferences'

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

describe('loadTheme', () => {
  it('devolve a combinação gravada', async () => {
    gravar('{"version": 1, "theme": "obsidiana"}')

    await expect(loadTheme()).resolves.toBe('obsidiana')
  })

  it('arquivo ausente é null', async () => {
    await expect(loadTheme()).resolves.toBeNull()
  })

  it('o arquivo do #32, sem a chave, é null — e a aba dele continua de pé', async () => {
    // O caso **comum**, não o excepcional: é o que toda máquina em uso tem em disco hoje. Ele não
    // pode ser erro nem invalidar o arquivo, e é a razão pela qual a `VERSAO` continua `1`.
    gravar(`{"version": 1, "activeBoard": "${CHAVE}"}`)

    await expect(loadTheme()).resolves.toBeNull()
    await expect(loadActiveBoard()).resolves.toBe(CHAVE)
  })

  const temasTortos = [
    { nome: 'combinação desconhecida', theme: '"turmalina"' },
    { nome: 'combinação com a caixa trocada', theme: '"Obsidiana"' },
    { nome: 'theme nulo', theme: 'null' },
    { nome: 'theme numérico', theme: '3' },
    { nome: 'theme vazio', theme: '""' },
    { nome: 'theme que é lista', theme: '["obsidiana"]' },
  ]

  it.each(temasTortos)('$nome vira null sem invalidar a aba', async ({ theme }) => {
    // A guarda é **por campo**, como a do `danger.ts`: descartar a aba junto custaria uma
    // preferência boa por causa de uma ruim.
    gravar(`{"version": 1, "activeBoard": "${CHAVE}", "theme": ${theme}}`)

    await expect(loadTheme()).resolves.toBeNull()
    await expect(loadActiveBoard()).resolves.toBe(CHAVE)
  })

  it('a aba torta não invalida a combinação', async () => {
    // O mesmo por-campo, no sentido contrário — é o que faz dele uma regra, e não um acidente do
    // caso que veio primeiro.
    gravar('{"version": 1, "activeBoard": 2, "theme": "obsidiana"}')

    await expect(loadActiveBoard()).resolves.toBeNull()
    await expect(loadTheme()).resolves.toBe('obsidiana')
  })

  it('versão desconhecida é null, mesmo com a combinação bem escrita', async () => {
    // A versão é o único degrau que derruba o registro inteiro. Abaixo dela, cada campo se guarda
    // sozinho; nela, não há como saber o que as chaves significavam.
    gravar('{"version": 2, "theme": "obsidiana"}')

    await expect(loadTheme()).resolves.toBeNull()
  })
})

describe('saveActiveBoard', () => {
  it('grava a chave num arquivo versionado', async () => {
    // O formato escrito à mão de propósito: derivá-lo do `JSON.stringify` do próprio código
    // provaria apenas que ele é igual a si mesmo. É este byte a byte que outra versão do app — ou
    // um humano com o arquivo aberto — vai encontrar.
    //
    // **Sem `"theme"`**: a chave nova é opcional, e o arquivo de quem nunca escolheu combinação
    // continua idêntico ao que o #32 escrevia. Um `"theme": null` aqui faria a promessa de
    // compatibilidade da `VERSAO` valer só no papel.
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

describe('saveTheme', () => {
  it('grava a combinação num arquivo versionado', async () => {
    // O byte a byte da outra ponta, e sem `"activeBoard"` pela mesma razão simétrica: quem escolheu
    // o tema antes de ter aba não ganha uma chave vazia em disco.
    await saveTheme('obsidiana')

    expect(lerCru()).toBe('{\n  "version": 1,\n  "theme": "obsidiana"\n}\n')
  })

  it('o que grava, o load lê de volta', async () => {
    await saveTheme('ametista')

    await expect(loadTheme()).resolves.toBe('ametista')
  })

  it('a gravação seguinte substitui a anterior', async () => {
    await saveTheme('obsidiana')
    await saveTheme('lavanda')

    await expect(loadTheme()).resolves.toBe('lavanda')
  })

  it('rejeita quando o disco não colabora', async () => {
    const intruso = join(cofre, 'nao-sou-pasta')
    writeFileSync(intruso, 'ocupado', 'utf8')
    process.env['OC_STATE_DIR'] = intruso

    await expect(saveTheme('obsidiana')).rejects.toThrow()
  })
})

describe('a fusão (CA-7)', () => {
  it('gravar o tema não apaga a aba', async () => {
    await saveActiveBoard(CHAVE)
    await saveTheme('obsidiana')

    await expect(loadActiveBoard()).resolves.toBe(CHAVE)
    await expect(loadTheme()).resolves.toBe('obsidiana')
  })

  it('gravar a aba não apaga o tema', async () => {
    // O sentido contrário, e o que de fato quebraria: `saveActiveBoard` é a escrita que já existia,
    // e é a que teria continuado a escrever por cima do arquivo inteiro sem ninguém notar até o
    // segundo boot.
    await saveTheme('obsidiana')
    await saveActiveBoard(CHAVE)

    await expect(loadTheme()).resolves.toBe('obsidiana')
    await expect(loadActiveBoard()).resolves.toBe(CHAVE)
  })

  it('o arquivo fundido tem as duas chaves, nesta ordem', async () => {
    // O byte a byte do registro cheio: a aba antes do tema, para quem abrir o arquivo a olho nu.
    await saveTheme('obsidiana')
    await saveActiveBoard(CHAVE)

    expect(lerCru()).toBe(
      `{\n  "version": 1,\n  "activeBoard": "${CHAVE}",\n  "theme": "obsidiana"\n}\n`,
    )
  })

  it('a preferência que a escrita não entendeu não sobrevive à versão desconhecida', async () => {
    // O limite declarado da fusão: ela funde o que o `interpretar` devolveu, e um arquivo de versão
    // desconhecida devolve registro vazio. A próxima ação do humano substitui o arquivo — que é o
    // que "versão desconhecida não migra" sempre significou, agora com duas chaves em vez de uma.
    gravar(`{"version": 2, "activeBoard": "${CHAVE}"}`)

    await saveTheme('obsidiana')

    expect(lerCru()).toBe('{\n  "version": 1,\n  "theme": "obsidiana"\n}\n')
  })

  it('trocar de aba duas vezes preserva o tema em todas', async () => {
    // A fusão não pode ser um privilégio da primeira escrita: é o `gravar` que a faz, e ele é o
    // caminho das duas pontas, sempre.
    await saveTheme('obsidiana')
    await saveActiveBoard(CHAVE)
    await saveActiveBoard('ICSF-Solutions/19')

    await expect(loadTheme()).resolves.toBe('obsidiana')
    await expect(loadActiveBoard()).resolves.toBe('ICSF-Solutions/19')
  })
})
