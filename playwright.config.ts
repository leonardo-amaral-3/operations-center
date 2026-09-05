import { defineConfig } from '@playwright/test'

/**
 * Config do smoke — e só dele. O `yarn test` (Vitest) não passa por aqui.
 *
 * Os prazos são generosos de propósito: este é o único teste do repo que fala com um modelo de
 * verdade, e um turno do Claude Code leva dezenas de segundos. Os defaults do Playwright (30s de
 * teste, 5s de asserção) foram desenhados para uma página web, não para isso — mantê-los faria o
 * smoke falhar por impaciência, que é a pior espécie de vermelho: o que não diz nada sobre o
 * código.
 */
export default defineConfig({
  testDir: './tests/smoke',

  // Um turno pode levar minutos quando o modelo resolve usar ferramenta. O teste inteiro são dois
  // turnos mais o build já pronto.
  timeout: 300_000,
  expect: { timeout: 15_000 },

  // Uma sessão por vez: paralelismo aqui só multiplicaria consumo de cota do Claude Code, e o
  // teste é um só.
  workers: 1,
  fullyParallel: false,

  // Sem retry, de propósito. Este teste existe para dizer se a fatia vertical está de pé; repetir
  // até passar transformaria uma falha real em intermitência tolerada.
  retries: 0,

  reporter: [['list']],
})
