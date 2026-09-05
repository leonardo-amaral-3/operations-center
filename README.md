# Operations Center

Centro operacional de gestão de desenvolvimento de **tarefas simultâneas do Claude Code**.

Projeto pessoal de [@leonardo-amaral-3](https://github.com/leonardo-amaral-3), usado dentro da
Notoria. Repositório privado.

## Stack

App **desktop Electron + TypeScript**, com React e Tailwind na tela.

A escolha não é estética. O núcleo do produto é o
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
uma biblioteca Node que **spawna um processo `claude` por sessão** e conversa por stdio. O main
process do Electron _é_ Node — então o host de sessões roda nele direto, sem sidecar e sem uma
terceira linguagem no stack. A crítica de sempre ao Electron (carregar um runtime Node junto) é
exatamente o que o torna a escolha certa aqui.

| Camada          | O que vive lá                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`     | o host de sessões: fila de entrada, máquina de estados, `SessionHost`. Agnóstico de casca — não conhece Electron nem React, e uma regra de lint garante que continue assim |
| `src/main/`     | o processo Node: cria as sessões com o `query` real do SDK, lê o ambiente e registra os canais IPC                                                                         |
| `src/preload/`  | o `contextBridge` — a única superfície que o renderer enxerga                                                                                                              |
| `src/renderer/` | React + Tailwind: chat, badge de estado, pedido de permissão e barra de status                                                                                             |
| `src/shared/`   | o contrato IPC, compilado pelos dois lados                                                                                                                                 |

Build com `electron-vite` (Vite 7). Testes: Vitest nas unidades, Playwright + Electron no smoke.

## Pré-requisitos

- **Node ≥ 20** e **yarn 1.22**
- **Claude Code instalado e logado** na máquina

O segundo item não é conveniência: o app **não** usa `ANTHROPIC_API_KEY`. As sessões sobem com as
credenciais locais do CLI, e sem login a janela abre mas a sessão não anda.

## Comandos

| Comando          | O que faz                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `yarn dev`       | sobe o app com hot reload do renderer                                                                                       |
| `yarn build`     | compila os três bundles (main, preload, renderer) em `out/`                                                                 |
| `yarn test`      | Vitest — as unidades do core. Sem rede, sem credencial, determinístico                                                      |
| `yarn smoke`     | compila e roda o smoke de ponta a ponta (Playwright + Electron). **É o único comando que precisa do login**, e consome cota |
| `yarn lint`      | ESLint                                                                                                                      |
| `yarn typecheck` | `tsc --build`                                                                                                               |
| `yarn format`    | Prettier                                                                                                                    |

`yarn lint`, `yarn typecheck` e `yarn test` formam o portão de qualidade, e são exatamente o que o
CI roda a cada PR para `dev` e `main`. O smoke fica de fora do CI de propósito: ele depende do
login local, que um runner não tem.

## Configuração

Sem banco e sem arquivo de config. Três variáveis de ambiente, lidas no main:

| Variável      | Default                                           | Para quê                                                                                                                                                                              |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OC_CWD`      | a pasta do app — em `yarn dev`, a raiz deste repo | pasta de trabalho da sessão                                                                                                                                                           |
| `OC_MODEL`    | ausente: herda o default do Claude Code           | modelo da sessão                                                                                                                                                                      |
| `OC_ISOLATED` | ausente                                           | `1` passa `settingSources: []` ao SDK, e a sessão deixa de carregar `CLAUDE.md`, settings e skills. Existe **para o smoke** — fora dele, uma sessão isolada é um Claude Code amputado |

## Custo

O app não gera fatura de API. Isso não quer dizer que seja de graça.

Como a autenticação é o login local, **as sessões do app disputam a mesma cota do Claude Code das
suas sessões de terminal**. E a conta que vem junto é o modelo: sem `OC_MODEL`, a sessão herda o
default do CLI e carrega o contexto inteiro do projeto — um probe de uma palavra mediu
`total_cost_usd ≈ 0,20` nessas condições. Não é cobrado; é descontado da mesma cota. Com vários
cards em voo isso é material, e é por isso que `OC_MODEL` existe desde a fundação.

O smoke escapa disso somando duas coisas: `OC_MODEL` num modelo barato e `OC_ISOLATED=1` — este
último é o que mais pesa, porque a maior parte daqueles 20 centavos era carregamento de contexto.

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
