/**
 * O estado da mesa — o dock de terminais, o painel de sessão livre e a intenção de foco — e as regras
 * que o movem, sem React, sem `window`, sem DOM (#74 §7).
 *
 * Mora num arquivo próprio pela razão de `screens/kanbanState.ts`: o `useReducer` é do `useMesa`, mas
 * a regra que ele aplica é pura e merece teste sem subir Electron nem xterm. O viewport chega por
 * argumento justamente para o módulo rodar em `node`, sem `window`.
 *
 * **Toda ação endereça a aba pela `key`**, nunca por índice: fechar a aba `i-1` enquanto o
 * `openTerminal` da aba `i` está em voo não pode fazer a resposta cair na aba errada. Ação sobre
 * `key` que já não existe devolve o **mesmo** estado — a resposta atrasada de uma aba fechada é
 * ruído, não erro.
 *
 * **Foco é intenção, não efeito.** `focus` diz quem *deve* ser focado; o componente consome e zera
 * com `focusConsumed`. As únicas origens de `focus: 'terminal'` são `addTerminal`,
 * `activateTerminal`, `toggleDock` e o `closeTerminal` que herda a vizinha — `hydrate` nunca foca
 * (CA-7: digitar sem clicar, na abertura do app, não vai para shell nenhum).
 */

import type {
  LayoutSide,
  LayoutSnapshot,
  LayoutTerminal,
  OpenTerminalResult,
  SessionScope,
  TerminalSnapshot,
} from '../../shared/ipc'

/** Os limites de tamanho: piso fixo, teto proporcional ao viewport (spec §7). */
export const DOCK_HEIGHT_MIN = 120
export const DOCK_HEIGHT_MAX_RATIO = 0.7
export const SIDE_WIDTH_MIN = 320
export const SIDE_WIDTH_MAX_RATIO = 0.6

export interface Viewport {
  width: number
  height: number
}

/** O motivo e o texto de um `openTerminal` que falhou — o que a aba mostra no lugar do shell. */
export interface TerminalFailureInfo {
  reason: Extract<OpenTerminalResult, { opened: false }>['reason']
  detail: string
}

/**
 * Uma aba do dock: a parte que persiste (`LayoutTerminal`) mais o que só existe em memória.
 */
export interface MesaTab extends LayoutTerminal {
  /** O `id` do PTY, ou `null` enquanto a aba não spawnou — restaurada e ainda não ativada, ou em voo. */
  id: string | null
  failure: TerminalFailureInfo | null
  /** O código de saída do shell, ou `null` se ele ainda roda (ou nunca rodou). */
  exitCode: number | null
}

export interface MesaDock {
  open: boolean
  height: number
  terminals: readonly MesaTab[]
  /** A `key` da aba ativa. */
  active: string | null
}

export type MesaFocus = 'terminal' | 'free' | null

export interface MesaState {
  dock: MesaDock
  side: LayoutSide
  lastPreset: string | null
  focus: MesaFocus
}

export const MESA_INICIAL: MesaState = {
  dock: { open: false, height: 280, terminals: [], active: null },
  side: { open: false, width: 480, active: null },
  lastPreset: null,
  focus: null,
}

export type MesaAction =
  | { type: 'hydrate'; snapshot: LayoutSnapshot; viewport: Viewport }
  | { type: 'terminalOpened'; key: string; snapshot: TerminalSnapshot }
  | { type: 'terminalFailed'; key: string; result: Extract<OpenTerminalResult, { opened: false }> }
  | { type: 'terminalExited'; key: string; exitCode: number }
  | { type: 'addTerminal'; key: string; preset: string; scope?: SessionScope }
  | { type: 'closeTerminal'; key: string }
  | { type: 'activateTerminal'; key: string }
  | { type: 'toggleDock'; terminalFocused: boolean }
  | { type: 'resizeDock'; height: number; viewportHeight: number }
  | { type: 'openFree'; id: string }
  | { type: 'toggleSide' }
  | { type: 'resizeSide'; width: number; viewportWidth: number }
  | { type: 'freeForgotten'; id: string }
  | { type: 'focusConsumed' }

