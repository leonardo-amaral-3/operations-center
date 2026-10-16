import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

import type { ClaudeScope, OpenClaudeResult } from '../../shared/claude'
import { scopeKey } from '../../shared/ipc'
import { createXterm, followTheme, wireClipboardAndKeys } from './xtermSetup'

/**
 * O registro de instâncias xterm do terminal Claude (#97 §9). Uma instância por escopo, viva
 * enquanto o escopo viver: recolher o cartão ou fechar o painel só **desmonta** (`detach`), e a
 * conversa que estava na tela volta inteira no `attach` seguinte (CA R2.1). Quem destrói é o
 * `end`, ou o main avisando `closed` para uma entrada que ninguém está olhando.
 *
 * É um módulo singleton e não estado de componente de propósito: o `Terminal` do xterm guarda o
 * scrollback, e um componente que remontasse perderia a conversa.
 */

interface Entry {
  term: Terminal
  fit: FitAddon
  /** O elemento que o xterm ocupa; é ele que muda de contêiner entre `attach` e `detach`. */
  wrapper: HTMLDivElement
  /** Onde o `wrapper` está montado agora, ou `null` com a entrada desmontada. */
  container: HTMLElement | null
  id: string | null
  exited: boolean
  opening: Promise<OpenClaudeResult> | null
  /** O último resultado de abertura com `ok:true`. */
  last: OpenClaudeResult | null
  cleanups: Array<() => void>
}

const PENDENTE_MS = 5_000

const entries = new Map<string, Entry>()
/** Saída que chegou antes da resposta do `openClaude`, por `id`. Só existe com abertura em voo. */
const pendentes = new Map<string, string[]>()
let assinado = false

function porId(id: string): Entry | undefined {
  for (const entry of entries.values()) {
    if (entry.id === id) return entry
  }

  return undefined
}

function haAberturaEmVoo(): boolean {
  for (const entry of entries.values()) {
    if (entry.opening !== null) return true
  }

  return false
}

function destruir(key: string, entry: Entry): void {
  for (const limpar of entry.cleanups) limpar()
  entry.term.dispose()
  entry.wrapper.remove()
  entries.delete(key)
}

/** O main passou o terminal a outra janela: destrói a instância local sem encerrar o processo. */
function soltar(key: string): void {
  const entry = entries.get(key)
  if (entry !== undefined) destruir(key, entry)
}

/** As assinaturas globais, feitas uma vez: o registro inteiro fala com o main por elas. */
function assinar(): void {
  if (assinado) return
  assinado = true

  window.oc.onTerminalData((event) => {
    const entry = porId(event.id)
    if (entry !== undefined) {
      entry.term.write(event.data)

      return
    }

    // Id desconhecido: ou é uma aba do dock, ou é saída que ganhou da resposta do `invoke`. Só o
    // segundo caso merece guarda, e ele só existe com uma abertura em voo.
    if (!haAberturaEmVoo()) return

    const fila = pendentes.get(event.id)
    if (fila !== undefined) {
      fila.push(event.data)

      return
    }

    pendentes.set(event.id, [event.data])
    setTimeout(() => pendentes.delete(event.id), PENDENTE_MS)
  })

  window.oc.onTerminalExit((event) => {
    const entry = porId(event.id)
    if (entry === undefined) return

    entry.exited = true
    entry.id = null
    entry.term.write('\r\n[A sessão terminou. Enter retoma.]\r\n')
  })

  window.oc.onClaudeState((event) => {
    if (event.state.kind !== 'closed') return

    // `free:forget`, ou um card cujo processo saiu com o cartão recolhido: ninguém está olhando,
    // então a instância não tem mais razão de existir. A próxima `attach` abre do zero.
    const key = scopeKey(event.scope)
    const entry = entries.get(key)
    if (entry !== undefined && entry.container === null) destruir(key, entry)
  })

  window.oc.onClaudeReleased((event) => soltar(scopeKey(event.scope)))
}

