import { describe, expect, it } from 'vitest'

import {
  abaParaSpawnar,
  MESA_INICIAL,
  paraLayout,
  reduceMesa,
} from '../../src/renderer/mesa/mesaState'
import type { MesaAction, MesaState } from '../../src/renderer/mesa/mesaState'
import type { LayoutSnapshot } from '../../src/shared/ipc'

/**
 * A parte pura da mesa (#74 §7): o dock, o painel e a **intenção de foco**.
 *
 * O que está preso aqui é o que o usuário sente com o teclado — CA-7. O foco é a parte que mais
 * quebra sem ninguém ver (digitar sem clicar indo parar num shell, fechar a aba e o foco sumir), e o
 * redutor puro é o único lugar onde dá para afirmá-lo sem subir um xterm.
 */

const VIEWPORT = { width: 1600, height: 1000 }

function aplicar(state: MesaState, ...acoes: MesaAction[]): MesaState {
  return acoes.reduce(reduceMesa, state)
}

function comAbas(...chaves: string[]): MesaState {
  return aplicar(
    MESA_INICIAL,
    ...chaves.map((key): MesaAction => ({ type: 'addTerminal', key, preset: 'powershell' })),
    { type: 'focusConsumed' },
  )
}

const chaves = (state: MesaState): string[] => state.dock.terminals.map((aba) => aba.key)

describe('hydrate — a mesa volta como estava, sem foco e sem shell', () => {
  const snapshot: LayoutSnapshot = {
    dock: {
      open: true,
      height: 300,
      terminals: [
        { key: 'a', preset: 'powershell', title: 'um' },
        { key: 'b', preset: 'aws:dev', title: 'dois', scope: { kind: 'free', id: 'f1' } },
      ],
      active: 'b',
    },
    side: { open: true, width: 500, active: 'f1' },
    lastPreset: 'aws:dev',
  }

  it('toda aba volta sem PTY e nada recebe foco sozinho', () => {
    const state = reduceMesa(MESA_INICIAL, { type: 'hydrate', snapshot, viewport: VIEWPORT })

    expect(state.dock.terminals.map((aba) => aba.id)).toEqual([null, null])
    // CA-7: na abertura do app, digitar sem clicar não vai para shell nenhum.
    expect(state.focus).toBeNull()
    expect(state.dock.active).toBe('b')
    expect(state.side).toEqual(snapshot.side)
    expect(state.lastPreset).toBe('aws:dev')
  })

  it('só a aba ativa spawna; as outras esperam a primeira ativação', () => {
    const state = reduceMesa(MESA_INICIAL, { type: 'hydrate', snapshot, viewport: VIEWPORT })

    expect(abaParaSpawnar(state)?.key).toBe('b')

    // Ativada a outra, é ela a que falta — e a que já spawnou não é pedida de novo.
    const aberta = aplicar(
      state,
      {
        type: 'terminalOpened',
        key: 'b',
        snapshot: { id: 'pty-1', preset: 'aws:dev', title: 'dois' },
      },
      { type: 'activateTerminal', key: 'a' },
    )
    expect(abaParaSpawnar(aberta)?.key).toBe('a')
  })

  it('dock fechado não spawna nada, mesmo com aba ativa', () => {
    const fechado = { ...snapshot, dock: { ...snapshot.dock, open: false } }
    const state = reduceMesa(MESA_INICIAL, {
      type: 'hydrate',
      snapshot: fechado,
      viewport: VIEWPORT,
    })

    expect(abaParaSpawnar(state)).toBeNull()
  })

  it('os tamanhos passam pelos limites do viewport de agora', () => {
    const enorme: LayoutSnapshot = {
      ...snapshot,
      dock: { ...snapshot.dock, height: 5000 },
      side: { ...snapshot.side, width: 5000 },
    }
    const state = reduceMesa(MESA_INICIAL, {
      type: 'hydrate',
      snapshot: enorme,
      viewport: { width: 1000, height: 800 },
    })

    expect(state.dock.height).toBe(560)
    expect(state.side.width).toBe(600)
  })
})

