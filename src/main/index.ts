import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SettingSource } from '@anthropic-ai/claude-agent-sdk'
import { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell } from 'electron'

import {
  BoardReader,
  CardReader,
  ConversationIndex,
  DangerIndex,
  RepoIndex,
  SessionHost,
} from '../core'
import type { GraphQLFn } from '../core'
import { IPC_INVOKE } from '../shared/ipc'
import type { ChooseFolderRequest, ChooseFolderResult, Screen } from '../shared/ipc'
import { THEME_FLAG } from '../shared/theme'
import { registerBoardIpc } from './board'
import type { BoardIpcOptions } from './board'
import { registerCardIpc } from './card'
import {
  inspectSession,
  loadConversations,
  readTranscript,
  registerConversationIpc,
  saveConversations,
} from './conversations'
import { loadDangerous, registerDangerIpc, saveDangerous } from './danger'
import { createFixtureGraphQL } from './github/fixture'
import { createGitHubGraphQL } from './github/graphql'
import { createGhTokenSource } from './github/token'
import { registerSessionIpc } from './ipc'
import { judgeNavigation } from './navigation'
import { gitOrigin, scanSessionFolders } from './repos'
import { resolveTheme, windowBackground } from './theme'

/**
 * A pasta de trabalho da sessão **sem cartão** — a da fatia vertical. Sem `OC_CWD`, é a raiz do repo:
 * o app aberto sobre si mesmo, que é o que faz `yarn dev` ser útil no primeiro segundo. O smoke
 * aponta para um diretório temporário.
 *
 * A sessão de um cartão não passa por aqui: a pasta dela sai do repo do card, pelo `RepoIndex`.
 */
function resolveCwd(): string {
  return process.env.OC_CWD ?? app.getAppPath()
}

/** `OC_MODEL` vazia é o mesmo que ausente: quem decide o modelo passa a ser o Claude Code. */
function resolveModel(): string | undefined {
  return process.env.OC_MODEL || undefined
}

/**
 * `OC_ISOLATED=1` derruba as fontes de configuração para `[]`.
 *
 * Existe para o smoke: sem carregar as settings pessoais, nenhuma allowlist pode pré-aprovar a
 * ferramenta e fazer o pedido de permissão não aparecer — um falso-verde silencioso. Fora do smoke
 * a variável não deve ser usada: uma sessão sem `CLAUDE.md` é um Claude Code amputado, e é por isso
 * que ausente significa "vale o default do `SessionHost`", não "isolada".
 */
function resolveSettingSources(): SettingSource[] | undefined {
  return process.env.OC_ISOLATED === '1' ? [] : undefined
}

/**
 * Qual tela o app abre. `OC_SCREEN=chat` é porta de ambiente sem representação na UI: existe para o
 * smoke da fatia vertical continuar provando renderer ↔ main ↔ core ↔ SDK. Qualquer outro valor
 * abre o kanban, que é o app.
 */
function resolveScreen(): Screen {
  return process.env.OC_SCREEN === 'chat' ? 'chat' : 'kanban'
}

/** Qual board ler. O default é o Operations Center; o mesmo binário serve outro board pelo ambiente. */
function resolveBoard(): BoardIpcOptions {
  const raw = process.env.OC_PROJECT_NUMBER
  const number = raw === undefined || raw === '' ? 2 : Number(raw)

  // Valor inválido **lança**, em vez de cair no default: abrir o board 2 com toda a confiança do
  // mundo quando pediram outro é o pior modo de falha que existe aqui.
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`OC_PROJECT_NUMBER inválido: ${String(raw)}`)
  }

  return { owner: process.env.OC_PROJECT_OWNER || 'leonardo-amaral-3', number }
}

/**
 * Qual cliente o `core` recebe. `OC_BOARD_FIXTURE` é a porta do smoke: com ela o app lê arquivo e
 * não toca a rede; sem ela, é o GitHub de verdade, com o token do `gh`.
 *
 * `OC_CARD_FIXTURE` é a metade do conteúdo, e **só é consultada quando a do board existe**: fora do
 * smoke não há fixture nenhuma, e uma fixture de card sozinha só poderia servir cartões que o board
 * de verdade nunca prometeu.
 */
function createGraphQL(): GraphQLFn {
  const board = process.env.OC_BOARD_FIXTURE

  return board
    ? createFixtureGraphQL({ board, cards: process.env.OC_CARD_FIXTURE })
    : createGitHubGraphQL(createGhTokenSource())
}