function reopen(scope: ClaudeScope, key: string, entry: Entry): Promise<OpenClaudeResult> {
  try {
    entry.fit.fit()
  } catch {
    // Contêiner sem tamanho medível: o xterm abre no que tem, e o `onResize` corrige depois.
  }

  const opening = window.oc
    .openClaude({ scope, cols: entry.term.cols, rows: entry.term.rows })
    .then((result) => {
      entry.opening = null

      // Destruída com a abertura em voo (`end`): o processo que nasceu é do `closeClaude`.
      if (entries.get(key) !== entry) return result

      if (!result.ok) {
        destruir(key, entry)

        return result
      }

      entry.id = result.id
      entry.last = result
      entry.exited = false

      // Terminal adotado de outra janela: a tela vem serializada. O `reset` desfaz o que o `fit` do
      // `attach` desenhou, o `resize` iguala a grade antes do `write` (que é assíncrono).
      const { snapshot } = result
      if (snapshot !== undefined) {
        entry.term.reset()
        entry.term.resize(snapshot.cols, snapshot.rows)
        entry.term.write(snapshot.data)
      }

      const fila = pendentes.get(result.id)
      if (fila !== undefined) {
        pendentes.delete(result.id)
        for (const dado of fila) entry.term.write(dado)
      }

      // O `fit` só depois do último `write`: antes disso leria o snapshot na largura errada.
      if (snapshot !== undefined) {
        entry.term.write('', () => {
          try {
            entry.fit.fit()
          } catch {
            // Contêiner sem tamanho medível: o `ResizeObserver` do componente refaz.
          }
        })
      }

      return result
    })

  entry.opening = opening

  return opening
}

function create(scope: ClaudeScope, key: string): Entry {
  const { term, fit } = createXterm()
  const wrapper = document.createElement('div')
  wrapper.className = 'h-full w-full'
  term.open(wrapper)

  const entry: Entry = {
    term,
    fit,
    wrapper,
    container: null,
    id: null,
    exited: false,
    opening: null,
    last: null,
    cleanups: [],
  }

  entry.cleanups.push(wireClipboardAndKeys(term, wrapper), followTheme(term))

  const aoDigitar = term.onData((data) => {
    if (entry.exited && data === '\r') {
      void reopen(scope, key, entry)

      return
    }

    if (entry.id !== null) void window.oc.writeTerminal({ id: entry.id, data })
  })
  const aoRedimensionar = term.onResize(({ cols, rows }) => {
    if (entry.id !== null) void window.oc.resizeTerminal({ id: entry.id, cols, rows })
  })
  entry.cleanups.push(
    () => aoDigitar.dispose(),
    () => aoRedimensionar.dispose(),
  )

  entries.set(key, entry)

  return entry
}

/**
 * Monta a instância do escopo no contêiner, criando-a (e abrindo o processo) se for a primeira vez.
 * Chamadas repetidas reusam a mesma instância e, com abertura em voo, a mesma promessa.
 */
export function attach(scope: ClaudeScope, container: HTMLElement): Promise<OpenClaudeResult> {
  assinar()

  const key = scopeKey(scope)
  const entry = entries.get(key) ?? create(scope, key)

  container.appendChild(entry.wrapper)
  entry.container = container
  try {
    entry.fit.fit()
  } catch {
    // Escondido ou sem tamanho: o `ResizeObserver` do componente refaz quando aparecer.
  }

  if (entry.opening !== null) return entry.opening
  if (entry.id !== null && entry.last !== null) return Promise.resolve(entry.last)
  // Encerrado: o aviso de Enter já está na tela, e quem decide reabrir é a pessoa.
  if (entry.exited && entry.last !== null) return Promise.resolve(entry.last)

  return reopen(scope, key, entry)
}

/** Tira a instância da tela sem destruí-la: o processo e o scrollback seguem. */
export function detach(scope: ClaudeScope): void {
  const entry = entries.get(scopeKey(scope))
  if (entry === undefined) return

  if (entry.container?.contains(entry.wrapper)) entry.container.removeChild(entry.wrapper)
  entry.container = null
}

/** Encerra o processo e destrói a instância. Quem chama espera antes de um novo `attach`. */
export async function end(scope: ClaudeScope): Promise<void> {
  const key = scopeKey(scope)

  await window.oc.closeClaude({ scope })

  const entry = entries.get(key)
  if (entry !== undefined) destruir(key, entry)
}

export function focus(scope: ClaudeScope): void {
  entries.get(scopeKey(scope))?.term.focus()
}

/** Reajusta o xterm do escopo ao contêiner em que está; o `ResizeObserver` do componente chama. */
export function fit(scope: ClaudeScope): void {
  try {
    entries.get(scopeKey(scope))?.fit.fit()
  } catch {
    // Contêiner escondido ou sem tamanho: a próxima medição corrige.
  }
}
