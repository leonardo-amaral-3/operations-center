import { useEffect, useState } from 'react'
import type { JSX } from 'react'

interface FreshnessProps {
  /** Epoch ms da última leitura bem-sucedida, ou `null` antes da primeira. */
  readAt: number | null
  /** Motivo da última falha. Preenchido significa que o que está na tela é o board de antes. */
  error: string | null
}

/** De quanto em quanto tempo o rótulo é recalculado. Não é polling de rede: é o relógio da etiqueta. */
const TICK_MS = 30_000

/**
 * O carimbo de frescor.
 *
 * Ele é o contrapeso da decisão de não apagar o kanban quando uma releitura falha: o dado
 * levemente velho só não mente porque este rótulo diz a idade dele. Por isso `data-stale` sai
 * sempre — `'false'` é afirmação, e um atributo ausente não distingue "fresco" de "componente que
 * esqueceu de renderizar".
 */
export function Freshness({ readAt, error }: FreshnessProps): JSX.Element {
  // O rótulo é relativo, então envelhece sozinho na tela: sem este relógio, "agora" continuaria
  // escrito ali meia hora depois, e o carimbo passaria a mentir exatamente como o dado que ele
  // existe para desmentir.
  const [, tick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      tick((value) => value + 1)
    }, TICK_MS)

    return () => {
      clearInterval(timer)
    }
  }, [])

  const stale = error !== null

  return (
    <span
      data-testid="freshness"
      data-read-at={readAt === null ? '' : String(readAt)}
      data-stale={stale ? 'true' : 'false'}
      // O motivo inteiro fica no `title`: ele pode ser uma frase longa da API, e o cabeçalho é
      // estreito. O que a linha precisa dizer sem hover é que o dado parou no tempo.
      title={error ?? undefined}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        stale
          ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
          : 'border-neutral-800 bg-neutral-900 text-neutral-400'
      }`}
    >
      {stale ? `desatualizado · ${age(readAt)}` : age(readAt)}
    </span>
  )
}

/** "agora", "há 2 min", "há 3 h". Sem `Intl.RelativeTimeFormat`: três faixas resolvem o caso. */
function age(readAt: number | null): string {
  if (readAt === null) return 'sem leitura'

  const minutes = Math.floor((Date.now() - readAt) / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`

  return `há ${Math.floor(minutes / 60)} h`
}
