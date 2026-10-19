import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, PointerEvent } from 'react'

import type { ClaudeScope, TerminalState } from '../../shared/claude'
import type { FreeSessionCard, SessionScope } from '../../shared/ipc'
import type { MesaState } from '../mesa/mesaState'
import { SHORTCUT_LABEL } from '../mesa/shortcuts'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ClaudeTerminal } from './ClaudeTerminal'

export interface SidePanelProps {
  state: MesaState
  freeSessions: readonly FreeSessionCard[]
  onActivate: (id: string) => void
  onResize: (width: number) => void
  /** O pedido de foco do estado foi atendido: zera a intenção, como o dock faz. */
  onFocusConsumed: () => void
  /** A sessão foi esquecida no main; a mesa tira dela o que a apontava. */
  onForgotten: (id: string) => void
  /** "Terminal aqui" da sessão ativa — o último perfil, na pasta dela. */
  onOpenTerminal: (scope: SessionScope) => void
  /** Recolhe o painel — o mesmo `toggleSide` do Ctrl+Shift+L; nenhuma sessão é esquecida. */
  onCollapse: () => void
}

/**
 * O painel lateral (#74 §10): as sessões livres, uma aba cada, e a conversa da ativa por baixo.
 *
 * A barra de abas é a do dock e a de `BoardTabs.tsx` — `nav role="tablist"`, um `Button` por sessão,
 * a ativa no violeta —, com duas diferenças que são do assunto: o rótulo se **renomeia** (duplo
 * clique) e o `✕` **esquece** em dois passos. Esquecer apaga a entrada do índice e não tem volta;
 * um clique só, ao lado do botão que seleciona, é um acidente esperando a pasta errada.
 *
 * O `»` na ponta da barra (#111) recolhe o painel sem esquecer nada; quem esquece é o `✕` da aba. Ele
 * fica fora do `nav` porque o `nav` rola: com muitas abas, um botão lá dentro sumiria da vista.
 *
 * O terminal Claude (#97) não é dono do processo: desmontá-lo ao trocar de aba só solta a vista, e o
 * `key` por sessão dá a cada uma o seu `ClaudeTerminal`. O estado de cada sessão vem de uma
 * assinatura local de `onClaudeState`, filtrada pelo escopo `free` — o board só guarda os cartões.
 */
