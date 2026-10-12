import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import type { FreeSessionCard, SessionScope, TerminalPreset } from '../../shared/ipc'
import { MESA_INICIAL, paraLayout, reduceMesa } from './mesaState'
import type { MesaAction, MesaState } from './mesaState'
import { shortcutFor } from './shortcuts'

/** O perfil da primeira vez, quando ninguém abriu terminal ainda (CA-5). */
const PERFIL_INICIAL = 'powershell'

/** Quanto o arrasto de divisória espera para gravar: um arrasto são dezenas de eventos por segundo. */
const DEBOUNCE_DO_TAMANHO_MS = 300

export interface Mesa {
  state: MesaState
  dispatch: (action: MesaAction) => void
  presets: readonly TerminalPreset[]
  freeSessions: readonly FreeSessionCard[]
  /** Sem `preset`, abre no último perfil usado. */
  newTerminal: (preset?: string) => void
  /** "Terminal aqui": abre no último perfil, na pasta do escopo (#74 §11). */
  openTerminalAt: (scope: SessionScope) => void
  newFree: () => void
  openFree: (id: string) => void
  /** Fecha a aba **e** o PTY dela: a aba some do estado, o shell some do main. */
  closeTab: (key: string) => void
}

/**
 * A mesa viva (#74 §7): o redutor puro, o `layout.json` e o teclado.
 *
 * - **No monte**, `readLayout` → `hydrate`. Nada é gravado antes disso — o estado inicial é vazio, e
 *   gravá-lo apagaria a mesa do disco no instante em que o app abre.
 * - **Persistência**: mudança estrutural (aba, painel, ativo, `lastPreset`, título) grava na hora; só
 *   `height`/`width` esperam 300 ms, porque um arrasto não é uma sequência de decisões. Gravar é
 *   "retrato inteiro, nunca delta", e o main enfileira.
 * - **Teclado**: um `keydown` global em `window` consulta a tabela (`shortcuts.ts`) e despacha.
 *   Antes de abrir o dock guarda `document.activeElement`, para devolvê-lo ao esconder
 *   (`` Ctrl+` `` volta "com o foco onde estava", CA-7).
 *
 * O que fica fora, de propósito: spawnar o PTY. Quem mede o contêiner (`fit()`) é a `TerminalView`,
 * e é ela que chama `openTerminal` com o tamanho certo.
 */
