import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O CA-4 do card #1 em forma de teste.
 *
 * Um README que descreve o repo errado é pior que nenhum: ele mente com autoridade, e ninguém
 * revisa documentação com o mesmo rigor com que revisa código. Cada caso abaixo é uma cláusula do
 * critério — as duas frases do esqueleto que precisavam morrer, e as seis coisas que o documento
 * passou a ser obrigado a dizer. A lista cresce quando o produto ganha uma credencial ou uma porta
 * de ambiente novas: foi assim que o `gh` e as variáveis de board entraram, no card #4.
 *
 * As âncoras são títulos de seção, nomes de script e nomes de variável: coisas que só mudam quando
 * o produto muda. A prosa em volta pode ser reescrita à vontade sem quebrar nada aqui.
 */
const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8')

describe('README', () => {
  it('não descreve mais o repo como esqueleto de stack indecidida', () => {
    // Case-insensitive porque a frase morre por completo, não só na capitalização em que nasceu.
    const texto = readme.toLowerCase()

    expect(texto).not.toContain('esqueleto')
    expect(texto).not.toContain('ainda não foram decididos')
  })

  it('documenta a stack escolhida', () => {
    expect(readme).toMatch(/^## Stack$/m)
  })

  it('avisa que o Claude Code precisa estar instalado e logado', () => {
    expect(readme).toMatch(/Claude Code instalado e logado/)
  })

  it('avisa que o gh precisa estar instalado e logado', () => {
    // O segundo pré-requisito de credencial, e o menos óbvio: sem `gh` o app abre e o kanban não
    // carrega, porque é dele que sai o token que lê o board. Quem clona precisa saber disso antes
    // de abrir o app, não depois de ver a tela de erro.
    expect(readme).toMatch(/^## Pré-requisitos$/m)
    expect(readme).toMatch(/GitHub CLI \(`gh`\) instalado e logado/)
  })

  it('lista os comandos que o repo oferece', () => {
    expect(readme).toMatch(/^## Comandos$/m)

    for (const script of ['dev', 'build', 'test', 'smoke', 'lint', 'typecheck']) {
      expect(readme).toContain(`yarn ${script}`)
    }
  })

  it('documenta as variáveis de configuração', () => {
    expect(readme).toMatch(/^## Configuração$/m)

    // A lista é **todas** as variáveis que o main lê, e não uma amostra: uma porta de ambiente que
    // ninguém documentou é uma porta que ninguém encontra — nem para usar, nem para desconfiar
    // dela quando o app se comportar de um jeito que a UI não explica.
    for (const variavel of [
      'OC_CWD',
      'OC_MODEL',
      'OC_ISOLATED',
      'OC_SCREEN',
      'OC_THEME',
      'OC_BOARD_FIXTURE',
      'OC_BOARDS_FIXTURE',
      'OC_CARD_FIXTURE',
      'OC_CLAUDE_PROJECTS',
      'OC_STATE_DIR',
    ]) {
      expect(readme).toContain(variavel)
    }
  })

  it('não documenta mais as variáveis de board que deixaram de existir', () => {
    // O espelho do caso acima, e a metade que faltava: `toContain` prova que o documento diz o que
    // precisa dizer, e nunca pegaria uma variável **morta** deixada na prosa. Uma porta de ambiente
    // documentada que o main não lê mais é pior que uma não documentada — quem a exporta acha que
    // configurou alguma coisa, o app a ignora em silêncio, e o README é a testemunha que mente.
    //
    // Qual board o app abre passou a vir da descoberta no GitHub, no card #25.
    expect(readme).not.toContain('OC_PROJECT_OWNER')
    expect(readme).not.toContain('OC_PROJECT_NUMBER')
  })

  it('explica a consequência de custo do login local', () => {
    // A parte que some primeiro numa reescrita distraída, e a que mais custa perder: quem lê
    // precisa saber que o app come a cota das sessões de terminal.
    expect(readme).toMatch(/^## Custo$/m)
    expect(readme).toContain('mesma cota')
    expect(readme).toContain('OC_MODEL')
  })
})
