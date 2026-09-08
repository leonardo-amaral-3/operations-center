/**
 * A marca do modo *dangerously*, por cartão — irmão do `ConversationIndex`, e deliberadamente menor.
 *
 * A marca é **do cartão, não da sessão**: ela precisa existir e ser visível num cartão que ainda não
 * foi clicado, e valer para a próxima sessão daquele cartão mesmo que não haja nenhuma viva agora.
 * É por isso que ela mora num índice próprio, e não no retrato da sessão.
 *
 * Core: as duas pontas de IO chegam injetadas, como as do `ConversationIndex` e as do `RepoIndex`.
 * Quem lê e escreve disco é `src/main/danger.ts`; aqui dentro não há caminho de arquivo, formato,
 * nem versão — só a regra de quem está marcado.
 */

export interface DangerIndexDeps {
  /** Os cartões marcados, do disco. Arquivo ausente ou ilegível é conjunto vazio. */
  load: () => Promise<ReadonlySet<string>>
  save: (itemIds: ReadonlySet<string>) => Promise<void>
  /** Chamado a cada mudança do conjunto. Quem publica pela ponte é o main. */
  onChange?: () => void
}

export class DangerIndex {
  readonly #load: DangerIndexDeps['load']
  readonly #save: DangerIndexDeps['save']
  readonly #onChange: DangerIndexDeps['onChange']

  /**
   * **`Map<itemId, marcado>` e não `Set<itemId>`**, e a diferença é carga viva.
   *
   * O `ConversationIndex` resolve o encontro entre memória e disco com uma linha —
   * `if (this.#cards.has(itemId)) continue` (`ConversationIndex.ts:190`), "o que já está em memória
   * vence o disco, porque veio de um evento desta execução". Com um `Set`, essa linha não teria como
   * distinguir "nunca ouvi falar deste cartão" de "esta execução o **desmarcou**": o desmarcado
   * seria ressuscitado pela carga. O booleano é o terceiro estado que falta.
   *
   * O arquivo em disco continua sendo só a lista dos marcados — o `false` é memória, não formato.
   */
  readonly #cards = new Map<string, boolean>()

  /** A carga em voo, se houver. */
  #carregando: Promise<void> | null = null

  /** Se o mapa em memória já reflete o que estava gravado. */
  #carregado = false

  /**
   * A fila das gravações. Uma promessa encadeada, e não `void this.#save(...)` solto: duas marcações
   * seguidas escreveriam o mesmo arquivo ao mesmo tempo, e o vencedor seria o que o sistema de
   * arquivos decidisse.
   */
  #gravando: Promise<void> = Promise.resolve()

  constructor(deps: DangerIndexDeps) {
    this.#load = deps.load
    this.#save = deps.save
    this.#onChange = deps.onChange
  }

  /**
   * Lê o que está gravado. Roda no boot.
   *
   * Gatilho que chega com uma carga em voo pega carona nela, como o `RepoIndex.refresh()` — e aqui a
   * carona é mais do que economia: é o que faz `isDangerous` nunca ler um conjunto pela metade.
   */
  async refresh(): Promise<void> {
    this.#carregando ??= this.#carregar().finally(() => {
      this.#carregando = null
    })

    return this.#carregando
  }

  /**
   * O retrato para a tela: as chaves marcadas.
   *
   * Vazio antes da carga — o crachá pode nascer ausente e chegar pelo `onChange` quando o disco
   * responder. O que ele não pode é sair de um mapa pela metade.
   */
  dangerous(): readonly string[] {
    return [...this.#cards].filter(([, marcado]) => marcado).map(([itemId]) => itemId)
  }

  /**
   * Aquele cartão está marcado? É daqui que sai o `dangerous` do nascimento da sessão.
   *
   * **Espera a carga terminar, e a inicia se ninguém a iniciou.** É a mesma corrida que o `restore`
   * documenta: um clique nos primeiros milissegundos depois da abertura leria conjunto vazio, a
   * sessão nasceria com portão num cartão marcado, e o CA-1 falharia numa volta em que ninguém
   * desconfia — sem erro nenhum na tela, porque pedir permissão é um estado previsto.
   */
  async isDangerous(itemId: string): Promise<boolean> {
    if (!this.#carregado) await this.refresh()

    return this.#cards.get(itemId) ?? false
  }

  /**
   * Muda, avisa e agenda a gravação. Síncrono para quem chama: o handler do IPC não espera disco.
   *
   * O valor gravado no mapa é comparado com o que **já estava lá**, e `undefined` não é `false`:
   * repetir a marca é o caso comum e não é mudança, mas desmarcar um cartão que esta execução ainda
   * não conhece **é** — é exatamente o terceiro estado do mapa entrando em cena, e sem ele a carga
   * seguinte desfaria o que o usuário acabou de decidir.
   */
  set(itemId: string, dangerous: boolean): void {
    if (this.#cards.get(itemId) === dangerous) return

    this.#cards.set(itemId, dangerous)
    this.#onChange?.()
    this.#persist()
  }

  /**
   * A carga: o que está no arquivo entra no mapa como marcado, sem verificação nenhuma.
   *
   * **Não poda.** O `ConversationIndex` verifica porque um `sessionId` gravado pode ter deixado de
   * existir lá fora; uma marca não aponta para nada — ela é uma decisão do usuário. Cartão que sumiu
   * do board custa uma linha inerte no JSON, e podar exigiria dar ao core o board, que ele não tem e
   * não deve ter. Por isso a carga também nunca regrava o arquivo: não há o que descartar.
   */
  async #carregar(): Promise<void> {
    const gravado = await this.#stored()

    let mudou = false

    for (const itemId of gravado) {
      // O que já está em memória vence o disco: veio de um clique desta execução, e é mais novo do
      // que o arquivo que estava lá quando o app abriu. Vale para o marcado e para o desmarcado.
      if (this.#cards.has(itemId)) continue

      this.#cards.set(itemId, true)
      mudou = true
    }

    this.#carregado = true

    if (mudou) this.#onChange?.()
  }

  /**
   * A gravação espera a carga.
   *
   * O `#persist` grava o mapa **inteiro**, e o `set` pode chegar antes de o disco ter sido lido — ao
   * contrário do `remember` de lá, cujo único chamador roda depois de um `restore` que já esperou.
   * Sem este elo, marcar um cartão nos primeiros milissegundos do app gravaria um arquivo com **um**
   * cartão e apagaria as marcas de todos os outros. Como `refresh()` tem carona e a carga respeita o
   * que já está em memória, encadeá-lo aqui é barato e idempotente.
   *
   * O `catch` fecha cada elo: uma gravação que falhou não pode deixar a fila rejeitada e levar junto
   * todas as seguintes. E ninguém tem como capturar a falha lá fora — `set` é síncrono para quem
   * chama. O preço de não conseguir gravar é um cartão que volta sem marca, e esse é o lado seguro:
   * perder uma marca devolve o portão, nunca o remove.
   */
  #persist(): void {
    this.#gravando = this.#gravando
      .then(() => this.refresh())
      .then(() => this.#save(this.#marcados()))
      .catch(() => undefined)
  }

  /** O que vai para o disco: só os marcados. O `false` morre com a execução. */
  #marcados(): ReadonlySet<string> {
    return new Set(this.dangerous())
  }

  /** O que está gravado. Ponta que falha é indistinguível de arquivo ausente: conjunto vazio. */
  async #stored(): Promise<ReadonlySet<string>> {
    try {
      return await this.#load()
    } catch {
      return new Set()
    }
  }
}
