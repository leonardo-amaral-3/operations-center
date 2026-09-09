import type { JSX } from 'react'

import type { ChatToolUse, DiffLine, FileDiff, ToolStatus } from '../../shared/session'

interface ToolEntryProps {
  entry: ChatToolUse
}

/**
 * A marca de cada desfecho.
 *
 * `done` e `aborted` são os dois cinzas, e por isso têm glifos diferentes: a distinção que importa
 * é "terminou" contra "não relatou", e ela não pode depender de o olho comparar dois tons de
 * neutro. `aborted` **não** é vermelho de propósito — a ferramenta não falhou, o turno é que acabou
 * antes de ela contar o que aconteceu, e pintá-la de erro acusaria uma falha que não houve.
 *
 * Depois do card #8 os dois cinzas são duas opacidades do **mesmo** preto do tema, que é o que
 * sobra num sistema de uma cor de texto só — e continuam sendo dois graus de "terminou", não duas
 * cores. Só o `error` sai da escala, porque só ele é sinalização.
 */
const MARKS: Record<ToolStatus, { glyph: string; label: string; className: string }> = {
  running: { glyph: '▸', label: 'rodando', className: 'text-foreground' },
  done: { glyph: '✓', label: 'concluída', className: 'text-foreground/60' },
  error: { glyph: '✕', label: 'falhou', className: 'text-danger' },
  aborted: { glyph: '⊘', label: 'sem resposta', className: 'text-foreground/40' },
}

/**
 * O glifo de cada espécie de linha — **tabela explícita**, e não o prefixo de volta do texto.
 *
 * Quem leu `+`, `-` e o espaço foi o core, uma vez, e o que atravessou a ponte já veio decidido: a
 * tela reencontrar o prefixo seria reimplementar a leitura do patch do lado errado da ponte. O `−`
 * daqui nem é o `-` que veio no arquivo — é o traço tipográfico (U+2212), o mesmo da linha de
 * totais, para os dois sinais terem a mesma largura e o mesmo peso.
 */
const DIFF_GLYPHS: Record<DiffLine['kind'], string> = {
  add: '+',
  remove: '−',
  context: ' ',
}

/**
 * A cor da linha é **fundo**, não tinta, e isso não é preferência: o design system afere contraste
 * de `--foreground` *sobre* `--attention` e *sobre* `--danger` e publica `bg-*` na allowlist — os
 * dois tokens são fundo por construção.
 *
 * O `/30` continua fora da tabela de contraste porque mistura não é cor sólida, mas o preço deixou
 * de ser zero. O argumento antigo — `--foreground` é preto puro em toda combinação, logo o contraste
 * é monotônico na luminância — morreu com a obsidiana, que declara tinta clara: sobre estes dois
 * fundos a tinta cheia cai de 17.39 para **4.80** no `add` e de 15.27 para **5.79** no `remove`, AA
 * e não AAA. Consertar exigiria um token de tinta rebaixada por combinação, porque a opacidade do
 * Tailwind é estática na classe e não varia por tema — é card próprio. Aqui fica medido e
 * declarado, não esquecido.
 */
const DIFF_BACKGROUNDS: Record<DiffLine['kind'], string> = {
  add: 'bg-attention/30',
  remove: 'bg-danger/30',
  context: '',
}

/**
 * A linha de totais: `+N` e `−M`, com o `−M` **omitido** quando nada foi removido.
 *
 * Uma string só, montada aqui, e não dois pedaços concatenados no JSX: `+0 −0` num arquivo que
 * acabou de nascer diria que algo foi removido de um arquivo que não existia.
 *
 * Os números são os do patch **inteiro**, e não os do pedaço que coube na tela — o que informa é o
 * tamanho da mudança, não o do trecho exibido.
 */
function totaisDe(diff: FileDiff): string {
  return diff.deletions > 0 ? `+${diff.additions} −${diff.deletions}` : `+${diff.additions}`
}

/**
 * Uma ação na trilha da conversa: o que a sessão fez, enquanto ela faz.
 *
 * Ela é irmã da bolha de texto e não um enfeite ao lado dela — nasce da mesma lista de mensagens,
 * na posição em que o fato aconteceu, e é isso que faz "rolar a conversa para cima" mostrar a
 * história inteira em vez de só as falas.
 *
 * **Um tamanho só para as duas telas.** O cartão do kanban escreve em `text-xs` e a tela de chat em
 * `text-sm`; a trilha fica no menor dos dois nos dois lugares, porque ela é informação subordinada
 * à conversa — e porque uma prop de tamanho aqui seria uma escolha a tomar em cada ponto de uso
 * para um ganho que ninguém pediu.
 *
 * O recuo do subagente não monta árvore nenhuma: as entradas de dentro de um `Agent` chegam
 * **depois** da entrada que as gerou, então a ordem da lista já é a hierarquia, e o recuo só a
 * torna visível.
 */
