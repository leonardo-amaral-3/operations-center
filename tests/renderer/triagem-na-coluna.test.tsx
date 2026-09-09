import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BoardCardView } from '../../src/renderer/components/BoardCardView'
import { Column } from '../../src/renderer/components/Column'
import { INITIAL_VIEW } from '../../src/renderer/session/sessionView'
import type { SessionView } from '../../src/renderer/session/sessionView'
import type { BoardCard, BoardColumn } from '../../src/shared/board'

/**
 * O painel da nova triagem dentro da coluna 📥 Triagem: onde ele nasce, o que ele **não** é, com que
 * rascunho a caixa dele abre, e a saída que nunca falta (CA-1, CA-2 e CA-3 do #27).
 *
 * O aparato é o do `danger-no-cartao.test.tsx`: `renderToStaticMarkup` sobre o `environment: 'node'`
 * que o Vitest já usa — zero jsdom, zero testing-library, zero dependência nova. Vale aqui a mesma
 * doutrina que aquele arquivo escreveu: **é teste de marcação, e não de interação.** Não há clique a
 * dar nem `useEffect` a rodar, então o critério de um botão é *"ele está lá, com o rótulo e sem
 * `disabled`"*, nunca *"clicar chama o callback"*. Quem prova o clique é o smoke.
 *
 * Duas afirmações vizinhas moram fora daqui de propósito, e nas duas pelo mesmo motivo — a regra não
 * é da coluna:
 * - **qual** coluna oferece a ação, e que a ação some enquanto o painel está lá, é decisão do
 *   `KanbanScreen` (`column.triage && triagem === null`). A coluna só desenha o que lhe pedem, e
 *   quem prova a decisão contra a tela de verdade é o smoke;
 * - o painel sumir quando a sessão entra em `closed` é um `useEffect`, que SSR não roda. Fica com o
 *   smoke e com o passo 5 da verificação pós-deploy.
 *
 * O `useSessionView` é mockado porque é a única forma de pôr a sessão nos estados que a Decisão 11
 * existe para cobrir — `failed` e o ramo sem pasta. O que se afirma continua sendo a saída do `Chat`
 * de verdade, montado pelo `TriagePanel` de verdade.
 */

const sessao = vi.hoisted(() => ({ view: null as SessionView | null }))

vi.mock('../../src/renderer/session/useSessionView', async () => {
  // O padrão sai do próprio `INITIAL_VIEW`, e não de um literal copiado: um campo novo na vista não
  // pode fazer este arquivo renderizar um retrato que não existe em lugar nenhum.
  const { INITIAL_VIEW: PADRAO } = await import('../../src/renderer/session/sessionView')

  return {
    useSessionView: () => ({
      view: sessao.view ?? PADRAO,
      send: () => {},
      decide: () => {},
      answer: () => {},
      stop: () => {},
      end: () => {},
      restart: () => {},
    }),
  }
})

beforeEach(() => {
  sessao.view = null
})

const TRIAGEM: BoardColumn = {
  id: 'OPT_TRI',
  name: '📥 Triagem',
  conversable: true,
  triage: true,
}

const CARTAO: BoardCard = {
  itemId: 'PVTI_alpha',
  number: 27,
  title: 'Iniciar uma nova triagem pela coluna 📥 Triagem',
  url: 'https://github.com/leonardo-amaral-3/operations-center/issues/27',
  repository: 'leonardo-amaral-3/operations-center',
  closed: false,
  assignees: ['leonardo-amaral-3'],
  columnId: 'OPT_TRI',
  fields: [],
  parent: null,
  phases: [],
}

/** O que o `KanbanScreen` monta na coluna quando a triagem daquela aba está aberta. */
const ABERTA = {
  boardKey: 'leonardo-amaral-3/2',
  dangerous: false,
  onEnd: () => {},
  onToggleDangerous: () => {},
}

