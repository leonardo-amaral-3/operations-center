import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

/**
 * A regra que importa aqui é a fronteira do `core`.
 *
 * `src/core/` é o host de sessões e precisa continuar agnóstico de casca: trocar Electron por
 * outra casca deve ser aditivo (um novo `main`), não reescrita. Uma convenção escrita no README
 * envelhece; esta regra quebra o lint.
 */
const coreBoundary = {
  files: ['src/core/**/*.ts', 'src/core/**/*.tsx'],
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['electron', 'electron/*', 'electron/**'],
            message:
              'O core é agnóstico de casca: nada de `electron` aqui. Quem fala com o Electron é src/main/.',
          },
          {
            group: [
              '**/main/**',
              '**/renderer/**',
              '**/preload/**',
              '**/src/main',
              '**/src/renderer',
              '**/src/preload',
            ],
            message:
              'O core não conhece a casca. A dependência corre no sentido main/renderer → core, nunca ao contrário.',
          },
        ],
      },
    ],
  },
}

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  coreBoundary,
  prettier,
)