export function ToolEntry({ entry }: ToolEntryProps): JSX.Element {
  const mark = MARKS[entry.status]
  const nested = entry.parentId !== null

  return (
    <div
      data-testid="tool-entry"
      data-tool={entry.name}
      data-status={entry.status}
      // Vazio quando é de nível de cima, e não ausente: é o que deixa o teste afirmar "esta não é
      // de subagente" em vez de só não achar o atributo — o mesmo trato do `data-card-assignees`.
      data-parent={entry.parentId ?? ''}
      className={nested ? 'ml-3 border-l-2 border-border pl-2.5 opacity-70' : ''}
    >
      <div className="flex items-baseline gap-1.5">
        <span title={mark.label} className={`shrink-0 text-[11px] ${mark.className}`}>
          {mark.glyph}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-foreground">{entry.name}</span>
        {/* O `title` cheio porque a linha corta duas vezes: o core já trouxe o argumento em 120
            caracteres, e a largura do cartão corta de novo o que couber. O hover é onde o
            argumento inteiro continua legível. */}
        <span title={entry.detail} className="min-w-0 truncate text-[11px] text-foreground/60">
          {entry.detail}
        </span>
      </div>

      {/* A frase que o próprio Claude Code escreveu, quando ele a mandou. Segunda linha e não a
          primeira: o nome da ferramenta é o que se procura ao varrer a trilha com o olho. */}
      {entry.headline ? (
        <p className="mt-0.5 ml-4 truncate text-[10px] text-foreground/50">{entry.headline}</p>
      ) : null}

      {/* O que a chamada escreveu, enquanto ela escreve. Dentro da mesma entrada e depois do
          `headline`, e não num painel ao lado: o diff é a terceira linha do mesmo fato, e é isso
          que faz as duas telas que já montam a trilha ganharem-no sem tocar em nenhuma delas.

          Nada quando `entry.diff` é `null` — o que cobre toda ferramenta que não mexe em arquivo,
          a escrita que não mudou nada, e a conversa restaurada do disco, onde o SDK não devolve o
          campo. */}
      {entry.diff !== null ? (
        <div
          data-testid="tool-diff"
          data-additions={entry.diff.additions}
          data-deletions={entry.diff.deletions}
          // Sempre presente, inclusive valendo `0` — mesmo trato do `data-parent` acima. Sem ele,
          // "quantas linhas ficaram de fora" só poderia ser afirmado lendo a prosa do corte.
          data-truncated={entry.diff.truncated}
          className="mt-1 ml-4 font-mono text-[10px]"
        >
          <p className="text-foreground/60">{totaisDe(entry.diff)}</p>

          {entry.diff.hunks.map((hunk, indiceDoTrecho) => (
            <div
              key={indiceDoTrecho}
              // A fronteira entre dois trechos é um salto no arquivo. Enfeite de fronteira, e por
              // isso ele **não** conta para o teto de linhas, que é contagem de linha de diff.
              className={indiceDoTrecho > 0 ? 'mt-0.5 border-t border-border pt-0.5' : ''}
            >
              {hunk.lines.map((linha, indiceDaLinha) => (
                <div
                  key={indiceDaLinha}
                  data-testid="diff-line"
                  data-diff-kind={linha.kind}
                  className={`flex items-baseline gap-1 ${DIFF_BACKGROUNDS[linha.kind]}`}
                >
                  {/* `w-10` fixo para caber quatro dígitos: sem largura fixa, a coluna se
                      realinharia entre um trecho e outro do mesmo diff. */}
                  <span className="w-10 shrink-0 text-right text-foreground/40">
                    {linha.number}
                  </span>
                  {/* `whitespace-pre` por causa do `context`, cujo glifo é um espaço — sem isso o
                      HTML o colapsaria e a coluna de texto andaria um caractere para a esquerda. */}
                  <span className="shrink-0 whitespace-pre text-foreground/40">
                    {DIFF_GLYPHS[linha.kind]}
                  </span>
                  {/* Corta, não quebra, e com o texto inteiro no `title` — como o `detail` já faz.
                      Quebrar destruiria o alinhamento da coluna de número, e rolagem horizontal
                      aqui dentro é exatamente o painel que esta feature não é. */}
                  <span title={linha.text} className="min-w-0 truncate text-foreground">
                    {linha.text}
                  </span>
                </div>
              ))}
            </div>
          ))}

          {entry.diff.truncated > 0 ? (
            <p className="text-foreground/40">{`… mais ${entry.diff.truncated} linhas`}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
