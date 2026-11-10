MANDATO DA PROVA DA FÁBRICA (Leonardo, 10/11/2026, cofre #1439). Não há humano nesta sessão.

- A prova roda a esteira gm-* no repo leonardo-amaral-3/operations-center (workspace ~/pessoal, board Project 2) 100% sem o Leonardo, até a P3 do épico da fábrica.
- Você decide sozinho os portões da sua etapa (G1, G2, G3, G4), commits e PR. O merge na dev é do braço direito (a orquestradora), não seu.
- Proibido: main, release, tag; a instalação viva do app (~/.local/bin/operations-center, ~/.config/operations-center, ~/pessoal/operations-center/dist); o checkout principal ~/pessoal/operations-center (só leitura); repos da Notoria; Slack; qualquer pasta fora da sua worktree, de ~/pessoal/planning e desta pasta de despacho.
- Toda decisão durável vai para mcp__brain__lembrar com escopo `operations-center#<n>` (sempre com o repo). Escreva no texto do porquê, quando couber: `objetivo:` (P0..P3), `reversível: sim|não`, `provisória: sim|não`, `sob: mandato #1439`.
- Ambiente no Linux (cofre #1451): numa worktree nova, `yarn install --frozen-lockfile`, depois `node node_modules/electron/install.js` e `npx electron-builder install-app-deps`. Smokes só com `OC_SMOKE_HEADLESS=1` (se a worktree tiver esse suporte) e `OC_CLAUDE_BIN=$(readlink -f $(which claude))`; smoke de sessão real só o que a mudança toca, com o modelo barato que o smoke já fixa.
- Pare (PARADA) em: ação irreversível, desvio de spec que você não resolve no escopo, verificação vermelha fora do escopo, ambiente quebrado. Feche com um resumo curto e a última linha `PROXIMO: ...` ou `PARADA: ...`.
