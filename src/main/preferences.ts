/**
 * As preferências do humano entre execuções: o segundo arquivo do cofre de estado.
 *
 * Guarda **duas** hoje — a aba em que ele estava e a combinação de cores que ele escolheu —, e é
 * por guardar mais de uma que este módulo fala em *registro* e não em valor.
 *
 * A aba é a peça que faz o CA-4 do #32 existir: o app reabre na aba em que o humano estava, e não
 * sempre na primeira. Tudo o que ela guarda é uma `key` (`owner/number`, a Decisão 10): a
 * coordenada que o `BoardReader.read` já precisa de qualquer jeito, legível a olho nu dentro do
 * arquivo, sem obrigar o `id` opaco do Project a virar estado durável. A combinação é o CA-4 do
 * #36, e guarda o nome declarado na folha — `lavanda`, `ametista`, `obsidiana`.
 *
 * Este módulo é **só a ponta de IO**. Ele não sabe quais boards existem, não sabe qual combinação
 * está na tela, não decide quando gravar e não recusa uma chave por ela não estar na lista
 * descoberta — quem faz essas coisas é quem chama, com o contexto na mão: o `boards.ts` tem a
 * descoberta, e quem troca o tema tem o valor corrente. É essa separação que deixa a Decisão 14
 * sair de graça: uma descoberta que não achou o board lembrado simplesmente **não chama**
 * `saveActiveBoard`, e a preferência sobrevive à org fora do ar em vez de ser apagada por uma
 * ausência temporária.
 *
 * O disco em si mora no `store.ts`, como o do `conversations.ts`. O que é **deste** arquivo é o
 * nome dele, a versão do formato, a leitura guardada do conteúdo e a fusão que impede uma
 * preferência de apagar a outra.
 */

import { isTheme, type Theme } from '../shared/theme'
import { readState, writeState } from './store'

/**
 * A versão do formato, gravada desde a primeira linha que este arquivo escreveu.
 *
 * Nasce versionado pela mesma razão registrada no `conversations.json`: acrescentá-la depois
 * exigiria adivinhar a forma do que já estivesse em disco. Versão desconhecida **não migra** — é
 * lida como registro vazio, e a próxima ação do humano substitui o arquivo.
 *
 * **Continua `1` depois de o `theme` chegar, e isto é decisão, não esquecimento.** A chave nova é
 * *opcional*: um app novo lendo um arquivo antigo não acha `theme` e cai no default; um app antigo
 * lendo um arquivo novo ignora a chave que não conhece e continua achando `activeBoard`. Bumpar a
 * versão faria toda aba lembrada de toda máquina ser descartada por nada — o oposto do que o
 * versionamento existe para comprar.
 */
const VERSAO = 1

/** O arquivo, dentro do `stateDir()`. O nome é detalhe interno — a porta de ambiente é a pasta. */
const ARQUIVO = 'preferences.json'

/**
 * O conteúdo do arquivo já interpretado.
 *
 * `null` em cada campo diz a mesma coisa: não há preferência daquele tipo a honrar. E diz **por
 * campo** — um `theme` torto não invalida a aba, e uma aba torta não invalida o tema. É a mesma
 * regra por-entrada que o `danger.ts` pratica com as marcas, e pela mesma razão: descartar o
 * vizinho junto custaria uma preferência boa por causa de uma ruim.
 */
interface Registro {
  activeBoard: string | null
  theme: Theme | null
}

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
  return (await ler()).activeBoard
}

/**
 * A combinação de cores que o humano escolheu por último, ou `null`.
 *
 * Arquivo ausente, versão desconhecida, `theme` ausente e `theme` que não passa por `isTheme` são
 * todos **`null`**, e dizem a mesma coisa a quem consome: não há combinação lembrada a honrar. O
 * terceiro é o caso comum, não o excepcional — é o arquivo que o #32 escreveu, válido e sem a
 * chave, que toda máquina em uso já tem em disco.
 *
 * O nome volta **validado**, ao contrário da chave da aba, e a assimetria tem razão: o conjunto dos
 * valores legítimos é fechado e conhecido deste lado (`THEMES`), enquanto a lista de boards só
 * existe depois da descoberta. Desconhecido vira `null` e **não** o default: distinguir "não há
 * combinação lembrada" de "há uma, e é a lavanda" é justamente o que a precedência de quem chama
 * consome, e traduzir aqui apagaria a diferença antes de ela chegar a quem decide.
 */
