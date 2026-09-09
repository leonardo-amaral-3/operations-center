import type { ChatMessage, ChatToolUse, DiffHunk, DiffLine, FileDiff, ToolStatus } from './types'

/**
 * A tradução de uma conversa do Claude Code para o que a tela consome — e é **uma só**, servindo o
 * caminho ao vivo e o histórico relido do transcript.
 *
 * O que era privado do `SessionHandle` mora aqui porque os dois são o mesmo fato lido de fontes
 * diferentes: o stream do `query()` e o arquivo em `~/.claude/projects/`. Duas implementações da
 * mesma tradução divergiriam na primeira correção que só uma recebesse — e a divergência apareceria
 * como "o histórico restaurado está diferente do que eu vi acontecer", que é justamente o que este
 * app existe para não fazer.
 *
 * Toda carga é lida como `unknown` e com guarda. Não é preciosismo: o tipo do SDK para o corpo de
 * uma mensagem vem de um pacote que é só peer dependency (`@anthropic-ai/sdk`) e por isso não se
 * resolve aqui — sem a leitura defensiva, o que atravessaria o core seria um `any`. Do lado do
 * transcript a razão é ainda mais direta: é arquivo de outro programa, que muda de release em
 * release. Bloco que não dá para ler é ignorado, e nunca derruba nada.
 */

/**
 * Os campos que identificam uma chamada, em ordem de preferência. Uma lista ordenada, e não uma
 * tabela por ferramenta: a tabela viraria dívida no primeiro release do CLI com ferramenta nova.
 *
 * `command` vem antes de `description` porque no `Bash` a descrição já chega pelo `task_started` e
 * vira `headline` — repeti-la no detalhe desperdiçaria a linha.
 */
const DETAIL_FIELDS = ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'prompt']

/** O teto de uma linha de trilha. O corte é aqui, e não na tela: ver `ChatToolUse.detail`. */
const DETAIL_MAX = 120

/**
 * O teto de linhas de trecho que atravessa a ponte.
 *
 * 40 é o p90 medido nos transcripts deste workspace: 90,6% dos patches cabem inteiros, e o corte só
 * alcança a cauda (p95 = 56, p99 = 255, máximo 863). Subir para 60 compraria 5 pontos de cobertura
 * ao custo de 50% mais tráfego no pior caso e de um diff que sozinho passa duas vezes a altura da
 * caixa do cartão. O corte é aqui, e não na tela, pela mesma razão do `DETAIL_MAX`.
 *
 * **Exportado**, ao contrário do `DETAIL_MAX`: o caso de teste do corte precisa construir um patch
 * maior que o teto, e um `40` repetido à mão no teste é um acoplamento que ninguém atualiza junto.
 */
export const DIFF_MAX_LINES = 40

/**
 * A nota que uma interrupção deixa na conversa.
 *
 * Mora neste módulo, e não mais no `SessionHandle`, pelo mesmo motivo que o resto daqui: a parada
 * ao vivo e a parada relida do transcript são o mesmo fato, e o mesmo fato tem de se ler igual.
 * O `SessionHandle` a reexporta, porque é de lá que quem já a lia continua lendo.
 */
export const INTERRUPTED_NOTICE = 'Turno interrompido.'

/** O prefixo com que o Claude Code registra uma interrupção. Sem o fecho: a frase varia depois dele. */
const INTERRUPCAO = '[Request interrupted by user'

/**
 * Texto de usuário que **não é o usuário falando**: é o Claude Code narrando a própria sessão.
 * Vira `notice`, que é exatamente o papel que `src/shared/session.ts` já criou para isto — e o
 * comentário de lá já antecipava este caso ("que é o que o Claude Code grava no transcript dele").
 *
 * A lista é curta de propósito: adivinhar o conjunto completo de envelopes internos seria manter
 * uma tabela que envelhece a cada release do CLI. O que não estiver aqui vira bolha de usuário, que
 * é o modo de falha barato — uma linha a mais na conversa, nunca uma fala perdida.
 */
const NOTAS = [INTERRUPCAO, '<task-notification>']

