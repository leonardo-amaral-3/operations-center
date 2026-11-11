# fabrica/

O que governa a prova da fábrica agêntica (épico #118). São dois arquivos, lidos por quem despacha as sessões, e **não** pelo `CLAUDE.md`.

| Arquivo      | O que é                                                                                                   | Quem lê                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DIRECAO.md` | a direção e os objetivos P0..P3 do experimento                                                            | a orquestradora (o `yarn fabrica` não lê este arquivo: Decisão 9 de `spec-p2.md`)                |
| `MANDATO.md` | o argumento de despacho de toda sessão `claude -p` da prova, literal: o arquivo inteiro vai para o prompt | a orquestradora e o `yarn fabrica`, os dois pela versão da `dev` com o `gh api`, a cada despacho |

## A estação G4 do yarn fabrica

Depois que o `/gm-ship` abre a PR, a fábrica lança a revisão de IA independente (G4) na mesma frente, sem esperar o CI. Ela é uma estação do despachante, não uma skill.

- **Quando nasce:** o `/gm-ship` termina com `PARADA:` cujo motivo **começa** por `PR #<n> aberta`. Qualquer outra PARADA do ship (inclusive uma que cite PR fora dessa forma) vira item da fila, como antes.
- **O comando:** `/g4 #<card> PR #<pr>`. Não é skill: o `iniciar` o recusa, só o despachante o cria.
- **O que a sessão faz:** o prompt fixo vem de `src/core/fabrica/g4.ts` (`promptDoG4`), seguido do mandato. Roda com `--tools Bash,Read` (sem Edit, Write nem NotebookEdit), lê a PR e o diff, e comenta o parecer na PR com a primeira linha `<!-- gm:g4 -->`.
- **As linhas de fim:** `PARADA: G4 da PR #<pr>: sem bloqueante · parecer <url>` ou `PARADA: G4 da PR #<pr>: <N> bloqueante(s) · parecer <url>`; sem comentário publicado, `PARADA: G4 da PR #<pr> não rodou: <motivo>`.
- **A regra da fila:** só o parecer **sem bloqueante** vira Decisão. Bloqueante, falha da sessão, linha fora do contrato, PROXIMO, limite da frente ou ship fora da forma viram Pergunta.
- **O merge** continua da orquestradora; o G4 não o faz nem o libera sozinho.
- **Pergunta com bloqueante** é tratada à mão pela orquestradora: o `/gm-correcao` de hoje procura o `<!-- gm:revisao-status -->` do CI e não reconhece o parecer `gm:g4`.

## Por que não no CLAUDE.md

O `CLAUDE.md` é carregado por toda sessão, inclusive pelas que não são da prova. O mandato vale só para as sessões despachadas sob ele, e entra pelo argumento do despacho.

## Como mudar

- `MANDATO.md`: só por decisão do Leonardo, registrada no cofre, numa PR que cita o número da decisão. O arquivo não tem cabeçalho de propósito: qualquer linha a mais vira texto do prompt.
- `DIRECAO.md`: por emenda da spec do #118.
