import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PrArquivo, PrTimelineEntry, PullRequestView as Pr } from '../../src/shared/board'
import { PullRequestView } from '../../src/renderer/components/PullRequestView'
import type { PullRequestState } from '../../src/renderer/components/PullRequestView'

/** CA-3, CA-4 e CA-5 pelo lado da tela, com o aparato do `CardContentView.test.tsx`. */

const AUTOR = { login: 'leonardo-amaral-3', bot: false }

function pr(over: Partial<Pr> = {}): Pr {
  return {
    number: 76,
    title: 'Expandir o cartão',
    url: 'https://github.com/o/r/pull/76',
    state: 'OPEN',
    isDraft: false,
    mergedAt: null,
    baseRef: 'dev',
    headRef: 'feat/28-expandir',
    body: 'o corpo do PR',
    mergeable: 'MERGEABLE',
    timeline: [],
    timelineTruncated: false,
    checks: { state: 'SUCCESS', checks: [], truncated: false },
    arquivos: [],
    totalDeArquivos: 0,
    arquivosCortados: false,
    ...over,
  }
}

function arquivo(over: Partial<PrArquivo> = {}): PrArquivo {
  return {
    caminho: 'src/a.ts',
    caminhoAnterior: null,
    status: 'modified',
    additions: 2,
    deletions: 1,
    url: 'https://github.com/o/r/blob/x/src/a.ts',
    diff: {
      additions: 2,
      deletions: 1,
      truncated: 0,
      hunks: [
        {
          lines: [
            { kind: 'remove', number: 1, text: 'velho' },
            { kind: 'add', number: 1, text: 'novo' },
          ],
        },
      ],
    },
    ...over,
  }
}

function render(
  state: PullRequestState,
  over: { pending?: boolean; arquivoAberto?: string | null } = {},
): string {
  return renderToStaticMarkup(
    <PullRequestView
      state={state}
      pending={over.pending ?? false}
      onReload={() => undefined}
      arquivoAberto={over.arquivoAberto ?? null}
      onArquivo={() => undefined}
    />,
  )
}

const carregado = (over: Partial<Pr> = {}): string => render({ kind: 'loaded', pr: pr(over) })

describe('estados da leitura', () => {
  it('lendo e falhou', () => {
    expect(render({ kind: 'loading' })).toContain('Lendo o PR…')
    expect(render({ kind: 'failed', reason: 'sem rede' })).toContain(
      'Não consegui ler o PR: sem rede',
    )
  })

  it('o ⟳ desabilita enquanto lê', () => {
    expect(render({ kind: 'loading' }, { pending: true })).toMatch(
      /data-testid="pr-reload"[^>]*disabled/,
    )
  })
})

describe('cabeçalho e merge', () => {
  it('título, base ← head e o link', () => {
    const html = carregado()

    expect(html).toContain('#76 Expandir o cartão')
    expect(html).toContain('dev ← feat/28-expandir')
    expect(html).toContain('Abrir no GitHub')
    expect(html).toContain('Aberto')
  })

  it('mergeado diz quando, fechado diz que não mergeou, rascunho diz rascunho', () => {
    expect(carregado({ state: 'MERGED', mergedAt: '2026-10-01T10:00:00Z' })).toContain(
      'Mergeado em ',
    )
    expect(carregado({ state: 'CLOSED' })).toContain('Fechado sem merge')
    expect(carregado({ isDraft: true })).toContain('Rascunho')
  })

  it('"mergeável" só em PR aberto', () => {
    expect(carregado({ mergeable: 'MERGEABLE' })).toContain('Mergeável')
    expect(carregado({ mergeable: 'CONFLICTING' })).toContain('Com conflito')
    expect(carregado({ mergeable: 'UNKNOWN' })).toContain(
      'O GitHub ainda está calculando — recarregue',
    )
    expect(carregado({ state: 'MERGED', mergeable: 'UNKNOWN' })).not.toContain('calculando')
    expect(carregado({ state: 'MERGED', mergeable: 'MERGEABLE' })).not.toContain('pr-merge')
  })
})

