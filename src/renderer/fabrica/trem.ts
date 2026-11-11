import type { Board, BoardCard, CardContent } from '../../shared/board'
import type { ReadCardResult } from '../../shared/ipc'
import { fieldLook } from '../components/fieldLook'
import { colunaDoCard, estacaoDaColuna } from './boardDaFabrica'

export const URL_DO_BOARD_DA_FABRICA = 'https://github.com/users/leonardo-amaral-3/projects/2'
export const URL_DA_DEV_PARA_MAIN =
  'https://github.com/leonardo-amaral-3/operations-center/compare/main...dev'

/** O trem é a coluna 🚂 Release, na ordem do board (aberto ou fechado, de qualquer repo). */
export function cardsDoTrem(board: Board): BoardCard[] {
  return board.cards.filter((c) => estacaoDaColuna(colunaDoCard(board, c)) === 'release')
}

/** O Tipo do card sem o emoji, e a classe de fundo do `fieldLook`. `null` sem Tipo. */
export function tipoDoCard(card: BoardCard): { rotulo: string; classe: string } | null {
  const campo = card.fields.find((f) => f.name === 'Tipo')
  if (campo === undefined) return null
  return { rotulo: campo.value.replace(/^[^\p{L}]+/u, ''), classe: fieldLook(campo) }
}

/** Os nomes curtos dos repos distintos do trem, na ordem em que aparecem. */
export function repoDoTrem(cards: readonly BoardCard[]): string {
  const nomes: string[] = []
  for (const c of cards) {
    const nome = c.repository.split('/').pop() ?? c.repository
    if (!nomes.includes(nome)) nomes.push(nome)
  }
  return nomes.length === 0 ? 'operations-center' : nomes.join(', ')
}

export function linhasDasNotas(cards: readonly BoardCard[]): string[] {
  return cards.map((c) => `#${c.number} ${c.title}`)
}

/** O que **Copiar notas** copia. */
export function textoDasNotas(cards: readonly BoardCard[]): string {
  return ['O que muda para você', ...linhasDasNotas(cards)].join('\n')
}

export type VerificacaoDoCard =
  | { kind: 'itens'; itens: string[] }
  | { kind: 'vazia' }
  | { kind: 'ref' }
  | { kind: 'sem-spec'; truncado: boolean }

const TITULO_DA_SECAO = '## Verificação pós-deploy'
const INICIO_DE_ITEM = /^(\d+[.)]|[-*])\s+(.*)$/

/**
 * Os itens da seção `## Verificação pós-deploy` de um corpo, ou `null` sem a seção. A seção vai até
 * o próximo `# ` ou `## ` fora de bloco de código. Sem item nenhum, a seção inteira é um item.
 */
export function itensDaSecao(corpo: string): string[] | null {
  const linhas = corpo.split(/\r?\n/)
  const inicio = linhas.findIndex((l) => l.trimEnd() === TITULO_DA_SECAO)
  if (inicio === -1) return null

  const secao: { texto: string; fora: boolean }[] = []
  let dentroDeBloco = false
  for (const linha of linhas.slice(inicio + 1)) {
    if (linha.startsWith('```')) {
      dentroDeBloco = !dentroDeBloco
      secao.push({ texto: linha, fora: false })
      continue
    }
    if (!dentroDeBloco && (linha.startsWith('# ') || linha.startsWith('## '))) break
    secao.push({ texto: linha, fora: !dentroDeBloco })
  }

  const itens: string[] = []
  let corrente: string | null = null
  const fechar = (): void => {
    if (corrente !== null) itens.push(corrente)
    corrente = null
  }
  for (const { texto, fora } of secao) {
    if (texto.trim() === '') {
      fechar()
      continue
    }
    const inicioDeItem = fora ? INICIO_DE_ITEM.exec(texto) : null
    if (inicioDeItem) {
      fechar()
      corrente = (inicioDeItem[2] ?? '').trim()
    } else if (corrente !== null) {
      corrente = `${corrente} ${texto.trim()}`
    }
  }
  fechar()
  if (itens.length > 0) return itens

  const inteira = secao
    .map((s) => s.texto.trim())
    .filter((t) => t !== '')
    .join(' ')
  return inteira === '' ? [] : [inteira]
}

const PARTE_DA_SPEC = /^spec(?:-(\d+))?$/
const LINHA_DO_MARCADOR = /^<!--[^\n]*-->[^\S\n]*\r?\n?/

/**
 * A spec inteira de um card: o `gm:spec` e os `gm:spec-N` (o GitHub corta o comentário em 65 536
 * caracteres, e a spec longa sai em partes), na ordem da parte (`spec` é a 1), o primeiro de cada
 * número, sem a linha do marcador, juntos por linha vazia. `null` sem parte nenhuma.
 */
export function specDoConteudo(conteudo: CardContent): string | null {
  const partes = new Map<number, string>()
  for (const c of conteudo.comments) {
    const m = c.kind === null ? null : PARTE_DA_SPEC.exec(c.kind)
    if (m === null) continue
    const n = m[1] === undefined ? 1 : Number(m[1])
    if (!partes.has(n)) partes.set(n, c.body.replace(LINHA_DO_MARCADOR, ''))
  }
  if (partes.size === 0) return null
  return [...partes.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, corpo]) => corpo)
    .join('\n\n')
}

/** A verificação pós-deploy de um card, pelo `kind` que o leitor do card já preenche. */
export function verificacaoDoConteudo(conteudo: CardContent): VerificacaoDoCard {
  const spec = specDoConteudo(conteudo)
  if (spec !== null) {
    const itens = itensDaSecao(spec)
    return itens === null || itens.length === 0 ? { kind: 'vazia' } : { kind: 'itens', itens }
  }
  if (conteudo.comments.some((c) => c.kind === 'spec-ref')) return { kind: 'ref' }
  return { kind: 'sem-spec', truncado: conteudo.truncated }
}

export interface LinhaDaVerificacao {
  chave: string
  texto: string
  completo: string
  marcavel: boolean
}

const CORTE = 160

/** As linhas da verificação de um card no Release, nos seis casos da leitura. */
export function linhasDaVerificacao(
  card: BoardCard,
  leitura: ReadCardResult | undefined,
): LinhaDaVerificacao[] {
  const linha = (i: number, completo: string, marcavel: boolean): LinhaDaVerificacao => ({
    chave: `${card.itemId}:${i}`,
    texto: completo.length > CORTE ? `${completo.slice(0, CORTE - 1)}…` : completo,
    completo,
    marcavel,
  })
  const n = `#${card.number}`
  if (leitura === undefined) return [linha(0, `${n}: lendo a spec…`, false)]
  if (!leitura.ok) return [linha(0, `${n}: não deu para ler o card: ${leitura.reason}`, false)]

  const v = verificacaoDoConteudo(leitura.content)
  switch (v.kind) {
    case 'itens':
      return v.itens.map((item, i) => linha(i, `${n}: ${item}`, true))
    case 'vazia':
      return [linha(0, `${n}: a spec não tem a seção Verificação pós-deploy`, false)]
    case 'ref':
      return [
        linha(
          0,
          card.parent === null
            ? `${n}: a verificação está na spec citada no gm:spec-ref`
            : `${n}: a verificação está na spec do épico #${card.parent.number}`,
          false,
        ),
      ]
    case 'sem-spec':
      return [
        linha(
          0,
          `${n}: o card não tem comentário gm:spec${v.truncado ? ' nos primeiros 100 comentários' : ''}`,
          false,
        ),
      ]
  }
}
