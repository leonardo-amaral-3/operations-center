/**
 * A aparência das etiquetas de campo do cartão: o mapa, a régua da chave e a queda em neutro.
 *
 * Mora num `.ts` puro — **sem JSX e sem import de React** —, e a restrição é dura, não gosto. O CA-5
 * do #44 afirma que um valor que o board não conhece sai **neutro**, e o único jeito de afirmá-lo
 * sem montar DOM é importar este mapa num teste. Deixá-lo dentro do `FieldBadge.tsx` arrastaria
 * React e `@radix-ui/react-slot` para dentro de uma canária de design system — trocaria um teste que
 * falha por cor por um teste que pode falhar por ambiente, justamente no caminho em que o dado é
 * estranho e em que se quer o vermelho mais legível possível.
 *
 * Mesmo arranjo de `session/sessionView.ts`, e pela mesma razão: a parte pura sai do componente para
 * o teste poder lê-la sem subir a tela.
 */

import type { BoardCardField } from '../../shared/board'

/**
 * A classe de fundo de cada valor, campo a campo — os catorze tokens de etiqueta da folha.
 *
 * **Casa por rótulo, e não por `optionId`**, de propósito: os dois boards reais deste workspace
 * declaram hoje os mesmos rótulos com ids **diferentes**, e é `CARD_FIELDS` casando por nome que já
 * governa a leitura do campo (`query.ts:143`). O que a escolha custa é o board de terceiro, cujo
 * rótulo não estará aqui — e a resposta a ele é a queda em neutro logo abaixo, que é o CA-5.
 *
 * **As classes são literais completas, nunca montadas por interpolação.** O Tailwind v4 varre o
 * fonte procurando nome de classe, e um nome montado em runtime simplesmente não é emitido: a
 * etiqueta voltaria a branca sem quebrar o build.
 *
 * A ordem dentro de cada campo é a da rampa, do mais urgente ao mais calmo — a regra "mais tinta =
 * mais urgência" que a folha declara. Em `Tipo`, que é nominal, a ordem não significa nada: os
 * quatro estão na mesma luminosidade e o que os separa é matiz.
 */
export const LOOKS: Record<string, Record<string, string>> = {
  Tipo: {
    bug: 'bg-tipo-bug',
    debitotecnico: 'bg-tipo-debito',
    melhoria: 'bg-tipo-melhoria',
    duvida: 'bg-tipo-duvida',
  },
  Severidade: {
    s1: 'bg-severidade-alta',
    s2: 'bg-severidade-media',
    s3: 'bg-severidade-baixa',
  },
  Classe: {
    expedite: 'bg-classe-expedite',
    datafixa: 'bg-classe-data-fixa',
    padrao: 'bg-classe-padrao',
    intangivel: 'bg-classe-intangivel',
  },
  Rota: {
    hotfix: 'bg-rota-hotfix',
    curta: 'bg-rota-curta',
    completa: 'bg-rota-completa',
  },
}

/**
 * O rótulo da opção reduzido ao que ele nomeia, e isto não é preciosismo.
 *
 * O valor chega do GitHub como `'🧰 Débito técnico'`, e casar a string crua deixaria a etiqueta
 * branca **em silêncio** por um seletor de variação invisível no emoji, um espaço a mais, ou um
 * acento composto em vez de precomposto. Três passos: `NFD`, descarte dos diacríticos (`\p{M}`, a
 * mesma régua de `normalizeStation`) e só `[a-z0-9]` em minúsculas — o que transforma
 * `'🧰 Débito técnico'` em `debitotecnico` e `'S1'` em `s1`.
 *
 * O custo, dito em voz alta: duas opções que normalizassem para a mesma chave colidiriam. Nas
 * catorze de hoje não colidem, e é o teste de tamanho do mapa que denuncia se um dia colidirem.
 */
function optionKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * A classe de fundo desta etiqueta, ou **string vazia** para o que o mapa não conhece.
 *
 * A queda em neutro é o CA-5 e cabe no `??`: sem classe de fundo, a variante `neutral` da `Badge`
 * prevalece e a etiqueta sai exatamente como sai hoje. `CARD_FIELDS` casa por nome justamente
 * porque o app aponta para mais de um board — um Project com outros rótulos, uma opção renomeada ou
 * uma opção nova desenha neutro, e nada lança. Qualquer cor escolhida por hash ou por posição seria
 * uma afirmação falsa sobre um dado que não se conhece.
 */
export function fieldLook(field: BoardCardField): string {
  return LOOKS[field.name]?.[optionKey(field.value)] ?? ''
}