describe('checks', () => {
  it('um item por check, com link quando há URL', () => {
    const html = carregado({
      checks: {
        state: 'SUCCESS',
        truncated: false,
        checks: [
          { name: 'lint + test', result: 'SUCCESS', url: 'https://ci/1' },
          { name: 'sem-url', result: 'IN_PROGRESS', url: null },
        ],
      },
    })

    expect(html).toContain('CI passou')
    expect(html).toContain('href="https://ci/1"')
    expect(html).toContain('sem-url')
    expect(html).toContain('IN_PROGRESS')
  })

  it('sem checks e com mais checks no GitHub', () => {
    expect(carregado({ checks: { state: null, checks: [], truncated: false } })).toContain(
      'Sem checks',
    )
    expect(carregado({ checks: { state: 'PENDING', checks: [], truncated: true } })).toContain(
      'Há mais checks no GitHub',
    )
  })
})

describe('descrição e conversa', () => {
  it('corpo vazio e conversa vazia', () => {
    const html = carregado({ body: '' })

    expect(html).toContain('Sem descrição')
    expect(html).toContain('Sem comentários')
  })

  it('bot leva etiqueta e autor removido vira "conta removida"', () => {
    const timeline: PrTimelineEntry[] = [
      {
        kind: 'comment',
        id: 'c1',
        author: { login: 'graphify-labs', bot: true },
        at: '2026-10-01T10:00:00Z',
        body: 'oi',
      },
      {
        kind: 'comment',
        id: 'c2',
        author: { login: null, bot: false },
        at: '2026-10-02T10:00:00Z',
        body: 'tchau',
      },
    ]
    const html = carregado({ timeline })

    expect(html).toContain('graphify-labs')
    expect(html).toContain('>bot<')
    expect(html).toContain('conta removida')
    expect(html.match(/data-testid="pr-entry"/g)).toHaveLength(2)
  })

  it('review APPROVED leva a etiqueta do estado', () => {
    const html = carregado({
      timeline: [
        {
          kind: 'review',
          id: 'r1',
          author: AUTOR,
          at: '2026-10-01T10:00:00Z',
          state: 'APPROVED',
          body: '',
        },
      ],
    })

    expect(html).toContain('data-kind="review"')
    expect(html).toContain('aprovou')
  })

  it('thread mostra caminho:linha, Resolvido e Desatualizado', () => {
    const html = carregado({
      timeline: [
        {
          kind: 'thread',
          id: 't1',
          at: '2026-10-01T10:00:00Z',
          caminho: 'src/a.ts',
          line: 12,
          resolved: true,
          outdated: true,
          comments: [
            { id: 'tc1', author: AUTOR, createdAt: '2026-10-01T10:00:00Z', body: 'repare aqui' },
          ],
        },
      ],
    })

    expect(html).toContain('data-kind="thread"')
    expect(html).toMatch(/data-testid="pr-thread-loc"[^>]*>src\/a\.ts:12</)
    expect(html).toContain('pr-thread-resolved')
    expect(html).toContain('Desatualizado')
    expect(html).toContain('repare aqui')
  })

  it('thread sem linha mostra só o caminho, e não-resolvido não leva a marca', () => {
    const html = carregado({
      timeline: [
        {
          kind: 'thread',
          id: 't1',
          at: '2026-10-01T10:00:00Z',
          caminho: 'src/a.ts',
          line: null,
          resolved: false,
          outdated: false,
          comments: [],
        },
      ],
    })

    expect(html).toMatch(/data-testid="pr-thread-loc"[^>]*>src\/a\.ts</)
    expect(html).not.toContain('pr-thread-resolved')
  })

  it('"Há mais comentários no GitHub" quando cortou', () => {
    expect(carregado({ timelineTruncated: true })).toContain('Há mais comentários no GitHub')
  })
})

