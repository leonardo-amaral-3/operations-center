import type { ChatMessage } from './types'
import { replay } from './transcript'
import type { TranscriptEntry } from './transcript'

/**
 * O **único dado durável do app**: `itemId → sessionId`.
 *
 * Todo o resto — onde a sessão rodou, o que foi dito, se ainda existe — é lido do próprio Claude
 * Code, que já é o dono desses fatos. É a mesma postura do `RepoIndex`: o app guarda só o que
 * ninguém mais teria como saber. O vínculo entre um cartão do board e uma conversa do Claude Code é
 * exatamente isso, e é por isso que ele cabe num mapa de duas colunas.
 *
 * Core: as quatro pontas de IO chegam injetadas, como o `scan`/`origin` do `RepoIndex` e o `query`
 * do `SessionHost`. Quem lê disco e chama o SDK é `src/main/conversations.ts`. A tradução do
 * transcript, porém, roda **aqui dentro**: decidir o que é uma conversa é regra de produto, e não
 * de casca.
 */

/** O que uma conversa recuperável entrega para ser retomada. */
export interface Restoration {
  /** O `session_id` do Claude Code — o que vai em `query({ resume })`. */
  sessionId: string
  /** A pasta em que a sessão **de fato rodou**, lida do transcript. Não é palpite. */
  cwd: string
  /** A conversa de antes, já traduzida. */
  history: readonly ChatMessage[]
}

export interface ConversationIndexDeps {
  /** O vínculo gravado, `itemId → sessionId`. Arquivo ausente ou ilegível é mapa vazio. */
  load: () => Promise<ReadonlyMap<string, string>>
  save: (entries: ReadonlyMap<string, string>) => Promise<void>
  /**
   * Onde aquela sessão rodou, ou `null` quando não há o que retomar — transcript inexistente, ou a
   * pasta dele já não existe no disco. É **o único portão** do CA-3.
   */
  inspect: (sessionId: string) => Promise<{ cwd: string } | null>
  /** As entradas cruas do transcript. A tradução é regra do core, e roda aqui dentro. */
  transcript: (sessionId: string) => Promise<readonly TranscriptEntry[]>
  /** Chamado a cada mudança do conjunto recuperável. Quem publica pela ponte é o main. */
  onChange?: () => void
}

export class ConversationIndex {
  readonly #load: ConversationIndexDeps['load']
  readonly #save: ConversationIndexDeps['save']
  readonly #inspect: ConversationIndexDeps['inspect']
  readonly #transcript: ConversationIndexDeps['transcript']
  readonly #onChange: ConversationIndexDeps['onChange']

  /** O vínculo, já verificado. É daqui que `recoverable()` responde — nunca do arquivo cru. */
  readonly #cards = new Map<string, string>()

  /** A verificação em voo, se houver. */
  #carregando: Promise<void> | null = null

  /** Se o mapa em memória já reflete o que estava gravado. */
  #carregado = false

  /**
   * A fila das gravações. Uma promessa encadeada, e não `void this.#save(...)` solto: duas sessões
   * nascendo juntas escreveriam o mesmo arquivo ao mesmo tempo, e o vencedor seria o que o
   * sistema de arquivos decidisse.
   */
  #gravando: Promise<void> = Promise.resolve()

  constructor(deps: ConversationIndexDeps) {
    this.#load = deps.load
    this.#save = deps.save
    this.#inspect = deps.inspect
    this.#transcript = deps.transcript
    this.#onChange = deps.onChange
  }

