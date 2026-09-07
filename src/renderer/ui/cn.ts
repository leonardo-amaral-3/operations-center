import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Junta classes e resolve conflito de utilitário: a última vence.
 *
 * É o que deixa uma primitiva ser reaproveitada com ajuste local — `<Button variant="neutral"
 * className="bg-warning">` precisa que `bg-warning` derrube o `bg-secondary-background` da
 * variante, e não que os dois fiquem na string brigando por especificidade.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
