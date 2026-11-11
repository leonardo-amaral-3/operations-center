// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CabecalhoInterno, NavegacaoDasTelas } from '../../src/renderer/fabrica/Moldura'
import { NAVEGACAO_DA_SALA, type NomeDaTela } from '../../src/renderer/fabrica/rotas'

/** O menu das telas (#145, CA-1): os mesmos oito botões em todo cabeçalho, com a tela atual marcada. */

afterEach(cleanup)

const TELAS: NomeDaTela[] = [
  'sala',
  'agentes',
  'pergunta',
  'decisao',
  'card',
  'entrada',
  'relatorio',
  'portfolio',
  'mandato',
  'briefing',
  'release',
]
const SEM_BOTAO: NomeDaTela[] = ['pergunta', 'decisao', 'card']

describe('NavegacaoDasTelas', () => {
  it.each(TELAS)(
    'com atual=%s mostra os oito botões, na ordem, com aria-current certo',
    (atual) => {
      const onIr = vi.fn()

      render(<NavegacaoDasTelas atual={atual} onIr={onIr} />)

      const botoes = Array.from(screen.getByTestId('fabrica-nav').querySelectorAll('button'))

      expect(botoes.map((b) => b.dataset.testid)).toEqual(
        NAVEGACAO_DA_SALA.map((n) => `fabrica-nav-${n.tela}`),
      )
      expect(botoes.map((b) => b.textContent)).toEqual(NAVEGACAO_DA_SALA.map((n) => n.rotulo))

      const marcados = botoes.filter((b) => b.getAttribute('aria-current') !== null)

      if (SEM_BOTAO.includes(atual)) {
        expect(marcados).toEqual([])
      } else {
        expect(marcados.map((b) => b.dataset.testid)).toEqual([`fabrica-nav-${atual}`])
        expect(marcados[0]?.getAttribute('aria-current')).toBe('page')
      }

      fireEvent.click(screen.getByTestId('fabrica-nav-agentes'))
      expect(onIr).toHaveBeenCalledWith({ tela: 'agentes' })
    },
  )
})

describe('CabecalhoInterno', () => {
  it('renderiza a trilha e o menu', () => {
    render(
      <CabecalhoInterno
        trilha={[
          { rotulo: 'Sala de controle', para: { tela: 'sala' } },
          { rotulo: 'Entrada', para: null },
        ]}
        atual="entrada"
        onIr={() => {}}
      />,
    )

    expect(screen.getByTestId('fabrica-trilha').textContent).toBe('Sala de controle/Entrada')
    expect(screen.getByTestId('fabrica-nav')).toBeTruthy()
    expect(screen.getByTestId('fabrica-nav-entrada').getAttribute('aria-current')).toBe('page')
  })
})
