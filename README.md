# Operations Center

Centro operacional de gestão de desenvolvimento de **tarefas simultâneas do Claude Code**.

Projeto pessoal de [@leonardo-amaral-3](https://github.com/leonardo-amaral-3), usado dentro da
Notoria. Repositório privado.

Hoje o app abre um **kanban do board do GitHub**: uma coluna por estação da esteira, um cartão por
card, relido em silêncio quando a janela volta ao foco ou a máquina acorda — sem botão de atualizar
e sem polling. O board continua somente-leitura: o app não move card, não edita campo e não escreve
nada lá.

O que ele faz além de mostrar é **conversar**. Clicar num cartão de uma das seis colunas que têm
skill `gm-*` dedicada abre o chat do Claude Code **dentro do próprio cartão** — um por vez —, e a
sessão sobe na pasta local do repo daquele card, descoberta pelo próprio app a partir dos
transcripts que o Claude Code já deixou na máquina. Repo sem pasta conhecida faz o cartão pedir a
pasta; ele nunca chuta. Colapsar o cartão não encerra nada: quem encerra é o botão de encerrar.

A tela de chat avulsa continua existindo atrás de `OC_SCREEN=chat`: ela é a fatia vertical que
provou o caminho `renderer ↔ main ↔ core ↔ SDK`, e é o que o smoke daquela fatia percorre.

O que o Claude responde chega **formatado** nas duas telas: título, lista, tabela, bloco de código,
citação e link viram elemento de verdade, e não caractere de markdown na tela. Link clicado abre no
navegador do sistema — a janela do app nunca navega para fora dela mesma —, e nada do que o modelo
escreve executa script ou dispara requisição de rede a partir da janela.

## Stack

App **desktop Electron + TypeScript**, com React e Tailwind na tela.

A escolha não é estética. O núcleo do produto é o
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
uma biblioteca Node que **spawna um processo `claude` por sessão** e conversa por stdio. O main
process do Electron _é_ Node — então o host de sessões roda nele direto, sem sidecar e sem uma
terceira linguagem no stack. A crítica de sempre ao Electron (carregar um runtime Node junto) é
exatamente o que o torna a escolha certa aqui.

| Camada          | O que vive lá                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`     | a lógica de produto agnóstica de casca: o host de sessões (fila de entrada, máquina de estados, `SessionHost`) e a leitura do GitHub — o board inteiro (`BoardReader`) e o conteúdo de um card sob demanda (`CardReader`), ambos com o cliente GraphQL injetado. Não conhece Electron, React nem HTTP, e uma regra de lint garante que continue assim |
| `src/main/`     | o processo Node: cria as sessões com o `query` real do SDK, pega o token com o `gh`, fala com a API do GitHub, lê o ambiente e registra os canais IPC                                                                                                                                                                                                 |
| `src/preload/`  | o `contextBridge` — a única superfície que o renderer enxerga                                                                                                                                                                                                                                                                                         |
| `src/renderer/` | React + Tailwind: o kanban (colunas, cartões e carimbo de frescor), a tela de chat da fatia vertical e a bolha de mensagem que as duas compartilham — ela desenha o markdown com [`react-markdown`](https://www.npmjs.com/package/react-markdown) + `remark-gfm`, e `rehype-raw` + `rehype-sanitize` (nessa ordem) no HTML embutido nas respostas     |
| `src/shared/`   | o contrato IPC e o vocabulário do board, compilados pelos dois lados                                                                                                                                                                                                                                                                                  |

A tela veste o [neobrutalism.dev](https://www.neobrutalism.dev/) sobre shadcn/ui: as primitivas ficam vendorizadas em `src/renderer/ui/`, o tema em modo claro fixo mora em `src/renderer/index.css`, e `tests/unit/design-system.test.ts` reprova a cor de paleta ou a casca escrita à mão fora dali.

Build com `electron-vite` (Vite 7). Testes: Vitest nas unidades, Playwright + Electron nos smokes.

## Pré-requisitos

Duas listas, e a divisão entre elas é o que o executável tornou visível: a primeira vale sempre, a
segunda só para quem desenvolve.

**O que a máquina precisa ter** — vale igualmente para o `yarn dev` e para o executável:

- **GitHub CLI (`gh`) instalado e logado** (`gh auth login`), **com o escopo `read:org`**
- **`git`** no PATH
- **Claude Code instalado e logado**, na versão **2.1.261 ou mais nova**

**O que só o desenvolvimento pede** — o executável dispensa os três:

- **Node ≥ 22.13** (ou 24.x)
- **yarn 1.22**
- **o repo clonado**

O piso do Node não é redondo porque é uma interseção, não uma escolha: `electron@44` exige
`>= 22.12` e `eslint@10` exige `>= 22.13`. E a janela **pula os majors ímpares** — `vitest@5`
declara `^22.12 || ^24 || >=26`, então **Node 23 e 25 não servem**, mesmo sendo "maiores que 22.13".

O Claude Code não é conveniência: o app **não** usa `ANTHROPIC_API_KEY`. As sessões sobem com as
credenciais locais do CLI, e sem login a janela abre mas a sessão não anda. E não é só o login: o
app spawna o **binário** da máquina, achado pela cadeia que `OC_CLAUDE_BIN` encabeça — não há uma
segunda cópia do Claude Code dentro do app.

O piso de **2.1.261** tem causa medida, e ele falha do jeito pior: a 2.1.232 entrega ao modelo o
`cwd` em forma POSIX (`/tmp/…` no lugar de `C:\Users\…\Temp\…`), e a sessão de um cartão vai
escrever na pasta errada **sem reclamar de nada**. Perguntado direto, o binário velho reporta o
caminho certo; o defeito só aparece pelo caminho da sessão do SDK, que é justamente o que o app usa.
Versão velha não impede o app de subir — por isso a linha está aqui, e não numa checagem em runtime.
Confira com `claude --version`; se faltar, `npm i -g @anthropic-ai/claude-code@latest`.

O `git` é o terceiro, e o mais silencioso dos três: o app o spawna
(`git -C <pasta> remote get-url origin`, em `src/main/repos.ts`) para descobrir a qual repositório
cada pasta local corresponde — é esse mapa que decide **em que pasta a sessão de um cartão roda**.
Sem `git` no PATH a resposta é `null`, tratada com a mesma tolerância de "pasta não é repo": nada
quebra na tela, e os cartões apenas deixam de encontrar a pasta deles.

O `gh` também não: é dele que vem o token que lê o board. O app o pede por subprocesso
(`gh auth token`) e **nunca persiste credencial** — o segredo continua no keyring do sistema, que é
onde o `gh` já o guarda. Sem `gh` no PATH ou sem login, a janela abre e o kanban mostra o erro no
lugar dos cartões.

O escopo `read:org` não é detalhe de configuração: é ele que faz o app enxergar os boards das
**organizações** de que você participa, e não só os seus. Sem ele o token continua válido, o login
continua verde e a descoberta simplesmente volta com menos boards — a lista de organizações vem
vazia e ninguém é avisado. Confira com `gh auth status`; se faltar, `gh auth refresh -s read:org`.

## Comandos

| Comando          | O que faz                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn dev`       | sobe o app com hot reload do renderer                                                                                                                                                                                                                                                                                                                |
| `yarn build`     | compila os três bundles (main, preload, renderer) em `out/`                                                                                                                                                                                                                                                                                          |
| `yarn package`   | compila e empacota o executável em `dist/win-unpacked/` (Windows; ver `## Executável`)                                                                                                                                                                                                                                                               |
| `yarn test`      | Vitest — as unidades do core. Sem rede, sem credencial, determinístico                                                                                                                                                                                                                                                                               |
| `yarn smoke`     | compila e roda os oito smokes de ponta a ponta (Playwright + Electron): os **quatro que leem fixture** e não tocam a rede — o do kanban, o do conteúdo do cartão, o do tema e o da triagem —, e os **quatro que sobem sessão real** — o da fatia vertical, o do cartão-chat, o da retomada e o das abas —, que precisam do login e **consomem cota** |
| `yarn lint`      | ESLint                                                                                                                                                                                                                                                                                                                                               |
| `yarn typecheck` | `tsc --build`                                                                                                                                                                                                                                                                                                                                        |
| `yarn format`    | Prettier                                                                                                                                                                                                                                                                                                                                             |

`yarn lint`, `yarn typecheck` e `yarn test` formam o portão de qualidade, e são exatamente o que o
CI roda a cada PR para `dev` e `main`. Os smokes ficam de fora do CI de propósito: o runner nem
baixa o binário do Electron, e os quatro que sobem sessão ainda dependem do login local, que ele
não tem.

## Executável

`yarn package` compila os três bundles e empacota tudo em **`dist/win-unpacked/`**, com o app em
`Operations Center.exe`. Duplo clique abre a janela: sem terminal, sem Vite, sem `yarn dev` — e
fechar qualquer terminal não derruba mais o app.

**Copie a pasta inteira, não só o `.exe`.** Ele sozinho não roda: o runtime do Chromium, o
`app.asar` com o código e as DLLs do Electron são todos irmãos dele dentro de `dist/win-unpacked/`.
Movida inteira para qualquer lugar do disco, a pasta funciona.

O que o executável **dispensa**: o repo clonado, o Node e o yarn. O que ele **não** dispensa é a
primeira lista dos pré-requisitos — **`gh` logado, `git` e o Claude Code** continuam sendo exigência
da máquina, exatamente como no `yarn dev`.

São ~370 MB, e o número tem duas metades. A que está lá: o runtime do Chromium, que é o preço de
qualquer app Electron. A que **não** está: o `claude.exe` de 209 MB que o SDK traz como dependência
opcional, excluído do artefato em `electron-builder.json` — o app usa o Claude Code da máquina, que
os pré-requisitos já exigiam. Empacotar os dois daria ~580 MB para carregar uma segunda cópia de
algo que já está instalado.

O estado continua em `%APPDATA%\operations-center`, o mesmo lugar do `yarn dev`: o executável abre
com as conversas, as marcas de dangerous e o tema que a versão de desenvolvimento deixou.

Sem instalador, sem auto-update e sem ícone próprio — o app sai com o ícone padrão do Electron.
Windows só: a descoberta do `claude.exe` é escrita para `where` e `.exe`.

## Configuração

Sem banco e sem arquivo de config. Onze variáveis de ambiente, lidas no main:

| Variável             | Default                                                                       | Para quê                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OC_CWD`             | a pasta do app — em `yarn dev`, a raiz deste repo                             | pasta de trabalho da sessão. **No executável esse default é um caminho dentro do `app.asar`**, que não é pasta de trabalho de nada: lá a tela avulsa do `OC_SCREEN=chat` só serve com esta variável setada. O kanban não depende dela — a pasta de um cartão sai do repo dele                                                                                                                                                                                                                                                                                                                                                                       |
| `OC_MODEL`           | ausente: herda o default do Claude Code                                       | modelo da sessão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `OC_CLAUDE_BIN`      | ausente: a cadeia — o `claude` do PATH, depois `~/.local/bin/claude.exe`      | caminho do `claude.exe` que a sessão spawna. Tem de ser um **`.exe` de verdade**: o SDK spawna sem shell, e o Node ≥ 20 recusa `.cmd`/`.bat` assim (`EINVAL`) — apontar para o `claude.cmd` do PATH, que é o caminho óbvio, quebraria toda sessão. Apontando para caminho que não existe **lança**, e não cai para o degrau seguinte: variável que aponta para o nada é engano de quem a exportou                                                                                                                                                                                                                                                   |
| `OC_ISOLATED`        | ausente                                                                       | `1` passa `settingSources: []` ao SDK, e a sessão deixa de carregar `CLAUDE.md`, settings e skills. Existe **para o smoke** — fora dele, uma sessão isolada é um Claude Code amputado                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `OC_SCREEN`          | ausente: o kanban                                                             | `chat` abre a tela da fatia vertical. Porta de ambiente sem botão na UI, que existe **para o smoke** daquela fatia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `OC_THEME`           | ausente: a combinação lembrada no `preferences.json`; sem nenhuma, `lavanda`  | qual combinação de cores desenhar, entre as declaradas em `src/renderer/index.css`: hoje `lavanda`, `ametista` e `obsidiana` (a escura). Nome desconhecido **lança** — cair na lavanda em silêncio faria parecer que o tema não funciona. **A precedência é `OC_THEME` → a combinação lembrada → `lavanda`**: o ambiente vence o disco, então com esta variável exportada no shell trocar no botão aplica e grava, mas a próxima abertura volta ao que ela manda                                                                                                                                                                                    |
| `OC_BOARD_FIXTURE`   | ausente: lê o GitHub de verdade                                               | caminho de um JSON `"dono/número" → resposta da API`, que substitui o GitHub inteiro. É ela sozinha que decide fixture-vs-GitHub. Existe **para os smokes**, que por causa dela não pedem token nem tocam a rede. Coordenada sem entrada no mapa **lança**: uma aba cujo board não está na fixture tem de aparecer como erro, e não como kanban vazio                                                                                                                                                                                                                                                                                               |
| `OC_BOARDS_FIXTURE`  | ausente: a descoberta não tem o que responder e **lança**                     | caminho de um JSON com as respostas da **descoberta** — os seus donos, e os Projects de cada dono. É o par de `OC_BOARD_FIXTURE` e só é consultada junto com ela; sem as duas, nenhum smoke desenha kanban                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `OC_CARD_FIXTURE`    | ausente: nenhum cartão tem conteúdo de fixture                                | caminho de um JSON `número da issue → resposta da API` com o corpo e os comentários de cada card. Só é consultada quando `OC_BOARD_FIXTURE` existe, e é o par dela no **smoke do conteúdo do cartão**. Cartão sem entrada no mapa vira erro na tela, e não card vazio                                                                                                                                                                                                                                                                                                                                                                               |
| `OC_CLAUDE_PROJECTS` | ausente: `CLAUDE_CONFIG_DIR` se houver, senão `~/.claude/projects`            | raiz dos transcripts do Claude Code, de onde sai o mapa `repo → pasta local` em que a sessão de um cartão roda. Existe **para os smokes do cartão-chat e das abas**, que apontam para uma raiz temporária e fazem a descoberta rodar inteira sobre repos descartáveis                                                                                                                                                                                                                                                                                                                                                                               |
| `OC_STATE_DIR`       | ausente: o `userData` do Electron — no Windows, `%APPDATA%\operations-center` | pasta em que o app grava o próprio estado, hoje em três arquivos: `conversations.json`, o vínculo `cartão → sessão do Claude Code` que faz a conversa voltar depois de fechar e reabrir; `dangerous.json`, a lista dos cartões marcados para rodar sem pedir permissão; e `preferences.json`, a aba que estava ativa e a combinação de cores escolhida quando o app fechou. Ser diretório, e não arquivo, é o que permitiu o segundo e o terceiro nascerem sem uma segunda variável. Existe **para os smokes da retomada, do cartão-chat, das abas e do tema**, que apontam para uma pasta temporária em vez de sujar o estado real de quem os roda |

`OC_SCREEN`, `OC_BOARD_FIXTURE`, `OC_BOARDS_FIXTURE`, `OC_CARD_FIXTURE`, `OC_CLAUDE_PROJECTS` e
`OC_STATE_DIR` são portas de teste, como `OC_ISOLATED`: fora do smoke não há razão para tocá-las.

`OC_THEME` e `OC_CLAUDE_BIN` são as exceções — as duas que se pode tocar de verdade, por razões
opostas. `OC_THEME` deixou de ser a única forma de trocar de combinação: **o botão está no cabeçalho
do kanban**, e a escolha é lembrada entre uma abertura e a seguinte. O que restou à variável é vencer
o que ficou lembrado — abrir numa combinação sem mexer na preferência gravada. Não é porta de teste
como as outras, mas quem a exporta está testando, não usando.

`OC_CLAUDE_BIN` é o oposto: não tem botão nem substituto, e existe para o caso em que a descoberta
erra ou não acha nada — uma instalação fora do PATH, ou duas versões do Claude Code na máquina e a
vontade de escolher qual roda. É também a válvula de escape quando a cadeia falha: é o primeiro
degrau, e vence os outros dois.

**Qual board o app abre não é configurável, e é de propósito**: a lista sai de uma pergunta ao
GitHub — quais dos seus Projects rodam a esteira `gm-*` —, e não de variável de ambiente. Houve um
par de variáveis que fixava a coordenada do board; elas foram removidas, e quem ainda as tiver
exportadas no shell é **ignorado em silêncio** — melhor do que um app que não abre por causa de
lixo de ambiente.

## Custo

O app não gera fatura de API. Isso não quer dizer que seja de graça.

Como a autenticação é o login local, **as sessões do app disputam a mesma cota do Claude Code das
suas sessões de terminal**. E a conta que vem junto é o modelo: sem `OC_MODEL`, a sessão herda o
default do CLI e carrega o contexto inteiro do projeto — um probe de uma palavra mediu
`total_cost_usd ≈ 0,20` nessas condições. Não é cobrado; é descontado da mesma cota. Com vários
cards em voo isso é material, e é por isso que `OC_MODEL` existe desde a fundação.

Abrir o app, porém, não custa nada: nenhuma sessão sobe até alguém pedir uma. Quem consome cota é o
chat — e agora **um clique num cartão já é um pedido**, porque a sessão daquele card sobe ali. Um
cartão aberto e esquecido não gasta nada enquanto ninguém fala com ele, mas dez cartões conversando
são dez sessões disputando a mesma cota.

**Quatro dos oito smokes sobem sessão real e consomem cota**: o da fatia vertical, o do cartão-chat,
o da retomada e o das abas. O do cartão-chat é o mais caro — ele levanta uma sessão para conversar e
outra ao provar que abrir um segundo cartão colapsa o primeiro —, o da retomada gasta dois turnos,
um em cada ciclo de vida do app, e o das abas é o mais barato dos quatro: levanta duas sessões, uma
por aba, e só uma delas chega a falar. Os quatro escapam do pior somando as mesmas duas coisas:
`OC_MODEL` num modelo barato e `OC_ISOLATED=1` — este último é o que mais pesa, porque a maior parte
daqueles 20 centavos era carregamento de contexto. Os outros quatro não custam nada: o do kanban, o
do conteúdo do cartão, o do tema e o da triagem leem fixture e nunca sobem sessão — este último
porque a aba da fixture tem cartões de dois repos, e sem repo unânime a triagem nem tenta subir.

**E há um preço que não é de cota.** Cada cartão pode ser marcado para rodar _sem pedir permissão_:
naquele chat as ferramentas do Claude Code executam sozinhas, e escrever no repo do cartão deixa de
passar por um clique seu. É escolha explícita, por cartão, reversível no mesmo botão e sinalizada no
kanban por um crachá vermelho — e **sobrevive a fechar o app**, que é a parte que surpreende: um
cartão marcado ontem continua marcado hoje, antes de você clicar em coisa alguma.

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
