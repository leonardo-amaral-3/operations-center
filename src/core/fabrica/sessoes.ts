import type { OrigemDaSessao, SessaoDaMaquina } from '../../shared/fabrica'

/** O que se leu de um processo da máquina; `cwd` é o readlink de /proc/<pid>/cwd (null sem leitura). */
export interface ProcessoLido {
  pid: number
  argv: readonly string[]
  ambiente: readonly string[]
  cwd: string | null
}

/** Primeiro argumento que não é sessão: subcomandos e consultas curtas do CLI. */
export const SUBCOMANDOS_SEM_SESSAO = [
  'mcp',
  'doctor',
  'update',
  'upgrade',
  'install',
  'config',
  'plugin',
  'setup-token',
  'migrate-installer',
  '--version',
  '-v',
  '--help',
  '-h',
] as const

const base = (s: string): string => s.split('/').pop() ?? ''

/**
 * Um processo é sessão `claude` só pelo argv, nunca pelo executável: o binário nativo se reexecuta
 * com `argv[0]` `rg` e `apply-seccomp`, e esses filhos não são sessão.
 */
export function ehSessaoClaude(argv: readonly string[]): boolean {
  if (argv.length === 0) return false
  const forma = /\/@anthropic-ai\/claude-code\/cli\.m?js$/.test(argv[1] ?? '') ? 'js' : null
  const nativa = base(argv[0] ?? '') === 'claude'
  if (!nativa && forma === null) return false
  if (argv.includes('--chrome-native-host')) return false
  const primeiro = nativa ? argv[1] : argv[2]
  if (primeiro !== undefined && (SUBCOMANDOS_SEM_SESSAO as readonly string[]).includes(primeiro)) {
    return false
  }
  return true
}

/** `'sdk'` diz só que um cliente do SDK subiu a sessão (o app ou outro). */
export function origemDaSessao(argv: readonly string[]): OrigemDaSessao {
  if (argv.includes('-p') || argv.includes('--print')) return 'despachada'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input-format' && argv[i + 1] === 'stream-json') return 'sdk'
  }
  return 'interativa'
}

/** A skill do prompt de uma sessão `-p` ('/gm-spec #142…' → 'gm-spec'). Nenhum outro pedaço do argv sai. */
export function skillDaSessao(argv: readonly string[]): string | null {
  const i = argv.findIndex((a) => a === '-p' || a === '--print')
  if (i === -1) return null
  return /^\/([a-z][\w-]*)(?=\s|$)/.exec(argv[i + 1] ?? '')?.[1] ?? null
}

export function pastaVisivel(cwd: string, home: string): string {
  if (cwd === home) return '~'
  if (cwd.startsWith(home + '/')) return '~/' + cwd.slice(home.length + 1)
  const ultimo = cwd
    .split('/')
    .filter((x) => x !== '')
    .pop()
  return ultimo ?? '/'
}

const escapado = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * O card da pasta: percorre os segmentos do mais fundo ao mais raso e devolve o do primeiro
 * `<nome-do-repo>-<n>` (com `-` depois do número ou no fim do segmento). Diferente do `cardDaCwd`
 * de `recursos.ts`, que exige `-` depois do número e procura em qualquer ponto do texto.
 */
export function cardDoCaminho(cwd: string, repo: string): number | null {
  const nome = (repo.split('/')[1] ?? '').toLowerCase()
  if (nome === '') return null
  const padrao = new RegExp('^' + escapado(nome) + '-(\\d+)(-|$)', 'i')
  const segmentos = cwd.split('/')
  for (let i = segmentos.length - 1; i >= 0; i--) {
    const achou = padrao.exec(segmentos[i] ?? '')
    if (achou) return Number(achou[1])
  }
  return null
}

export function montarSessao(p: ProcessoLido, repo: string | null, home: string): SessaoDaMaquina {
  const cwd = p.cwd !== null && p.cwd.endsWith(' (deleted)') ? null : p.cwd
  const origem = origemDaSessao(p.argv)
  const card = cwd !== null && repo !== null ? cardDoCaminho(cwd, repo) : null
  return {
    pid: p.pid,
    origem,
    daFabrica: p.ambiente.some((v) => v.startsWith('OC_FABRICA_DESPACHO=')),
    skill: origem === 'despachada' ? skillDaSessao(p.argv) : null,
    pasta: cwd === null ? null : pastaVisivel(cwd, home),
    repo,
    card,
    cardUrl: card === null || repo === null ? null : `https://github.com/${repo}/issues/${card}`,
  }
}
