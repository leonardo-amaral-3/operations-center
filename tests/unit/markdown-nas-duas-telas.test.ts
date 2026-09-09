import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Duas canárias no mesmo arquivo, porque as duas guardam a mesma coisa: a **fiação** do markdown.
 *
 * O que o markdown renderizado tem de certo — os elementos, o sanitize, a escala — já está provado
 * em `tests/renderer/MessageBubble.test.tsx`, contra o componente de verdade. O que nenhum teste de
 * componente alcança é o outro lado: se as telas **chamam** aquela bolha, e se o main ainda tem a
 * guarda pendurada. As duas coisas se desfazem em silêncio — uma tela nova nasce com texto cru, uma
 * refatoração do `createWindow` leva a guarda junto — e nas duas o app fica errado sem nenhum teste
 * ficar vermelho.
 *
 * Varredura textual, então, como em `ipc-no-path.test.ts`: canária não prova que hoje está certo,
 * avisa no dia em que deixar de estar.
 */

const RAIZ = new URL('../../', import.meta.url)

function lerFonte(caminho: string): string {
  return readFileSync(fileURLToPath(new URL(caminho, RAIZ)), 'utf8')
}

/** Os dois componentes que desenham conversa hoje. Um terceiro que apareça entra aqui. */
const TELAS = [
  'src/renderer/components/Conversation.tsx',
  'src/renderer/components/Chat.tsx',
] as const

describe('as duas telas desenham a fala pela mesma bolha', () => {
  it('a varredura leu as duas telas de verdade', () => {
    // Sanidade da canária: um caminho errado devolveria erro, mas um arquivo esvaziado passaria
    // verde em todas as asserções abaixo provando nada. A âncora do smoke é o que prova que é tela.
    for (const tela of TELAS) {
      expect(lerFonte(tela), tela).toContain('data-testid="message"')
    }
  })

  it('nenhuma das duas guarda um render de texto cru', () => {
    // `whitespace-pre-wrap` era a marca do parágrafo que cuspia o markdown como caractere. Ele sair
    // das duas de uma vez é o critério do card inteiro; ele **voltar** a qualquer uma delas é a
    // regressão que esta linha existe para pegar.
    const comTextoCru = TELAS.filter((tela) => lerFonte(tela).includes('whitespace-pre-wrap'))

    expect(comTextoCru).toEqual([])
  })

  it('as duas montam a fala com <MessageBubble>', () => {
    const semBolha = TELAS.filter((tela) => !lerFonte(tela).includes('MessageBubble'))

    expect(semBolha).toEqual([])
  })

  it('exatamente um arquivo do renderer importa o react-markdown', () => {
    const arquivos = readdirSync(fileURLToPath(new URL('src/renderer/', RAIZ)), {
      recursive: true,
      encoding: 'utf8',
    }).filter((arquivo) => arquivo.endsWith('.tsx') || arquivo.endsWith('.ts'))

    // Sanidade da varredura: um glob que deixasse de casar acharia zero importadores e passaria
    // verde. O renderer tem mais de uma dúzia de arquivos — dois é piso folgado.
    expect(arquivos.length).toBeGreaterThan(2)

    const importadores = arquivos.filter((arquivo) =>
      lerFonte(`src/renderer/${arquivo.replaceAll('\\', '/')}`).includes("from 'react-markdown'"),
    )

    // A lista inteira na asserção, e não só o tamanho: no dia em que uma segunda tela importar o
    // renderizador direto — e com ele o pipeline de sanitize por conta própria —, a falha já diz
    // qual arquivo é. O único ponto de controle do CA-6 é o `Markdown.tsx`, e ele é um só.
    expect(importadores).toEqual([expect.stringContaining('Markdown.tsx')])
  })
})

describe('a guarda de navegação continua pendurada no main', () => {
  // `navigation.test.ts` prova os veredictos; nada prova que alguém os escuta. Sem estas três
  // palavras no `createWindow`, um link clicado leva a janela do app embora (CA-5) e o único teste
  // que existiria continuaria verde.
  const FIACAO = ['setWindowOpenHandler', "'will-navigate'", 'judgeNavigation'] as const

  it('o main pendura as duas portas e julga as duas com judgeNavigation', () => {
    const fonte = lerFonte('src/main/index.ts')
    const faltando = FIACAO.filter((peca) => !fonte.includes(peca))

    expect(faltando).toEqual([])
  })
})
