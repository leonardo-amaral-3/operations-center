/**
 * O lado sujo da mesa (#74 §6): o arquivo `layout.json` e o canal `layout:*`.
 *
 * Num arquivo **próprio** e não no `preferences.json` (Decisão 10): o layout muda a cada arrasto de
 * divisória, e a preferência é gravada uma vez por escolha — misturar os dois faria cada arrasto
 * reescrever o tema e o board ativo.
 *
 * O main só persiste: o renderer é o dono do estado (`mesaState.ts`) e debounça o que arrasta. Por
 * isso não há evento `layout:changed` — a janela é uma só, e ninguém mais escreve o arquivo.
 *
 * Leitura tolerante, como `interpretar` de `preferences.ts`: arquivo ilegível, torto ou de versão
 * desconhecida é o layout default, e o preço é uma mesa fechada, não um app que não abre.
 */

import { ipcMain } from 'electron'

import { IPC_INVOKE } from '../shared/ipc'
import type {
  LayoutDock,
  LayoutSide,
  LayoutSnapshot,
  LayoutTerminal,
  SessionScope,
} from '../shared/ipc'
import { readState, writeState } from './store'

/** Versão desconhecida não migra: é lida como o default, como em `preferences.ts`. */
const VERSAO = 1

const ARQUIVO = 'layout.json'

/** A mesa de quem nunca abriu nada — também o que sobra quando o arquivo não presta. */
export const LAYOUT_PADRAO: LayoutSnapshot = {
  dock: { open: false, height: 280, terminals: [], active: null },
  side: { open: false, width: 480, active: null },
  lastPreset: null,
}

/** O que estava gravado, ou o default. Nunca rejeita. */
export async function loadLayout(): Promise<LayoutSnapshot> {
  return interpretar(await readState(ARQUIVO))
}

/**
 * A fila das gravações: uma promessa encadeada, como `#gravando` em `ConversationIndex.ts:65`. O
 * `.tmp` do `writeState` tem nome fixo (`store.ts:91-98`), então duas gravações em voo brigariam
 * pelo mesmo `rename` — e o vencedor seria o que o sistema de arquivos decidisse.
 */
let gravando: Promise<void> = Promise.resolve()

/**
 * Grava o retrato inteiro, depois de todas as gravações já pedidas. Falha rejeita para quem pediu
 * (o `layout:set` do renderer, que não espera nada dele), mas **não** envenena a fila: a próxima
 * gravação segue.
 */
export function saveLayout(snapshot: LayoutSnapshot): Promise<void> {
  const esta = gravando.then(() => writeState(ARQUIVO, { version: VERSAO, ...snapshot }))
  gravando = esta.catch(() => undefined)

  return esta
}

/** Liga o canal `layout:*`. Registro incondicional: nenhum handler spawna nem toca o board. */
export function registerLayoutIpc(): void {
  ipcMain.handle(IPC_INVOKE.readLayout, (): Promise<LayoutSnapshot> => loadLayout())

  ipcMain.handle(IPC_INVOKE.setLayout, (_event, snapshot: LayoutSnapshot): Promise<void> =>
    saveLayout(snapshot),
  )
}

/**
 * O conteúdo do arquivo virando retrato, com guarda em cada degrau.
 *
 * A versão é o único degrau que derruba tudo. Abaixo dela cada campo se guarda sozinho, e uma aba
 * torta custa uma aba — não a mesa inteira.
 */
function interpretar(parsed: unknown): LayoutSnapshot {
  const raiz = asRecord(parsed)
  if (raiz === null || raiz['version'] !== VERSAO) return LAYOUT_PADRAO

  const lastPreset = raiz['lastPreset']

  return {
    dock: interpretarDock(asRecord(raiz['dock'])),
    side: interpretarSide(asRecord(raiz['side'])),
    lastPreset: typeof lastPreset === 'string' && lastPreset !== '' ? lastPreset : null,
  }
}

function interpretarDock(dock: Record<string, unknown> | null): LayoutDock {
  const padrao = LAYOUT_PADRAO.dock
  if (dock === null) return padrao

  const terminals: LayoutTerminal[] = []
  const chaves = new Set<string>()

  for (const crua of Array.isArray(dock['terminals']) ? (dock['terminals'] as unknown[]) : []) {
    const aba = asRecord(crua)
    if (aba === null) continue

    const { key, preset, title } = aba
    // `key` repetida seria duas abas endereçadas pelo mesmo nome: a segunda é a torta.
    if (typeof key !== 'string' || key === '' || chaves.has(key)) continue
    if (typeof preset !== 'string' || preset === '') continue

    const scope = interpretarEscopo(aba['scope'])
    chaves.add(key)
    terminals.push({
      key,
      preset,
      title: typeof title === 'string' && title.trim() !== '' ? title : preset,
      ...(scope === null ? {} : { scope }),
    })
  }

  const ativa = dock['active']

  return {
    open: dock['open'] === true && terminals.length > 0,
    height: numero(dock['height'], padrao.height),
    terminals,
    // Uma ativa que não está entre as abas apontaria para o nada: cai na primeira.
    active: typeof ativa === 'string' && chaves.has(ativa) ? ativa : (terminals[0]?.key ?? null),
  }
}

function interpretarSide(side: Record<string, unknown> | null): LayoutSide {
  const padrao = LAYOUT_PADRAO.side
  if (side === null) return padrao

  const ativa = side['active']

  return {
    open: side['open'] === true,
    width: numero(side['width'], padrao.width),
    active: typeof ativa === 'string' && ativa !== '' ? ativa : null,
  }
}

/**
 * Só `card` e `free` voltam. A triagem não é gravada (Decisão 26: a pasta dela é só memória) — se
 * uma aparecer no arquivo, veio de outra mão, e restaurá-la cairia sempre em `unknown-folder`.
 */
function interpretarEscopo(valor: unknown): SessionScope | null {
  const escopo = asRecord(valor)
  if (escopo === null) return null

  if (
    escopo['kind'] === 'card' &&
    typeof escopo['itemId'] === 'string' &&
    escopo['itemId'] !== ''
  ) {
    return { kind: 'card', itemId: escopo['itemId'] }
  }

  if (escopo['kind'] === 'free' && typeof escopo['id'] === 'string' && escopo['id'] !== '') {
    return { kind: 'free', id: escopo['id'] }
  }

  return null
}

function numero(valor: unknown, padrao: number): number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : padrao
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
