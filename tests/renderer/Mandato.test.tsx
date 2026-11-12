// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PropsDaTela } from '../../src/renderer/fabrica/telas'
import { Mandato } from '../../src/renderer/fabrica/telas/Mandato'
import type { MandatoNaSala, PortaoDoMandato } from '../../src/shared/fabrica'
import { BOARD_DE_DOIS_REPOS, BOARD_DO_PROJECT_2 } from './boardNaFabrica'

/** A tela Mandato da F5 (#134, CA-5.4/5.5, CA-E4): só a ponte `readFabricaMandato` é falsa. */

const FONTE_A =
  'Você decide sozinho os portões da sua etapa (G1, G2, G3, G4), commits e PR. O merge na dev é do braço direito.'
const FONTE_G5 = 'Proibido: main, release, tag;'

const base = (
  id: PortaoDoMandato['id'],
  nome: string,
  nota: string,
  extra: Partial<PortaoDoMandato> = {},
): PortaoDoMandato => ({ id, nome, nota, quem: null, travado: false, fonte: null, ...extra })
const A = { quem: 'A', fonte: FONTE_A } as const

const OK: MandatoNaSala = {
  kind: 'ok',
  portoes: [
    base('entrada', 'Entrada', 'o que você conta na tela Entrada'),
    base('g1', 'G1 · card', 'promover para Backlog', A),
    base('g2', 'G2 · spec', 'depois do revisor independente', A),
    base('g3', 'G3 · tasks', 'fatiar em tasks', A),
    base('impl', 'Implementação e integração', 'commits e PR', A),
    base('g4', 'G4 · merge na dev', 'CI verde e revisão tratada', A),
    base('val', 'Validação em dev', 'roteiro da spec, evidência na PR'),
    base('g5', 'G5 · release e produção', 'merge na main e verificação pós-deploy', {
      quem: 'C',
      travado: true,
      fonte: FONTE_G5,
    }),
    base('op', 'Operação', 'abrir bug com o sinal anexado'),
  ],
  regras: [
    'O despacho de um card pode acrescentar paradas, nunca tirar.',
    FONTE_G5,
    'Pare (PARADA) em: ação irreversível.',
  ],
}

const readFabricaMandato = vi.fn<() => Promise<MandatoNaSala>>()

beforeEach(() => {
  readFabricaMandato.mockReset().mockResolvedValue(OK)
  Object.defineProperty(window, 'oc', { value: { readFabricaMandato }, configurable: true })
})
afterEach(cleanup)

function props(extra: Partial<PropsDaTela> = {}): PropsDaTela {
  return {
    tela: { tela: 'mandato' },
    sala: null,
    ir: vi.fn(),
    comando: () => Promise.resolve(),
    emVoo: false,
    board: BOARD_DO_PROJECT_2,
    ...extra,
  }
}

const quemDe = (linha: HTMLElement) =>
  within(linha)
    .getAllByTestId('fabrica-celula')
    .map((c) => c.querySelector('[data-quem]')?.getAttribute('data-quem'))

