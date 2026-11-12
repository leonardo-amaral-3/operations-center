import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RecursosDaFabrica } from '../../shared/fabrica'
import { MINIMO_DE_DISCO, cardDaCwd, lerProcLocks } from '../../core/fabrica/recursos'
import { TETO_DE_SESSOES, marcaDaProva } from '../../core/fabrica/mandato'
import { contarSessoesDaProva, cwdDoProcesso } from './processos'

/**
 * Os recursos da fábrica (F2 §F2.3). Este arquivo só lê: é varrido pela canária "só lê", que
 * procura as portas de escrita no texto inteiro, comentário incluído.
 */

export type EstadoDaMarca =
  { kind: 'lendo' } | { kind: 'ok'; marca: string } | { kind: 'erro'; erro: string }

export interface PortasDosRecursos {
  plataforma: NodeJS.Platform
  env: NodeJS.ProcessEnv
  uid: number
  pastaDaFabrica: string
  /** O nome do repo do board (`<nome>-<n>-<slug>` é a worktree do card). */
  nomesDosRepos: readonly string[]
  marca: () => EstadoDaMarca
  contarSessoes: (marca: string) => number
  existe: (caminho: string) => boolean
  /** `statSync(…).ino`; ENOENT → `null`; outro erro lança. */
  inodeDe: (caminho: string) => number | null
  procLocks: () => string
  cwdDe: (pid: number) => string | null
  /** `statfsSync`: `bavail * bsize`. */
  livresEm: (caminho: string) => number
}

/**
 * O cadeado da suíte de smoke: a mesma regra de `scripts/smoke.mjs` (`caminhoDoCadeado`). Os dois
 * são presos juntos por uma canária em `tests/unit/fabrica-recursos.test.ts`.
 */
export function caminhoDoCadeadoDaSuite(
  env: NodeJS.ProcessEnv,
  uid: number,
  existe: (caminho: string) => boolean,
): string {
  const dePorta = env['OC_SMOKE_CADEADO']
  if (dePorta !== undefined && dePorta !== '') return dePorta
  const runtime = join('/run/user', String(uid))
  return existe(runtime)
    ? join(runtime, 'operations-center-smoke.lock')
    : `/tmp/operations-center-smoke-${uid}.lock`
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}

/** Nunca lança: cada leitura tem o seu `try`, e o erro vira `sem-leitura` com a mensagem. */
export function lerRecursos(p: PortasDosRecursos): RecursosDaFabrica {
  const linux = p.plataforma === 'linux'

  let sessoes: RecursosDaFabrica['sessoes']
  try {
    const teto = TETO_DE_SESSOES
    if (!linux) {
      sessoes = { kind: 'sem-leitura', motivo: 'a contagem de sessões lê /proc, só no Linux', teto }
    } else {
      const marca = p.marca()
      if (marca.kind === 'lendo') {
        sessoes = { kind: 'sem-leitura', motivo: 'lendo o mandato da dev', teto }
      } else if (marca.kind === 'erro') {
        sessoes = { kind: 'sem-leitura', motivo: marca.erro, teto }
      } else {
        sessoes = { kind: 'ok', vivas: p.contarSessoes(marca.marca), teto }
      }
    }
  } catch (erro) {
    sessoes = { kind: 'sem-leitura', motivo: mensagem(erro), teto: TETO_DE_SESSOES }
  }

  let suite: RecursosDaFabrica['suite']
  try {
    if (!linux) {
      suite = { kind: 'sem-leitura', motivo: 'o cadeado da suíte só existe no Linux' }
    } else {
      const inode = p.inodeDe(caminhoDoCadeadoDaSuite(p.env, p.uid, p.existe))
      if (inode === null) {
        // Ninguém rodou a suíte desde o boot: o `flock` é quem cria o arquivo.
        suite = { kind: 'livre' }
      } else {
        const { dono, esperando } = lerProcLocks(p.procLocks(), inode)
        suite =
          dono === null
            ? { kind: 'livre' }
            : {
                kind: 'ocupada',
                card: cardDaCwd(p.cwdDe(dono) ?? '', p.nomesDosRepos)?.n ?? null,
                esperando,
              }
      }
    }
  } catch (erro) {
    suite = { kind: 'sem-leitura', motivo: mensagem(erro) }
  }

  let disco: RecursosDaFabrica['disco']
  try {
    const onde = p.existe(p.pastaDaFabrica) ? p.pastaDaFabrica : dirname(p.pastaDaFabrica)
    disco = { kind: 'ok', livres: p.livresEm(onde), minimo: MINIMO_DE_DISCO }
  } catch (erro) {
    disco = { kind: 'sem-leitura', motivo: mensagem(erro) }
  }

  return { sessoes, suite, disco }
}

