import type { JSX } from 'react'

import type { DiffLine, FileDiff } from '../../shared/session'

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
 * Os trechos de um diff e a linha "… mais N linhas" do corte.
 *
 * Saiu do `ToolEntry` para o PR (#82) desenhar o patch de um arquivo do mesmo jeito que a trilha do
 * chat. O invólucro, os `data-*` e a linha de totais continuam em quem usa: cada tela tem o seu.
 */
export function DiffView({ diff }: { diff: FileDiff }): JSX.Element {
  return (
    <>
      {diff.hunks.map((hunk, indiceDoTrecho) => (
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
              <span className="w-10 shrink-0 text-right text-foreground/40">{linha.number}</span>
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

      {diff.truncated > 0 ? (
        <p className="text-foreground/40">{`… mais ${diff.truncated} linhas`}</p>
      ) : null}
    </>
  )
}
