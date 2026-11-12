import { describe, expect, it } from 'vitest'

import { argsDoGitLog, lerCommits } from '../../src/core/relatorio/git'
import type { Janela } from '../../src/core/relatorio/tipos'

const janela: Janela = {
  dia: '2026-11-10',
  inicio: '2026-11-10T00:00:00Z',
  fim: '2026-11-11T00:00:00Z',
}

/** Um registro com a forma real do `git log`: o `\n` vem depois de cada `\x1e`. */
function registro(sha: string, em: string, assunto: string, corpo = ''): string {
  return `${sha}\x1f${em}\x1f${assunto}\x1f${corpo}\x1e\n`
}

describe('argsDoGitLog', () => {
  it('devolve os argumentos exatos', () => {
    expect(argsDoGitLog(janela)).toEqual([
      'log',
      '--branches',
      '--remotes',
      '--since=2026-11-10T00:00:00Z',
      '--until=2026-11-11T00:00:00Z',
      '--format=%H%x1f%cI%x1f%s%x1f%b%x1e',
    ])
  })
})

describe('lerCommits', () => {
  it('tira o \\n que o git põe depois de cada \\x1e do sha', () => {
    const stdout =
      registro('aaa', '2026-11-10T10:00:00-03:00', 'Um') +
      registro('bbb', '2026-11-10T11:00:00-03:00', 'Dois')

    expect(lerCommits(stdout, janela).map((c) => c.sha)).toEqual(['aaa', 'bbb'])
  })

  it('devolve vazio para stdout vazio', () => {
    expect(lerCommits('', janela)).toEqual([])
    expect(lerCommits('\n', janela)).toEqual([])
  })

  it('acha o card pelo trailer, antes do Co-Authored-By', () => {
    const corpo = 'Texto.\n\nCard: #114\nCo-Authored-By: Alguém <a@b.c>\n'
    const [c] = lerCommits(registro('aaa', '2026-11-10T10:00:00-03:00', 'Fix', corpo), janela)

    expect(c?.card).toBe(114)
  })

  it('acha o card nos merges de PR, de branch e da dev para a branch do card', () => {
    const em = '2026-11-10T10:00:00-03:00'
    const stdout =
      registro('a1', em, 'Merge pull request #116 from o/fix/114-x') +
      registro('a2', em, "Merge branch 'feat/119-claude-posix' into feat/119-fundacao-linux") +
      registro('a3', em, "Merge remote-tracking branch 'origin/dev' into feat/27-nova-triagem") +
      registro('a4', em, 'Merge pull request #117 from o/dev')

    expect(lerCommits(stdout, janela).map((c) => c.card)).toEqual([114, 119, 27, null])
  })

  it('o trailer ganha do assunto de merge', () => {
    const [c] = lerCommits(
      registro(
        'a1',
        '2026-11-10T10:00:00-03:00',
        'Merge pull request #1 from o/fix/5-x',
        'Card: #9',
      ),
      janela,
    )

    expect(c?.card).toBe(9)
  })

  it('a janela é meio-aberta: o fim exato sai e o início exato entra', () => {
    const stdout =
      registro('ini', '2026-11-09T21:00:00-03:00', 'No início') +
      registro('fim', '2026-11-10T21:00:00-03:00', 'No fim') +
      registro('dentro', '2026-11-10T20:59:59-03:00', 'Dentro') +
      registro('antes', '2026-11-09T20:59:59-03:00', 'Antes')

    expect(lerCommits(stdout, janela).map((c) => c.sha)).toEqual(['ini', 'dentro'])
  })

  it('não repete sha e deixa passar o commit de sha vazio', () => {
    const em = '2026-11-10T10:00:00-03:00'
    const stdout =
      registro('aaa', em, 'Um') + registro('aaa', em, 'Um') + registro('', em, 'Sem sha')

    const commits = lerCommits(stdout, janela)

    expect(commits.map((c) => c.sha)).toEqual(['aaa', ''])
  })
})
