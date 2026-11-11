import type { Fonte, Frente, Linha, Relatorio, Secao } from './tipos'

/**
 * O relatório em markdown (#120, spec-p1 §7).
 *
 * Nenhum escape: o texto do cofre já é markdown. A regra que vence as outras é que o resultado nunca
 * tem duas linhas vazias seguidas nem linha só de espaços, e termina com um único `\n`.
 */

function fonteEmTexto(f: Fonte): string {
  switch (f.tipo) {
    case 'cofre':
      return `cofre \`${f.rotulo}\``
    case 'git':
      return `git \`${f.rotulo}\``
    case 'direcao':
      return `\`${f.rotulo}\``
    case 'card':
    case 'commit':
    case 'board':
      return f.url === null ? f.rotulo : `[${f.rotulo}](${f.url})`
  }
}

/** Toda linha não vazia ganha 2 espaços; a vazia de dentro do detalhe continua vazia. */
const recuar = (detalhe: string): string =>
  detalhe
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : `  ${l}`))
    .join('\n')

function lista(linhas: readonly Linha[]): string {
  let saida = ''

  linhas.forEach((l, i) => {
    const fontes = l.fontes.map(fonteEmTexto).join(', ')
    const item = [`- ${l.texto} — fonte: ${fontes}`, ...l.detalhes.map(recuar)].join('\n\n')

    if (i > 0) {
      // Depois de um item com detalhes vem uma linha vazia antes do próximo.
      saida += linhas[i - 1]?.detalhes.length === 0 ? '\n' : '\n\n'
    }
    saida += item
  })

  return saida
}

const TITULOS: Readonly<Record<Exclude<Secao, 'frase'>, string>> = {
  chave: 'Decisões-chave',
  provisorias: 'Provisórias',
  estacionadas: 'Estacionadas',
  desvios: 'Desvios',
  resto: 'Resto contado',
}

function blocosDaFrente(f: Frente): string[] {
  const blocos = [`## ${f.titulo}`, '### Frase do dia']

  if (f.secoes.frase.length > 0) blocos.push(lista(f.secoes.frase))

  for (const secao of ['chave', 'provisorias', 'estacionadas', 'desvios', 'resto'] as const) {
    const linhas = f.secoes[secao]
    const n = secao === 'resto' ? f.restoContado : linhas.length

    blocos.push(`### ${TITULOS[secao]} (${n})`)
    if (linhas.length > 0) blocos.push(lista(linhas))
  }

  return blocos
}

export function emMarkdown(r: Relatorio, geradoEm: string): string {
  const blocos = [
    `# Relatório do dia ${r.janela.dia} · ${r.repo.owner}/${r.repo.name}`,
    `Dia em UTC, o mesmo do campo \`data\` do cofre: de ${r.janela.inicio} a ${r.janela.fim}. Gerado em ${geradoEm}.`,
    '## Contagem',
  ]

  if (r.contagem.length > 0) blocos.push(lista(r.contagem))
  for (const f of r.frentes) blocos.push(...blocosDaFrente(f))
  if (r.ilegiveis.length > 0) {
    blocos.push(`## Arquivos do cofre que não deram para ler (${r.ilegiveis.length})`)
    blocos.push(lista(r.ilegiveis))
  }

  const texto = blocos
    .join('\n\n')
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')

  return `${texto.trimEnd()}\n`
}
