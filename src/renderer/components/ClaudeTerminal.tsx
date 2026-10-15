import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { ClaudeScope, OpenClaudeResult, TerminalState } from '../../shared/claude'
import { scopeKey } from '../../shared/ipc'
import { attach, detach, end, fit, focus } from '../terminal/claudeTerminals'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { SemPasta } from './SemPasta'
import { StateBadge } from './StateBadge'

interface ClaudeTerminalProps {
  scope: ClaudeScope
  /** Do board (cartão) ou da assinatura local (sessão livre); `null` = nenhum processo. */
  state: TerminalState | null
  dangerous: boolean
  semPasta: string
  onToggleDangerous: (dangerous: boolean) => void
  onOpenTerminal?: () => void
  onCollapse?: () => void
  autoFocus?: boolean
  preencher?: boolean
}

const SESSION_BUSY =
  'Esta conversa já está aberta em outro terminal. Encerre-a lá para abrir aqui.'

/**
 * O terminal Claude de um escopo (#97 §10): a barra de ações e o corpo onde o registro de
 * instâncias monta o xterm. O componente não é dono do terminal — desmontá-lo só chama `detach`, e
 * a conversa volta inteira no próximo `attach`.
 */
export function ClaudeTerminal({
  scope,
  state,
  dangerous,
  semPasta,
  onToggleDangerous,
  onOpenTerminal,
  onCollapse,
  autoFocus = false,
  preencher = false,
}: ClaudeTerminalProps): JSX.Element {
  const corpo = useRef<HTMLDivElement>(null)
  // O efeito lê o escopo daqui e não da closure: a chave é o que decide quando ele roda de novo.
  const escopo = useRef(scope)
  escopo.current = scope
  const key = scopeKey(scope)

  const [result, setResult] = useState<OpenClaudeResult | null>(null)
  // O modo em que o processo vivo nasceu, mantido pelos eventos do main (sem ref local).
  const [modoDoMain, setModoDoMain] = useState<boolean | null>(null)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    const alvo = corpo.current
    if (alvo === null) return undefined

    let vivo = true
    void attach(escopo.current, alvo).then((resultado) => {
      if (!vivo) return

      setResult(resultado)
      setModoDoMain(resultado.ok ? resultado.dangerous : null)
      if (resultado.ok && autoFocus) focus(escopo.current)
    })

    return () => {
      vivo = false
      detach(escopo.current)
    }
    // `autoFocus` só vale na montagem do escopo; mudar a prop depois não reabre nada.
  }, [key, tentativa])

  useEffect(() => {
    return window.oc.onClaudeState((event) => {
      if (scopeKey(event.scope) !== key) return

      setModoDoMain(event.dangerous)
      setResult((atual) =>
        atual !== null && atual.ok ? { ...atual, state: event.state, dangerous: event.dangerous } : atual,
      )
    })
  }, [key])

  useEffect(() => {
    const alvo = corpo.current
    if (alvo === null || typeof ResizeObserver === 'undefined') return undefined

    const observador = new ResizeObserver(() => fit(escopo.current))
    observador.observe(alvo)

    return () => observador.disconnect()
  }, [key, result])

  function reabrir(): void {
    setResult(null)
    setTentativa((n) => n + 1)
  }

  async function encerrar(): Promise<void> {
    const alvo = corpo.current
    await end(escopo.current)
    if (alvo === null) return

    // O `end` destruiu a instância; um `attach` novo mostra o `claude` recém-aberto.
    const resultado = await attach(escopo.current, alvo)
    setResult(resultado)
    setModoDoMain(resultado.ok ? resultado.dangerous : null)
  }

  async function escolherPasta(): Promise<void> {
    const { chosen } = await window.oc.chooseFolder({ scope })
    if (chosen) reabrir()
  }

  if (result !== null && !result.ok && result.reason === 'unknown-folder') {
    return (
      <SemPasta
        texto={semPasta}
        {...(onCollapse ? { onCollapse } : {})}
        onChoose={() => {
          void escolherPasta()
        }}
      />
    )
  }

  const exibido = state ?? (result !== null && result.ok ? result.state : null)
  const proximaAbertura =
    modoDoMain !== null && exibido !== null && exibido.kind !== 'closed' && modoDoMain !== dangerous
  const morta = state === null || state.kind === 'closed'

  return (
    <div
      className={cn(
        'mt-3 border-t-2 border-border bg-background p-3',
        preencher && 'flex min-h-0 flex-1 flex-col',
      )}
    >
      <div
        data-testid="claude-terminal-bar"
        className="mb-2 flex min-w-0 flex-wrap items-center justify-end gap-2"
      >
        {exibido !== null && exibido.kind !== 'closed' ? <StateBadge state={exibido} /> : null}
        <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-2">
          {/* Sem cor, como no `Chat`: quem carrega a cor é o crachá; o "Encerrar sessão" vizinho é
              o destrutivo e precisa seguir lendo como tal. */}
          <Button
            type="button"
            data-testid="card-danger-toggle"
            data-dangerous={String(dangerous)}
            variant="neutral"
            size="xs"
            onClick={() => onToggleDangerous(!dangerous)}
          >
            {dangerous ? 'Voltar a pedir' : 'Rodar sem pedir permissão'}
          </Button>
          {onOpenTerminal ? (
            <Button
              type="button"
              data-testid="chat-open-terminal"
              variant="neutral"
              size="xs"
              title="Abrir um terminal na pasta desta conversa"
              onClick={onOpenTerminal}
            >
              ▣ Terminal aqui
            </Button>
          ) : null}
          {onCollapse ? (
            <Button
              type="button"
              data-testid="card-collapse"
              variant="neutral"
              size="xs"
              onClick={onCollapse}
            >
              Colapsar
            </Button>
          ) : null}
          <Button
            type="button"
            data-testid="card-end-session"
            variant="neutral"
            size="xs"
            className="bg-danger text-danger-foreground"
            disabled={morta}
            onClick={() => {
              void encerrar()
            }}
          >
            Encerrar sessão
          </Button>
        </div>
      </div>

      {proximaAbertura ? (
        <p data-testid="danger-next-open" className="mb-2 text-xs text-foreground/60">
          A marca vale a partir da próxima abertura — este terminal continua no modo em que abriu.
        </p>
      ) : null}

      {result !== null && !result.ok && result.reason === 'session-busy' ? (
        <p data-testid="claude-terminal-error" className="mb-2 text-xs break-words">
          {SESSION_BUSY}
        </p>
      ) : null}
      {result !== null &&
      !result.ok &&
      (result.reason === 'claude-missing' || result.reason === 'pty-unavailable') ? (
        <div className="mb-2 flex items-center gap-2">
          <p data-testid="claude-terminal-error" className="min-w-0 flex-1 text-xs break-words">
            {result.detail}
          </p>
          <Button
            type="button"
            data-testid="claude-terminal-retry"
            variant="neutral"
            size="xs"
            onClick={reabrir}
          >
            Tentar de novo
          </Button>
        </div>
      ) : null}

      <div
        ref={corpo}
        data-testid="claude-terminal"
        className={cn('w-full', preencher ? 'min-h-0 flex-1' : 'h-[28rem]')}
      />
    </div>
  )
}
