import { readdirSync, readFileSync } from 'node:fs'

/**
 * Processos da fábrica, lidos de `/proc` (card 121, spec P2 §7). Só Linux: o §9 recusa outra
 * plataforma antes. Um pid que sumiu ou não se deixa ler (`EACCES`) é pulado.
 */

function separado(pid: number, arquivo: 'cmdline' | 'environ'): string[] | null {
  try {
    const texto = readFileSync(`/proc/${pid}/${arquivo}`, 'utf8')
    return texto === '' ? [] : texto.replace(/\0$/, '').split('\0')
  } catch {
    return null
  }
}

export function argv(pid: number): string[] {
  return separado(pid, 'cmdline') ?? []
}

export function ambiente(pid: number): string[] {
  return separado(pid, 'environ') ?? []
}

/** Sessão é o processo com `-p` ou `--print` no argv, qualquer que seja o `argv[0]` (N4). */
export function ehSessao(pid: number): boolean {
  return argv(pid).some((a) => a === '-p' || a === '--print')
}

/**
 * Vivo é ter a marca exata no ambiente **e** ser sessão: os descendentes herdam a marca (N5) mas não
 * têm `-p`. Um zumbi tem `environ` vazio e conta como morto.
 */
export function despachoVivo(pid: number, marca: string): boolean {
  return ambiente(pid).includes(`OC_FABRICA_DESPACHO=${marca}`) && ehSessao(pid)
}

function pids(): number[] {
  return readdirSync('/proc')
    .filter((n) => /^\d+$/.test(n))
    .map(Number)
}

function paiDe(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const resto = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const ppid = Number(resto[1])
    return Number.isInteger(ppid) ? ppid : null
  } catch {
    return null
  }
}

/** O pid da sessão com a marca: entre os candidatos, o que não tem pai no mesmo conjunto. */
export function acharDespacho(marca: string): number | null {
  const candidatos = pids().filter((p) => despachoVivo(p, marca))
  const conjunto = new Set(candidatos)
  for (const p of candidatos) {
    const pai = paiDe(p)
    if (pai === null || !conjunto.has(pai)) return p
  }
  return null
}

/**
 * Conta as sessões da prova vivas na máquina, de qualquer origem: `-p` e um argumento que contém a
 * marca do mandato (N3, N4). Não conta o próprio processo.
 */
export function contarSessoesDaProva(marca: string): number {
  return pids().filter(
    (p) => p !== process.pid && ehSessao(p) && argv(p).some((a) => a.includes(marca)),
  ).length
}
