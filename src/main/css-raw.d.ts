/**
 * O `?raw` do Vite, declarado à mão: este programa não carrega `vite/client` (`types: ["node"]`), e
 * sem isto o `import` da folha em `theme.ts` não compila.
 */
declare module '*.css?raw' {
  const conteudo: string
  export default conteudo
}
