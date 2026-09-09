/**
 * A combinação de cores corrente, e o canal por onde o humano a troca sem reiniciar o app.
 *
 * Cópia estrutural de `src/main/danger.ts`: o valor em memória, o registro de IPC, o conjunto de
 * assinantes com limpeza de `WebContents` destruído, e a publicação do retrato inteiro a cada
 * mudança. O que não se copia é a fila de gravação — ver `saveTheme` lá embaixo.
 *
 * **Por que este módulo não mora dentro de `src/main/theme.ts`:** aquele é puro — só matemática de
 * cor sobre a folha —, e `tests/unit/theme.test.ts` o importa **sem mockar `electron`**. Um
 * `import { ipcMain }` ali obrigaria aquele teste a levantar um mock do Electron inteiro para
 * exercitar conversão de cor. É a mesma separação que `sheet.ts` e `theme.ts` já praticam, aplicada
 * de novo — e ela é verificável: apague este arquivo, mova o conteúdo para lá, e o teste daquele
 * módulo passa a precisar de `vi.mock('electron')`.
 */

import { ipcMain } from 'electron'
import type { WebContents } from 'electron'

import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type { SetThemeRequest, ThemeSnapshot } from '../shared/ipc'
import { isTheme } from '../shared/theme'
import type { Theme } from '../shared/theme'
import { saveTheme } from './preferences'

/**
 * Liga os canais da combinação de cores, partindo da que a precedência do boot já escolheu.
 *
 * `inicial` chega pronta — `OC_THEME`, depois o cofre, depois a default — porque quem sabe ler o
 * disco é o `index.ts`, e porque a janela **já nasceu** com essa cor: este módulo não escolhe a
 * primeira, só as seguintes.
 *
 * `onChange` é a referência para a frente que repinta a janela viva, e existe por um buraco
 * concreto: o `backgroundColor` de uma `BrowserWindow` é fixado na construção e **não** acompanha a
 * troca em tempo de execução. Sem ele, um app que trocou para a obsidiana e depois é redimensionado
 * mostra a lavanda na faixa que o Chromium ainda não pintou. Este módulo não conhece a janela — o
 * mesmo recurso, e a mesma razão, de `publicarConversas` e `publicarPerigo`.
 */
export function registerThemeIpc(inicial: Theme, onChange: (theme: Theme) => void): void {
  const subscribers = new Set<WebContents>()

  // O valor corrente vive **aqui**, e não em disco: o disco é onde ele é lembrado para a próxima
  // abertura, não onde ele é consultado. Ver o `catch` da gravação lá embaixo.
  let corrente = inicial

  function publish(): void {
    const proximo: ThemeSnapshot = { theme: corrente }

    for (const sender of subscribers) {
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        continue
      }

      sender.send(IPC_EVENT.theme, proximo)
    }
  }

  ipcMain.handle(IPC_INVOKE.readTheme, (event): ThemeSnapshot => {
    subscribers.add(event.sender)

    // Nunca sai vazio, ao contrário do retrato do `danger.ts`: não há carga assíncrona nenhuma a
    // esperar, porque a combinação já era conhecida antes de a janela existir — é o que o CA-4
    // cobra. Quem pede aqui recebe a verdade corrente na primeira resposta.
    return { theme: corrente }
  })

  ipcMain.handle(IPC_INVOKE.setTheme, (_event, request: SetThemeRequest): void => {
    // **Ignorado em silêncio**, e não rejeitado — o mesmo que `activateBoard` faz com chave que não
    // reconhece. O tipo do contrato já é `Theme`, então nome torto aqui é renderer comprometido ou
    // bug nosso, e nos dois casos derrubar o `invoke` só trocaria uma cor que não muda por uma
    // exceção na tela. A tela segue o retrato publicado, então ela simplesmente não se move.
    if (!isTheme(request.theme)) return

    // A ordem é o CA-3: memória, tela, janela — e o disco por último, fora do caminho crítico.
    // Trocar de cor não espera o `writeState`.
    //
    // Sem atalho para `request.theme === corrente`: republicar o retrato inteiro num clique
    // redundante é o que conserta uma tela que tenha divergido, e é a mesma postura do
    // `ConversationsSnapshot` e do `DangerousSnapshot` — retrato inteiro, nunca delta.
    corrente = request.theme
    publish()
    onChange(corrente)

    // **A memória é a verdade, o disco é o melhor esforço.** A falha é absorvida como a da fila do
    // `DangerIndex`, e pela mesma razão: não há ninguém acima com como capturá-la, e o preço de não
    // gravar é a *próxima* abertura vir na cor antiga — não a sessão corrente perder a cor que o
    // humano acabou de escolher. Derrubar aqui seria trocar um dano de uma abertura por um erro na
    // tela agora.
    //
    // **Mas registrada, ao contrário da do `DangerIndex`** — e a assimetria tem razão. Lá a falha
    // se anuncia sozinha: o cartão volta *com* portão, na cara de quem marcou. Aqui nada na tela
    // denuncia nada — a cor troca, a sessão inteira parece perfeita, e só a *próxima* abertura vem
    // errada, longe demais da causa para alguém ligar as duas. Esta linha é a única chance de o log
    // dizer "o disco recusou" a quem for investigar por que a escolha não cola.
    void saveTheme(corrente).catch((erro: unknown) => {
      console.error('operations-center: não foi possível gravar a combinação escolhida', erro)
    })
  })
}
