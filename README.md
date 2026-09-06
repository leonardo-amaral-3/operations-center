# Operations Center

Centro operacional de gestão de desenvolvimento de **tarefas simultâneas do Claude Code**.

Projeto pessoal de [@leonardo-amaral-3](https://github.com/leonardo-amaral-3), usado dentro da
Notoria. Repositório privado.

Hoje o app abre um **kanban somente-leitura do board do GitHub**: uma coluna por estação da esteira,
um cartão por card, relido em silêncio quando a janela volta ao foco ou a máquina acorda — sem botão
de atualizar e sem polling. A tela de chat com o Claude Code existe inteira, mas atrás de
`OC_SCREEN=chat`: ela é a fatia vertical que provou o caminho `renderer ↔ main ↔ core ↔ SDK`, e é o
que o smoke daquela fatia percorre.

## Stack

App **desktop Electron + TypeScript**, com React e Tailwind na tela.

A escolha não é estética. O núcleo do produto é o
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
uma biblioteca Node que **spawna um processo `claude` por sessão** e conversa por stdio. O main
process do Electron _é_ Node — então o host de sessões roda nele direto, sem sidecar e sem uma
terceira linguagem no stack. A crítica de sempre ao Electron (carregar um runtime Node junto) é
exatamente o que o torna a escolha certa aqui.

| Camada          | O que vive lá                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`     | a lógica de produto agnóstica de casca: o host de sessões (fila de entrada, máquina de estados, `SessionHost`) e a leitura do board (`BoardReader`, com o cliente GraphQL injetado). Não conhece Electron, React nem HTTP, e uma regra de lint garante que continue assim |
| `src/main/`     | o processo Node: cria as sessões com o `query` real do SDK, pega o token com o `gh`, fala com a API do GitHub, lê o ambiente e registra os canais IPC                                                                                                                     |
| `src/preload/`  | o `contextBridge` — a única superfície que o renderer enxerga                                                                                                                                                                                                             |
| `src/renderer/` | React + Tailwind: o kanban (colunas, cartões e carimbo de frescor) e a tela de chat da fatia vertical                                                                                                                                                                     |
| `src/shared/`   | o contrato IPC e o vocabulário do board, compilados pelos dois lados                                                                                                                                                                                                      |

Build com `electron-vite` (Vite 7). Testes: Vitest nas unidades, Playwright + Electron nos smokes.

## Pré-requisitos

- **Node ≥ 22.13** (ou 24.x) e **yarn 1.22**
- **Claude Code instalado e logado** na máquina
- **GitHub CLI (`gh`) instalado e logado** (`gh auth login`)

O piso do Node não é redondo porque é uma interseção, não uma escolha: `electron@44` exige
`>= 22.12` e `eslint@10` exige `>= 22.13`. E a janela **pula os majors ímpares** — `vitest@5`
declara `^22.12 || ^24 || >=26`, então **Node 23 e 25 não servem**, mesmo sendo "maiores que 22.13".

O Claude Code não é conveniência: o app **não** usa `ANTHROPIC_API_KEY`. As sessões sobem com as
credenciais locais do CLI, e sem login a janela abre mas a sessão não anda.

O `gh` também não: é dele que vem o token que lê o board. O app o pede por subprocesso
(`gh auth token`) e **nunca persiste credencial** — o segredo continua no keyring do sistema, que é
onde o `gh` já o guarda. Sem `gh` no PATH ou sem login, a janela abre e o kanban mostra o erro no
lugar dos cartões.

## Comandos

| Comando          | O que faz                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn dev`       | sobe o app com hot reload do renderer                                                                                                                                                                                   |
| `yarn build`     | compila os três bundles (main, preload, renderer) em `out/`                                                                                                                                                             |
| `yarn test`      | Vitest — as unidades do core. Sem rede, sem credencial, determinístico                                                                                                                                                  |
| `yarn smoke`     | compila e roda os dois smokes de ponta a ponta (Playwright + Electron): o **da fatia vertical**, que sobe uma sessão real, precisa do login e **consome cota**, e o **do kanban**, que lê uma fixture e não toca a rede |
| `yarn lint`      | ESLint                                                                                                                                                                                                                  |
| `yarn typecheck` | `tsc --build`                                                                                                                                                                                                           |
| `yarn format`    | Prettier                                                                                                                                                                                                                |

`yarn lint`, `yarn typecheck` e `yarn test` formam o portão de qualidade, e são exatamente o que o
CI roda a cada PR para `dev` e `main`. Os smokes ficam de fora do CI de propósito: o runner nem
baixa o binário do Electron, e o da fatia vertical ainda depende do login local, que ele não tem.

## Configuração

Sem banco e sem arquivo de config. Oito variáveis de ambiente, lidas no main:

| Variável             | Default                                                            | Para quê                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OC_CWD`             | a pasta do app — em `yarn dev`, a raiz deste repo                  | pasta de trabalho da sessão                                                                                                                                                                                                                            |
| `OC_MODEL`           | ausente: herda o default do Claude Code                            | modelo da sessão                                                                                                                                                                                                                                       |
| `OC_ISOLATED`        | ausente                                                            | `1` passa `settingSources: []` ao SDK, e a sessão deixa de carregar `CLAUDE.md`, settings e skills. Existe **para o smoke** — fora dele, uma sessão isolada é um Claude Code amputado                                                                  |
| `OC_SCREEN`          | ausente: o kanban                                                  | `chat` abre a tela da fatia vertical. Porta de ambiente sem botão na UI, que existe **para o smoke** daquela fatia                                                                                                                                     |
| `OC_PROJECT_OWNER`   | `leonardo-amaral-3`                                                | dono do board a ler                                                                                                                                                                                                                                    |
| `OC_PROJECT_NUMBER`  | `2` — o board Operations Center                                    | número do Project. Valor inválido **lança**, em vez de cair no default: abrir o board 2 com toda a confiança do mundo quando pediram outro é o pior modo de falha que existe aqui                                                                      |
| `OC_BOARD_FIXTURE`   | ausente: lê o GitHub de verdade                                    | caminho de um JSON com a resposta da API, que substitui o GitHub inteiro. Existe **para o smoke do kanban**, que por causa dela não pede token nem toca a rede                                                                                         |
| `OC_CLAUDE_PROJECTS` | ausente: `CLAUDE_CONFIG_DIR` se houver, senão `~/.claude/projects` | raiz dos transcripts do Claude Code, de onde sai o mapa `repo → pasta local` em que a sessão de um cartão roda. Existe **para o smoke do cartão-chat**, que aponta para uma raiz temporária e faz a descoberta rodar inteira sobre um repo descartável |

`OC_SCREEN`, `OC_BOARD_FIXTURE` e `OC_CLAUDE_PROJECTS` são portas de teste, como `OC_ISOLATED`:
fora do smoke não há razão para tocá-las.

## Custo

O app não gera fatura de API. Isso não quer dizer que seja de graça.

Como a autenticação é o login local, **as sessões do app disputam a mesma cota do Claude Code das
suas sessões de terminal**. E a conta que vem junto é o modelo: sem `OC_MODEL`, a sessão herda o
default do CLI e carrega o contexto inteiro do projeto — um probe de uma palavra mediu
`total_cost_usd ≈ 0,20` nessas condições. Não é cobrado; é descontado da mesma cota. Com vários
cards em voo isso é material, e é por isso que `OC_MODEL` existe desde a fundação.

Abrir o app, porém, não custa nada desde que o kanban virou a tela padrão: nenhuma sessão sobe até
alguém pedir uma. Quem consome cota é o chat.

O smoke da fatia vertical escapa do custo somando duas coisas: `OC_MODEL` num modelo barato e
`OC_ISOLATED=1` — este último é o que mais pesa, porque a maior parte daqueles 20 centavos era
carregamento de contexto. O do kanban não custa nada: lê uma fixture e nunca sobe sessão.

## Como este projeto é desenvolvido

Roda a esteira `gm-*` completa, a mesma das Plataformas ICSF, num board próprio:

```
/gm-triage → /gm-card → /gm-spec → /gm-plan-tasks → /gm-implement → /gm-ship → /gm-release
  Triagem     Backlog   Especificação  Implementação                 Revisão   Release+Produção
                G1          G2              G3                         G4            G5
```

- **Board:** [Project 2 — Operations Center](https://github.com/users/leonardo-amaral-3/projects/2)
- **Norma e coordenadas:** `../CLAUDE.md` (seção `## Board`)
- **Specs:** `../planning/<feature>/spec.md`

Regras que valem aqui: sem card não há implementação · a spec é o contrato · task fecha com teste
verde · PR nasce com `Card: #n` na primeira linha e nunca com `Closes`.

## Branches

- `main` — produção. Recebe PR da `dev` no release e é a origem de hotfix.
- `dev` — integração. Base de toda branch de feature.
