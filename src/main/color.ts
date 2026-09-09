/**
 * A matemática de cor do processo main: converte a folha do design system para sRGB e mede
 * contraste. Puro, sem imports, e de propósito sem biblioteca — são ~35 linhas de matéria conhecida,
 * e uma dependência de cor traria um `package.json` a auditar e um espaço de API a aprender por
 * quatro funções.
 *
 * Mora em `src/main/` e não em `src/shared/` porque o único consumidor de produção é o main: o
 * renderer não converte cor nenhuma, ele deixa o Chromium fazer isso. Pôr aqui evita que o renderer
 * compile código que nunca chama.
 *
 * **Convenção deste arquivo:** a sequência "oklch" nunca aparece seguida de parêntese, nem em
 * exemplo, nem em mensagem de erro. A canária que proíbe cor literal em `src/**` varre o texto e não
 * distingue exemplo de valor; a alternativa seria uma exceção por arquivo, e exceção por arquivo
 * apodrece.
 */

/** Um pixel em sRGB de 8 bits. */
export type Rgb8 = readonly [number, number, number]

/**
 * Uma cor da folha, na ordem em que ela a escreve e em que `parseOklch` a devolve: luminosidade
 * em porcentagem, croma absoluto, matiz em graus.
 *
 * Declarado aqui e não importado de `sheet.ts` pela mesma razão que este arquivo não importa nada:
 * a matemática não deve depender do leitor. Os dois são a mesma forma, e é estrutural.
 */
export type Oklch = readonly [number, number, number]

/**
 * A folga aceita ao testar se um canal linear cabe no sRGB.
 *
 * O que a justifica é o branco: `100% 0 0` — o `--secondary-background` de **toda** combinação —
 * converte para `1.000000` exato nos três canais, sem folga nenhuma. Uma guarda estritamente `> 1`
 * passaria hoje, mas deixaria uma cor presente em todas as combinações a um ulp de virar falso
 * vermelho. O segundo caso mais apertado é a `--main` da lavanda, a 3.0e-4 do limite no canal azul —
 * margem real, e não float.
 */
const TOLERANCIA_DE_GAMUT = 1e-6

/** Um canal linear que escapou do sRGB por mais do que a folga do épsilon. */
function foraDoGamut(canal: number): boolean {
  return canal < -TOLERANCIA_DE_GAMUT || canal > 1 + TOLERANCIA_DE_GAMUT
}

/**
 * Um canal linear vira byte: grampeia, aplica a transferência sRGB e arredonda.
 *
 * O grampo só corrige o épsilon — depois da guarda de gamut nada de verdade passa por aqui fora de
 * `[0, 1]`.
 */
function oitoBits(linear: number): number {
  const v = Math.min(1, Math.max(0, linear))
  const transferido = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055

  return Math.round(transferido * 255)
}

/**
 * Croma e matiz viram os dois eixos cromáticos de OKLab.
 *
 * Extraído porque **duas** funções daqui precisam do mesmo passo — a conversão para sRGB e a
 * distância —, e um par de linhas repetido a três de distância é como as duas começam a divergir.
 */
function eixosDeOklab(c: number, h: number): readonly [number, number] {
  const radianos = (h * Math.PI) / 180

  return [c * Math.cos(radianos), c * Math.sin(radianos)]
}

/**
 * Converte uma cor da folha para sRGB de 8 bits. `l` em porcentagem (0–100, como a folha escreve),
 * `c` em croma absoluto, `h` em graus.
 *
 * **Lança fora do gamut, em vez de clipar.** Clipar produz a cor errada sem avisar ninguém, e o
 * consumidor aqui é a cor da janela — o primeiro pixel que o usuário vê. Pior: o Chromium remapeia
 * fora do gamut reduzindo croma, enquanto esta conversão clipa por canal; os dois chegariam a cores
 * diferentes e a moldura passaria a discordar do canvas, em silêncio. O repo já lança em ambiente
 * inválido pela mesma razão (`index.ts`, `OC_PROJECT_NUMBER`).
 */
