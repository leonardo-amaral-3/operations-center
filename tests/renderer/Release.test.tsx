// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAVE_DO_BOARD_DA_FABRICA } from '../../src/renderer/fabrica/boardDaFabrica'
import type { PropsDaTela } from '../../src/renderer/fabrica/telas'
import { Release } from '../../src/renderer/fabrica/telas/Release'
import {
  URL_DA_DEV_PARA_MAIN,
  URL_DO_BOARD_DA_FABRICA,
  textoDasNotas,
} from '../../src/renderer/fabrica/trem'
import type { BoardCard, BoardsSnapshot, CardContent } from '../../src/shared/board'
import type { ReadCardResult } from '../../src/shared/ipc'
import { BOARD_DO_PROJECT_2 } from './boardNaFabrica'

/** A tela Release da F6 (#135, CA-6.3/6.4). A ponte é falsa; nada é escrito em lugar nenhum. */

const REPO = 'leonardo-amaral-3/operations-center'
const COLUNAS = [
  { id: 'c-bac', name: '📋 Backlog', conversable: true, triage: false },
  { id: 'c-rel', name: '🚂 Release', conversable: true, triage: false },
]

function card(n: number, columnId: string, extra: Partial<BoardCard> = {}): BoardCard {
  return {
    itemId: `PVTI_${n}`,
    number: n,
    title: `Título ${n}`,
    url: `https://github.com/${REPO}/issues/${n}`,
    repository: REPO,
    closed: false,
    assignees: [],
    columnId,
    fields: [],
    parent: null,
    phases: [],
    ...extra,
  }
}

function boards(cards: BoardCard[]): BoardsSnapshot {
  return {
    boards: [
      {
        key: CHAVE_DO_BOARD_DA_FABRICA,
        title: 'OC',
        readAt: 1,
        error: null,
        board: { title: 'OC', columns: COLUNAS, cards },
      },
    ],
    activeKey: CHAVE_DO_BOARD_DA_FABRICA,
    discoveryError: null,
  }
}

function conteudo(n: number, comentarios: CardContent['comments'] = []): ReadCardResult {
  return {
    ok: true,
    content: { number: n, body: '', comments: comentarios, truncated: false, pullRequest: null },
  }
}

function spec(body: string) {
  return { id: 'c1', author: 'leo', createdAt: '2026-11-11T00:00:00Z', body, kind: 'spec' }
}

const SPEC_COM_ITENS = spec(
  '<!-- gm:spec -->\n## Verificação pós-deploy\n1. Abrir a tela Release\n2. Conferir o trem\n\n## Rollback\nnada',
)

const BOARD = boards([
  card(940, 'c-bac'),
  card(210, 'c-rel', { fields: [{ name: 'Tipo', value: '✨ Melhoria', optionId: 'x' }] }),
  card(211, 'c-rel'),
  card(212, 'c-rel', { parent: { number: 100, title: 'Épico', repository: REPO } }),
])

const readBoards = vi.fn<() => Promise<BoardsSnapshot>>()
const readCard = vi.fn<(r: { itemId: string }) => Promise<ReadCardResult>>()
const comandoFabrica = vi.fn()
const escrita = vi.fn()
const writeText = vi.fn<(t: string) => Promise<void>>()

beforeEach(() => {
  readBoards.mockReset().mockResolvedValue(BOARD)
  readCard.mockReset().mockImplementation((r) => {
    if (r.itemId === 'PVTI_210') return Promise.resolve(conteudo(210, [SPEC_COM_ITENS]))
    if (r.itemId === 'PVTI_211') return Promise.resolve(conteudo(211))
    return Promise.resolve(conteudo(212, [{ ...spec('<!-- gm:spec-ref -->'), kind: 'spec-ref' }]))
  })
  comandoFabrica.mockReset()
  escrita.mockReset()
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Object.defineProperty(window, 'oc', {
    value: {
      readBoards,
      onBoards: () => () => {},
      readCard,
      comandoFabrica,
      writeCard: escrita,
    },
    configurable: true,
  })
})
afterEach(cleanup)

function props(extra: Partial<PropsDaTela> = {}): PropsDaTela {
  return {
    tela: { tela: 'release' },
    sala: null,
    ir: vi.fn(),
    comando: () => Promise.resolve(),
    emVoo: false,
    board: BOARD_DO_PROJECT_2,
    ...extra,
  }
}

async function abrir() {
  render(<Release {...props()} />)
  await screen.findAllByTestId('fabrica-release-card')
}

