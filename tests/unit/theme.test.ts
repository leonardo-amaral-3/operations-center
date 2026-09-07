import { describe, expect, it } from 'vitest'

import { contrastRatio, oklchToSrgb, toHex } from '../../src/main/color'

/**
 * A matemática de cor do card #29, pinada nos números que o #8 publicou.
 *
 * O que este arquivo protege não é "a conversão roda", é **que ela é a mesma conversão** que
 * produziu os valores hoje em uso. Por isso todo esperado aqui é citação de um documento aprovado —
 * o hex que estava escrito à mão em `src/main/index.ts` e as quatro razões de contraste do #8 — e
 * não um número que este teste tenha calculado para si mesmo. É o que separa âncora de tautologia:
 * se a implementação divergir, é aqui que se descobre, e não na janela do usuário.
 *
 * No teste **unitário** valores absolutos são a âncora, ao contrário do smoke, onde nenhuma cor é
 * escrita à mão (`kanban.smoke.spec.ts` registra a razão).
 */

/** O `--foreground` de toda combinação: o preto que escreve sobre as quatro cores de estado. */
const PRETO = oklchToSrgb(0, 0, 0)

describe('a conversão reproduz o pixel que estava escrito à mão', () => {
  it('o `--background` da lavanda é o `#eee6fe` de `src/main/index.ts`', () => {
    // A prova de que trocar o literal por `windowBackground` é no-op para o tema de hoje: mesmo
    // pixel, agora derivado da folha em vez de transcrito à mão.
    expect(toHex(oklchToSrgb(93.88, 0.033, 300.19))).toBe('#eee6fe')
  })
})

describe('a razão de contraste reproduz os quatro números que o #8 publicou', () => {
  /**
   * As quatro cores de estado e a razão AAA que o #8 mediu para cada uma contra preto. São os
   * valores publicados naquele card: se a matemática daqui divergir da que os produziu, o vermelho
   * aparece com o nome da cor, não como um booleano.
   */
  const ESTADOS = [
    { nome: '--attention', l: 78, c: 0.17, h: 145, esperado: 11.14 },
    { nome: '--warning', l: 84, c: 0.16, h: 85, esperado: 12.74 },
    { nome: '--question', l: 78, c: 0.13, h: 230, esperado: 10.76 },
    { nome: '--danger', l: 70, c: 0.19, h: 25, esperado: 7.24 },
  ]

  it.each(ESTADOS)('`$nome` contra o preto dá $esperado:1', ({ l, c, h, esperado }) => {
    const razao = contrastRatio(PRETO, oklchToSrgb(l, c, h))

    // Duas casas, que é a precisão em que o #8 publicou os números.
    expect(Number(razao.toFixed(2))).toBe(esperado)
  })
})

describe('a guarda de gamut', () => {
  it('lança quando a cor não cabe no sRGB', () => {
    // O croma da lavanda no matiz da ametista — literalmente a armadilha em que a spec do #29 quase
    // caiu, e a razão de esta guarda existir: sem ela o Chromium remapearia por conta própria
    // enquanto o main clipa por canal, e a janela pintaria de uma cor e o canvas de outra.
    expect(() => oklchToSrgb(70.28, 0.1753, 278)).toThrow(/fora do gamut/)
  })

  it('a mensagem traz a cor recusada, para não obrigar a adivinhar qual era', () => {
    expect(() => oklchToSrgb(70.28, 0.1753, 278)).toThrow('70.28% 0.1753 278')
  })

  /**
   * Os dois casos mais apertados de **dentro** do gamut, e são eles que justificam a tolerância de
   * `1e-6` — não uma preocupação genérica com float. Sem a folga, o branco de
   * `--secondary-background`, que existe em toda combinação, viraria falso vermelho.
   */
  const APERTADOS = [
    { nome: '--secondary-background (o branco, a 1.000000 exato)', l: 100, c: 0, h: 0 },
    { nome: '--main da lavanda (a 3.0e-4 do limite no azul)', l: 70.28, c: 0.1753, h: 295.36 },
  ]

  it.each(APERTADOS)('não lança em $nome', ({ l, c, h }) => {
    expect(() => oklchToSrgb(l, c, h)).not.toThrow()
  })
})
