/**
 * O índice `owner/name → pasta local`, **descoberto** e nunca configurado.
 *
 * A matéria-prima são as sessões que o Claude Code já rodou na máquina: cada uma carrega a `cwd`
 * real em que aconteceu, e o `origin` daquela pasta diz de qual repo ela é. O ruído — pasta
 * temporária, scratchpad, raiz de workspace — se elimina sozinho por não ser repo git com remoto,
 * então não existe lista de exclusão a manter. Lista escrita à mão envelhece; esta não tem como.
 *
 * Core: as duas pontas de IO chegam injetadas, como o `graphql` do `BoardReader` e o `query` do
 * `SessionHost`. Quem lê disco e spawna `git` é `src/main/repos.ts`.
 */

/** Uma pasta onde o Claude Code já rodou, com a idade da sessão mais recente dela. */
export interface SessionFolder {
  path: string
  /** Epoch ms da sessão mais recente naquela pasta. Só serve para desempatar. */
  usedAt: number
}

export interface RepoIndexDeps {
  /** As pastas de trabalho das sessões da máquina. Quem lê disco é o main. */
  scan: () => Promise<readonly SessionFolder[]>
  /** A URL do `origin` daquele diretório, ou `null` se não for repo git com remoto. */
  origin: (path: string) => Promise<string | null>
}

export class RepoIndex {
  readonly #scan: RepoIndexDeps['scan']
  readonly #origin: RepoIndexDeps['origin']

  /** O que a varredura achou, por `owner/name` normalizado. Trocado inteiro a cada `refresh()`. */
  #discovered: ReadonlyMap<string, SessionFolder> = new Map()

  /**
   * O que o humano escolheu no seletor de diretório (CA-5). Mapa próprio, e não uma entrada
   * privilegiada no de cima, porque é o que faz a escolha explícita sobreviver a toda varredura
   * futura sem nenhuma regra de mesclagem.
   */
  readonly #declared = new Map<string, string>()

  /** A varredura em voo, se houver. */
  #scanning: Promise<void> | null = null

  constructor(deps: RepoIndexDeps) {
    this.#scan = deps.scan
    this.#origin = deps.origin
  }

  async refresh(): Promise<void> {
    // Gatilho que chega com varredura em voo **pega carona nela** em vez de abrir a segunda: é um
    // subprocesso `git` por pasta, e duas varreduras simultâneas gastariam o dobro para responder
    // a mesma coisa. Quem esperou continua esperando o índice ficar pronto, que é o que ele pediu.
    this.#scanning ??= this.#discover().finally(() => {
      this.#scanning = null
    })

    return this.#scanning
  }

  /** A pasta do repo `owner/name`, ou `null` se o índice não a conhece. */
  pathFor(repository: string): string | null {
    const key = normalizeRepository(repository)

    // A escolha do humano vence a descoberta. Descobrir é palpite bem-informado; escolher é saber.
    return this.#declared.get(key) ?? this.#discovered.get(key)?.path ?? null
  }

  /** A pasta escolhida à mão (CA-5). Vive só em memória, nunca em disco. */
  declare(repository: string, path: string): void {
    this.#declared.set(normalizeRepository(repository), path)
  }

  async #discover(): Promise<void> {
    const folders = await this.#scan()

    // Em paralelo: são dezenas de subprocessos curtos, e o índice inteiro é pré-requisito do
    // primeiro clique num cartão.
    const remotes = await Promise.all(
      folders.map(async (folder) => ({ folder, url: await this.#origin(folder.path) })),
    )

    const found = new Map<string, SessionFolder>()

    for (const { folder, url } of remotes) {
      const repository = url === null ? null : parseRemote(url)
      // Pasta sem `origin`, ou com um que não é `owner/name`, não entra — e não avisa. Não é falha:
      // a maioria das pastas de sessão da máquina não é repo nenhum.
      if (repository === null) continue

      const current = found.get(repository)
      // Dois clones do mesmo repo (ou um worktree ao lado): vence a pasta usada por último, que é
      // onde você estava trabalhando naquele repo.
      if (current === undefined || folder.usedAt > current.usedAt) found.set(repository, folder)
    }

    // Trocado inteiro, não mesclado: pasta que sumiu do disco tem de sumir do índice junto.
    this.#discovered = found
  }
}

/**
 * As três formas que o `origin` tem na prática — `https://github.com/owner/name.git`,
 * `https://github.com/owner/name` e `git@github.com:owner/name.git` — reduzidas ao mesmo
 * `owner/name`.
 *
 * O separador antes do dono é `/` na forma HTTPS e `:` na SSH, e é a única diferença que sobra
 * depois de derrubar o `.git`. O que vier em outro formato vira `null` e a pasta é descartada:
 * ficar sem a pasta faz o cartão pedi-la (CA-5), enquanto adivinhá-la abriria sessão no lugar
 * errado.
 */
function parseRemote(url: string): string | null {
  const trimmed = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  const groups = /[/:](?<owner>[^/:]+)\/(?<name>[^/:]+)$/.exec(trimmed)?.groups
  const owner = groups?.['owner']
  const name = groups?.['name']

  return owner === undefined || name === undefined ? null : normalizeRepository(`${owner}/${name}`)
}

/**
 * A chave do índice. Comparação **case-insensitive** porque o GitHub não distingue caixa em
 * `owner/name`: o board devolve o `nameWithOwner` na caixa canônica e o `origin` da máquina guarda
 * a caixa com que alguém digitou o `git clone`.
 */
function normalizeRepository(repository: string): string {
  return repository.trim().toLowerCase()
}
