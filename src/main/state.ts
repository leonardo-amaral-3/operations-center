/**
 * Onde o estado do app mora em disco, e como ele é escrito com segurança.
 *
 * Os dois saíram de `conversations.ts` quando apareceu o segundo arquivo de estado
 * (`dangerous.json`): eles nunca foram do vínculo — são do **app**, e mantê-los lá faria o segundo
 * arquivo importar de um módulo que fala de outra coisa, ou (pior) reescrever as duas linhas que
 * este módulo existe para não deixar ninguém esquecer.
 */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { app } from 'electron'

/**
 * Onde o app grava o estado dele.
 *
 * `OC_STATE_DIR` é a porta do smoke — o análogo de `OC_BOARD_FIXTURE` e `OC_CLAUDE_PROJECTS`. Sem
 * ela, `app.getPath('userData')`. É **diretório** e não arquivo de propósito: o nome do arquivo
 * vira detalhe interno, e o segundo pedaço de estado que o app vier a guardar não precisa de uma
 * segunda variável de ambiente — o que já aconteceu, e é o `dangerous.json`.
 *
 * Resolvido **na hora do uso**, dentro do `load`/`save`, e nunca no topo do módulo:
 * `app.getPath('userData')` depende do app do Electron já montado.
 */
export function stateDir(): string {
  return process.env.OC_STATE_DIR || app.getPath('userData')
}

/**
 * Escreve num `.tmp` no mesmo diretório e renomeia por cima.
 *
 * Compartilhado pelos dois arquivos de estado porque a razão é a mesma nos dois: um desligamento no
 * meio da escrita deixaria um JSON truncado, que a leitura tolerante trataria como vazio — perdendo
 * **tudo** de uma vez, e não só a última mudança.
 *
 * O `mkdir` do diretório e o `\n` final são **do helper**, e não de cada chamador: são exatamente as
 * duas linhas que um segundo `save*` esqueceria, e a primeira delas só falha num `OC_STATE_DIR`
 * recém-criado — isto é, no smoke, e não na máquina de quem desenvolve.
 *
 * Falha **rejeita**: quem chama é uma fila de gravação de índice, e é ela quem tem como absorver.
 */
export async function escreverAtomico(caminho: string, conteudo: string): Promise<void> {
  await mkdir(dirname(caminho), { recursive: true })
  await writeFile(`${caminho}.tmp`, `${conteudo}\n`, 'utf8')
  await rename(`${caminho}.tmp`, caminho)
}
