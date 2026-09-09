import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { contrastRatio, oklabDistance, oklchToSrgb, toHex } from '../../src/main/color'
import { parseOklch, parseThemes } from '../../src/main/sheet'
import { resolveTheme, resolveThemeEnv, windowBackground } from '../../src/main/theme'

/**
 * A matemática de cor do card #29 e a leitura da folha, pinadas nos números que o #8 publicou.
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

/** A folha de verdade, lida do disco como `design-system.test.ts:142` monta o caminho dele. */
const CAMINHO_DA_FOLHA = fileURLToPath(new URL('../../src/renderer/index.css', import.meta.url))

describe('`parseThemes` lê a folha do disco', () => {
  const combinacoes = parseThemes(readFileSync(CAMINHO_DA_FOLHA, 'utf8'))

  it('acha as três combinações declaradas', () => {
    expect([...combinacoes.keys()]).toEqual(['lavanda', 'ametista', 'obsidiana'])
  })

  it.each(['lavanda', 'ametista', 'obsidiana'] as const)(
    'a %s traz os vinte e nove tokens',
    (nome) => {
      expect(combinacoes.get(nome)?.size).toBe(29)
    },
  )

  it('o valor chega inteiro e sem o `\\r` do CRLF grudado no fim', () => {
    // Este é o ponto em que um parser escrito no Linux passa e aqui falha: sem o `.trim()`, o valor
    // sairia daqui como `oklch(…)\r` e não casaria com nada em `parseOklch` — um vermelho que
    // acusaria a folha, que está intacta.
    expect(combinacoes.get('lavanda')?.get('--background')).toBe('oklch(93.88% 0.033 300.19)')
  })
})

describe('`parseThemes` não se perde na sintaxe da folha', () => {
  /**
   * Aspas duplas no seletor. O Prettier deste repo normaliza para aspas simples e é assim que a folha
   * está escrita — o parser aceita as duas porque o custo é um caractere e o modo de falha seria o
   * app abrir sem cor nenhuma.
   */
  const FOLHA_EM_ASPAS_DUPLAS = [
    '[data-theme="lavanda"] {',
    '  --background: oklch(93.88% 0.033 300.19);',
    '  --main: oklch(70.28% 0.1753 295.36);',
    '}',
  ].join('\r\n')

  /** Um `}` no meio do bloco, dentro de comentário: sem apagar comentários antes, ele fecha cedo. */
  const FOLHA_COM_CHAVE_EM_COMENTARIO = [
    "[data-theme='lavanda'] {",
    '  --background: oklch(93.88% 0.033 300.19);',
    '  /* uma chave } aqui no meio, e o bloco terminaria antes da hora */',
    '  --main: oklch(70.28% 0.1753 295.36);',
    '}',
  ].join('\r\n')

  it.each([
    { nome: 'com o seletor em aspas duplas', folha: FOLHA_EM_ASPAS_DUPLAS },
    { nome: 'com um `}` dentro de comentário', folha: FOLHA_COM_CHAVE_EM_COMENTARIO },
  ])('devolve o bloco inteiro $nome', ({ folha }) => {
    // Os dois tokens, e não só o primeiro: é a segunda declaração — a que vem depois da armadilha —
    // que prova que o bloco não foi cortado no meio.
    expect([...(parseThemes(folha).get('lavanda') ?? [])]).toEqual([
      ['--background', 'oklch(93.88% 0.033 300.19)'],
      ['--main', 'oklch(70.28% 0.1753 295.36)'],
    ])
  })
})

describe('`parseOklch`', () => {
  it.each([
    { valor: 'oklch(70.28% 0.1753 295.36)', esperado: [70.28, 0.1753, 295.36] },
    { valor: 'oklch(100% 0 0)', esperado: [100, 0, 0] },
  ])('lê $valor', ({ valor, esperado }) => {
    expect(parseOklch(valor)).toEqual(esperado)
  })

  it('lança no que não é cor da folha, com o valor cru na mensagem', () => {
    // Um hex é o engano mais provável — é o formato que o main escrevia à mão antes deste card.
    expect(() => parseOklch('#eee6fe')).toThrow('#eee6fe')
  })
})

