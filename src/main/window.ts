/**
 * O estado da janela, e os três comandos da faixa que tomou o lugar da barra de título do sistema.
 *
 * Cópia estrutural de `src/main/appearance.ts`: o conjunto de assinantes, a publicação do retrato
 * inteiro a cada mudança, e a limpeza de `WebContents` destruído. O que **não** se copia é o valor
 * em memória — aqui a verdade é da própria `BrowserWindow`, e guardar uma segunda cópia dela seria
 * inventar uma fonte que pode discordar do Windows: a janela maximiza por duplo clique na faixa,
 * por `Win+↑` e por arrasto para o topo, e nenhum desses caminhos passa por este módulo.
 *
 * **Por que ele não mora em `appearance.ts`:** aquele é a *combinação de cores*, e o teste dele
 * exercita conversão de cor; este é a *janela*. Juntá-los faria um módulo cujo nome só poderia ser
 * "coisas do Electron".
 */

import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'

import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type { WindowSnapshot } from '../shared/ipc'

/**
 * A janela de quem pediu.
 *
 * **Os quatro canais não conhecem janela nenhuma**: cada um resolve a sua pelo `event.sender` — o
 * mesmo recurso, e a mesma razão, do `chooseFolder` de `index.ts`. Quem pediu é quem responde, e
 * não uma referência de módulo que pode estar apontando para outra coisa.
 */
function janela(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/**
 * Liga os canais da janela e devolve o observador que pendura os eventos dela.
 *
 * O observador existe porque o **evento** precisa da janela: `maximize` e `unmaximize` são dela, e
 * quem registra o canal roda **antes** de `createWindow` — tem de rodar, pelo mesmo motivo de
 * `registerThemeIpc`: o renderer pede o primeiro retrato assim que monta, e um canal registrado
 * depois da janela seria uma corrida contra o próprio boot.
 */
export function registerWindowIpc(): (window: BrowserWindow) => void {
  const subscribers = new Set<WebContents>()

  function publish(proximo: WindowSnapshot): void {
    for (const sender of subscribers) {
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        continue
      }

      sender.send(IPC_EVENT.window, proximo)
    }
  }

  ipcMain.handle(IPC_INVOKE.readWindow, (event): WindowSnapshot => {
    subscribers.add(event.sender)

    // O `?? false` é formalidade de tipo — quem invoca tem `WebContents` vivo, senão não haveria de
    // onde invocar —, e a reserva é `false` porque é o que uma janela que não existe mais não está.
    return { maximized: janela(event)?.isMaximized() ?? false }
  })

  ipcMain.handle(IPC_INVOKE.minimizeWindow, (event): void => {
    janela(event)?.minimize()
  })

  ipcMain.handle(IPC_INVOKE.toggleMaximizeWindow, (event): void => {
    const window = janela(event)
    if (!window) return

    // **A decisão é daqui, e não do renderer.** Um renderer que escolhesse pelo próprio estado
    // erraria toda vez que a janela mudasse por fora dele — duplo clique na faixa, `Win+↑`,
    // arrastar para o topo. Ele manda a intenção; o estado é da janela.
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.handle(IPC_INVOKE.closeWindow, (event): void => {
    // **`close()` e não `destroy()`**: é o `close` que dispara `window-all-closed`, e é ali que
    // `sessionIpc.closeAll()` e `app.quit()` moram desde o #1. `destroy()` pularia os dois e
    // deixaria sessões do Claude Code vivas atrás de uma janela que sumiu — e é uma troca que
    // compila, por isso o teste a vigia.
    janela(event)?.close()
  })

  return (window) => {
    // O retrato é lido da janela, e não deduzido do nome do evento: o que atravessa a ponte é o
    // estado, nunca a intenção.
    const publicar = (): void => {
      publish({ maximized: window.isMaximized() })
    }

    window.on('maximize', publicar)
    window.on('unmaximize', publicar)
  }
}
