/**
 * O lado sujo da marca do modo *dangerously*: o segundo arquivo de estado do app em disco.
 *
 * Espelha `conversations.ts` na **postura** — as duas pontas de IO que o `DangerIndex` recebe
 * injetadas nascem aqui, o registro de IPC e a publicação copiam `registerConversationIpc`, e nada
 * aqui derruba o app. O preço de uma leitura que falha é um cartão que volta **com** portão, que é o
 * lado seguro: perder uma marca devolve o clique, nunca o remove.
 *
 * Mas **não** espelha a forma do JSON, e é aí que uma cópia distraída quebraria tudo — ver a guarda
 * de `interpretar`.
 *
 * **Por que um segundo arquivo e não uma segunda chave no `conversations.json`:** o
 * `ConversationIndex` se declara "o único dado durável do app: `itemId → sessionId`", e a frase é
 * carga viva — é ela que impede aquele arquivo de virar o depósito de tudo. Dois arquivos com
 * versões independentes também deixam um formato evoluir sem invalidar o outro: hoje, uma bump de
 * versão do vínculo apagaria as marcas junto, por nada.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import type { WebContents } from 'electron'

import type { DangerIndex } from '../core'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type { DangerousSnapshot } from '../shared/ipc'
import { escreverAtomico, stateDir } from './state'

/**
 * A versão do formato, gravada desde a primeira linha que este app escreveu — a mesma decisão do
 * `conversations.json`, e pela mesma razão. Versão diferente não migra: é lida como conjunto vazio,
 * e a próxima gravação substitui o arquivo.
 */
const VERSAO = 1

/** O arquivo, dentro do `stateDir()`. O nome é detalhe interno — a porta de ambiente é a pasta. */
const ARQUIVO = 'dangerous.json'

/**
 * Os cartões marcados, prontos para virar o `load` do `DangerIndex`.
 *
 * Arquivo ausente, ilegível, JSON inválido ou versão desconhecida são todos **conjunto vazio, sem
 * erro**: para quem consome, as quatro dizem a mesma coisa — nenhum cartão roda sem portão.
 */
export async function loadDangerous(): Promise<ReadonlySet<string>> {
  let conteudo: string
  try {
    conteudo = await readFile(join(stateDir(), ARQUIVO), 'utf8')
  } catch {
    // Ausente é o estado de uma máquina que abriu o app pela primeira vez — e também o de quem
    // nunca ligou o modo. As duas viram "todo cartão com portão", que é o comportamento de sempre.
    return new Set()
  }

  return interpretar(conteudo)
}

/**
 * A gravação da marca, pronta para virar o `save` do `DangerIndex`.
 *
 * **Atômica** por `escreverAtomico`, que também cria o diretório: um `OC_STATE_DIR` recém-criado
 * pelo smoke pode ainda não existir na primeira escrita.
 *
 * Falha **rejeita**, e é a fila de gravação do `DangerIndex` quem a absorve: `set` é síncrono para
 * quem chama, e aquela fila é o único lugar com como capturá-la.
 */
export async function saveDangerous(itemIds: ReadonlySet<string>): Promise<void> {
  const conteudo = JSON.stringify({ version: VERSAO, cards: [...itemIds] }, null, 2)

  await escreverAtomico(join(stateDir(), ARQUIVO), conteudo)
}

export interface DangerIpc {
  /**
   * Dispara a carga do que está gravado. É o gatilho do boot — o índice tem carona de carga, e o que
   * o disco responder chega à tela pelo `onChange` → `publish`.
   */
  refresh(): void
  /**
   * Empurra o retrato corrente a quem assinou. É o que o `onChange` do índice chama: cada marca
   * ligada ou desligada e o fim da carga do boot passam todos por aqui.
   */
  publish(): void
}

/**
 * Liga o canal dos cartões sem portão ao índice.
 *
 * Cópia estrutural de `registerConversationIpc`, inclusive a limpeza do `WebContents` destruído:
 * este registro vive o app inteiro, e o conjunto de assinantes cresceria a cada janela nova.
 */
export function registerDangerIpc(index: DangerIndex): DangerIpc {
  const subscribers = new Set<WebContents>()

  function retrato(): DangerousSnapshot {
    return { itemIds: index.dangerous() }
  }

  function publish(): void {
    const proximo = retrato()

    for (const sender of subscribers) {
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        continue
      }

      sender.send(IPC_EVENT.dangerous, proximo)
    }
  }

  ipcMain.handle(IPC_INVOKE.readDangerous, (event): DangerousSnapshot => {
    subscribers.add(event.sender)

    // Pode sair vazio: a carga do boot é assíncrona e pode não ter terminado. Quem corrige a tela é
    // o `publish` que o fim dela dispara — e é por isso que o retrato vem inteiro a cada mudança, e
    // não como delta.
    return retrato()
  })

  return {
    refresh(): void {
      void index.refresh()
    },
    publish,
  }
}

/**
 * O conteúdo do arquivo virando conjunto, com guarda em cada degrau.
 *
 * O formato é `{ "version": 1, "cards": ["PVTI_…", …] }` — e **`cards` é array**, não objeto como no
 * `conversations.json`. Logo a guarda **não** pode ser o `asRecord` de lá: aquele devolve `null`
 * para array (`conversations.ts`, `!Array.isArray(value)`), e copiá-lo faria todo arquivo válido ser
 * lido como vazio, sem erro nenhum e sem nada na tela além de um portão que voltou sozinho.
 */
function interpretar(conteudo: string): ReadonlySet<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(conteudo)
  } catch {
    return new Set()
  }

  const raiz = asRecord(parsed)
  if (raiz === null || raiz['version'] !== VERSAO) return new Set()

  const cards = raiz['cards']
  if (!Array.isArray(cards)) return new Set()

  const marcados = new Set<string>()

  for (const itemId of cards) {
    // Entrada torta é pulada sozinha, e não invalida o arquivo inteiro, como lá: uma marca ilegível
    // custa um cartão com portão de volta, e descartar as outras junto custaria todas. Repetido é
    // absorvido pelo `Set`.
    if (typeof itemId === 'string' && itemId !== '') marcados.add(itemId)
  }

  return marcados
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