export async function loadTheme(): Promise<Theme | null> {
  return (await ler()).theme
}

/**
 * Grava a aba ativa, **preservando a combinação lembrada**.
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
  await gravar({ activeBoard: key })
}

/**
 * Grava a combinação escolhida, **preservando a aba lembrada**.
 *
 * É a metade do CA-7 que o tema deve à aba; a outra metade o `saveActiveBoard` deve ao tema. As
 * duas moram no `gravar`, que é onde a fusão acontece uma vez só.
 *
 * Falha **rejeita**, como a irmã — e pela mesma razão. Quem chama é que sabe o que fazer com ela;
 * aqui, perder a gravação custa a próxima abertura, não a sessão corrente.
 */
export async function saveTheme(theme: Theme): Promise<void> {
  await gravar({ theme })
}

/** O arquivo virando registro. Três chamadores, uma leitura — as duas escritas incluídas. */
async function ler(): Promise<Registro> {
  return interpretar(await readState(ARQUIVO))
}

/**
 * A fusão: lê o registro corrente, aplica o patch por cima e grava o resultado inteiro.
 *
 * Existe para que as duas gravações não sejam duas cópias da mesma leitura — e para que a terceira
 * preferência, no dia em que nascer, não seja o terceiro lugar onde esquecer de preservar as
 * outras.
 *
 * **Campo `null` é omitido, não gravado como `null`.** É o que mantém o arquivo de quem nunca
 * escolheu combinação byte a byte igual ao que o #32 já escrevia, e é o que faz a chave nova ser de
 * fato *opcional*: um `"theme": null` em todo arquivo tornaria a promessa de compatibilidade da
 * `VERSAO` verdadeira só no papel.
 *
 * **A corrida é declarada e aceita:** duas gravações em voo podem perder uma, porque cada uma leu
 * antes de a outra escrever. As duas são ações do humano, separadas por segundos, e o preço de uma
 * perda é uma preferência não gravada — não um arquivo corrompido, que é o que a atomicidade do
 * `writeState` continua impedindo.
 */
async function gravar(patch: Partial<Registro>): Promise<void> {
  const registro = { ...(await ler()), ...patch }

  // A ordem das chaves é a do arquivo em disco, e o byte a byte é contrato: quem abrir o
  // `preferences.json` a olho nu encontra a aba antes do tema, hoje e depois desta task.
  const conteudo: Record<string, unknown> = { version: VERSAO }
  if (registro.activeBoard !== null) conteudo['activeBoard'] = registro.activeBoard
  if (registro.theme !== null) conteudo['theme'] = registro.theme

  await writeState(ARQUIVO, conteudo)
}

/**
 * O conteúdo do arquivo virando registro, com guarda em cada degrau.
 *
 * Dado de fora chega como `unknown` e passa por guarda explícita, como o `interpretar` de
 * `conversations.ts`: o arquivo é do app, mas quem escreveu foi outra execução — e talvez outra
 * versão dele. O cofre sabe abrir a porta; o que `version`, `activeBoard` e `theme` significam é
 * regra daqui.
 *
 * A versão é o único degrau que derruba o registro inteiro. Abaixo dela, cada campo se guarda
 * sozinho.
 */
function interpretar(parsed: unknown): Registro {
  const vazio: Registro = { activeBoard: null, theme: null }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return vazio

  const raiz = parsed as Record<string, unknown>
  if (raiz['version'] !== VERSAO) return vazio

  const lembrada = raiz['activeBoard']
  const combinacao = raiz['theme']

  return {
    // `''` é tão inútil quanto ausente — nenhum board tem chave vazia. Deixá-la passar faria uma
    // string vazia atravessar o app com cara de preferência, para o `pickActive` acabar caindo na
    // primeira aba do mesmo jeito.
    activeBoard: typeof lembrada === 'string' && lembrada !== '' ? lembrada : null,
    // O mesmo portão que o main e o preload usam, e não uma lista repetida aqui: uma quarta
    // combinação na folha passa a ser lembrada sem que este arquivo saiba que ela existe.
    theme: typeof combinacao === 'string' && isTheme(combinacao) ? combinacao : null,
  }
}