const screen = resolveScreen()
const theme = resolveTheme(process.env.OC_THEME)
// A cor calculada **no topo do módulo**, e não dentro de `createWindow`: aquela função roda dentro
// do `void app.whenReady().then(...)` lá embaixo, e o `void` é justamente o que faria um `throw`
// dali virar rejeição não tratada em vez de derrubar a subida. Aqui, folha malformada ou combinação
// sem `--background` param o app antes de existir janela — que é a hora certa de reclamar.
const windowColor = windowBackground(theme)

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    // A cor da janela sai da folha do design system, convertida para sRGB — nunca escrita aqui. Sem
    // ela o Chromium pinta a janela de branco antes do primeiro paint do renderer e a abertura
    // pisca; com um hex à mão, ela pisca no dia em que a folha mudar e ninguém lembrar deste
    // arquivo.
    backgroundColor: windowColor,
    show: false,
    autoHideMenuBar: true,
    title: 'Operations Center',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Como o preload sabe qual tela desenhar e qual combinação de cores vale. É o mecanismo
      // documentado do Electron para passar dados ao preload e funciona com `sandbox: true` — ler
      // `process.env` lá dentro não.
      additionalArguments: [`--oc-screen=${screen}`, `${THEME_FLAG}${theme}`],
      // O renderer nunca vê Node. Toda capacidade dele passa pelo contrato do preload.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  // `||` e não `??`: variável vazia já significava "sem dev server" para o `loadURL` abaixo, e as
  // duas decisões precisam concordar — um `appUrl` que discordasse da URL realmente carregada
  // julgaria a própria janela como forasteira e barraria a recarga dela.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL || undefined
  const indexFile = join(__dirname, '../renderer/index.html')
  // Contra o que uma navegação é julgada própria ou de fora.
  const appUrl = devServerUrl ?? pathToFileURL(indexFile).href

  // Um `target="_blank"` do markdown cai aqui. **Sempre `deny`**: o app tem uma janela só, e uma
  // segunda seria um navegador sem barra de endereço dentro do Operations Center.
  window.webContents.setWindowOpenHandler(({ url }) => {
    const verdict = judgeNavigation(url, appUrl)
    if (verdict.kind === 'external') void shell.openExternal(verdict.url)

    return { action: 'deny' }
  })

  // A rede de segurança: um `<a>` sem `target`, um arrastar-e-soltar de URL na janela, ou qualquer
  // código futuro que tente navegar. Sem ela a janela vira o site clicado — sem menu bar
  // (`autoHideMenuBar: true` acima) e sem caminho de volta.
  window.webContents.on('will-navigate', (event, url) => {
    const verdict = judgeNavigation(url, appUrl)
    if (verdict.kind === 'internal') return

    event.preventDefault()
    if (verdict.kind === 'external') void shell.openExternal(verdict.url)
  })

  // `loadURL`/`loadFile` são programáticos e **não** disparam `will-navigate`: só o que o renderer
  // inicia passa pela guarda acima.
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(indexFile)
  }

  // Devolvida porque é nela que o gatilho de foco se pendura — o observador do board precisa de uma
  // referência à janela, e sem isto não haveria onde.
  return window
}

// O main é dono do `core`: é ele que tem o `query` do SDK, o ambiente e o processo Node. O host é
// criado antes da janela para que nenhum `invoke` chegue a um canal ainda não registrado.
const host = new SessionHost({
  query,
  model: resolveModel(),
  settingSources: resolveSettingSources(),
})

// **O IPC de board só é registrado no kanban.** Assim o smoke da fatia vertical (`OC_SCREEN=chat`)
// não tem como tocar o GitHub nem por acidente: o determinismo dele fica garantido por construção,
// e não por disciplina de quem escreve o teste.
const boardIpc =
  screen === 'kanban'
    ? registerBoardIpc(new BoardReader({ graphql: createGraphQL() }), resolveBoard())
    : null

// O conteúdo de um card corre pelo mesmo portão, e pela mesma razão: é leitura do GitHub. Sem
// retrato de board não há como traduzir `itemId` em coordenada, então fora do kanban o canal
// simplesmente não existe.
if (boardIpc) {
  // `createGraphQL()` de novo, devolvendo um segundo cliente: ela não guarda estado, e o
  // `TokenSource` do `gh` tem cache próprio. Um cliente por leitor mantém a injeção explícita e não
  // introduz um singleton.
  registerCardIpc(new CardReader({ graphql: createGraphQL() }), {
    // Arrow, e **não** `cardById: boardIpc.cardById`: o `unbound-method` do ESLint reprova a
    // referência solta a um método — mesmo aqui, onde ela funcionaria, porque `cardById` fecha
    // sobre o retrato e não sobre `this`.
    cardById: (itemId) => boardIpc.cardById(itemId),
  })
}

// O mapa `repo → pasta local` do RF-10. As duas pontas de IO são do main: o core não lê disco nem
// spawna processo.
const repos = new RepoIndex({ scan: scanSessionFolders(), origin: gitOrigin })

// Em paralelo à janela, como a primeira leitura do board: o índice fica pronto antes do primeiro
// clique num cartão. Só no kanban — a tela de chat roda em `OC_CWD` e não consulta o índice, e a
// varredura ali seria um `git` por pasta de sessão da máquina para ninguém.
if (screen === 'kanban') void repos.refresh()

// O único dado durável do app. As quatro pontas de IO são do main pela mesma razão das do
// `RepoIndex`: o core não lê disco nem chama o SDK.
const conversations = new ConversationIndex({
  load: loadConversations,
  save: saveConversations,
  inspect: inspectSession,
  transcript: readTranscript,
  // Referência para a frente de propósito: o índice não conhece Electron, e quem publica pela
  // ponte é o main. O callback só roda quando algo muda, muito depois das duas declarações.
  onChange: publicarConversas,
})

