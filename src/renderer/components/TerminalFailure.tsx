import { useRef, useState } from 'react'
import type { JSX } from 'react'

import type { OpenTerminalResult, SessionScope, TerminalPreset } from '../../shared/ipc'
import { Button } from '../ui/button'
import { MesaMenu } from './MesaMenu'

export interface TerminalFailureProps {
  reason: Extract<OpenTerminalResult, { opened: false }>['reason']
  /** O texto cru que o main devolveu: o erro do módulo, o executável que faltou. */
  detail: string
  /** O rótulo do perfil que falhou — `shell-missing` o cita entre aspas francesas. */
  presetLabel: string
  /** O escopo da aba, que decide o texto de `unknown-folder`; ausente = pasta do usuário. */
  scope: SessionScope | undefined
  presets: readonly TerminalPreset[]
  onRetry: () => void
  /** Abre o terminal **em outro perfil**, no lugar deste. */
  onChoosePreset: (preset: string) => void
}

/**
 * O terminal que não abriu, desenhado no lugar da aba (#74 §9, CA-8).
 *
 * Não é exceção: `OpenTerminalResult` é uma resposta prevista, e a aba mostra o **motivo e o remédio**
 * no mesmo lugar onde o shell estaria. O texto de cada `reason` é o da spec, palavra por palavra — é
 * o que `TerminalFailure.test.tsx` confere —, porque é ele que tira o desenvolvedor do beco: o
 * comando exato a rodar, o executável exato que faltou, o lugar exato onde escolher a pasta.
 *
 * `Tentar de novo` existe nos três, porque o remédio de dois deles é feito **fora** do app (reinstalar
 * o módulo, instalar o shell) e a pessoa volta aqui para repetir, não para recomeçar.
 */
export function TerminalFailure({
  reason,
  detail,
  presetLabel,
  scope,
  presets,
  onRetry,
  onChoosePreset,
}: TerminalFailureProps): JSX.Element {
  const [escolhendo, setEscolhendo] = useState(false)
  const ancora = useRef<HTMLDivElement>(null)

  return (
    <div
      data-testid="terminal-failure"
      data-reason={reason}
      role="alert"
      className="flex h-full flex-col items-start gap-3 overflow-auto p-4 text-sm"
    >
      <p data-testid="terminal-failure-text">{texto(reason, detail, presetLabel, scope)}</p>

      <div className="flex items-center gap-2">
        <Button type="button" size="xs" data-testid="terminal-retry" onClick={onRetry}>
          Tentar de novo
        </Button>

        {reason === 'shell-missing' ? (
          // `relative` aqui e não no botão: o `MesaMenu` é `absolute left-0 top-full` e se ancora no
          // pai posicionado mais próximo, que tem de ser o contêiner do botão que o abre.
          <div ref={ancora} className="relative">
            <Button
              type="button"
              size="xs"
              variant="neutral"
              data-testid="terminal-failure-presets"
              onClick={() => setEscolhendo((aberto) => !aberto)}
            >
              Escolher outro perfil
            </Button>

            {escolhendo ? (
              <MesaMenu
                label="Perfis de terminal"
                testId="terminal-failure-menu"
                items={presets.map((preset) => ({
                  id: preset.id,
                  label: preset.label,
                  ...(preset.group === 'aws' ? { group: 'AWS' } : {}),
                }))}
                empty="Nenhum perfil disponível."
                anchor={ancora}
                onChoose={onChoosePreset}
                onClose={() => setEscolhendo(false)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * O texto de cada motivo, **exatamente** como a spec §9 o escreve. Os trechos de comando vão em
 * `<code>`; o `textContent` resultante é a frase da spec sem os acentos graves.
 */
function texto(
  reason: TerminalFailureProps['reason'],
  detail: string,
  presetLabel: string,
  scope: SessionScope | undefined,
): JSX.Element {
  switch (reason) {
    case 'pty-unavailable':
      return (
        <>
          O terminal não abriu: o módulo nativo <code>node-pty</code> não carregou.{' '}
          <code data-testid="terminal-failure-detail">{detail}</code> Na pasta do app, rode{' '}
          <code>yarn install --force</code> para reinstalar os binários pré-compilados. Se
          continuar, <code>npx @electron/rebuild -f -w node-pty</code> recompila contra este
          Electron.
        </>
      )

    case 'shell-missing':
      return (
        <>
          O shell do perfil «{presetLabel}» não foi encontrado:{' '}
          <code data-testid="terminal-failure-detail">{detail}</code>. Instale-o ou escolha outro
          perfil.
        </>
      )

    case 'unknown-folder':
      return <>{pastaDesconhecida(scope)}</>
  }
}

function pastaDesconhecida(scope: SessionScope | undefined): string {
  switch (scope?.kind) {
    case 'free':
      return 'A pasta desta sessão não existe mais — escolha outra no painel da sessão.'
    case 'triage':
      return 'Não sei a pasta desta triagem — escolha-a no painel da triagem e tente de novo.'
    default:
      return 'Não sei a pasta deste card — abra o chat dele e escolha a pasta; depois tente de novo.'
  }
}
