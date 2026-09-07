import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import type { TurnActivity } from '../../shared/session'
import { isSilent } from '../session/sessionView'

interface TurnPulseProps {
  activity: TurnActivity
  /**
   * Se alguma entrada da conversa está `running`.
   *
   * Vem por prop porque quem tem a lista é quem sabe — e porque é a metade do CA-4 que impede a
   * marca de silêncio de acusar o normal: 17s dentro de um `Bash` é uma ferramenta trabalhando,
   * não uma sessão travada.
   */
  somethingRunning: boolean
}

/** De quanto em quanto tempo a linha é recalculada. É o relógio do rótulo, não polling de nada. */
const TICK_MS = 1_000

/**
 * A linha viva do turno: há quanto tempo ele corre, quanto ele já pensou, e se parou de dar sinal.
 *
 * Ela é o spinner, e não o histórico — **some quando o turno acaba**, e é por isso que o
 * `startedAt === null` devolve nada em vez de uma linha zerada. Uma linha permanente dizendo "0s"
 * seria exatamente o sinal que este card existe para tirar da tela: algo que parece vivo sem estar.
 *
 * O relógio próprio é o mesmo arranjo do `Freshness`: o rótulo é relativo, então envelhece sozinho
 * na tela. Sem ele o tempo decorrido só avançaria quando outra coisa chegasse pela ponte — e o
 * caso em que o tempo mais importa é justamente aquele em que nada chega.
 */
export function TurnPulse({ activity, somethingRunning }: TurnPulseProps): JSX.Element | null {
  const [, tick] = useState(0)
  const running = activity.startedAt !== null

  // Preso ao turno, e não perpétuo: fora do turno esta linha não desenha nada, e um intervalo
  // batendo a cada segundo por cartão aberto para redesenhar `null` é trabalho que ninguém vê.
  useEffect(() => {
    if (!running) return

    const timer = setInterval(() => {
      tick((value) => value + 1)
    }, TICK_MS)

    return () => {
      clearInterval(timer)
    }
  }, [running])

  if (activity.startedAt === null) return null

  // Lido uma vez por render, como o `age` do `Freshness` faz: o `tick` acima existe só para que
  // este render aconteça de novo.
  const now = Date.now()
  const silent = isSilent(activity, somethingRunning, now)

  return (
    <p
      data-testid="turn-pulse"
      // Sempre presentes, os dois: `'false'` e `'0'` são afirmações, e atributo ausente não
      // distingue "não é isso" de "componente que esqueceu de renderizar" — o mesmo motivo do
      // `data-stale` do `Freshness`.
      data-tokens={String(activity.thinkingTokens)}
      data-silent={silent ? 'true' : 'false'}
      // `my-2` e não `mt-2`: em `CardChat` a margem de baixo colapsa com a da caixa de texto, e na
      // tela de chat ela é o único respiro entre a linha e a caixa.
      className={`my-2 flex items-center gap-2 text-[11px] ${
        silent ? 'text-amber-300' : 'text-neutral-400'
      }`}
    >
      <span aria-hidden className={silent ? '' : 'animate-pulse'}>
        ●
      </span>
      <span className="font-mono tabular-nums">{elapsed(now - activity.startedAt)}</span>

      {activity.thinkingTokens > 0 ? (
        <span className="font-mono tabular-nums">↑ {activity.thinkingTokens} tokens</span>
      ) : null}

      {/* A frase inteira, e não um ícone: o CA-4 existe para o humano saber que **pode** ser
          travamento, e um símbolo âmbar sozinho não diz isso a ninguém. */}
      {silent ? <span>sem sinal há mais de 1 min</span> : null}
    </p>
  )
}

/** "12s", "3m 07s". Duas faixas bastam: turno que passa de uma hora tem outro problema. */
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  if (seconds < 60) return `${seconds}s`

  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
