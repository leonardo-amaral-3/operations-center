import { describe, expect, it } from 'vitest'

import {
  CLAUDE_AUSENTE,
  claudeBinInvalido,
  createClaudeBinSource,
  resolveClaudeBin,
  type ClaudeBinProbes,
} from '../../src/main/claudeBin'

/**
 * A cadeia de descoberta do `claude.exe` (card #56, D2) — a ordem dos degraus, não o disco.
 *
 * Cada caso abaixo dirige `resolveClaudeBin` com probes falsas: sem `existsSync`, sem spawnar
 * `where`. É o mesmo arranjo de `navigation.test.ts` — o lado sujo fica nas bordas, injetado, e o
 * que sobra no meio é uma função pura que se pode interrogar caso a caso.
 *
 * O que estes casos protegem é uma **ordem**, e ordem é o tipo de coisa que sobrevive a refatoração
 * sem ninguém notar que inverteu. Por isso vários casos não afirmam só "achou o certo": afirmam
 * também que o degrau seguinte **não foi consultado** (`chamadas` vazia), que é a única forma de
 * distinguir "venceu" de "coincidiu".
 *
 * Os caminhos são os medidos nesta máquina, e são caminhos do Windows de propósito, porque é o que
 * o `where` devolve. O CI roda em ubuntu: se o código voltar a usar o `node:path` do sistema em vez
 * do `node:path/win32`, é aqui que o vermelho aparece.
 */

/** O diretório do `npm -g` nesta máquina — de onde o `.cmd` deriva o `.exe`. */
const NPM = 'C:\\Users\\lokin\\AppData\\Roaming\\npm'

/** O shim de bash, sem extensão: existe, e ainda assim não serve. */
const NPM_SHIM = `${NPM}\\claude`
const NPM_CMD = `${NPM}\\claude.cmd`

