/**
 * O lado sujo da retomada: o arquivo de estado do app em disco e as duas leituras de transcript do
 * SDK.
 *
 * As quatro pontas de IO que o `ConversationIndex` recebe injetadas nascem aqui, pelo mesmo motivo
 * que as do `RepoIndex` nascem em `repos.ts` — o core não conhece disco nem SDK, e é isso que
 * mantém a regra do vínculo testável sem uma máquina de verdade por perto. O registro de IPC e a
 * publicação espelham `board.ts`, inclusive a limpeza do `WebContents` destruído.
 *
 * **Tolerante por princípio**, como a varredura de repos: nada aqui derruba o app. O preço de uma
 * leitura que falha é um cartão que volta sem sinal de conversa — que é o CA-3, um estado previsto
 * e inofensivo. Derrubar o board por causa de um arquivo de estado seria trocar um cartão por
 * todos.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getSessionInfo, getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { ipcMain } from 'electron'
import type { WebContents } from 'electron'

import type { ConversationIndex, TranscriptEntry } from '../core'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type { ConversationsSnapshot } from '../shared/ipc'
import { escreverAtomico, stateDir } from './state'

/**
 * A versão do formato, gravada desde a primeira linha que este app escreveu.
 *
 * Acrescentá-la depois exigiria adivinhar a forma do que já estivesse em disco. Versão diferente
 * não migra: é lida como mapa vazio, e a próxima gravação substitui o arquivo.
 */
const VERSAO = 1

/** O arquivo, dentro do `stateDir()`. O nome é detalhe interno — a porta de ambiente é a pasta. */
const ARQUIVO = 'conversations.json'

/**
 * O vínculo gravado, pronto para virar o `load` do `ConversationIndex`.
 *
 * Arquivo ausente, ilegível, JSON inválido ou versão desconhecida são todos **mapa vazio, sem
 * erro**: para quem consome, as quatro dizem a mesma coisa — não há vínculo a honrar.
 */
export async function loadConversations(): Promise<ReadonlyMap<string, string>> {
  let conteudo: string
  try {
    conteudo = await readFile(join(stateDir(), ARQUIVO), 'utf8')
  } catch {
    // Ausente é o estado de uma máquina que abriu o app pela primeira vez, e é indistinguível de um
    // arquivo sem permissão de leitura: as duas viram "nenhum cartão tem conversa a retomar".
    return new Map()
  }

  return interpretar(conteudo)
}

/**
 * A gravação do vínculo, pronta para virar o `save` do `ConversationIndex`.
 *
 * **Atômica** — ver `escreverAtomico`, que é de onde a garantia vem: sem ela, um desligamento no
 * meio da escrita deixaria um JSON truncado, que a leitura tolerante trataria como vazio, perdendo
 * **todos** os vínculos de uma vez.
 *
 * Falha aqui **rejeita**, e é o `ConversationIndex` quem a absorve: `remember` e `forget` são
 * síncronos para quem chama, e a fila de gravação de lá é o único lugar com como capturá-la.
 */
export async function saveConversations(entries: ReadonlyMap<string, string>): Promise<void> {
  const conteudo = JSON.stringify({ version: VERSAO, cards: Object.fromEntries(entries) }, null, 2)

  await escreverAtomico(join(stateDir(), ARQUIVO), conteudo)
}

/**
 * O portão do CA-3, pronto para virar o `inspect` do `ConversationIndex`.
 *
 * **Sem `dir`**: foi medido que passá-lo faz a busca falhar nesta plataforma — é uma otimização que
 * troca velocidade por resultado errado. As duas metades do CA-3 cabem aqui: o transcript sumiu
 * (`undefined`) e a pasta em que a sessão rodou sumiu (`existsSync`).
 *
 * Vale registrar: `getSessionInfo` também devolve `undefined` para sessão sem resumo extraível — ou
 * seja, sessão que subiu e em que ninguém falou. Isso é **exatamente** o "nunca conversou" do CA-3,
 * de graça.
 */
