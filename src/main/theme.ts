import folha from '../renderer/index.css?raw'
import { isTheme, THEME_DEFAULT, type Theme } from '../shared/theme'
import { oklchToSrgb, toHex } from './color'
import { parseOklch, parseThemes } from './sheet'

/**
 * A folha do design system vista pelo processo main: qual combinação vale nesta subida e de que cor
 * a janela nasce.
 *
 * **O import acima é o primeiro de `src/main/` para `src/renderer/` do repo, e é deliberado.** O que
 * atravessa é *dado*, não código: o `?raw` do Vite inlina o texto do arquivo no bundle do main em
 * tempo de build, então nada do renderer é executado nem resolvido em runtime. A alternativa — ler o
 * arquivo do disco — estaria errada: no app buildado `src/renderer/index.css` não existe; o que
 * existe é o CSS compilado em `out/renderer/assets/`. Se um dia o main precisar de uma **segunda**
 * coisa do renderer, o sinal é que a folha deveria ter virado um pacote próprio — não que esta linha
 * estava errada.
 *
 * O `?raw` custa duas peças, e não uma: o `css-raw.d.ts` ao lado, que faz o TypeScript compilar, e o
 * `test.css.include` do `vitest.config.ts`, que faz o Vitest entregar o texto em vez de string
 * vazia. Sem a segunda o `tsc` passa, o app funciona, e só o teste vê uma folha vazia — o modo de
 * falha mais caro dos dois, porque acusa a folha em vez do runner.
 */

/**
 * A folha analisada **uma vez, na carga do módulo**, e não a cada chamada.
 *
 * Ela é constante de build: reanalisá-la seria trabalho por nada, e — o que importa mais — um erro
 * de formato deve aparecer quando o programa carrega, não quando alguém pede uma janela.
 */
const COMBINACOES = parseThemes(folha)

/**
 * Qual combinação de cores `OC_THEME` está pedindo.
 *
 * **Ausente cai no default; presente e inválido lança.** É a assimetria de `resolveBoard`
 * (`index.ts:67-78`) e **não** a de `resolveScreen`, de propósito: `OC_SCREEN` engole valor
 * desconhecido porque só há duas telas e a desconhecida cai no app, enquanto aqui a lista cresce a
 * cada combinação nova e um erro de digitação caindo na lavanda em silêncio faria a pessoa concluir
 * que o mecanismo não funciona.
 *
 * Sensível a maiúsculas, também de propósito: `Ametista` lança, porque os nomes são minúsculos e a
 * maiúscula é engano de quem digitou — exatamente o que este lançamento existe para mostrar. E a
 * mensagem carrega o valor **cru**, não o aparado, para que um espaço invisível apareça no erro em
 * vez de se esconder dentro dele.
 *
 * O gêmeo do preload (`themeFromArgv`) tem a política oposta — flag desconhecida cai no default —
 * porque lá o valor já passou por aqui. Os dois têm nomes diferentes para ninguém "uniformizar" as
 * duas políticas por engano.
 */
export function resolveTheme(raw: string | undefined): Theme {
  if (raw === undefined) return THEME_DEFAULT

  const nome = raw.trim()

  if (nome === '') return THEME_DEFAULT
  if (isTheme(nome)) return nome

  throw new Error(`OC_THEME inválido: ${raw}`)
}

/**
 * O mesmo `OC_THEME` do `resolveTheme`, com o terceiro estado que a precedência precisa: `null` para
 * *"o ambiente não pediu nada"*.
 *
 * **A diferença entre as duas é o que decide se o disco é consultado.** Na saída de `resolveTheme`,
 * ausente e `lavanda` são o mesmo valor — e quem quisesse honrar a combinação lembrada não teria
 * como distinguir "ninguém pediu" de "pediram a default". Aqui o `null` é essa distinção, e é ela
 * que faz `OC_THEME` vencer o cofre (Decisão 7) sem que um `OC_THEME` **ausente** vença também.
 *
 * A política do valor presente é a de sempre, porque é a de sempre que ela reusa: inválido lança,
 * com a mensagem e o valor cru de hoje. O que muda é só o vazio, que aqui é ausência e lá era
 * default.
 *
 * `resolveTheme` **continua exportada e testada**: ela é o que o `theme.test.ts` já cobre, e a
 * chamada de dentro daqui é o que impede as duas políticas de divergirem no dia em que uma quarta
 * combinação nascer.
 */
export function resolveThemeEnv(raw: string | undefined): Theme | null {
  // O `trim()` repetido aqui, e não lido de dentro do `resolveTheme`: é ele que faz `OC_THEME=" "`
  // — a variável exportada e esvaziada — ser ausência em vez de um lançamento sobre espaço em
  // branco. A mesma leitura que a irmã faz do vazio, com o desfecho que esta função precisa.
  if (raw === undefined || raw.trim() === '') return null

  return resolveTheme(raw)
}

/**
 * A cor com que a janela nasce na combinação pedida: o `--background` da folha, convertido para
 * sRGB.
 *
 * **Bloco ausente ou token ausente lançam**, com o nome da combinação na mensagem. Não há default
 * silencioso — o que sai daqui vai direto para o primeiro pixel que o usuário vê, e uma cor de
 * reserva escondida faria a moldura abrir discordando do canvas sem ninguém saber por quê.
 */
export function windowBackground(theme: Theme): string {
  const tokens = COMBINACOES.get(theme)

  if (tokens === undefined) {
    throw new Error(`combinação ${theme} ausente na folha do design system`)
  }

  const background = tokens.get('--background')

  if (background === undefined) {
    throw new Error(`combinação ${theme} sem \`--background\` na folha do design system`)
  }

  return toHex(oklchToSrgb(...parseOklch(background)))
}