export function reduceMesa(state: MesaState, action: MesaAction): MesaState {
  switch (action.type) {
    case 'hydrate':
      return hydrate(action.snapshot, action.viewport)

    case 'terminalOpened':
      return mudarAba(state, action.key, (aba) => ({
        ...aba,
        id: action.snapshot.id,
        title: action.snapshot.title,
        failure: null,
        exitCode: null,
      }))

    case 'terminalFailed':
      return mudarAba(state, action.key, (aba) => ({
        ...aba,
        id: null,
        failure: { reason: action.result.reason, detail: action.result.detail },
      }))

    case 'terminalExited':
      // O `id` cai: o PTY já não existe, e escrever nele seria falar com um id morto. A aba fica, com
      // o código, para o componente mostrar que o shell acabou.
      return mudarAba(state, action.key, (aba) => ({ ...aba, id: null, exitCode: action.exitCode }))

    case 'addTerminal':
      return addTerminal(state, action.key, action.preset, action.scope)

    case 'closeTerminal':
      return closeTerminal(state, action.key)

    case 'activateTerminal':
      if (!state.dock.terminals.some((aba) => aba.key === action.key)) return state

      return {
        ...state,
        dock: { ...state.dock, open: true, active: action.key },
        focus: 'terminal',
      }

    case 'toggleDock':
      return toggleDock(state, action.terminalFocused)

    case 'resizeDock':
      return {
        ...state,
        dock: { ...state.dock, height: limitarAltura(action.height, action.viewportHeight) },
      }

    case 'openFree':
      return { ...state, side: { ...state.side, open: true, active: action.id }, focus: 'free' }

    case 'toggleSide':
      return { ...state, side: { ...state.side, open: !state.side.open } }

    case 'resizeSide':
      return {
        ...state,
        side: { ...state.side, width: limitarLargura(action.width, action.viewportWidth) },
      }

    case 'freeForgotten':
      return freeForgotten(state, action.id)

    case 'focusConsumed':
      return state.focus === null ? state : { ...state, focus: null }
  }
}

/**
 * O retrato do disco virando estado. Toda aba volta **sem PTY** (`id: null`) e o foco volta a
 * `null`; os tamanhos passam pelos limites do viewport de agora, que pode ser menor que o de quando
 * foram gravados.
 */
function hydrate(snapshot: LayoutSnapshot, viewport: Viewport): MesaState {
  const terminals = snapshot.dock.terminals.map((aba): MesaTab => ({
    ...aba,
    id: null,
    failure: null,
    exitCode: null,
  }))

  return {
    dock: {
      open: snapshot.dock.open && terminals.length > 0,
      height: limitarAltura(snapshot.dock.height, viewport.height),
      terminals,
      active: terminals.some((aba) => aba.key === snapshot.dock.active)
        ? snapshot.dock.active
        : (terminals[0]?.key ?? null),
    },
    side: { ...snapshot.side, width: limitarLargura(snapshot.side.width, viewport.width) },
    lastPreset: snapshot.lastPreset,
    focus: null,
  }
}

function addTerminal(
  state: MesaState,
  key: string,
  preset: string,
  scope: SessionScope | undefined,
): MesaState {
  // O título só chega quando o PTY abre (`terminalOpened`); até lá o perfil é o melhor nome que há.
  const aba: MesaTab = {
    key,
    preset,
    title: preset,
    ...(scope === undefined ? {} : { scope }),
    id: null,
    failure: null,
    exitCode: null,
  }

  return {
    ...state,
    dock: { ...state.dock, open: true, terminals: [...state.dock.terminals, aba], active: key },
    lastPreset: preset,
    focus: 'terminal',
  }
}

/**
 * Fechar a ativa ativa a vizinha da esquerda — ou da direita, se era a primeira. Sem vizinha o dock
 * se esconde e o foco fica com quem estava (`null`: nada a herdar). Fechar uma aba que **não** é a
 * ativa não mexe em ativa nem em foco.
 */
function closeTerminal(state: MesaState, key: string): MesaState {
  const { terminals, active } = state.dock
  const posicao = terminals.findIndex((aba) => aba.key === key)
  if (posicao < 0) return state

  const restantes = terminals.filter((aba) => aba.key !== key)

  if (key !== active) return { ...state, dock: { ...state.dock, terminals: restantes } }

  const vizinha = restantes[Math.max(posicao - 1, 0)]

  if (vizinha === undefined) {
    return {
      ...state,
      dock: { ...state.dock, open: false, terminals: restantes, active: null },
      focus: null,
    }
  }

  return {
    ...state,
    dock: { ...state.dock, terminals: restantes, active: vizinha.key },
    focus: 'terminal',
  }
}