describe('`resolveTheme` lê `OC_THEME`', () => {
  it.each([
    { nome: 'ausente', raw: undefined },
    { nome: 'vazia', raw: '' },
    { nome: 'só espaço', raw: '  ' },
  ])('cai na lavanda com a variável $nome', ({ raw }) => {
    expect(resolveTheme(raw)).toBe('lavanda')
  })

  it.each([{ raw: 'ametista' }, { raw: ' ametista ' }])('aceita `$raw`', ({ raw }) => {
    expect(resolveTheme(raw)).toBe('ametista')
  })

  /**
   * O lado oposto, e é ele que dá sentido ao de cima: valor **presente e inválido** lança, em vez de
   * cair na lavanda. `Ametista` está aqui junto de `roxo` porque a comparação é sensível a
   * maiúsculas de propósito — os nomes são minúsculos, e a maiúscula é engano de quem digitou.
   */
  it.each([
    { nome: 'a maiúscula, que é engano de digitação', raw: 'Ametista' },
    { nome: 'a combinação que não existe', raw: 'roxo' },
  ])('lança em $nome, com o valor cru na mensagem', ({ raw }) => {
    expect(() => resolveTheme(raw)).toThrow(`OC_THEME inválido: ${raw}`)
  })

  it('a mensagem preserva o espaço invisível em vez de aparar antes de reclamar', () => {
    // O valor cru e não o aparado: quem digitou ` roxo` precisa ver o espaço no erro, senão a
    // mensagem descreve um valor que a pessoa não escreveu.
    expect(() => resolveTheme(' roxo')).toThrow('OC_THEME inválido:  roxo')
  })
})

/**
 * A irmã de `resolveTheme` com o terceiro estado, e o que este bloco protege é a **diferença** entre
 * as duas — não o caminho feliz, que as duas percorrem igual.
 *
 * O par de cima é o que importa: onde `resolveTheme` devolve `lavanda`, esta devolve `null`. É essa
 * distinção que a precedência de `index.ts` consome para decidir se o cofre é consultado; se um dia
 * alguém "simplificar" as duas numa só, é aqui que o vermelho aparece — e não numa combinação
 * lembrada que o app silenciosamente parou de honrar.
 */
describe('`resolveThemeEnv` distingue "o ambiente não pediu nada" de "pediu a default"', () => {
  it.each([
    { nome: 'ausente', raw: undefined },
    { nome: 'vazia', raw: '' },
    // A variável exportada e esvaziada — `OC_THEME=` no shell — chega como string de espaços, e é
    // ausência: quem a esvaziou estava desligando a porta, não pedindo uma combinação chamada `' '`.
    { nome: 'só espaço', raw: '  ' },
  ])('devolve `null` com a variável $nome, e **não** a default', ({ raw }) => {
    expect(resolveThemeEnv(raw)).toBeNull()
  })

  it('e é justamente aí que ela difere da irmã, que devolve a lavanda', () => {
    // As duas leituras do mesmo `undefined`, lado a lado: é o contraste que dá sentido ao bloco
    // acima, e o que impede alguém de trocar uma pela outra num `??` sem nada ficar vermelho.
    expect(resolveTheme(undefined)).toBe('lavanda')
    expect(resolveThemeEnv(undefined)).toBeNull()
  })

  it.each([{ raw: 'obsidiana' }, { raw: ' obsidiana ' }])(
    'devolve a combinação com `$raw`',
    ({ raw }) => {
      expect(resolveThemeEnv(raw)).toBe('obsidiana')
    },
  )

  /**
   * A política do valor presente é a da irmã, e é a chamada por dentro que a mantém assim: o valor
   * inválido lança com a **mesma** mensagem, e o valor cru continua na mensagem em vez do aparado.
   */
  it.each([
    { nome: 'a combinação que não existe', raw: 'roxo' },
    { nome: 'a maiúscula, que é engano de digitação', raw: 'Obsidiana' },
  ])('lança em $nome, com a mensagem de sempre', ({ raw }) => {
    expect(() => resolveThemeEnv(raw)).toThrow(`OC_THEME inválido: ${raw}`)
  })
})

