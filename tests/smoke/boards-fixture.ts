/**
 * A coordenada que os smokes alimentam ao app, derivada da fixture da descoberta.
 *
 * Existe porque a fixture do board deixou de ser um envelope solto e virou um **mapa por
 * coordenada**: o app só encontra o board se lhe pedirem a chave certa, e nenhum smoke pode escrever
 * essa chave à mão — é a mesma regra que já proíbe fixar `b003f501` ou "o card #4 está em
 * Especificação". Aqui ela vale para o board inteiro.
 *
 * Fica num módulo compartilhado, e não copiado nos quatro specs como `toFixtureCard` e `required`
 * estão, por um motivo que não vale para aqueles: os quatro smokes têm de desenhar **o mesmo**
 * board, e quatro cópias de uma regra de ordenação é o número exato de cópias que dá para uma delas
 * envelhecer sozinha e o teste passar a provar outra coisa sem ninguém notar.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { runsEsteira } from '../../src/core/board/stations'

const REPO_ROOT = join(__dirname, '..', '..')

/** **Absolutos**, e é o ponto: o processo do Electron não roda com a `cwd` do runner. */
export const BOARDS_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'boards.json')
export const BOARD_FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'board.json')

/** Um board que a descoberta devolveria a partir de `boards.json`. */
export interface FixtureBoard {
  key: string
  owner: string
  number: number
  title: string
}

interface BoardsFixture {
  byOwner: Record<string, ProjectsEnvelope>
}

interface ProjectsEnvelope {
  data: {
    user: { projectsV2: ProjectList } | null
    organization: { projectsV2: ProjectList } | null
  }
}

interface ProjectList {
  nodes: readonly ProjectNode[]
}

interface ProjectNode {
  number?: number
  title?: string
  closed?: boolean
  owner?: { login?: string }
  field?: { options?: readonly { name: string }[] } | null
}

interface BoardFixture {
  boards: Record<string, BoardEnvelope | undefined>
}

/** O envelope do `BOARD_QUERY`: um dos dois aliases resolve, o outro vem nulo. */
interface BoardEnvelope {
  data: {
    user: { projectV2: unknown } | null
    organization: { projectV2: unknown } | null
  }
}

/**
 * A mesma ordem que o `BoardFinder` produz: alfabética pelo título em `pt-BR`, empate desfeito por
 * dono e depois por número.
 *
 * É a única parte da descoberta reescrita aqui, e é reescrita porque `find()` é assíncrono e o que
 * os specs precisam — a coordenada, e o envelope do board que ela endereça — é lido no topo do
 * módulo, antes de qualquer `await` existir. O **filtro**, que é a regra que decide de verdade quem
 * vira aba, não é reescrito: `runsEsteira` vem do core, o mesmo que o `BoardFinder` chama.
 */
const ORDEM = new Intl.Collator('pt-BR')

/** Os boards da esteira, na ordem da descoberta — derivados, nunca digitados. */
export const DISCOVERED: readonly FixtureBoard[] = discover()

/**
 * O board que o app desenha. Na Fase 0 é sempre o primeiro da ordem, porque não há aba lembrada — e
 * é por isso que os smokes o alimentam por `OC_PROJECT_OWNER`/`OC_PROJECT_NUMBER` enquanto essas
 * duas variáveis existem.
 */
export const FIRST_BOARD: FixtureBoard = required(
  DISCOVERED[0],
  'board nenhum da esteira em boards.json',
)

/**
 * O `projectV2` do board pedido, tirado do alias que resolveu.
 *
 * Sai como `unknown` de propósito: cada spec tem a sua própria visão do envelope — uns leem
 * `assignees`, outros só `optionId` — e é cada um que declara a forma que consome, como já fazia
 * quando lia o arquivo direto.
 */
export function fixtureProject(key: string): unknown {
  const arquivo = JSON.parse(readFileSync(BOARD_FIXTURE_PATH, 'utf8')) as BoardFixture
  const envelope = required(arquivo.boards[key], `sem envelope de board para ${key} em board.json`)

  return required(
    envelope.data.user?.projectV2 ?? envelope.data.organization?.projectV2,
    `o envelope de ${key} não trouxe projectV2 em nenhum dos dois aliases`,
  )
}

function discover(): readonly FixtureBoard[] {
  const arquivo = JSON.parse(readFileSync(BOARDS_FIXTURE_PATH, 'utf8')) as BoardsFixture

  const boards: FixtureBoard[] = []
  for (const envelope of Object.values(arquivo.byOwner)) {
    const lista = envelope.data.user?.projectsV2 ?? envelope.data.organization?.projectsV2
    for (const node of lista?.nodes ?? []) {
      const board = toBoard(node)
      if (board) boards.push(board)
    }
  }

  return boards.sort((a, b) => {
    const porTitulo = ORDEM.compare(a.title, b.title)
    if (porTitulo !== 0) return porTitulo

    const porDono = ORDEM.compare(a.owner, b.owner)
    if (porDono !== 0) return porDono

    return a.number - b.number
  })
}

function toBoard(node: ProjectNode): FixtureBoard | null {
  if (node.closed === true) return null
  if (!runsEsteira((node.field?.options ?? []).map((option) => option.name))) return null

  const { number, title } = node
  const owner = node.owner?.login
  if (number === undefined || title === undefined || owner === undefined) return null

  return { key: `${owner}/${number}`, owner, number, title }
}

function required<T>(value: T | undefined, missing: string): T {
  if (value === undefined) throw new Error(missing)

  return value
}
