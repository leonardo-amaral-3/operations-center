import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path/posix'

/**
 * Todo `<dir>/<comando>` executável do PATH, **na ordem do PATH**: o `which -a` feito no processo.
 *
 * Não spawna `which`: nem toda distro o tem, e `command -v` exige shell. O `node:path/posix` é
 * explícito porque o teste roda no CI ubuntu e na máquina Windows, e o separador do PATH POSIX é
 * `:` nos dois. Só entram entradas absolutas: no POSIX a entrada vazia e as relativas (`.`, `bin`)
 * dependem da pasta em que o app foi aberto, e o `ResolvedPreset.shell` exige caminho absoluto
 * (`terminalPresets.ts:18-19`).
 *
 * Sem deduplicação: o PATH do lançador repete `~/.local/share/mise/shims`, e o primeiro vence do
 * mesmo jeito.
 */
export function procurarNoPath(
  comando: string,
  path: string | undefined,
  executavel: (caminho: string) => boolean,
): string[] {
  return (path ?? '')
    .split(delimiter)
    .filter((dir) => isAbsolute(dir))
    .map((dir) => join(dir, comando))
    .filter(executavel)
}

/** Arquivo regular (segue symlink: o shim do mise é um) com permissão de execução. */
export function ehExecutavel(caminho: string): boolean {
  try {
    if (!statSync(caminho).isFile()) return false
    accessSync(caminho, constants.X_OK)

    return true
  } catch {
    return false
  }
}
