/**
 * A política de navegação da janela — o que fazer quando algo tenta levá-la para outro lugar.
 *
 * A janela do Operations Center abre com `autoHideMenuBar: true`. Um `<a href>` clicado numa
 * resposta do Claude a levaria para fora do app, e ali não há barra de endereço nem botão de
 * voltar: o app viraria o site clicado, sem caminho de volta. Quem decide o destino de cada
 * navegação é esta função; quem a pendura nos eventos do Electron é o `index.ts`.
 *
 * **Este arquivo não importa `electron`** — é o que o mantém testável no Vitest, que roda em Node e
 * não tem o runtime do Electron para resolver o módulo.
 */

/**
 * O destino de uma navegação.
 *
 * São três veredictos, e não um booleano, porque "deixa passar porque é a própria janela
 * recarregando" e "não entrega porque é perigoso" são coisas diferentes. Um booleano as
 * confundiria, e no `will-navigate` isso deixaria passar um `file:///C:/Windows/win.ini`.
 */
export type NavigationVerdict =
  { kind: 'internal' } | { kind: 'external'; url: string } | { kind: 'blocked' }

/** Os únicos protocolos que valem uma entrega ao navegador do sistema. */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Julga `target` contra a URL que a janela carregou.
 *
 * A ordem das regras é o que faz a política ser segura: primeiro o que é a própria janela, depois o
 * que merece o navegador do sistema, e tudo o que sobra é barrado. A lista de protocolos externos é
 * uma **allowlist** de propósito — protocolo novo nasce bloqueado, não liberado.
 */
export function judgeNavigation(target: string, appUrl: string): NavigationVerdict {
  const to = parse(target)
  const app = parse(appUrl)

  // Uma das duas não é URL: o arrastar-e-soltar de um texto qualquer na janela cai aqui, e um
  // `appUrl` que não parseia significa que não há contra o que julgar. Nenhum dos dois casos
  // merece o benefício da dúvida.
  if (to === null || app === null) return { kind: 'blocked' }

  if (isOwnWindow(to, app)) return { kind: 'internal' }
  if (EXTERNAL_PROTOCOLS.has(to.protocol)) return { kind: 'external', url: to.href }

  return { kind: 'blocked' }
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** Se a navegação é a própria janela recarregando — em produção, num arquivo; no `yarn dev`, no HMR. */
function isOwnWindow(to: URL, app: URL): boolean {
  // `new URL('file://…').origin` é a string `"null"` para **qualquer** arquivo: comparar origins
  // aqui daria `file:///C:/Windows/win.ini` como sendo a própria janela. Em `file:` quem distingue
  // a recarga do `index.html` de um arquivo qualquer do disco é o `pathname`, e só ele.
  if (to.protocol === 'file:' || app.protocol === 'file:') {
    return to.protocol === 'file:' && app.protocol === 'file:' && to.pathname === app.pathname
  }

  return to.origin === app.origin
}
