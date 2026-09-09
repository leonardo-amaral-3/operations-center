import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BoardCardView } from '../../src/renderer/components/BoardCardView'
import type { CardSession } from '../../src/renderer/components/Chat'
import type { BoardCard } from '../../src/shared/board'

/**
 * O CA-2 pelo lado da tela: o crachá aparece **sem sessão nenhuma**, **junto** do de estado quando há
 * sessão viva, e **também com o cartão aberto** — as três formas em que ele se afasta dos outros dois
 * crachás do rodapé.
 *
 * O aparato é o mesmo do `fila-na-tela.test.tsx`: `renderToStaticMarkup` sobre o `environment: 'node'`
 * que o Vitest já usa — zero jsdom, zero testing-library, zero dependência nova.
 *
 * **É teste de marcação, e não de interação**, e isso decide o que dá para afirmar aqui: não há
 * clique a dar nem `useEffect` a rodar, então o critério do botão é *"o rótulo e o `data-dangerous`
 * são os da prop"*, nunca *"clicar chama o callback"*. Quem prova o clique é o smoke.
 *
 * O corolário é o que faz o cartão **aberto** caber neste aparato: `Chat` e `CardContent` só
 * tocam o `window.oc` de dentro de efeitos, e SSR não roda efeito. Daí o `Chat` render com o
 * `INITIAL_VIEW` — sem `init`, e por isso sem a linha do `cwd`, que é onde o `data-permission-mode`
 * mora. Aquela âncora se prova no smoke, que é o único lugar em que existe um `init` de verdade.
 */

const CARTAO: BoardCard = {
  itemId: 'PVTI_alpha',
  number: 10,
  title: 'Rodar o chat sem pedir permissão a cada ferramenta',
  url: 'https://github.com/leonardo-amaral-3/operations-center/issues/10',
  repository: 'leonardo-amaral-3/operations-center',
  closed: false,
  assignees: ['leonardo-amaral-3'],
  columnId: 'da732a01',
  fields: [{ name: 'Tipo', value: '✨ Melhoria', optionId: 'b6b3a417' }],
}

const VIVA: CardSession = { id: 'sess_1', state: { kind: 'working' } }

function cartao(
  over: { expanded?: boolean; session?: CardSession; dormant?: boolean; dangerous?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <BoardCardView
      card={CARTAO}
      conversable
      expanded={over.expanded ?? false}
      session={over.session}
      dormant={over.dormant ?? false}
      dangerous={over.dangerous ?? false}
      onToggle={() => {}}
      onSession={() => {}}
      onToggleDangerous={() => {}}
    />,
  )
}

describe('CA-2 — o crachá do modo é do cartão, e não da sessão', () => {
  it('aparece no cartão colapsado marcado **sem sessão nenhuma**', () => {
    // É o caso que a decisão 6 existe para garantir: amarrar a marca ao retrato da sessão faria o
    // crachá sumir justamente no cartão que ainda não foi clicado.
    const html = cartao({ dangerous: true })

    expect(html).toContain('data-testid="danger-badge"')
    expect(html).toContain('Dangerously')
    // Sem sessão não há crachá de estado — e o do modo aparece assim mesmo.
    expect(html).not.toContain('data-testid="state-badge"')
  })

  it('não aparece no cartão não marcado', () => {
    expect(cartao()).not.toContain('danger-badge')
  })

  it('aparece **junto** do crachá de estado quando há sessão viva', () => {
    // Os dois convivem, ao contrário do par estado/conversa: um fala da sessão, o outro do cartão.
    const html = cartao({ session: VIVA, dangerous: true })

    expect(html).toContain('data-testid="danger-badge"')
    expect(html).toContain('data-testid="state-badge"')
  })

  it('aparece **também com o cartão aberto**', () => {
    // A primeira das duas diferenças em relação aos vizinhos do rodapé: eles se calam ao expandir
    // porque o `Chat` conta a mesma história melhor; este não tem substituto lá dentro.
    expect(cartao({ expanded: true, dangerous: true })).toContain('data-testid="danger-badge"')
  })

  it('e é o único do rodapé que não se cala ao abrir', () => {
    // A regressão que o grupo novo do rodapé poderia introduzir: o `!expanded` dos outros dois não
    // pode ter ido embora junto com a reindentação.
    //
    // O recorte é obrigatório e não zelo: com o cartão aberto **existe** um `state-badge` na saída
    // — o do próprio `Chat`, que desenha o estado da sessão dele. Quem se cala é o crachá do
    // **rodapé do cartão**, e ele é tudo o que vem antes do chat.
    const html = cartao({ expanded: true, session: VIVA, dangerous: true })
    const rodape = html.slice(0, html.indexOf('data-testid="card-chat"'))

    expect(rodape).toContain('data-testid="danger-badge"')
    expect(rodape).not.toContain('data-testid="state-badge"')
  })
})

describe('CA-2 — o botão diz para que lado o clique vai', () => {
  it('no cartão não marcado, oferece ligar e a âncora diz `false`', () => {
    const html = cartao({ expanded: true })

    expect(html).toContain('data-testid="card-danger-toggle"')
    expect(html).toContain('data-dangerous="false"')
    expect(html).toContain('Rodar sem pedir permissão')
  })

  it('no cartão marcado, oferece desligar e a âncora diz `true`', () => {
    // A reversibilidade do CA-2 lida no rótulo: o mesmo botão, o sentido invertido.
    const html = cartao({ expanded: true, dangerous: true })

    expect(html).toContain('data-dangerous="true"')
    expect(html).toContain('Voltar a pedir')
    expect(html).not.toContain('Rodar sem pedir permissão')
  })

  it('não é desabilitado quando a sessão morreu', () => {
    // Marcar um cartão cuja sessão morreu é decisão sobre a **próxima** sessão dele, e é legítima —
    // ao contrário do "Encerrar sessão", que ali fica desabilitado.
    const html = cartao({
      expanded: true,
      session: { id: 'sess_2', state: { kind: 'closed' } },
    })

    // O `renderToStaticMarkup` só emite `disabled` no botão que o pediu; o recorte em volta da
    // âncora é o que impede a asserção de ler o `disabled` do "Encerrar sessão", que é vizinho.
    const botao = html.slice(html.indexOf('data-testid="card-danger-toggle"'))

    expect(botao.slice(0, botao.indexOf('</button>'))).not.toContain('disabled')
  })
})
