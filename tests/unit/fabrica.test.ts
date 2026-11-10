import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O CA-0.4 da P0 em forma de teste: a Direção e o Mandato da fábrica vivem em `fabrica/`, versionados
 * no repo, e **não** em um `CLAUDE.md`, que é carregado por toda sessão, inclusive pelas que não são
 * da prova. A leitura da `dev` pelo `gh api` é verificação pós-deploy, não deste teste.
 */
const raiz = fileURLToPath(new URL('../../', import.meta.url))

const IGNORADAS = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'test-results',
  'playwright-report',
  'build',
])

/** Todo arquivo do repo, em caminho relativo com `/`, sem descer nas pastas de saída. */
function arquivosDoRepo(dir: string, prefixo = ''): string[] {
  const achados: string[] = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      if (IGNORADAS.has(entrada.name)) continue
      achados.push(...arquivosDoRepo(join(dir, entrada.name), `${prefixo}${entrada.name}/`))
    } else {
      achados.push(`${prefixo}${entrada.name}`)
    }
  }
  return achados
}

const ler = (relativo: string): string => readFileSync(join(raiz, relativo), 'utf8')

describe('fabrica/', () => {
  it('o mandato começa pela linha do mandato e traz os limites e a regra da parada', () => {
    const mandato = ler('fabrica/MANDATO.md')

    expect(mandato.startsWith('MANDATO DA PROVA DA FÁBRICA')).toBe(true)
    expect(mandato).toContain('Proibido:')
    expect(mandato).toContain('PARADA')
  })

  it('a direção tem as três seções', () => {
    const direcao = ler('fabrica/DIRECAO.md')

    expect(direcao).toContain('## Direção')
    expect(direcao).toContain('## Objetivos')
    expect(direcao).toContain('## Fora do escopo')
  })

  it('nenhum CLAUDE.md do repo cita fabrica/', () => {
    const arquivos = arquivosDoRepo(raiz)

    // Piso: a varredura não pode passar no vazio.
    expect(arquivos).toContain('fabrica/MANDATO.md')
    // Hoje não há CLAUDE.md no repo, e a lista vazia vale: o teste guarda o futuro.
    for (const arquivo of arquivos.filter((a) => a.split('/').pop() === 'CLAUDE.md')) {
      expect(ler(arquivo), arquivo).not.toContain('fabrica/')
    }
  })
})