export function SidePanel({
  state,
  freeSessions,
  onActivate,
  onResize,
  onFocusConsumed,
  onForgotten,
  onOpenTerminal,
  onCollapse,
}: SidePanelProps): JSX.Element {
  const { side, focus } = state
  const arrasto = useRef<{ x: number; largura: number } | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null)

  const [terminais, setTerminais] = useState<Readonly<Record<string, TerminalState>>>({})

  // Assinar antes de pedir, e o evento empurrado vence a leitura antiga (mesma guarda do kanban).
  // `closed` remove a chave: sem processo, o terminal não tem estado a mostrar.
  useEffect(() => {
    let pushed = false

    function aplicar(escopo: ClaudeScope, estado: TerminalState): void {
      if (escopo.kind !== 'free') return
      const { id } = escopo

      setTerminais((atuais) => {
        if (estado.kind === 'closed') {
          if (!(id in atuais)) return atuais

          return Object.fromEntries(Object.entries(atuais).filter(([chave]) => chave !== id))
        }
        if (atuais[id]?.kind === estado.kind) return atuais

        return { ...atuais, [id]: estado }
      })
    }

    const unsubscribe = window.oc.onClaudeState((event) => {
      pushed = true
      aplicar(event.scope, event.state)
    })

    void window.oc.readClaudeStates().then((eventos) => {
      if (pushed) return
      for (const evento of eventos) aplicar(evento.scope, evento.state)
    })

    return unsubscribe
  }, [])

  const ativa = freeSessions.find((sessao) => sessao.id === side.active) ?? null

  // A intenção de foco é do `Chat` recém-criado, que a leu **no monte**: consumi-la no mesmo commit
  // não a desfaz, e impede que ela sobreviva até um clique em outra aba reativar o foco. Só com a
  // sessão já na lista: o `openFree` chega antes do `free:changed` que a publica, e consumir cedo
  // demais mataria o pedido antes de existir um `Chat` para lê-lo.
  const temAtiva = ativa !== null
  useEffect(() => {
    if (focus === 'free' && temAtiva) onFocusConsumed()
  }, [focus, temAtiva, onFocusConsumed])

  // "Qualquer outro clique desfaz": o clique no próprio `Esquecer?` passa — é ele que confirma.
  useEffect(() => {
    if (confirmando === null) return

    function desfazer(event: globalThis.PointerEvent): void {
      const alvo = event.target instanceof Element ? event.target : null
      if (alvo?.closest('[data-testid="free-forget-confirm"]') != null) return

      setConfirmando(null)
    }

    window.addEventListener('pointerdown', desfazer)

    return () => {
      window.removeEventListener('pointerdown', desfazer)
    }
  }, [confirmando])

  function aoPressionarAAlca(event: PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    arrasto.current = { x: event.clientX, largura: side.width }
  }

  function aoArrastarAAlca(event: PointerEvent<HTMLDivElement>): void {
    if (arrasto.current === null) return

    // A alça está na borda da esquerda: levar o ponteiro para a esquerda **aumenta** o painel.
    onResize(arrasto.current.largura + (arrasto.current.x - event.clientX))
  }

  function aoSoltarAAlca(event: PointerEvent<HTMLDivElement>): void {
    arrasto.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function gravarTitulo(sessao: FreeSessionCard): void {
    const texto = editando?.texto.trim() ?? ''
    setEditando(null)

    // Título vazio ou igual ao de antes não vale uma ida ao main.
    if (texto !== '' && texto !== sessao.title)
      void window.oc.renameFree({ id: sessao.id, title: texto })
  }

  function aoDigitarNoTitulo(
    event: KeyboardEvent<HTMLInputElement>,
    sessao: FreeSessionCard,
  ): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      gravarTitulo(sessao)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setEditando(null)
    }
  }

  function esquecer(id: string): void {
    setConfirmando(null)
    void window.oc.forgetFree({ id }).then(() => {
      onForgotten(id)
    })
  }

  return (
    <aside
      data-testid="side-panel"
      aria-label="Sessões livres"
      style={{ width: side.width }}
      className="relative flex shrink-0 flex-col border-l-2 border-border bg-background"
    >
      <div
        data-testid="side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar o painel"
        onPointerDown={aoPressionarAAlca}
        onPointerMove={aoArrastarAAlca}
        onPointerUp={aoSoltarAAlca}
        onPointerCancel={aoSoltarAAlca}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none"
      />

      <div className="flex shrink-0 items-center gap-1 pr-1.5">
        <nav
          role="tablist"
          aria-label="Sessões livres abertas"
          className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto p-1.5"
        >
          {freeSessions.length === 0 ? (
            <p className="px-1 text-xs text-foreground/60">
              Nenhuma sessão livre. Use ✦ Sessão livre na faixa (Ctrl+Shift+N).
            </p>
          ) : null}

          {freeSessions.map((sessao) => {
            const selecionada = sessao.id === side.active

            return (
              <div key={sessao.id} className="flex shrink-0 items-center gap-1">
                {editando?.id === sessao.id ? (
                  <Input
                    autoFocus
                    data-testid="free-rename"
                    aria-label="Renomear a sessão"
                    value={editando.texto}
                    className="h-7 w-40 px-2 py-0 text-xs"
                    onChange={(event) => setEditando({ id: sessao.id, texto: event.target.value })}
                    onKeyDown={(event) => aoDigitarNoTitulo(event, sessao)}
                    onBlur={() => gravarTitulo(sessao)}
                  />
                ) : (
                  <Button
                    type="button"
                    role="tab"
                    aria-selected={selecionada}
                    data-testid="free-tab"
                    data-free-id={sessao.id}
                    data-recoverable={String(sessao.recoverable)}
                    variant={selecionada ? 'default' : 'neutral'}
                    size="xs"
                    className="max-w-56 font-heading"
                    title={`${sessao.title} — duplo clique renomeia`}
                    onClick={() => onActivate(sessao.id)}
                    onDoubleClick={() => setEditando({ id: sessao.id, texto: sessao.title })}
                  >
                    <span className="truncate">{sessao.title}</span>
                  </Button>
                )}

                {confirmando === sessao.id ? (
                  <Button
                    type="button"
                    variant="neutral"
                    size="xs"
                    data-testid="free-forget-confirm"
                    className="bg-danger text-danger-foreground"
                    title="Apaga esta sessão e o histórico dela do app. Não tem volta."
                    onClick={() => esquecer(sessao.id)}
                  >
                    Esquecer?
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="neutral"
                    size="xs"
                    data-testid="free-tab-close"
                    aria-label={`Esquecer ${sessao.title}`}
                    title="Esquecer esta sessão"
                    onClick={() => setConfirmando(sessao.id)}
                  >
                    <span aria-hidden>✕</span>
                  </Button>
                )}
              </div>
            )
          })}
        </nav>

        <Button
          type="button"
          variant="neutral"
          size="xs"
          data-testid="side-collapse"
          aria-label="Recolher o painel"
          title={`Recolher o painel (${SHORTCUT_LABEL['toggle-side']})`}
          className="shrink-0"
          onClick={onCollapse}
        >
          <span aria-hidden>»</span>
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
        {ativa === null ? null : (
          <>
            {/* Sessão sem transcript (criada e fechada sem turno): o título e a pasta bastam, e o
                aviso diz por que não há conversa a reler em vez de deixar o painel mudo. */}
            {ativa.recoverable ? null : (
              <p data-testid="free-no-history" className="mt-2 text-[10px] text-foreground/60">
                Sem histórico: esta sessão não chegou a trocar mensagens. A próxima abre uma
                conversa nova na mesma pasta.
              </p>
            )}

            <ClaudeTerminal
              key={ativa.id}
              scope={{ kind: 'free', id: ativa.id }}
              state={terminais[ativa.id] ?? null}
              dangerous={ativa.dangerous}
              semPasta="A pasta desta sessão não existe mais — escolha outra."
              onToggleDangerous={(next) => {
                void window.oc.setDangerous({
                  scope: { kind: 'free', id: ativa.id },
                  dangerous: next,
                })
              }}
              onOpenTerminal={() => onOpenTerminal({ kind: 'free', id: ativa.id })}
              autoFocus={focus === 'free'}
              preencher
            />
          </>
        )}
      </div>
    </aside>
  )
}
