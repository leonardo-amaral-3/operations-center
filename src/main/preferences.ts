/**
 * A aba lembrada entre execuções: o segundo arquivo do cofre de estado.
 *
 * É a peça que faz o CA-4 existir — o app reabre na aba em que o humano estava, e não sempre na
 * primeira. Tudo o que ela guarda é uma `key` (`owner/number`, a Decisão 10): a coordenada que o
 * `BoardReader.read` já precisa de qualquer jeito, legível a olho nu dentro do arquivo, sem
 * obrigar o `id` opaco do Project a virar estado durável.
 *
 * Este módulo é **só a ponta de IO**. Ele não sabe quais boards existem, não decide quando gravar
 * e não recusa uma chave por ela não estar na lista descoberta — quem faz as três coisas é o
 * `boards.ts`, que tem a descoberta na mão. É essa separação que deixa a Decisão 14 sair de graça:
 * uma descoberta que não achou o board lembrado simplesmente **não chama** `saveActiveBoard`, e a
 * preferência sobrevive à org fora do ar em vez de ser apagada por uma ausência temporária.
 *
 * O disco em si mora no `store.ts`, como o do `conversations.ts`. O que é **deste** arquivo é o
 * nome dele, a versão do formato e a leitura guardada do conteúdo.
 */

import { readState, writeState } from './store'

/**
 * A versão do formato, gravada desde a primeira linha que este arquivo escreveu.
 *
 * Nasce versionado pela mesma razão registrada no `conversations.json`: acrescentá-la depois
 * exigiria adivinhar a forma do que já estivesse em disco. Versão desconhecida **não migra** — é
 * lida como "sem aba lembrada", e a próxima ação do humano substitui o arquivo.
 */
const VERSAO = 1

/** O arquivo, dentro do `stateDir()`. O nome é detalhe interno — a porta de ambiente é a pasta. */
const ARQUIVO = 'preferences.json'

/**
 * A `key` da última aba que o humano ativou, ou `null`.
 *
 * Arquivo ausente, ilegível, JSON inválido, versão desconhecida ou `activeBoard` torto são todos
 * **`null`, sem erro**: para quem consome, os cinco dizem a mesma coisa — não há aba lembrada a
 * honrar, e vale a primeira da ordem. Os três primeiros o `readState` já resolve virando `null`;
 * os dois últimos são regra deste formato e moram no `interpretar`.
 *
 * A chave volta **opaca**: uma que não esteja mais entre os boards descobertos não é erro deste
 * módulo, e sai daqui intacta. Quem tolera o lembrado inválido é o `pickActive`, na leitura — e é
 * justamente por ele resolver o caso sem custo que o arquivo nunca precisa ser reescrito para se
 * corrigir (CA-4: "sem apagar a preferência gravada").
 */
export async function loadActiveBoard(): Promise<string | null> {
  return interpretar(await readState(ARQUIVO))
}

/**
 * Grava a aba ativa, substituindo a anterior.
 *
 * Quem chega aqui é a ação do humano, nunca a descoberta (Decisão 14) — mas essa regra é do
 * `boards.ts`, não desta ponta: aqui a função obedece quem a chamar. A atomicidade é do
 * `writeState`, e é ela que impede um desligamento no meio da escrita de deixar um JSON truncado,
 * que a leitura tolerante trataria como ausente.
 *
 * Falha **rejeita**, como toda escrita do cofre: quem absorve é o chamador, que é quem sabe se uma
 * preferência não gravada custa um aviso ou nada.
 */
export async function saveActiveBoard(key: string): Promise<void> {
  await writeState(ARQUIVO, { version: VERSAO, activeBoard: key })
}

/**
 * O conteúdo do arquivo virando chave, com guarda em cada degrau.
 *
 * Dado de fora chega como `unknown` e passa por guarda explícita, como o `interpretar` de
 * `conversations.ts`: o arquivo é do app, mas quem escreveu foi outra execução — e talvez outra
 * versão dele. O cofre sabe abrir a porta; o que `version` e `activeBoard` significam é regra
 * daqui.
 */
function interpretar(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const raiz = parsed as Record<string, unknown>
  if (raiz['version'] !== VERSAO) return null

  const lembrada = raiz['activeBoard']

  // `''` é tão inútil quanto ausente — nenhum board tem chave vazia. Deixá-la passar faria uma
  // string vazia atravessar o app com cara de preferência, para o `pickActive` acabar caindo na
  // primeira aba do mesmo jeito.
  return typeof lembrada === 'string' && lembrada !== '' ? lembrada : null
}
