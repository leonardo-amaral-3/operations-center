import { describe, expect, it, vi } from 'vitest'

import { RepoIndex } from '../../src/core/repos/RepoIndex'
import type { SessionFolder } from '../../src/core/repos/RepoIndex'

/**
 * O CA-3 em forma de teste, e a metade do CA-5 que é do core.
 *
 * A regra que este arquivo protege é uma só, e ela tem dois lados: o índice acha a pasta certa
 * quando dá para achar, e **devolve `null` quando não dá** — nunca um palpite. Subir uma sessão do
 * Claude Code na pasta errada é o pior modo de falha desta feature, e é por isso que cada caminho
 * que produz `null` tem caso próprio aqui.
 */

const REPO = 'leonardo-amaral-3/operations-center'
const PASTA = 'C:/Users/lokin/pessoal/operations-center'
const HTTPS = `https://github.com/${REPO}.git`

/** Uma pasta da máquina imaginária: onde ela é, quando foi usada, e o que o git diz dela. */
interface Pasta {
  path: string
  usedAt: number
  origin: string | null
}

function createIndex(pastas: readonly Pasta[]) {
  const scan = vi.fn((): Promise<readonly SessionFolder[]> =>
    Promise.resolve(pastas.map(({ path, usedAt }) => ({ path, usedAt }))),
  )
  const origin = vi.fn((path: string): Promise<string | null> =>
    Promise.resolve(pastas.find((pasta) => pasta.path === path)?.origin ?? null),
  )

  return { index: new RepoIndex({ scan, origin }), scan, origin }
}

async function indexOf(...pastas: readonly Pasta[]): Promise<RepoIndex> {
  const { index } = createIndex(pastas)
  await index.refresh()

  return index
}

describe('RepoIndex — a URL do origin vira owner/name', () => {
  // As três formas convivem na mesma máquina: o `gh repo clone` escreve uma, o `git clone` de um
  // link copiado do navegador escreve outra, e quem usa chave SSH escreve a terceira.
  const FORMAS = [
    'https://github.com/leonardo-amaral-3/operations-center.git',
    'https://github.com/leonardo-amaral-3/operations-center',
    'git@github.com:leonardo-amaral-3/operations-center.git',
  ]

  for (const forma of FORMAS) {
    it(`reconhece o repo em ${forma}`, async () => {
      const index = await indexOf({ path: PASTA, usedAt: 1, origin: forma })

      expect(index.pathFor(REPO)).toBe(PASTA)
    })
  }

  it('casa com caixa diferente — o GitHub não distingue, e o clone guarda a que foi digitada', async () => {
    const index = await indexOf({
      path: PASTA,
      usedAt: 1,
      origin: 'https://github.com/Leonardo-Amaral-3/Operations-Center.git',
    })

    // O board devolve o `nameWithOwner` na caixa canônica; casar por caixa faria o cartão pedir uma
    // pasta que está bem ali.
    expect(index.pathFor(REPO)).toBe(PASTA)
    expect(index.pathFor('LEONARDO-AMARAL-3/OPERATIONS-CENTER')).toBe(PASTA)
  })
})

describe('RepoIndex — o que fica de fora do índice', () => {
  it('ignora a pasta que não é repo git com remoto, sem derrubar o resto da varredura', async () => {
    const index = await indexOf(
      { path: 'C:/Temp/smoke-123', usedAt: 3, origin: null },
      { path: 'C:/Users/lokin/pessoal', usedAt: 2, origin: null },
      { path: PASTA, usedAt: 1, origin: HTTPS },
    )

    // O filtro é a própria pergunta: temporário do smoke, scratchpad e raiz de workspace saem
    // sozinhos por não terem remoto, sem lista de exclusão nenhuma para manter.
    expect(index.pathFor(REPO)).toBe(PASTA)
  })

  it('ignora o remoto que não tem a forma owner/name', async () => {
    const index = await indexOf({ path: PASTA, usedAt: 1, origin: 'C:\\repos\\espelho.git' })

    expect(index.pathFor(REPO)).toBeNull()
  })

  it('devolve null para o repo que não tem pasta na máquina — a porta do CA-5', async () => {
    const index = await indexOf({ path: PASTA, usedAt: 1, origin: HTTPS })

    // Sem pasta resolvida não há sessão: o cartão pede a pasta em vez de a sessão subir em algum
    // default.
    expect(index.pathFor('leonardo-amaral-3/repo-forasteiro')).toBeNull()
  })

  it('devolve null antes da primeira varredura', () => {
    const { index } = createIndex([{ path: PASTA, usedAt: 1, origin: HTTPS }])

    expect(index.pathFor(REPO)).toBeNull()
  })
})

