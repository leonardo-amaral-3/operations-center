import type { FreeSessionCard } from '../../shared/ipc'
import type { Restoration } from './ConversationIndex'
import { replay } from './transcript'
import type { TranscriptEntry } from './transcript'

/**
 * As sessões livres (#74 §4): conversa com o Claude Code **sem card**, numa pasta que o humano
 * escolheu.
 *
 * Irmão do `ConversationIndex` (`ConversationIndex.ts:5-11`), com uma diferença que explica o
 * desenho: lá o vínculo é `itemId → sessionId` e a pasta se lê do transcript; aqui a entrada
 * **nasce antes** de qualquer conversa. Uma sessão criada e ainda não falada não tem transcript de
 * onde reler a pasta, e perdê-la ao reabrir seria perder a sessão — por isso o `cwd` e o título
 * ficam em disco junto do `sessionId`.
 *
 * Core: as quatro pontas de IO chegam injetadas, as mesmas do `ConversationIndex`. A tradução do
 * transcript roda aqui dentro, pela mesma razão de lá.
 */

/** A entrada como mora em disco (`free-sessions.json`). A ordem do array é a ordem do painel. */
export interface FreeEntry {
  id: string
  title: string
  cwd: string
  /** O `session_id` do Claude Code, ou `null` enquanto não há conversa a retomar. */
  sessionId: string | null
  dangerous: boolean
  createdAt: string
}

export interface FreeIndexDeps {
  /** O que estava gravado. Arquivo ausente ou ilegível é lista vazia. */
  load: () => Promise<readonly FreeEntry[]>
  save: (entries: readonly FreeEntry[]) => Promise<void>
  /** Onde aquela sessão rodou, ou `null` quando não há o que retomar. É o mesmo portão do cartão. */
  inspect: (sessionId: string) => Promise<{ cwd: string } | null>
  transcript: (sessionId: string) => Promise<readonly TranscriptEntry[]>
  /** Chamado a cada mudança do retrato. Quem publica pela ponte é o main. */
  onChange?: () => void
  /** Injetáveis só para o teste: o id e o relógio de uma entrada nova. */
  newId?: () => string
  now?: () => Date
}

export class FreeIndex {
  readonly #load: FreeIndexDeps['load']
  readonly #save: FreeIndexDeps['save']
  readonly #inspect: FreeIndexDeps['inspect']
  readonly #transcript: FreeIndexDeps['transcript']
  readonly #onChange: FreeIndexDeps['onChange']
  readonly #newId: () => string
  readonly #now: () => Date

  /** A ordem do `Map` é a do painel. Só recebe entrada já verificada ou criada nesta execução. */
  readonly #entries = new Map<string, FreeEntry>()

  #carregando: Promise<void> | null = null
  #carregado = false

  /** A fila das gravações, serializada pelo mesmo motivo da do `ConversationIndex`. */
  #gravando: Promise<void> = Promise.resolve()

  constructor(deps: FreeIndexDeps) {
    this.#load = deps.load
    this.#save = deps.save
    this.#inspect = deps.inspect
    this.#transcript = deps.transcript
    this.#onChange = deps.onChange
    this.#newId = deps.newId ?? (() => crypto.randomUUID())
    this.#now = deps.now ?? (() => new Date())
  }

