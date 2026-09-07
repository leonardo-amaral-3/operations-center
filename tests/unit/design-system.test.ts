import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
