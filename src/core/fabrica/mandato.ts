import { relative } from 'node:path/posix'
import type { GraphQLResponse } from '../board/types'
import type { BoardDaFabrica, ProibidosDoBoard } from './configuracao'

/**
 * O que o mandato da prova (cofre 1439) deixa a fábrica despachar. Tudo aqui é constante ou função
 * pura: a leitura do `fabrica/MANDATO.md` na `dev` é da casca (card 121, spec P2 §3).
 */

export const REPO_DA_FABRICA = { owner: 'leonardo-amaral-3', name: 'operations-center' } as const
export const PROJETO_DA_FABRICA = 2
/** O nome do Project 2 (CLAUDE.md `## Board`), que a moldura mostra no crachá. */
export const NOME_DO_PROJETO_DA_FABRICA = 'Operations Center'
/** O teto do mandato 1439: sessões `claude -p` da prova vivas ao mesmo tempo na máquina. */
export const TETO_DE_SESSOES = 3
export const LIMITE_DE_DESPACHOS_POR_FRENTE = 20
/**
 * Ficam fora de propósito `gm-release` e `gm-hotfix` (tocam `main`) e `gm-prd`, `gm-explore` e
 * `gm-tech-spec`, que não são etapas da esteira da prova.
 */
export const SKILLS_PERMITIDAS = [
  'gm-triage',
  'gm-card',
  'gm-spec',
  'gm-plan-tasks',
  'gm-implement',
  'gm-ship',
  'gm-correcao',
] as const

type Avaliacao = { ok: true } | { ok: false; motivo: string }

export function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Os caminhos que o mandato proíbe: a instalação viva, o checkout principal e os repos da Notoria.
 * Os que ficam dentro da home valem também nas três grafias relativas que uma sessão costuma usar.
 * O `dist/` da instalação viva cai no prefixo do checkout.
 */
export function caminhosProibidos(
  home: string,
  board: Pick<BoardDaFabrica, 'checkoutPrincipal' | 'proibidos'>,
): ProibidosDoBoard {
  const alvos = [...board.proibidos.caminhos, board.checkoutPrincipal]
  const saida: string[] = []
  for (const a of alvos) {
    saida.push(a)
    const r = relative(home, a)
    if (r !== '' && !r.startsWith('..')) {
      saida.push('~/' + r, '$HOME/' + r, '${HOME}/' + r)
    }
  }
  return { caminhos: saida, motivo: board.proibidos.motivo }
}

/**
 * O motivo de um texto ser proibido, ou `null`. Um caminho só é pego quando o próximo caractere
 * não continua o nome: a worktree irmã (`…/operations-center-121-x`) passa, e `…/operations-center.`
 * ou `…/operations-center)` não.
 */
export function textoProibido(texto: string, proibidos: ProibidosDoBoard): string | null {
  if (/\b(main|releases?|tags?|hotfix)\b/i.test(texto)) return 'cita main, release, tag ou hotfix'
  for (const p of proibidos.caminhos) {
    if (new RegExp(escaparRegex(p) + '(?![A-Za-z0-9_-])').test(texto)) {
      return `aponta para ${proibidos.motivo}`
    }
  }
  return null
}

export function avaliarComando(comando: string, proibidos: ProibidosDoBoard): Avaliacao {
  const m = /^\/(gm-[a-z-]+)(?:\s+([\s\S]*))?$/.exec(comando)
  if (!m) return { ok: false, motivo: `não é um comando /gm-*: ${comando}` }
  const skill = m[1] ?? ''
  if (!(SKILLS_PERMITIDAS as readonly string[]).includes(skill)) {
    return {
      ok: false,
      motivo: `a skill /${skill} não é despachada pela fábrica (fora do mandato)`,
    }
  }
  const proibido = textoProibido(m[2] ?? '', proibidos)
  if (proibido !== null) return { ok: false, motivo: `o argumento ${proibido}` }
  return { ok: true }
}

export function avaliarNota(nota: string, proibidos: ProibidosDoBoard): Avaliacao {
  const proibido = textoProibido(nota, proibidos)
  return proibido === null ? { ok: true } : { ok: false, motivo: `a nota ${proibido}` }
}

/**
 * O prompt da sessão, igual byte a byte ao que o `d.sh` da orquestradora passa depois da P0 (N18):
 * o mandato entra sem os `\n` finais, e a nota opcional vira a última linha.
 */
export function montarPrompt(comando: string, mandato: string, nota: string | null): string {
  return [
    comando,
    '',
    'Argumento do despacho:',
    mandato.replace(/\n+$/, ''),
    ...(nota ? [`- Nesta sessão: ${nota}`] : []),
  ].join('\n')
}

/** A primeira linha não vazia do mandato: o que identifica uma sessão da prova no `/proc` (N3). */
export function marcaDaProva(mandato: string): string {
  const linha = mandato.split('\n').find((l) => l.trim() !== '')
  if (linha === undefined) throw new Error('mandato vazio')
  return linha.trim()
}

/** O valor de `OC_FABRICA_DESPACHO` no ambiente da sessão. */
export function marcaDoDespacho(instancia: string, id: string): string {
  return `${instancia}/${id}`
}

/** O card que o comando cita: o primeiro `#<n>`, ou o argumento inteiro se for só dígitos. */
export function cardDoComando(comando: string): number | null {
  const cita = /#(\d+)/.exec(comando)
  if (cita) return Number(cita[1])
  const argumento = /^\/\S+\s+([\s\S]*)$/.exec(comando)?.[1]?.trim()
  if (argumento !== undefined && /^\d+$/.test(argumento)) return Number(argumento)
  return null
}

/** O mandato do board pela GraphQL, que tem porta de fixture (F2 §F2.4, Decisão 4). */
export const MANDATO_QUERY = `query Mandato($owner: String!, $name: String!, $expressao: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expressao) { ... on Blob { text } }
  }
}`

/** O texto do mandato na resposta; erro, objeto ausente ou vazio lança. */
export function textoDoMandato(resposta: GraphQLResponse, ref: string): string {
  const primeiro = resposta.errors?.[0]
  if (primeiro !== undefined) throw new Error(primeiro.message)
  const data = resposta.data as {
    repository?: { object?: { text?: unknown } | null } | null
  } | null
  const texto = data?.repository?.object?.text
  if (typeof texto === 'string' && texto.trim() !== '') return texto
  throw new Error(`mandato ilegível na ${ref}: vazio`)
}
