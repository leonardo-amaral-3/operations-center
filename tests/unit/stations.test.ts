import { describe, expect, it } from 'vitest'

import {
  CONVERSABLE_STATIONS,
  ESTEIRA_STATIONS,
  TRIAGE_STATION,
} from '../../src/core/board/query'
import { isTriage, normalizeStation, runsEsteira } from '../../src/core/board/stations'

/**
 * A regra de discriminação do CA-1, sozinha e sem quem a consuma.
 *
 * Ela é testada contra os conjuntos de `Status` que **existem de verdade** — medidos em 2026-09-07
 * nos 16 Projects que o token enxerga — e não contra um cenário inventado. É a diferença entre
 * provar que o filtro funciona e provar que ele funciona no dia em que o app abrir.
 */

/** Como o board de verdade decora os rótulos: emoji na frente, acento no meio. */
const ESTEIRA_DECORADA = [
  '📥 Triagem',
  '📋 Backlog',
  '🎯 Especificação',
  '🔨 Implementação',
  '👀 Revisão',
  '🧪 Validação em Dev',
  '🚂 Release',
  '✅ Produção',
]

/** Os três conjuntos que os outros 14 Projects declaram — o legado é o do `Módulos Legados`. */
const TODO_IN_PROGRESS_DONE = ['Todo', 'In Progress', 'Done']
const BACKLOG_READY_DONE = ['Backlog', 'Ready', 'In progress', 'In review', 'Done']
const LEGADO = ['Backlog', 'A Fazer', 'Em andamento', 'Revisão de código']

describe('runsEsteira — a assinatura que decide se um Project vira aba', () => {
  it('reconhece a esteira decorada com emoji e acento, como o board a declara', () => {
    expect(runsEsteira(ESTEIRA_DECORADA)).toBe(true)
  })

  it('reconhece a esteira crua, sem decoração nenhuma', () => {
    expect(runsEsteira([...ESTEIRA_STATIONS])).toBe(true)
  })

  it('tolera coluna extra — a comparação é subconjunto, não igualdade', () => {
    // Uma coluna nova é decisão do dono do board. Se isto virasse `false`, a aba sumiria da tela em
    // silêncio no dia em que alguém acrescentasse `🧊 Congelado` ao Project.
    expect(runsEsteira([...ESTEIRA_DECORADA, '🧊 Congelado'])).toBe(true)
  })

  it('recusa o board que tem as 6 conversáveis mas não as 8 da norma', () => {
    // O caso que a decisão #204 corrigiu: as 6 conversáveis iriam de Triagem a Release e deixariam
    // passar um board sem Validação em Dev nem Produção — que não roda a esteira.
    const seisConversaveis = ESTEIRA_DECORADA.filter(
      (name) => !['validacao em dev', 'producao'].includes(normalizeStation(name)),
    )

    expect(seisConversaveis).toHaveLength(6)
    expect(runsEsteira(seisConversaveis)).toBe(false)
  })

  it('recusa cada estação que falte, uma de cada vez', () => {
    for (const ausente of ESTEIRA_DECORADA) {
      const incompleto = ESTEIRA_DECORADA.filter((name) => name !== ausente)

      expect(runsEsteira(incompleto), `sem ${ausente}`).toBe(false)
    }
  })

  it('recusa os conjuntos de Status que os outros 14 Projects declaram', () => {
    expect(runsEsteira(TODO_IN_PROGRESS_DONE)).toBe(false)
    expect(runsEsteira(BACKLOG_READY_DONE)).toBe(false)
    expect(runsEsteira(LEGADO)).toBe(false)
  })

  it('recusa a lista vazia — board sem campo `Status` não roda esteira nenhuma', () => {
    expect(runsEsteira([])).toBe(false)
  })
})

describe('isTriage — a estação de entrada, e só ela', () => {
  it('reconhece a triagem em qualquer decoração que o board lhe dê', () => {
    // As três formas que existem: como o board decora, como a norma nomeia, e como alguém digita.
    expect(isTriage('📥 Triagem')).toBe(true)
    expect(isTriage('Triagem')).toBe(true)
    expect(isTriage('triagem')).toBe(true)
  })

  it('recusa cada uma das outras sete estações da esteira', () => {
    // Nomeadamente 'Backlog' e '🧪 Validação em Dev', mas o laço vale mais que os dois: é ele que
    // pega o dia em que uma estação nova entrar na norma e a régua passar a aceitá-la por descuido.
    for (const outra of ESTEIRA_DECORADA.filter((name) => !isTriage(name))) {
      expect(isTriage(outra), outra).toBe(false)
    }

    expect(ESTEIRA_DECORADA.filter((name) => isTriage(name))).toEqual(['📥 Triagem'])
  })

  it('recusa o nome que apenas contém `triagem` — a comparação é do nome inteiro', () => {
    // 'Pré-triagem' normaliza para 'pre-triagem', e uma régua de prefixo ou de `includes` a
    // aceitaria: duas colunas ofereceriam a nova triagem no mesmo board.
    expect(isTriage('Pré-triagem')).toBe(false)
    expect(isTriage('Triagem técnica')).toBe(false)
  })

  it('recusa o rótulo vazio — coluna sem nome não é estação nenhuma', () => {
    expect(isTriage('')).toBe(false)
    expect(isTriage('📥')).toBe(false)
  })
})

describe('as duas listas de estação não podem divergir', () => {
  it('toda estação conversável é uma estação da esteira', () => {
    // Sem esta amarra, uma edição distraída em `CONVERSABLE_STATIONS` faria o app admitir um board
    // que não conversa em coluna nenhuma: a aba abriria, e nenhum cartão teria chat.
    const daEsteira = new Set(ESTEIRA_STATIONS.map(normalizeStation))
    const forasteiras = CONVERSABLE_STATIONS.filter(
      (station) => !daEsteira.has(normalizeStation(station)),
    )

    expect(forasteiras).toEqual([])
  })

  it('a estação da triagem é uma das 8, e é conversável', () => {
    // `TRIAGE_STATION` é uma quarta cópia do mesmo nome. Sem esta amarra, renomear a estação na
    // norma sem renomeá-la aqui faria `isTriage` deixar de casar com coluna nenhuma **em silêncio**
    // — e o botão da nova triagem simplesmente não apareceria em board nenhum.
    expect(ESTEIRA_STATIONS.map(normalizeStation)).toContain(normalizeStation(TRIAGE_STATION))
    expect(CONVERSABLE_STATIONS.map(normalizeStation)).toContain(normalizeStation(TRIAGE_STATION))
  })

  it('as conversáveis são menos que as 8 — a esteira tem estação sem skill', () => {
    // Sanidade da amarra acima: se as duas listas fossem iguais, o `toEqual([])` passaria verde
    // provando nada. 🧪 Validação em Dev é checklist humano e ✅ Produção já aconteceu.
    expect(CONVERSABLE_STATIONS.length).toBeLessThan(ESTEIRA_STATIONS.length)
  })
})