describe('arquivos', () => {
  const dois = [arquivo(), arquivo({ caminho: 'src/b.ts', diff: null })]

  it('fechado: lista com totais e nenhuma linha de diff', () => {
    const html = carregado({ arquivos: dois, totalDeArquivos: 2 })

    expect(html.match(/data-testid="pr-file"/g)).toHaveLength(2)
    expect(html).toContain('data-caminho="src/a.ts"')
    expect(html).toContain('+2 −1')
    expect(html).not.toContain('diff-line')
  })

  it('aberto: um DiffView só, sob o arquivo certo', () => {
    const html = render(
      { kind: 'loaded', pr: pr({ arquivos: dois, totalDeArquivos: 2 }) },
      { arquivoAberto: 'src/a.ts' },
    )

    expect(html.match(/data-testid="diff-line"/g)).toHaveLength(2)
    expect(html.indexOf('data-caminho="src/a.ts"')).toBeLessThan(html.indexOf('diff-line'))
    expect(html.indexOf('diff-line')).toBeLessThan(html.indexOf('data-caminho="src/b.ts"'))
    expect(html).toContain('aria-expanded="true"')
  })

  it('sem patch: não desenha diff e oferece o link; sem URL, nem o link', () => {
    const aberto = render(
      { kind: 'loaded', pr: pr({ arquivos: [dois[1] as PrArquivo], totalDeArquivos: 1 }) },
      { arquivoAberto: 'src/b.ts' },
    )

    expect(aberto).not.toContain('diff-line')
    expect(aberto).toContain('Ver no GitHub')
    // Nem aberto ele se diz aberto: não há patch, então não há botão, `aria-expanded` nem ▾ (CA-5).
    expect(aberto).not.toContain('aria-expanded')
    expect(aberto).not.toContain('▾')
    expect(aberto).not.toMatch(/<button[^>]*data-testid="pr-file"/)

    const semUrl = carregado({ arquivos: [arquivo({ diff: null, url: null })], totalDeArquivos: 1 })

    expect(semUrl).not.toContain('Ver no GitHub')
  })

  it('renomeado mostra anterior → atual, e sem mudança diz "sem mudança"', () => {
    const html = carregado({
      arquivos: [
        arquivo({ status: 'renamed', caminhoAnterior: 'src/velho.ts', caminho: 'src/novo.ts' }),
        arquivo({ status: 'unchanged', caminho: 'src/c.ts' }),
      ],
      totalDeArquivos: 2,
    })

    expect(html).toContain('src/velho.ts → src/novo.ts')
    expect(html).toContain('sem mudança')
  })

  it('patch cortado leva o link do GitHub', () => {
    const cortado = arquivo()
    if (cortado.diff !== null) cortado.diff = { ...cortado.diff, truncated: 7 }

    const html = render(
      { kind: 'loaded', pr: pr({ arquivos: [cortado], totalDeArquivos: 1 }) },
      { arquivoAberto: 'src/a.ts' },
    )

    expect(html).toContain('… mais 7 linhas')
    expect(html).toContain('Ver no GitHub')
  })

  it('PR grande: "Mostrando 100 de 130 arquivos"', () => {
    const cem = Array.from({ length: 100 }, (_, i) => arquivo({ caminho: `f${i}.ts` }))

    expect(carregado({ arquivos: cem, totalDeArquivos: 130, arquivosCortados: true })).toContain(
      'Mostrando 100 de 130 arquivos',
    )
    expect(carregado({ arquivos: cem, totalDeArquivos: 100 })).not.toContain('Mostrando')
  })
})

/** A tag de abertura do elemento com esse `data-testid` — onde moram as classes que ele carrega. */
function abertura(html: string, testid: string): string {
  const achou = new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`).exec(html)
  if (achou === null) throw new Error(`sem ${testid} no html`)

  return achou[0]
}

describe('blocos', () => {
  it('cada seção é uma Card; só o cabeçalho tem a face branca', () => {
    const html = carregado()

    for (const id of ['pr-header', 'pr-checks', 'pr-body', 'pr-timeline', 'pr-files']) {
      expect(abertura(html, id)).toContain('data-slot="card"')
    }
    expect(abertura(html, 'pr-header')).toContain('bg-secondary-background')
    for (const id of ['pr-checks', 'pr-body', 'pr-timeline', 'pr-files']) {
      expect(abertura(html, id)).not.toContain('bg-secondary-background')
    }
  })

  it('o merge mora no cabeçalho e o conflito é vermelho', () => {
    const html = carregado({ mergeable: 'CONFLICTING' })
    const cabecalho = html.slice(
      html.indexOf('data-testid="pr-header"'),
      html.indexOf('data-testid="pr-checks"'),
    )

    expect(cabecalho).toContain('data-testid="pr-merge"')
    expect(abertura(html, 'pr-merge')).toContain('bg-danger')
  })

  it('mergeado leva o violeta da esteira; aberto, o selo neutro', () => {
    const mergeado = carregado({ state: 'MERGED', mergedAt: '2026-10-12T21:40:00Z' })

    expect(abertura(mergeado, 'pr-state')).toContain('bg-main')
    expect(mergeado).not.toContain('data-testid="pr-merge"')
    expect(abertura(carregado(), 'pr-state')).not.toContain('bg-main')
  })
})
