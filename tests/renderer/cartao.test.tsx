// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { abrirAoClicar } from '../../src/renderer/fabrica/cartao'

/** O helper do cartão de card clicável (#145, CA-2): o clique de um elemento interativo não navega. */

afterEach(cleanup)

function montar() {
  const abrir = vi.fn()
  render(
    <article data-testid="cartao" onClick={abrirAoClicar(abrir)}>
      <span data-testid="texto">texto</span>
      <button data-testid="botao">
        <span data-testid="dentro-do-botao">x</span>
      </button>
      <a data-testid="link" href="#x">
        link
      </a>
      <input data-testid="input" />
      <textarea data-testid="textarea" />
      <select data-testid="select" />
      <label data-testid="label">rótulo</label>
      <div role="button" data-testid="papel-botao" />
    </article>,
  )
  return abrir
}

describe('abrirAoClicar', () => {
  it.each(['cartao', 'texto'])('abre com clique em %s', (id) => {
    const abrir = montar()
    fireEvent.click(screen.getByTestId(id))
    expect(abrir).toHaveBeenCalledTimes(1)
  })

  it.each([
    'botao',
    'link',
    'input',
    'textarea',
    'select',
    'label',
    'papel-botao',
    'dentro-do-botao',
  ])('não abre com clique em %s', (id) => {
    const abrir = montar()
    fireEvent.click(screen.getByTestId(id))
    expect(abrir).not.toHaveBeenCalled()
  })
})
