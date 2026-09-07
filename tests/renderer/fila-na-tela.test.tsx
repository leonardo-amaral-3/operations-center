import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PermissionPrompt } from '../../src/renderer/components/PermissionPrompt'
import { QuestionPrompt } from '../../src/renderer/components/QuestionPrompt'
import { StateBadge } from '../../src/renderer/components/StateBadge'
import type { PermissionRequest, QuestionRequest, SessionState } from '../../src/shared/session'

/**
 * A parte do CA-1 e do CA-2 que a pessoa **lê**: quantos pedidos ainda esperam atrás do que está na
 * tela, nos dois prompts e no crachá do cartão colapsado.
 *
 * O aparato é o mesmo do `MessageBubble.test.tsx` — `renderToStaticMarkup` dentro do
 * `environment: 'node'` que o Vitest já usa, zero dependência nova e zero jsdom. O que se afirma
 * aqui é a **saída**, que é onde a contagem existe.
 *
 * As âncoras (`prompt-queued`, `data-queued`) são contrato da spec: se uma asserção não achar a
 * âncora, quem volta ao nome certo é o componente, nunca o teste.
 */

const PERMISSAO: PermissionRequest = { id: 'toolu_a', toolName: 'Write' }

const PERGUNTA: QuestionRequest = {
  id: 'toolu_b',
  questions: [
    {
      question: 'Qual caminho seguir?',
      header: 'Caminho',
      multiSelect: false,
      options: [{ label: 'O curto', description: 'menos escala' }],
    },
  ],
}

function badge(state: SessionState): string {
  return renderToStaticMarkup(<StateBadge state={state} />)
}

describe('CA-1 — o prompt de permissão anuncia quem está atrás', () => {
  it('com um pedido na fila, diz quantos ainda esperam', () => {
    const html = renderToStaticMarkup(
      <PermissionPrompt request={PERMISSAO} onDecide={() => {}} queued={1} />,
    )

    expect(html).toContain('data-testid="prompt-queued"')
    expect(html).toContain('mais 1 esperando')
  })

  it('com a fila vazia o prompt não diz nada', () => {
    const html = renderToStaticMarkup(
      <PermissionPrompt request={PERMISSAO} onDecide={() => {}} queued={0} />,
    )

    expect(html).not.toContain('prompt-queued')
    expect(html).not.toContain('esperando')
  })

  it('leva o id do pedido em cartaz na âncora que o smoke lê', () => {
    // `data-request` é o que distingue "o pedido mudou" de "nada aconteceu" quando o `data-state`
    // fica parado em `awaiting_decision` — a premissa do laço dos smokes depois desta branch.
    const html = renderToStaticMarkup(
      <PermissionPrompt request={PERMISSAO} onDecide={() => {}} queued={0} />,
    )

    expect(html).toContain('data-request="toolu_a"')
  })
})

describe('CA-2 — o prompt de pergunta conta pela mesma regra', () => {
  it('com um pedido na fila, diz quantos ainda esperam', () => {
    const html = renderToStaticMarkup(
      <QuestionPrompt request={PERGUNTA} onAnswer={() => {}} queued={2} />,
    )

    expect(html).toContain('data-testid="prompt-queued"')
    expect(html).toContain('mais 2 esperando')
  })

  it('com a fila vazia o prompt não diz nada', () => {
    const html = renderToStaticMarkup(
      <QuestionPrompt request={PERGUNTA} onAnswer={() => {}} queued={0} />,
    )

    expect(html).not.toContain('prompt-queued')
    expect(html).not.toContain('esperando')
  })
})

describe('CA-1 — o crachá leva a fila para o cartão colapsado', () => {
  it('o rótulo carrega o contador, e a âncora carrega o número', () => {
    // É o único sinal visível no cartão fechado do kanban: sem ele, "há mais dois esperando" só
    // apareceria para quem abrisse a conversa.
    const html = badge({ kind: 'awaiting_decision', request: PERMISSAO, queued: 2 })

    expect(html).toContain('Decisão pendente · +2')
    expect(html).toContain('data-queued="2"')
  })

  it('sem fila, o rótulo é o de sempre e a âncora diz zero', () => {
    const html = badge({ kind: 'awaiting_decision', request: PERMISSAO, queued: 0 })

    expect(html).toContain('Decisão pendente')
    expect(html).not.toContain('·')
    expect(html).toContain('data-queued="0"')
  })
})

describe('CA-2 e regressão — o crachá de pergunta conta igual, e o de falha guarda o motivo', () => {
  it('a pergunta pendente também anuncia a fila', () => {
    const html = badge({ kind: 'awaiting_answer', request: PERGUNTA, queued: 1 })

    expect(html).toContain('Pergunta pendente · +1')
    expect(html).toContain('data-queued="1"')
  })

  it('a ternária do rótulo não engoliu o motivo da falha', () => {
    // A regressão que a nova ternária poderia introduzir: `failed` não tem `queued`, e o motivo é a
    // única informação que aquele rótulo sozinho não dá.
    const html = badge({ kind: 'failed', reason: 'a sessão não subiu' })

    expect(html).toContain('Falhou: a sessão não subiu')
    expect(html).toContain('data-queued="0"')
  })

  it('um estado que não espera ninguém não inventa contagem', () => {
    expect(badge({ kind: 'working' })).toContain('data-queued="0"')
  })
})
