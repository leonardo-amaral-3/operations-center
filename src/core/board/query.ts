/**
 * O documento que o app manda ao GitHub — e o único.
 *
 * Está exportado, e não escondido dentro do `BoardReader`, porque o CA-2 precisa poder afirmar
 * coisas sobre ele: a canária de somente-leitura varre este diretório inteiro atrás de qualquer
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
