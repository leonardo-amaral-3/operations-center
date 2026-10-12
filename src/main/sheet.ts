import { isTheme, type Theme } from '../shared/theme'

/**
 * A leitura da folha do design system: dado o **texto** de `src/renderer/index.css`, quais
 * combinações ela declara e o que cada uma diz.
 *
 * **Puro, e sem nenhum import de CSS — e a separação tem razão verificada.** O Playwright não roda o
 * Vite: ele transpila os specs para CommonJS (`kanban.smoke.spec.ts:24-25` registra isso), então um
 * módulo que faça `import … from '…?raw'` é `MODULE_NOT_FOUND` já na coleta do smoke. O smoke precisa
 * ler a folha — nenhum valor de cor é escrito à mão lá —, logo quem lê a folha não pode ser quem a
 * importa. Quem a importa é `src/main/theme.ts`, e é só ele.
 *
 * **Os arquivos deste repo estão em CRLF.** As expressões daqui aguentam (`[\s\S]`, `\s*`, e o
 * `[^;]+` que para no `;` antes do `\r`), e o `.trim()` do valor é o que impede um `\r` de vazar para
 * dentro do casamento de cor. Nada de `split('\n')` sem `.trim()` em cima do pedaço: é a forma mais
 * fácil de escrever um parser que passa no Linux e falha aqui.
 */

/** Um comentário CSS inteiro. Não-guloso de propósito: para no primeiro fechamento, não no último. */
const COMENTARIO = /\/\*[\s\S]*?\*\//g

/**
 * Um bloco de combinação: o nome no seletor e o corpo.
 *
 * Aceita as duas aspas. O Prettier deste repo normaliza atributo de seletor para aspas simples, e é
 * assim que a folha está escrita — mas o custo de aceitar as duas é um caractere, e o modo de falha
 * de não aceitar seria o app abrir sem cor nenhuma.
 */
const BLOCO = /\[data-theme=['"](?<nome>[a-z-]+)['"]\]\s*\{(?<corpo>[^}]*)\}/g

/**
 * Uma declaração de custom property dentro do bloco: o nome e o valor até o `;`.
 *
 * **O dígito no nome é aceito, e a razão é um modo de falha medido.** Com `--[a-z-]+`, uma
 * declaração de `--severidade-1` não casava **nada**: o token sumia daqui e, com ele, das canárias
 * de completude, gamut e contraste — enquanto a folha o declarava e a tela pintava com ele. É o
 * pior vermelho que uma canária pode dar, que é nenhum. Os nomes de hoje não têm dígito de
 * propósito, e o alargamento existe para o próximo, não para eles.
 */
const DECLARACAO = /(?<token>--[a-z0-9-]+)\s*:\s*(?<valor>[^;]+);/g

/**
 * As combinações da folha, cada uma com o mapa dos seus tokens. Chave e valor crus — quem precisa dos
 * números chama `parseOklch` (`src/shared/color.ts`).
 */
export function parseThemes(sheet: string): Map<Theme, Map<string, string>> {
  // Apagar os comentários **antes de qualquer outra coisa**: um `}` dentro de comentário fecharia um
  // bloco cedo e a varredura mentiria — devolveria meia paleta sem reclamar de nada, e o vermelho
  // apareceria lá na frente, acusando a folha por um token que está lá.
  const semComentarios = sheet.replace(COMENTARIO, '')
  const combinacoes = new Map<Theme, Map<string, string>>()

  for (const bloco of semComentarios.matchAll(BLOCO)) {
    const nome = bloco.groups?.['nome']
    const corpo = bloco.groups?.['corpo']

    // Bloco com nome fora de `THEMES` é ignorado em vez de virar chave: o conjunto declarado é o de
    // `src/shared/theme.ts`, e quem sobrar de fora é denunciado por ausência no teste de completude —
    // que reporta o nome que faltou, não um booleano.
    if (corpo === undefined || !isTheme(nome)) continue

    const tokens = new Map<string, string>()

    for (const declaracao of corpo.matchAll(DECLARACAO)) {
      const token = declaracao.groups?.['token']
      const valor = declaracao.groups?.['valor']
      if (token === undefined || valor === undefined) continue

      tokens.set(token, valor.trim())
    }

    combinacoes.set(nome, tokens)
  }

  return combinacoes
}
