---
data: 2026-11-10
tipo: descoberta
escopo: operations-center
---

# Ambiente do repo no Linux provado numa worktree.

Instalação, lint, typecheck e testes ficaram verdes, e os smokes rodaram sem janela.

**Por quê:** É a premissa do que a fábrica vai despachar. Sem tela virtual, alguns smokes falham.

**Descartado:** Rodar com janela visível: descartado, rouba o foco.

**Refs:** (sintética, fixture de teste)
