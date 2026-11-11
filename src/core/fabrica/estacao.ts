import { normalizeStation } from '../board/stations'

/**
 * Onde um card está no Project 2, no que importa ao primeiro comando de uma frente (card 121).
 * A leitura em si (GraphQL) é da casca; aqui só a decisão, pura.
 */
export type ItemNoBoard = { noProjeto: false } | { noProjeto: true; status: string | null }

/**
 * Do board ao primeiro comando de uma frente. Fora do Project 2 é uma fase por promover (decisão
 * 208 do workspace: fase não promovida fica fora do board), então começa pela spec. Em 🎯
 * Especificação e 🔨 Implementação o argumento da skill seguinte é uma pasta, que o board não diz;
 * da 👀 Revisão em diante o passo é merge, que não é da fábrica.
 */
export function comandoDaEstacao(
  card: number,
  item: ItemNoBoard,
): { comando: string } | { erro: string } {
  if (!item.noProjeto) return { comando: `/gm-spec #${card}` }
  if (item.status === null) {
    return { erro: `o #${card} está no board sem Status; passe --comando` }
  }
  const estacao = normalizeStation(item.status)
  if (estacao === 'triagem') return { comando: `/gm-card #${card}` }
  if (estacao === 'backlog') return { comando: `/gm-spec #${card}` }
  return {
    erro: `o #${card} está em ${item.status}: o próximo passo depende da pasta de planning ou é da orquestradora; passe --comando`,
  }
}

/** O Status de um card no Project 2: o documento que o `iniciar` manda (e a fixture responde). */
export const ITEM_NO_BOARD_QUERY = `query ItemNoBoard($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $n) {
      state
      projectItems(first: 20) {
        nodes {
          project { number }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
      }
    }
  }
}`
