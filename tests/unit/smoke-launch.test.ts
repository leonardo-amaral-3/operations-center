import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { smokeEnv } from '../smoke/smoke-env'

/**
 * O CA-2 e o CA-3 do card #57 em forma de teste, no espírito de `ipc-no-path.test.ts`.
 *
 * O defeito que este arquivo guarda é de ambiente: um `yarn smoke` disparado de um shell nascido de
 * `yarn dev` herdava `ELECTRON_RENDERER_URL` e media o renderer do dev server em vez do buildado que
 * o próprio comando acabara de compilar. O conserto foi concentrar a subida em `smoke-app.ts` e o
 * ambiente em `smoke-env.ts` — mas concentrar não é garantir: nada impede o próximo arquivo de
 * chamar `electron.launch` por conta própria, e foi exatamente assim que as oito cópias de
 * `inheritedEnv()` nasceram.
 *
 * Daí as **três formas** do vazamento, e uma asserção para cada: o saneamento sumir do módulo, um
 * spec voltar a ler `process.env`, um spec voltar a chamar `electron.launch`. A quarta asserção
 * guarda a própria varredura, que é o modo de uma canária textual mentir de verde.
 *
 * **Este arquivo mora em `tests/unit/` e não em `tests/smoke/`, e isso é o ponto inteiro.**
 * `.github/workflows/ci.yml` roda `lint && typecheck && test`, e **não** roda `yarn smoke` — porque
 * smoke sobe sessão real do Claude Code e gasta cota. Uma asserção dentro de um `.smoke.spec.ts`
 * seria a prova mais direta do defeito e nunca rodaria no CI. Além disso `vitest.config.ts` exclui
 * `tests/smoke/**` da descoberta: uma canária lá dentro não rodaria nem localmente. Importar
 * `../smoke/smoke-env` daqui é legítimo — o `exclude` vale para descoberta de teste, não para
 * import, e é por não arrastar `@playwright/test` que aquele módulo vive separado do `smoke-app.ts`.
 */

/** Onde os smokes moram. É o diretório inteiro que é varrido, e não uma lista de arquivos. */
const DIRETORIO_DOS_SMOKES = fileURLToPath(new URL('../smoke', import.meta.url))

/**
 * Os dois módulos isentos — e são só estes dois, pela mesma razão que existem: `smoke-app.ts` é o
 * chamador único de `electron.launch` e `smoke-env.ts` é o leitor único de `process.env`. Isentar é
 * o que transforma a varredura numa regra exata ("o único é aquele") em vez de uma heurística.
 *
 * A lista é nominal de propósito. Renomear um dos dois faz a varredura passar a incluí-lo e ficar
 * vermelha — o que é o comportamento certo: mover o ponto de estrangulamento é decisão que merece
 * uma visita consciente a este arquivo, não um glob que a absorve em silêncio.
 */
const FORA_DA_VARREDURA = ['smoke-app.ts', 'smoke-env.ts']

/**
 * O piso da varredura, e ele existe porque o modo de uma canária textual falhar é **passando**: um
 * diretório renomeado, um glob que deixa de casar, e a suíte fica verde sem ter lido uma linha.
 *
 * Oito é o número de `.smoke.spec.ts` de hoje — o mesmo que o `readme.test.ts` cobra da prosa do
 * README. Os módulos auxiliares (`boards-fixture.ts` e os que vierem) fazem a conta real passar
 * disso, e é de propósito que o piso não os conte: quem apagar um auxiliar não deve ser barrado
 * aqui, mas quem esvaziar a varredura, sim.
 */
const MINIMO_VARRIDO = 8

interface Varrido {
  nome: string
  conteudo: string
}

/**
 * Comentário fora antes de procurar.
 *
 * Não é zelo: os arquivos varridos **falam** de `electron.launch` e de `process.env` em prosa — é o
 * assunto deles, e os comentários que explicam por que a subida saiu dali citam as duas coisas pelo
 * nome. Uma canária que dispara com comentário é uma canária que alguém desliga.
 *
 * O `//` também corta o resto de uma linha que contenha `://` dentro de uma string, o que em tese
 * esconderia código depois dela. Fica assim: o Prettier põe uma instrução por linha, e um parser de
 * TypeScript aqui seria mais superfície para manter do que a coisa que ele verifica.
 */
