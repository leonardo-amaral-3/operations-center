# Direção da fábrica agêntica

## Direção

O Operations Center despacha o trabalho da esteira gm-*, governa o que decide sozinho pelo mandato e presta contas por escrito. A prova é a própria fábrica construir isso neste repo, sem o Leonardo, e medir.

## Objetivos

- **P0 · Fundação:** o portão de teste local roda no Linux sem abrir janela; o app acha o `claude` fora do Windows; Direção e Mandato do experimento como arquivos versionados no repo, lidos pela orquestradora e não pelo CLAUDE.md.
- **P1 · Relatório do dia:** um comando que monta, a partir do cofre de decisões (`~/notoria/claude/decisoes`), do board e do git, o relatório de um dia por frente: em uma frase, decisões-chave com porquê e descartado, provisórias, estacionadas, desvios, e o resto contado. Só entra o que tem fonte.
- **P2 · Despachante sem janela:** `yarn fabrica` lê o board e o `PROXIMO:`/`PARADA:` das sessões, aplica o mandato, segura cadeados (teto de sessões, suíte), guarda estado em disco fora do `/tmp`, sobe cada sessão `claude -p` em ambiente limpo e transforma PARADA em item de fila.
- **P3 · A fábrica se despacha:** a fila de decisões e o relatório aparecem dentro do app, e o resto do épico é despachado pela P2.

## Fora do escopo

Slack, servidor fora do PC, multiusuário, tocar a `main` ou a instalação viva.

## Fontes

- Épico: https://github.com/leonardo-amaral-3/operations-center/issues/118
- Proposta: https://claude.ai/artifact/Lzap3RyiJ3NWNVB4ExFS2R
- Mandato: `fabrica/MANDATO.md` (cofre #1439, Leonardo, 10/11/2026)
