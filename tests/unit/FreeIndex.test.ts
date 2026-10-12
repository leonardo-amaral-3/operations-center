import { describe, expect, it, vi } from 'vitest'

import { FreeIndex } from '../../src/core/session/FreeIndex'
import type { FreeEntry, FreeIndexDeps } from '../../src/core/session/FreeIndex'
import type { TranscriptEntry } from '../../src/core/session/transcript'

/**
 * A regra da sessão livre (#74 CA-2), e o **teste de DX** dela é o transcript sumido: a conversa
 * some, o trabalho não. Quem abre o app e vê a aba "notoria" no mesmo lugar, mesmo sem a conversa
 * antiga, sabe o que fazer; quem a vê desaparecer sem aviso perde título e pasta e não sabe por quê.
 */

const SESSAO = '0b1e6a2c-1f4d-4a51-9c33-2e7e5b9d4a10'
const PASTA = 'C:/Users/lokin/notoria'
const PASTA_DA_CONVERSA = 'C:/Users/lokin/notoria/api'

function entrada(over: Partial<FreeEntry> = {}): FreeEntry {
  return {
    id: 'livre-1',
    title: 'notoria',
    cwd: PASTA,
    sessionId: SESSAO,
    dangerous: false,
    createdAt: '2026-10-12T14:03:00.000Z',
    ...over,
  }
}

function fala(uuid: string, text: string): TranscriptEntry {
  return { type: 'user', uuid, message: { role: 'user', content: text }, parent_tool_use_id: null }
}

interface Opcoes {
  gravado?: readonly FreeEntry[]
  /** As conversas que o Claude Code ainda tem no disco. O que não está aqui, `inspect` nega. */
  conversas?: readonly string[]
  load?: FreeIndexDeps['load']
  save?: FreeIndexDeps['save']
}

function montar(opcoes: Opcoes = {}) {
  const conversas = new Set(opcoes.conversas ?? [])
  const save = vi.fn(opcoes.save ?? ((): Promise<void> => Promise.resolve()))
  const onChange = vi.fn()
  let proximo = 0

  const index = new FreeIndex({
    load: opcoes.load ?? (() => Promise.resolve(opcoes.gravado ?? [])),
    save,
    inspect: (sessionId) =>
      Promise.resolve(conversas.has(sessionId) ? { cwd: PASTA_DA_CONVERSA } : null),
    transcript: () => Promise.resolve([fala('u1', 'onde parou?')]),
    onChange,
    newId: () => `livre-${(proximo += 1)}`,
    now: () => new Date('2026-10-12T14:03:00.000Z'),
  })

  return { index, save, onChange }
}

/** A última lista que foi para o disco — a prova de que a gravação acompanha a memória. */
function ultimaGravacao(save: ReturnType<typeof montar>['save']): readonly FreeEntry[] {
  const chamadas = save.mock.calls
  const ultima = chamadas[chamadas.length - 1]
  if (ultima === undefined) throw new Error('nada foi gravado')

  return ultima[0]
}

describe('FreeIndex — o transcript sumiu, a sessão não', () => {
  it('no boot, transcript sumido vira `recoverable:false` e a entrada FICA com título e pasta', async () => {
    const { index, save } = montar({ gravado: [entrada()], conversas: [] })

    await index.refresh()

    expect(index.list()).toEqual([
      { id: 'livre-1', title: 'notoria', dangerous: false, recoverable: false },
    ])
    expect(await index.cwdOf('livre-1')).toBe(PASTA)
    await vi.waitFor(() => {
      expect(ultimaGravacao(save)).toEqual([entrada({ sessionId: null })])
    })
  })

  it('o `restore` de um transcript sumido devolve `null` e solta o crachá, sem apagar a entrada', async () => {
    // Sem `refresh` antes: o `restore` espera a carga sozinho, e o `inspect` nega o transcript.
    const { index } = montar({ gravado: [entrada()], conversas: [] })

    expect(await index.restore('livre-1')).toBeNull()
    expect(index.list()).toEqual([
      { id: 'livre-1', title: 'notoria', dangerous: false, recoverable: false },
    ])
  })

  it('conversa viva: `restore` devolve a pasta em que ela RODOU e o histórico traduzido', async () => {
    const { index } = montar({ gravado: [entrada()], conversas: [SESSAO] })

    const restoration = await index.restore('livre-1')

    expect(restoration?.sessionId).toBe(SESSAO)
    expect(restoration?.cwd).toBe(PASTA_DA_CONVERSA)
    expect(restoration?.history).toHaveLength(1)
  })

  it('entrada sem conversa (criada e nunca falada): título e pasta valem, `restore` é `null`', async () => {
    const { index } = montar({ gravado: [entrada({ sessionId: null })] })

    expect(await index.restore('livre-1')).toBeNull()
    expect(index.list()[0]).toMatchObject({ title: 'notoria', recoverable: false })
    expect(await index.cwdOf('livre-1')).toBe(PASTA)
  })

  it('um `inspect` que rejeita não é "sim": cai no mesmo caminho do transcript sumido', async () => {
    const index = new FreeIndex({
      load: () => Promise.resolve([entrada()]),
      save: () => Promise.resolve(),
      inspect: () => Promise.reject(new Error('disco')),
      transcript: () => Promise.resolve([]),
    })

    await index.refresh()

    expect(index.list()[0]?.recoverable).toBe(false)
  })
})

