import type { DecisaoDoDia, PainelDoDia, RevisaoNaSala } from '../../src/shared/fabrica'

/**
 * O "esperado F5" (#134, §F5.11) como literal: o painel que o main devolve para a `f5-cofre` em
 * 10/11/2026. Não importa `src/core`: o teste do renderer prova o renderer, não o core.
 */

function d(
  extra: Partial<DecisaoDoDia> & Pick<DecisaoDoDia, 'arquivo' | 'titulo' | 'secao'>,
): DecisaoDoDia {
  return {
    escopo: 'operations-center#122',
    card: 122,
    frente: 122,
    motivo: '',
    tipo: 'decisao',
    porque: 'porque sim. sob: mandato #1439.',
    descartado: null,
    objetivos: [],
    provisoria: false,
    reversivel: 'sim',
    sob: 'mandato #1439',
    ...extra,
  }
}

export const A1 = '2026-11-10-g2-da-f9-decidido-sob-mandato.md'
export const A2 = '2026-11-10-leitura-do-cofre-em-lotes-de-64.md'
export const A3 = '2026-11-10-o-relatorio-agrupa-pela-raiz-da-cadeia.md'
export const A4 = '2026-11-10-a-sala-le-o-mandato-pela-graphql.md'
export const A5 = '2026-11-10-pendencia-a-cor-do-cracha-da-pausa.md'
export const A6 = '2026-11-10-task-2-da-sala-entregue.md'
export const A7 = '2026-11-10-ajuste-de-texto-no-readme.md'
export const A8 = '2026-11-10-o-teto-de-sessoes-passa-a-3.md'
export const A9 = '2026-11-10-card-46-triado.md'

export const PAINEL_F5: PainelDoDia = {
  frases: [{ card: 120, texto: 'O relatório do dia passou a agrupar pela raiz da cadeia.' }],
  decisoes: [
    d({
      arquivo: A9,
      titulo: 'Card #46 triado: Melhoria, S3, Padrão, Rota Curta',
      secao: 'sem-repo',
      escopo: '46',
      card: null,
      frente: null,
      motivo: 'escopo sem repo',
      porque: 'reversível: sim.',
      sob: null,
    }),
    d({
      arquivo: A7,
      titulo: 'Ajuste de texto no README da sala',
      secao: 'rotina',
      porque: 'reversível: sim.',
      sob: null,
    }),
    d({
      arquivo: A1,
      titulo: 'G2 da F9 decidido sob mandato: spec em profundidade Lite',
      secao: 'chave',
      card: 118,
      frente: 118,
      motivo: 'portão G2',
      objetivos: ['P3'],
      descartado: 'Profundidade Completa: sem formato novo em disco.',
    }),
    d({
      arquivo: A5,
      titulo: 'Pendência: a cor do crachá da pausa fica com o Leonardo',
      secao: 'estacionada',
      tipo: 'pendencia',
      objetivos: ['P3'],
      porque: 'objetivo: P3. reversível: sim.',
      sob: null,
    }),
    d({
      arquivo: A6,
      titulo: 'Task 2 da sala entregue no commit abc1234',
      secao: 'rotina',
      objetivos: ['P3'],
    }),
    d({
      arquivo: A2,
      titulo: 'A leitura do cofre vai em lotes de 64 arquivos',
      secao: 'provisoria',
      card: 120,
      frente: 120,
      objetivos: ['P1'],
      provisoria: true,
    }),
    d({
      arquivo: A3,
      titulo: 'O relatório agrupa as frentes pela raiz da cadeia de sub-issues',
      secao: 'provisoria',
      card: 120,
      frente: 120,
      objetivos: ['P1'],
      provisoria: true,
      reversivel: 'nao',
      descartado: 'Agrupar pelo card do escopo.',
    }),
    d({
      arquivo: A4,
      titulo: 'A sala lê o mandato da dev pela GraphQL',
      secao: 'provisoria',
      objetivos: ['P3'],
      provisoria: true,
      card: 122,
      frente: 122,
    }),
    d({
      arquivo: A8,
      titulo: 'O teto de sessões passa a 3',
      secao: 'desvio',
      card: 121,
      frente: 121,
      objetivos: ['P2'],
    }),
  ].sort((a, b) => a.arquivo.localeCompare(b.arquivo, 'en')),
  porRepo: [
    { repo: 'operations-center', decisoes: 8 },
    { repo: 'claude-brain', decisoes: 2 },
    { repo: 'extractor', decisoes: 1 },
  ],
  noCofre: 12,
  commits: 3,
  objetivos: [
    { codigo: 'P0', nome: 'Fundação' },
    { codigo: 'P1', nome: 'O relatório' },
    { codigo: 'P2', nome: 'O despachante' },
    { codigo: 'P3', nome: 'A interface' },
  ],
}

export const REVISAO_A4: RevisaoNaSala = {
  arquivo: A4,
  veredito: 'confirmada',
  em: '2026-11-10T21:00:00.000Z',
  motivo: null,
  atendida: null,
}
