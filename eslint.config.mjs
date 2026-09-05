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

/**
 * A outra fronteira: `src/shared/` é folha.
 *
 * É o único código que o renderer e o main compilam juntos. Um import de `electron`, do SDK, de um
 * builtin do Node ou de qualquer camada faria o programa do renderer resolver aquilo junto — que é
 * o oposto do que `contextIsolation` e `sandbox` compram. Manter a folha folha é o que permite o
 * contrato ser um só, e não dois que divergem.
 */
const sharedBoundary = {
  files: ['src/shared/**/*.ts'],
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              'electron',
              'electron/*',
              '@anthropic-ai/*',
              'node:*',
              '**/core/**',
              '**/main/**',
              '**/renderer/**',
              '**/preload/**',
            ],
            message:
              'src/shared/ é folha: o renderer compila este código. Nada de electron, do SDK, de builtins do Node nem de outra camada aqui.',
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
  sharedBoundary,
  prettier,
)
