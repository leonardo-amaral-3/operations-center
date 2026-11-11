import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, pedido?: unknown) => unknown>(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle(canal: string, handler: (event: unknown, pedido?: unknown) => unknown): void {
      handlers.set(canal, handler)
    },
  },
}))

import { urlDoCard } from '../../src/core/fabrica/sala'
import type { Despacho, EstadoDaFabrica } from '../../src/core/fabrica/tipos'
import { criarAssumir, registerAssumirIpc } from '../../src/main/fabrica/assumir'
import type { DepsDoAssumir } from '../../src/main/fabrica/assumir'
import { IPC_INVOKE } from '../../src/shared/ipc'

/**
 * Assumir a sessão de um despacho (#133, CA-4.2, F4.6). Dependências falsas: nada aqui toca o
 * `conversations.json` real nem a pasta da fábrica.
 */

const SESSAO = '754097b5-1111-4222-8333-444455556666'
const OUTRA = '9339221c-1111-4222-8333-444455556666'
const PEDIDO = { despacho: 'd-0004', itemId: 'PVTI_a' }

function despacho(over: Partial<Despacho> = {}): Despacho {
  return {
    id: 'd-0004',
    frente: 'f-0001',
    card: 133,
    comando: '/gm-implement x (#133)',
    nota: null,
    estado: 'concluido',
    pid: null,
    criadoEm: '2026-11-11T10:00:00.000Z',
    lancadoEm: '2026-11-11T10:00:01.000Z',
    concluidoEm: '2026-11-11T10:05:00.000Z',
    sessaoClaude: SESSAO,
    desfecho: null,
    ...over,
  }
}

function estadoCom(...despachos: Despacho[]): EstadoDaFabrica {
  return { despachos } as unknown as EstadoDaFabrica
}

function montar(over: Partial<DepsDoAssumir> = {}) {
  const deps = {
    lerEstado: vi.fn((): EstadoDaFabrica | null => estadoCom(despacho())),
    cardDoItem: vi.fn(() => ({ number: 133, url: urlDoCard(133) })),
    sessaoAberta: vi.fn((): string | null => null),
    conversaDoCartao: vi.fn((): Promise<string | null> => Promise.resolve(null)),
    transcriptExiste: vi.fn(() => Promise.resolve(true)),
    janelasDePe: vi.fn(() => true),
    lembrar: vi.fn(),
    abrirJanela: vi.fn(),
    ...over,
  }
  return { deps, assumir: criarAssumir(deps) }
}

async function recusa(over: Partial<DepsDoAssumir>, pedido: unknown = PEDIDO, motivo: string) {
  const t = montar(over)
  expect(await t.assumir(pedido)).toEqual({ ok: false, motivo })
  expect(t.deps.lembrar).not.toHaveBeenCalled()
  expect(t.deps.abrirJanela).not.toHaveBeenCalled()
}

describe('criarAssumir — as doze recusas, nada gravado', () => {
  it.each([
    ['null', null],
    ['string', 'd-0004'],
    ['despacho fora do formato', { despacho: 'x-1', itemId: 'a' }],
    ['despacho que não é string', { despacho: 4, itemId: 'a' }],
    ['itemId vazio', { despacho: 'd-0004', itemId: '' }],
    ['itemId que não é string', { despacho: 'd-0004', itemId: 7 }],
  ])('1. pedido inválido (%s)', async (_n, pedido) => {
    await recusa({}, pedido, 'pedido inválido')
  })

  it('2. sem estado.json', async () => {
    await recusa({ lerEstado: () => null }, PEDIDO, 'a fábrica não tem estado.json')
  })

  it('3. despacho ausente', async () => {
    await recusa({ lerEstado: () => estadoCom() }, PEDIDO, 'não há despacho d-0004 na fábrica')
  })

  it('4. pendente', async () => {
    await recusa(
      { lerEstado: () => estadoCom(despacho({ estado: 'pendente' })) },
      PEDIDO,
      'o d-0004 ainda não subiu: só dá para assumir a sessão depois que ela termina',
    )
  })

  it.each(['lancando', 'rodando'] as const)('4. %s', async (estado) => {
    await recusa(
      { lerEstado: () => estadoCom(despacho({ estado })) },
      PEDIDO,
      'a sessão do d-0004 ainda está rodando: só dá para assumir depois que ela termina',
    )
  })

  it('5. outro despacho do mesmo card em voo', async () => {
    const outro = despacho({ id: 'd-0005', estado: 'rodando', sessaoClaude: null })
    await recusa(
      { lerEstado: () => estadoCom(despacho(), outro) },
      PEDIDO,
      'o #133 tem despacho em voo (d-0005): só dá para assumir depois que ele termina',
    )
  })

  it('6. terminou sem id de sessão', async () => {
    await recusa(
      { lerEstado: () => estadoCom(despacho({ sessaoClaude: null })) },
      PEDIDO,
      'o d-0004 terminou sem id de sessão: não há o que retomar',
    )
  })

  it('7. card fora dos boards abertos', async () => {
    await recusa({ cardDoItem: () => null }, PEDIDO, 'o card não está num board aberto no app')
  })

  it('7. número ou URL do card diferentes', async () => {
    const msg = 'o card do pedido não é o #133 do d-0004'
    await recusa({ cardDoItem: () => ({ number: 9, url: urlDoCard(133) }) }, PEDIDO, msg)
    await recusa(
      { cardDoItem: () => ({ number: 133, url: 'https://github.com/outro/repo/issues/133' }) },
      PEDIDO,
      msg,
    )
  })

  it('8. terminal aberto em outra conversa', async () => {
    await recusa(
      { sessaoAberta: () => OUTRA },
      PEDIDO,
      'o terminal deste card está aberto em outra conversa: feche-o antes de assumir',
    )
  })

  it('9. transcript fora desta máquina', async () => {
    await recusa(
      { transcriptExiste: () => Promise.resolve(false) },
      PEDIDO,
      `o transcript da sessão ${SESSAO} não está nesta máquina`,
    )
  })

  it('10. janelas de card fora de pé', async () => {
    await recusa({ janelasDePe: () => false }, PEDIDO, 'as janelas de card não estão de pé')
  })
})

