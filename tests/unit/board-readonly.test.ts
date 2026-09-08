import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { IPC_EVENT, IPC_INVOKE } from '../../src/shared/ipc'

/**
 * O CA-2 em forma de teste: a canária da superfície somente-leitura.
 *
 * O token vem do `gh` e tem escopo de escrita — a decisão 1 da spec aceita isso de olhos abertos.
 * Em troca, o "somente-leitura" tem de ser provado no **código**, não na credencial. É o que estas
 * asserções fazem, por dois lados:
 *
 * 1. **A superfície que o renderer alcança**: os mapas de canal são comparados por igualdade
 *    **exata**, e não por "contém". Um `toContain` deixaria passar `board:move` sem uma linha de
 *    diff no teste; com `toEqual`, qualquer canal novo — de qualquer nome, de escrita ou não —
 *    quebra a suíte e obriga quem o acrescentou a vir aqui declarar o que fez. O portão é a revisão
 *    consciente, não a esperteza do teste.
 * 2. **Todo documento GraphQL que o app envia**: a varredura textual dos dois diretórios que podem
 *    conter um. Ela pega um documento novo em **qualquer arquivo** deles, e não só o `BOARD_QUERY`.
 */

/** Onde um documento GraphQL pode nascer: o `core` que os escreve e o main que os envia. */
const DIRETORIOS_DE_DOCUMENTO = ['../../src/core/board', '../../src/main/github']

/**
 * A palavra procurada. Ela não aparece em nenhum arquivo daqueles diretórios — nem em comentário,
 * de propósito: um falso positivo numa canária a transforma em ruído, e canária ruidosa é canária
 * desligada.
 */
const PALAVRA_DE_ESCRITA = 'mutation'

interface Arquivo {
  caminho: string
  conteudo: string
}

/** Recursivo porque a varredura precisa valer para uma subpasta que ainda não existe. */
function lerArquivos(diretorioRelativo: string): Arquivo[] {
  const raiz = fileURLToPath(new URL(diretorioRelativo, import.meta.url))

  // Diretório renomeado ou movido joga `ENOENT` aqui — que é o que se quer: uma varredura sem o que
  // varrer passaria verde e não provaria nada.
  return readdirSync(raiz, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile())
    .map((entrada) => {
      const caminho = join(entrada.parentPath, entrada.name)

      return { caminho, conteudo: readFileSync(caminho, 'utf8') }
    })
}

