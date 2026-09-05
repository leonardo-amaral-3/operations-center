import { describe, expect, it } from 'vitest'

import { IPC_EVENT, IPC_INVOKE } from '../../src/shared/ipc'

/**
 * O CA-2 em forma de teste: a canária da superfície somente-leitura.
 *
 * O token vem do `gh` e tem escopo de escrita — a decisão 1 da spec aceita isso de olhos abertos.
 * Em troca, o "somente-leitura" tem de ser provado no **código**, não na credencial. É o que estas
 * asserções fazem, por dois lados:
 *
 * 1. **A superfície que o renderer alcança** (este arquivo, agora): os mapas de canal são
 *    comparados por igualdade **exata**, e não por "contém". Um `toContain` deixaria passar
 *    `board:move` sem uma linha de diff no teste; com `toEqual`, qualquer canal novo — de qualquer
 *    nome, de escrita ou não — quebra a suíte e obriga quem o acrescentou a vir aqui declarar o
 *    que fez. O portão é a revisão consciente, não a esperteza do teste.
 * 2. **Todo documento GraphQL que o app envia**: a varredura por `mutation` em `src/core/board/` e
 *    `src/main/github/` entra neste mesmo arquivo na task 3, quando esses diretórios existirem.
 */
describe('a superfície de board é somente-leitura', () => {
  it('IPC_INVOKE é exatamente os canais de sessão mais a leitura do board', () => {
    expect(IPC_INVOKE).toEqual({
      start: 'session:start',
      send: 'session:send',
      respondPermission: 'session:respond-permission',
      close: 'session:close',
      readBoard: 'board:read',
    })
  })

  it('IPC_EVENT é exatamente os avisos de sessão mais o do board', () => {
    expect(IPC_EVENT).toEqual({
      init: 'session:init',
      message: 'session:message',
      state: 'session:state',
      permissionRequest: 'session:permission-request',
      board: 'board:changed',
    })
  })

  it('o único canal de board alcançável a partir da tela é de leitura', () => {
    // Redundante com a igualdade exata acima, e de propósito: aquela quebra em qualquer mudança de
    // canal e diz "veio canal novo"; esta diz *o que* o CA-2 proíbe, para quem chegar depois com o
    // teste vermelho na mão.
    const canaisDeBoard = [...Object.values(IPC_INVOKE), ...Object.values(IPC_EVENT)].filter(
      (canal) => canal.startsWith('board:'),
    )

    expect(canaisDeBoard).toEqual(['board:read', 'board:changed'])
  })
})
