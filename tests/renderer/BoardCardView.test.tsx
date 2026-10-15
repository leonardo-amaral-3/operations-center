import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BoardCardView } from '../../src/renderer/components/BoardCardView'
import type { BoardCard, BoardPhase } from '../../src/shared/board'
import type { TerminalState } from '../../src/shared/claude'

/**
 * O parentesco pelo lado da tela: o crachá do épico no cartão da fase, a lista de fases no cartão do
 * épico, e — o critério que sustenta os outros dois — **nenhum nó a mais** no cartão comum.
 *
 * O aparato é o do `danger-no-cartao.test.tsx`: `renderToStaticMarkup` sobre o `environment: 'node'`
 * que o Vitest já usa, zero jsdom e zero dependência nova. **É teste de marcação**, e é tudo o que
 * estes três casos pedem: a lista é inerte por decisão (a 8), então não há clique a dar aqui.
 *
 * O que este arquivo **não** testa, de propósito: a **ordem** das fases. Ela chega pronta na prop —
 * quem ordena por número crescente é `linkPhases`, no core, e é `epics.test.ts` quem a prova. Repetir
 * a asserção aqui provaria que o `.map()` preserva a ordem do array, e não que o app está certo.
 */

const EPICO_DE_FORA = 908

/** As fases chegam do core já resolvidas — `columnName` incluído — e em ordem. */
const FASES: readonly BoardPhase[] = [
  {
    itemId: 'PVTI_fase_905',
    number: 905,
    title: 'Primeira fase',
    columnId: 'da732a01',
    columnName: '🔨 Implementação',
  },
  {
    itemId: 'PVTI_fase_906',
    number: 906,
    title: 'Segunda fase',
    columnId: '98bb4dfe',
    columnName: '✅ Produção',
  },
  {
    itemId: 'PVTI_fase_907',
    number: 907,
    title: 'Terceira fase',
    columnId: '4c049744',
    columnName: '📋 Backlog',
  },
]

const COMUM: BoardCard = {
  itemId: 'PVTI_comum',
  number: 4,
  title: 'Ler o board e desenhar o kanban',
  url: 'https://github.com/leonardo-amaral-3/operations-center/issues/4',
  repository: 'leonardo-amaral-3/operations-center',
  closed: false,
  assignees: [],
  columnId: 'da732a01',
  fields: [{ name: 'Tipo', value: '✨ Melhoria', optionId: 'b6b3a417' }],
  parent: null,
  phases: [],
}

function cartao(over: Partial<BoardCard> = {}): string {
  return renderToStaticMarkup(
    <BoardCardView
      card={{ ...COMUM, ...over }}
      conversable
      expanded={false}
      terminal={null}
      dormant={false}
      dangerous={false}
      onToggle={() => {}}
      onToggleDangerous={() => {}}
    />,
  )
}

describe('CA-1 — a fase nomeia o épico', () => {
  it('desenha o crachá com o número na âncora e o título do épico no `title`', () => {
    // O épico **fora do board** é o caso que decide de onde vem o dado: se o crachá dependesse da
    // varredura do retrato, este cartão não teria o que mostrar. Ele mostra, porque `parent` vem da
    // resposta da API.
    const html = cartao({
      parent: {
        number: EPICO_DE_FORA,
        title: 'Mostrar no kanban que um cartão é fase de um épico',
        repository: 'leonardo-amaral-3/operations-center',
      },
    })

    expect(html).toContain('data-testid="card-parent"')
    expect(html).toContain(`data-parent-number="${String(EPICO_DE_FORA)}"`)
    // O título inteiro do épico no hover: é a única forma de saber **de que** épico se trata sem
    // sair do cartão, já que a linha só cabe o número.
    expect(html).toContain(
      `title="Fase de #${String(EPICO_DE_FORA)} — Mostrar no kanban que um cartão é fase de um épico"`,
    )

    // "Dentro do mesmo contêiner `flex flex-wrap`" é metade do CA-1, e é o que esta ordem afirma: o
    // crachá vem depois do `#número` e antes do título, logo está na linha das etiquetas de campo.
    expect(html.indexOf('data-testid="card-parent"')).toBeGreaterThan(html.indexOf('#4'))
    expect(html.indexOf('data-testid="card-parent"')).toBeLessThan(html.indexOf(COMUM.title))
  })
})

describe('CA-2 — o épico lista suas fases', () => {
  it('desenha uma linha por fase, sem teto', () => {
    const html = cartao({ phases: FASES })

    // Contagem, e só: três fases entram, três linhas saem. `card-phases` é o bloco; `card-phase` é
    // a linha, e o fecha-aspas é o que impede o primeiro de ser contado como o segundo.
    expect(html).toContain('data-testid="card-phases"')
    expect(html.match(/data-testid="card-phase"/g)).toHaveLength(FASES.length)

    // "Entre o título e a linha do responsável" — a posição é o critério, porque uma lista desenhada
    // acima do título trocaria o assunto do cartão.
    const bloco = html.indexOf('data-testid="card-phases"')

    expect(bloco).toBeGreaterThan(html.indexOf(COMUM.title))
    expect(bloco).toBeLessThan(html.indexOf('sem dono'))
  })
})

