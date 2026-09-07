import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // `tests/smoke/` é spec do Playwright, não do Vitest. Sem esta exclusão o `yarn test`
    // tentaria executá-lo e quebraria o CI com um erro sem relação nenhuma com o código.
    exclude: ['tests/smoke/**', '**/node_modules/**', 'dist/**', 'out/**'],
  },
  // Explícito, e não herdado do tsconfig: o `tsconfig.json` da raiz é solution-style (`files: []`
  // mais referências), e depender de o esbuild resolver o `jsx` através dele é uma aposta
  // desnecessária.
  esbuild: { jsx: 'automatic' },
})
