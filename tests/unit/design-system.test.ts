import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { contrastRatio, oklchToSrgb, type Rgb8 } from '../../src/main/color'
import { parseOklch, parseThemes } from '../../src/main/sheet'
import { THEME_DEFAULT, THEMES, type Theme } from '../../src/shared/theme'

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
 * varrer passaria verde e não provaria nada. O `ENOENT` cobre a pasta que **sumiu**; a pasta que
 * ficou mas deixou de ter fonte é o que a guarda lá embaixo cobre.
 *
 * Só `.ts` e `.tsx`, porque é disso que as duas proibições falam: `index.css` é o arquivo que
 * *declara* os tokens e é lido à parte pela Proibição 3.
 */
function lerArquivos(diretorioRelativo: string): Arquivo[] {
  const raiz = fileURLToPath(new URL(diretorioRelativo, import.meta.url))

  return readdirSync(raiz, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && /\.tsx?$/.test(entrada.name))
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
 * A raiz da varredura — escrita **num único ponto**, de propósito.
 *
 * Ela nasceu apontando só para `ui/`, porque uma proibição vermelha desde o primeiro commit é uma
 * proibição que alguém desliga: enquanto `components/` e `screens/` ainda desenhavam em
 * `bg-neutral-900`, o único lugar onde ela era carga viva eram os vendorizados. Recomposta a
 * última superfície, o ponto único virou uma linha só a trocar, e o escopo agora é o final do
 * CA-1: **todo** o `src/renderer/`.
 *
 * É essa varredura, e não a tabela do `## File Change Summary`, que governa o arquivo que ainda vai
 * nascer — foi ela que cobrou o `ToolEntry` e o `TurnPulse` que o card #14 trouxe depois da
 * aprovação da spec.
 */
const RAIZ_DA_VARREDURA = '../../src/renderer'

describe('nenhum arquivo do renderer decide cor da paleta do Tailwind', () => {
  it(`não há utilitário de paleta em ${RAIZ_DA_VARREDURA}`, () => {
    // Arquivo, linha e a classe encontrada: uma canária que só diz "falhou" custa a quem a encontra
    // vermelha mais do que resolve.
    const ocorrencias = lerArquivos(RAIZ_DA_VARREDURA).flatMap(({ caminho, conteudo }) =>
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
 * A Proibição 2 do `## O invariante`: a receita de casca só existe nas primitivas.
 *
 * `border-2` **e** `shadow-shadow` na mesma linha *é* a casca do design system, e escrevê-la à mão
 * é exatamente o que este card manda parar de fazer. Fora de `ui/`, quem precisa de uma casca
 * compõe uma primitiva; a que a compõe já a traz pronta.
 *
 * É a conjunção que torna a regra precisa, e por **linha** e não por arquivo — o que passa fora de
 * `ui/` é justamente o que não é casca: `border-b-2 border-border` num cabeçalho é separador, e
 * `className="bg-warning"` sobre uma `Card` é pintar uma casca que já veio pronta. O que não passa
 * é redesenhar as três coisas juntas.
 */
const RAIZ_DAS_PRIMITIVAS = fileURLToPath(new URL('../../src/renderer/ui', import.meta.url))

describe('a receita de casca só existe nas primitivas', () => {
  it('nenhuma linha fora de `src/renderer/ui/` junta `border-2` e `shadow-shadow`', () => {
    // Prefixo de caminho absoluto, e não a string `'src/renderer/ui'`: os dois lados saem do mesmo
    // `fileURLToPath`, então a comparação sobrevive ao separador do Windows.
    const ocorrencias = lerArquivos(RAIZ_DA_VARREDURA)
      .filter(({ caminho }) => !caminho.startsWith(RAIZ_DAS_PRIMITIVAS))
      .flatMap(({ caminho, conteudo }) =>
        conteudo
          .split('\n')
          .map((linha, indice) => ({ linha, numero: indice + 1 }))
          .filter(({ linha }) => linha.includes('border-2') && linha.includes('shadow-shadow'))
          // A linha inteira no relatório: aqui o conserto é compor uma primitiva, e quem lê o
          // vermelho precisa ver o que estava sendo desenhado à mão.
          .map(({ linha, numero }) => `${caminho}:${numero} — ${linha.trim()}`),
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
 *    qualquer componente se mexer, que é o que a torna uma rede em vez de um carimbo. As cinco
 *    últimas (`data-parent`, `data-silent`, `data-status`, `data-tokens`, `data-tool`) entraram
 *    depois, e por este caminho: o card #14 as acrescentou enquanto este aqui corria, a canária
 *    ficou vermelha, e alguém veio declará-las. É o pedágio funcionando, não uma exceção a ele.
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
  // Entrou com o card #32: a barra de abas nasceu depois desta rede, e o `data-board-key` é por
  // onde o smoke pergunta **qual** board cada aba abre sem escrever o título de nenhum.
  'data-board-key',
  'data-card-assignees',
  'data-card-closed',
  'data-card-column',
  // Entrou com o card #13: a conversabilidade deixou de decidir se o cartão abre, e virou atributo
  // para o smoke afirmar o CA-3 sem reimplementar a regra que o core decide.
  'data-card-conversable',
  'data-card-number',
  'data-column-count',
  'data-column-id',
  'data-column-name',
  'data-comment-kind',
  // As duas do card #10, e elas são de naturezas diferentes de propósito. `data-dangerous` é a
  // **nossa** marca no botão do cartão: ela diz para que lado o clique vai, e é imediata.
  // `data-permission-mode` é a **segunda fonte**, a que o SDK reporta no `init`, e ela só é legível
  // depois de um turno ter rodado — é o par que a decisão 10 mantém visível em vez de auto-corrigir.
  'data-dangerous',
  'data-label',
  'data-parent',
  'data-permission-mode',
  'data-question',
  'data-queued',
  'data-read-at',
  'data-request',
  'data-role',
  'data-selected',
  'data-silent',
  'data-stale',
  'data-state',
  'data-status',
  'data-testid',
  'data-tokens',
  'data-tool',
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

/**
 * Daqui para baixo, o card #29: a folha deixou de ter **uma** paleta e passou a ter um conjunto.
 *
 * O mecanismo inteiro já funciona quando estas canárias nascem — o que falta são as guardas. Quase
 * tudo o que aquele card decidiu pode ser desfeito sem nada ficar vermelho: um token esquecido numa
 * combinação nova dá fundo transparente aqui e sombra sem cor ali; um croma "arredondado" muda a cor
 * do app inteiro; uma cor fora do gamut faz a moldura da janela discordar do canvas em silêncio,
 * porque o Chromium remapeia reduzindo croma enquanto `src/main/color.ts` clipa por canal.
 *
 * Todas seguem a disciplina que este arquivo já pratica: reportam **por nome** — qual combinação,
 * qual token, qual valor —, porque uma canária que só diz "falhou" custa a quem a encontra vermelha
 * mais do que resolve.
 */

/** Os mesmos onze, do jeito que a combinação os declara: sem o `--color-` que o `@theme inline` põe. */
const TOKENS_DE_COMBINACAO = TOKENS_DE_COR.map((token) => token.replace('--color-', '--'))

/**
 * A folha lida uma vez, pelo mesmo parser que o main usa para pintar a janela.
 *
 * Reaproveitar `parseThemes` em vez de escrever uma segunda leitura aqui é o que faz este arquivo
 * conferir **a folha que o app enxerga**. Um parser próprio do teste aceitaria um formato ligeiramente
 * diferente, e é exatamente assim que um valor inválido passa verde e falha na janela.
 */
const COMBINACOES = parseThemes(readFileSync(CAMINHO_DO_TEMA, 'utf8'))

describe('o conjunto de combinações da folha é o declarado', () => {
  it('a folha declara exatamente as combinações de `THEMES`', () => {
    // Primeiro de propósito. Sem ele, os cinco describes abaixo passariam **verdes contra o vazio**:
    // um `Map` sem chave nenhuma não tem token ausente, nem cor fora do gamut, nem par com contraste
    // ruim. É o argumento de `## as varreduras têm o que varrer`, aplicado à folha em vez do disco.
    //
    // E ele pega os dois sentidos do erro: a combinação que a folha declarou e ninguém registrou em
    // `THEMES` — que `parseThemes` ignora de propósito, e que só aparece por ausência aqui — e a que
    // foi registrada e nunca escrita.
    expect([...COMBINACOES.keys()]).toEqual([...THEMES])
  })
})

describe('toda combinação declara os onze tokens', () => {
  it.each(THEMES)('a %s não deixa token de fora', (tema) => {
    const declarados = COMBINACOES.get(tema)

    // Por nome, e não por contagem. Com o `:root` sem cor nenhuma, faltar um token não herda em
    // silêncio da combinação anterior: dá fundo transparente aqui e sombra sem cor ali, cada um
    // falhando à sua maneira e nenhum apontando para a folha. "Esperava 11, recebeu 10" deixaria
    // esse trabalho todo para quem encontrasse o vermelho.
    const ausentes = TOKENS_DE_COMBINACAO.filter((token) => declarados?.has(token) !== true)

    expect(ausentes).toEqual([])
  })
})

/**
 * O pixel de um token da folha, e o único lugar onde "token ausente" vira mensagem com nome.
 *
 * Converter aqui — em vez de guardar hexes no teste — é o que amarra a canária à mesma matemática que
 * pinta a janela: se `oklchToSrgb` divergir um dia, diverge para os dois.
 */
function corDoToken(tema: Theme, token: string): Rgb8 {
  const valor = COMBINACOES.get(tema)?.get(token)

  if (valor === undefined) throw new Error(`a combinação ${tema} não declara ${token}`)

  return oklchToSrgb(...parseOklch(valor))
}

describe('toda cor de toda combinação cabe no sRGB', () => {
  it.each(THEMES)('nenhuma cor da %s escapa do gamut', (tema) => {
    const declarados = COMBINACOES.get(tema)

    const fora = TOKENS_DE_COMBINACAO.flatMap((token) => {
      const valor = declarados?.get(token)

      // Token ausente é assunto do describe acima. Reportá-lo aqui de novo faria uma folha incompleta
      // acender dois vermelhos dizendo a mesma coisa, e o segundo acusaria o gamut de um problema que
      // é de completude.
      if (valor === undefined) return []

      try {
        oklchToSrgb(...parseOklch(valor))

        return []
      } catch (erro) {
        // Combinação, token e o valor cru: sem os três, quem encontra o vermelho abre a folha e
        // adivinha qual das vinte e duas declarações não coube.
        const motivo = erro instanceof Error ? erro.message : 'erro sem mensagem'

        return [`${tema} ${token}: ${valor} — ${motivo}`]
      }
    })

    expect(fora).toEqual([])
  })
})

/**
 * Os oito pares de texto-sobre-superfície que o código **realmente escreve**, levantados por
 * varredura da árvore e não inventados.
 *
 * Quatro são o CA-4 do #29 — as cores de estado sob o preto de `--foreground` — e quatro são a
 * extensão que aquela spec declarou (Technical Decisions 6), porque são os pares que existem na tela
 * e que o #8 nunca precisou medir. Custam quatro linhas e fecham dois buracos: uma combinação futura
 * escurecer o `--main`, hoje o mais apertado dos oito, sem nada ficar vermelho; e a divergência entre
 * `--foreground` e `--main-foreground`, que hoje são a mesma cor e por isso escondem que o `<h2>` do
 * cabeçalho de coluna herda o primeiro, não o segundo.
 *
 * **Fora daqui, com razão declarada:** os pares com opacidade (`text-foreground/70`, `/60`, `/50`).
 * Não são cor sólida — a razão real depende da composição alfa contra o fundo —, e afirmá-la a partir
 * dos tokens seria afirmar um número que não é o da tela. É pendência nomeada, não esquecimento.
 */
const PARES_AAA = [
  { tinta: '--foreground', fundo: '--background' }, // o canvas do app, `index.css` no `body`
  { tinta: '--foreground', fundo: '--secondary-background' }, // `input.tsx`, `textarea.tsx`, a face de todo cartão
  { tinta: '--foreground', fundo: '--attention' },
  { tinta: '--foreground', fundo: '--warning' },
  { tinta: '--foreground', fundo: '--question' },
  { tinta: '--foreground', fundo: '--danger' },
  { tinta: '--main-foreground', fundo: '--main' }, // `badge.tsx`, `button.tsx`, `MessageBubble.tsx`
  { tinta: '--foreground', fundo: '--main' }, // `Column.tsx`: o `<h2>` do cabeçalho não tem classe de cor
]

/** AAA para texto normal na WCAG 2.x. É o patamar que o #8 publicou e que o #29 manda manter. */
const RAZAO_AAA = 7

describe('toda combinação mantém AAA nos oito pares', () => {
  it.each(THEMES.flatMap((tema) => PARES_AAA.map((par) => ({ tema, ...par }))))(
    'na $tema, $tinta sobre $fundo',
    ({ tema, tinta, fundo }) => {
      const razao = contrastRatio(corDoToken(tema, tinta), corDoToken(tema, fundo))

      // O nome do caso diz a combinação e o par; a razão obtida é o que o vitest imprime no vermelho.
      // Quem chega aqui precisa saber **por quanto** passou: é a diferença entre reafinar uma cor e
      // desfazer a decisão de acessibilidade inteira.
      expect(razao).toBeGreaterThanOrEqual(RAZAO_AAA)
    },
  )
})

const CAMINHO_DO_HTML = fileURLToPath(new URL('../../src/renderer/index.html', import.meta.url))

describe('o default do `index.html` é o `THEME_DEFAULT`', () => {
  it('o `data-theme` do `<html>` é a combinação que o código chama de padrão', () => {
    // O default mora no HTML, e não em JS, para não haver **um instante sem cor**: os onze tokens
    // vivem só dentro dos blocos `[data-theme]`, e uma página sem o atributo não teria fundo nem
    // tinta. O preço é que dois lugares podem divergir — e é essa divergência que este teste pega: o
    // app abriria numa cor que ninguém pediu, com o CA-2 falhando sem nenhum vermelho.
    const declarado = /data-theme="([a-z-]+)"/.exec(readFileSync(CAMINHO_DO_HTML, 'utf8'))?.[1]

    expect(declarado).toBe(THEME_DEFAULT)
    // E o nome escrito no HTML é o de uma combinação de verdade, não um que a folha nunca declarou.
    expect(THEMES).toContain(declarado)
  })
})

/**
 * A metade de *valor* do CA-2: a lavanda é a combinação do #8, e nada aqui a reajusta "de passagem".
 *
 * Os onze pares abaixo foram transcritos do `:root` de antes do #29, caractere por caractere. É
 * baseline congelado de propósito, pela mesma razão que `## as âncoras` já registra: o portão é a
 * revisão consciente, não a esperteza do teste. Nada mais neste repo impede alguém de "arredondar" o
 * `70.28%` para `70%` na folha e mudar a cor do app inteiro sem um vermelho em lugar nenhum.
 *
 * **Só a lavanda é congelada.** A ametista nasceu no #29 e não tem um "antes" a preservar;
 * transcrevê-la aqui seria copiar a folha no teste por nenhuma razão, e o que ela precisa — caber no
 * gamut e manter AAA — os dois describes acima já cobram dela.
 */
const LAVANDA_DO_8 = [
  ['--background', 'oklch(93.88% 0.033 300.19)'],
  ['--secondary-background', 'oklch(100% 0 0)'],
  ['--foreground', 'oklch(0% 0 0)'],
  ['--main-foreground', 'oklch(0% 0 0)'],
  ['--main', 'oklch(70.28% 0.1753 295.36)'],
  ['--border', 'oklch(0% 0 0)'],
  ['--ring', 'oklch(0% 0 0)'],
  ['--attention', 'oklch(78% 0.17 145)'],
  ['--warning', 'oklch(84% 0.16 85)'],
  ['--question', 'oklch(78% 0.13 230)'],
  ['--danger', 'oklch(70% 0.19 25)'],
] as const

describe('a lavanda é a combinação do #8, valor por valor', () => {
  it('os onze valores são os do `:root` de antes deste card', () => {
    const declarados = COMBINACOES.get('lavanda')

    // Por token, com esperado e obtido: quem vier mudar a lavanda de propósito tem de passar por
    // aqui declarar a mudança, e o vermelho já lhe entrega qual linha da folha editar.
    const divergencias = LAVANDA_DO_8.flatMap(([token, esperado]) => {
      const obtido = declarados?.get(token)

      return obtido === esperado
        ? []
        : [`${token}: esperado ${esperado}, obtido ${obtido ?? '(ausente)'}`]
    })

    expect(divergencias).toEqual([])
  })
})

/**
 * A Proibição 4: nenhum arquivo de `src/` escreve cor literal. É o CA-3 do #29 valendo **depois** do
 * diff que o fechou.
 *
 * A Proibição 1 não cobre isto e não tem como cobrir: ela é uma regex sobre *nomes de classe* do
 * Tailwind, e não casa com `'#eee6fe'`, `rgb(...)` nem `hsl(...)`. Um `style={{ color: '#eee6fe' }}`
 * num `.tsx` passa por ela sem tocar. E o teste de `windowBackground` nunca abre `src/main/index.ts`,
 * então alguém reintroduzindo o hex que este card acabou de tirar de lá passaria verde.
 *
 * Três decisões dela, que mudam o que ela pega:
 *
 * 1. **`oklch(` fica de fora.** Nesta árvore ele só aparece como *padrão a analisar* (`sheet.ts`),
 *    nunca como valor — incluí-lo faria o parser tropeçar na própria canária. É por isso que
 *    `color.ts` tem a convenção de nunca escrever a sequência: a alternativa seria exceção por
 *    arquivo, e exceção por arquivo apodrece.
 * 2. **Seis a oito dígitos de hex, nunca três.** `#161` e `#205` são números de decisão e este repo
 *    os cita às dezenas em comentário; um `#fff` de verdade é indistinguível deles por regex. A
 *    lacuna é declarada, e o caso que importa — `'#eee6fe'` — tem seis.
 * 3. **`src/` inteiro, e não só `src/main/`.** Uma raiz só, escrita num ponto, como
 *    `RAIZ_DA_VARREDURA`.
 *
 * O `\b` antes de `rgb`/`hsl` não afrouxa nada, e existe por um caso medido: sem ele, `oklchToSrgb(`
 * contém a sequência `rgb(` e a canária nasceria vermelha em cima da própria função que o #29 manda
 * escrever. Um literal de verdade sempre vem precedido de aspa, espaço, `(` ou `:` — todos
 * não-palavra, todos com fronteira. O que o `\b` exclui é exatamente o caso em que `rgb` termina um
 * identificador.
 */
const RAIZ_DE_TODA_FONTE = '../../src'

const COR_LITERAL = /#[0-9a-fA-F]{6,8}\b|\brgba?\(|\bhsla?\(/g

describe('nenhum arquivo de `src/` escreve cor literal', () => {
  it(`não há hex, rgb nem hsl em ${RAIZ_DE_TODA_FONTE}`, () => {
    // Arquivo, linha e o achado — a cor do app sai da folha, e quem encontra este vermelho precisa
    // ver qual valor foi escrito à mão para saber qual token deveria tê-lo dado.
    const ocorrencias = lerArquivos(RAIZ_DE_TODA_FONTE).flatMap(({ caminho, conteudo }) =>
      conteudo
        .split('\n')
        .flatMap((linha, indice) =>
          [...linha.matchAll(COR_LITERAL)].map(
            (achado) => `${caminho}:${indice + 1} — ${achado[0]}`,
          ),
        ),
    )

    expect(ocorrencias).toEqual([])
  })
})

/**
 * A barra de rolagem do design system, em três canárias — e as três varrem a folha **com os
 * comentários apagados**.
 *
 * A razão não é elegância. O comentário de registro do bloco em `index.css` tem de explicar a
 * precedência da API padrão e a ausência de sujeito no seletor, e explicar isso exige **escrever** as
 * strings que duas destas canárias proíbem; uma varredura ingênua ficaria vermelha numa folha
 * correta. É a mesma colisão que este repo já resolveu duas vezes: `board-readonly.test.ts:26-30`
 * mantém a palavra `mutation` fora de todo comentário de propósito, e a Proibição 4 aqui exclui
 * `oklch(` da varredura de literais para o parser não tropeçar na própria canária. O comentário da
 * folha e estas três são **um par** — quem editar um sem o outro quebra o outro.
 *
 * O idioma do apagamento é copiado de `src/main/sheet.ts:20`, e a cópia é deliberada: o `COMENTARIO`
 * de lá não é exportado, e exportá-lo faria a leitura que o main usa para pintar a janela carregar
 * uma necessidade do teste.
 */
const COMENTARIO = /\/\*[\s\S]*?\*\//g

/**
 * Uma regra CSS de topo: o seletor inteiro e o corpo.
 *
 * `[^{}]+` no seletor é o que a mantém honesta — ela casa o seletor **desde o `}` anterior**, e não
 * só o pedaço adjacente ao `::`. É essa diferença que faz `.coluna ::-webkit-scrollbar` ser pego
 * junto com `main::-webkit-scrollbar`: escopar por descendência escopa do mesmo jeito, e uma canária
 * que só olhasse o caractere anterior deixaria o espaço passar.
 */
const REGRA = /(?<seletor>[^{}]+)\{(?<corpo>[^{}]*)\}/g

/** O pseudo-elemento da barra, com o sufixo opcional (`-track`, `-thumb`, `-corner`). */
const PSEUDO_DA_BARRA = /::-webkit-scrollbar[a-z-]*/

/**
 * A folha com todo comentário apagado — e apagado **preservando as quebras de linha**, para que o
 * número de linha que uma canária reporta seja o do arquivo de verdade. Um `replace(COMENTARIO, '')`
 * seco colapsaria as linhas e mandaria quem encontrasse o vermelho para o lugar errado da folha.
 */
function lerFolhaSemComentarios(): string {
  return readFileSync(CAMINHO_DO_TEMA, 'utf8').replace(COMENTARIO, (comentario) =>
    comentario.replace(/[^\n]/g, ''),
  )
}

/** As regras da barra na folha sem comentários: o seletor já sem espaço em volta, e o corpo cru. */
function lerRegrasDaBarra(): { seletor: string; corpo: string }[] {
  return [...lerFolhaSemComentarios().matchAll(REGRA)]
    .map((regra) => ({
      seletor: (regra.groups?.['seletor'] ?? '').trim(),
      corpo: regra.groups?.['corpo'] ?? '',
    }))
    .filter(({ seletor }) => PSEUDO_DA_BARRA.test(seletor))
}

describe('a barra de rolagem é a do design system, e não a do Chromium', () => {
  it('as regras `::-webkit-scrollbar` existem e nenhuma delas vem precedida de sujeito', () => {
    const regras = lerRegrasDaBarra()

    // A existência primeiro, e separada da asserção que depende dela — o mesmo motivo pelo qual o
    // `@theme inline` tem teste próprio antes dos cinco que o leem. Sem esta linha, apagar o bloco e
    // deixar o comentário passaria **verde contra o vazio**: uma folha sem barra nenhuma não tem
    // regra escopada para reclamar, e um rollback pela metade sairia impune.
    expect(regras.map(({ seletor }) => seletor)).not.toEqual([])

    // O seletor sem sujeito é o mecanismo, e é ele que se guarda — não a lista dos contêineres que
    // rolam. Sem sujeito, `::-webkit-scrollbar` vale por `*::-webkit-scrollbar` e alcança o
    // contêiner que ainda não existe; congelar a enumeração seria o carimbo em vez da rede contra o
    // qual `board-readonly.test.ts:29` argumenta.
    //
    // Falha pelo seletor encontrado, e não por contagem: quem vier ler este vermelho precisa ver
    // qual regra foi escopada para saber onde tirar o sujeito.
    const escopadas = regras
      .map(({ seletor }) => seletor)
      .filter((seletor) => seletor !== PSEUDO_DA_BARRA.exec(seletor)?.[0])

    expect(escopadas).toEqual([])
  })
})

/**
 * A armadilha medida, e a única das três que pega uma falha **invisível**.
 *
 * Com `scrollbar-width` ou `scrollbar-color` declarados no mesmo elemento, a API padrão vence e o
 * Chromium ignora o bloco `::-webkit-` inteiro: o gutter medido caiu para 10px e a barra voltou a ser
 * a nativa. O modo de falha é o pior possível — nada quebra, nada fica vermelho, e a feature
 * simplesmente não está lá. É o mesmo argumento da Proibição 3 ("apagar `--color-attention` não
 * quebra o build").
 *
 * **Duas raízes, porque há dois caminhos para a mesma queda.** A folha é a óbvia; o renderer é a que
 * escapa, porque o Tailwind v4 aceita propriedade arbitrária e `className="[scrollbar-width:thin]"`
 * ou `style={{ scrollbarWidth: 'thin' }}` reintroduziriam exatamente o mesmo silêncio sem tocar em
 * `index.css`. Por isso a varredura cobre as duas grafias, a do CSS e a do React.
 *
 * Que a raiz do renderer tenha o que varrer é a guarda de `## as varreduras têm o que varrer` que
 * garante — `RAIZ_DA_VARREDURA` já está em `RAIZES_VARRIDAS`.
 */
const API_PADRAO = /scrollbar-width|scrollbar-color|scrollbarWidth|scrollbarColor/g

/** Arquivo, linha e o achado — o formato que a Proibição 1 já usa, pela mesma razão. */
function ocorrenciasDaApiPadrao(rotulo: string, conteudo: string): string[] {
  return conteudo
    .split('\n')
    .flatMap((linha, indice) =>
      [...linha.matchAll(API_PADRAO)].map((achado) => `${rotulo}:${indice + 1} — ${achado[0]}`),
    )
}

describe('a barra não devolve o controle à API padrão', () => {
  it('nem a folha nem o renderer declaram `scrollbar-width` ou `scrollbar-color`', () => {
    const naFolha = ocorrenciasDaApiPadrao('src/renderer/index.css', lerFolhaSemComentarios())
    const noRenderer = lerArquivos(RAIZ_DA_VARREDURA).flatMap(({ caminho, conteudo }) =>
      ocorrenciasDaApiPadrao(caminho, conteudo),
    )

    expect([...naFolha, ...noRenderer]).toEqual([])
  })
})

/**
 * A segunda metade do CA-2: a barra não decide cor, o tema decide.
 *
 * Só `--background` e `--main` variam entre as combinações — as outras nove são idênticas por
 * construção —, então "usa token" não basta: um polegar preto de `--border` passaria por uma
 * varredura de literais e continuaria imóvel na troca de combinação. Quem pega isso é o smoke, que
 * afirma **diferença** entre lavanda e ametista. O que esta canária pega é o outro lado, o que o CI
 * consegue ver: nenhuma cor escrita à mão dentro do bloco.
 *
 * **Whitelist, e restrita às declarações que carregam cor.** A alternativa — listar os 148 nomes de
 * cor do CSS — é comprida e ainda deixa passar `#fff` e `rgb(0 0 0)`; dentro de `background` e
 * `border` o vocabulário legítimo é curto o bastante para ser escrito por inteiro, e aí `white`,
 * `#eee6fe`, `rgb(...)` e `oklch(...)` caem todos pelo mesmo mecanismo. A restrição a propriedades
 * de cor é o que impede a canária de ter opinião sobre geometria: `width: 12px` não passa por aqui, e
 * mudar os 12px é ajuste de design, não violação.
 *
 * A existência do bloco não é reafirmada aqui: quem a guarda é a primeira canária, e ela vem antes no
 * arquivo — o mesmo arranjo do `@theme inline` e dos cinco describes que o leem.
 */
const PROPRIEDADE_DE_COR = /(?:^|-)(?:background|color|border|outline|shadow|fill|stroke)(?:$|-)/

const VALOR_DE_COR_PERMITIDO =
  /^(?:var\(--[a-z-]+\)|transparent|0|\d+(?:\.\d+)?(?:px|%)|solid|dashed|dotted|none)$/

describe('a barra não decide cor', () => {
  it('toda cor do bloco `::-webkit-scrollbar` é `var(--*)` ou `transparent`', () => {
    // Regra, propriedade e o valor recusado: a cor do app sai da folha, e quem encontra este vermelho
    // precisa ver o que foi escrito à mão para saber qual token deveria tê-lo dado.
    const literais = lerRegrasDaBarra().flatMap(({ seletor, corpo }) =>
      corpo
        .split(';')
        .map((declaracao) => declaracao.trim())
        .filter((declaracao) => declaracao.length > 0)
        .flatMap((declaracao) => {
          const [propriedade = '', valor = ''] = declaracao.split(/\s*:\s*/, 2)

          return PROPRIEDADE_DE_COR.test(propriedade)
            ? valor
                .split(/\s+/)
                .filter((token) => !VALOR_DE_COR_PERMITIDO.test(token))
                .map((token) => `${seletor} { ${propriedade} } — ${token}`)
            : []
        }),
    )

    expect(literais).toEqual([])
  })
})

/**
 * A guarda das varreduras: cada raiz varrida tem de devolver ao menos um arquivo.
 *
 * Sem ela, renomear `src/renderer/` — ou mudar a extensão da fonte — deixaria as varreduras **verdes
 * contra o vazio**: zero ocorrência de paleta, zero casca à mão, zero cor literal e zero âncora
 * perdida, sem nenhum arquivo lido. É o mesmo argumento que `board-readonly.test.ts:43` registra
 * sobre o `ENOENT`, levado um passo adiante: o `ENOENT` cobre a pasta que sumiu, esta cobre a pasta
 * que ficou e esvaziou.
 */
const RAIZES_VARRIDAS = [RAIZ_DA_VARREDURA, RAIZ_DE_TODA_FONTE, ...DIRETORIOS_DE_ANCORA]

describe('as varreduras têm o que varrer', () => {
  it.each(RAIZES_VARRIDAS)('`%s` devolve ao menos um arquivo de fonte', (raiz) => {
    expect(lerArquivos(raiz).length).toBeGreaterThan(0)
  })
})
