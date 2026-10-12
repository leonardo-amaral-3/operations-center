import { useEffect, useRef } from 'react'
import type { JSX, RefObject } from 'react'

import { Button } from '../ui/button'
import { Card } from '../ui/card'

export interface MesaMenuItem {
  id: string
  label: string
  /** Itens consecutivos com o mesmo `group` ficam sob um cabeçalho com esse texto. */
  group?: string
}

export interface MesaMenuProps {
  /** O `aria-label` da lista. */
  label: string
  testId: string
  items: readonly MesaMenuItem[]
  /** O que a lista diz quando não há item — uma lista vazia calada pareceria um botão quebrado. */
  empty: string
  /** O elemento que contém o botão que abre a lista: clicar nele **não** conta como "clique fora". */
  anchor: RefObject<HTMLElement | null>
  onChoose: (id: string) => void
  onClose: () => void
}

/**
 * A lista que cai sob um `▾` da faixa (#74 §8): um `Button` por item, o grupo como cabeçalho.
 *
 * Fecha em `Escape`, em clique fora e em escolha — as três saídas que qualquer menu do sistema tem.
 * O clique no **próprio botão que a abriu** é ignorado aqui (`anchor`): sem isso o `mousedown` fecharia
 * a lista e o `click` seguinte a reabriria, e o botão nunca fecharia o que abriu.
 *
 * A casca é o `Card` de `ui/`, porque a receita de borda e sombra só pode viver lá
 * (`design-system.test.ts`). `nao-arrasta-a-janela` na raiz: a lista nasce dentro da faixa, que é
 * região de arrasto, e dentro dela nenhum clique chegaria aos itens.
 */
export function MesaMenu({
  label,
  testId,
  items,
  empty,
  anchor,
  onChoose,
  onClose,
}: MesaMenuProps): JSX.Element {
  const raiz = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function aoApertar(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }

    function aoClicar(event: MouseEvent): void {
      const alvo = event.target as Node
      if (raiz.current?.contains(alvo) === true || anchor.current?.contains(alvo) === true) return
      onClose()
    }

    document.addEventListener('keydown', aoApertar)
    document.addEventListener('mousedown', aoClicar)

    return () => {
      document.removeEventListener('keydown', aoApertar)
      document.removeEventListener('mousedown', aoClicar)
    }
  }, [anchor, onClose])

  return (
    <Card
      ref={raiz}
      role="menu"
      aria-label={label}
      data-testid={testId}
      className="nao-arrasta-a-janela absolute left-0 top-full z-50 mt-2 min-w-48 gap-1 p-1"
    >
      {items.length === 0 ? <p className="px-2 py-1 text-sm">{empty}</p> : null}

      {items.map((item, posicao) => (
        <div key={item.id} className="flex flex-col gap-1">
          {item.group !== undefined && item.group !== items[posicao - 1]?.group ? (
            <p className="px-2 pt-1 text-xs font-heading">{item.group}</p>
          ) : null}

          <Button
            type="button"
            variant="neutral"
            size="xs"
            role="menuitem"
            className="justify-start"
            onClick={() => {
              onChoose(item.id)
              onClose()
            }}
          >
            {item.label}
          </Button>
        </div>
      ))}
    </Card>
  )
}
