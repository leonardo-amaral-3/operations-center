import { describe, expect, it, vi } from 'vitest'

import { ConversationIndex } from '../../src/core/session/ConversationIndex'
import type { ConversationIndexDeps } from '../../src/core/session/ConversationIndex'
import type { TranscriptEntry } from '../../src/core/session/transcript'
import type { ChatMessage } from '../../src/shared/session'

/**
 * A regra do vínculo, e ela existe para responder uma pergunta só: **este cartão tem conversa a
 * retomar?** Cada caminho que responde "não" tem caso próprio aqui, porque os dois modos de falha
 * desta feature são assimétricos e os dois são caros.
 *
 * Dizer "sim" errado abre uma sessão sobre um transcript que não existe. Dizer "não" errado é pior:
 * uma sessão nova nasce, o `remember` sobrescreve o vínculo, e a conversa de antes fica órfã **sem
 * nenhum sinal de que existiu** — ninguém descobre, porque o cartão volta com a cara de quem nunca
 * conversou. É por isso que a corrida de carga tem teste, e não só comentário.
 */

const CARTAO = 'PVTI_card-22'
const OUTRO_CARTAO = 'PVTI_card-13'
const SESSAO = '0b1e6a2c-1f4d-4a51-9c33-2e7e5b9d4a10'
const OUTRA_SESSAO = '7d3f8c14-5b62-4e09-8a77-1c4a9f2e6b53'
const PASTA = 'C:/Users/lokin/pessoal/operations-center'

/** Uma conversa que existe na máquina imaginária: onde ela rodou e o que tem dentro. */
interface Conversa {
  sessionId: string
  cwd: string
  entries?: readonly TranscriptEntry[]
}

interface Opcoes {
  /** O que estava no arquivo quando o app abriu. */
  gravado?: Readonly<Record<string, string>>
  /** As conversas que o Claude Code ainda tem no disco. O que não está aqui, `inspect` nega. */
  conversas?: readonly Conversa[]
  /** Para os casos em que a própria leitura é o assunto (arquivo corrompido, carga em voo). */
  load?: ConversationIndexDeps['load']
  /** Para os casos em que a gravação é o assunto (fila, falha). */
  save?: ConversationIndexDeps['save']
  /** Para o caso em que a ponta de verificação é o assunto (uma que rejeita). */
  inspect?: ConversationIndexDeps['inspect']
}

function createIndex(opcoes: Opcoes = {}) {
  const conversas = opcoes.conversas ?? []

  const load = vi.fn(
    opcoes.load ??
      ((): Promise<ReadonlyMap<string, string>> =>
        Promise.resolve(new Map(Object.entries(opcoes.gravado ?? {})))),
  )
  const save = vi.fn(opcoes.save ?? ((): Promise<void> => Promise.resolve()))
  const inspect = vi.fn(
    opcoes.inspect ??
      ((sessionId: string): Promise<{ cwd: string } | null> => {
        const conversa = conversas.find((atual) => atual.sessionId === sessionId)

        return Promise.resolve(conversa === undefined ? null : { cwd: conversa.cwd })
      }),
  )
  const transcript = vi.fn((sessionId: string): Promise<readonly TranscriptEntry[]> =>
    Promise.resolve(conversas.find((atual) => atual.sessionId === sessionId)?.entries ?? []),
  )
  const onChange = vi.fn()

  const index = new ConversationIndex({ load, save, inspect, transcript, onChange })

  return { index, load, save, inspect, transcript, onChange }
}

type Save = ReturnType<typeof createIndex>['save']

/** `remember` e `forget` agendam a gravação e não a esperam; o teste espera por ela. */
async function esperaGravar(save: Save, vezes = 1): Promise<void> {
  await vi.waitFor(() => {
    expect(save).toHaveBeenCalledTimes(vezes)
  })
}

/** O que a última gravação levou para o disco. */
function ultimaGravacao(save: Save): ReadonlyMap<string, string> {
  return save.mock.calls.at(-1)?.[0] ?? new Map()
}