/**
 * A regra do VS Code: fechado → abre e foca; aberto com o terminal focado → esconde e solta o foco;
 * aberto sem o foco nele → só traz o foco. Quem sabe se o terminal está focado é o componente
 * (`document.activeElement` dentro do `.xterm` ativo) — o redutor não lê DOM.
 *
 * Dock sem aba nenhuma não abre: seria uma faixa vazia. Criar a primeira aba é o `new-terminal`, e
 * quem decide isso é o `useMesa`.
 */
function toggleDock(state: MesaState, terminalFocused: boolean): MesaState {
  if (state.dock.terminals.length === 0) return state

  if (!state.dock.open) return { ...state, dock: { ...state.dock, open: true }, focus: 'terminal' }
  if (terminalFocused) return { ...state, dock: { ...state.dock, open: false }, focus: null }

  return { ...state, focus: 'terminal' }
}

/**
 * A sessão livre foi esquecida: a aba que apontava para ela perde o `scope` (o shell continua; a aba
 * passa a ser restaurada na pasta do usuário) e o painel deixa de apontar para um id que já não
 * existe.
 */
function freeForgotten(state: MesaState, id: string): MesaState {
  const terminals = state.dock.terminals.map((aba) => {
    if (aba.scope?.kind !== 'free' || aba.scope.id !== id) return aba

    const resto: MesaTab = { ...aba }
    delete resto.scope

    return resto
  })

  return {
    ...state,
    dock: { ...state.dock, terminals },
    side: state.side.active === id ? { ...state.side, active: null } : state.side,
  }
}

function mudarAba(state: MesaState, key: string, mudar: (aba: MesaTab) => MesaTab): MesaState {
  if (!state.dock.terminals.some((aba) => aba.key === key)) return state

  return {
    ...state,
    dock: {
      ...state.dock,
      terminals: state.dock.terminals.map((aba) => (aba.key === key ? mudar(aba) : aba)),
    },
  }
}

function limitarAltura(altura: number, viewportHeight: number): number {
  return Math.round(
    Math.max(DOCK_HEIGHT_MIN, Math.min(altura, viewportHeight * DOCK_HEIGHT_MAX_RATIO)),
  )
}

function limitarLargura(largura: number, viewportWidth: number): number {
  return Math.round(
    Math.max(SIDE_WIDTH_MIN, Math.min(largura, viewportWidth * SIDE_WIDTH_MAX_RATIO)),
  )
}

/**
 * A aba que o componente deve spawnar agora, ou `null`: a **ativa**, com o dock aberto, que ainda não
 * tem PTY, não falhou e não terminou. É o "só a ativa spawna no boot" da spec — as outras esperam a
 * primeira ativação, porque restaurar cinco shells de uma vez (três deles AWS) seriam cinco prompts
 * disputando o mesmo instante.
 */
export function abaParaSpawnar(state: MesaState): MesaTab | null {
  if (!state.dock.open) return null

  const aba = state.dock.terminals.find((candidata) => candidata.key === state.dock.active)

  return aba !== undefined && aba.id === null && aba.failure === null && aba.exitCode === null
    ? aba
    : null
}

/**
 * O que vai para o `layout.json`. As abas de **triagem** não são gravadas (Decisão 26): a pasta da
 * triagem só existe em memória, e uma aba restaurada dela cairia sempre em `unknown-folder`. A aba
 * some do disco, não da tela.
 */
export function paraLayout(state: MesaState): LayoutSnapshot {
  const terminals = state.dock.terminals
    .filter((aba) => aba.scope?.kind !== 'triage')
    .map(({ key, preset, title, scope }): LayoutTerminal => ({
      key,
      preset,
      title,
      ...(scope === undefined ? {} : { scope }),
    }))

  const ativaGravada = terminals.some((aba) => aba.key === state.dock.active)

  return {
    dock: {
      open: state.dock.open && terminals.length > 0,
      height: state.dock.height,
      terminals,
      active: ativaGravada ? state.dock.active : (terminals[0]?.key ?? null),
    },
    side: state.side,
    lastPreset: state.lastPreset,
  }
}
