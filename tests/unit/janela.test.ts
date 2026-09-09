/**
 * Os quatro canais da janela e o observador que os alimenta, contra dublês de `BrowserWindow` e de
 * `WebContents`.
 *
 * **O mock de `electron` tem duas metades, e não uma.** `tests/unit/danger.test.ts` mocka só
 * `ipcMain`, porque `src/main/danger.ts` só toca `ipcMain`. Aqui, sem mockar também `BrowserWindow`,
 * o `fromWebContents` devolveria `undefined`, os quatro canais resolveriam para nada, e todo caso
 * abaixo passaria **verde contra o nada**: `janela(event)?.minimize()` não chama ninguém e não
 * reclama de nada. É por isso que cada caso exige uma chamada, e o único que espera silêncio — o da
 * janela desconhecida — o exige explicitamente.
 */

import { describe, expect, it, vi } from 'vitest'

const { handlers, janelasPorSender } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => unknown>(),
  /** A segunda metade do mock: qual dublê de janela o `fromWebContents` acha para cada `sender`. */
  janelasPorSender: new Map<unknown, unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown) => unknown): void {
      handlers.set(channel, handler)
    },
  },
  BrowserWindow: {
    // `null` e não `undefined`: é o que a `BrowserWindow` real devolve para um `WebContents` que
    // não é de janela nenhuma, e o `?.` do módulo trata os dois igual — mas o tipo, não.
    fromWebContents: (sender: unknown): unknown => janelasPorSender.get(sender) ?? null,
  },
}))

import type { BrowserWindow, WebContents } from 'electron'

import { registerWindowIpc } from '../../src/main/window'
import { IPC_EVENT, IPC_INVOKE } from '../../src/shared/ipc'
import type { WindowSnapshot } from '../../src/shared/ipc'

/**
 * O dublê de janela. O estado é dele — como no Windows de verdade, onde `maximize()` e o duplo
 * clique na faixa mexem na mesma coisa —, e é isso que faz `disparar` poder mover a janela **sem**
 * passar pelos canais.
 */
function criarJanela(inicial: boolean) {
  const ouvintes = new Map<string, () => void>()
  let maximizada = inicial

  const window = {
    isMaximized: vi.fn(() => maximizada),
    maximize: vi.fn(() => {
      maximizada = true
    }),
    unmaximize: vi.fn(() => {
      maximizada = false
    }),
    minimize: vi.fn(),
    close: vi.fn(),
    // Existe **só para ser espionado sem nunca ser chamado**: sem o método aqui, o "e nunca
    // `destroy`" do caso do fechar não teria em que se apoiar.
    destroy: vi.fn(),
    on: vi.fn((evento: string, ouvinte: () => void) => {
      ouvintes.set(evento, ouvinte)
    }),
  }

  /** O que o Windows faz por fora da faixa: move o estado **e** avisa. */
  function disparar(evento: 'maximize' | 'unmaximize'): void {
    maximizada = evento === 'maximize'
    ouvintes.get(evento)?.()
  }

  return { window, disparar }
}

function montar(inicial = false) {
  handlers.clear()
  janelasPorSender.clear()

  const { window, disparar } = criarJanela(inicial)
  const publicados: WindowSnapshot[] = []
  let destruido = false

  const sender = {
    isDestroyed: () => destruido,
    send(channel: string, payload: unknown): void {
      if (channel === IPC_EVENT.window) publicados.push(payload as WindowSnapshot)
    },
  } as unknown as WebContents

  janelasPorSender.set(sender, window)

  const observar = registerWindowIpc()
  observar(window as unknown as BrowserWindow)

  /** Chama o canal como o preload chamaria: pelo `event.sender` de quem pediu. */
  function invocar(canal: string, quem: WebContents = sender): unknown {
    const handler = handlers.get(canal)
    if (!handler) throw new Error('canal não registrado: ' + canal)

    return handler({ sender: quem })
  }

  return {
    window,
    disparar,
    publicados,
    invocar,
    /** O retrato — e é ele que também inscreve o `sender` nas publicações, como o `readTheme`. */
    ler: () => invocar(IPC_INVOKE.readWindow) as WindowSnapshot,
    destruir: () => {
      destruido = true
    },
    reviver: () => {
      destruido = false
    },
  }
}