describe('`windowBackground` tira a cor da janela da folha', () => {
  it.each([
    // O hex que estava escrito à mão em `src/main/index.ts` antes deste card: é ele que prova que
    // trocar o literal pela folha é no-op para o tema de hoje.
    { theme: 'lavanda', esperado: '#eee6fe' },
    { theme: 'ametista', esperado: '#e6eafc' },
    // A metade "sem piscar" do CA-4: é **este** hex que a `BrowserWindow` recebe quando o cofre
    // lembra a obsidiana, e é ele que separa a moldura certa de um flash claro no primeiro paint.
    // A outra metade do critério — a **ordem**, o disco lido antes de a janela existir — não cabe
    // num unitário e é conferida na revisão de `src/main/index.ts`, como o `## Plano de testes`
    // registra.
    { theme: 'obsidiana', esperado: '#44404c' },
  ] as const)('a janela da $theme abre em $esperado', ({ theme, esperado }) => {
    expect(windowBackground(theme)).toBe(esperado)
  })
})

/**
 * A régua do CA-1 do #44, ancorada nos dois números que a spec daquele card publicou.
 *
 * Mesma disciplina do resto do arquivo: o esperado é **citação de documento aprovado**, e não um
 * número que este teste tenha calculado para si mesmo. Os dois casos foram escolhidos porque são os
 * que a spec usou para justificar decisões — o primeiro é a folga contra o limiar de 0.05, o segundo
 * é a prova de que a banda calma não encosta nos crachás de sessão. Se a fórmula divergir, é aqui
 * que se descobre, e não numa paleta que passou verde medindo errado.
 */
describe('a distância em OKLab reproduz os dois números que o #44 publicou', () => {
  const DISTANCIAS = [
    {
      nome: 'o pior par dentro de um campo, `--tipo-debito` contra `--tipo-melhoria`',
      a: [87, 0.06, 85],
      b: [87, 0.06, 145],
      esperado: 0.06,
    },
    {
      nome: 'a menor distância contra um estado, `--rota-hotfix` contra `--question`',
      a: [74, 0.06, 187],
      b: [78, 0.13, 230],
      esperado: 0.1034,
    },
  ] as const

  it.each(DISTANCIAS)('$nome dá $esperado', ({ a, b, esperado }) => {
    // Quatro casas, que é a precisão em que a spec do #44 publicou os dois números.
    expect(Number(oklabDistance(a, b).toFixed(4))).toBe(esperado)
  })

  it('e ela é simétrica, senão "o par X-Y" e "o par Y-X" seriam perguntas diferentes', () => {
    expect(oklabDistance([87, 0.06, 85], [87, 0.06, 145])).toBe(
      oklabDistance([87, 0.06, 145], [87, 0.06, 85]),
    )
  })
})

/**
 * A regressão da descoberta #306: nome de token com dígito.
 *
 * **Medido antes do conserto**, e é o que torna este caso carga viva: alimentado com
 * `--severidade-1`, o parser de então não casava **nada**. O token sumia de `parseThemes` e, com
 * ele, das canárias de completude, gamut e contraste — enquanto a folha o declarava e a tela
 * pintava com ele. Uma canária verde por não ter enxergado é o pior resultado que ela pode dar.
 *
 * O caso é **sintético de propósito**: os nomes que a folha usa hoje não têm dígito
 * (`--severidade-alta`, e não `--severidade-1`), então nada na árvore exercita este caminho. Ele
 * guarda o parser para o próximo nome, não para os de agora.
 */
describe('o parser da folha enxerga token com dígito no nome', () => {
  const FOLHA = `[data-theme='lavanda'] {
  --severidade-1: oklch(70% 0 0);
  --main: oklch(70.28% 0.1753 295.36);
}`

  it('o token com dígito entra no mapa da combinação', () => {
    expect(parseThemes(FOLHA).get('lavanda')?.get('--severidade-1')).toBe('oklch(70% 0 0)')
  })

  it('e o vizinho sem dígito continua entrando', () => {
    // Sem este caso, um alargamento que passasse a casar **só** nomes com dígito ficaria verde
    // acima e levaria a folha inteira junto.
    expect(parseThemes(FOLHA).get('lavanda')?.get('--main')).toBe('oklch(70.28% 0.1753 295.36)')
  })
})
