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
    // E a declaração do #31: `board:read` virou `boards:read` — o mesmo canal, no plural, porque a
    // carga passou a ser a lista de todos os boards descobertos e um nome no singular mentiria
    // sobre ela. **Nenhum canal novo**: a renomeação é o diff inteiro, aqui e no `IPC_EVENT` logo
    // abaixo. Continua sendo leitura, e continua sendo a única do Project.
    //
    // **E a declaração do #32, que é a que esta canária mais cobra: `ui:active-board` é o primeiro
    // canal de _escrita_ da ponte.** Ele grava a aba que o humano ativou no `preferences.json` do
    // `OC_STATE_DIR` — disco local, e **nada** do GitHub: nenhum board é lido, movido ou tocado por
    // ele. O prefixo é `ui:` e não `boards:` de propósito (Decisão 8 da spec), e é por isso que ele
    // fica fora da lista da terceira asserção sem que ela precise abrir exceção para um nome.
    expect(IPC_INVOKE).toEqual({
      start: 'session:start',
      send: 'session:send',
      respondPermission: 'session:respond-permission',
      answerQuestion: 'session:answer-question',
      stop: 'session:stop',
      close: 'session:close',
      chooseFolder: 'repo:choose-folder',
      readBoards: 'boards:read',
      activateBoard: 'ui:active-board',
      readCard: 'card:read',
      readConversations: 'conversations:read',
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
    expect(IPC_EVENT).toEqual({
      init: 'session:init',
      message: 'session:message',
      state: 'session:state',
      activity: 'session:activity',
      boards: 'boards:changed',
      conversations: 'conversations:changed',
    })
  })

  it('todo canal que toca o GitHub é de leitura', () => {
    // Redundante com a igualdade exata acima, e de propósito: aquela quebra em qualquer mudança de
    // canal e diz "veio canal novo"; esta diz *o que* o CA-2 proíbe, para quem chegar depois com o
    // teste vermelho na mão.
    //
    // O alcance é o do CA-6 do #13: `card:read` lê a issue e não o Project, e mantê-lo fora do
    // prefixo `boards:` foi decisão consciente — em troca, a asserção deixa de falar de um prefixo e
    // passa a afirmar a invariante inteira.
    //
    // **O prefixo mudou junto com os canais do #31**, e a consequência não é a intuitiva:
    // `'boards:read'.startsWith('board:')` é `false`, então um filtro deixado em `board:` não
    // acusaria canal nenhum — ele simplesmente esvaziaria a lista e faria a asserção falhar por
    // omissão, que é o pior jeito de uma canária falhar.
    //
    // O canal de escrita do #32 não aparece aqui, e é essa ausência que é a afirmação: `ui:` foi
    // escolhido justamente para que o filtro continue sendo "quem toca o GitHub" e não "quem lê" —
    // um `boards:activate` obrigaria esta lista a ganhar uma exceção nominal, e uma canária com
    // exceção nominal é uma canária a caminho de ser desligada.
    const canaisDoGitHub = [...Object.values(IPC_INVOKE), ...Object.values(IPC_EVENT)].filter(
      (canal) => canal.startsWith('boards:') || canal.startsWith('card:'),
    )

    // A ordem é a de declaração dos mapas: os `invoke` primeiro, o evento depois.
    expect(canaisDoGitHub).toEqual(['boards:read', 'card:read', 'boards:changed'])
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
