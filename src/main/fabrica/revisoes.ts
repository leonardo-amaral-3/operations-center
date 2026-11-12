import {
  closeSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import type { LinhaDaRevisao } from '../../core/fabrica/revisoes'
import { recusarTemporaria } from './arquivos'

/**
 * O único arquivo da F5 que escreve na pasta da fábrica (spec F5 §F5.5): as revisões das decisões
 * do cofre, uma linha JSON por veredito. Só o `executar` do `yarn fabrica` o chama.
 */
export const ARQUIVO_DAS_REVISOES = 'revisoes.jsonl'

/** O texto do arquivo, ou `null` sem ele (ENOENT). Outro erro sobe. */
export function lerTextoDasRevisoes(pasta: string): string | null {
  try {
    return readFileSync(join(pasta, ARQUIVO_DAS_REVISOES), 'utf8')
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw erro
  }
}

/**
 * Acrescenta uma linha (JSON + '\n') com O_APPEND e fsync. Sem cadeado: as linhas só se acrescentam,
 * e a leitura dá a primeira de cada arquivo (Technical Decisions, 2).
 */
export function acrescentarRevisao(pasta: string, linha: LinhaDaRevisao): void {
  recusarTemporaria(pasta)
  mkdirSync(pasta, { recursive: true })
  const fd = openSync(join(pasta, ARQUIVO_DAS_REVISOES), 'a+')
  try {
    const tamanho = fstatSync(fd).size
    if (tamanho > 0) {
      // Uma escrita anterior cortada no meio deixa o arquivo sem o `\n` final.
      const ultimo = Buffer.alloc(1)
      readSync(fd, ultimo, 0, 1, tamanho - 1)
      if (ultimo[0] !== 0x0a) writeSync(fd, '\n')
    }
    writeSync(fd, JSON.stringify(linha) + '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