export function useMesa(): Mesa {
  const [state, dispatchBruto] = useReducer(reduceMesa, MESA_INICIAL)
  const [presets, setPresets] = useState<readonly TerminalPreset[]>([])
  const [freeSessions, setFreeSessions] = useState<readonly FreeSessionCard[]>([])

  // O estado mais novo para o `keydown`, que é registrado uma vez só: um fechamento sobre `state`
  // despacharia sempre a partir do retrato do monte.
  const ultimo = useRef(state)
  ultimo.current = state

  const hidratado = useRef(false)
  const gravada = useRef('')
  const estrutura = useRef('')
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focoAnterior = useRef<Element | null>(null)

  const dispatch = useCallback((action: MesaAction): void => {
    dispatchBruto(action)
  }, [])

  // O monte: layout, perfis e sessões livres. Assinar vem antes de pedir, com a guarda `pushed` dos
  // outros efeitos de monte do app — uma lista publicada enquanto a resposta volta é mais nova.
  useEffect(() => {
    let vivo = true
    let pushed = false

    void window.oc.readLayout().then((snapshot) => {
      if (!vivo) return

      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const layout = paraLayout(reduceMesa(MESA_INICIAL, { type: 'hydrate', snapshot, viewport }))

      // O que acabou de ser lido **é** o que está em disco: gravá-lo de volta seria ruído.
      gravada.current = JSON.stringify(layout)
      estrutura.current = chaveEstrutural(layout)
      hidratado.current = true
      dispatchBruto({ type: 'hydrate', snapshot, viewport })
    })

    void window.oc.readTerminalPresets().then((next) => {
      if (vivo) setPresets(next.presets)
    })

    const unsubscribe = window.oc.onFree((next) => {
      pushed = true
      setFreeSessions(next.sessions)
    })

    void window.oc.readFree().then((next) => {
      if (vivo && !pushed) setFreeSessions(next.sessions)
    })

    return () => {
      vivo = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!hidratado.current) return

    const layout = paraLayout(state)
    const completo = JSON.stringify(layout)
    if (completo === gravada.current) return

    function gravar(): void {
      gravada.current = completo
      // Falha de gravação custa a mesa de amanhã, não a de hoje: não vale um erro na tela.
      window.oc.setLayout(layout).catch(() => undefined)
    }

    if (espera.current !== null) clearTimeout(espera.current)
    espera.current = null

    const chave = chaveEstrutural(layout)

    if (chave !== estrutura.current) {
      estrutura.current = chave
      gravar()
    } else {
      espera.current = setTimeout(gravar, DEBOUNCE_DO_TAMANHO_MS)
    }
  }, [state])

  useEffect(
    () => () => {
      if (espera.current !== null) clearTimeout(espera.current)
    },
    [],
  )

  const guardarFoco = useCallback((): void => {
    if (!ultimo.current.dock.open) focoAnterior.current = document.activeElement
  }, [])

  const newTerminal = useCallback(
    (preset?: string): void => {
      guardarFoco()
      dispatchBruto({
        type: 'addTerminal',
        key: crypto.randomUUID(),
        preset: preset ?? ultimo.current.lastPreset ?? PERFIL_INICIAL,
      })
    },
    [guardarFoco],
  )

  const openTerminalAt = useCallback(
    (scope: SessionScope): void => {
      guardarFoco()
      dispatchBruto({
        type: 'addTerminal',
        key: crypto.randomUUID(),
        preset: ultimo.current.lastPreset ?? PERFIL_INICIAL,
        scope,
      })
    },
    [guardarFoco],
  )

  const openFree = useCallback((id: string): void => {
    dispatchBruto({ type: 'openFree', id })
  }, [])

  const newFree = useCallback((): void => {
    void window.oc.createFree().then((result) => {
      // Diálogo cancelado não é erro: `created: false` e a mesa fica como estava.
      if (result.created) dispatchBruto({ type: 'openFree', id: result.id })
    })
  }, [])

  const closeTab = useCallback((key: string): void => {
    const aba = ultimo.current.dock.terminals.find((candidata) => candidata.key === key)
    if (aba?.id != null) void window.oc.closeTerminal({ id: aba.id })

    dispatchBruto({ type: 'closeTerminal', key })
  }, [])

  useEffect(() => {
    function aoApertar(event: KeyboardEvent): void {
      if (!hidratado.current) return

      const comando = shortcutFor(event)
      if (comando === null) return

      // O atalho é da mesa: nem o navegador nem o foco atual devem ver a tecla.
      event.preventDefault()
      event.stopPropagation()

      const { dock } = ultimo.current

      switch (comando) {
        case 'toggle-dock': {
          // Sem aba não há o que mostrar: o atalho vira o "abrir um terminal" que o usuário quer.
          if (dock.terminals.length === 0) return newTerminal()

          const focado = document.activeElement?.closest('.xterm') != null
          const escondendo = dock.open && focado
          if (!dock.open) guardarFoco()

          dispatchBruto({ type: 'toggleDock', terminalFocused: focado })
          if (escondendo && focoAnterior.current instanceof HTMLElement)
            focoAnterior.current.focus()

          return
        }
        case 'new-terminal':
          return newTerminal()
        case 'new-free':
          return newFree()
        case 'toggle-side':
          return dispatchBruto({ type: 'toggleSide' })
        case 'close-terminal':
          if (dock.open && dock.active !== null) closeTab(dock.active)

          return
        case 'prev-terminal':
        case 'next-terminal': {
          if (!dock.open || dock.terminals.length === 0) return

          const atual = dock.terminals.findIndex((aba) => aba.key === dock.active)
          const passo = comando === 'next-terminal' ? 1 : -1
          const proxima =
            dock.terminals[(atual + passo + dock.terminals.length) % dock.terminals.length]

          if (proxima !== undefined) dispatchBruto({ type: 'activateTerminal', key: proxima.key })

          return
        }
      }
    }

    window.addEventListener('keydown', aoApertar)

    return () => {
      window.removeEventListener('keydown', aoApertar)
    }
  }, [closeTab, guardarFoco, newFree, newTerminal])

  return {
    state,
    dispatch,
    presets,
    freeSessions,
    newTerminal,
    openTerminalAt,
    newFree,
    openFree,
    closeTab,
  }
}

/** O layout sem os tamanhos: o que muda aqui é decisão, e grava na hora. */
function chaveEstrutural(layout: ReturnType<typeof paraLayout>): string {
  return JSON.stringify({
    ...layout,
    dock: { ...layout.dock, height: 0 },
    side: { ...layout.side, width: 0 },
  })
}
