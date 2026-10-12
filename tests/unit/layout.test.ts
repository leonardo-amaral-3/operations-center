/**
 * O `layout.json` (#74 §6): a leitura tolerante, a gravação versionada e a fila.
 *
 * Toca disco de verdade, pelo motivo de `preferences.test.ts`: o que se afirma é o comportamento na
 * fronteira com o sistema de arquivos. A atomicidade em si é do cofre (`store.test.ts`); aqui está a
 * regra **deste** formato — a versão que não migra, a aba torta que não derruba a mesa, e a fila que
 * impede duas gravações de brigarem pelo mesmo `.tmp`.
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
  ipcMain: { handle: vi.fn() },
}))

import { LAYOUT_PADRAO, loadLayout, saveLayout } from '../../src/main/layout'
import type { LayoutSnapshot } from '../../src/shared/ipc'

const ARQUIVO = 'layout.json'

let cofre: string

function gravar(conteudo: string): void {
  writeFileSync(join(cofre, ARQUIVO), conteudo, 'utf8')
}

beforeEach(() => {
  cofre = mkdtempSync(join(tmpdir(), 'oc-layout-'))
  process.env['OC_STATE_DIR'] = cofre
})

afterEach(() => {
  delete process.env['OC_STATE_DIR']
  rmSync(cofre, { recursive: true, force: true })
})

const mesa: LayoutSnapshot = {
  dock: {
    open: true,
    height: 320,
    terminals: [
      { key: 'a', preset: 'powershell', title: 'PowerShell' },
      { key: 'b', preset: 'aws:dev', title: 'AWS · dev', scope: { kind: 'free', id: 'f1' } },
      { key: 'c', preset: 'git-bash', title: 'card', scope: { kind: 'card', itemId: 'PVTI_1' } },
    ],
    active: 'b',
  },
  side: { open: true, width: 520, active: 'f1' },
  lastPreset: 'aws:dev',
}

describe('loadLayout', () => {
  it('arquivo ausente é o default: dock e painel fechados, nada a restaurar', async () => {
    await expect(loadLayout()).resolves.toEqual(LAYOUT_PADRAO)
    expect(LAYOUT_PADRAO).toEqual({
      dock: { open: false, height: 280, terminals: [], active: null },
      side: { open: false, width: 480, active: null },
      lastPreset: null,
    })
  })

  it('round-trip: o que se grava é o que se lê', async () => {
    await saveLayout(mesa)

    await expect(loadLayout()).resolves.toEqual(mesa)
  })

  it('o arquivo leva a versão e termina em quebra de linha', async () => {
    await saveLayout(mesa)
    const cru = readFileSync(join(cofre, ARQUIVO), 'utf8')

    expect(JSON.parse(cru)).toMatchObject({ version: 1, lastPreset: 'aws:dev' })
    expect(cru.endsWith('\n')).toBe(true)
  })

  it.each([
    { nome: 'JSON inválido', conteudo: '{ isto não é json' },
    { nome: 'versão desconhecida', conteudo: JSON.stringify({ ...mesa, version: 2 }) },
    { nome: 'sem versão', conteudo: JSON.stringify(mesa) },
    { nome: 'raiz que não é objeto', conteudo: '[1, 2]' },
  ])('$nome é o default', async ({ conteudo }) => {
    gravar(conteudo)

    await expect(loadLayout()).resolves.toEqual(LAYOUT_PADRAO)
  })

  it('aba torta custa a aba, não a mesa', async () => {
    gravar(
      JSON.stringify({
        version: 1,
        dock: {
          open: true,
          height: 300,
          terminals: [
            { key: 'ok', preset: 'powershell', title: 'um' },
            { key: '', preset: 'powershell', title: 'sem chave' },
            { key: 'ok', preset: 'powershell', title: 'chave repetida' },
            { key: 'sem-perfil', title: 'x' },
            'lixo',
            {
              key: 'tri',
              preset: 'powershell',
              title: 't',
              scope: { kind: 'triage', boardKey: 'b' },
            },
          ],
          active: 'ok',
        },
        side: { open: true, width: 'larga', active: 7 },
        lastPreset: '',
      }),
    )

    const lida = await loadLayout()

    // A aba de triagem volta sem o escopo (a pasta dela só existe em memória); as tortas somem.
    expect(lida.dock.terminals).toEqual([
      { key: 'ok', preset: 'powershell', title: 'um' },
      { key: 'tri', preset: 'powershell', title: 't' },
    ])
    expect(lida.side).toEqual({ open: true, width: 480, active: null })
    expect(lida.lastPreset).toBeNull()
  })

  it('ativa que não está entre as abas cai na primeira, e dock sem aba nenhuma não abre', async () => {
    gravar(
      JSON.stringify({
        version: 1,
        dock: {
          open: true,
          height: 300,
          terminals: [{ key: 'a', preset: 'powershell', title: 'a' }],
          active: 'sumiu',
        },
        side: { open: false, width: 480, active: null },
        lastPreset: null,
      }),
    )
    expect((await loadLayout()).dock.active).toBe('a')

    gravar(
      JSON.stringify({
        version: 1,
        dock: { open: true, height: 300, terminals: [], active: null },
        side: { open: false, width: 480, active: null },
        lastPreset: null,
      }),
    )
    expect((await loadLayout()).dock.open).toBe(false)
  })
})

describe('saveLayout — a fila', () => {
  it('gravações em voo ao mesmo tempo terminam, em ordem, com a última valendo', async () => {
    const alturas = [200, 210, 220, 230, 240]

    // Todas disparadas sem esperar: sem a fila, o `.tmp` de nome fixo brigaria pelo `rename`.
    await Promise.all(
      alturas.map((height) => saveLayout({ ...mesa, dock: { ...mesa.dock, height } })),
    )

    expect((await loadLayout()).dock.height).toBe(240)
  })
})