describe('closeTerminal — fechar a ativa foca a vizinha', () => {
  it('a vizinha da esquerda herda ativa e foco', () => {
    const state = aplicar(
      comAbas('a', 'b', 'c'),
      { type: 'activateTerminal', key: 'c' },
      { type: 'focusConsumed' },
    )
    const depois = reduceMesa(state, { type: 'closeTerminal', key: 'c' })

    expect(chaves(depois)).toEqual(['a', 'b'])
    expect(depois.dock.active).toBe('b')
    expect(depois.focus).toBe('terminal')
  })

  it('a primeira não tem esquerda: a da direita herda', () => {
    const state = aplicar(comAbas('a', 'b'), { type: 'activateTerminal', key: 'a' })
    const depois = reduceMesa(state, { type: 'closeTerminal', key: 'a' })

    expect(depois.dock.active).toBe('b')
    expect(depois.focus).toBe('terminal')
  })

  it('a última aba esconde o dock e não deixa foco para ninguém', () => {
    const depois = reduceMesa(comAbas('a'), { type: 'closeTerminal', key: 'a' })

    expect(depois.dock.open).toBe(false)
    expect(depois.dock.active).toBeNull()
    expect(depois.focus).toBeNull()
  })

  it('fechar uma aba que não é a ativa não mexe em ativa nem em foco', () => {
    const state = comAbas('a', 'b', 'c') // 'c' ativa, foco já consumido
    const depois = reduceMesa(state, { type: 'closeTerminal', key: 'a' })

    expect(depois.dock.active).toBe('c')
    expect(depois.focus).toBeNull()
  })

  it('endereça por `key`: a resposta atrasada de uma aba fechada não cai em outra', () => {
    const state = comAbas('a', 'b')
    const fechada = reduceMesa(state, { type: 'closeTerminal', key: 'a' })
    // O `openTerminal` da aba `a` estava em voo e chega agora.
    const depois = reduceMesa(fechada, {
      type: 'terminalOpened',
      key: 'a',
      snapshot: { id: 'pty-1', preset: 'powershell', title: 'atrasado' },
    })

    expect(depois).toBe(fechada)
  })
})

describe('toggleDock — a regra do VS Code, nas três situações', () => {
  it('fechado → abre e foca o terminal', () => {
    const fechado = { ...comAbas('a'), dock: { ...comAbas('a').dock, open: false } }
    const depois = reduceMesa(fechado, { type: 'toggleDock', terminalFocused: false })

    expect(depois.dock.open).toBe(true)
    expect(depois.focus).toBe('terminal')
  })

  it('aberto com o terminal focado → esconde e solta o foco', () => {
    const depois = reduceMesa(comAbas('a'), { type: 'toggleDock', terminalFocused: true })

    expect(depois.dock.open).toBe(false)
    expect(depois.focus).toBeNull()
  })

  it('aberto sem o terminal focado → só traz o foco, não esconde', () => {
    const depois = reduceMesa(comAbas('a'), { type: 'toggleDock', terminalFocused: false })

    expect(depois.dock.open).toBe(true)
    expect(depois.focus).toBe('terminal')
  })

  it('dock sem aba nenhuma não abre: seria uma faixa vazia', () => {
    expect(reduceMesa(MESA_INICIAL, { type: 'toggleDock', terminalFocused: false })).toBe(
      MESA_INICIAL,
    )
  })
})

