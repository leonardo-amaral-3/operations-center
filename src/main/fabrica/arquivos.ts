import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { estadoVazio, parseEstado, serializarEstado } from '../../core/fabrica/estado'
import type { EstadoDaFabrica } from '../../core/fabrica/tipos'

/**
 * Arquivos e cadeados do estado da fábrica (card 121, spec P2 §6). Só Linux: a identidade de um
 * processo vem de `/proc`. Todo cadeado é um arquivo que guarda a identidade do dono, e a escrita do
 * estado passa sempre por `alterarEstado`.
 */

const MENSAGEM_TEMPORARIA =
  'OC_FABRICA_DIR não pode ficar no /tmp: o estado da fábrica tem de sobreviver a um reinício (queda de 09/11/2026)'

/** A pasta da fábrica: `OC_FABRICA_DIR`, ou `<workspace>/claude/despachos-fabrica`. */
export function pastaDaFabrica(env: NodeJS.ProcessEnv, raizDoRepo: string): string {
  const configurada = env.OC_FABRICA_DIR
  if (configurada !== undefined && configurada !== '') return resolve(configurada)
  return join(dirname(raizDoRepo), 'claude', 'despachos-fabrica')
}

/** Recusa `/tmp` e `os.tmpdir()` (e o que está dentro deles) antes de qualquer escrita. */
export function recusarTemporaria(pasta: string): void {
  const alvo = resolve(pasta)
  for (const base of [resolve('/tmp'), resolve(tmpdir())]) {
    if (alvo === base || alvo.startsWith(base + sep)) throw new Error(MENSAGEM_TEMPORARIA)
  }
}

/**
 * `<pid> <starttime>`, com o starttime (campo 22 de `/proc/<pid>/stat`) contado depois do último
 * `)`, porque o nome do processo pode ter espaço e parêntese. Processo inexistente → `null`. O par
 * distingue um pid reciclado depois de um reinício (R-19).
 */
export function identidade(pid: number): string | null {
  let stat: string
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  } catch {
    return null
  }
  const resto = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  // depois do `)` o primeiro campo é o 3 (estado), então o 22 é o índice 19
  const inicio = resto[19]
  return inicio === undefined || inicio === '' ? null : `${pid} ${inicio}`
}

function dormir(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms))
}

function apagar(caminho: string): void {
  try {
    unlinkSync(caminho)
  } catch {
    // já tinha sumido
  }
}

