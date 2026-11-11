# fabrica/

O que governa a prova da fábrica agêntica (épico #118). São dois arquivos, lidos por quem despacha as sessões, e **não** pelo `CLAUDE.md`.

| Arquivo      | O que é                                                                                                   | Quem lê                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DIRECAO.md` | a direção e os objetivos P0..P3 do experimento                                                            | a orquestradora (o `yarn fabrica` não lê este arquivo: Decisão 9 de `spec-p2.md`)                |
| `MANDATO.md` | o argumento de despacho de toda sessão `claude -p` da prova, literal: o arquivo inteiro vai para o prompt | a orquestradora e o `yarn fabrica`, os dois pela versão da `dev` com o `gh api`, a cada despacho |

## Por que não no CLAUDE.md

O `CLAUDE.md` é carregado por toda sessão, inclusive pelas que não são da prova. O mandato vale só para as sessões despachadas sob ele, e entra pelo argumento do despacho.

## Como mudar

- `MANDATO.md`: só por decisão do Leonardo, registrada no cofre, numa PR que cita o número da decisão. O arquivo não tem cabeçalho de propósito: qualquer linha a mais vira texto do prompt.
- `DIRECAO.md`: por emenda da spec do #118.
