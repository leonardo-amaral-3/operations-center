import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O `## O invariante` do card #8, mais a canária de âncoras do CA-4.
 *
 * As proibições reprovam **a categoria** do erro — cor decidida no arquivo, casca copiada, token
 * fantasma —, e não as classes de cada componente: uma canária que congelasse `className` quebraria
 * a cada ajuste de padding e viraria ruído, que é o argumento que `board-readonly.test.ts:29` já
 * registra neste repo. Nenhuma delas tem opinião sobre espaçamento.
 */

interface Arquivo {
  caminho: string
  conteudo: string
}

/**
 * Recursivo porque a varredura precisa valer para uma subpasta que ainda não existe.
 *
 * Diretório renomeado ou movido joga `ENOENT` aqui, e isso é o que se quer: uma varredura sem o que
 * varrer passaria verde e não provaria nada.
 */
function lerArquivos(diretorioRelativo: string): Arquivo[] {
  const raiz = fileURLToPath(new URL(diretorioRelativo, import.meta.url))

  return readdirSync(raiz, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile())
    .map((entrada) => {
      const caminho = join(entrada.parentPath, entrada.name)

      return { caminho, conteudo: readFileSync(caminho, 'utf8') }
    })
}

/**
 * A Proibição 1 do `## O invariante`: nenhuma cor da paleta do Tailwind em arquivo do renderer.
 *
 * A cor do app é do tema, não do arquivo. **Sem exceção, nem para `ui/`** — e é essa ausência de
 * exceção que força as transformações do `## Implementation Details` sobre os vendorizados
 * (`focus-visible:ring-black` vira `focus-visible:ring-ring`) e que, no dia em que alguém trouxer
 * um sexto componente do registry, obriga a passagem por tokens antes de o teste voltar a verde.
 *
 * O que **passa**: `bg-main`, `bg-background`, `bg-secondary-background`, `text-foreground`,
 * `text-main-foreground`, `border-border`, `ring-ring`, `shadow-shadow`, `bg-attention`,
 * `bg-warning`, `bg-question`, `bg-danger`, e qualquer um deles com modificador de opacidade
 * (`text-foreground/60`). Nenhum desses nomes é família da paleta.
 */
