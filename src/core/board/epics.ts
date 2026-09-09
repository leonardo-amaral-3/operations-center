/**
 * A inversão: quem são as fases de cada épico, descoberto no próprio retrato do board.
 *
 * Toda fase declara o pai — é o `parent` que o `BOARD_QUERY` pede. Logo o épico descobre as filhas
 * varrendo os cartões que já estão em mãos, **sem pedir nada a mais a ninguém**: `subIssues` é
 * conexão e levaria o documento de `cost 4` a `cost 6` numa query que roda a cada foco de janela,
 * por aba.
 *
 * Espelha `stations.ts`: uma regra de produto, um arquivo, sem I/O e testável sozinho. Ela nasce
 * aqui, e não na tela, pelo mesmo argumento que pôs o `conversable` no `BoardReader` — é regra de
 * produto, e reimplementá-la no renderer a faria existir em dois lugares, um dos quais envelhece.
 */

import type { BoardCard, BoardColumn, BoardPhase } from './types'

/**
 * Uma instância só para todo cartão sem fase — e são quase todos.
 *
 * **Exportada** porque o `toCard` do `BoardReader` também precisa dela: ele monta o `BoardCard`
 * antes de a inversão poder rodar (um nó por vez não sabe quem são as filhas dele), e `phases` é
 * obrigatório no contrato. Congelada para que a instância compartilhada não possa ser alterada por
 * engano de dentro de quem a recebe.
 */
export const SEM_FASES: readonly BoardPhase[] = Object.freeze([])

/**
 * A chave que identifica uma issue no board: repo **e** número.
 *
 * É função, e não duas interpolações espalhadas, porque ela é derivada nos **dois lados** do
 * cruzamento — o da fase (`card.parent`) e o do épico (`card`) — e as duas derivações têm de ser a
 * mesma. O repo entra porque um board hospeda issues de mais de um: `#31` em dois repos são duas
 * issues, e cruzar só por número penduraria uma fase sob um épico que não é o dela, com o kanban
 * continuando a parecer correto.
 */
function chave(repository: string, number: number): string {
  return `${repository}#${number}`
}

/**
 * Acrescenta a cada épico as suas fases **que estão neste board**, em ordem crescente de número.
 *
 * Recebe os cartões de **todas** as páginas e as colunas do mesmo retrato — é das colunas que sai o
 * nome da estação de cada fase, resolvido aqui para a tela não refazer o cruzamento.
 *
 * Função pura: entra dado, sai dado, e nada do que entrou é alterado — nem os cartões, nem as
 * colunas. Cartão sem filha é devolvido **pelo mesmo objeto** que entrou; só quem tem fases vira
 * objeto novo. É o que mantém a pureza sem pagar N alocações por releitura num board onde quase
 * todo cartão é comum — a mesma economia que justifica o `SEM_FASES`.
 *
 * Três casos ela não vê, e os três estão nomeados na spec: fase fora do board, fase em outra aba, e
 * fase que não vira cartão. Em nenhum deles o épico sinaliza a omissão.
 */
export function linkPhases(
  cards: readonly BoardCard[],
  columns: readonly BoardColumn[],
): readonly BoardCard[] {
  const nomeDaColuna = new Map(columns.map((column) => [column.id, column.name]))
  const fasesPorEpico = new Map<string, BoardPhase[]>()

  // Primeira passada: cada cartão com pai vira uma `BoardPhase` sob a chave do **lado da fase**.
  for (const card of cards) {
    if (!card.parent) continue

    const fase: BoardPhase = {
      itemId: card.itemId,
      number: card.number,
      title: card.title,
      columnId: card.columnId,
      // `''` quando o board não declara a opção: coluna desconhecida não pode matar o vínculo, do
      // mesmo modo que `repository` torto não mata o pai em `readParent`.
      columnName: nomeDaColuna.get(card.columnId) ?? '',
    }

    const daquele = chave(card.parent.repository, card.parent.number)
    const irmas = fasesPorEpico.get(daquele)
    if (irmas) irmas.push(fase)
    else fasesPorEpico.set(daquele, [fase])
  }

  // Segunda passada: cada cartão se procura sob a chave do **lado do épico**. Um cartão pode achar
  // fases e ter pai ao mesmo tempo (sub-issue de sub-issue) — desenha o crachá e a lista, e não há
  // recursão: o pai é o direto, as filhas são as diretas.
  return cards.map((card) => {
    const fases = fasesPorEpico.get(chave(card.repository, card.number))
    if (!fases) return card

    // A ordem é o número crescente, e não a ordem do board: as fases de um épico estão espalhadas
    // por várias colunas, e entre colunas a ordem do board é arbitrária. O número **é** a ordem das
    // fases, porque o `gm-spec` cria todas as sub-issues de uma vez, em sequência. Ordenar `fases`
    // no lugar não alcança nada de fora: o array nasceu na passada acima, aqui dentro.
    return { ...card, phases: fases.sort((a, b) => a.number - b.number) }
  })
}