function coluna(
  over: {
    triage?: typeof ABERTA
    onStartTriage?: () => void
    cards?: readonly BoardCard[]
    expandidos?: readonly string[]
  } = {},
): string {
  return renderToStaticMarkup(
    <Column
      column={TRIAGEM}
      cards={over.cards ?? [CARTAO]}
      expandedItemIds={over.expandidos ?? []}
      sessions={{}}
      conversations={[]}
      dangerous={[]}
      triage={over.triage}
      onStartTriage={over.onStartTriage}
      onToggle={() => {}}
      onSession={() => {}}
      onToggleDangerous={() => {}}
    />,
  )
}

/**
 * A tag de abertura do elemento que leva aquela âncora — é o que permite afirmar sobre um botão
 * específico sem varrer o documento inteiro atrás de uma palavra que aparece em qualquer outro.
 */
function tag(html: string, testid: string): string {
  const posicao = html.indexOf(`data-testid="${testid}"`)
  expect(posicao, `âncora ${testid} não está na saída`).toBeGreaterThan(-1)

  return html.slice(html.lastIndexOf('<', posicao), html.indexOf('>', posicao) + 1)
}

/**
 * Se aquele botão aceita clique.
 *
 * Procura o **atributo** `disabled=""` e não a palavra: a classe da primitiva carrega
 * `disabled:pointer-events-none` em todo botão do app, e um `toContain('disabled')` passaria verde
 * para sempre, dizendo o contrário do que se quer afirmar.
 */
function habilitado(html: string, testid: string): boolean {
  return !tag(html, testid).includes('disabled=""')
}

function ocorrencias(html: string, agulha: string): number {
  return html.split(agulha).length - 1
}

/**
 * A classe de largura da própria coluna — `w-90`, `w-[36rem]` —, lida da tag da `section` e não do
 * documento inteiro: `w-fit` e `w-full` aparecem em elementos de dentro.
 */
function largura(html: string): string {
  const classe = /class="([^"]*)"/.exec(tag(html, 'column'))?.[1] ?? ''
  const medida = classe.split(/\s+/).find((c) => c.startsWith('w-'))

  expect(medida, 'a coluna não declara largura').toBeDefined()

  return medida as string
}

describe('CA-1 — a ação no cabeçalho e o painel no topo da pilha', () => {
  it('a ação existe quando a coluna a oferece, e não existe quando não a oferece', () => {
    const com = coluna({ onStartTriage: () => {} })

    expect(com).toContain('data-testid="new-triage"')
    expect(com).toContain('+ Triagem')
    // A coluna não decide nada: sem o callback ela simplesmente não desenha a ação. Quem sabe que a
    // 📥 Triagem é a única a recebê-lo é o `KanbanScreen`, e é o smoke que o prova.
    expect(coluna()).not.toContain('new-triage')
  })

  it('o painel nasce **antes** do primeiro cartão da pilha', () => {
    const html = coluna({ triage: ABERTA })

    // A ordem é a afirmação: a triagem é o que ainda não virou card, e ela abre a coluna. Comparar
    // as posições é o que distingue "está na coluna" de "está no topo dela".
    expect(html).toContain('data-testid="triage-panel"')
    expect(html.indexOf('triage-panel')).toBeLessThan(html.indexOf('board-card'))
  })

  it('o painel alarga a coluna, pela mesma medida de um cartão aberto', () => {
    // O CA-1 manda repetir o `hosting` do cartão aberto, e a afirmação é essa — não o número. Este
    // teste fixava `w-[34rem]`, e o #54 alargou a coluna para `w-[36rem]`: o critério continuou
    // verdadeiro e só o teste ficou vermelho. A referência agora sai do próprio componente, então
    // ela acompanha a decisão sozinha na próxima vez que a medida mudar.
    const cartaoAberto = largura(coluna({ expandidos: [CARTAO.itemId] }))

    expect(largura(coluna({ triage: ABERTA }))).toBe(cartaoAberto)
    // E o painel alarga **sozinho**: aqui `expandedItemIds` está vazio, então o que alarga é só ele
    // — a metade do CA-1 que um render com cartão aberto junto não separaria.
    expect(largura(coluna())).not.toBe(cartaoAberto)
  })

  it('o painel **não é um cartão**: não vira `board-card` nem entra na contagem', () => {
    const html = coluna({ triage: ABERTA })

    // O cartão da fixture é um só, e continua sendo um só com o painel na coluna.
    expect(ocorrencias(html, 'data-testid="board-card"')).toBe(1)
    expect(html).toContain('data-column-count="1"')
    // A casca é a mesma do cartão; o conteúdo, não — é uma `section` com cabeçalho próprio, sem
    // número e sem campos.
    expect(tag(html, 'triage-panel')).toContain('<section')
    expect(html).toContain('Nova triagem')
  })
})

