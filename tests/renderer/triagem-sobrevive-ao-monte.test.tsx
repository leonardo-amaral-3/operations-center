// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useCallback, useState } from 'react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TriagePanel } from '../../src/renderer/components/TriagePanel'
import { useSessionView } from '../../src/renderer/session/useSessionView'
import { instalarOc } from './fakeOc'
import type { OcFake } from './fakeOc'

/**
 * A régua de quem encerra a sessão quando um monte do efeito é descartado (#63).
 *
 * É o **primeiro** arquivo de `tests/renderer/` a rodar em `jsdom`, e a exceção tem razão escrita:
 * a substância deste defeito é a ordem entre monte, limpeza e a resolução de uma promessa, e
 * prendê-la exige `useEffect` rodando de verdade — o que o `renderToStaticMarkup` dos vizinhos não
 * alcança. O ambiente troca pelo docblock da primeira linha, arquivo a arquivo: o `vitest.config.ts`
 * continua em `environment: 'node'` e nenhum outro teste migra de carona.
 *
 * O `@testing-library/react` não registra a limpeza automática porque o Vitest aqui roda sem
 * `globals` — daí o `afterEach(cleanup)` na mão. Sem ele, o painel de um caso continuaria montado no
 * `document` do seguinte, e o registro do falso mediria duas telas somadas.
 */

afterEach(cleanup)

/** A aba de quem é a triagem: é ela que vira `scopeKey`, e é a chave que a régua nova pesa. */
const BOARD_KEY = 'leonardo-amaral-3/2'

/** O que o humano digitou antes de o painel sumir — o "texto que se perde" do card. */
const RASCUNHO = '/gm-triage o painel some no meio da digitação'

let oc: OcFake

beforeEach(() => {
  oc = instalarOc()
})

/**
 * O mínimo do que o `KanbanScreen` faz com o painel: guarda se a triagem está aberta e a tira da
 * árvore quando o `onEnd` chega (`KanbanScreen.tsx:197-199` → `kanbanState.ts:88`). Sem ele o painel
 * nunca sai de cena, e as asserções sobre "o painel continua na coluna" e "o rascunho está intacto"
 * passariam com ou sem a correção — decorativas.
 */
function Hospedeiro({ aoEncerrar }: { aoEncerrar: () => void }): JSX.Element | null {
  const [aberta, setAberta] = useState(true)
  // `useCallback` como o `endTriage` do `KanbanScreen`: a identidade estável do `onEnded` é premissa
  // do efeito de `Chat.tsx:108-113`, e trocá-la a cada render mudaria o que está sob teste.
  const encerrar = useCallback(() => {
    setAberta(false)
    aoEncerrar()
  }, [aoEncerrar])

  if (!aberta) return null

  return (
    <TriagePanel
      boardKey={BOARD_KEY}
      dangerous={false}
      onEnd={encerrar}
      onToggleDangerous={() => {}}
    />
  )
}

/**
 * A vista **sem escopo**, reduzida ao osso: é o `ChatScreen` (`ChatScreen.tsx:24`) do ponto de vista
 * do hook. Não desenha nada porque não há nada a olhar — o que se afirma é o que ela pede à ponte.
 */
function Sonda(): null {
  useSessionView({ closeOnUnmount: true })

  return null
}

// O tipo do retorno é quem resolve o genérico do `getByTestId`: sem ele o `disabled` e o `value`
// abaixo não existiriam num `HTMLElement` cru, e com ele um `as` seria redundante.
const input = (): HTMLTextAreaElement => screen.getByTestId('card-chat-input')

/**
 * O portão é **"a sessão subiu"**, e o sinal dele é o input habilitado.
 *
 * Não esperar por `card-chat`: aquela âncora é renderizada incondicionalmente já no primeiro render
 * (`Chat.tsx:213`), porque `INITIAL_VIEW.unknownFolder` é `false` (`sessionView.ts:78`). Esperar por
 * ela não prova nada e estraga o que vem depois — o rascunho seria digitado contra um `<Textarea
 * disabled>` (enquanto `view.id === null`, `morta` é verdadeiro, `Chat.tsx:183` e `:194`) e o Caso 2
 * afirmaria antes de o `close` ter tido chance de sair. O input só destrava depois de o retrato ter
 * sido aplicado, isto é, depois de `ownId` existir.
 */
async function esperarSessaoDePe(): Promise<void> {
  await waitFor(() => {
    expect(input().disabled).toBe(false)
  })
}

/**
 * Asserção negativa precisa de **descarga**, não de `waitFor`: `waitFor` prova que algo *passa a
 * ser* verdade, e nunca que algo *nunca* acontece. Drenar os microtasks uma vez põe o `close` do
 * monte descartado — se ele existir — de pé antes de afirmarmos que ele não existe.
 */
async function drenar(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('a triagem sobrevive ao monte descartado', () => {
  it('o duplo-monte não derruba o painel nem leva o rascunho junto', async () => {
    const espiao = vi.fn()

    render(
      <StrictMode>
        <Hospedeiro aoEncerrar={espiao} />
      </StrictMode>,
    )

    await esperarSessaoDePe()
    fireEvent.change(input(), { target: { value: RASCUNHO } })
    await drenar()

    // A premissa antes da afirmação: com escopo o `start` é idempotente (`livingSessionFor` e
    // `oneStartPerScope`, `src/main/ipc.ts`), então os dois montes recebem a **mesma** sessão. Um id
    // distinto por monte significaria que o teste está medindo outra coisa que não o #63.
    expect(oc.entregues).toHaveLength(2)
    expect(new Set(oc.entregues).size).toBe(1)

    // O coração do #63: a vista descartada pelo StrictMode não pode encerrar a sessão que a vista
    // viva está mostrando.
    expect(oc.fechadas).toEqual([])
    expect(espiao).not.toHaveBeenCalled()

    // E o que o humano vê disso: o painel de pé na coluna, com o que ele digitou ainda lá.
    expect(screen.queryByTestId('triage-panel')).not.toBeNull()
    expect(input().value).toBe(RASCUNHO)
  })

  it('o desmonte de verdade encerra a sessão, e exatamente uma vez', async () => {
    // Sem `StrictMode`: é a saída real — «Fechar», «Encerrar sessão», ou a troca de aba que zera a
    // triagem em `kanbanState.ts:80`. Esta é a guarda contra a correção preguiçosa, a que apenas
    // parasse de encerrar: sem ela a sessão vazaria viva e a triagem seguinte reencontraria a
    // conversa velha, contra as Decisões 4 e 5 do #27.
    const { unmount } = render(<Hospedeiro aoEncerrar={() => {}} />)

    await esperarSessaoDePe()
    unmount()
    await drenar()

    expect(oc.fechadas).toHaveLength(1)
    expect(oc.fechadas).toEqual(oc.entregues)
  })

  it('sem escopo, o descarte continua encerrando a sessão que é dele', async () => {
    render(
      <StrictMode>
        <Sonda />
      </StrictMode>,
    )

    // Sem DOM para esperar, o portão é a própria asserção positiva: a sonda não desenha nada, e o
    // que se espera é justamente o `close` que os outros dois casos esperam **não** ver.
    await waitFor(() => {
      expect(oc.fechadas).toHaveLength(1)
    })

    // A assimetria inteira em duas linhas: sem escopo cada `start` cunha uma sessão nova, então o id
    // do monte descartado é só dele — e é ele, o primeiro, que tem de ser encerrado.
    expect(oc.entregues).toHaveLength(2)
    expect(new Set(oc.entregues).size).toBe(2)
    expect(oc.fechadas).toEqual(oc.entregues.slice(0, 1))
  })
})