  /**
   * Verifica tudo que está gravado e descarta o que não é mais recuperável. Roda no boot.
   *
   * Gatilho que chega com verificação em voo pega carona nela, como o `RepoIndex.refresh()` — e
   * aqui a carona é mais do que economia: é o que faz `restore` nunca ler um mapa pela metade.
   */
  async refresh(): Promise<void> {
    this.#carregando ??= this.#verify().finally(() => {
      this.#carregando = null
    })

    return this.#carregando
  }

  /**
   * Os cartões com conversa recuperável. É o insumo do sinal do CA-1.
   *
   * Lido do mapa **já verificado**, nunca do arquivo cru: antes de a verificação do boot terminar
   * ele responde vazio, e é o `onChange` que corrige a tela quando ela termina.
   */
  recoverable(): readonly string[] {
    return [...this.#cards.keys()]
  }

  /**
   * O que aquele cartão tem a retomar, ou `null`.
   *
   * **Espera a carga terminar, e a inicia se ninguém a iniciou.** Sem isso existe uma corrida que
   * perde conversa: um clique nos primeiros milissegundos depois da abertura chegaria com o mapa
   * ainda vazio, a resposta seria `null`, uma sessão nova nasceria e o `remember` sobrescreveria o
   * vínculo antigo — a conversa de antes ficaria órfã, sem nenhum sinal de que existiu.
   */
  async restore(itemId: string): Promise<Restoration | null> {
    if (!this.#carregado) await this.refresh()

    const sessionId = this.#cards.get(itemId)
    if (sessionId === undefined) return null

    // O portão é um só. Transcript vazio com `inspect` positivo ainda retoma: o id é válido e
    // retomar é inofensivo. Um segundo portão ("tem mensagem?") criaria uma segunda definição de
    // "recuperável", e as duas divergiriam.
    const info = await this.#inspected(sessionId)
    if (info === null) {
      // Acabou de ficar provado que não há o que retomar; deixar o vínculo no mapa faria o sinal do
      // CA-1 mentir até o próximo boot.
      this.#drop(itemId, sessionId)
      return null
    }

    return {
      sessionId,
      cwd: info.cwd,
      history: replay(await this.#entries(sessionId)),
    }
  }

  /**
   * O vínculo nasce aqui, com o `session_id` que o `init` reportou.
   *
   * Chamado a cada `init` e **sempre sobrescrevendo**, que é o que torna o registro auto-corretivo:
   * foi medido que `resume` mantém o mesmo id, mas se um dia o SDK devolver outro (um fork
   * implícito, uma versão futura), o registro segue o que o SDK **disse**, e não o que a spec supôs.
   * Um id gravado que deixasse de ser o do transcript vivo perderia todos os turnos seguintes, em
   * silêncio.
   *
   * Síncrono para quem chama: mexe no mapa, avisa, e agenda a gravação.
   */
  remember(itemId: string, sessionId: string): void {
    // Repetir o mesmo vínculo não é mudança — e é o caso comum, porque o `resume` reporta o mesmo
    // id a cada turno retomado. Gravar e publicar de novo diria "mudou" para quem confia no aviso.
    if (this.#cards.get(itemId) === sessionId) return

    this.#cards.set(itemId, sessionId)
    this.#changed()
  }

  /** O CA-4: encerrar é definitivo. */
  forget(itemId: string): void {
    if (!this.#cards.delete(itemId)) return

    this.#changed()
  }

  /**
   * A verificação: o que estava gravado passa pelo `inspect` **antes** de entrar no mapa.
   *
   * Verificar antes de admitir, e não admitir para podar depois, é o que faz `recoverable()` ser
   * lido do mapa já verificado e nunca do arquivo cru: entre a leitura e a poda haveria uma janela
   * em que o sinal do cartão sairia do que está em disco, sem ninguém ter confirmado que aquela
   * conversa ainda existe.
   */
  async #verify(): Promise<void> {
    const gravado = await this.#stored()

    const verificados = await Promise.all(
      [...gravado].map(async ([itemId, sessionId]) => ({
        itemId,
        sessionId,
        vivo: (await this.#inspected(sessionId)) !== null,
      })),
    )

    let mudou = false
    let podou = false

    for (const { itemId, sessionId, vivo } of verificados) {
      // O que não é mais recuperável simplesmente não entra — e é a ausência dele no mapa que faz
      // a próxima gravação limpá-lo do arquivo.
      if (!vivo) {
        podou = true
        continue
      }

      // O que já está em memória vence o disco: veio de um `init` desta execução, e é mais novo do
      // que o arquivo que estava lá quando o app abriu.
      if (this.#cards.has(itemId)) continue

      this.#cards.set(itemId, sessionId)
      mudou = true
    }

    this.#carregado = true

    // O arquivo só é regravado se a verificação descartou algo — ler o disco e devolvê-lo igual
    // seria uma escrita a cada abertura do app, sem nada a registrar.
    if (podou) this.#persist()
    if (mudou) this.#onChange?.()
  }

  /** Tira o vínculo do mapa, avisa e regrava. */
  #drop(itemId: string, sessionId: string): void {
    if (this.#cards.get(itemId) !== sessionId) return

    this.#cards.delete(itemId)
    this.#changed()
  }

  #changed(): void {
    this.#onChange?.()
    this.#persist()
  }

  /**
   * Enfileira a gravação do mapa como ele estiver quando chegar a vez — sempre a verdade mais
   * recente, nunca um retrato velho que desfaria a mudança seguinte.
   */
  #persist(): void {
    // O `catch` fecha cada elo: uma gravação que falhou não pode deixar a fila rejeitada e levar
    // junto todas as seguintes. E ninguém tem como capturar a falha lá fora — `remember` e `forget`
    // são síncronos para quem chama, e a gravação acontece depois de eles retornarem. O preço de
    // não conseguir gravar é um cartão que volta sem sinal, que é o CA-3: um estado previsto.
    // Derrubar o processo por causa dele seria trocar um cartão por todos.
    this.#gravando = this.#gravando
      .then(() => this.#save(new Map(this.#cards)))
      .catch(() => undefined)
  }

  /** O que está gravado. Ponta que falha é indistinguível de arquivo ausente: mapa vazio. */
  async #stored(): Promise<ReadonlyMap<string, string>> {
    try {
      return await this.#load()
    } catch {
      return new Map()
    }
  }

  /**
   * O portão do CA-3. Uma ponta que rejeita **não** disse "sim", e o que não se consegue verificar
   * não pode ser anunciado como recuperável: vale o mesmo que `null`.
   */
  async #inspected(sessionId: string): Promise<{ cwd: string } | null> {
    try {
      return await this.#inspect(sessionId)
    } catch {
      return null
    }
  }

  /** As entradas do transcript. Sem elas o histórico volta vazio, e a retomada continua de pé. */
  async #entries(sessionId: string): Promise<readonly TranscriptEntry[]> {
    try {
      return await this.#transcript(sessionId)
    } catch {
      return []
    }
  }
}