describe('CA-2 — a caixa nasce com o comando, e ninguém o disparou', () => {
  it('o rascunho é `/gm-triage `, e a conversa está vazia', () => {
    const html = coluna({ triage: ABERTA })

    expect(html).toContain('data-testid="card-chat-input"')
    // O app **oferece** o comando; quem o dispara é o humano (RN-4). A prova de que nada foi enviado
    // é a conversa vazia ao lado do rascunho posto — as duas coisas no mesmo retrato.
    expect(html).toContain('/gm-triage ')
    expect(html).toContain('A sessão está de pé. Escreva a primeira mensagem.')
    expect(html).not.toContain('data-testid="message"')
  })
})

describe('CA-3 — a saída do painel sempre existe (Decisão 11)', () => {
  it('sem sessão nenhuma o botão fecha, e não está desabilitado', () => {
    // O retrato de antes de a sessão subir: `id: null`, `starting`. É onde o `disabled` de antes do
    // #27 prenderia o painel na coluna sem nunca ter havido o que encerrar.
    const html = coluna({ triage: ABERTA })

    expect(habilitado(html, 'card-end-session')).toBe(true)
    expect(html).toContain('Fechar')
  })

  it('com a sessão falhada o botão do painel continua habilitado — e o do cartão não', () => {
    sessao.view = { ...INITIAL_VIEW, id: 'sess_1', state: { kind: 'failed', reason: 'spawn' } }

    expect(habilitado(coluna({ triage: ABERTA }), 'card-end-session')).toBe(true)

    // O contraste é a regra inteira: o que decide o `disabled` é a **presença do `onEnded`**, e não
    // o estado. O cartão não o passa, porque ele continua existindo depois de a sessão morrer; o
    // painel passa, porque sem esse botão ele não teria como sair de cena.
    const cartao = renderToStaticMarkup(
      <BoardCardView
        card={CARTAO}
        conversable
        expanded
        session={undefined}
        dormant={false}
        dangerous={false}
        onToggle={() => {}}
        onSession={() => {}}
        onToggleDangerous={() => {}}
      />,
    )

    expect(habilitado(cartao, 'card-end-session')).toBe(false)
  })

  it('no ramo sem pasta o painel oferece fechar ao lado de escolher a pasta', () => {
    sessao.view = { ...INITIAL_VIEW, unknownFolder: true }
    const html = coluna({ triage: ABERTA })

    // A frase é a da triagem, e não a do cartão: os dois não erram pelo mesmo motivo.
    expect(html).toContain('Não sei em que pasta rodar a triagem deste board.')
    expect(html).toContain('data-testid="choose-folder"')
    expect(habilitado(html, 'card-end-session')).toBe(true)
    // E não há como colapsar: a triagem ou está aberta conversando, ou não existe (Decisão 4).
    expect(html).not.toContain('card-collapse')
  })

  it('com a sessão viva o mesmo botão encerra, e o rótulo diz isso', () => {
    sessao.view = { ...INITIAL_VIEW, id: 'sess_1', state: { kind: 'working' } }
    const html = coluna({ triage: ABERTA })

    expect(habilitado(html, 'card-end-session')).toBe(true)
    expect(html).toContain('Encerrar sessão')
    expect(html).not.toContain('>Fechar<')
  })
})
