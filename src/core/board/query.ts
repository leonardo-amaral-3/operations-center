/**
 * Os dois documentos que o app manda ao GitHub — e os dois são de leitura.
 *
 * Estão exportados, e não escondidos dentro dos leitores, porque o CA-2 do #4 precisa poder afirmar
 * coisas sobre eles: a canária de somente-leitura varre este diretório inteiro atrás de qualquer
 * documento de escrita. Por isso a palavra que ela procura não aparece nem em comentário aqui —
 * um falso positivo numa canária a transforma em ruído, e canária ruidosa é canária desligada.
 */

/** O nome do campo que carrega a esteira. Fixado aqui porque o documento também o fixa. */
export const STATUS_FIELD = 'Status'

/**
 * **Os dois aliases são obrigatórios e o erro parcial é esperado.**
 *
 * Um Project pode pertencer a um usuário ou a uma organização, e o owner configurado não diz qual.
 * Perguntar pelos dois no mesmo documento evita uma ida e volta extra — ao preço de a resposta vir
 * com dados parciais **e** um `NOT_FOUND` em `errors` apontando para o alias que não resolveu. É a
 * regra 2 do `BoardReader`: tolerar exatamente esse erro, e nenhum outro.
 */
export const BOARD_QUERY = `
query Board($owner: String!, $number: Int!, $cursor: String) {
  user(login: $owner)         { projectV2(number: $number) { ...BoardFields } }
  organization(login: $owner) { projectV2(number: $number) { ...BoardFields } }
}

fragment BoardFields on ProjectV2 {
  title
  field(name: "${STATUS_FIELD}") {
    ... on ProjectV2SingleSelectField { options { id name } }
  }
  items(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      content {
        __typename
        ... on Issue {
          number
          title
          url
          closed
          repository { nameWithOwner }
          assignees(first: 10) { nodes { login } }
        }
      }
      fieldValues(first: 30) {
        nodes {
          ... on ProjectV2ItemFieldSingleSelectValue {
            optionId
            name
            field { ... on ProjectV2SingleSelectField { name } }
          }
        }
      }
    }
  }
}
`

/**
 * O conteúdo de **uma** issue, pedido sob demanda quando um cartão abre.
 *
 * Documento separado, e não campos a mais no `BOARD_QUERY`, porque o board relê a cada foco de
 * janela: arrastar o corpo e os comentários de todos os cartões a cada alt-tab seria pagar o pior
 * preço para mostrar o conteúdo de um só.
 *
 * **Sem alias duplo**, ao contrário do `BOARD_QUERY`: `repository(owner:, name:)` resolve igual para
 * usuário e organização — a ambiguidade que obriga os dois aliases lá é do `projectV2`, não do repo.
 * Logo este documento não tem erro esperado, e **qualquer** `errors` nele é fatal (regra 1 do
 * `CardReader`).
 */
export const CARD_QUERY = `
query Card($owner: String!, $name: String!, $number: Int!, $comments: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number
      body
      comments(first: $comments) {
        totalCount
        nodes { id author { login } createdAt body }
      }
    }
  }
}
`

/**
 * Os campos single-select que viram etiqueta no cartão, na ordem em que aparecem.
 *
 * Lidos por nome, e não "todo single-select que não seja Status", porque `Módulo` é single-select e
 * hoje vale `Comum` em todo card — uma etiqueta que nunca distingue nada é ruído na largura de uma
 * coluna, que é justamente o que a NFR de legibilidade do PRD proíbe. Board sem algum destes campos
 * simplesmente não mostra a etiqueta.
 */
export const CARD_FIELDS = ['Tipo', 'Severidade', 'Classe', 'Rota'] as const

/**
 * As estações que a norma da esteira opera com skill `gm-*` dedicada — e que por isso conversam.
 *
 * Casadas por **nome**, invertendo de propósito o princípio que posiciona o cartão pelo `optionId`.
 * O nome pertence à norma da esteira e é idêntico nos dois boards reais; o `optionId` pertence ao
 * board e é diferente em cada um. Fixar `optionId` aqui faria todo cartão virar não-conversável
 * **em silêncio** ao apontar o app para outro board — o pior modo de falha possível para uma
 * decisão de UI.
 *
 * Ficam de fora 🧪 Validação em Dev, que é checklist humano e não tem skill, e ✅ Produção, onde o
 * trabalho já aconteceu — o `gm-release` aparece naquela linha da norma dividindo espaço com a
 * automação de tag, mas a estação dedicada dele é 🚂 Release.
 */
export const CONVERSABLE_STATIONS = [
  'Triagem',
  'Backlog',
  'Especificação',
  'Implementação',
  'Revisão',
  'Release',
] as const

/**
 * As 8 estações da norma, na ordem da esteira. É a assinatura de "este board roda a esteira" e a
 * única regra que decide se um Project vira aba.
 *
 * São as 8, e não as 6 conversáveis: as 6 admitiriam um board que vai de Triagem a Release sem ter
 * Validação em Dev nem Produção — um board que não roda a esteira, e que ganharia aba assim mesmo.
 *
 * Casadas por **nome** pela mesma razão que as conversáveis: o nome pertence à norma e é idêntico
 * nos dois boards reais; o `optionId` pertence ao board e é diferente em cada um.
 */
export const ESTEIRA_STATIONS = [
  'Triagem',
  'Backlog',
  'Especificação',
  'Implementação',
  'Revisão',
  'Validação em Dev',
  'Release',
  'Produção',
] as const