describe('as origens de foco de terminal são só as combinadas', () => {
  it('`addTerminal` foca, grava `lastPreset` e abre o dock', () => {
    const depois = reduceMesa(MESA_INICIAL, { type: 'addTerminal', key: 'a', preset: 'git-bash' })

    expect(depois.focus).toBe('terminal')
    expect(depois.lastPreset).toBe('git-bash')
    expect(depois.dock).toMatchObject({ open: true, active: 'a' })
  })

  it('`activateTerminal` foca; `focusConsumed` zera', () => {
    const ativa = reduceMesa(comAbas('a', 'b'), { type: 'activateTerminal', key: 'a' })
    expect(ativa.focus).toBe('terminal')

    expect(reduceMesa(ativa, { type: 'focusConsumed' }).focus).toBeNull()
  })

  it('ativar uma `key` que não existe não muda nada', () => {
    const state = comAbas('a')

    expect(reduceMesa(state, { type: 'activateTerminal', key: 'fantasma' })).toBe(state)
  })

  it('o resultado de abrir ou falhar não rouba o foco', () => {
    const state = comAbas('a')
    const aberta = reduceMesa(state, {
      type: 'terminalOpened',
      key: 'a',
      snapshot: { id: 'pty-1', preset: 'powershell', title: 'PowerShell' },
    })
    const falha = reduceMesa(state, {
      type: 'terminalFailed',
      key: 'a',
      result: { opened: false, reason: 'shell-missing', detail: 'pwsh' },
    })

    expect(aberta.focus).toBeNull()
    expect(falha.focus).toBeNull()
    expect(falha.dock.terminals[0]?.failure).toEqual({ reason: 'shell-missing', detail: 'pwsh' })
  })

  it('`openFree` abre o painel na sessão e foca a caixa dela', () => {
    const depois = reduceMesa(MESA_INICIAL, { type: 'openFree', id: 'f1' })

    expect(depois.side).toMatchObject({ open: true, active: 'f1' })
    expect(depois.focus).toBe('free')
  })
})

describe('limites de tamanho', () => {
  it('a altura do dock vai de 120 a 70% do viewport', () => {
    const altura = (h: number): number =>
      reduceMesa(MESA_INICIAL, { type: 'resizeDock', height: h, viewportHeight: 1000 }).dock.height

    expect(altura(10)).toBe(120)
    expect(altura(400)).toBe(400)
    expect(altura(990)).toBe(700)
  })

  it('a largura do painel vai de 320 a 60% do viewport', () => {
    const largura = (w: number): number =>
      reduceMesa(MESA_INICIAL, { type: 'resizeSide', width: w, viewportWidth: 1000 }).side.width

    expect(largura(10)).toBe(320)
    expect(largura(450)).toBe(450)
    expect(largura(990)).toBe(600)
  })
})

describe('freeForgotten — esquecer a sessão não mata o shell', () => {
  it('a aba perde o `scope`, o shell fica, e o painel solta o id', () => {
    const state = aplicar(
      MESA_INICIAL,
      { type: 'addTerminal', key: 'a', preset: 'powershell', scope: { kind: 'free', id: 'f1' } },
      { type: 'addTerminal', key: 'b', preset: 'powershell', scope: { kind: 'free', id: 'f2' } },
      { type: 'openFree', id: 'f1' },
    )
    const depois = reduceMesa(state, { type: 'freeForgotten', id: 'f1' })

    expect(depois.dock.terminals[0]).not.toHaveProperty('scope')
    expect(depois.dock.terminals[1]?.scope).toEqual({ kind: 'free', id: 'f2' })
    expect(depois.side.active).toBeNull()
  })
})

describe('paraLayout — o que vai para o disco', () => {
  it('não grava aba de triagem, nem o que só existe em memória', () => {
    const state = aplicar(
      MESA_INICIAL,
      { type: 'addTerminal', key: 'a', preset: 'powershell' },
      {
        type: 'addTerminal',
        key: 'tri',
        preset: 'powershell',
        scope: { kind: 'triage', boardKey: 'b/2' },
      },
      {
        type: 'terminalOpened',
        key: 'a',
        snapshot: { id: 'pty-1', preset: 'powershell', title: 'PS' },
      },
    )
    const layout = paraLayout(state)

    expect(layout.dock.terminals).toEqual([{ key: 'a', preset: 'powershell', title: 'PS' }])
    // A ativa era a de triagem, que não é gravada: a gravada passa a ser a primeira que sobrou.
    expect(layout.dock.active).toBe('a')
  })

  it('o round-trip de uma mesa sem triagem volta igual', () => {
    const state = aplicar(
      comAbas('a', 'b'),
      { type: 'openFree', id: 'f1' },
      { type: 'resizeDock', height: 333, viewportHeight: 1000 },
    )
    const layout = paraLayout(state)
    const volta = reduceMesa(MESA_INICIAL, {
      type: 'hydrate',
      snapshot: layout,
      viewport: VIEWPORT,
    })

    expect(paraLayout(volta)).toEqual(layout)
  })
})
