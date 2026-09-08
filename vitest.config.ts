import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // `tests/smoke/` é spec do Playwright, não do Vitest. Sem esta exclusão o `yarn test`
    // tentaria executá-lo e quebraria o CI com um erro sem relação nenhuma com o código.
    exclude: ['tests/smoke/**', '**/node_modules/**', 'dist/**', 'out/**'],
    // O `?raw` da folha em `src/main/theme.ts` **falha em silêncio** sem esta linha. O `CSS_LANGS_RE`
    // do Vitest casa `index.css?raw` pelo ramo `(?:$|\?)` e, com o `css: false` que é o default,
    // entrega string vazia em vez do texto — o import resolve, ninguém reclama, e o vermelho só
    // aparece adiante acusando a folha, que está intacta. Restrito à folha de propósito, e não
    // `css: true` global: destrava o único arquivo que o main lê e deixa todo o resto do CSS com o
    // stub barato, que é o que mantém barato um teste futuro que importe componente com estilo.
    css: { include: [/src[\\/]renderer[\\/]index\.css/] },
  },
  // Explícito, e não herdado do tsconfig: o `tsconfig.json` da raiz é solution-style (`files: []`
  // mais referências), e depender de o esbuild resolver o `jsx` através dele é uma aposta
  // desnecessária.
  esbuild: { jsx: 'automatic' },
})