describe('cada canal resolve a janela de quem pediu', () => {
  it('`readWindow` devolve o `isMaximized()` da janela do `event.sender`', () => {
    expect(montar(true).ler()).toEqual({ maximized: true })
    expect(montar(false).ler()).toEqual({ maximized: false })
  })

  it('`minimizeWindow` minimiza', () => {
    const bancada = montar()

    bancada.invocar(IPC_INVOKE.minimizeWindow)

    expect(bancada.window.minimize).toHaveBeenCalledOnce()
  })

  it('`toggleMaximizeWindow` restaura a janela maximizada', () => {
    const bancada = montar(true)

    bancada.invocar(IPC_INVOKE.toggleMaximizeWindow)

    expect(bancada.window.unmaximize).toHaveBeenCalledOnce()
    expect(bancada.window.maximize).not.toHaveBeenCalled()
  })

  it('`toggleMaximizeWindow` maximiza a janela restaurada', () => {
    const bancada = montar(false)

    bancada.invocar(IPC_INVOKE.toggleMaximizeWindow)

    expect(bancada.window.maximize).toHaveBeenCalledOnce()
    expect(bancada.window.unmaximize).not.toHaveBeenCalled()
  })

  it('o `toggle` segue a janela quando ela muda por fora dos canais', () => {
    // A Decisão 5 escrita como caso: um renderer que decidisse pelo próprio estado erraria aqui,
    // porque nada avisou os canais de que o duplo clique na faixa já tinha maximizado.
    const bancada = montar(false)
    bancada.disparar('maximize')

    bancada.invocar(IPC_INVOKE.toggleMaximizeWindow)

    expect(bancada.window.unmaximize).toHaveBeenCalledOnce()
    expect(bancada.window.maximize).not.toHaveBeenCalled()
  })

  it('`closeWindow` chama `close`, e nunca `destroy`', () => {
    // É o `close` que dispara `window-all-closed`, e é ali que as sessões vivas são encerradas e o
    // app sai. `destroy` pularia os dois — e é uma troca que compila, passa no lint, e só aparece
    // como sessão do Claude Code órfã atrás de uma janela que sumiu.
    const bancada = montar()

    bancada.invocar(IPC_INVOKE.closeWindow)

    expect(bancada.window.close).toHaveBeenCalledOnce()
    expect(bancada.window.destroy).not.toHaveBeenCalled()
  })

  it('`WebContents` sem janela: o retrato é `false` e nenhum comando explode', () => {
    // A metade que o mock de `BrowserWindow` existe para tornar afirmável. E é o único caso em que
    // o silêncio é a resposta certa: se todos os outros também estivessem calados, seria porque o
    // mock perdeu essa metade — não porque o módulo está certo.
    const bancada = montar()
    const estranho = { isDestroyed: () => false, send: () => {} } as unknown as WebContents

    expect(bancada.invocar(IPC_INVOKE.readWindow, estranho)).toEqual({ maximized: false })
    expect(() => bancada.invocar(IPC_INVOKE.minimizeWindow, estranho)).not.toThrow()
    expect(() => bancada.invocar(IPC_INVOKE.toggleMaximizeWindow, estranho)).not.toThrow()
    expect(() => bancada.invocar(IPC_INVOKE.closeWindow, estranho)).not.toThrow()

    expect(bancada.window.minimize).not.toHaveBeenCalled()
    expect(bancada.window.close).not.toHaveBeenCalled()
  })
})

describe('o observador publica o estado da janela', () => {
  it('cada `maximize` e cada `unmaximize` publica o retrato inteiro', () => {
    const bancada = montar()
    bancada.ler()

    bancada.disparar('maximize')
    bancada.disparar('unmaximize')

    expect(bancada.publicados).toEqual([{ maximized: true }, { maximized: false }])
  })

  it('o retrato é lido da janela, e não deduzido do nome do evento', () => {
    // A janela pergunta a si mesma antes de publicar. Um `publish({ maximized: true })` fixo no
    // ouvinte de `maximize` passaria no caso acima; aqui, não.
    const bancada = montar(true)
    bancada.ler()

    bancada.disparar('unmaximize')

    expect(bancada.publicados).toEqual([{ maximized: false }])
    expect(bancada.window.isMaximized).toHaveBeenCalled()
  })

  it('quem nunca pediu o retrato não recebe publicação', () => {
    // A assinatura é o `readWindow`, como no tema: sem ele o `sender` não entrou no conjunto.
    const bancada = montar()

    bancada.disparar('maximize')

    expect(bancada.publicados).toEqual([])
  })

  it('`WebContents` destruído **sai** do conjunto, e não só deixa de receber', () => {
    const bancada = montar()
    bancada.ler()
    bancada.destruir()

    bancada.disparar('maximize')

    expect(bancada.publicados).toEqual([])

    // A prova de que ele saiu: ressuscitado, continua sem receber. Um `continue` sem o `delete`
    // deixaria esta segunda publicação chegar, e o conjunto cresceria para sempre.
    bancada.reviver()
    bancada.disparar('unmaximize')

    expect(bancada.publicados).toEqual([])
  })
})