export function oklchToSrgb(l: number, c: number, h: number): Rgb8 {
  const luz = l / 100
  const [eixoA, eixoB] = eixosDeOklab(c, h)

  // OKLab → LMS não-linear.
  const lLinha = luz + 0.3963377774 * eixoA + 0.2158037573 * eixoB
  const mLinha = luz - 0.1055613458 * eixoA - 0.0638541728 * eixoB
  const sLinha = luz - 0.0894841775 * eixoA - 1.291485548 * eixoB

  const lCubo = lLinha ** 3
  const mCubo = mLinha ** 3
  const sCubo = sLinha ** 3

  // LMS → sRGB linear. Ainda não é o valor de tela: falta a transferência, que é o passo seguinte.
  const vermelho = 4.0767416621 * lCubo - 3.3077115913 * mCubo + 0.2309699292 * sCubo
  const verde = -1.2684380046 * lCubo + 2.6097574011 * mCubo - 0.3413193965 * sCubo
  const azul = -0.0041960863 * lCubo - 0.7034186147 * mCubo + 1.707614701 * sCubo

  if (foraDoGamut(vermelho) || foraDoGamut(verde) || foraDoGamut(azul)) {
    throw new Error(`oklch ${l}% ${c} ${h} está fora do gamut sRGB`)
  }

  return [oitoBits(vermelho), oitoBits(verde), oitoBits(azul)]
}

/** O hex minúsculo de um pixel, com zero à esquerda em cada canal. */
export function toHex(rgb: Rgb8): string {
  return `#${rgb.map((canal) => canal.toString(16).padStart(2, '0')).join('')}`
}

/** Um canal de 8 bits desfeito de volta para linear, pela definição da WCAG. */
function canalLinear(valor: number): number {
  const k = valor / 255

  return k <= 0.04045 ? k / 12.92 : ((k + 0.055) / 1.055) ** 2.4
}

/** A luminância relativa de um pixel. */
function luminancia([r, g, b]: Rgb8): number {
  return 0.2126 * canalLinear(r) + 0.7152 * canalLinear(g) + 0.0722 * canalLinear(b)
}

/**
 * A razão de contraste da WCAG 2.x entre dois pixels, calculada a partir dos valores **de 8 bits** —
 * que é a definição da norma, e é o que reproduz os números que o #8 publicou.
 */
export function contrastRatio(a: Rgb8, b: Rgb8): number {
  const ya = luminancia(a)
  const yb = luminancia(b)

  return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05)
}

/**
 * A distância euclidiana em OKLab entre duas cores da folha — a régua do CA-1 do #44.
 *
 * **Em OKLab, e não no cilíndrico em que a folha escreve.** Lá a distância não é euclidiana: 60° de
 * matiz separam muito num croma alto e quase nada num croma baixo, e subtrair graus diria a mesma
 * coisa nos dois casos. Passar pelos eixos `a`/`b` antes de subtrair é o que faz o limiar de 0.05
 * significar a mesma coisa em qualquer canto do círculo.
 *
 * **A luminosidade entra como fração**, e não como a porcentagem que a folha escreve: os três eixos
 * têm de estar na mesma unidade, senão a raiz quadrada mistura décimos com centésimos e o número
 * que sai não é distância de nada.
 *
 * **Nasce sem consumidor de produção, e tem precedente:** `contrastRatio` também não tem. Este
 * arquivo é a matemática da folha, e a folha é cobrada por teste; a alternativa — uma cópia da
 * fórmula dentro da canária — é a forma de a régua do teste divergir da régua do app em silêncio.
 */
export function oklabDistance([l1, c1, h1]: Oklch, [l2, c2, h2]: Oklch): number {
  const [a1, b1] = eixosDeOklab(c1, h1)
  const [a2, b2] = eixosDeOklab(c2, h2)

  return Math.hypot((l1 - l2) / 100, a1 - a2, b1 - b2)
}