describe('Mandato', () => {
  it('o board da aba decide a pasta lida e o link do mandato (#157)', async () => {
    render(<Mandato {...props({ board: BOARD_DE_DOIS_REPOS })} />)

    await waitFor(() => {
      expect(readFabricaMandato).toHaveBeenCalledWith({ board: 'fulano/8' })
    })
    expect(screen.getByTestId('fabrica-mandato-github').getAttribute('href')).toBe(
      'https://github.com/fulano/repo-a/blob/dev/fabrica/MANDATO.md',
    )
  })

  it('enquanto lê, mostra o aviso e a tabela com "sem leitura"', () => {
    readFabricaMandato.mockReturnValue(new Promise(() => undefined))
    render(<Mandato {...props()} />)

    expect(screen.getByTestId('fabrica-mandato-lendo').textContent).toBe('Lendo o mandato da dev…')
    expect(screen.getAllByTestId('fabrica-portao')).toHaveLength(9)
    expect(quemDe(screen.getAllByTestId('fabrica-portao')[0]!)).toEqual([
      'sem-leitura',
      'sem-leitura',
      'sem-leitura',
    ])
    expect(screen.getAllByTestId('fabrica-regra').map((r) => r.textContent)).toEqual([
      'O despacho de um card pode acrescentar paradas, nunca tirar.',
    ])
  })

  it('ok: cabeçalho, nove linhas, data-quem por célula e nada clicável na tabela', async () => {
    render(<Mandato {...props()} />)
    await waitFor(() => {
      expect(screen.queryByTestId('fabrica-mandato-lendo')).toBeNull()
    })

    expect(screen.getByTestId('fabrica-trilha').textContent).toContain('Mandato')
    expect(screen.getByTestId('fabrica-mandato-origem').textContent).toBe(
      'fabrica/MANDATO.md da dev · só leitura',
    )
    const link = screen.getByTestId('fabrica-mandato-github')

    expect(link.getAttribute('href')).toBe(
      'https://github.com/leonardo-amaral-3/operations-center/blob/dev/fabrica/MANDATO.md',
    )
    expect(link.textContent).toBe('Abrir no GitHub')

    const linhas = screen.getAllByTestId('fabrica-portao')

    expect(linhas.map((l) => l.getAttribute('data-portao'))).toEqual([
      'entrada',
      'g1',
      'g2',
      'g3',
      'impl',
      'g4',
      'val',
      'g5',
      'op',
    ])
    const tres = (q: string) => [q, q, q]

    expect(quemDe(linhas[0]!)).toEqual(tres('nao-diz'))
    expect(quemDe(linhas[1]!)).toEqual(tres('A'))
    expect(quemDe(linhas[4]!)).toEqual(tres('A'))
    expect(quemDe(linhas[7]!)).toEqual(tres('travado'))
    expect(quemDe(linhas[8]!)).toEqual(tres('nao-diz'))

    const grupo = within(linhas[1]!).getAllByRole('group')[0]!

    expect(grupo.getAttribute('aria-label')).toBe('G1 · card, Rota Curta')
    expect(grupo.getAttribute('title')).toBe(FONTE_A)
    expect(
      Array.from(grupo.children).map((s) => `${s.textContent}:${s.getAttribute('data-on')}`),
    ).toEqual(['A:true', 'B:false', 'C:false'])
    expect(within(linhas[7]!).getAllByText('C · travado')[0]!.getAttribute('title')).toBe(FONTE_G5)
    expect(within(screen.getByTestId('fabrica-portoes')).queryAllByRole('button')).toHaveLength(0)
  })

  it('ok: as regras do mandato e o placar com a linha de base', async () => {
    render(<Mandato {...props()} />)
    await waitFor(() => {
      expect(screen.getAllByTestId('fabrica-regra')).toHaveLength(3)
    })

    const placar = screen.getByTestId('fabrica-placar')

    expect(screen.getByTestId('fabrica-placar-base').textContent).toBe(
      'linha de base: 559 sessões, 25/09 a 12/10 (claude-brain#28)',
    )
    const numeros = screen.getAllByTestId('fabrica-placar-numero')

    expect(numeros.map((n) => n.firstElementChild?.textContent)).toEqual(['~10', '~10', '3', '—'])
    expect(numeros[3]!.textContent).toContain('a fábrica ainda não mede')
    expect(within(placar).getByTestId('fabrica-rebaixamento').textContent).toContain(
      'Ainda não existe: nenhuma estação volta de A para B sozinha.',
    )
  })

  it('erro: alerta, células "sem leitura" e só a regra das paradas', async () => {
    readFabricaMandato.mockResolvedValue({ kind: 'erro', erro: 'sem rede' })
    render(<Mandato {...props()} />)

    const alerta = await screen.findByRole('alert')

    expect(alerta.textContent).toBe('Não deu para ler o fabrica/MANDATO.md da dev: sem rede')
    expect(
      screen
        .getAllByTestId('fabrica-celula')
        .every((c) => c.querySelector('[data-quem]')?.getAttribute('data-quem') === 'sem-leitura'),
    ).toBe(true)
    expect(screen.getAllByTestId('fabrica-regra')).toHaveLength(1)
    expect(screen.getByTestId('fabrica-regras').textContent).toContain('sem leitura do mandato')
  })

  it('rejeição e método ausente no fake viram erro', async () => {
    readFabricaMandato.mockRejectedValue(new Error('caiu'))
    const r = render(<Mandato {...props()} />)

    expect((await screen.findByRole('alert')).textContent).toContain('caiu')
    r.unmount()

    Object.defineProperty(window, 'oc', { value: {}, configurable: true })
    render(<Mandato {...props()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('a migalha 0 volta à Sala', async () => {
    const ir = vi.fn()

    render(<Mandato {...props({ ir })} />)
    await screen.findAllByTestId('fabrica-regra')
    fireEvent.click(screen.getByTestId('fabrica-trilha-0'))
    expect(ir).toHaveBeenCalledWith({ tela: 'sala' })
  })
})