describe('FreeIndex — ciclo de vida', () => {
  it('`create` nasce na pasta, com o título dado, sem conversa, e vai para o disco', async () => {
    const { index, save, onChange } = montar()

    const id = await index.create({ cwd: PASTA, title: 'notoria' })

    expect(id).toBe('livre-1')
    expect(index.list()).toEqual([
      { id, title: 'notoria', dangerous: false, recoverable: false },
    ])
    expect(await index.cwdOf(id)).toBe(PASTA)
    expect(onChange).toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(ultimaGravacao(save)).toEqual([entrada({ id, sessionId: null })])
    })
  })

  it('`remember` liga a conversa; `release` solta e MANTÉM a entrada; `forget` remove', async () => {
    const { index } = montar()
    const id = await index.create({ cwd: PASTA, title: 'notoria' })

    index.remember(id, SESSAO)
    expect(index.list()[0]?.recoverable).toBe(true)

    index.release(id)
    expect(index.list()).toHaveLength(1)
    expect(index.list()[0]?.recoverable).toBe(false)

    index.forget(id)
    expect(index.list()).toEqual([])
    expect(await index.cwdOf(id)).toBeNull()
  })

  it('repetir o mesmo vínculo não é mudança: não avisa nem regrava', async () => {
    const { index, onChange } = montar()
    const id = await index.create({ cwd: PASTA, title: 'notoria' })
    index.remember(id, SESSAO)
    onChange.mockClear()

    index.remember(id, SESSAO)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('`rename` troca o título; vazio ou só espaços é ignorado e o anterior fica', async () => {
    const { index } = montar()
    const id = await index.create({ cwd: PASTA, title: 'notoria' })

    index.rename(id, '  api de faturamento ')
    expect(index.list()[0]?.title).toBe('api de faturamento')

    index.rename(id, '')
    index.rename(id, '   ')
    expect(index.list()[0]?.title).toBe('api de faturamento')
  })

  it('`setCwd` troca a pasta; id desconhecido é no-op em tudo', async () => {
    const { index, onChange } = montar()
    const id = await index.create({ cwd: PASTA, title: 'notoria' })

    index.setCwd(id, 'C:/outra')
    expect(await index.cwdOf(id)).toBe('C:/outra')

    onChange.mockClear()
    index.setCwd('nao-existe', 'C:/x')
    index.rename('nao-existe', 'x')
    index.remember('nao-existe', SESSAO)
    index.release('nao-existe')
    index.forget('nao-existe')
    index.setDangerous('nao-existe', true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a marca de perigo persiste na entrada e aparece no retrato', async () => {
    const { index, save } = montar()
    const id = await index.create({ cwd: PASTA, title: 'notoria' })

    expect(index.isDangerous(id)).toBe(false)
    index.setDangerous(id, true)

    expect(index.isDangerous(id)).toBe(true)
    expect(index.list()[0]?.dangerous).toBe(true)
    await vi.waitFor(() => {
      expect(ultimaGravacao(save)[0]?.dangerous).toBe(true)
    })
  })

  it('a ordem do array é a ordem do painel: criada durante a carga, a nova entra DEPOIS das gravadas', async () => {
    let liberar!: (entries: readonly FreeEntry[]) => void
    const carga = new Promise<readonly FreeEntry[]>((resolve) => {
      liberar = resolve
    })
    const { index } = montar({ load: () => carga })

    void index.refresh()
    const criando = index.create({ cwd: 'C:/nova', title: 'nova' })
    liberar([entrada({ id: 'disco-1', sessionId: null })])
    await criando

    expect(index.list().map((card) => card.title)).toEqual(['notoria', 'nova'])
  })

  it('`cwdOf` perguntado antes da carga espera por ela, em vez de dizer que a sessão não existe', async () => {
    let liberar!: (entries: readonly FreeEntry[]) => void
    const carga = new Promise<readonly FreeEntry[]>((resolve) => {
      liberar = resolve
    })
    const { index } = montar({ load: () => carga })

    const pasta = index.cwdOf('livre-1')
    liberar([entrada({ sessionId: null })])

    expect(await pasta).toBe(PASTA)
  })

  it('nenhuma gravação sai antes da carga: o arquivo nunca perde as sessões ainda não lidas', async () => {
    let liberar!: (entries: readonly FreeEntry[]) => void
    const carga = new Promise<readonly FreeEntry[]>((resolve) => {
      liberar = resolve
    })
    const { index, save } = montar({ load: () => carga })

    const criando = index.create({ cwd: 'C:/nova', title: 'nova' })
    liberar([entrada({ id: 'disco-1', sessionId: null })])
    await criando

    await vi.waitFor(() => {
      expect(save).toHaveBeenCalled()
    })
    for (const [gravado] of save.mock.calls) {
      expect(gravado.map((e) => e.id)).toContain('disco-1')
    }
  })

  it('gravação que falha não derruba o que vem depois', async () => {
    let falhar = true
    const gravados: number[] = []
    const { index } = montar({
      save: (entries) => {
        if (falhar) {
          falhar = false

          return Promise.reject(new Error('disco cheio'))
        }
        gravados.push(entries.length)

        return Promise.resolve()
      },
    })

    await index.create({ cwd: PASTA, title: 'a' })
    await index.create({ cwd: PASTA, title: 'b' })

    await vi.waitFor(() => {
      expect(gravados).toEqual([2])
    })
  })
})
