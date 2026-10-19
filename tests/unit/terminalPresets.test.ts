import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPresets, childEnv } from '../../src/main/terminalPresets'
import type { PresetDeps } from '../../src/main/terminalPresets'
import { claudeEnv } from '../../src/core/terminal/claudeCommand'

const aws = readFileSync(new URL('../fixtures/aws-config.ini', import.meta.url), 'utf8')

const GIT = 'C:\\Git'
const BASH = join(GIT, 'bin', 'bash.exe')

function deps(over: Partial<PresetDeps> = {}): PresetDeps {
  return {
    which: (exe) => (exe === 'git.exe' ? join(GIT, 'cmd', 'git.exe') : null),
    exists: (p) => p === BASH,
    awsConfig: () => aws,
    programFiles: 'C:\\Program Files',
    systemRoot: 'C:\\Windows',
    ...over,
  }
}

const porId = (id: string) => buildPresets(deps()).find((p) => p.id === id)!

describe('perfis de terminal', () => {
  it('powershell cai no Windows PowerShell absoluto quando não há pwsh', () => {
    expect(porId('powershell').shell).toBe(
      join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    )
    const comPwsh = buildPresets(deps({ which: (e) => (e === 'pwsh.exe' ? 'C:\\pwsh.exe' : null) }))
    expect(comPwsh[0]!.shell).toBe('C:\\pwsh.exe')
  })

  it('git-bash sobe do git.exe até o bin\\bash.exe, sem MSYS_NO_PATHCONV', () => {
    const bash = porId('git-bash')

    expect(bash.shell).toBe(BASH)
    expect(bash.args).toEqual(['--login', '-i'])
    expect(bash.env).not.toHaveProperty('MSYS_NO_PATHCONV')
  })

  it('sem git no PATH, o fallback é o Program Files; o perfil continua listado', () => {
    const lista = buildPresets(deps({ which: () => null, exists: () => false }))

    expect(lista.find((p) => p.id === 'git-bash')!.shell).toBe(
      join('C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    )
  })

  it('aws:* nasce com os três ambientes de DX sem configurar nada', () => {
    const perfil = porId('aws:processos-module')

    expect(perfil.label).toBe('AWS · processos-module')
    expect(perfil.group).toBe('aws')
    expect(perfil.env).toMatchObject({
      AWS_PROFILE: 'processos-module',
      MSYS_NO_PATHCONV: '1',
      PYTHONIOENCODING: 'utf-8',
    })
  })

  it('AWS_REGION só entra quando o perfil não declara region', () => {
    expect(porId('aws:processos-module').env).not.toHaveProperty('AWS_REGION')
    expect(porId('aws:suporte-module').env.AWS_REGION).toBe('us-east-1')
    expect(porId('aws:default').env.AWS_REGION).toBe('us-east-1')
  })

  it('sem ~/.aws/config só sobram os dois shells', () => {
    expect(buildPresets(deps({ awsConfig: () => null })).map((p) => p.id)).toEqual([
      'powershell',
      'git-bash',
    ])
  })

  it('o ambiente herdado perde ELECTRON_* e ganha TERM, com o do perfil por cima', () => {
    const env = childEnv(porId('aws:default'), {
      PATH: 'x',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      TERM: 'dumb',
    })

    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(env).not.toHaveProperty('ELECTRON_RENDERER_URL')
    expect(env).toMatchObject({
      PATH: 'x',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AWS_PROFILE: 'default',
    })
  })

  it('NO_COLOR herdado não chega ao shell do perfil (CA-2)', () => {
    const env = childEnv(porId('aws:default'), { PATH: 'x', NO_COLOR: '1' })

    expect(env).not.toHaveProperty('NO_COLOR')
    expect(env).toMatchObject({ PATH: 'x' })
  })

  it('NO_COLOR herdado não chega ao terminal Claude (CA-1)', () => {
    const env = claudeEnv(childEnv({ env: {} }, { PATH: 'x', NO_COLOR: '1', CLAUDECODE: '1' }))

    expect(env).not.toHaveProperty('NO_COLOR')
    expect(env).not.toHaveProperty('CLAUDECODE')
  })

  it('NO_COLOR declarado pelo perfil vence o herdado (CA-3)', () => {
    const env = childEnv({ env: { NO_COLOR: '0' } }, { NO_COLOR: '1' })

    expect(env).toMatchObject({ NO_COLOR: '0' })
  })

  it('no_color em minúsculas também é descartado', () => {
    expect(childEnv({ env: {} }, { no_color: '1' })).not.toHaveProperty('no_color')
  })
})