/**
 * O envelope de slash command, lido **por tag e nunca por posição**: as duas ordens foram
 * observadas nos transcripts reais (`<command-message>` antes do nome e depois dele).
 *
 * O `<command-message>` fica de fora: ele é o rótulo interno da skill, não o que a pessoa digitou.
 */
const NOME = /<command-name>(?<nome>[^<]*)<\/command-name>/
const ARGS = /<command-args>(?<args>[\s\S]*?)<\/command-args>/

/**
 * O mínimo de uma entrada de transcript. Estrutural, e não o `SessionMessage` do SDK: o core lê
 * carga de fora com guarda, não com o tipo de quem a produziu — a mesma postura de `assistantText`.
 * O `SessionMessage` do SDK é atribuível a isto.
 */
export interface TranscriptEntry {
  type: 'user' | 'assistant' | 'system'
  uuid: string
  message: unknown
  parent_tool_use_id: string | null
}

/**
 * O histórico já pronto para a tela, na ordem em que aconteceu.
 *
 * Uma passada só, com um índice `id → posição` para casar `tool_use` com `tool_result` — o mesmo
 * papel que o `#upsert` cumpre ao vivo.
 */
export function replay(entries: readonly TranscriptEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  const positions = new Map<string, number>()

  for (const entry of entries) {
    if (entry.type === 'assistant') {
      // O texto achatado numa mensagem só, com o `uuid` por id — a mesma escolha do caminho ao
      // vivo, e pelo mesmo motivo: dois blocos de texto na mesma mensagem dariam dois ids iguais.
      const text = assistantText(entry.message)
      if (text) messages.push({ id: entry.uuid, role: 'assistant', text })

      for (const use of toolUses(entry.message, entry.parent_tool_use_id)) {
        positions.set(use.id, messages.length)
        messages.push(use)
      }
      continue
    }

    // `system` e o que não casar não viram nada: as entradas internas que sobrariam aqui o próprio
    // SDK já filtra (`isMeta`, `attachment`, `queue-operation`).
    if (entry.type !== 'user') continue

    // Resultado de ferramenta não é fala: ele só muda o degrau de uma entrada que já existe. Vem
    // antes do texto porque a mesma `user` que carrega `tool_result` também carrega o eco do
    // prompt, e lê-lo viraria balão de uma fala que ninguém disse.
    const outcomes = toolResults(entry.message)
    if (outcomes.length > 0) {
      for (const { id, status } of outcomes) {
        const at = positions.get(id)
        if (at === undefined) continue

        const registrada = messages[at]
        if (registrada?.role !== 'tool') continue

        messages[at] = { ...registrada, status }
      }
      continue
    }

    const text = userText(entry.message)
    if (text === null || text.trim() === '') continue

    const command = commandOf(text)
    if (command !== null) {
      messages.push({ id: entry.uuid, role: 'user', text: command })
      continue
    }

    const notice = noticeOf(text)
    messages.push(
      notice === null
        ? { id: entry.uuid, role: 'user', text }
        : { id: entry.uuid, role: 'notice', text: notice },
    )
  }

  // O mesmo fecho do `#abortRunning`, e aqui ele é ainda mais necessário: um transcript cortado no
  // meio de uma ferramenta deixaria a entrada rodando para sempre, e isso desliga de vez a marca de
  // silêncio, cuja regra é "só acusa quando nada está `running`" (`sessionView.ts`, `isSilent`).
  for (const [at, message] of messages.entries()) {
    if (message.role === 'tool' && message.status === 'running') {
      messages[at] = { ...message, status: 'aborted' }
    }
  }

  return messages
}

/**
 * O texto de uma mensagem de assistente, achatado.
 *
 * A carga é lida como `unknown` de propósito: o tipo do SDK para ela vem de um pacote que é só peer
 * dependency (`@anthropic-ai/sdk`) e por isso não se resolve aqui — sem a leitura defensiva, o que
 * atravessaria o core seria um `any`.
 */
export function assistantText(payload: unknown): string {
  const message = asRecord(payload)
  if (!message) return ''

  return joinText(message['content'])
}