describe('Release · o trem (CA-6.3)', () => {
  it('mostra a trilha, o chip G5, o rótulo do trem e uma linha por card com tipo e chip', async () => {
    await abrir()
    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('Release')
    expect(screen.getByText('G5 · nível C · só você')).toBeTruthy()
    expect(screen.getByText('TREM DA 🚂 RELEASE · operations-center · dev → main')).toBeTruthy()
    expect(screen.getByText('versão: quem escolhe é o /gm-release')).toBeTruthy()
    const linhas = screen.getAllByTestId('fabrica-release-card')
    expect(linhas.map((l) => l.getAttribute('data-card'))).toEqual(['210', '211', '212'])
    expect(within(linhas[0]!).getByText('Melhoria')).toBeTruthy()
    expect(within(linhas[0]!).getByText('Título 210', { exact: false })).toBeTruthy()
    for (const l of linhas) expect(within(l).getByText('na 🚂 Release do board')).toBeTruthy()
  })

  it('o trem, as notas e a verificação ficam em listas com teto (#149)', async () => {
    await abrir()
    const lista = (nome: string) => {
      const el = document.querySelector(`[data-lista="${nome}"]`)
      expect(el, nome).not.toBeNull()
      expect(el!.getAttribute('data-teto')).toBe('640')
      return el!
    }
    const trem = lista('release-trem')
    for (const c of screen.getAllByTestId('fabrica-release-card'))
      expect(trem.contains(c)).toBe(true)

    const notas = lista('release-notas')
    expect(notas.textContent).toContain('Título 210')
    expect(notas.contains(screen.getByTestId('fabrica-release-notas'))).toBe(false)

    const verificacao = await waitFor(() => {
      const el = lista('release-verificacao')
      expect(el.querySelectorAll('[data-testid="fabrica-release-check"]').length).toBeGreaterThan(0)
      return el
    })
    for (const c of screen.getAllByTestId('fabrica-release-check'))
      expect(verificacao.contains(c)).toBe(true)
    const aviso = screen.getByText(/Nenhum agente roda estas consultas/)
    expect(verificacao.contains(aviso)).toBe(false)
  })

  it('as notas têm uma linha por card e Copiar notas copia o textoDasNotas', async () => {
    await abrir()
    const notas = screen.getByTestId('fabrica-release-notas')
    expect(notas.textContent).toContain('O que muda para você')
    expect(notas.textContent).toContain('#210 Título 210')
    fireEvent.click(screen.getByTestId('fabrica-release-copiar'))
    await waitFor(() => expect(screen.getByTestId('fabrica-release-copia')).toBeTruthy())
    expect(writeText).toHaveBeenCalledTimes(1)
    const cards = BOARD.boards![0]!.board!.cards.filter((c) => c.columnId === 'c-rel')
    expect(writeText).toHaveBeenCalledWith(textoDasNotas(cards))
    expect(screen.getByTestId('fabrica-release-copia').textContent).toBe(
      'Notas copiadas: cole onde quiser; o texto final é do /gm-release.',
    )
  })

  it('mostra o erro quando o clipboard rejeita', async () => {
    writeText.mockRejectedValue(new Error('negado'))
    await abrir()
    fireEvent.click(screen.getByTestId('fabrica-release-copiar'))
    await waitFor(() =>
      expect(screen.getByTestId('fabrica-release-copia').textContent).toBe(
        'Não deu para copiar: negado',
      ),
    )
  })

  it('só os itens da spec são marcáveis; os demais casos mostram o texto', async () => {
    await abrir()
    await waitFor(() => expect(screen.getAllByTestId('fabrica-release-check')).toHaveLength(2))
    const checks = screen.getAllByTestId('fabrica-release-check')
    expect(checks[0]!.textContent).toBe('#210: Abrir a tela Release')
    const sem = screen.getAllByTestId('fabrica-release-sem-check').map((e) => e.textContent)
    expect(sem).toEqual([
      '#211: o card não tem comentário gm:spec',
      '#212: a verificação está na spec do épico #100',
    ])
  })

  it('marcar uma caixa é local: nada do window.oc é chamado além das leituras', async () => {
    await abrir()
    await waitFor(() => expect(screen.getAllByTestId('fabrica-release-check')).toHaveLength(2))
    const antes = readCard.mock.calls.length
    const box = within(screen.getAllByTestId('fabrica-release-check')[0]!).getByRole('checkbox')
    expect((box as HTMLInputElement).checked).toBe(false)
    fireEvent.click(box)
    expect((box as HTMLInputElement).checked).toBe(true)
    expect(readCard.mock.calls.length).toBe(antes)
    expect(comandoFabrica).not.toHaveBeenCalled()
    expect(escrita).not.toHaveBeenCalled()
  })

  it('lê o readCard uma vez por card, em sequência', async () => {
    let solta: (r: ReadCardResult) => void = () => {}
    readCard.mockReset().mockImplementationOnce(
      () =>
        new Promise<ReadCardResult>((res) => {
          solta = res
        }),
    )
    readCard.mockResolvedValue(conteudo(0))
    render(<Release {...props()} />)
    await screen.findAllByTestId('fabrica-release-card')
    await waitFor(() => expect(readCard).toHaveBeenCalledTimes(1))
    expect(readCard).toHaveBeenLastCalledWith({ itemId: 'PVTI_210' })
    solta(conteudo(210))
    await waitFor(() => expect(readCard).toHaveBeenCalledTimes(3))
    expect(readCard.mock.calls.map((c) => c[0].itemId)).toEqual([
      'PVTI_210',
      'PVTI_211',
      'PVTI_212',
    ])
  })

  it('readCard que rejeita vira a linha de falha, sem derrubar a tela', async () => {
    readCard.mockReset().mockRejectedValue(new Error('sem rede'))
    await abrir()
    await waitFor(() =>
      expect(
        screen.getAllByTestId('fabrica-release-sem-check').map((e) => e.textContent),
      ).toContain('#210: não deu para ler o card: sem rede'),
    )
  })

  it('trem vazio: os três vazios e Copiar desabilitado', async () => {
    readBoards.mockResolvedValue(boards([card(940, 'c-bac')]))
    render(<Release {...props()} />)
    await screen.findByTestId('fabrica-release-vazio')
    expect(screen.getByTestId('fabrica-release-sem-verificacao')).toBeTruthy()
    expect(screen.getByTestId('fabrica-release-notas').textContent).toContain(
      'Nada no trem: sem notas.',
    )
    expect(screen.getByTestId<HTMLButtonElement>('fabrica-release-copiar').disabled).toBe(true)
    expect(screen.getByText('TREM DA 🚂 RELEASE · operations-center · dev → main')).toBeTruthy()
    expect(readCard).not.toHaveBeenCalled()
  })

  it('board lendo: nenhum vazio de trem e os textos de leitura', () => {
    readBoards.mockReturnValue(new Promise(() => {}))
    render(<Release {...props()} />)
    expect(screen.queryByTestId('fabrica-release-vazio')).toBeNull()
    expect(screen.queryByTestId('fabrica-release-sem-verificacao')).toBeNull()
    expect(screen.getByTestId('fabrica-release-notas').textContent).toContain('Lendo o board…')
    expect(screen.getByTestId<HTMLButtonElement>('fabrica-release-copiar').disabled).toBe(true)
  })

  it('board com erro: mostra o erro e nenhum vazio de trem', async () => {
    readBoards.mockRejectedValue(new Error('sem token'))
    render(<Release {...props()} />)
    const erro = await screen.findByTestId('fabrica-release-erro')
    expect(erro.textContent).toContain('sem token')
    expect(screen.queryByTestId('fabrica-release-vazio')).toBeNull()
    expect(screen.queryByTestId('fabrica-release-sem-verificacao')).toBeNull()
    expect(screen.getByTestId('fabrica-release-notas').textContent).toContain(
      'Sem leitura do board: sem notas.',
    )
    expect(screen.getByText('Sem leitura do board, sem verificação.')).toBeTruthy()
  })
})

