// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClaudeScope } from '../../src/shared/claude'
import { instalarOc } from './fakeOc'
import type { OcFake } from './fakeOc'

/**
 * O registro de instâncias do terminal Claude (#97 §9), sem o xterm de verdade: o `Terminal` é um
 * dublê que guarda o que recebeu em `write`, os ouvintes de `onData` e se foi destruído. O módulo é
 * um singleton, então cada caso o importa de novo (`vi.resetModules`).
 */

interface Dublê {
  escrito: string[]
  destruido: boolean
  digitou: Array<(data: string) => void>
}

const { termos } = vi.hoisted(() => ({ termos: [] as Dublê[] }))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  },
}))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    readonly #d: Dublê = { escrito: [], destruido: false, digitou: [] }
    constructor() {
      termos.push(this.#d)
    }
    loadAddon(): void {}
    open(): void {}
    write(texto: string): void {
      this.#d.escrito.push(texto)
    }
    focus(): void {}
    dispose(): void {
      this.#d.destruido = true
    }
    hasSelection(): boolean {
      return false
    }
    attachCustomKeyEventHandler(): void {}
    onData(ouvinte: (data: string) => void): { dispose(): void } {
      this.#d.digitou.push(ouvinte)

      return { dispose: () => undefined }
    }
    onResize(): { dispose(): void } {
      return { dispose: () => undefined }
    }
  },
}))

const CARTAO: ClaudeScope = { kind: 'card', itemId: 'item_1' }

let oc: OcFake
let registro: typeof import('../../src/renderer/terminal/claudeTerminals')

beforeEach(async () => {
  termos.length = 0
  vi.resetModules()
  oc = instalarOc()
  registro = await import('../../src/renderer/terminal/claudeTerminals')
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function contêiner(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)

  return el
}

describe('claudeTerminals', () => {
  it('attach, detach e attach de novo reusam a mesma instância e abrem uma vez só', async () => {
    const a = contêiner()
    const b = contêiner()

    await registro.attach(CARTAO, a)
    const wrapper = a.firstElementChild
    registro.detach(CARTAO)
    expect(a.childElementCount).toBe(0)

    await registro.attach(CARTAO, b)

    expect(termos).toHaveLength(1)
    expect(oc.claudeAbertos).toHaveLength(1)
    expect(b.firstElementChild).toBe(wrapper)
  })

  it('dois attach com abertura em voo devolvem a mesma promessa', async () => {
    const segura = oc.segurarClaude()
    const primeira = registro.attach(CARTAO, contêiner())
    const segunda = registro.attach(CARTAO, contêiner())

    expect(segunda).toBe(primeira)
    segura.soltar()
    await primeira

    expect(oc.claudeAbertos).toHaveLength(1)
  })

  it('o dado que chega antes da resposta do open é escrito depois dela', async () => {
    const segura = oc.segurarClaude()
    const abrindo = registro.attach(CARTAO, contêiner())

    oc.publicarDado({ id: 'claude_1', data: 'oi' })
    expect(termos[0]?.escrito).toEqual([])

    segura.soltar()
    await abrindo

    expect(termos[0]?.escrito).toEqual(['oi'])
  })

  it('o dado de id desconhecido sem abertura em voo é descartado', async () => {
    await registro.attach(CARTAO, contêiner())

    oc.publicarDado({ id: 'pty_do_dock', data: 'ruído' })
    oc.publicarDado({ id: 'claude_1', data: 'ok' })

    expect(termos[0]?.escrito).toEqual(['ok'])
  })

  it('exit escreve o aviso e Enter abre de novo', async () => {
    await registro.attach(CARTAO, contêiner())

    oc.publicarSaida({ id: 'claude_1', exitCode: 0 })
    expect(termos[0]?.escrito.join('')).toContain('Enter retoma')

    termos[0]?.digitou[0]?.('\r')
    await vi.waitFor(() => expect(oc.claudeAbertos).toHaveLength(2))
    expect(oc.escritos).toHaveLength(0)
  })

  it('closed com a entrada desmontada destrói a instância', async () => {
    await registro.attach(CARTAO, contêiner())
    registro.detach(CARTAO)

    oc.publicarEstadoClaude({
      scope: CARTAO,
      id: 'claude_1',
      state: { kind: 'closed' },
      dangerous: false,
    })

    expect(termos[0]?.destruido).toBe(true)
  })

  it('closed com a entrada montada não destrói', async () => {
    await registro.attach(CARTAO, contêiner())

    oc.publicarEstadoClaude({
      scope: CARTAO,
      id: 'claude_1',
      state: { kind: 'closed' },
      dangerous: false,
    })

    expect(termos[0]?.destruido).toBe(false)
  })

  it('end espera o closeClaude e destrói; o attach seguinte cria outra', async () => {
    await registro.attach(CARTAO, contêiner())

    await registro.end(CARTAO)

    expect(oc.claudeFechados).toEqual([{ scope: CARTAO }])
    expect(termos[0]?.destruido).toBe(true)

    await registro.attach(CARTAO, contêiner())
    expect(termos).toHaveLength(2)
  })

  it('open que falha apaga a entrada e devolve o motivo', async () => {
    oc.responderClaude({ ok: false, reason: 'unknown-folder' })

    const resultado = await registro.attach(CARTAO, contêiner())

    expect(resultado).toEqual({ ok: false, reason: 'unknown-folder' })
    expect(termos[0]?.destruido).toBe(true)
  })
})
