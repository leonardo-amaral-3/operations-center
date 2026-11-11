import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ARQUIVO_DO_PROTOTIPO } from '../../src/renderer/fabrica/rotas'
import { renderizarPrototipo, TELAS_DO_PROTOTIPO } from '../visual/prototipo'

/**
 * O protótipo versionado e o render estático dele (#130, F1.6, CA-1.3): a régua do harness de
 * comparação. Se o render deixa sobra de marcação dinâmica, ou a cópia deriva do canvas, o print do
 * protótipo deixa de ser uma régua.
 */
const PASTA = fileURLToPath(new URL('../fixtures/prototipo/', import.meta.url))
const ler = (arquivo: string): string => readFileSync(`${PASTA}${arquivo}`, 'utf8')

// Prefixos de `sha256` da cópia (P14). Mudou o canvas: copiar de novo e atualizar aqui.
const SHA256: Record<string, string> = {
  'Agentes.dc.html': '1e7077106c31de21',
  'Briefing.dc.html': '2a3f7a628639f6da',
  'Card.dc.html': 'd55c309f4d01e6eb',
  'Decisao.dc.html': 'aa23d3786a2a8129',
  'Entrada.dc.html': '2d4ac689ac16dea9',
  'Fluxo.dc.html': '01a77328e1090d8a',
  'Main.dc.html': 'e214f451acb1bd43',
  'Mandato.dc.html': '8adbbf113bb21709',
  'Pergunta.dc.html': 'e8e9acaf84c6e4fb',
  'Portfolio.dc.html': '7e39e938e5c10dac',
  'Relatorio.dc.html': '81bf40262f9e8060',
  'Release.dc.html': 'd4ffe1eca7e09b3b',
}

const SOBRAS = /\{\{|<sc-|<script|support\.js|fonts\.googleapis/
const conta = (texto: string, trecho: string): number => texto.split(trecho).length - 1

const render = (arquivo: string) => renderizarPrototipo(ler(arquivo))
const pagina = (arquivo: string): string => render(arquivo).pagina

describe('o protótipo versionado', () => {
  it('a cópia bate com os sha256 do canvas', () => {
    for (const [arquivo, prefixo] of Object.entries(SHA256)) {
      const sha = createHash('sha256')
        .update(readFileSync(`${PASTA}${arquivo}`))
        .digest('hex')
      expect(sha.slice(0, 16), arquivo).toBe(prefixo)
    }
  })

  it('as 11 telas e o Fluxo renderizam sem sobra de marcação dinâmica', () => {
    const arquivos = [...TELAS_DO_PROTOTIPO.map((t) => t.arquivo), 'Fluxo.dc.html']
    expect(arquivos).toHaveLength(12)
    for (const arquivo of arquivos) {
      expect(pagina(arquivo), arquivo).not.toMatch(SOBRAS)
    }
  })

  it('o render é reproduzível', () => {
    expect(pagina('Main.dc.html')).toBe(pagina('Main.dc.html'))
  })

  it('reproduz as listas do exemplo (P3)', () => {
    const pergunta = pagina('Pergunta.dc.html')
    expect(conta(pergunta, 'class="nb opt"')).toBe(3)
    expect(conta(pergunta, 'recomendado')).toBe(1)

    const relatorio = pagina('Relatorio.dc.html')
    expect(conta(relatorio, '<article')).toBe(5)
    expect(conta(relatorio, '>Confirmar<')).toBe(3)

    const portfolio = pagina('Portfolio.dc.html')
    expect(conta(portfolio, '<button type="button" class="row"')).toBe(8)
    expect(portfolio).toContain('8 de 117')

    const mandato = pagina('Mandato.dc.html')
    expect(conta(mandato, 'class="seg"')).toBe(24)
    expect(conta(mandato, 'C · travado')).toBe(3)

    expect(conta(pagina('Entrada.dc.html'), 'class="src"')).toBe(5)
    expect(conta(pagina('Briefing.dc.html'), 'aria-pressed')).toBe(2)
  })

  it('o $preview dá a largura e a altura de cada tela', () => {
    const tamanhos = Object.fromEntries(
      [...TELAS_DO_PROTOTIPO.map((t) => t.arquivo), 'Fluxo.dc.html'].map((a) => {
        const { largura, altura } = render(a)
        return [a, `${largura}x${altura}`]
      }),
    )
    expect(tamanhos).toEqual({
      'Main.dc.html': '1440x1000',
      'Agentes.dc.html': '1440x1000',
      'Pergunta.dc.html': '1440x1000',
      'Decisao.dc.html': '1440x1000',
      'Card.dc.html': '1440x1000',
      'Entrada.dc.html': '1440x1000',
      'Relatorio.dc.html': '1440x1400',
      'Portfolio.dc.html': '1440x1200',
      'Mandato.dc.html': '1440x960',
      'Briefing.dc.html': '1440x1100',
      'Release.dc.html': '1440x1000',
      'Fluxo.dc.html': '2368x1264',
    })
  })

  it('sem $preview a tela é 1440x1000', () => {
    const { largura, altura } = renderizarPrototipo('<x-dc><helmet></helmet><div>oi</div></x-dc>')
    expect([largura, altura]).toEqual([1440, 1000])
  })

  it('o Fluxo aponta exatamente para os arquivos das telas (canária de P2)', () => {
    const hrefs = [...ler('Fluxo.dc.html').matchAll(/href="([^"]+\.dc\.html)"/g)].map((m) => m[1])
    const sem = hrefs.filter((h) => h !== 'Slack.dc.html').sort()
    expect(sem).toEqual(Object.values(ARQUIVO_DO_PROTOTIPO).sort())
  })
})
