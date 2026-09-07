import type { JSX } from 'react'

import type { ChatToolUse, ToolStatus } from '../../shared/session'

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
    </div>
  )
}