/** O que a derivação pelo layout do npm tem de produzir a partir de `NPM_CMD`. */
const NPM_EXE = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`

const HOME = 'C:\\Users\\lokin'

/** O caminho do instalador nativo — o terceiro degrau, que não entra no PATH. */
const NATIVO = `${HOME}\\.local\\bin\\claude.exe`

const DECLARADO = 'D:\\ferramentas\\claude.exe'

interface Cenario {
  env?: Record<string, string | undefined>
  /** Os caminhos que "existem" em disco. Mutável: o caso 11 instala o Claude Code no meio do teste. */
  existentes?: readonly string[]
  /** O que o `where claude` devolve, na ordem. */
  where?: readonly string[]
}

function cenario({ env = {}, existentes = [], where = [] }: Cenario = {}) {
  const existe = new Set(existentes)
  const chamadas: string[] = []

  const probes: ClaudeBinProbes = {
    env,
    home: HOME,
    exists: (caminho) => existe.has(caminho),
    which: (comando) => {
      chamadas.push(comando)

      return where
    },
  }

  return { probes, chamadas, existe }
}

describe('resolveClaudeBin — degrau 1: OC_CLAUDE_BIN', () => {
  it('vence tudo, inclusive um PATH que responderia', () => {
    // O PATH aqui tem um `.exe` perfeitamente usável. A variável ainda assim ganha, e a `chamadas`
    // vazia é o que prova que ganhou por precedência e não por sorte: o `where` nem foi perguntado.
    const { probes, chamadas } = cenario({
      env: { OC_CLAUDE_BIN: DECLARADO },
      existentes: [DECLARADO, NPM_EXE],
      where: [NPM_CMD],
    })

    expect(resolveClaudeBin(probes)).toBe(DECLARADO)
    expect(chamadas).toEqual([])
  })

  it('lança quando aponta para caminho que não existe, e não cai para o PATH', () => {
    // O degrau 2 responderia — e é justamente por isso que este caso existe. Cair para ele
    // resolveria por baixo de quem exportou a variável errada, e o app funcionaria escondendo o
    // engano. A regra é a do `OC_THEME`: erro de configuração aparece.
    const { probes, chamadas } = cenario({
      env: { OC_CLAUDE_BIN: DECLARADO },
      existentes: [NPM_EXE, NATIVO],
      where: [NPM_CMD],
    })

    expect(() => resolveClaudeBin(probes)).toThrow(claudeBinInvalido(DECLARADO))
    expect(chamadas).toEqual([])
  })

  it('trata a variável vazia como ausente e segue para o PATH', () => {
    // `OC_CLAUDE_BIN=` num `.env` esquecido não é uma escolha, é um resto. Não deve derrubar nada.
    const { probes } = cenario({
      env: { OC_CLAUDE_BIN: '' },
      existentes: [NPM_EXE],
      where: [NPM_CMD],
    })

    expect(resolveClaudeBin(probes)).toBe(NPM_EXE)
  })
})

describe('resolveClaudeBin — degrau 2: o PATH', () => {
  it('pula o shim sem extensão e deriva o `.exe` do layout do npm a partir do `.cmd`', () => {
    // O shim sem extensão **existe** neste cenário, de propósito: se ele fosse pulado por não
    // existir, este teste passaria por acidente. Ele é pulado pela extensão — o `CreateProcess`
    // não sabe executá-lo, exista ou não.
    const { probes, chamadas } = cenario({
      existentes: [NPM_SHIM, NPM_EXE],
      where: [NPM_SHIM, NPM_CMD],
    })

    expect(resolveClaudeBin(probes)).toBe(NPM_EXE)
    expect(chamadas).toEqual(['claude'])
  })

  it('usa um `.exe` do PATH direto, sem derivar nada', () => {
    const exeDireto = 'C:\\Program Files\\claude\\claude.exe'
    const { probes } = cenario({ existentes: [exeDireto], where: [exeDireto] })

    expect(resolveClaudeBin(probes)).toBe(exeDireto)
  })

  it('segue para o degrau seguinte quando o `.exe` derivado do `.cmd` não existe', () => {
    // O `.cmd` está no PATH, mas o pacote por trás dele foi removido: a derivação aponta para um
    // caminho que não existe. Não é motivo para lançar — é motivo para continuar procurando.
    const { probes } = cenario({ existentes: [NPM_CMD, NATIVO], where: [NPM_CMD] })

    expect(resolveClaudeBin(probes)).toBe(NATIVO)
  })

  it('reconhece `CLAUDE.CMD` em maiúsculas', () => {
    // O PATH do Windows não tem caixa canônica, e a comparação é `toLowerCase()`. Sem este caso,
    // trocar o `toLowerCase()` por comparação direta passaria despercebido nesta máquina.
    const { probes } = cenario({ existentes: [NPM_EXE], where: [`${NPM}\\CLAUDE.CMD`] })

    expect(resolveClaudeBin(probes)).toBe(NPM_EXE)
  })
})

describe('resolveClaudeBin — degrau 3 e o fim da cadeia', () => {
  it('cai no instalador nativo quando o `where` não devolve nada', () => {
    // O instalador nativo não entra no PATH desta máquina — medido. Este degrau é a única forma de
    // achá-lo, e é por isso que ele existe.
    const { probes } = cenario({ existentes: [NATIVO] })

    expect(resolveClaudeBin(probes)).toBe(NATIVO)
  })

  it('lança CLAUDE_AUSENTE quando nada responde em lugar nenhum', () => {
    // Metade do CA-5: esta string é a que a tela vai desenhar. A outra metade — o caminho até lá —
    // é a task 2. O que importa aqui é que a mensagem seja **do app**, nomeando `OC_CLAUDE_BIN` e o
    // que instalar, e não a do SDK, que mandaria reinstalar o pacote que o empacotamento exclui de
    // propósito.
    const { probes } = cenario({ where: [NPM_SHIM] })

    expect(() => resolveClaudeBin(probes)).toThrow(CLAUDE_AUSENTE)
  })
})

describe('createClaudeBinSource — o que o thunk guarda', () => {
  it('memoiza o sucesso: duas chamadas perguntam ao `where` uma vez só', () => {
    // O `where` é um subprocesso. Uma sessão por cartão pagaria dezenas de milissegundos cada, por
    // uma resposta que não muda.
    const { probes, chamadas } = cenario({ existentes: [NPM_EXE], where: [NPM_CMD] })
    const claudeBin = createClaudeBinSource(probes)

    expect(claudeBin()).toBe(NPM_EXE)
    expect(claudeBin()).toBe(NPM_EXE)
    expect(chamadas).toEqual(['claude'])
  })

  it('não memoiza a falha: instalar o Claude Code com o app aberto funciona sem reiniciar', () => {
    // O cenário é literal: a pessoa clica, vê a mensagem, instala o Claude Code, clica de novo. Se
    // a falha ficasse em cache, o segundo clique repetiria a mensagem e a única saída seria fechar
    // o app — que é o modo de falha que este caso existe para impedir.
    const { probes, existe } = cenario({ where: [NPM_CMD] })
    const claudeBin = createClaudeBinSource(probes)

    expect(() => claudeBin()).toThrow(CLAUDE_AUSENTE)

    existe.add(NPM_EXE)

    expect(claudeBin()).toBe(NPM_EXE)
  })
})
