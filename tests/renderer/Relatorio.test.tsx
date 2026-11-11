// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RelatorioDaSalaView } from '../../src/renderer/fabrica/Relatorio'
import type { RelatorioDaSala } from '../../src/shared/fabrica'

/**
 * A aba Relatório da sala (#126, §B4): o pedido na montagem, os avisos de "sem fonte", o erro, o
 * botão travado enquanto gera e a resposta de um pedido antigo descartada. Um
 * `window.oc.readRelatorio` falso: o main nem entra.
 */

const ok = (semFonte: number, dia = '2026-11-10'): RelatorioDaSala => ({
  kind: 'ok',
  dia,
  markdown: `Relatório do dia ${dia}`,
  semFonte,
  geradoEm: '2026-11-11T12:00:00.000Z',
})

const readRelatorio = vi.fn<(pedido: { dia: string }) => Promise<RelatorioDaSala>>()

beforeEach(() => {
  readRelatorio.mockReset()
  Object.defineProperty(window, 'oc', { value: { readRelatorio }, configurable: true })
})

afterEach(() => {
  cleanup()
})

describe('RelatorioDaSalaView', () => {
  it('pede o dia de hoje em UTC na montagem', async () => {
    readRelatorio.mockResolvedValue(ok(0))

    render(<RelatorioDaSalaView />)

    const hoje = new Date().toISOString().slice(0, 10)

    expect(readRelatorio).toHaveBeenCalledTimes(1)
    expect(readRelatorio).toHaveBeenCalledWith({ dia: hoje })
    expect(screen.getByTestId<HTMLInputElement>('relatorio-dia').value).toBe(hoje)
    await screen.findByTestId('relatorio-corpo')
  })

  it('sem fonte 0 não avisa, 1 avisa no singular e 3 no plural', async () => {
    readRelatorio.mockResolvedValueOnce(ok(0))
    render(<RelatorioDaSalaView />)
    await screen.findByTestId('relatorio-corpo')
    expect(screen.queryByTestId('relatorio-sem-fonte')).toBeNull()

    readRelatorio.mockResolvedValueOnce(ok(1))
    fireEvent.click(screen.getByTestId('relatorio-gerar'))
    expect((await screen.findByTestId('relatorio-sem-fonte')).textContent).toBe(
      '1 linha sem fonte ficou de fora',
    )

    readRelatorio.mockResolvedValueOnce(ok(3))
    fireEvent.click(screen.getByTestId('relatorio-gerar'))
    await screen.findByText('3 linhas sem fonte ficaram de fora')
  })

  it('mostra o corpo em markdown e a hora da geração', async () => {
    readRelatorio.mockResolvedValue(ok(0))

    render(<RelatorioDaSalaView />)

    expect((await screen.findByTestId('relatorio-corpo')).textContent).toContain(
      'Relatório do dia 2026-11-10',
    )
    expect(screen.getByText(/^Gerado às /)).toBeTruthy()
  })

  it('o erro aparece em relatorio-erro com a mensagem', async () => {
    readRelatorio.mockResolvedValue({
      kind: 'erro',
      dia: '2026-11-10',
      erro: 'a pasta do cofre não existe',
    })

    render(<RelatorioDaSalaView />)

    const erro = await screen.findByTestId('relatorio-erro')

    expect(erro.textContent).toContain('Não foi possível gerar o relatório.')
    expect(erro.textContent).toContain('a pasta do cofre não existe')
    expect(screen.queryByTestId('relatorio-corpo')).toBeNull()
  })

  it('uma rejeição da ponte vira o bloco de erro', async () => {
    readRelatorio.mockRejectedValue(new Error('ponte caiu'))

    render(<RelatorioDaSalaView />)

    expect((await screen.findByTestId('relatorio-erro')).textContent).toContain('ponte caiu')
  })

  it('o botão fica desabilitado enquanto a promessa não resolve', async () => {
    let resolver: (valor: RelatorioDaSala) => void = () => undefined

    readRelatorio.mockReturnValue(
      new Promise<RelatorioDaSala>((resolve) => {
        resolver = resolve
      }),
    )

    render(<RelatorioDaSalaView />)

    expect(screen.getByTestId<HTMLButtonElement>('relatorio-gerar').disabled).toBe(true)
    expect(screen.getByTestId('relatorio-gerando').textContent).toContain('Gerando o relatório de ')

    await act(async () => {
      resolver(ok(0))
      await Promise.resolve()
    })

    expect(screen.getByTestId<HTMLButtonElement>('relatorio-gerar').disabled).toBe(false)
    expect(screen.queryByTestId('relatorio-gerando')).toBeNull()
  })

  it('descarta a resposta de um pedido antigo que chega depois da do novo', async () => {
    // O botão trava durante o pedido, então o segundo pedido nasce da dupla montagem do StrictMode.
    const resolvers: ((valor: RelatorioDaSala) => void)[] = []

    readRelatorio.mockImplementation(
      () =>
        new Promise<RelatorioDaSala>((resolve) => {
          resolvers.push(resolve)
        }),
    )

    render(
      <StrictMode>
        <RelatorioDaSalaView />
      </StrictMode>,
    )
    expect(resolvers).toHaveLength(2)

    await act(async () => {
      resolvers[1]?.(ok(0, '2026-11-09'))
      await Promise.resolve()
    })
    await act(async () => {
      resolvers[0]?.(ok(0, '2026-11-08'))
      await Promise.resolve()
    })

    expect(screen.getByTestId('relatorio-corpo').textContent).toContain('2026-11-09')
    expect(screen.getByTestId('relatorio-corpo').textContent).not.toContain('2026-11-08')
  })
})
