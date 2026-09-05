import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O CA-4 do card #1 em forma de teste.
 *
 * Um README que descreve o repo errado é pior que nenhum: ele mente com autoridade, e ninguém
 * revisa documentação com o mesmo rigor com que revisa código. Cada caso abaixo é uma cláusula do
 * critério — as duas frases do esqueleto que precisavam morrer, e as cinco coisas que o documento
 * passou a ser obrigado a dizer.
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

  it('lista os comandos que o repo oferece', () => {
    expect(readme).toMatch(/^## Comandos$/m)

    for (const script of ['dev', 'build', 'test', 'smoke', 'lint', 'typecheck']) {
      expect(readme).toContain(`yarn ${script}`)
    }
  })

  it('documenta as variáveis de configuração', () => {
    expect(readme).toMatch(/^## Configuração$/m)

    for (const variavel of ['OC_CWD', 'OC_MODEL', 'OC_ISOLATED']) {
      expect(readme).toContain(variavel)
    }
  })

  it('explica a consequência de custo do login local', () => {
    // A parte que some primeiro numa reescrita distraída, e a que mais custa perder: quem lê
    // precisa saber que o app come a cota das sessões de terminal.
    expect(readme).toMatch(/^## Custo$/m)
    expect(readme).toContain('mesma cota')
    expect(readme).toContain('OC_MODEL')
  })
})
