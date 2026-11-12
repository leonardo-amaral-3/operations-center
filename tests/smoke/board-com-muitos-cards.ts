import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { BOARD_FIXTURE_PATH, FIRST_BOARD } from './boards-fixture'
import {
  CHAVE_DO_BOARD_DA_FABRICA,
  REPO_DOS_CARDS_DA_FABRICA,
  estacaoDaColuna,
} from '../../src/renderer/fabrica/boardDaFabrica'
import { colunaDaLinhaDoBoard } from '../../src/renderer/fabrica/linhaDoBoard'

/**
 * O board da fixture com N cards sintéticos a mais em cada uma de quatro colunas (#149): Triagem,
 * Backlog, Validação em Dev e Release. Só leitura da fixture: grava a cópia em `<pasta>/board.json`
 * e devolve o caminho, para o smoke passar ao app por `OC_BOARD_FIXTURE`.
 */

export interface BoardComMuitosCards {
  caminho: string
  porColuna: { triagem: number[]; backlog: number[]; validacao: number[]; release: number[] }
  nomeDaColuna: { triagem: string; backlog: string; validacao: string; release: string }
}

interface Opcao {
  id: string
  name: string
}

interface Projeto {
  field: { options: Opcao[] }
  items: { nodes: unknown[] }
}

interface Arquivo {
  boards: Record<
    string,
    {
      data: { user?: { projectV2?: Projeto } | null; organization?: { projectV2?: Projeto } | null }
    }
  >
}

export function boardComMuitosCards(pasta: string, n: number): BoardComMuitosCards {
  if (CHAVE_DO_BOARD_DA_FABRICA !== FIRST_BOARD.key) {
    throw new Error(
      `a Sala lê a aba ativa (${FIRST_BOARD.key}) e o Briefing e o Release leem ${CHAVE_DO_BOARD_DA_FABRICA}: leriam boards diferentes`,
    )
  }
  const arquivo = JSON.parse(readFileSync(BOARD_FIXTURE_PATH, 'utf8')) as Arquivo
  const env = arquivo.boards[CHAVE_DO_BOARD_DA_FABRICA]
  const projeto = env?.data.user?.projectV2 ?? env?.data.organization?.projectV2
  if (projeto === undefined || projeto === null) {
    throw new Error(`a fixture do board não tem o projeto de ${CHAVE_DO_BOARD_DA_FABRICA}`)
  }

  const achar = (rotulo: string, serve: (nome: string) => boolean): Opcao => {
    const opcao = projeto.field.options.find((o) => serve(o.name))
    if (opcao === undefined) throw new Error(`a fixture do board não tem a coluna ${rotulo}`)
    return opcao
  }
  const opcoes = {
    triagem: achar('triagem', (nome) => estacaoDaColuna(nome) === 'triagem'),
    backlog: achar('backlog', (nome) => estacaoDaColuna(nome) === 'backlog'),
    validacao: achar('validacao', (nome) => colunaDaLinhaDoBoard(nome) === 'validacao'),
    release: achar('release', (nome) => estacaoDaColuna(nome) === 'release'),
  }

  const porColuna: BoardComMuitosCards['porColuna'] = {
    triagem: [],
    backlog: [],
    validacao: [],
    release: [],
  }
  let numero = 6001
  for (const coluna of ['triagem', 'backlog', 'validacao', 'release'] as const) {
    const opcao = opcoes[coluna]
    for (let i = 0; i < n; i++) {
      projeto.items.nodes.push({
        id: `PVTI_rolagem_${numero}`,
        content: {
          __typename: 'Issue',
          number: numero,
          title: `Sintético da rolagem ${numero}: título de tamanho realista para quebrar linha`,
          url: `https://github.com/${REPO_DOS_CARDS_DA_FABRICA}/issues/${numero}`,
          closed: false,
          repository: { nameWithOwner: REPO_DOS_CARDS_DA_FABRICA },
          assignees: { nodes: [] },
        },
        fieldValues: {
          nodes: [{ optionId: opcao.id, name: opcao.name, field: { name: 'Status' } }],
        },
      })
      porColuna[coluna].push(numero)
      numero++
    }
  }

  const caminho = join(pasta, 'board.json')
  writeFileSync(caminho, JSON.stringify(arquivo, null, 2))
  return {
    caminho,
    porColuna,
    nomeDaColuna: {
      triagem: opcoes.triagem.name,
      backlog: opcoes.backlog.name,
      validacao: opcoes.validacao.name,
      release: opcoes.release.name,
    },
  }
}
