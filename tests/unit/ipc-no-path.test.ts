import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A invariante de segurança do RF-10 em forma de teste, no espírito de `board-readonly.test.ts`.
 *
 * O renderer roda com `contextIsolation` e `sandbox` justamente para não poder apontar um Claude
 * Code — que escreve em disco — para qualquer lugar da máquina. Essa garantia não mora numa flag do
 * Electron: mora no **formato das cargas**, porque um único campo `path: string` num request a
 * desfaria inteira sem quebrar nada visível. Quem manda cartão manda `itemId`; quem traduz `itemId`
 * em pasta é o main, com o retrato de board que ele mesmo tem.
 *
 * Por isso a varredura é textual e sobre o arquivo do contrato: ela pega o campo novo em qualquer
 * carga, inclusive numa que ainda não existe. Uma canária não prova que hoje está certo — ela avisa
 * no dia em que deixar de estar.
 */

const CONTRATO = fileURLToPath(new URL('../../src/shared/ipc.ts', import.meta.url))

/**
 * O vocabulário de caminho. São os nomes que um campo de sistema de arquivos teria de verdade —
 * `path`, `cwd`, `dir`/`directory`, `folder`, `file` —, comparados dentro do nome do campo para
 * pegar também `repoPath`, `workingDir` e companhia.
 */
const VOCABULARIO_DE_CAMINHO = /path|cwd|dir|folder|file/i

/**
 * `OcApi` fica de fora, e é a única exceção: ali os nomes são de **método**, não de campo de carga —
 * `chooseFolder` é o nome do canal que abre o seletor, e proibi-lo seria proibir a própria feature.
 * O que aquele método carrega é `ChooseFolderRequest`/`ChooseFolderResult`, e esses a varredura lê.
 */
const FORA_DA_VARREDURA = ['OcApi']

interface Carga {
  nome: string
  campos: string[]
}

/**
 * As interfaces do contrato, com os campos de cada uma.
 *
 * Regex e não parser de TypeScript: as cargas do contrato são objetos rasos de propriedades simples,
 * e um parser aqui seria mais superfície para manter do que a coisa que ele verifica. A sanidade
 * abaixo é o que impede a varredura de virar verde por ter deixado de casar.
 */
function lerCargas(): Carga[] {
  const fonte = readFileSync(CONTRATO, 'utf8')
  const cargas: Carga[] = []

  for (const bloco of fonte.matchAll(/export interface (?<nome>\w+)\s*\{(?<corpo>[^}]*)\}/g)) {
    const nome = bloco.groups?.['nome']
    const corpo = bloco.groups?.['corpo']
    if (nome === undefined || corpo === undefined || FORA_DA_VARREDURA.includes(nome)) continue

    // Comentário fora antes de procurar campo: a prosa desta spec fala de pasta e de caminho o
    // tempo todo, e canária que dispara com comentário é canária que alguém desliga.
    const semComentarios = corpo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const campos = [...semComentarios.matchAll(/^\s*(?:readonly\s+)?(?<campo>\w+)\??\s*:/gm)].map(
      (campo) => campo.groups?.['campo'] ?? '',
    )

    cargas.push({ nome, campos })
  }

  return cargas
}

describe('nenhum caminho de disco atravessa a ponte', () => {
  const cargas = lerCargas()

  it('a varredura encontrou as cargas que o contrato declara', () => {
    // Sanidade da própria canária: um contrato reformatado que deixasse a regex sem casar passaria
    // verde provando nada. Estas são as cargas de ida e volta de cada `invoke` de hoje.
    const nomes = cargas.map((carga) => carga.nome)

    expect(nomes).toEqual(
      expect.arrayContaining([
        'SessionSnapshot',
        'StartRequest',
        'SendRequest',
        'RespondPermissionRequest',
        'AnswerQuestionRequest',
        'StopRequest',
        'CloseRequest',
        'ChooseFolderRequest',
        'ChooseFolderResult',
      ]),
    )
    expect(cargas.every((carga) => carga.campos.length > 0)).toBe(true)
  })

  it('nenhum campo de carga tem nome de caminho de sistema de arquivos', () => {
    const suspeitos = cargas.flatMap((carga) =>
      carga.campos
        .filter((campo) => VOCABULARIO_DE_CAMINHO.test(campo))
        .map((campo) => `${carga.nome}.${campo}`),
    )

    expect(suspeitos).toEqual([])
  })

  it('a escolha de pasta responde só se houve escolha, e não qual foi', () => {
    // O caso concreto que a invariante quase perdeu: seria natural devolver a string escolhida, e
    // ela não teria uso nenhum do lado de lá — quem guarda e usa a pasta é o main. O `cwd` que o
    // cartão exibe (CA-3) vem do `init` que o próprio SDK reporta, e por definição é o real.
    const resultado = cargas.find((carga) => carga.nome === 'ChooseFolderResult')

    expect(resultado?.campos).toEqual(['chosen'])
  })

  it('para começar uma sessão o renderer manda cartão, não pasta', () => {
    const pedido = cargas.find((carga) => carga.nome === 'StartRequest')

    expect(pedido?.campos).toEqual(['itemId'])
  })
})
