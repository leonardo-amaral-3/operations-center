import { describe, expect, it, vi } from 'vitest'

import { DangerIndex } from '../../src/core/session/DangerIndex'
import type { DangerIndexDeps } from '../../src/core/session/DangerIndex'

/**
 * A marca do modo *dangerously*, e a metade durável do CA-2: ela sobrevive a fechar e reabrir o app,
 * e vale para a próxima sessão daquele cartão mesmo sem nenhuma viva agora.
 *
 * Os dois modos de falha são assimétricos, e é por isso que a corrida de carga tem teste e não só
 * comentário. Perder uma marca é barato — o cartão volta com portão, que é o comportamento de hoje.
 * Perder a marca **dos outros cartões** por causa de um clique nos primeiros milissegundos do app é
 * caro e silencioso: ninguém liga o modo duas vezes para conferir. E ressuscitar um cartão que esta
 * execução desmarcou é pior ainda, porque falha para o lado **inseguro** — uma sessão sem portão que
 * o usuário achava ter desligado.
 */

const CARTAO = 'PVTI_card-10'
const OUTRO_CARTAO = 'PVTI_card-22'

interface Opcoes {
  /** O que estava no arquivo quando o app abriu. */
  gravado?: readonly string[]
  /** Para os casos em que a própria leitura é o assunto (arquivo ilegível, carga em voo). */
  load?: DangerIndexDeps['load']
  /** Para os casos em que a gravação é o assunto (fila, falha). */
  save?: DangerIndexDeps['save']
}

function createIndex(opcoes: Opcoes = {}) {
  const load = vi.fn(
    opcoes.load ??
      ((): Promise<ReadonlySet<string>> => Promise.resolve(new Set(opcoes.gravado ?? []))),
  )
  const save = vi.fn(opcoes.save ?? ((): Promise<void> => Promise.resolve()))
  const onChange = vi.fn()

  const index = new DangerIndex({ load, save, onChange })

  return { index, load, save, onChange }
}

type Save = ReturnType<typeof createIndex>['save']

/** `set` agenda a gravação e não a espera; o teste espera por ela. */
async function esperaGravar(save: Save, vezes = 1): Promise<void> {
  await vi.waitFor(() => {
    expect(save).toHaveBeenCalledTimes(vezes)
  })
}

/** O que a última gravação levou para o disco. */
function ultimaGravacao(save: Save): ReadonlySet<string> {
  return save.mock.calls.at(-1)?.[0] ?? new Set()
}