/**
 * O texto de uma mensagem de usuário: `content` string **ou** array com blocos `text`.
 *
 * As duas formas foram medidas nos transcripts — foi como array que
 * `[Request interrupted by user]` apareceu. Nem uma nem outra → `null`.
 */
export function userText(payload: unknown): string | null {
  const message = asRecord(payload)
  if (!message) return null

  const content = message['content']
  const raw = asString(content)
  if (raw !== null) return raw

  const blocks = joinText(content)
  return blocks === '' ? null : blocks
}

/**
 * O comando digitado, quando o texto é o envelope de slash command. `null` quando não é.
 *
 * Sem `<command-name>` não é envelope. Com nome e sem args (ou args vazio), só o nome (`/clear`);
 * com os dois, os dois (`/gm-spec #11`).
 */
export function commandOf(text: string): string | null {
  const nome = NOME.exec(text)?.groups?.['nome']
  if (nome === undefined) return null

  const args = ARGS.exec(text)?.groups?.['args'] ?? ''
  const comando = `${nome} ${args}`.trim()

  // Envelope sem nome nem args não diz o que foi digitado; deixá-lo virar bolha vazia seria pior do
  // que devolvê-lo como fala crua, que é o que o `null` faz.
  return comando === '' ? null : comando
}

/**
 * As ferramentas que uma mensagem de assistente chamou, na ordem em que aparecem no `content`.
 *
 * Mesma leitura defensiva do `assistantText`, e pelo mesmo motivo: a carga vem do modelo, não do
 * nosso código. Bloco que não dá para ler é ignorado, e nunca derruba a sessão.
 */
export function toolUses(payload: unknown, parentId: string | null): ChatToolUse[] {
  const message = asRecord(payload)
  if (!message) return []

  const uses: ChatToolUse[] = []
  for (const raw of asArray(message['content'])) {
    const block = asRecord(raw)
    if (block?.['type'] !== 'tool_use') continue

    const id = asString(block['id'])
    const name = asString(block['name'])
    // Sem id o `tool_result` não teria a que casar; sem nome a entrada não diria nada. Faltando
    // qualquer um dos dois, a entrada não informa — e inventá-los informaria errado.
    if (id === null || name === null) continue

    uses.push({
      id,
      role: 'tool',
      name,
      detail: detailOf(block['input']),
      headline: '',
      parentId,
      status: 'running',
      diff: null,
    })
  }

  return uses
}

/** O que uma ferramenta relatou: o id da chamada e o degrau em que ela parou. */
export interface ToolOutcome {
  id: string
  status: ToolStatus
}

/** Os resultados de ferramenta de uma mensagem `user`, casados pelo `tool_use_id`. */
export function toolResults(payload: unknown): ToolOutcome[] {
  const message = asRecord(payload)
  if (!message) return []

  const outcomes: ToolOutcome[] = []
  for (const raw of asArray(message['content'])) {
    const block = asRecord(raw)
    if (block?.['type'] !== 'tool_result') continue

    const id = asString(block['tool_use_id'])
    if (id === null) continue

    // A ausência é sucesso: no sucesso o SDK **não manda** `is_error`, em vez de mandá-lo `false`.
    outcomes.push({ id, status: block['is_error'] === true ? 'error' : 'done' })
  }

  return outcomes
}

/**
 * O argumento que identifica uma chamada: o primeiro campo de `DETAIL_FIELDS` que exista e seja
 * string, achatado numa linha só e cortado em `DETAIL_MAX`. Nenhum casa → `''`, e a entrada mostra
 * só o nome — é o que acontece com o `AskUserQuestion`, cuja pergunta o prompt logo abaixo já diz.
 */
