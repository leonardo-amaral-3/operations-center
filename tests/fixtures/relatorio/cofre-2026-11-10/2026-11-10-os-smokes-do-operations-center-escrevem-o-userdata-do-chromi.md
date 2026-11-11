---
data: 2026-11-10
tipo: descoberta
escopo: operations-center#118
---

# Os smokes escrevem o userData do Chromium na pasta da instalação viva.

Medido em um dia de teste: as rodadas regravaram arquivos voláteis na pasta da instalação.

**Por quê:** objetivo: P0. O isolamento cobre só os JSON do app, não o Chromium. reversível: sim. provisória: não.

**Descartado:** Esconder e seguir: descartado, outras sessões repetiriam.

**Refs:** (sintética, fixture de teste)