describe('criarAssumir — o caminho feliz', () => {
  it('lembra a sessão no cartão e abre a janela, nesta ordem', async () => {
    const ordem: string[] = []
    const t = montar({
      lembrar: vi.fn(() => void ordem.push('lembrar')),
      abrirJanela: vi.fn(() => void ordem.push('abrir')),
    })

    expect(await t.assumir(PEDIDO)).toEqual({ ok: true, anterior: null })
    expect(t.deps.lembrar).toHaveBeenCalledWith('PVTI_a', SESSAO)
    expect(t.deps.abrirJanela).toHaveBeenCalledWith('PVTI_a')
    expect(ordem).toEqual(['lembrar', 'abrir'])
  })

  it('devolve a conversa anterior do cartão quando era outra', async () => {
    const t = montar({ conversaDoCartao: () => Promise.resolve(OUTRA) })
    expect(await t.assumir(PEDIDO)).toEqual({ ok: true, anterior: OUTRA })
  })

  it('anterior é null quando o cartão já tinha esta mesma sessão', async () => {
    const t = montar({ conversaDoCartao: () => Promise.resolve(SESSAO) })
    expect(await t.assumir(PEDIDO)).toEqual({ ok: true, anterior: null })
  })

  it('o terminal vivo na mesma sessão não impede', async () => {
    const t = montar({ sessaoAberta: () => SESSAO })
    expect(await t.assumir(PEDIDO)).toEqual({ ok: true, anterior: null })
    expect(t.deps.lembrar).toHaveBeenCalledTimes(1)
  })

  it('despacho concluído de outro card não bloqueia', async () => {
    const outroCard = despacho({ id: 'd-0009', card: 50, estado: 'rodando', sessaoClaude: null })
    const t = montar({ lerEstado: () => estadoCom(despacho(), outroCard) })
    expect(await t.assumir(PEDIDO)).toEqual({ ok: true, anterior: null })
  })
})

describe('criarAssumir — nunca rejeita', () => {
  it('dependência que lança (síncrona) vira ok:false com a mensagem', async () => {
    const t = montar({
      lerEstado: () => {
        throw new Error('estado.json ilegível')
      },
    })
    expect(await t.assumir(PEDIDO)).toEqual({ ok: false, motivo: 'estado.json ilegível' })
  })

  it('dependência que rejeita (assíncrona) vira ok:false, sem lembrar', async () => {
    const t = montar({ transcriptExiste: () => Promise.reject(new Error('sdk caiu')) })
    expect(await t.assumir(PEDIDO)).toEqual({ ok: false, motivo: 'sdk caiu' })
    expect(t.deps.lembrar).not.toHaveBeenCalled()
  })

  it('exceção depois do lembrar também vira ok:false', async () => {
    const t = montar({
      abrirJanela: () => {
        throw new Error('janela caiu')
      },
    })
    expect(await t.assumir(PEDIDO)).toEqual({ ok: false, motivo: 'janela caiu' })
  })
})

describe('registerAssumirIpc', () => {
  beforeEach(() => handlers.clear())

  it('liga o canal fabrica:assumir ao assumir', async () => {
    const assumir = vi.fn(() => Promise.resolve({ ok: true as const, anterior: null }))
    registerAssumirIpc(assumir)

    const h = handlers.get(IPC_INVOKE.assumirDespacho)!
    expect(IPC_INVOKE.assumirDespacho).toBe('fabrica:assumir')
    expect(await h({}, PEDIDO)).toEqual({ ok: true, anterior: null })
    expect(assumir).toHaveBeenCalledWith(PEDIDO)
  })
})