export function detailOf(input: unknown): string {
  const record = asRecord(input)
  if (!record) return ''

  for (const field of DETAIL_FIELDS) {
    const value = asString(record[field])
    if (value === null) continue

    // Um passe só resolve as duas coisas: quebra de linha e espaço repetido viram um espaço.
    const flat = value.replace(/\s+/g, ' ').trim()
    return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX)}…` : flat
  }

  return ''
}

/**
 * O que uma chamada escreveu num arquivo, lido do `tool_use_result` — ou `null` quando ela não
 * escreveu nada que valha mostrar.
 *
 * **Decide por forma, nunca por nome de ferramenta.** Nunca pergunta se a chamada foi `Edit` ou
 * `Write`: pergunta se o resultado *tem a forma* de uma escrita. Mesma razão de o `DETAIL_FIELDS`
 * ser lista ordenada e não tabela por ferramenta — uma tabela por nome vira dívida no primeiro
 * release do CLI com ferramenta nova, e qualquer ferramenta futura que devolva `structuredPatch` já
 * entra desenhada.
 *
 * As contagens são **calculadas** a partir dos prefixos, e não lidas: o `gitDiff` que o tipo do SDK
 * promete nunca chegou populado nesta instalação (0 em 287 resultados no disco, 0 em 3 de uma sonda
 * ao vivo), e uma implementação escrita sobre ele mostraria `+0 −0` sempre.
 *
 * Mora aqui, e não no `SessionHandle`, mesmo sendo hoje usada só pelo caminho ao vivo: este módulo
 * é onde a tradução de bloco de ferramenta vive, e o `replay` já a chamaria se um dia o SDK passar
 * a devolver o campo no histórico.
 */
export function diffOf(result: unknown): FileDiff | null {
  const record = asRecord(result)
  if (!record) return null

  // Os trechos que sobreviveram à leitura, e só eles: um trecho descartado não emite linha e
  // **não conta** para os totais. Contar linhas de um trecho que não vai aparecer produziria um
  // `+37` ao lado de zero trecho — indistinguível de arquivo novo na tela.
  const aproveitados: DiffLine[][] = []
  let additions = 0
  let deletions = 0

  for (const raw of asArray(record['structuredPatch'])) {
    const hunk = asRecord(raw)
    if (!hunk) continue

    // Sem número de partida não há numeração possível, e numerar a partir de um chute faria a tela
    // apontar linhas que não são as do arquivo.
    const novo = asNumber(hunk['newStart'])
    const velho = asNumber(hunk['oldStart'])
    if (novo === null || velho === null) continue

    const lines = hunkLines(asArray(hunk['lines']), novo, velho)
    if (lines.length === 0) continue

    for (const line of lines) {
      if (line.kind === 'add') additions += 1
      else if (line.kind === 'remove') deletions += 1
    }

    aproveitados.push(lines)
  }

  if (aproveitados.length > 0) return capped(aproveitados, additions, deletions)

  // Arquivo novo: sem patch aproveitável, o tamanho é o que há para dizer. Medido: o `Write` de
  // criação vem com `structuredPatch` vazio em 86 de 86 casos, e com `content` sempre string.
  const content = record['type'] === 'create' ? asString(record['content']) : null
  if (content !== null && content !== '') {
    return { additions: countLines(content), deletions: 0, hunks: [], truncated: 0 }
  }

  // O `null` daqui é o guarda do `+0 −0`, e ele cobre três coisas de uma vez: a ferramenta que não
  // escreve arquivo (`Bash`, `Read`, `Grep`); a escrita cujo patch veio vazio sem ser criação — que
  // a doc do SDK diz acontecer quando nada mudou, quando o diff estourou tempo ou quando o conteúdo
  // anterior era grande demais para diferenciar; e o `structuredPatch: [{}]`, cujo único trecho o
  // laço acima descartou. Sem ele esse último caso viraria um `FileDiff` zerado, que ocupa uma
  // linha da tela para não dizer nada.
  return null
}

/**
 * As linhas de um trecho, numeradas pelos dois lados ao mesmo tempo.
 *
 * O alfabeto é fechado e foi medido: 5.456 linhas de patch deram `+` (2.515), espaço (2.019) e `-`
 * (922), e nada mais. **A linha de prefixo desconhecido é pulada, e não tratada como contexto** — o
 * único quarto caso plausível é o marcador `\ No newline at end of file` que a biblioteca `diff`
 * emite, e contá-lo como contexto deslocaria em um a numeração de todas as linhas seguintes do
 * trecho, transformando um detalhe cosmético num erro de dado.
 */
function hunkLines(raws: readonly unknown[], novoStart: number, velhoStart: number): DiffLine[] {
  const lines: DiffLine[] = []
  let novo = novoStart
  let velho = velhoStart

  for (const raw of raws) {
    const line = asString(raw)
    if (line === null || line === '') continue

    const text = line.slice(1)
    if (line.startsWith('+')) {
      lines.push({ kind: 'add', number: novo, text })
      novo += 1
    } else if (line.startsWith('-')) {
      // O lado velho é o único número que uma linha removida tem: ela não existe no arquivo novo.
      lines.push({ kind: 'remove', number: velho, text })
      velho += 1
    } else if (line.startsWith(' ')) {
      lines.push({ kind: 'context', number: novo, text })
      novo += 1
      velho += 1
    }
  }

  return lines
}

/**
 * Os trechos cortados no teto, com os totais intactos.
 *
 * **O corte pode cair no meio de um trecho**, e nesse caso ele é emitido parcialmente: descartar o
 * trecho inteiro por não caber jogaria fora linhas que cabiam. Os totais são os do patch **inteiro**
 * — o número que informa é o tamanho da mudança, não o do pedaço que coube.
 */
function capped(
  aproveitados: readonly DiffLine[][],
  additions: number,
  deletions: number,
): FileDiff {
  const total = aproveitados.reduce((soma, lines) => soma + lines.length, 0)
  const hunks: DiffHunk[] = []
  let emitidas = 0

  for (const lines of aproveitados) {
    // Trecho que ficaria com zero linha não é emitido: uma fronteira sem conteúdo é só um
    // separador solto na tela.
    const cabem = DIFF_MAX_LINES - emitidas
    if (cabem === 0) break

    const fatia = lines.length <= cabem ? lines : lines.slice(0, cabem)
    hunks.push({ lines: fatia })
    emitidas += fatia.length
  }

  return { additions, deletions, hunks, truncated: total - emitidas }
}

/**
 * Quantas linhas um arquivo novo nasceu tendo.
 *
 * Tira **uma** quebra final antes de dividir, porque ela fecha a última linha em vez de abrir uma
 * vazia: `"a\nb\n"` são duas linhas, `"\n"` é uma (vazia) e `"a"` é uma.
 */
function countLines(content: string): number {
  const corpo = content.endsWith('\n') ? content.slice(0, -1) : content

  return corpo.split('\n').length
}

/**
 * O texto de uma nota, quando o que está escrito como fala do usuário não é fala dele. `null`
 * quando é.
 *
 * A interrupção troca de texto — vira o mesmo `INTERRUPTED_NOTICE` do caminho ao vivo, porque o
 * mesmo fato tem de se ler igual, restaurado ou não. O resto mantém o próprio texto.
 */
function noticeOf(text: string): string | null {
  const inicio = text.trimStart()
  const nota = NOTAS.find((prefixo) => inicio.startsWith(prefixo))
  if (nota === undefined) return null

  return nota === INTERRUPCAO ? INTERRUPTED_NOTICE : inicio
}

/** Os blocos `type: 'text'` de um `content`, juntos. Vazio (ou ilegível) → `''`. */
function joinText(content: unknown): string {
  const texts: string[] = []
  for (const raw of asArray(content)) {
    const block = asRecord(raw)
    if (block?.['type'] !== 'text') continue

    const text = asString(block['text'])
    if (text !== null) texts.push(text)
  }

  return texts.join('\n')
}

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

/**
 * `NaN` e `Infinity` não são número de linha; `typeof` sozinho os deixaria passar.
 *
 * Local, e não importado de `board/narrow.ts`, que tem o gêmeo dele: o `core` mantém os dois
 * namespaces separados, e um fio de `session/` para `board/` por causa de um guarda de três linhas
 * seria o primeiro entre duas metades que hoje não se conhecem.
 */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
