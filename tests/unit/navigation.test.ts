import { describe, expect, it } from 'vitest'

import { judgeNavigation } from '../../src/main/navigation'

/**
 * O CA-5 do card #9 em forma de teste — a lógica da guarda, não o clique.
 *
 * A regra que este arquivo protege tem dois lados que se parecem e não são a mesma coisa: a janela
 * pode recarregar a si mesma, e não pode virar outra coisa. Confundir os dois é o modo de falha
 * caro — de um lado o `yarn dev` para de dar HMR, do outro um `file:///C:/Windows/win.ini` entra na
 * janela do app. Por isso cada caso abaixo fixa um veredicto, e não um booleano.
 *
 * As duas `APP_*` são as duas formas reais de `appUrl`: o dev server do `yarn dev` e o arquivo que
 * o build carrega. Elas se comportam diferente de propósito, e é isso que o `describe` de `file:`
 * cobra.
 */

/** A URL que a janela carrega no `yarn dev`. */
const APP_DEV = 'http://localhost:5173/'

/** A URL que a janela carrega no build — o que `pathToFileURL` produz para o `index.html`. */
const APP_FILE = 'file:///C:/app/out/renderer/index.html'

describe('judgeNavigation — o que sai para o navegador do sistema', () => {
  it('entrega um link http(s) ao navegador, com a URL de volta no veredicto', () => {
    // A `url` do veredicto é o que o `shell.openExternal` recebe: sem ela o main teria de reparsear
    // a string, e o `href` normalizado é justamente o que a guarda já validou.
    expect(judgeNavigation('https://github.com/x', APP_DEV)).toEqual({
      kind: 'external',
      url: 'https://github.com/x',
    })
  })

  it('entrega um `mailto:` ao navegador', () => {
    // Não é navegação de página, mas é a mesma decisão: quem resolve o destino é o sistema, não a
    // janela. Sem este caso o `mailto:` cairia na regra final e morreria em silêncio.
    expect(judgeNavigation('mailto:a@b.c', APP_DEV)).toEqual({
      kind: 'external',
      url: 'mailto:a@b.c',
    })
  })
})

describe('judgeNavigation — o que não sai nem entra', () => {
  it('barra `javascript:`', () => {
    // O caso que um booleano "é externo?" transformaria em `shell.openExternal('javascript:…')`.
    expect(judgeNavigation('javascript:alert(1)', APP_DEV)).toEqual({ kind: 'blocked' })
  })

  it('barra uma string que não é URL', () => {
    // Arrastar-e-soltar texto na janela chega assim.
    expect(judgeNavigation('não é uma URL', APP_DEV)).toEqual({ kind: 'blocked' })
  })
})

describe('judgeNavigation — `file:` é julgado por caminho, não por origin', () => {
  it('deixa a janela do build recarregar a si mesma', () => {
    expect(judgeNavigation(APP_FILE, APP_FILE)).toEqual({ kind: 'internal' })
  })

  it('barra outro arquivo do disco contra a janela do build', () => {
    // O caso que prova por que o ramo `file:` existe: `new URL('file://…').origin` é a string
    // `"null"` dos dois lados, então uma comparação de origins daria `internal` aqui.
    expect(judgeNavigation('file:///C:/outro.html', APP_FILE)).toEqual({ kind: 'blocked' })
  })

  it('barra um arquivo do disco contra a janela do dev server', () => {
    // O mesmo buraco visto do outro lado: no `yarn dev` a janela é `http:`, e um `file:` nunca é
    // ela mesma — nem sequer merece o navegador do sistema.
    expect(judgeNavigation('file:///C:/Windows/win.ini', APP_DEV)).toEqual({ kind: 'blocked' })
  })
})

describe('judgeNavigation — a recarga do dev server', () => {
  it('deixa passar a própria origem, que é o HMR do `yarn dev`', () => {
    // Sem este caso o `will-navigate` barraria o recarregamento do próprio renderer e o `yarn dev`
    // pararia de atualizar a tela — a falha que ninguém liga à guarda de segurança.
    expect(judgeNavigation(APP_DEV, APP_DEV)).toEqual({ kind: 'internal' })
  })
})
