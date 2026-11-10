/**
 * Onde está o `claude` que a sessão vai spawnar — o lado sujo da descoberta, com as pontas
 * injetadas.
 *
 * O SDK tem uma porta oficial para isto, `pathToClaudeCodeExecutable`, e quando ela vem preenchida
 * o `require.resolve` interno dele **nunca roda**. É isso que permite ao empacotamento excluir o
 * `claude-agent-sdk-win32-x64` de 209 MB sem que ninguém procure por ele: o app usa o Claude Code
 * que a máquina já tem, e não uma segunda cópia carregada dentro do artefato.
 *
 * A consequência dura, que é o que desenha a cadeia inteira: o SDK spawna o caminho **direto, sem
 * shell**, e o Node ≥ 20 recusa spawnar `.cmd`/`.bat` assim (`EINVAL`). Apontar para o `claude.cmd`
 * do PATH — o caminho óbvio, e errado — quebraria toda sessão. Por isso todo degrau abaixo termina
 * num `.exe` de verdade, e nunca no shim.
 *
 * **Duas cadeias**, escolhidas por `probes.platform`. A do Windows (`where`, `.exe`, `.cmd`) é a
 * descrita acima. A do POSIX é mais curta: devolve o primeiro `claude` executável do PATH **sem
 * `realpath`**, porque o shim do mise decide pelo próprio nome (o `realpath` dele daria
 * `/usr/bin/mise`, que não é o claude) e spawnado direto ele funciona (medido: M13/M14 do card
 * #118, `2.1.319` em 43 ms). Não há `.cmd` no POSIX, então não há o que derivar.
 *
 * Na cadeia do Windows, os caminhos são tratados por `node:path/win32` e não pelo `node:path` do sistema: as linhas
 * que o `where` devolve são sempre caminhos do Windows, e o `dirname` do POSIX não reconhece a
 * barra invertida — colapsaria `C:\…\npm\claude.cmd` em `.` e derivaria um caminho relativo que não
 * existe em lugar nenhum. Em produção os dois coincidem, porque lá o sistema é Windows; quem vê a
 * diferença é o teste, que roda no CI em ubuntu. Sem o `win32` explícito ele passaria nesta máquina
 * e falharia lá — o vermelho mais caro que existe, porque chega longe de quem o causou.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join as joinPosix } from 'node:path/posix'
import { dirname, extname, join } from 'node:path/win32'

import { ehExecutavel, procurarNoPath } from './pathLookup'

export const CLAUDE_AUSENTE =
  'Claude Code não encontrado. Instale-o (`npm i -g @anthropic-ai/claude-code`) ou aponte ' +
  '`OC_CLAUDE_BIN` para o claude.exe.'

export const CLAUDE_AUSENTE_POSIX =
  'Claude Code não encontrado no PATH. Instale-o (`npm i -g @anthropic-ai/claude-code`) ou aponte ' +
  '`OC_CLAUDE_BIN` para o executável do claude.'

export function claudeBinInvalido(caminho: string): string {
  return `OC_CLAUDE_BIN aponta para ${caminho}, que não existe.`
}

/**
 * O layout do `npm -g` a partir do diretório do shim, e é dele que o `.exe` é derivado.
 *
 * **Derivar, e não ler o `.cmd`.** O shim tem forma estável e conhecida
 * (`"%~dp0\node_modules\@anthropic-ai\claude-code\bin\claude.exe" %*`), mas lê-lo seria parsear um
 * arquivo gerado por outra ferramenta — que muda quando o npm quiser. O **diretório** do shim, esse
 * é contrato do `npm -g` há anos.
 */
const LAYOUT_NPM = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'] as const

/** As pontas sujas, injetadas — é o que faz a cadeia testável sem máquina de verdade. */
export interface ClaudeBinProbes {
  env: Record<string, string | undefined>
  home: string
  exists(caminho: string): boolean
  platform: NodeJS.Platform
  /**
   * As linhas do `where <cmd>` (Windows) ou os executáveis do PATH (POSIX), na ordem em que foram
   * devolvidos. `[]` quando não achou nada.
   */
  which(comando: string): readonly string[]
}

/**
 * O `claude` desta máquina, pelos três degraus da cadeia do sistema, nesta ordem.
 *
 * **A ordem é contrato**, e é a mesma do `resolveCwd` e do `#declared` do `RepoIndex`: a escolha do
 * humano vence a descoberta, e a descoberta vence o palpite.
 *
 * 1. `OC_CLAUDE_BIN`, se declarada (igual nos dois sistemas).
 * 2. O que o `where claude` achar — o mesmo Claude Code que o terminal roda, que é o que torna
 *    observável a diferença de versão entre o CLI da máquina e o que o SDK embutia. No POSIX, o
 *    primeiro executável `claude` do PATH, como veio.
 * 3. `~/.local/bin/claude.exe`, o caminho do instalador nativo, que **não entra no PATH**. No POSIX,
 *    `~/.local/bin/claude`.
 *
 * Lança quando nenhum responde, e a mensagem é a que a tela desenha: o `throw` sai daqui, atravessa
 * o `start()` do host, rejeita o `invoke` do IPC e vira o `reason` do estado `failed`.
 */