function lerOuNulo(caminho: string): string | null {
  try {
    return readFileSync(caminho, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Cria o cadeado com a identidade própria. O arquivo nasce por `link` de um temporário já
 * completo, então nunca existe vazio (R-11a); `EEXIST` → `false`.
 */
export function criarCadeado(caminho: string): boolean {
  const eu = identidade(process.pid)
  if (eu === null) throw new Error('não consegui ler a identidade do próprio processo em /proc')
  const tmp = `${caminho}.${process.pid}.tmp`
  writeFileSync(tmp, eu)
  try {
    linkSync(tmp, caminho)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  } finally {
    apagar(tmp)
  }
}

/**
 * Tira o cadeado de um dono morto. Renomeia para um nome único e relê: se ainda é o conteúdo
 * julgado morto, apaga; se é outro, um terceiro já tinha tomado, e o cadeado dele volta.
 */
export function tomarSeMorto(caminho: string, lido: string): void {
  const morto = `${caminho}.morto.${process.pid}.${randomUUID()}`
  try {
    renameSync(caminho, morto)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  const conteudo = lerOuNulo(morto)
  if (conteudo === lido) {
    apagar(morto)
    return
  }
  try {
    linkSync(morto, caminho)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
  apagar(morto)
}

type Tomada = { ok: true } | { ok: false; pid: number | null }

/** Uma tentativa de tomar o cadeado, já limpando o de um dono morto. Vazio ou ilegível é vivo. */
function tentarTomar(caminho: string): Tomada {
  for (let i = 0; i < 5; i++) {
    if (criarCadeado(caminho)) return { ok: true }
    const lido = lerOuNulo(caminho)
    if (lido === null) continue
    const pid = Number.parseInt(lido, 10)
    if (!Number.isInteger(pid) || pid <= 0) return { ok: false, pid: null }
    if (identidade(pid) === lido) return { ok: false, pid }
    tomarSeMorto(caminho, lido)
  }
  return { ok: false, pid: null }
}

/** Solta o cadeado só se ele ainda guarda a identidade deste processo. */
function soltarCadeado(caminho: string): void {
  if (lerOuNulo(caminho) === identidade(process.pid)) apagar(caminho)
}

export function lerEstado(pasta: string): EstadoDaFabrica | null {
  const texto = lerOuNulo(join(pasta, 'estado.json'))
  return texto === null ? null : parseEstado(texto)
}

/**
 * Troca atômica: temporário com `fsync`, `rename` e `fsync` da pasta, para o `rename` sobreviver a
 * uma queda de energia (R-16).
 */
export function gravarEstado(pasta: string, e: EstadoDaFabrica): void {
  recusarTemporaria(pasta)
  mkdirSync(pasta, { recursive: true })
  const tmp = join(pasta, `estado.json.${process.pid}.tmp`)
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, serializarEstado(e))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, join(pasta, 'estado.json'))
  const dir = openSync(pasta, 'r')
  try {
    fsyncSync(dir)
  } finally {
    closeSync(dir)
  }
}

/**
 * A única porta de escrita do estado: sob `estado.lock`, relê do disco, aplica `f` e grava. Nunca
 * se grava um estado guardado de um passo anterior (R-4). Um estado ilegível sobe como erro e não
 * é sobrescrito.
 */
export async function alterarEstado<R>(
  pasta: string,
  f: (e: EstadoDaFabrica) => { estado: EstadoDaFabrica; resultado: R },
  esperaMaxMs = 10_000,
): Promise<R> {
  recusarTemporaria(pasta)
  mkdirSync(pasta, { recursive: true })
  const caminho = join(pasta, 'estado.lock')
  const limite = Date.now() + esperaMaxMs
  for (;;) {
    const t = tentarTomar(caminho)
    if (t.ok) break
    if (Date.now() >= limite) {
      throw new Error(
        `o estado está preso pelo processo ${t.pid === null ? 'desconhecido' : String(t.pid)} (${pasta}/estado.lock)`,
      )
    }
    await dormir(50)
  }
  try {
    const atual = lerEstado(pasta) ?? estadoVazio(randomUUID())
    const { estado, resultado } = f(atual)
    gravarEstado(pasta, estado)
    return resultado
  } finally {
    soltarCadeado(caminho)
  }
}

/** Garante um despachante por pasta (`rodar.pid`), sem espera. */
export function tomarRodar(
  pasta: string,
): { ok: true; soltar: () => void } | { ok: false; pid: number } {
  recusarTemporaria(pasta)
  mkdirSync(pasta, { recursive: true })
  const caminho = join(pasta, 'rodar.pid')
  const t = tentarTomar(caminho)
  if (!t.ok) return { ok: false, pid: t.pid ?? 0 }
  return { ok: true, soltar: () => soltarCadeado(caminho) }
}

export function pastaDaSessao(pasta: string, id: string): string {
  return join(pasta, 'sessoes', id)
}

/** O `saida.json` da sessão, ou `null` se o arquivo não existe (o `spawn` não aconteceu). */
export function lerSaida(pasta: string, id: string): string | null {
  return lerOuNulo(join(pastaDaSessao(pasta, id), 'saida.json'))
}

/** O arquivo que pausa a fábrica: existindo, o `rodar` não lança nada novo (§F1.4 do #129). */
export const ARQUIVO_DA_PAUSA = 'pausa.json'

/**
 * Só lê e nunca lança. Sem arquivo → `null`; com `desde` texto → `{ desde }`; JSON torto ou qualquer
 * outro erro de leitura (`EACCES`, `EISDIR`…) → `{ desde: null }`: na dúvida, a fábrica fica pausada.
 */
export function lerPausa(pasta: string): { desde: string | null } | null {
  let texto: string
  try {
    texto = readFileSync(join(pasta, ARQUIVO_DA_PAUSA), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    return { desde: null }
  }
  try {
    const lido: unknown = JSON.parse(texto)
    const desde = (lido as { desde?: unknown } | null)?.desde
    return { desde: typeof desde === 'string' ? desde : null }
  } catch {
    return { desde: null }
  }
}

/** Já pausada → devolve o `desde` sem tocar o arquivo; senão grava por troca atômica (`.tmp` + `rename`). */
export function pausar(pasta: string, agora: string): { jaEstava: boolean; desde: string | null } {
  const atual = lerPausa(pasta)
  if (atual !== null) return { jaEstava: true, desde: atual.desde }
  recusarTemporaria(pasta)
  mkdirSync(pasta, { recursive: true })
  const tmp = join(pasta, `${ARQUIVO_DA_PAUSA}.tmp`)
  writeFileSync(tmp, JSON.stringify({ desde: agora }) + '\n')
  renameSync(tmp, join(pasta, ARQUIVO_DA_PAUSA))
  return { jaEstava: false, desde: agora }
}

/** Apaga `pausa.json`: `true` se apagou, `false` se não existia. */
export function retomar(pasta: string): boolean {
  try {
    unlinkSync(join(pasta, ARQUIVO_DA_PAUSA))
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