describe('CA-3 — o cartão comum não muda', () => {
  it('sem pai e sem fases, não emite `card-parent` nem `card-phases`', () => {
    // Asserção **por ausência**, que é o que "o DOM é idêntico ao de hoje" quer dizer para a maioria
    // dos cartões do board. Os nós inteiros são condicionais de propósito — a convenção do "vazio em
    // vez de ausente" (`data-card-assignees`) vale para atributo de nó que sempre existe, e aqui não
    // é o caso.
    const html = cartao()

    expect(html).not.toContain('card-parent')
    expect(html).not.toContain('data-parent-number')
    expect(html).not.toContain('card-phases')
    expect(html).not.toContain('card-phase')
  })
})

interface ExpandidoOpts {
  card?: Partial<BoardCard>
  conversable?: boolean
  expanded?: boolean
  maximized?: boolean
  semBotao?: boolean
}

/** O cartão aberto (#28), com os três modos que a spec distingue: fechado, aberto e expandido. */
function aberto({
  card = {},
  conversable = true,
  expanded = true,
  maximized = false,
  semBotao = false,
}: ExpandidoOpts = {}): string {
  return renderToStaticMarkup(
    <BoardCardView
      card={{ ...COMUM, ...card }}
      conversable={conversable}
      expanded={expanded}
      terminal={null}
      dormant={false}
      dangerous={false}
      onToggle={() => {}}
      onToggleDangerous={() => {}}
      maximized={maximized}
      onMaximize={semBotao ? undefined : () => {}}
      onRestore={semBotao ? undefined : () => {}}
    />,
  )
}

describe('#28 CA-1 e CA-3 — o modo expandido', () => {
  it('cartão fechado não tem o botão `card-maximize`', () => {
    expect(aberto({ expanded: false })).not.toContain('card-maximize')
  })

  it('aberto e não expandido: botão "Expandir", sem `absolute` e sem grade', () => {
    const html = aberto()

    expect(html).toContain('data-testid="card-maximize"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Expandir')
    expect(html).not.toContain('absolute')
    expect(html).not.toMatch(/data-testid="card-open-body"[^>]*class="[^"]*grid/)
  })

  it('expandido: botão "Recolher", `article` cobrindo a tela e duas colunas com conversa', () => {
    const html = aberto({ maximized: true })

    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Recolher')
    expect(html).toMatch(/<article[^>]*class="[^"]*absolute inset-0/)
    expect(html).toMatch(/data-testid="card-open-body"[^>]*class="[^"]*grid-cols-2/)
  })

  it('expandido sem conversa: coluna única', () => {
    const html = aberto({ maximized: true, conversable: false })

    expect(html).toMatch(/data-testid="card-open-body"[^>]*class="[^"]*grid-cols-1/)
    expect(html).not.toContain('grid-cols-2')
  })

  it('expandido e fechado no GitHub: opaco, sem `opacity-60`', () => {
    const html = aberto({ maximized: true, card: { closed: true } })

    expect(html).toMatch(/<article[^>]*class="[^"]*opacity-100/)
    expect(html).not.toContain('opacity-60')
  })

  it('aberto sem `onMaximize`: nenhum `card-maximize`', () => {
    expect(aberto({ semBotao: true })).not.toContain('card-maximize')
  })
})

function comTerminal(
  terminal: TerminalState | null,
  over: { expanded?: boolean; dormant?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <BoardCardView
      card={COMUM}
      conversable
      expanded={over.expanded ?? false}
      terminal={terminal}
      dormant={over.dormant ?? false}
      dangerous={false}
      onToggle={() => {}}
      onToggleDangerous={() => {}}
    />,
  )
}

describe('#97 R3.1 — o terminal Claude no cartão', () => {
  it.each(['working', 'awaiting_decision', 'awaiting_answer', 'awaiting_input'] as const)(
    'fechado, com o terminal em `%s`: o selo leva o `data-state` correspondente',
    (kind) => {
      expect(comTerminal({ kind })).toContain(`data-state="${kind}"`)
    },
  )

  it('fechado, com `closed` ou `null` e dormente: o `ConversationBadge`, sem selo de estado', () => {
    for (const terminal of [{ kind: 'closed' } as const, null]) {
      const html = comTerminal(terminal, { dormant: true })

      expect(html).not.toContain('data-testid="state-badge"')
      expect(html).toContain('data-testid="conversation-badge"')
    }
  })

  it('expandido: a barra do terminal no lugar do chat', () => {
    const html = comTerminal(null, { expanded: true })

    expect(html).toContain('data-testid="claude-terminal-bar"')
    expect(html).not.toContain('card-chat')
  })
})