export function resolveClaudeBin(probes: ClaudeBinProbes): string {
  const declarado = declaredBin(probes)
  if (declarado !== null) return declarado

  if (probes.platform !== 'win32') return resolvePosix(probes)

  const doPath = pathBin(probes)
  if (doPath !== null) return doPath

  const nativo = join(probes.home, '.local', 'bin', 'claude.exe')
  if (probes.exists(nativo)) return nativo

  throw new Error(CLAUDE_AUSENTE)
}

/**
 * A cadeia do POSIX, depois da variável. Sem derivação e sem pulo por extensão: o que o PATH achou
 * é executável e serve como veio.
 */
function resolvePosix(probes: ClaudeBinProbes): string {
  for (const linha of probes.which('claude')) {
    if (probes.exists(linha)) return linha
  }

  // O layout do instalador nativo no Linux. Nesta máquina esse caminho é um wrapper do mise
  // (`mise use -g … && exec mise x claude`, M13): só é alcançado com o PATH sem nenhum `claude`, e
  // aí o comportamento é o do wrapper, não do app.
  const nativo = joinPosix(probes.home, '.local', 'bin', 'claude')
  if (probes.exists(nativo)) return nativo

  throw new Error(CLAUDE_AUSENTE_POSIX)
}

/**
 * O primeiro degrau: a variável.
 *
 * **Apontando para o nada, lança — e não cai para o degrau seguinte.** É a regra do `OC_THEME`, e
 * pela mesma razão: variável que aponta para o nada é engano de quem a exportou, e resolver por
 * baixo dela esconderia o engano atrás de um app que funciona "às vezes". Vazia, aí sim, é ausente:
 * `OC_CLAUDE_BIN=` num `.env` esquecido não deve derrubar nada.
 */
function declaredBin(probes: ClaudeBinProbes): string | null {
  const caminho = probes.env.OC_CLAUDE_BIN?.trim()

  if (caminho === undefined || caminho === '') return null
  if (probes.exists(caminho)) return caminho

  throw new Error(claudeBinInvalido(caminho))
}

/**
 * O segundo degrau: o PATH, linha a linha, **na ordem em que o `where` as devolveu**.
 *
 * A ordem é a do próprio `where`, que é a de precedência do PATH — reordenar aqui faria o app rodar
 * um Claude Code diferente do que o terminal roda, que é justamente o que este degrau existe para
 * evitar.
 */
function pathBin(probes: ClaudeBinProbes): string | null {
  for (const linha of probes.which('claude')) {
    const candidato = candidatoDe(linha)

    if (candidato !== null && probes.exists(candidato)) return candidato
  }

  return null
}

/**
 * O `.exe` que uma linha do `where` promete, ou `null` quando ela não promete nenhum.
 *
 * O `where claude` devolve três formas, e só duas servem: o `.exe` (usável direto), o `.cmd` (shim,
 * de onde o `.exe` se deriva) e o shim de bash **sem extensão**, que o `CreateProcess` não sabe
 * executar. Este último é pulado pela extensão e não pela existência — ele existe, e ainda assim
 * não serve.
 */
function candidatoDe(linha: string): string | null {
  switch (extname(linha).toLowerCase()) {
    case '.exe':
      return linha
    case '.cmd':
      return join(dirname(linha), ...LAYOUT_NPM)
    default:
      return null
  }
}

/**
 * A cadeia como thunk **síncrono e memoizado**, no desenho do `createGhTokenSource()`.
 *
 * Síncrono é escolha, não descuido: o `SessionHandle` monta o `query()` dentro do próprio
 * construtor e sem `await`, porque o retrato que o `start` devolve é lido pela tela na mesma volta.
 * Tornar a resolução assíncrona mudaria esse contrato, que é de outro card. O custo real é um
 * `execFileSync` de dezenas de milissegundos, **uma vez por execução**, na primeira sessão — nunca
 * na subida da janela.
 */
export function createClaudeBinSource(probes: ClaudeBinProbes = probesDeProducao()): () => string {
  let resolvido: string | null = null

  return (): string => {
    // Guarda **só o sucesso**: quando `resolveClaudeBin` lança, `resolvido` continua `null` e a
    // próxima chamada tenta de novo. É o que permite instalar o Claude Code com o app já aberto e
    // clicar outra vez — cachear a falha obrigaria a reiniciar o app para sair dela.
    resolvido ??= resolveClaudeBin(probes)

    return resolvido
  }
}

function probesDeProducao(): ClaudeBinProbes {
  return {
    env: process.env,
    platform: process.platform,
    home: homedir(),
    exists: existsSync,
    which: (comando) => {
      if (process.platform !== 'win32') {
        return procurarNoPath(comando, process.env.PATH, ehExecutavel)
      }

      try {
        // `where` é do System32 e sempre existe no Windows. Sem `shell`, pela mesma razão do
        // `token.ts`: nada aqui precisa de interpretação de metacaractere.
        return execFileSync('where', [comando], { encoding: 'utf8' })
          .split(/\r?\n/)
          .map((linha) => linha.trim())
          .filter((linha) => linha !== '')
      } catch {
        // `where` sai com 1 quando não acha. Para a cadeia, "não achou" e "não deu para perguntar"
        // dizem a mesma coisa — a mesma tolerância do `gitOrigin` em `repos.ts`.
        return []
      }
    },
  }
}