/** Deixa todo microtask pendente girar — é como se prova que algo **não** foi agendado. */
async function assenta(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function fala(uuid: string, text: string): TranscriptEntry {
  return { type: 'user', uuid, message: { role: 'user', content: text }, parent_tool_use_id: null }
}

function resposta(uuid: string, text: string): TranscriptEntry {
  return {
    type: 'assistant',
    uuid,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  }
}

/** O par que interessa nas asserções de histórico: quem falou e o quê. */
function falas(history: readonly ChatMessage[]): Array<{ role: string; text: string }> {
  return history.map((message) => ({
    role: message.role,
    text: message.role === 'tool' ? message.headline : message.text,
  }))
}

describe('ConversationIndex — o que é recuperável (CA-1)', () => {
  it('traz o cartão cujo vínculo gravado ainda tem transcript', async () => {
    const { index } = createIndex({
      gravado: { [CARTAO]: SESSAO },
      conversas: [{ sessionId: SESSAO, cwd: PASTA }],
    })

    await index.refresh()

    expect(index.recoverable()).toEqual([CARTAO])
  })

  it('não traz nada antes da verificação do boot terminar', () => {
    const { index } = createIndex({
      gravado: { [CARTAO]: SESSAO },
      conversas: [{ sessionId: SESSAO, cwd: PASTA }],
    })

    // O sinal do cartão pode nascer vazio e chegar pelo aviso depois; o que ele não pode é sair do
    // arquivo cru, sem passar pela verificação.
    expect(index.recoverable()).toEqual([])
  })

  it('não mostra o vínculo que foi lido do arquivo mas ainda não passou pelo inspect', async () => {
    let liberar = (): void => {}
    const inspect = vi.fn(
      () =>
        new Promise<{ cwd: string } | null>((resolve) => {
          liberar = () => {
            resolve({ cwd: PASTA })
          }
        }),
    )
    const { index } = createIndex({ gravado: { [CARTAO]: SESSAO }, inspect })

    const verificacao = index.refresh()
    await assenta()

    // O arquivo já foi lido; ninguém ainda confirmou que a conversa existe. Admitir aqui e podar
    // depois faria o crachá aparecer e sumir para toda conversa que não existe mais.
    expect(index.recoverable()).toEqual([])

    liberar()
    await verificacao

    expect(index.recoverable()).toEqual([CARTAO])
  })

  it('restore devolve o id, a pasta em que a sessão rodou e a conversa traduzida na ordem', async () => {
    const { index } = createIndex({
      gravado: { [CARTAO]: SESSAO },
      conversas: [
        {
          sessionId: SESSAO,
          cwd: PASTA,
          entries: [fala('u1', 'onde parou?'), resposta('a1', 'na task 3')],
        },
      ],
    })

    const restoration = await index.restore(CARTAO)

    expect(restoration?.sessionId).toBe(SESSAO)
    expect(restoration?.cwd).toBe(PASTA)
    expect(falas(restoration?.history ?? [])).toEqual([
      { role: 'user', text: 'onde parou?' },
      { role: 'assistant', text: 'na task 3' },
    ])
  })

  it('a pasta é a que o transcript diz, e não um palpite sobre onde o repo estaria hoje', async () => {
    const ONDE_RODOU = 'D:/trabalho/clone-antigo'
    const { index } = createIndex({
      gravado: { [CARTAO]: SESSAO },
      conversas: [{ sessionId: SESSAO, cwd: ONDE_RODOU }],
    })

    const restoration = await index.restore(CARTAO)

    // Um clone novo virando "a pasta daquele repo" não pode mudar onde uma conversa em curso
    // continua: o `resume` reabre o processo, e ele tem de reabrir onde estava.
    expect(restoration?.cwd).toBe(ONDE_RODOU)
  })

  it('retoma a conversa cujo transcript veio vazio — o portão é o inspect, e só ele', async () => {
    const { index, transcript } = createIndex({
      gravado: { [CARTAO]: SESSAO },
      conversas: [{ sessionId: SESSAO, cwd: PASTA, entries: [] }],
    })

    const restoration = await index.restore(CARTAO)

    // Um segundo portão ("tem mensagem?") criaria uma segunda definição de recuperável, e as duas
    // divergiriam. O id é válido, e retomar é inofensivo.
    expect(restoration?.sessionId).toBe(SESSAO)
    expect(restoration?.history).toEqual([])
    expect(transcript).toHaveBeenCalledWith(SESSAO)
  })
})

describe('ConversationIndex — a corrida de carga', () => {
  it('restore chamado com a carga em voo ainda enxerga o vínculo gravado', async () => {
    let liberar = (): void => {}
    const load = vi.fn(
      () =>
        new Promise<ReadonlyMap<string, string>>((resolve) => {
          liberar = () => {
            resolve(new Map([[CARTAO, SESSAO]]))
          }
        }),
    )
    const { index } = createIndex({ load, conversas: [{ sessionId: SESSAO, cwd: PASTA }] })

    const verificacao = index.refresh()
    const retomada = index.restore(CARTAO)

    // A carona é a mesma do `RepoIndex.refresh()`, e aqui ela é mais do que economia: sem ela o
    // clique dos primeiros milissegundos veria o mapa vazio, uma sessão nova nasceria, e o
    // `remember` deixaria a conversa de antes órfã.
    expect(load).toHaveBeenCalledTimes(1)

    liberar()

    expect((await retomada)?.sessionId).toBe(SESSAO)
    await verificacao
  })

  it('restore inicia a carga quando ninguém a iniciou', async () => {
    const { index, load } = createIndex({
      gravado: { [CARTAO]: SESSAO },
      conversas: [{ sessionId: SESSAO, cwd: PASTA }],
    })

    // Sem `refresh()` antes: um clique que chega na frente da verificação do boot não pode receber
    // "não há nada" só porque ninguém pediu a carga ainda.
    const restoration = await index.restore(CARTAO)

    expect(restoration?.sessionId).toBe(SESSAO)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('o init que chega durante a verificação vence o que estava no arquivo', async () => {
    const PASTA_NOVA = 'D:/onde-a-nova-subiu'
    let liberar = (): void => {}
    const load = vi.fn(
      () =>
        new Promise<ReadonlyMap<string, string>>((resolve) => {
          liberar = () => {
            resolve(new Map([[CARTAO, SESSAO]]))
          }
        }),
    )
    // As duas conversas existem no disco: a que estava gravada e a que acabou de nascer. É o caso
    // difícil de propósito — se a gravada estivesse morta, a verificação a descartaria sozinha e o
    // teste passaria sem provar nada.
    const { index } = createIndex({
      load,
      conversas: [
        { sessionId: SESSAO, cwd: PASTA },
        { sessionId: OUTRA_SESSAO, cwd: PASTA_NOVA },
      ],
    })

    const verificacao = index.refresh()
    index.remember(CARTAO, OUTRA_SESSAO)
    liberar()
    await verificacao

    // A verificação leu o arquivo de quando o app abriu; o `init` é mais novo do que ela, e o
    // registro segue o que o SDK disse. Semear por cima apontaria o vínculo para um transcript que
    // parou, e todos os turnos seguintes se perderiam em silêncio.
    expect(index.recoverable()).toEqual([CARTAO])
    expect((await index.restore(CARTAO))?.cwd).toBe(PASTA_NOVA)
  })
})

describe('ConversationIndex — sem conversa recuperável (CA-3)', () => {
  it('cartão que nunca conversou: nada no sinal, nada a retomar', async () => {
    const { index } = createIndex()

    await index.refresh()

    expect(index.recoverable()).toEqual([])
    expect(await index.restore(CARTAO)).toBeNull()
  })

  it('transcript sumiu: a entrada é podada, o arquivo é regravado, e o cartão não volta', async () => {
    // Vínculo gravado sem conversa nenhuma no disco — o arquivo apagado, ou a pasta em que a sessão
    // rodou que deixou de existir. As duas metades do CA-3 chegam aqui como o mesmo `null`.
    const { index, save } = createIndex({ gravado: { [CARTAO]: SESSAO } })

    await index.refresh()

    expect(index.recoverable()).toEqual([])
    expect(await index.restore(CARTAO)).toBeNull()

    await esperaGravar(save)
    // Podar sem regravar deixaria o registro crescer para sempre e ressuscitaria a entrada morta na
    // próxima abertura.
    expect(ultimaGravacao(save)).toEqual(new Map())
  })

  it('não regrava o arquivo quando a verificação não podou nada', async () => {
    const { index, save } = createIndex({
      gravado: { [CARTAO]: SESSAO },
      conversas: [{ sessionId: SESSAO, cwd: PASTA }],
    })

    await index.refresh()
    await assenta()

    // Ler o disco e devolvê-lo igual seria uma escrita a cada abertura do app, sem nada a registrar.
    expect(save).not.toHaveBeenCalled()
  })

  it('arquivo corrompido: o índice nasce vazio, sem exceção', async () => {
    const { index } = createIndex({ load: () => Promise.reject(new Error('JSON inválido')) })

    // Derrubar o boot por causa de um arquivo de estado seria trocar um cartão por todos. O preço
    // de não conseguir ler é um cartão que volta sem sinal, que é o próprio CA-3.
    await expect(index.refresh()).resolves.toBeUndefined()

    expect(index.recoverable()).toEqual([])
    await expect(index.restore(CARTAO)).resolves.toBeNull()
  })

  it('inspect que falha vale o mesmo que "não há o que retomar"', async () => {
    const { index } = createIndex({
      gravado: { [CARTAO]: SESSAO },
      inspect: () => Promise.reject(new Error('disco offline')),
    })

    // A ponta do main é tolerante por contrato e devolve `null`; uma que **rejeite** é bug dela — e
    // o que não se conseguiu verificar não pode ser anunciado como recuperável, nem derrubar o boot.
    await expect(index.refresh()).resolves.toBeUndefined()

    expect(index.recoverable()).toEqual([])
    await expect(index.restore(CARTAO)).resolves.toBeNull()
  })

  it('o transcript que sumiu entre a verificação e o clique é podado no restore', async () => {
    const conversas = [{ sessionId: SESSAO, cwd: PASTA }]
    const { index, save, inspect } = createIndex({ gravado: { [CARTAO]: SESSAO }, conversas })

    await index.refresh()
    expect(index.recoverable()).toEqual([CARTAO])

    // A conversa some do disco depois da verificação do boot.
    inspect.mockResolvedValue(null)

    expect(await index.restore(CARTAO)).toBeNull()
    // Deixar o vínculo no mapa faria o sinal do cartão mentir até o próximo boot.
    expect(index.recoverable()).toEqual([])
    await esperaGravar(save)
    expect(ultimaGravacao(save)).toEqual(new Map())
  })
})

describe('ConversationIndex — encerrar é definitivo (CA-4)', () => {
  it('forget tira do mapa na hora, grava, e o cartão não volta', async () => {
    const { index, save, onChange } = createIndex({
      gravado: { [CARTAO]: SESSAO, [OUTRO_CARTAO]: OUTRA_SESSAO },
      conversas: [
        { sessionId: SESSAO, cwd: PASTA },
        { sessionId: OUTRA_SESSAO, cwd: PASTA },
      ],
    })

    await index.refresh()
    onChange.mockClear()

    index.forget(CARTAO)

    // Síncrono para quem chama: o handler de `close` não espera disco.
    expect(index.recoverable()).toEqual([OUTRO_CARTAO])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(await index.restore(CARTAO)).toBeNull()

    await esperaGravar(save)
    // O cartão encerrado sai do arquivo; o vizinho fica. É a única forma que o app oferece de
    // descartar uma conversa de vez.
    expect(ultimaGravacao(save)).toEqual(new Map([[OUTRO_CARTAO, OUTRA_SESSAO]]))
  })

  it('forget de cartão sem vínculo não grava nem avisa', async () => {
    const { index, save, onChange } = createIndex()

    await index.refresh()
    onChange.mockClear()

    index.forget(CARTAO)
    await assenta()

    expect(save).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('ConversationIndex — a sessão que morreu não perde o fio (CA-5)', () => {
  it('remember seguido de restore devolve a retomada, sem reiniciar nada', async () => {
    const { index } = createIndex({
      conversas: [{ sessionId: SESSAO, cwd: PASTA, entries: [fala('u1', 'continua daqui')] }],
    })

    await index.refresh()

    // O ciclo inteiro dentro de uma execução só: a sessão nasceu, morreu sozinha, e o clique
    // seguinte reencontra o mesmo transcript. Sem isto, recuperar o contexto depois de um crash
    // exigiria fechar e reabrir o app inteiro.
    index.remember(CARTAO, SESSAO)
    const restoration = await index.restore(CARTAO)

    expect(restoration?.sessionId).toBe(SESSAO)
    expect(restoration?.cwd).toBe(PASTA)
    expect(falas(restoration?.history ?? [])).toEqual([{ role: 'user', text: 'continua daqui' }])
  })
})

describe('ConversationIndex — o vínculo segue o que o SDK disse', () => {
  it('remember sobrescreve o vínculo anterior do mesmo cartão', async () => {
    const { index, save } = createIndex({
      conversas: [
        { sessionId: SESSAO, cwd: PASTA },
        { sessionId: OUTRA_SESSAO, cwd: 'D:/outra' },
      ],
    })

    await index.refresh()
    index.remember(CARTAO, SESSAO)
    index.remember(CARTAO, OUTRA_SESSAO)

    await esperaGravar(save, 2)

    // Se um dia o SDK devolver outro id (um fork implícito, uma versão futura), o registro segue o
    // que ele disse. Um id gravado que deixasse de ser o do transcript vivo perderia todos os
    // turnos seguintes, em silêncio.
    expect(ultimaGravacao(save)).toEqual(new Map([[CARTAO, OUTRA_SESSAO]]))
    expect((await index.restore(CARTAO))?.cwd).toBe('D:/outra')
  })

  it('repetir o mesmo vínculo não grava nem avisa de novo', async () => {
    const { index, save, onChange } = createIndex({
      conversas: [{ sessionId: SESSAO, cwd: PASTA }],
    })

    await index.refresh()
    index.remember(CARTAO, SESSAO)
    await esperaGravar(save)
    onChange.mockClear()

    // É o caso comum: o `resume` reporta o mesmo id a cada turno retomado. Publicar "mudou" para
    // quem confia no aviso seria ruído a cada `init`.
    index.remember(CARTAO, SESSAO)
    await assenta()

    expect(save).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('serializa as gravações — duas sessões nascendo juntas não escrevem ao mesmo tempo', async () => {
    const liberacoes: Array<() => void> = []
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          liberacoes.push(resolve)
        }),
    )
    const { index } = createIndex({ save })

    await index.refresh()
    index.remember(CARTAO, SESSAO)
    index.remember(OUTRO_CARTAO, OUTRA_SESSAO)

    await esperaGravar(save)
    await assenta()

    // A segunda espera a primeira: sem a fila, as duas escreveriam o mesmo arquivo e o vencedor
    // seria o que o sistema de arquivos decidisse.
    expect(save).toHaveBeenCalledTimes(1)

    liberacoes[0]?.()
    await esperaGravar(save, 2)

    // Quem chega depois grava o mapa inteiro, e não só a própria entrada.
    expect(ultimaGravacao(save)).toEqual(
      new Map([
        [CARTAO, SESSAO],
        [OUTRO_CARTAO, OUTRA_SESSAO],
      ]),
    )
  })

  it('gravação que falha não trava a fila nem escapa como rejeição solta', async () => {
    const save = vi
      .fn<ConversationIndexDeps['save']>()
      .mockRejectedValueOnce(new Error('disco cheio'))
      .mockResolvedValue(undefined)
    const { index } = createIndex({ save })

    await index.refresh()
    index.remember(CARTAO, SESSAO)
    await esperaGravar(save)

    index.remember(OUTRO_CARTAO, OUTRA_SESSAO)
    await esperaGravar(save, 2)

    // `remember` é síncrono para quem chama, então ninguém lá fora tem como capturar esta falha —
    // e um elo rejeitado levaria junto todas as gravações seguintes.
    expect(ultimaGravacao(save)).toEqual(
      new Map([
        [CARTAO, SESSAO],
        [OUTRO_CARTAO, OUTRA_SESSAO],
      ]),
    )
  })
})

describe('ConversationIndex — o aviso de mudança', () => {
  it('avisa quando a verificação do boot encontra vínculo gravado', async () => {
    const { index, onChange } = createIndex({
      gravado: { [CARTAO]: SESSAO },
      conversas: [{ sessionId: SESSAO, cwd: PASTA }],
    })

    await index.refresh()

    // O retrato que a tela pediu na montagem pode ter voltado vazio, porque a verificação ainda não
    // tinha terminado. Sem este aviso o crachá não apareceria até a próxima mudança.
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(index.recoverable()).toEqual([CARTAO])
  })

  it('limpa o arquivo sem avisar quando o descarte não muda o que a tela vê', async () => {
    const { index, onChange, save } = createIndex({ gravado: { [CARTAO]: SESSAO } })

    await index.refresh()

    // O único vínculo gravado estava morto: o conjunto recuperável saiu de vazio e chegou a vazio.
    // O arquivo precisa encolher; a tela não tem o que redesenhar.
    expect(index.recoverable()).toEqual([])
    expect(onChange).not.toHaveBeenCalled()

    await esperaGravar(save)
    expect(ultimaGravacao(save)).toEqual(new Map())
  })

  it('avisa quando o descarte muda o que a tela vê', async () => {
    const { index, onChange } = createIndex({
      gravado: { [CARTAO]: SESSAO, [OUTRO_CARTAO]: OUTRA_SESSAO },
      conversas: [{ sessionId: OUTRA_SESSAO, cwd: PASTA }],
    })

    await index.refresh()

    expect(index.recoverable()).toEqual([OUTRO_CARTAO])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('não avisa quando a verificação não encontra nem muda nada', async () => {
    const { index, onChange } = createIndex()

    await index.refresh()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('avisa a cada vínculo novo', async () => {
    const { index, onChange } = createIndex({ conversas: [{ sessionId: SESSAO, cwd: PASTA }] })

    await index.refresh()
    index.remember(CARTAO, SESSAO)

    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
