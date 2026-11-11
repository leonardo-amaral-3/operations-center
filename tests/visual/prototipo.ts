import { runInNewContext } from 'node:vm'
import { ARQUIVO_DO_PROTOTIPO, type NomeDaTela } from '../../src/renderer/fabrica/rotas'

/**
 * Render estático do protótipo da fábrica (#130, F1.6): o `*.dc.html` do canvas sem o `support.js`,
 * que não existe fora dele. Porte de `medicao/render-estatico.mjs` do #129 (mesmo algoritmo).
 */

export const TELAS_DO_PROTOTIPO: ReadonlyArray<{ tela: NomeDaTela; arquivo: string }> = (
  Object.entries(ARQUIVO_DO_PROTOTIPO) as Array<[NomeDaTela, string]>
).map(([tela, arquivo]) => ({ tela, arquivo }))

/** O DCLogic mínimo: props vazias, `state` do construtor, `setState` inerte. */
class DCLogic {
  props: Record<string, unknown>
  state: Record<string, unknown> = {}
  constructor(props?: Record<string, unknown>) {
    this.props = props ?? {}
  }
  setState(): void {}
}

interface Componente {
  new (props: Record<string, unknown>): { renderVals(): Record<string, unknown> }
}

type Escopo = Record<string, unknown>

function entre(texto: string, abre: string, fecha: string): string | null {
  const i = texto.indexOf(abre)
  if (i < 0) return null
  const j = texto.indexOf(fecha, i + abre.length)
  if (j < 0) return null
  return texto.slice(i + abre.length, j)
}

function valorDe(caminho: string, escopo: Escopo): unknown {
  let atual: unknown = escopo
  for (const parte of caminho.trim().split('.')) {
    if (atual === null || atual === undefined) return undefined
    atual = (atual as Record<string, unknown>)[parte]
  }
  return atual
}

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapar = (v: unknown): string => String(v).replace(/[&<>"]/g, (c) => ESCAPE[c] ?? c)

/** Acha o fechamento que casa com a abertura em `inicio`, contando aninhamento da mesma tag. */
function fechamento(texto: string, tag: string, inicio: number): { fim: number; depois: number } {
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g')
  re.lastIndex = inicio
  let nivel = 0
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    if (m[0].startsWith('</')) {
      nivel -= 1
      if (nivel === 0) return { fim: m.index, depois: m.index + m[0].length }
    } else nivel += 1
  }
  throw new Error(`<${tag}> sem fechamento`)
}

function attr(tagAberta: string, nome: string): string | null {
  const m = new RegExp(`${nome}="([^"]*)"`).exec(tagAberta)
  return m?.[1] ?? null
}

function interpolar(texto: string, escopo: Escopo): string {
  // Atributo inteiro com {{x}}: função, null e undefined caem; o resto vira valor escapado.
  const semAttr = texto.replace(
    /\s([a-zA-Z-]+)="\{\{([^}]+)\}\}"/g,
    (_, nome: string, caminho: string) => {
      const v = valorDe(caminho, escopo)
      if (typeof v === 'function' || v === undefined || v === null) return ''
      return ` ${nome}="${escapar(v)}"`
    },
  )
  return semAttr.replace(/\{\{([^}]+)\}\}/g, (_, caminho: string) => {
    const v = valorDe(caminho, escopo)
    return v === undefined || v === null ? '' : escapar(v)
  })
}

function expandir(texto: string, escopo: Escopo): string {
  let saida = ''
  let i = 0
  const re = /<sc-(for|if)\b[^>]*>/g
  for (;;) {
    re.lastIndex = i
    const m = re.exec(texto)
    if (!m) break
    saida += interpolar(texto.slice(i, m.index), escopo)
    const f = fechamento(texto, `sc-${m[1]}`, m.index)
    const corpo = texto.slice(m.index + m[0].length, f.fim)
    if (m[1] === 'for') {
      const lista = valorDe((attr(m[0], 'list') ?? '').replace(/[{}]/g, ''), escopo)
      const como = attr(m[0], 'as') ?? ''
      if (Array.isArray(lista)) {
        for (const item of lista as unknown[]) saida += expandir(corpo, { ...escopo, [como]: item })
      }
    } else if (valorDe((attr(m[0], 'value') ?? '').replace(/[{}]/g, ''), escopo)) {
      saida += expandir(corpo, escopo)
    }
    i = f.depois
  }
  return saida + interpolar(texto.slice(i), escopo)
}

export function renderizarPrototipo(html: string): {
  pagina: string
  largura: number
  altura: number
} {
  const helmet = entre(html, '<helmet>', '</helmet>') ?? ''
  const corpo = entre(html, '</helmet>', '</x-dc>') ?? ''
  const script =
    /<script type="text\/x-dc"[^>]*data-props='([^']*)'[^>]*>([\s\S]*?)<\/script>/.exec(html)
  const props = script?.[1] ? (JSON.parse(script[1]) as { $preview?: unknown }) : {}
  const preview = props.$preview as { width?: number; height?: number } | undefined
  const codigo = script?.[2] ?? 'class Component extends DCLogic { renderVals() { return {} } }'
  const Component = runInNewContext(`${codigo}\nComponent`, { DCLogic }) as Componente
  const vals = new Component({}).renderVals()
  const head = helmet.replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, '')
  const titulo = entre(html, '<title>', '</title>') ?? ''
  const pagina = `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<title>${titulo}</title>\n${head}\n</head>\n<body>\n${expandir(corpo, vals)}\n</body>\n</html>\n`
  return { pagina, largura: preview?.width ?? 1440, altura: preview?.height ?? 1000 }
}
