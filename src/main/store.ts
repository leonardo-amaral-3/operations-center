/**
 * O cofre do estado durável do app: onde ele mora em disco, e as duas pontas de IO que todo arquivo
 * dele repetiria palavra por palavra.
 *
 * Nasceu de `conversations.ts`, quando o segundo arquivo de estado — o `preferences.json` da aba
 * lembrada — ia copiar o `mkdir`/`writeFile`/`rename` e o `JSON.parse` defensivo inteiros. Hoje
 * serve três: `conversations.json`, `dangerous.json` e `preferences.json`. É
 * exatamente o que o comentário do `stateDir()` de lá antecipava: **a porta de ambiente é a pasta; o
 * nome do arquivo é detalhe interno**. Com a pasta compartilhada, o segundo arquivo custa um nome e
 * uma função de interpretação — não uma segunda variável de ambiente nem uma segunda escrita atômica.
 *
 * O nome é `store` e não `state` porque `src/core/session/state.ts` já existe, com o seu
 * `tests/unit/state.test.ts`: dois módulos `state` no mesmo projeto seria confusão gratuita num nome
 * que aparece em todo import.
 *
 * **Este módulo absorveu o `src/main/state.ts` do #10.** As duas extrações nasceram em paralelo, da
 * mesma pressão e do mesmo arquivo: o #10 tirou de `conversations.ts` o `stateDir` e um
 * `escreverAtomico`, para o `dangerous.json`; o #32 tirou os mesmos e mais o `JSON.parse` defensivo,
 * para o `preferences.json`. Mantê-los seria ter dois endereços para a mesma pasta. Ficou este por
 * ser o superconjunto — o `readState` cobre a leitura tolerante, que o outro deixava em cada
 * chamador — e porque `main/state.ts` era justamente o nome que o parágrafo acima recusa.
 *
 * O que **não** mora aqui é a interpretação do formato — versão, forma do conteúdo, guarda por
 * entrada. Isso é regra de cada arquivo e fica com o dono dele. O cofre entrega `unknown` e aceita
 * `unknown`: ele sabe abrir e fechar a porta, não sabe o que tem dentro.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Onde o app grava o estado dele.
 *
 * `OC_STATE_DIR` é a porta do smoke — o análogo de `OC_BOARD_FIXTURE` e `OC_CLAUDE_PROJECTS`. Sem
 * ela, `app.getPath('userData')`. É **diretório** e não arquivo de propósito, e é o que permite este
 * módulo existir: um só endereço para todos os arquivos de estado.
 *
 * Resolvido **na hora do uso**, dentro do `readState`/`writeState`, e nunca no topo do módulo:
 * `app.getPath('userData')` depende do app do Electron já montado.
 */
export function stateDir(): string {
  return process.env.OC_STATE_DIR || app.getPath('userData')
}

/**
 * Lê e parseia um arquivo do cofre.
 *
 * **Ausente, ilegível e JSON inválido são todos `null`, sem erro** — para quem consome, as três
 * dizem a mesma coisa: não há estado gravado a honrar. Ausente é o estado de uma máquina que abriu o
 * app pela primeira vez, e é indistinguível de um arquivo sem permissão de leitura.
 *
 * Devolve `unknown` de propósito: quem chamou é que sabe o formato, e quem sabe o formato é que
 * precisa guardar cada degrau dele. Um `Promise<T>` genérico aqui seria uma mentira de tipo sobre
 * bytes escritos por outra execução — e talvez por outra versão do app.
 */
export async function readState(file: string): Promise<unknown> {
  let conteudo: string

  try {
    conteudo = await readFile(join(stateDir(), file), 'utf8')
  } catch {
    return null
  }

  try {
    return JSON.parse(conteudo)
  } catch {
    return null
  }
}

/**
 * Grava um arquivo do cofre, **atomicamente**: escreve num `.tmp` no mesmo diretório e renomeia por
 * cima.
 *
 * No mesmo diretório porque `rename` só é atômico dentro do mesmo sistema de arquivos. Sem isso, um
 * desligamento no meio da escrita deixaria um JSON truncado — que a leitura tolerante trataria como
 * ausente, perdendo **todo** o conteúdo de uma vez em vez de nenhum.
 *
 * Falha aqui **rejeita**, ao contrário da leitura: escrita que falha em silêncio é estado que o
 * usuário acha que guardou. Quem absorve a rejeição é o chamador, que é quem sabe se aquilo custa um
 * aviso ou nada.
 *
 * O `null, 2` e o `\n` final vêm do `saveConversations` original e são **contrato**: o
 * `conversations.json` já em disco não muda um byte por causa desta extração.
 */
export async function writeState(file: string, value: unknown): Promise<void> {
  const diretorio = stateDir()
  const destino = join(diretorio, file)
  const temporario = `${destino}.tmp`
  const conteudo = JSON.stringify(value, null, 2)

  // Antes da primeira escrita: `userData` existe, mas um `OC_STATE_DIR` apontado para uma pasta
  // temporária do smoke pode não existir ainda.
  await mkdir(diretorio, { recursive: true })
  await writeFile(temporario, `${conteudo}\n`, 'utf8')
  await rename(temporario, destino)
}
