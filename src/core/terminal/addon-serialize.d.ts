/**
 * O pedaço do `@xterm/addon-serialize` que o `ScreenMirror` usa, tipado à mão.
 *
 * Os typings do pacote importam `@xterm/xterm`, que traz `/// <reference lib="dom"/>` — e o
 * programa do Node (`tsconfig.node.json`) não tem a lib `dom` de propósito (ver o comentário do
 * smoke `card-chat`, que tipa o DOM à mão). O `paths` do `tsconfig.node.json` aponta o pacote para
 * este arquivo, e o DOM não entra por esta porta. Só o typecheck é afetado: em runtime vale o pacote.
 */
export declare class SerializeAddon {
  activate(terminal: unknown): void
  dispose(): void
  serialize(options?: { scrollback?: number }): string
}