const CLASSE_DE_PALETA =
  /\b(?:bg|text|border|ring|outline|shadow|fill|stroke|decoration|divide|accent|caret|from|via|to|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/g

/**
 * A raiz da varredura da Proibição 1 — escrita **num único ponto**, de propósito.
 *
 * O escopo final do CA-1 é todo o `src/renderer/`, mas ele só é alcançável depois que os
 * componentes forem recompostos: hoje `components/` e `screens/` ainda desenham em `bg-neutral-900`
 * e afins, e uma proibição vermelha desde o primeiro commit é uma proibição que alguém desliga.
 * Enquanto isso ela vale sobre os vendorizados, onde já é carga viva — é ela que prova que a cor
 * crua do registry virou token. Alargar para o escopo final é trocar esta linha por
 * `'../../src/renderer'`.
 */
const RAIZ_DA_PROIBICAO_1 = '../../src/renderer/ui'

describe('nenhum arquivo do renderer decide cor da paleta do Tailwind', () => {
  it(`não há utilitário de paleta em ${RAIZ_DA_PROIBICAO_1}`, () => {
    // Arquivo, linha e a classe encontrada: uma canária que só diz "falhou" custa a quem a encontra
    // vermelha mais do que resolve.
    const ocorrencias = lerArquivos(RAIZ_DA_PROIBICAO_1).flatMap(({ caminho, conteudo }) =>
      conteudo
        .split('\n')
        .flatMap((linha, indice) =>
          [...linha.matchAll(CLASSE_DE_PALETA)].map(
            (achado) => `${caminho}:${indice + 1} — ${achado[0]}`,
          ),
        ),
    )

    expect(ocorrencias).toEqual([])
  })
})

/**
 * A Proibição 3 do `## O invariante`: todo token de cor que a tela usa existe no tema.
 *
 * É a proibição que cobre um silêncio que nenhuma outra pega. Apagar `--color-attention` do
 * `@theme inline` **não quebra o build**: o Tailwind simplesmente deixa de emitir a classe
 * `bg-attention`, e o `StateBadge` de "Sua vez" perde o fundo sem um vermelho em lugar nenhum. Os
 * smokes tampouco pegariam `--color-danger`, que só aparece numa sessão que falhou.
 *
 * Por isso ela olha o **`@theme inline`**, e não o arquivo inteiro: é aquele bloco, e só ele, que
 * transforma variável CSS em utilitário do Tailwind. Um `--danger` vivo no `:root` mas ausente
 * dali é exatamente o token fantasma que se quer pegar.
 *
 * E é checagem de **existência, não de valor**: trocar o âmbar por outro âmbar é ajuste de design,
 * e uma canária com opinião sobre o oklch exato viraria ruído — o argumento que
 * `board-readonly.test.ts:29` já registra neste repo.
 */

const CAMINHO_DO_TEMA = fileURLToPath(new URL('../../src/renderer/index.css', import.meta.url))

/**
 * Os onze utilitários de cor que o app tem direito de escrever. São os mesmos onze que a lista "o
 * que passa" da Proibição 1 isenta da varredura de paleta: sete da casca do neobrutalism, quatro
 * dos estados de sessão que ele não tem.
 */
const TOKENS_DE_COR = [
  '--color-main',
  '--color-background',
  '--color-secondary-background',
  '--color-foreground',
  '--color-main-foreground',
  '--color-border',
  '--color-ring',
  '--color-attention',
  '--color-warning',
  '--color-question',
  '--color-danger',
]

/**
 * O corpo do `@theme inline`. Devolve `null` quando o bloco não existe — o que é um resultado, não
 * um acidente: o teste falha dizendo que o bloco sumiu, em vez de passar verde contra o vazio.
 */
function lerThemeInline(): string | null {
  const folha = readFileSync(CAMINHO_DO_TEMA, 'utf8')
  const bloco = /@theme inline\s*\{([\s\S]*?)\n\}/.exec(folha)

  return bloco?.[1] ?? null
}

describe('o tema declara todo token de cor que a tela pode usar', () => {
  it('o `@theme inline` existe em `src/renderer/index.css`', () => {
    // Sanidade da própria canária, antes de qualquer asserção sobre o conteúdo: arquivo movido ou
    // bloco renomeado não pode virar verde por não ter o que varrer.
    expect(lerThemeInline()).not.toBeNull()
  })

  it('os onze `--color-*` estão lá', () => {
    const bloco = lerThemeInline() ?? ''

    // O `:` faz parte da chave procurada de propósito: sem ele `--color-main` casaria com a
    // declaração de `--color-main-foreground` e a ausência do primeiro passaria despercebida.
    //
    // A falta é reportada **por nome**, e não como um booleano: uma canária que só diz "falhou"
    // custa a quem a encontra vermelha mais do que resolve.
    const ausentes = TOKENS_DE_COR.filter((token) => !bloco.includes(`${token}:`))

    expect(ausentes).toEqual([])
  })
})

/**
 * O CA-4 em forma de canária: as âncoras que os testes leem não se mexem.
 *
 * O risco específico deste card é perder um `data-*` numa recomposição de casca — quando um
 * `<article>` vira `<Card asChild>`, a âncora que estava no elemento pode ficar pelo caminho. É a
 * única forma de o CA-4 falhar **em silêncio**: os smokes que não cobrem aquele seletor seguem
 * verdes, e o que sumiu só aparece quando alguém for escrever o próximo teste.
 *
 * Três decisões dela, que mudam o que ela pega se forem ignoradas:
 *
 * 1. Ela congela **nomes de atributo**, e não pares atributo-valor: `data-column-name={column.name}`
 *    não tem valor literal para congelar, e o CA-4 fala de "os `data-*` seguem nos mesmos
 *    elementos", não de quais valores eles assumem.
 * 2. Ela varre `components/` e `screens/` e **exclui `ui/`**: senão o `data-slot` das primitivas
 *    entraria na lista e o congelamento passaria a depender de qual primitiva foi vendorizada.
 * 3. A lista foi **capturada da árvore**, e não transcrita da spec — e capturada **antes** de
 *    qualquer componente se mexer, que é o que a torna uma rede em vez de um carimbo.
 *
 * **O custo, declarado:** ela obriga quem acrescentar um `data-*` novo a vir declará-lo aqui. É o
 * mesmo pedágio que `board-readonly.test.ts:19` cobra de quem acrescenta um canal IPC, e pela mesma
 * razão: o portão é a revisão consciente, não a esperteza do teste.
 */

const DIRETORIOS_DE_ANCORA = ['../../src/renderer/components', '../../src/renderer/screens']

/**
 * As duas formas de escrever uma âncora, porque as duas existem nesta árvore: atributo JSX
 * (`data-testid="board-card"`) e **chave de objeto** (`'data-testid': 'board-card'`, o `anchors` do
 * `BoardCardView`). Uma regex que só visse a primeira deixaria as cinco âncoras do `BoardCardView`
 * de fora — justamente o arquivo onde `<article>` e `<button>` viram `<Card asChild>`, que é o caso
 * que esta canária existe para pegar.
 */
const ANCORA = /\b(data-[a-z-]+)['"]?\s*[=:]/g

/** A lista congelada: o que a árvore tinha no momento em que a rede foi armada. */
const ANCORAS = [
  'data-api-key-source',
  'data-card-assignees',
  'data-card-closed',
  'data-card-column',
  'data-card-number',
  'data-column-count',
  'data-column-id',
  'data-column-name',
  'data-label',
  'data-question',
  'data-read-at',
  'data-role',
  'data-selected',
  'data-stale',
  'data-state',
  'data-testid',
]

describe('as âncoras que os testes leem seguem onde estavam', () => {
  it('o conjunto de `data-*` de `components/` e `screens/` é o congelado', () => {
    const nomes = new Set<string>()

    for (const { conteudo } of DIRETORIOS_DE_ANCORA.flatMap(lerArquivos)) {
      for (const [, nome] of conteudo.matchAll(ANCORA)) {
        // O grupo 1 não é opcional — se casou, tem nome. O `if` é o preço de
        // `noUncheckedIndexedAccess`, não uma hipótese sobre a regex.
        if (nome !== undefined) nomes.add(nome)
      }
    }

    expect([...nomes].sort()).toEqual(ANCORAS)
  })
})
