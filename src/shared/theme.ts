/**
 * As combinações de cores que `src/renderer/index.css` declara. A ordem é a da folha.
 *
 * Mora em `src/shared/` porque as três camadas precisam do mesmo nome: o main resolve `OC_THEME`, o
 * preload lê a flag de `process.argv`, e o renderer recebe o valor pela ponte. Um enum por camada
 * seria três listas que divergem no dia em que a quarta combinação nascer.
 */
export const THEMES = ['lavanda', 'ametista', 'obsidiana'] as const

export type Theme = (typeof THEMES)[number]

/** A combinação de origem, a do #8. É o que `index.html` carrega e o que o app abre sem `OC_THEME`. */
export const THEME_DEFAULT: Theme = 'lavanda'

/**
 * Como o main conta ao preload qual combinação vale, via `additionalArguments`.
 *
 * Compartilhada — e não escrita duas vezes como `--oc-screen=`, que hoje é literal no main
 * (`index.ts:112`) e constante no preload (`index.ts:27`). Não é hora de consertar o `--oc-screen=`:
 * ele está fora do escopo deste card. É hora de não repetir a fraqueza dele numa flag nova.
 */
export const THEME_FLAG = '--oc-theme='

/** Um valor qualquer é uma combinação declarada? O portão que main e preload compartilham. */
export function isTheme(value: string | undefined): value is Theme {
  // `some` e não `THEMES.includes(value as Theme)`: o `includes` de uma tupla `as const` só aceita o
  // tipo estreito, e a asserção que o faria compilar é justamente a que este predicado existe para
  // tornar desnecessária no resto do código.
  return THEMES.some((theme) => theme === value)
}
