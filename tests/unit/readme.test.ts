import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O CA-4 do card #1 em forma de teste.
 *
 * Um README que descreve o repo errado é pior que nenhum: ele mente com autoridade, e ninguém
 * revisa documentação com o mesmo rigor com que revisa código. Cada caso abaixo é uma cláusula do
 * critério — as duas frases do esqueleto que precisavam morrer, e as seis coisas que o documento
 * passou a ser obrigado a dizer. A lista cresce quando o produto ganha uma credencial ou uma porta
 * de ambiente novas: foi assim que o `gh` e as variáveis de board entraram, no card #4.
 *
 * As âncoras são títulos de seção, nomes de script e nomes de variável: coisas que só mudam quando
 * o produto muda. A prosa em volta pode ser reescrita à vontade sem quebrar nada aqui.
 */
const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8')

/** Os smokes que existem no disco. É deles que sai o número que o README precisa dizer. */
const SMOKES = readdirSync(fileURLToPath(new URL('../smoke', import.meta.url))).filter((arquivo) =>
  arquivo.endsWith('.smoke.spec.ts'),
)

/**
 * Os numerais por extenso, porque o README escreve "os oito smokes" e não "os 8 smokes".
 *
 * A lista para em doze de propósito: passar disso é sinal de que a frase do `yarn smoke` deixou de
 * caber numa enumeração, e a correção aí é reescrever o README — não alongar este array.
 */
const POR_EXTENSO = [
  'zero',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
]