export async function inspectSession(sessionId: string): Promise<{ cwd: string } | null> {
  let info
  try {
    info = await getSessionInfo(sessionId)
  } catch {
    return null
  }

  const cwd = info?.cwd
  if (cwd === undefined || cwd === '') return null

  return existsSync(cwd) ? { cwd } : null
}

/**
 * As entradas cruas do transcript, prontas para virar o `transcript` do `ConversationIndex`. A
 * tradução para `ChatMessage` é regra do core e roda lá dentro.
 *
 * **Sem `dir`** pelo mesmo motivo do `inspectSession`, e sem `includeSystemMessages`: foi medido
 * que ele não muda nada aqui e só traria ruído. Sem `limit`/`offset` porque o histórico atravessa a
 * ponte inteiro — a maior conversa medida nesta máquina rende 119 mensagens.
 */
export async function readTranscript(sessionId: string): Promise<readonly TranscriptEntry[]> {
  try {
    return await getSessionMessages(sessionId)
  } catch {
    // Histórico vazio ainda retoma: o portão de "há o que retomar" é o `inspect`, e é um só.
    return []
  }
}

export interface ConversationIpc {
  /**
   * Dispara a verificação do que está gravado. É o gatilho do boot — o índice tem guarda de
   * concorrência, e o que a verificação descobrir chega à tela pelo `onChange` → `publish`.
   */
  refresh(): void
  /**
   * Empurra o retrato corrente a quem assinou. É o que o `onChange` do índice chama: sessão que
   * nasce, sessão encerrada e o fim da verificação do boot passam todos por aqui.
   */
  publish(): void
}

/**
 * Liga o canal das conversas recuperáveis ao índice.
 *
 * Espelha `registerBoardIpc` — guarda o conjunto de assinantes e devolve ao main as alças de que o
 * ciclo de vida precisa. Não há throttle nem leitura em voo para proteger: o retrato sai de um mapa
 * em memória, e é por isso que este canal não pega carona no do board.
 */
export function registerConversationIpc(index: ConversationIndex): ConversationIpc {
  const subscribers = new Set<WebContents>()

  function retrato(): ConversationsSnapshot {
    return { itemIds: index.recoverable() }
  }

  function publish(): void {
    const proximo = retrato()

    for (const sender of subscribers) {
      // Destruído é **removido**, como no `registerBoardIpc` e pelo mesmo motivo: este registro vive
      // o app inteiro, e o conjunto cresceria a cada janela nova.
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        continue
      }

      sender.send(IPC_EVENT.conversations, proximo)
    }
  }

  ipcMain.handle(IPC_INVOKE.readConversations, (event): ConversationsSnapshot => {
    subscribers.add(event.sender)

    // Pode sair vazio: a verificação do boot é assíncrona e pode não ter terminado. Quem corrige a
    // tela é o `publish` que o fim dela dispara — e é por isso que o retrato vem inteiro a cada
    // mudança, e não como delta.
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
 * O conteúdo do arquivo virando mapa, com guarda em cada degrau.
 *
 * Dado de fora chega como `unknown` e passa por guarda explícita, como o `cwdOf` de `repos.ts`: o
 * arquivo é do app, mas quem escreveu foi outra execução — e talvez outra versão.
 */
function interpretar(conteudo: string): ReadonlyMap<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(conteudo)
  } catch {
    return new Map()
  }

  const raiz = asRecord(parsed)
  if (raiz === null || raiz['version'] !== VERSAO) return new Map()

  const cards = asRecord(raiz['cards'])
  if (cards === null) return new Map()

  const vinculos = new Map<string, string>()

  for (const [itemId, sessionId] of Object.entries(cards)) {
    // Entrada torta é pulada sozinha, e não invalida o arquivo inteiro: um vínculo ilegível custa um
    // cartão sem sinal, e descartar os outros junto custaria todos.
    if (itemId !== '' && typeof sessionId === 'string' && sessionId !== '') {
      vinculos.set(itemId, sessionId)
    }
  }

  return vinculos
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