/**
 * O mandato da `dev` em cache, sem esperar: cada chamada devolve o que há (começa `lendo`) e, se
 * nada está em voo e a última resposta é velha, dispara a leitura. A resposta conta, de sucesso ou
 * de falha, para a rede fora dar uma tentativa por minuto e não uma por leitura da sala. Falha com
 * um `ok` guardado o mantém: o mandato muda por PR, e um soluço não apaga a contagem.
 */
export function criarMarcaEmCache(
  lerMandato: () => Promise<string>,
  agora: () => number,
  validadeMs = 60_000,
): () => EstadoDaMarca {
  let estado: EstadoDaMarca = { kind: 'lendo' }
  let chegouEm: number | null = null
  let emVoo = false
  let comecouEm = 0
  // Cada leitura tem um número: a que passou do prazo é abandonada e a resposta dela, se vier, cai fora.
  let geracao = 0

  const registrar = (minha: number, novo: EstadoDaMarca | null): void => {
    if (minha !== geracao) return
    if (novo !== null) estado = novo
    chegouEm = agora()
    emVoo = false
  }
  const falhou = (minha: number, erro: unknown): void =>
    registrar(minha, estado.kind === 'ok' ? null : { kind: 'erro', erro: mensagem(erro) })

  return () => {
    // Uma leitura que nunca resolve (rede caída no meio do fetch) não trava as seguintes para sempre.
    if (emVoo && agora() - comecouEm >= 2 * validadeMs) emVoo = false
    if (!emVoo && (chegouEm === null || agora() - chegouEm >= validadeMs)) {
      emVoo = true
      comecouEm = agora()
      const minha = ++geracao
      let leitura: Promise<string>
      try {
        leitura = lerMandato()
      } catch (erro) {
        leitura = Promise.reject(erro instanceof Error ? erro : new Error(mensagem(erro)))
      }
      leitura.then(
        (texto) => {
          try {
            registrar(minha, { kind: 'ok', marca: marcaDaProva(texto) })
          } catch (erro) {
            falhou(minha, erro)
          }
        },
        (erro) => falhou(minha, erro),
      )
    }
    return estado
  }
}

/** Os nomes das pastas do workspace (sem caminho): `ondeRodaDo` lê neles as worktrees de cada card. */
export function worktreesDo(workspace: string): string[] {
  try {
    return readdirSync(workspace, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

export function portasReais(o: {
  env: NodeJS.ProcessEnv
  pastaDaFabrica: string
  nomesDosRepos: readonly string[]
  marca: () => EstadoDaMarca
}): PortasDosRecursos {
  return {
    plataforma: process.platform,
    env: o.env,
    uid: process.getuid?.() ?? -1,
    pastaDaFabrica: o.pastaDaFabrica,
    nomesDosRepos: o.nomesDosRepos,
    marca: o.marca,
    contarSessoes: contarSessoesDaProva,
    existe: existsSync,
    inodeDe: (caminho) => {
      try {
        return statSync(caminho).ino
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw erro
      }
    },
    procLocks: () => readFileSync('/proc/locks', 'utf8'),
    cwdDe: cwdDoProcesso,
    livresEm: (caminho) => {
      const s = statfsSync(caminho)
      return s.bavail * s.bsize
    },
  }
}
