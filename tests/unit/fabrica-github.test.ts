import { describe, expect, it, vi } from 'vitest'
import { boardPadrao } from '../../src/core/fabrica/configuracao'
import { MANDATO_QUERY } from '../../src/core/fabrica/mandato'
import { configuracaoDaFabrica } from '../../src/main/fabrica/configuracao'
import {
  caminhoDoMandato,
  lerMandatoDoBoard,
  lerMandatoPelaGraphQL,
} from '../../src/main/fabrica/github'

const board = boardPadrao(configuracaoDaFabrica('/home/u'))
const origem = board.mandato!

describe('a origem do mandato do operations-center é a de hoje', () => {
  it('o caminho do gh api', () => {
    expect(caminhoDoMandato(origem)).toBe(
      'repos/leonardo-amaral-3/operations-center/contents/fabrica/MANDATO.md?ref=dev',
    )
  })

  it('a GraphQL pede a query com as variáveis de hoje', async () => {
    const graphql = vi.fn().mockResolvedValue({ data: { repository: { object: { text: 'M' } } } })
    expect(await lerMandatoPelaGraphQL(graphql, origem)).toBe('M')
    expect(graphql).toHaveBeenCalledWith(MANDATO_QUERY, {
      owner: 'leonardo-amaral-3',
      name: 'operations-center',
      expressao: 'dev:fabrica/MANDATO.md',
    })
  })
})

describe('lerMandatoDoBoard', () => {
  it('board sem mandato rejeita com a mensagem do CA-2 e não chama a rede', async () => {
    const graphql = vi.fn()
    await expect(lerMandatoDoBoard(graphql, { ...board, mandato: null })).rejects.toThrow(
      'o board leonardo-amaral-3/2 (Operations Center) não tem mandato aprovado: falta o campo mandato em fabrica/boards.json',
    )
    expect(graphql).not.toHaveBeenCalled()
  })

  it('board com mandato delega e devolve o texto', async () => {
    const graphql = vi.fn().mockResolvedValue({ data: { repository: { object: { text: 'T' } } } })
    expect(await lerMandatoDoBoard(graphql, board)).toBe('T')
    expect(graphql).toHaveBeenCalledTimes(1)
  })
})
