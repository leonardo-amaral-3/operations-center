import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAwsConfig } from '../../src/core'

const fixture = readFileSync(new URL('../fixtures/aws-config.ini', import.meta.url), 'utf8')

describe('parseAwsConfig', () => {
  it('lê [default] e [profile X] na ordem do arquivo, com a região quando declarada', () => {
    expect(parseAwsConfig(fixture)).toEqual([
      { name: 'default', region: null },
      { name: 'processos-module', region: 'sa-east-1' },
      { name: 'suporte-module', region: null },
    ])
  })

  it('ignora seções que não são perfil, junto com as chaves delas', () => {
    const nomes = parseAwsConfig(fixture).map((p) => p.name)

    expect(nomes).not.toContain('sso-session notoria')
    // A `region = eu-west-1` da sso-session não vaza para o perfil anterior nem para o seguinte.
    expect(parseAwsConfig(fixture).find((p) => p.name === 'suporte-module')?.region).toBeNull()
  })

  it('aceita CRLF, comentários e arquivo vazio', () => {
    expect(parseAwsConfig('# x\r\n[profile a]\r\nregion=us-west-2\r\n')).toEqual([
      { name: 'a', region: 'us-west-2' },
    ])
    expect(parseAwsConfig('')).toEqual([])
  })
})
