// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CardContent } from '../../src/renderer/components/CardContent'
import type { PullRequestRef } from '../../src/shared/board'
import type { OcApi, ReadCardResult, ReadPullRequestResult } from '../../src/shared/ipc'

/**
 * O contêiner das abas Card e PR (#83) diante de um ⟳ do card — que só existe na aba Card, daí todo
 * caso voltar a ela antes do ⟳: o PR que troca, o PR que some e
 * volta, e a leitura que falha. A vista pura (`CardContentView.test.tsx`) não alcança nada disto —
 * a substância é a ordem entre leitura, `useEffect` e monte do painel —, daí o `jsdom`, como no
 * `triagem-sobrevive-ao-monte.test.tsx`.
 *
 * O falso da ponte é mínimo e próprio: só `readCard`, com as respostas que o teste enfileira, e
 * `readPullRequest`, cujas chamadas são a régua de "o painel leu".
 */

afterEach(cleanup)

const PR_87: PullRequestRef = { number: 87, url: 'https://github.com/o/r/pull/87', state: 'OPEN' }
const PR_88: PullRequestRef = { number: 88, url: 'https://github.com/o/r/pull/88', state: 'OPEN' }

function lido(pullRequest: PullRequestRef | null): ReadCardResult {
  return { ok: true, content: { number: 83, body: 'corpo', comments: [], truncated: false, pullRequest } }
}

let fila: ReadCardResult[]
let readPullRequest: ReturnType<typeof vi.fn<() => Promise<ReadPullRequestResult>>>

beforeEach(() => {
  fila = []
  readPullRequest = vi.fn(() => Promise.resolve<ReadPullRequestResult>({ ok: false, reason: 'sem rede' }))
  const oc: Pick<OcApi, 'readCard' | 'readPullRequest'> = {
    readCard: () => Promise.resolve(fila.shift() ?? lido(null)),
    readPullRequest,
  }
  ;(window as unknown as { oc: typeof oc }).oc = oc
})

/** Monta o cartão expandido com a primeira leitura e espera as abas. */
async function montar(primeira: ReadCardResult): Promise<void> {
  fila.push(primeira)
  render(<CardContent itemId="PVTI_83" hasSession={false} preencher />)
  await screen.findByTestId('card-tab-pr')
}

/** Um ⟳ do card que devolve `resultado`, esperando a leitura aterrissar. */
async function recarregar(resultado: ReadCardResult): Promise<void> {
  fila.push(resultado)
  await act(async () => {
    fireEvent.click(screen.getByTestId('card-content-reload'))
    await Promise.resolve()
  })
}

describe('o painel do PR acompanha o PR que a aba nomeia', () => {
  it('⟳ que devolve o mesmo PR mantém o painel: voltar à aba PR não relê', async () => {
    await montar(lido(PR_87))
    fireEvent.click(screen.getByTestId('card-tab-pr'))
    fireEvent.click(screen.getByTestId('card-tab-card'))
    await waitFor(() => expect(readPullRequest).toHaveBeenCalledTimes(1))

    await recarregar(lido(PR_87))
    fireEvent.click(screen.getByTestId('card-tab-pr'))

    expect(screen.getByTestId('card-pr-body')).not.toBeNull()
    expect(readPullRequest).toHaveBeenCalledTimes(1)
  })

  it('⟳ que troca o PR fora da aba PR descarta o painel velho e só lê ao selecionar', async () => {
    await montar(lido(PR_87))
    fireEvent.click(screen.getByTestId('card-tab-pr'))
    fireEvent.click(screen.getByTestId('card-tab-card'))
    await waitFor(() => expect(readPullRequest).toHaveBeenCalledTimes(1))

    await recarregar(lido(PR_88))

    expect(screen.getByTestId('card-tab-pr').textContent).toBe('PR #88')
    expect(screen.queryByTestId('card-pr-body')).toBeNull()
    expect(readPullRequest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('card-tab-pr'))
    await waitFor(() => expect(readPullRequest).toHaveBeenCalledTimes(2))
  })

  it('PR que some e volta num ⟳ não é lido na aba Card (CA-6)', async () => {
    await montar(lido(PR_87))
    fireEvent.click(screen.getByTestId('card-tab-pr'))
    fireEvent.click(screen.getByTestId('card-tab-card'))
    await waitFor(() => expect(readPullRequest).toHaveBeenCalledTimes(1))

    await recarregar(lido(null))
    expect(screen.queryByTestId('card-tab-pr')).toBeNull()

    await recarregar(lido(PR_87))
    expect(screen.getByTestId('card-tab-card').getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('card-pr-body')).toBeNull()
    expect(readPullRequest).toHaveBeenCalledTimes(1)
  })

  it('⟳ do card que falha não tira as abas nem desmonta o painel do PR (CA-6)', async () => {
    await montar(lido(PR_87))
    fireEvent.click(screen.getByTestId('card-tab-pr'))
    fireEvent.click(screen.getByTestId('card-tab-card'))
    await waitFor(() => expect(readPullRequest).toHaveBeenCalledTimes(1))

    await recarregar({ ok: false, reason: 'o GitHub não respondeu' })

    expect(screen.getByTestId('card-tab-pr').textContent).toBe('PR #87')
    expect(screen.getByTestId('card-pr-body')).not.toBeNull()
    fireEvent.click(screen.getByTestId('card-tab-pr'))
    expect(screen.getByTestId('card-pr-body')).not.toBeNull()
    expect(readPullRequest).toHaveBeenCalledTimes(1)
  })
})
