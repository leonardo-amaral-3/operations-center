# fabrica/

O que governa a prova da fábrica agêntica (épico #118). São três arquivos, lidos por quem despacha as sessões, e **não** pelo `CLAUDE.md`.

| Arquivo       | O que é                                                                                                               | Quem lê                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DIRECAO.md`  | a direção e os objetivos P0..P3 do experimento                                                                        | a orquestradora (o `yarn fabrica` não lê este arquivo: Decisão 9 de `spec-p2.md`)                |
| `MANDATO.md`  | o argumento de despacho de toda sessão `claude -p` da prova, literal: o arquivo inteiro vai para o prompt             | a orquestradora e o `yarn fabrica`, os dois pela versão da `dev` com o `gh api`, a cada despacho |
| `boards.json` | os boards que a fábrica atende: repo, workspace, pasta de estado, caminhos proibidos e a origem do mandato de cada um | o `yarn fabrica` e o app, que o empacota no build                                                |

## A estação G4 do yarn fabrica

Depois que o `/gm-ship` abre a PR, a fábrica lança a revisão de IA independente (G4) na mesma frente, sem esperar o CI. Ela é uma estação do despachante, não uma skill.

- **Quando nasce:** o `/gm-ship` termina com `PARADA:` cujo motivo **começa** por `PR #<n> aberta`. Qualquer outra PARADA do ship (inclusive uma que cite PR fora dessa forma) vira item da fila, como antes.
- **O comando:** `/g4 #<card> PR #<pr>`. Não é skill: o `iniciar` o recusa, só o despachante o cria.
- **O que a sessão faz:** o prompt fixo vem de `src/core/fabrica/g4.ts` (`promptDoG4`), seguido do mandato. Roda com `--tools Bash,Read` (sem Edit, Write nem NotebookEdit), lê a PR e o diff, e comenta o parecer na PR com a primeira linha `<!-- gm:g4 -->`.
- **As linhas de fim:** `PARADA: G4 da PR #<pr>: sem bloqueante · parecer <url>` ou `PARADA: G4 da PR #<pr>: <N> bloqueante(s) · parecer <url>`; sem comentário publicado, `PARADA: G4 da PR #<pr> não rodou: <motivo>`.
- **A regra da fila:** só o parecer **sem bloqueante** vira Decisão. Bloqueante, falha da sessão, linha fora do contrato, PROXIMO, limite da frente ou ship fora da forma viram Pergunta.
- **O merge** continua da orquestradora; o G4 não o faz nem o libera sozinho.
- **Pergunta com bloqueante** é tratada à mão pela orquestradora: o `/gm-correcao` de hoje procura o `<!-- gm:revisao-status -->` do CI e não reconhece o parecer `gm:g4`.

## Os boards da fábrica (boards.json)

`fabrica/boards.json` (`versao: 1`) é a fonte única do que muda de um board para outro. Cada entrada de `boards` tem `owner`, `projeto`, `nome`, `repo` (`<owner>/<nome>`, com `checkoutPrincipal`) **ou** `repos` (lista de `<owner>/<nome>`, ou `<owner>/*`; o checkout principal de cada repo é `<workspace>/<nome>`), `workspace`, `pastaDoEstado`, `proibidos` (`caminhos` e `motivo`) e `mandato` (`repo`, `ref`, `caminho` e `aprovacao`). `padrao` é a chave (`<owner>/<projeto>`) do board usado quando nada o escolhe. `~` vale a home de quem roda. Uma versão diferente de 1 é recusada como ilegível.

- **Escolher o board:** `yarn fabrica --board <owner>/<projeto> <subcomando>`. Sem `--board`, vale o `padrao`, e a linha de comando de antes não muda. O app instalado não escolhe board: usa sempre o `padrao`.
- **Mandato aprovado** é o board ter o campo `mandato`: o mandato de uma origem versionada, com a decisão que o aprovou em `aprovacao`. Sem o campo, ou com `null`, o board não tem mandato aprovado.
- **A recusa:** uma chave que não está no arquivo, ou um board sem mandato aprovado, sai com código `2` e a mensagem no stderr, **antes** de criar qualquer pasta, de ler o GitHub ou de olhar o `OC_FABRICA_DIR`. Vale para todos os subcomandos, inclusive `estado` e `iniciar --ensaio`.
- **`OC_FABRICA_DIR`** troca a pasta de estado do board escolhido; sem ela vale o `pastaDoEstado` dele. Um board novo não herda a pasta de outro.
- **Incluir um board:** PR com a entrada nova neste arquivo e o mandato versionado na origem que ela aponta. Nenhum arquivo de `src/` muda.
- **Card de um repo:** `yarn fabrica iniciar <n>` num board de um repo; `iniciar <repo>#<n>` ou `<owner>/<repo>#<n>` em qualquer board. Num board de vários repos, `iniciar <n>` é recusado.
- **O repo no estado:** campo `repo` em frentes, despachos e itens; ausente = o repo único do board.
- **O padrão tem repo único:** o app serve só o padrão.
- **Limite do app:** o app instalado lê o `boards.json` que foi empacotado no build dele, então mudar o arquivo exige rebuild do app. O CLI o relê a cada `yarn fabrica`, porque recompila o bundle.

## Por que não no CLAUDE.md

O `CLAUDE.md` é carregado por toda sessão, inclusive pelas que não são da prova. O mandato vale só para as sessões despachadas sob ele, e entra pelo argumento do despacho.

## Como mudar

- `MANDATO.md`: só por decisão do Leonardo, registrada no cofre, numa PR que cita o número da decisão. O arquivo não tem cabeçalho de propósito: qualquer linha a mais vira texto do prompt.
- `DIRECAO.md`: por emenda da spec do #118.
