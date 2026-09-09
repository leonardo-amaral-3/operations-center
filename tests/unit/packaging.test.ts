import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * O CA-4 do card #56 em forma de teste, mais as três decisões vizinhas que ele carrega junto.
 *
 * Mesmo gênero de `readme.test.ts` e `board-readonly.test.ts`: o que está guardado aqui **não é
 * comportamento em runtime**, é configuração. Nenhum outro teste da suíte abre
 * `electron-builder.json`, e o app roda igualzinho com qualquer uma destas linhas apagada — o
 * prejuízo só aparece no artefato, semanas depois, em forma de 209 MB a mais ou de um cofre de
 * estado órfão. Canária existe exatamente para o defeito que não tem sintoma.
 *
 * As âncoras são chaves de configuração e nomes de script: coisas que só mudam quando a decisão
 * muda. Quem as mudar de propósito vem aqui declarar o que fez — que é o portão.
 */
const raizDoRepo = new URL('../../', import.meta.url)

function lerJson(nome: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(nome, raizDoRepo), 'utf8')) as Record<string, unknown>
}

const builder = lerJson('electron-builder.json')
const pkg = lerJson('package.json')

/**
 * A linha dos 209 MB, escrita por extenso e comparada por igualdade.
 *
 * `claude-agent-sdk-win32-x64` é `optionalDependency` do SDK: está instalado, entra na árvore de
 * produção que o `electron-builder` copia, e sem esta negação o artefato vai a ~580 MB sem ninguém
 * perceber — porque nada quebra. Ele não é procurado em runtime desde que a cadeia do
 * `claudeBin.ts` passou a preencher `pathToClaudeCodeExecutable`, que é a porta oficial do SDK e
 * curto-circuita o `require.resolve` interno.
 *
 * O `!` inicial faz parte da âncora, e não é decoração: `files` só pode ter **negações**. Uma
 * inclusão aqui substituiria o glob default que traz tudo, e derrubaria `node_modules/` inteiro —
 * levando junto o próprio `@anthropic-ai/claude-agent-sdk`, que o `externalizeDepsPlugin` mantém
 * fora do bundle de propósito porque ele spawna subprocesso.
 */
const NEGACAO_DO_BINARIO = '!**/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/**'

describe('empacotamento', () => {
  it('exclui o pacote nativo de 209 MB do artefato', () => {
    // `toContain` e não índice fixo: a ordem das outras negações é higiene e pode ser reordenada à
    // vontade. O que não pode é esta sumir.
    expect(builder.files).toContain(NEGACAO_DO_BINARIO)
  })

  it('o alvo do Windows é `dir`', () => {
    // D3. `portable` seria "um executável" ao pé da letra, mas descomprime ~370 MB no `%TEMP%` a
    // cada abertura — segundos de espera num app que se abre dezenas de vezes por dia. `dir` abre
    // instantâneo e deixa o `userData` no lugar de sempre.
    expect(builder.win).toEqual({ target: 'dir' })
  })

  it('`yarn package` compila antes de empacotar', () => {
    // É o que faz o CA-1 valer **a partir de um clone limpo**: `out/` é gitignored e não existe num
    // clone, então um `package` que só chamasse `electron-builder` empacotaria um `main` inexistente
    // — e o erro apareceria como janela em branco, não como build vermelho.
    const scripts = pkg.scripts as Record<string, string | undefined>
    const script = scripts.package

    expect(script).toBeDefined()

    const compila = script!.indexOf('electron-vite build')
    const empacota = script!.indexOf('electron-builder')

    expect(compila).toBeGreaterThanOrEqual(0)
    expect(empacota).toBeGreaterThanOrEqual(0)
    expect(compila).toBeLessThan(empacota)
  })

  it('a versão é a calver da tag, e não o `0.0.0` do esqueleto', () => {
    // D5. Sincronizada à mão no commit da release; esta canária guarda o **formato**, para que
    // "esqueci de bumpar" apareça como um zero-zero-zero óbvio nas propriedades do arquivo e não
    // como número plausível e errado.
    //
    // Sem os zeros à esquerda da tag (`v2026.09.09` → `2026.9.9`): `2026.09.09` **não é semver
    // válido** e o electron-builder recusa. É por isso que o padrão aceita `\d{1,2}` e não `\d{2}`.
    expect(pkg.version).not.toBe('0.0.0')
    expect(pkg.version).toMatch(/^\d{4}\.\d{1,2}\.\d{1,2}$/)
  })

  it('`productName` mora no electron-builder.json e **não** no package.json', () => {
    // D8, e a única canária desta lista que guarda uma **ausência** — o que a torna a mais fácil de
    // desfazer sem querer, porque acrescentar campo a `package.json` não parece perigoso.
    //
    // Onde ele estiver no `package.json`, `app.getName()` muda e `app.getPath('userData')` vai
    // junto: de `%APPDATA%\operations-center` para `%APPDATA%\Operations Center`. Os três arquivos
    // de estado que já vivem lá — `conversations.json`, `dangerous.json`, `preferences.json` —
    // ficariam **órfãos em silêncio**: o app abriria zerado, sem erro nenhum, e o README passaria a
    // mentir.
    expect(pkg).not.toHaveProperty('productName')

    // O outro lado da mesma decisão, e não uma canária a mais: sem o campo **aqui**, o executável
    // sairia como `operations-center.exe` e o CA-1 — que nomeia `Operations Center.exe` — falharia
    // por omissão. Apagar dos dois lugares não pode passar verde.
    expect(builder.productName).toBe('Operations Center')
  })
})