describe('Release · só leitura (CA-6.4)', () => {
  it('os links abrem no navegador com os hrefs do trem.ts e nada chama comandoFabrica', async () => {
    await abrir()
    const board = screen.getByTestId('fabrica-release-board')
    const devMain = screen.getByTestId('fabrica-release-dev-main')
    expect(board.getAttribute('href')).toBe(URL_DO_BOARD_DA_FABRICA)
    expect(devMain.getAttribute('href')).toBe(URL_DA_DEV_PARA_MAIN)
    for (const a of [board, devMain]) expect(a.getAttribute('target')).toBe('_blank')
    fireEvent.click(screen.getByTestId('fabrica-release-copiar'))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(comandoFabrica).not.toHaveBeenCalled()
  })
})

describe('Release · o card abre a tela Card em qualquer ponto (#145, CA-2)', () => {
  it('clicar na linha leva ao Card, e o link #n não navega', async () => {
    const p = props()
    render(<Release {...p} />)
    await screen.findAllByTestId('fabrica-release-card')
    const linha = screen.getAllByTestId('fabrica-release-card')[0]!
    fireEvent.click(within(linha).getByText('Título 210', { exact: false }))
    expect(p.ir).toHaveBeenCalledWith({ tela: 'card', card: 210 })
    vi.mocked(p.ir).mockClear()
    fireEvent.click(within(linha).getByRole('link'))
    expect(p.ir).not.toHaveBeenCalled()
  })
})
