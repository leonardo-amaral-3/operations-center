/**
 * As guardas de dado externo, compartilhadas pelos leitores.
 *
 * Toda resposta do GitHub chega como `unknown` e cada acesso a ela passa por uma destas — é a
 * regra 7 do `BoardReader`, e é a mesma exigência do `CardReader`. Sem biblioteca de validação, de
 * propósito: `zod` é um dos peers ausentes do card #2, e trazê-lo aqui misturaria os dois assuntos.
 *
 * Moram em arquivo próprio, e não dentro do leitor que as escreveu primeiro, porque duas cópias de
 * uma guarda de dado externo envelhecem em direções diferentes — e a que envelhecer sozinha vai
 * aceitar justamente o valor que a outra já aprendeu a recusar.
 *
 * Não são republicadas pelo `src/core/index.ts`: são vocabulário interno do core, e a casca nunca
 * vê `unknown` vindo da API.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : []
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