describe('RepoIndex — dois clones do mesmo repo', () => {
  const ANTIGO = { path: 'C:/Users/lokin/clones/operations-center', usedAt: 1_000 }
  const RECENTE = { path: PASTA, usedAt: 2_000 }

  // Nas duas ordens de propósito: com uma só, um índice que simplesmente ficasse com o último a
  // chegar passaria por metade dos casos e mentiria na outra metade.
  it('fica com a pasta usada por último quando ela vem depois na varredura', async () => {
    const index = await indexOf({ ...ANTIGO, origin: HTTPS }, { ...RECENTE, origin: HTTPS })

    expect(index.pathFor(REPO)).toBe(RECENTE.path)
  })

  it('fica com a pasta usada por último quando ela vem antes na varredura', async () => {
    const index = await indexOf({ ...RECENTE, origin: HTTPS }, { ...ANTIGO, origin: HTTPS })

    expect(index.pathFor(REPO)).toBe(RECENTE.path)
  })
})

describe('RepoIndex — a escolha do humano', () => {
  const ESCOLHIDA = 'D:/trabalho/operations-center'

  it('declare() vence o que a varredura achou', async () => {
    const index = await indexOf({ path: PASTA, usedAt: 1, origin: HTTPS })

    index.declare(REPO, ESCOLHIDA)

    expect(index.pathFor(REPO)).toBe(ESCOLHIDA)
  })

  it('declare() sobrevive ao refresh()', async () => {
    const { index } = createIndex([{ path: PASTA, usedAt: 1, origin: HTTPS }])

    index.declare(REPO, ESCOLHIDA)
    await index.refresh()

    // Escolha explícita não é sobrescrita por descoberta: quem escolheu sabe onde o repo está, e a
    // varredura só palpita bem.
    expect(index.pathFor(REPO)).toBe(ESCOLHIDA)
  })

  it('declare() responde na caixa que o board usar', () => {
    const { index } = createIndex([])

    index.declare('Leonardo-Amaral-3/Operations-Center', ESCOLHIDA)

    expect(index.pathFor(REPO)).toBe(ESCOLHIDA)
  })
})

describe('RepoIndex — o que uma varredura nova faz com a anterior', () => {
  it('esquece a pasta que sumiu do disco', async () => {
    let pastas: readonly Pasta[] = [{ path: PASTA, usedAt: 1, origin: HTTPS }]
    const index = new RepoIndex({
      scan: () => Promise.resolve(pastas.map(({ path, usedAt }) => ({ path, usedAt }))),
      origin: (path) =>
        Promise.resolve(pastas.find((pasta) => pasta.path === path)?.origin ?? null),
    })

    await index.refresh()
    expect(index.pathFor(REPO)).toBe(PASTA)

    pastas = []
    await index.refresh()

    // Índice mesclado apontaria para uma pasta que não existe mais, e o cartão só descobriria o
    // erro quando a sessão falhasse ao subir.
    expect(index.pathFor(REPO)).toBeNull()
  })

  it('não abre uma segunda varredura enquanto a primeira está em voo', async () => {
    let liberar = (): void => {}
    const scan = vi.fn(
      () =>
        new Promise<readonly SessionFolder[]>((resolve) => {
          liberar = () => {
            resolve([{ path: PASTA, usedAt: 1 }])
          }
        }),
    )
    const index = new RepoIndex({ scan, origin: () => Promise.resolve(HTTPS) })

    const primeira = index.refresh()
    const segunda = index.refresh()

    // É um subprocesso `git` por pasta: o segundo gatilho pega carona no primeiro em vez de pagar
    // a varredura de novo.
    expect(scan).toHaveBeenCalledTimes(1)

    liberar()
    await Promise.all([primeira, segunda])

    // Quem esperou recebeu o índice pronto, e não uma promessa que resolveu antes da hora.
    expect(index.pathFor(REPO)).toBe(PASTA)

    // Terminada a varredura, o próximo gatilho roda de verdade — a carona vale para a que está em
    // voo, não para sempre.
    const terceira = index.refresh()
    expect(scan).toHaveBeenCalledTimes(2)

    liberar()
    await terceira
  })
})
