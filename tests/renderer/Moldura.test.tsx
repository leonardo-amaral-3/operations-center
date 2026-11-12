// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CabecalhoInterno,
  ListaComTeto,
  NavegacaoDasTelas,
} from '../../src/renderer/fabrica/Moldura'
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

describe('ListaComTeto (#149)', () => {
  it('por padrão: teto 640, overflow-y-auto e os atributos de medição', () => {
    render(
      <ListaComTeto lista="linha-validacao">
        <span>x</span>
      </ListaComTeto>,
    )
    const el = screen.getByTestId('fabrica-lista-com-teto')
    expect(el.getAttribute('data-lista')).toBe('linha-validacao')
    expect(el.getAttribute('data-teto')).toBe('640')
    expect(el.className).toContain('max-h-[640px]')
    expect(el.className).toContain('overflow-y-auto')
  })

  it('com teto 1040 e className repassada', () => {
    render(
      <ListaComTeto lista="briefing-frentes" teto={1040} className="flex flex-col gap-4">
        <span>x</span>
      </ListaComTeto>,
    )
    const el = screen.getByTestId('fabrica-lista-com-teto')
    expect(el.getAttribute('data-teto')).toBe('1040')
    expect(el.className).toContain('max-h-[1040px]')
    expect(el.className).not.toContain('max-h-[640px]')
    expect(el.className).toContain('overflow-y-auto')
    expect(el.className).toContain('flex flex-col gap-4')
  })
})