function semComentarios(corpo: string): string {
  return corpo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/**
 * Todo `.ts` do diretório, e não só os `*.smoke.spec.ts`.
 *
 * A diferença é o `boards-fixture.ts`: este diretório ganha módulos auxiliares, e um deles subindo o
 * app por fora furaria a garantia sem tocar em nenhum spec — passando por uma varredura de specs sem
 * uma linha de diff.
 */
function lerVarridos(): Varrido[] {
  return readdirSync(DIRETORIO_DOS_SMOKES)
    .filter((nome) => nome.endsWith('.ts') && !FORA_DA_VARREDURA.includes(nome))
    .map((nome) => ({
      nome,
      conteudo: semComentarios(readFileSync(join(DIRETORIO_DOS_SMOKES, nome), 'utf8')),
    }))
}

/** Os nomes dos arquivos que contêm o termo — é o nome que a asserção precisa gritar quando cai. */
function culpadosDe(varridos: Varrido[], termo: string): string[] {
  return varridos
    .filter((varrido) => varrido.conteudo.includes(termo))
    .map((varrido) => varrido.nome)
}

describe('a subida do smoke mora num lugar só', () => {
  const varridos = lerVarridos()

  it('a varredura leu os smokes que existem no disco', () => {
    // A sanidade da própria canária, e a única asserção daqui que não é sobre o código varrido: sem
    // ela, as duas abaixo passam verdes contra uma lista vazia e provam exatamente nada.
    expect(varridos.length).toBeGreaterThanOrEqual(MINIMO_VARRIDO)
  })

  it('nenhum smoke chama electron.launch por conta própria', () => {
    // A forma do vazamento que um módulo de ambiente sozinho não pegaria: um `electron.launch` que
    // simplesmente **omita** a chave `env` herda tudo por default do Playwright — inclusive a
    // `ELECTRON_RENDERER_URL` que é o defeito inteiro — e não há saneamento que o alcance.
    expect(culpadosDe(varridos, 'electron.launch')).toEqual([])
  })

  it('nenhum smoke lê process.env', () => {
    // O que devolveria `inheritedEnv()` ao mundo: qualquer leitura local do ambiente é uma segunda
    // fonte de verdade sobre o que o app pode herdar, e a lista de não-herdáveis passa a valer só
    // para quem lembrar de usá-la.
    expect(culpadosDe(varridos, 'process.env')).toEqual([])
  })
})

describe('smokeEnv saneia o ambiente sem cortar a herança', () => {
  /**
   * A testemunha é **plantada**, e não é o `PATH`.
   *
   * Plantada porque a asserção precisa provar que a herança segue viva: sem ela, um `smokeEnv()` que
   * devolvesse `{}` passaria nas duas ausências abaixo e quebraria todo smoke do repo. E não é o
   * `PATH` porque no Windows a chave real pode ser `Path` — `Object.entries(process.env)` devolve a
   * grafia original, e a asserção ficaria verde no Git Bash e vermelha no PowerShell.
   */
  const TESTEMUNHA = 'OC_TESTEMUNHA_DA_HERANCA'

  const PLANTADAS = ['ELECTRON_RENDERER_URL', 'OC_THEME', TESTEMUNHA]

  // `process.env` é do processo, e o Vitest divide o processo entre arquivos de teste: o que este
  // planta, outro herda. Guardar o valor anterior — e não só apagar no fim — importa porque
  // `OC_THEME` pode existir de verdade no shell de quem roda a suíte.
  let anterior: Record<string, string | undefined> = {}

  beforeEach(() => {
    anterior = Object.fromEntries(PLANTADAS.map((chave) => [chave, process.env[chave]]))
  })

  afterEach(() => {
    for (const [chave, valor] of Object.entries(anterior)) {
      if (valor === undefined) delete process.env[chave]
      else process.env[chave] = valor
    }
  })

  it('apaga as não-herdáveis e passa adiante o resto do ambiente', () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    process.env['OC_THEME'] = 'lavanda'
    process.env[TESTEMUNHA] = 'presente'

    const env = smokeEnv()

    // O cenário do defeito, exatamente como ele acontece: uma sessão de shell nascida de `yarn dev`
    // exporta a URL do dev server, e `src/main/index.ts` a lê para decidir entre `loadURL` e
    // `loadFile`. Ler é o comportamento certo do app; o defeito sempre foi o teste a repassar.
    expect(env['ELECTRON_RENDERER_URL']).toBeUndefined()

    // `tema.smoke.spec.ts` precisa da combinação *default* genuinamente ausente para medi-la — era
    // o único que apagava a variável, e agora o lugar único apaga para todos.
    expect(env['OC_THEME']).toBeUndefined()

    expect(env[TESTEMUNHA]).toBe('presente')
  })
})
