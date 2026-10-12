// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TerminalFailure } from '../../src/renderer/components/TerminalFailure'
import type { TerminalFailureProps } from '../../src/renderer/components/TerminalFailure'

/**
 * CA-8 — o teste de DX da task 5 para o erro: o texto de cada `reason` é a **instrução**, e a
 * instrução é a que a spec §9 escreve, palavra por palavra. Um remédio parafraseado ("reinstale as
 * dependências") é exatamente o que manda o desenvolvedor de volta ao Google.
 *
 * `textContent` e não `getByText`: o texto atravessa elementos `<code>` e o `getByText` casa por nó.
 */

afterEach(cleanup)

function montar(parcial: Partial<TerminalFailureProps>): { onRetry: () => void } {
  const onRetry = vi.fn()

  render(
    <TerminalFailure
      reason="pty-unavailable"
      detail="detalhe"
      presetLabel="PowerShell"
      scope={undefined}
      presets={[
        { id: 'powershell', label: 'PowerShell', group: 'shell' },
        { id: 'git-bash', label: 'Git Bash', group: 'shell' },
      ]}
      onRetry={onRetry}
      onChoosePreset={() => undefined}
      {...parcial}
    />,
  )

  return { onRetry }
}

function texto(): string {
  return screen.getByTestId('terminal-failure-text').textContent ?? ''
}

describe('CA-8 — `pty-unavailable`', () => {
  it('diz que o `node-pty` não carregou, mostra o erro do módulo e manda reinstalar', () => {
    montar({ reason: 'pty-unavailable', detail: 'Cannot find module pty.node' })

    expect(screen.getByTestId('terminal-failure').getAttribute('data-reason')).toBe(
      'pty-unavailable',
    )
    expect(texto()).toBe(
      'O terminal não abriu: o módulo nativo node-pty não carregou. Cannot find module pty.node ' +
        'Na pasta do app, rode yarn install --force para reinstalar os binários pré-compilados. ' +
        'Se continuar, npx @electron/rebuild -f -w node-pty recompila contra este Electron.',
    )
  })

  it('o erro do módulo e os dois comandos vão em `<code>`, para copiar sem errar', () => {
    montar({ reason: 'pty-unavailable', detail: 'Cannot find module pty.node' })

    const codigos = [...screen.getByTestId('terminal-failure-text').querySelectorAll('code')].map(
      (no) => no.textContent,
    )

    expect(codigos).toEqual([
      'node-pty',
      'Cannot find module pty.node',
      'yarn install --force',
      'npx @electron/rebuild -f -w node-pty',
    ])
  })
})

describe('CA-8 — `shell-missing`', () => {
  it('diz qual executável faltou e de qual perfil, e manda escolher outro', () => {
    montar({ reason: 'shell-missing', presetLabel: 'Git Bash', detail: 'C:\\Git\\bin\\bash.exe' })

    expect(texto()).toBe(
      'O shell do perfil «Git Bash» não foi encontrado: C:\\Git\\bin\\bash.exe. Instale-o ou escolha outro perfil.',
    )
  })

  it('oferece os perfis ali mesmo, e escolher um chama `onChoosePreset` com o id dele', () => {
    const onChoosePreset = vi.fn()
    montar({ reason: 'shell-missing', onChoosePreset })

    fireEvent.click(screen.getByTestId('terminal-failure-presets'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Git Bash' }))

    expect(onChoosePreset).toHaveBeenCalledWith('git-bash')
  })

  it('os outros motivos não oferecem troca de perfil: o remédio deles não é esse', () => {
    montar({ reason: 'unknown-folder' })

    expect(screen.queryByTestId('terminal-failure-presets')).toBeNull()
  })
})

describe('CA-8 — `unknown-folder`', () => {
  it('escopo de card: manda abrir o chat dele e escolher a pasta', () => {
    montar({ reason: 'unknown-folder', scope: { kind: 'card', itemId: 'i' } })

    expect(texto()).toBe(
      'Não sei a pasta deste card — abra o chat dele e escolha a pasta; depois tente de novo.',
    )
  })

  it('escopo livre: a pasta sumiu, e o lugar de escolher outra é o painel da sessão', () => {
    montar({ reason: 'unknown-folder', scope: { kind: 'free', id: 'f' } })

    expect(texto()).toBe(
      'A pasta desta sessão não existe mais — escolha outra no painel da sessão.',
    )
  })

  it('escopo de triagem: aponta o painel da triagem', () => {
    montar({ reason: 'unknown-folder', scope: { kind: 'triage', boardKey: 'b' } })

    expect(texto()).toBe(
      'Não sei a pasta desta triagem — escolha-a no painel da triagem e tente de novo.',
    )
  })
})

describe('CA-8 — `Tentar de novo`', () => {
  it.each(['pty-unavailable', 'shell-missing', 'unknown-folder'] as const)(
    'existe em `%s` e chama `onRetry` — o remédio é feito fora do app, e a pessoa volta para repetir',
    (reason) => {
      const { onRetry } = montar({ reason })

      const botao = screen.getByTestId('terminal-retry')
      expect(botao.textContent).toBe('Tentar de novo')

      fireEvent.click(botao)

      expect(onRetry).toHaveBeenCalledTimes(1)
    },
  )
})