/** Deixa todo microtask pendente girar — é como se prova que algo **não** foi agendado. */
async function assenta(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('DangerIndex — a marca que a tela vê (CA-2)', () => {
  it('não mostra marca nenhuma antes da carga terminar', () => {
    const { index } = createIndex({ gravado: [CARTAO] })

    // O crachá pode nascer ausente e chegar pelo aviso depois; o que ele não pode é sair de um mapa
    // pela metade, aparecendo e sumindo enquanto o disco responde.
    expect(index.dangerous()).toEqual([])
  })

  it('a carga do boot traz o que estava gravado e avisa quem já desenhou a tela vazia', async () => {
    const { index, onChange } = createIndex({ gravado: [CARTAO] })

    await index.refresh()

    expect(index.dangerous()).toEqual([CARTAO])
    // O retrato que a tela pediu na montagem voltou vazio, porque a carga ainda não tinha terminado.
    // Sem este aviso o crachá só apareceria na próxima mudança — ou seja, no próximo clique.
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('não avisa quando não havia nada gravado', async () => {
    const { index, onChange } = createIndex()

    await index.refresh()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('marcar publica na hora e agenda a gravação', async () => {
    const { index, save, onChange } = createIndex()

    await index.refresh()

    index.set(CARTAO, true)

    // Síncrono para quem chama: o handler do IPC não espera disco para responder.
    expect(index.dangerous()).toEqual([CARTAO])
    expect(onChange).toHaveBeenCalledTimes(1)

    await esperaGravar(save)
    expect(ultimaGravacao(save)).toEqual(new Set([CARTAO]))
  })

  it('desmarcar tira do retrato e do arquivo, sem tirar o vizinho', async () => {
    const { index, save, onChange } = createIndex({ gravado: [CARTAO, OUTRO_CARTAO] })

    await index.refresh()
    onChange.mockClear()

    index.set(CARTAO, false)

    // O retrato traz só os marcados: o `false` é memória do índice, não linha do arquivo.
    expect(index.dangerous()).toEqual([OUTRO_CARTAO])
    expect(onChange).toHaveBeenCalledTimes(1)

    await esperaGravar(save)
    expect(ultimaGravacao(save)).toEqual(new Set([OUTRO_CARTAO]))
  })

  it('repetir a marca não publica nem grava de novo', async () => {
    const { index, save, onChange } = createIndex()

    await index.refresh()
    index.set(CARTAO, true)
    await esperaGravar(save)
    onChange.mockClear()

    index.set(CARTAO, true)
    await assenta()

    // Publicar "mudou" para quem confia no aviso seria a tela redesenhando o kanban inteiro por uma
    // marcação que não mudou nada.
    expect(save).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a carga não regrava o arquivo: o índice não verifica nem poda', async () => {
    const SUMIU_DO_BOARD = 'PVTI_card-que-ninguem-mais-ve'
    const { index, save } = createIndex({ gravado: [SUMIU_DO_BOARD] })

    await index.refresh()
    await assenta()

    // Uma marca não aponta para nada lá fora — ela é uma decisão do usuário. Podar exigiria dar o
    // board ao core, que ele não tem e não deve ter; a linha inerte no JSON é mais barata.
    expect(index.dangerous()).toEqual([SUMIU_DO_BOARD])
    expect(save).not.toHaveBeenCalled()
  })
})

describe('DangerIndex — a corrida de carga', () => {
  it('isDangerous espera a carga, mesmo sem ninguém ter chamado refresh', async () => {
    const { index, load } = createIndex({ gravado: [CARTAO] })

    // Sem `refresh()` antes: o clique dos primeiros milissegundos depois da abertura. Responder
    // `false` aqui faria a sessão nascer com portão num cartão marcado, e o CA-1 falharia numa volta
    // em que ninguém desconfia — não há erro na tela, porque pedir permissão é estado previsto.
    expect(await index.isDangerous(CARTAO)).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a pergunta que chega com a carga em voo pega carona nela', async () => {
    let liberar = (): void => {}
    const load = vi.fn(
      () =>
        new Promise<ReadonlySet<string>>((resolve) => {
          liberar = () => {
            resolve(new Set([CARTAO]))
          }
        }),
    )
    const { index } = createIndex({ load })

    const carga = index.refresh()
    const resposta = index.isDangerous(CARTAO)

    expect(load).toHaveBeenCalledTimes(1)

    liberar()

    expect(await resposta).toBe(true)
    await carga
  })

  it('arquivo ilegível: o índice nasce vazio, sem exceção', async () => {
    const { index } = createIndex({ load: () => Promise.reject(new Error('JSON inválido')) })

    // Derrubar o boot por causa de um arquivo de estado seria trocar um cartão por todos. O preço de
    // não conseguir ler é um cartão que volta com portão — o comportamento de hoje.
    await expect(index.refresh()).resolves.toBeUndefined()

    expect(index.dangerous()).toEqual([])
    await expect(index.isDangerous(CARTAO)).resolves.toBe(false)
  })
})

describe('DangerIndex — a gravação espera a carga', () => {
  it('um set antes da carga não apaga as marcas dos outros cartões', async () => {
    const { index, save } = createIndex({ gravado: [OUTRO_CARTAO] })

    // Sem `refresh()` antes: marcar um cartão nos primeiros milissegundos do app. Sem o elo de carga
    // no `#persist`, isto gravaria um arquivo com **um** cartão e apagaria as marcas de todos os
    // outros — e ninguém descobriria antes de reabrir o app.
    index.set(CARTAO, true)

    await esperaGravar(save)

    expect(ultimaGravacao(save)).toEqual(new Set([OUTRO_CARTAO, CARTAO]))
    expect(index.dangerous()).toEqual([CARTAO, OUTRO_CARTAO])
  })

  it('o cartão desmarcado nesta execução não é ressuscitado pela carga', async () => {
    const { index, save, load } = createIndex({ gravado: [CARTAO] })

    await index.refresh()
    index.set(CARTAO, false)

    // O `#persist` relê o disco antes de gravar, e o disco ainda diz que o cartão está marcado — é
    // exatamente ali que um `Set` sem o terceiro estado o traria de volta, desfazendo o clique.
    await esperaGravar(save)
    expect(load).toHaveBeenCalledTimes(2)
    expect(ultimaGravacao(save)).toEqual(new Set())
    expect(index.dangerous()).toEqual([])
    expect(await index.isDangerous(CARTAO)).toBe(false)
  })

  it('desmarcar antes da carga vence o arquivo em vez de ser desfeito por ele', async () => {
    const { index, save } = createIndex({ gravado: [CARTAO, OUTRO_CARTAO] })

    // `undefined` não é `false`: o índice nunca ouviu falar deste cartão, então desmarcá-lo **é**
    // mudança e vira o terceiro estado do mapa. Tratar os dois como iguais faria a carga seguinte
    // remarcar o cartão, e o modo continuaria ligado num cartão que o usuário desligou.
    index.set(CARTAO, false)

    await esperaGravar(save)

    expect(ultimaGravacao(save)).toEqual(new Set([OUTRO_CARTAO]))
    expect(await index.isDangerous(CARTAO)).toBe(false)
  })
})

describe('DangerIndex — a fila de gravação', () => {
  it('serializa as gravações — duas marcas seguidas não disputam o arquivo', async () => {
    const liberacoes: Array<() => void> = []
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          liberacoes.push(resolve)
        }),
    )
    const { index } = createIndex({ save })

    await index.refresh()
    index.set(CARTAO, true)
    index.set(OUTRO_CARTAO, true)

    await esperaGravar(save)
    await assenta()

    // A segunda espera a primeira: sem a fila, as duas escreveriam o mesmo arquivo e o vencedor
    // seria o que o sistema de arquivos decidisse.
    expect(save).toHaveBeenCalledTimes(1)

    liberacoes[0]?.()
    await esperaGravar(save, 2)

    // Quem chega depois grava o conjunto inteiro, e não só a própria marca.
    expect(ultimaGravacao(save)).toEqual(new Set([CARTAO, OUTRO_CARTAO]))
  })

  it('gravação que falha não trava a fila nem escapa como rejeição solta', async () => {
    const save = vi
      .fn<DangerIndexDeps['save']>()
      .mockRejectedValueOnce(new Error('disco cheio'))
      .mockResolvedValue(undefined)
    const { index } = createIndex({ save })

    await index.refresh()
    index.set(CARTAO, true)
    await esperaGravar(save)

    index.set(OUTRO_CARTAO, true)
    await esperaGravar(save, 2)

    // `set` é síncrono para quem chama, então ninguém lá fora tem como capturar esta falha — e um
    // elo rejeitado levaria junto todas as gravações seguintes.
    expect(ultimaGravacao(save)).toEqual(new Set([CARTAO, OUTRO_CARTAO]))
  })
})