describe('README', () => {
  it('não descreve mais o repo como esqueleto de stack indecidida', () => {
    // Case-insensitive porque a frase morre por completo, não só na capitalização em que nasceu.
    const texto = readme.toLowerCase()

    expect(texto).not.toContain('esqueleto')
    expect(texto).not.toContain('ainda não foram decididos')
  })

  it('documenta a stack escolhida', () => {
    expect(readme).toMatch(/^## Stack$/m)
  })

  it('avisa que o Claude Code precisa estar instalado e logado', () => {
    expect(readme).toMatch(/Claude Code instalado e logado/)
  })

  it('avisa que o gh precisa estar instalado e logado', () => {
    // O segundo pré-requisito de credencial, e o menos óbvio: sem `gh` o app abre e o kanban não
    // carrega, porque é dele que sai o token que lê o board. Quem clona precisa saber disso antes
    // de abrir o app, não depois de ver a tela de erro.
    expect(readme).toMatch(/^## Pré-requisitos$/m)
    expect(readme).toMatch(/GitHub CLI \(`gh`\) instalado e logado/)
  })

  it('avisa que o git precisa estar no PATH', () => {
    // A terceira exigência de máquina, e a que o README passou seis cards sem dizer. O app spawna
    // `git remote get-url origin` para descobrir a qual repo cada pasta local corresponde — o mapa
    // que decide **em que pasta a sessão de um cartão roda**. Sem `git` a resposta é `null`, com a
    // mesma tolerância de "pasta não é repo": nada quebra na tela, e os cartões só deixam de achar
    // a pasta deles. É por não quebrar que a omissão sobreviveu tanto tempo, e é por isso que ela
    // precisa de canária em vez de confiança.
    expect(readme).toMatch(/^## Pré-requisitos$/m)
    expect(readme).toContain('`git`')
  })

  it('separa o que a máquina precisa ter do que só o desenvolvimento pede', () => {
    // O CA-3 do card #56, e a razão de ele existir: com o executável, a lista única de
    // pré-requisitos passou a mentir por omissão — ela misturava o que se pode dispensar (Node,
    // yarn, o repo clonado) com o que não se pode (`gh`, `git`, Claude Code). Quem recebe só a
    // pasta do `.exe` precisa saber qual das duas metades ainda vale para ele.
    expect(readme).toContain('O que a máquina precisa ter')
    expect(readme).toContain('O que só o desenvolvimento pede')
  })

  it('documenta o executável e o que ele dispensa', () => {
    // A seção que o card #56 criou. As três coisas que ela não pode deixar de dizer: onde o
    // artefato cai, que se copia a **pasta inteira** (mover só o `.exe` não roda — o runtime do
    // Chromium e o `app.asar` são irmãos dele), e que o `claude.exe` de 209 MB **não** vai junto,
    // que é a decisão inteira do card em uma frase.
    expect(readme).toMatch(/^## Executável$/m)
    expect(readme).toContain('dist/win-unpacked')
    expect(readme).toContain('pasta inteira')
  })

  it('lista os comandos que o repo oferece', () => {
    expect(readme).toMatch(/^## Comandos$/m)

    // `package` entrou no #56 e é o único da lista que produz artefato em vez de rodar algo.
    for (const script of ['dev', 'build', 'test', 'smoke', 'lint', 'typecheck', 'package']) {
      expect(readme).toContain(`yarn ${script}`)
    }
  })

  it('diz quantos smokes o repo tem, e o número confere com o disco', () => {
    // O número sai do **disco**, e não de um literal: é isso que faz a omissão reprovar. Um smoke
    // novo que ninguém listou muda a contagem dos arquivos e não muda a frase do README, e o
    // vermelho aparece aqui — que é o único lugar que olha para os dois ao mesmo tempo. A lista
    // nominal em volta ("o do kanban, o do tema…") não é derivável: o apelido de cada smoke é prosa,
    // e `app.smoke.spec.ts` se chama "o da fatia vertical". O que dá para vigiar é a contagem, e ela
    // basta — quem for corrigi-la tem de reler a enumeração inteira para acertar o numeral.
    const quantos = POR_EXTENSO[SMOKES.length]

    expect(quantos, `${SMOKES.length} smokes não têm numeral por extenso na lista`).toBeDefined()
    expect(readme).toContain(`os ${quantos} smokes`)
  })

  it('documenta as variáveis de configuração', () => {
    expect(readme).toMatch(/^## Configuração$/m)

    // A lista é **todas** as variáveis que o main lê, e não uma amostra: uma porta de ambiente que
    // ninguém documentou é uma porta que ninguém encontra — nem para usar, nem para desconfiar
    // dela quando o app se comportar de um jeito que a UI não explica.
    for (const variavel of [
      'OC_CWD',
      'OC_MODEL',
      'OC_ISOLATED',
      'OC_SCREEN',
      'OC_THEME',
      'OC_BOARD_FIXTURE',
      'OC_BOARDS_FIXTURE',
      'OC_CARD_FIXTURE',
      'OC_CLAUDE_PROJECTS',
      'OC_STATE_DIR',
      'OC_CLAUDE_BIN',
    ]) {
      expect(readme).toContain(variavel)
    }
  })

  it('não documenta mais as variáveis de board que deixaram de existir', () => {
    // O espelho do caso acima, e a metade que faltava: `toContain` prova que o documento diz o que
    // precisa dizer, e nunca pegaria uma variável **morta** deixada na prosa. Uma porta de ambiente
    // documentada que o main não lê mais é pior que uma não documentada — quem a exporta acha que
    // configurou alguma coisa, o app a ignora em silêncio, e o README é a testemunha que mente.
    //
    // Qual board o app abre passou a vir da descoberta no GitHub, no card #25.
    expect(readme).not.toContain('OC_PROJECT_OWNER')
    expect(readme).not.toContain('OC_PROJECT_NUMBER')
  })

  it('explica a consequência de custo do login local', () => {
    // A parte que some primeiro numa reescrita distraída, e a que mais custa perder: quem lê
    // precisa saber que o app come a cota das sessões de terminal.
    expect(readme).toMatch(/^## Custo$/m)
    expect(readme).toContain('mesma cota')
    expect(readme).toContain('OC_MODEL')
  })
})
