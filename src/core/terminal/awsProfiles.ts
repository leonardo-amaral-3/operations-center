/**
 * Os perfis de `~/.aws/config`, lidos como texto puro (spec #74 §2, CA-1).
 *
 * Mora no core porque é só parsing: quem sabe onde o arquivo está e como lê-lo é o
 * `src/main/terminalPresets.ts`, que injeta o texto. Do INI só interessa o nome da seção e a
 * `region` — `sso_*` e o resto é assunto da AWS CLI, não do app, e ler mais do que isso seria
 * acoplar o terminal a um formato que a AWS evolui.
 */

export interface AwsProfile {
  name: string
  /** A chave `region` da seção, ou `null` quando o perfil não declara. */
  region: string | null
}

/** `[default]` e `[profile X]` são as duas formas de seção que a AWS CLI reconhece como perfil. */
const SECAO = /^\[\s*(?:(default)|profile\s+([^\]]+?))\s*\]$/

/**
 * Lê o INI e devolve os perfis na ordem do arquivo.
 *
 * Seções que não são perfil (`[sso-session X]`, `[services X]`) ficam de fora, e as chaves delas
 * também: `atual` volta a `null` em toda seção nova.
 */
export function parseAwsConfig(texto: string): AwsProfile[] {
  const perfis: AwsProfile[] = []
  let atual: AwsProfile | null = null

  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim()
    if (linha === '' || linha.startsWith('#') || linha.startsWith(';')) continue

    if (linha.startsWith('[')) {
      const achou = SECAO.exec(linha)
      atual = achou === null ? null : { name: achou[1] ?? achou[2]!, region: null }
      if (atual !== null) perfis.push(atual)
      continue
    }

    if (atual === null) continue
    const igual = linha.indexOf('=')
    if (igual < 0) continue
    if (linha.slice(0, igual).trim() === 'region') {
      const valor = linha.slice(igual + 1).trim()
      atual.region = valor === '' ? null : valor
    }
  }

  return perfis
}
