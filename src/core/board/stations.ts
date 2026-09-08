/**
 * A régua com que se lê um nome de estação, e as duas perguntas que se fazem com ela.
 *
 * A normalização nasceu privada dentro do `BoardReader`, quando só havia uma pergunta a responder
 * — "esta coluna conversa?". Sai para cá porque passou a haver duas, e a segunda é de outro leitor:
 * "este board roda a esteira?". Duas cópias da mesma régua envelheceriam em direções diferentes, e
 * a que envelhecesse sozinha passaria a aceitar justamente o rótulo que a outra já aprendeu a
 * recusar — o mesmo motivo que tirou as guardas de `narrow.ts` de dentro do leitor que as escreveu.
 */

import { CONVERSABLE_STATIONS, ESTEIRA_STATIONS } from './query'

/**
 * O nome da estação reduzido ao que a norma nomeia, para a comparação não depender de como o board
 * decorou o rótulo.
 *
 * Duas variações existem de verdade e nenhuma delas é o assunto: o **emoji** que o board prefixa
 * (`'📥 Triagem'` contra `'Triagem'`) e o **acento** (`'Especificação'` contra `'especificacao'`).
 * Derrubar tudo antes da primeira letra cuida do primeiro; `NFD` + descarte dos diacríticos, do
 * segundo. O que sobra distingue exatamente o que precisa ser distinguido — `'🧪 Validação em Dev'`
 * continua sendo outra coisa.
 */
export function normalizeStation(name: string): string {
  return name
    .replace(/^\P{L}+/u, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/** As estações conversáveis já normalizadas — a forma em que a comparação de `readColumns` acontece. */
export const CONVERSABLE: ReadonlySet<string> = new Set(CONVERSABLE_STATIONS.map(normalizeStation))

/** As 8 da norma já normalizadas — a forma em que a comparação de `runsEsteira` acontece. */
const ESTEIRA = ESTEIRA_STATIONS.map(normalizeStation)

/**
 * O board roda a esteira quando declara **as 8 estações**. Recebe os nomes crus das opções do campo
 * `Status`; lista vazia é `false`.
 *
 * **Subconjunto, e não igualdade**: uma coluna a mais é decisão do dono do board, não sinal de que
 * ele deixou de rodar a esteira. Exigir igualdade faria a aba sumir da tela em silêncio no dia em
 * que alguém acrescentasse uma coluna — o pior modo de falha para uma regra que ninguém vê rodar.
 */
export function runsEsteira(optionNames: readonly string[]): boolean {
  const declared = new Set(optionNames.map(normalizeStation))

  return ESTEIRA.every((station) => declared.has(station))
}