// **Só no kanban**, pela mesma razão de `repos.refresh()`: a tela de chat não tem cartão, e
// verificar vínculo de cartão nenhum é trabalho para ninguém.
const conversationIpc = screen === 'kanban' ? registerConversationIpc(conversations) : null

// Em paralelo à janela, como a primeira leitura do board: a verificação do que está gravado começa
// antes de o renderer pedir o primeiro retrato, e o `onChange` corrige a tela quando ela terminar.
conversationIpc?.refresh()

function publicarConversas(): void {
  conversationIpc?.publish()
}

// O segundo dado durável do app, em arquivo próprio — ver `src/main/danger.ts` para o porquê de não
// ser mais uma chave no `conversations.json`. As duas pontas de IO são do main pela mesma razão das
// do `ConversationIndex`: o core não lê disco.
const danger = new DangerIndex({
  load: loadDangerous,
  save: saveDangerous,
  // Referência para a frente, como a de `publicarConversas`: o índice não conhece Electron.
  onChange: publicarPerigo,
})

// **Só no kanban**, pela mesma razão do de conversas: a tela de chat não tem cartão, e é ela quem
// mantém o portão de hoje sem exceção (decisão 13). Sem este registro, o canal de leitura da marca
// simplesmente não existe lá.
const dangerIpc = screen === 'kanban' ? registerDangerIpc(danger) : null

// Em paralelo à janela, como a primeira leitura do board: o disco é lido antes de o renderer pedir o
// primeiro retrato, e o `onChange` corrige a tela quando ele responder.
dangerIpc?.refresh()

function publicarPerigo(): void {
  dangerIpc?.publish()
}

const sessionIpc = registerSessionIpc(host, {
  conversations,
  danger,
  resolveCwd: async (itemId) => {
    if (itemId === undefined) return resolveCwd()

    const card = boardIpc?.cardById(itemId)
    if (!card) return null

    let path = repos.pathFor(card.repository)

    if (path === null) {
      // Segunda chance antes de desistir: um repo clonado com o app aberto, ou uma sessão criada
      // depois da varredura inicial, é achado sem incomodar ninguém. O `refresh()` tem guarda de
      // concorrência, então um segundo clique durante a varredura pega carona nela.
      await repos.refresh()
      path = repos.pathFor(card.repository)
    }

    // A pasta pode ter sido movida ou apagada entre a varredura e o clique. Melhor cair no CA-5 e
    // pedir a pasta do que mandar o Claude Code para um caminho que não existe mais.
    return path !== null && existsSync(path) ? path : null
  },
})

/**
 * O seletor de diretório do CA-5.
 *
 * Mora no main — e não no `registerSessionIpc` — porque a peça que ele opera é o índice de repos, e
 * porque `dialog` é Electron puro. O caminho escolhido **não volta ao renderer**: fica no índice, e
 * o `start({ itemId })` seguinte já o encontra.
 */
ipcMain.handle(
  IPC_INVOKE.chooseFolder,
  async (event, request: ChooseFolderRequest): Promise<ChooseFolderResult> => {
    const card = boardIpc?.cardById(request.itemId)
    if (!card) return { chosen: false }

    // Preso à janela que perguntou: o seletor é modal dela, e não uma caixa solta que se perde atrás
    // do app enquanto o cartão espera uma resposta que ninguém vê como dar.
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await (window
      ? dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }))
    const [path] = result.filePaths

    if (result.canceled || path === undefined) return { chosen: false }

    // Só em memória, nunca em disco: assim que a sessão subir ali, o Claude Code escreve o
    // transcript e a varredura da próxima abertura acha a pasta sozinha.
    repos.declare(card.repository, path)

    return { chosen: true }
  },
)

void app.whenReady().then(() => {
  const window = createWindow()
  if (!boardIpc) return

  // Em paralelo à criação da janela: a leitura começa antes de o renderer pedir.
  boardIpc.refresh()

  // Os dois gatilhos moram aqui dentro porque o `powerMonitor` do Electron só pode ser usado depois
  // do evento `ready` — registrá-lo no topo do módulo lança.
  window.on('focus', () => {
    boardIpc.refresh()
  })

  // Necessário além do `focus`: quando a máquina acorda, a janela costuma já estar em foco e nenhum
  // evento de foco dispara. Sem ele, quem nunca fecha o app começaria a manhã com o board de ontem.
  powerMonitor.on('resume', () => {
    boardIpc.refresh()
  })
})

// Fechar a janela encerra o app — inclusive no macOS. Nada de histórico se perde: as sessões do
// Claude Code são resumíveis por id e os transcripts vivem em `~/.claude/projects/`.
//
// `closeAll()` não é esperado de propósito. A parte que importa dele é síncrona (nega o que estava
// pendente e fecha as filas de entrada); o que sobra é aguardar o subprocesso terminar o turno em
// andamento, e esperar por isso deixaria o app vivo sem janela nenhuma. A spec aceita o preço: um
// turno em andamento morre.
app.on('window-all-closed', () => {
  void sessionIpc.closeAll()
  app.quit()
})