describe('a superfície de board é somente-leitura', () => {
  it('IPC_INVOKE é exatamente os canais de sessão mais a leitura do board', () => {
    // **A declaração dos dois canais do cartão-chat**, que é o que esta canária cobra de quem os
    // acrescentou: `answerQuestion` responde um `AskUserQuestion` para a sessão, e `chooseFolder`
    // abre o seletor de diretório e guarda a escolha em memória no main. **Nenhum dos dois toca o
    // board** — nem para ler.
    //
    // E a do canal do #12: `stop` interrompe o turno em curso da sessão e **não toca o board** —
    // nem para ler. Ele fica colado no `close` de propósito: uma para a vez que está rodando, a
    // outra encerra a sessão inteira, e a vizinhança é o que lembra disso a quem lê.
    //
    // E a do canal do #22: `readConversations` responde quais cartões têm conversa a retomar. O que
    // ele carrega sai do registro do próprio app (`conversations.json` em `OC_STATE_DIR`) e da
    // leitura dos transcripts do Claude Code — **o board não é consultado**, nem para ler.
    //
    // E a dos dois canais do #10: `readDangerous` responde quais cartões rodam sem o portão de
    // permissão, e `setDangerous` liga ou desliga a marca de um deles. `setDangerous` **escreve** —
    // mas escreve no `dangerous.json` do próprio app, em `OC_STATE_DIR`, e é a única coisa que ele
    // toca: nenhum dos dois consulta o board, nem para ler, e nenhum dos dois chega perto do
    // GitHub. A carga é `{ itemId, dangerous }` — cartão e um booleano, **nunca** pasta.
    expect(IPC_INVOKE).toEqual({
      start: 'session:start',
      send: 'session:send',
      respondPermission: 'session:respond-permission',
      answerQuestion: 'session:answer-question',
      stop: 'session:stop',
      close: 'session:close',
      chooseFolder: 'repo:choose-folder',
      readBoard: 'board:read',
      readCard: 'card:read',
      readConversations: 'conversations:read',
      readDangerous: 'danger:read',
      setDangerous: 'danger:set',
    })
  })

  it('IPC_EVENT é exatamente os avisos de sessão mais o do board', () => {
    // A declaração do canal do #14: `activity` leva o pulso do turno em curso — tempo decorrido,
    // tokens de raciocínio e há quanto tempo não chega sinal — para a conversa aberta. É de mão
    // única e **não toca o board**, nem para ler: o que ele carrega o main compõe a partir dos
    // canais da própria sessão mais o relógio dele.
    //
    // E a do canal do #22: `conversations` avisa que mudou o conjunto de cartões com conversa
    // recuperável. Canal próprio, e não carona no do board, porque o board tem throttle de 10s e
    // fala do GitHub — isto é estado do app. **Não toca o board**, nem para ler: o conjunto sai do
    // índice de conversas, que só conhece o registro em disco e os transcripts.
    //
    // **A declaração da remoção do #11**: `permissionRequest` e `questionRequest` saíram. Eles
    // diziam o mesmo fato que o `state` já carrega — o pedido que trava a sessão — e ter dois
    // caminhos para o mesmo fato *era* o bug: um segundo pedido concorrente chegava pelo canal e
    // apagava o primeiro da tela. O pedido em cartaz agora se deriva do `state`, que publica a
    // frente da fila. Apagar canal é tão relatável quanto acrescentar, e é esta igualdade exata
    // que obriga quem apagou a vir aqui declarar.
    //
    // E a do canal do #10: `dangerous` avisa que mudou o conjunto de cartões que rodam sem o
    // portão. Canal próprio pela mesma razão do de conversas — é estado do app e não tem nada a ver
    // com o throttle de 10s do board. **Não toca o board**, nem para ler: o conjunto sai do
    // `DangerIndex`, que só conhece o `dangerous.json` em `OC_STATE_DIR`.
    expect(IPC_EVENT).toEqual({
      init: 'session:init',
      message: 'session:message',
      state: 'session:state',
      activity: 'session:activity',
      board: 'board:changed',
      conversations: 'conversations:changed',
      dangerous: 'danger:changed',
    })
  })

  it('todo canal que toca o GitHub é de leitura', () => {
    // Redundante com a igualdade exata acima, e de propósito: aquela quebra em qualquer mudança de
    // canal e diz "veio canal novo"; esta diz *o que* o CA-2 proíbe, para quem chegar depois com o
    // teste vermelho na mão.
    //
    // O alcance é o do CA-6 do #13: `card:read` lê a issue e não o Project, e mantê-lo fora do
    // prefixo `board:` foi decisão consciente — em troca, a asserção deixa de falar de um prefixo e
    // passa a afirmar a invariante inteira.
    const canaisDoGitHub = [...Object.values(IPC_INVOKE), ...Object.values(IPC_EVENT)].filter(
      (canal) => canal.startsWith('board:') || canal.startsWith('card:'),
    )

    // A ordem é a de declaração dos mapas: os `invoke` primeiro, o evento depois.
    expect(canaisDoGitHub).toEqual(['board:read', 'card:read', 'board:changed'])
  })

  it('nenhum arquivo que escreve ou envia GraphQL contém um documento de escrita', () => {
    const arquivos = DIRETORIOS_DE_DOCUMENTO.flatMap(lerArquivos)

    // Sanidade da própria canária: diretório esvaziado não pode virar verde.
    expect(arquivos.length).toBeGreaterThan(0)

    const suspeitos = arquivos
      .filter(({ conteudo }) => conteudo.toLowerCase().includes(PALAVRA_DE_ESCRITA))
      .map(({ caminho }) => caminho)

    expect(suspeitos).toEqual([])
  })
})