  /**
   * Lê o que está gravado e confere cada conversa. Roda no boot; quem chega com a carga em voo pega
   * carona nela, e é o que faz `restore` nunca ler a lista pela metade.
   *
   * O que não passa no `inspect` **não é apagado**: `sessionId` vira `null` e a entrada fica, porque
   * a pasta e o título ainda valem.
   */
  async refresh(): Promise<void> {
    this.#carregando ??= this.#verify().finally(() => {
      this.#carregando = null
    })

    return this.#carregando
  }

  /** O retrato do painel. Lido da lista já verificada: antes do boot terminar ele responde vazio. */
  list(): FreeSessionCard[] {
    return [...this.#entries.values()].map((entry) => ({
      id: entry.id,
      title: entry.title,
      dangerous: entry.dangerous,
      recoverable: entry.sessionId !== null,
    }))
  }

  /**
   * Espera a carga do boot, como `cwdOf`: criada antes dela, a sessão entraria no topo do painel na
   * frente das gravadas, e a gravação que ela dispara levaria uma lista sem as do disco.
   */
  async create({ cwd, title }: { cwd: string; title: string }): Promise<string> {
    await this.#pronto()

    const id = this.#newId()

    this.#entries.set(id, {
      id,
      title,
      cwd,
      sessionId: null,
      dangerous: false,
      createdAt: this.#now().toISOString(),
    })
    this.#changed()

    return id
  }

  /**
   * A pasta gravada, para quem decide onde a sessão roda quando não há conversa a retomar. Espera a
   * carga: perguntada antes dela, uma sessão que existe em disco responderia `null`, e o terminal
   * diria que a pasta não existe mais.
   */
  async cwdOf(id: string): Promise<string | null> {
    await this.#pronto()

    return this.#entries.get(id)?.cwd ?? null
  }

  setCwd(id: string, cwd: string): void {
    const entry = this.#entries.get(id)
    if (entry === undefined || entry.cwd === cwd) return

    this.#entries.set(id, { ...entry, cwd })
    this.#changed()
  }

  /** Título vazio ou só espaços é **ignorado**: o anterior fica. */
  rename(id: string, title: string): void {
    const entry = this.#entries.get(id)
    const limpo = title.trim()
    if (entry === undefined || limpo === '' || entry.title === limpo) return

    this.#entries.set(id, { ...entry, title: limpo })
    this.#changed()
  }

  /** Esquecer é definitivo para o app; o transcript fica em `~/.claude/projects`, como no cartão. */
  forget(id: string): void {
    if (!this.#entries.delete(id)) return

    this.#changed()
  }

  /**
   * O vínculo com a conversa, com o `session_id` que o `init` reportou. Sempre sobrescreve, pela
   * razão do `ConversationIndex.remember`: o registro segue o que o SDK **disse**.
   */
  remember(id: string, sessionId: string): void {
    const entry = this.#entries.get(id)
    if (entry === undefined || entry.sessionId === sessionId) return

    this.#entries.set(id, { ...entry, sessionId })
    this.#changed()
  }

  /** A conversa acabou, a entrada fica: encerrar não é esquecer. */
  release(id: string): void {
    const entry = this.#entries.get(id)
    if (entry === undefined || entry.sessionId === null) return

    this.#entries.set(id, { ...entry, sessionId: null })
    this.#changed()
  }

  /**
   * O que há a retomar, ou `null`. **Só responde quando há conversa**, e o `cwd` devolvido é o do
   * `inspect` — a pasta em que a conversa rodou (regra do cartão, `ipc.ts:185-189`). Sem
   * `sessionId`, transcript sumido ou pasta sumida → `null`, e quem decide a pasta de uma conversa
   * nova é o `resolveCwd` do main, com `cwdOf` + `existsSync`.
   */
  async restore(id: string): Promise<Restoration | null> {
    await this.#pronto()

    const sessionId = this.#entries.get(id)?.sessionId
    if (sessionId === undefined || sessionId === null) return null

    const info = await this.#inspected(sessionId)
    if (info === null) {
      // Acabou de ficar provado que não há o que retomar; o crachá não pode mentir até o próximo boot.
      const atual = this.#entries.get(id)
      if (atual?.sessionId === sessionId) this.release(id)

      return null
    }

    return { sessionId, cwd: info.cwd, history: replay(await this.#history(sessionId)) }
  }

  isDangerous(id: string): boolean {
    return this.#entries.get(id)?.dangerous ?? false
  }

  setDangerous(id: string, dangerous: boolean): void {
    const entry = this.#entries.get(id)
    if (entry === undefined || entry.dangerous === dangerous) return

    this.#entries.set(id, { ...entry, dangerous })
    this.#changed()
  }

  async #verify(): Promise<void> {
    const gravado = await this.#stored()

    const verificados = await Promise.all(
      gravado.map(async (entry) => ({
        entry,
        vivo: entry.sessionId !== null && (await this.#inspected(entry.sessionId)) !== null,
      })),
    )

    let podou = false

    for (const { entry, vivo } of verificados) {
      // O que já está em memória vence o disco: veio desta execução e é mais novo.
      if (this.#entries.has(entry.id)) continue

      if (!vivo && entry.sessionId !== null) podou = true
      this.#entries.set(entry.id, vivo ? entry : { ...entry, sessionId: null })
    }

    this.#carregado = true

    if (podou) this.#persist()
    if (verificados.length > 0) this.#onChange?.()
  }

  #changed(): void {
    this.#onChange?.()
    this.#persist()
  }

  /**
   * Enfileira a gravação com a verdade mais recente da vez, nunca um retrato velho — e nunca antes da
   * carga: gravar só o que nasceu nesta execução sobrescreveria o `free-sessions.json` sem as sessões
   * que ainda não foram lidas dele.
   */
  #persist(): void {
    this.#gravando = this.#gravando
      .then(() => this.#pronto())
      .then(() => this.#save([...this.#entries.values()]))
      .catch(() => undefined)
  }

  /** A carga do boot, já feita ou feita agora; quem chega com ela em voo pega carona no `refresh`. */
  async #pronto(): Promise<void> {
    if (!this.#carregado) await this.refresh()
  }

  async #stored(): Promise<readonly FreeEntry[]> {
    try {
      return await this.#load()
    } catch {
      return []
    }
  }

  /** Uma ponta que rejeita não disse "sim": vale `null`. */
  async #inspected(sessionId: string): Promise<{ cwd: string } | null> {
    try {
      return await this.#inspect(sessionId)
    } catch {
      return null
    }
  }

  async #history(sessionId: string): Promise<readonly TranscriptEntry[]> {
    try {
      return await this.#transcript(sessionId)
    } catch {
      return []
    }
  }
}
