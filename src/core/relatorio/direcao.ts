import type { Objetivo } from './tipos'

/**
 * Os objetivos nomeados de `fabrica/DIRECAO.md` (#120, spec-p1 §6).
 *
 * O arquivo é opcional (Technical Decisions, 12): quem chama decide o que fazer sem ele. Aqui só se
 * lê o formato fixado no Apêndice A da `spec.md`: `- **P0 · Fundação:** …`.
 */
export function lerObjetivos(texto: string): Objetivo[] {
  const objetivos: Objetivo[] = []

  for (const linha of texto.replace(/\r\n/g, '\n').split('\n')) {
    const casou = /^- \*\*(P[0-3]) · ([^:*]+):\*\*/.exec(linha)

    if (casou?.[1] !== undefined && casou[2] !== undefined) {
      objetivos.push({ codigo: casou[1], nome: casou[2].trim() })
    }
  }

  return objetivos
}
