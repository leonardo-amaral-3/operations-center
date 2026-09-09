import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'

import type { SessionScope } from '../../shared/ipc'
import type { SessionState } from '../../shared/session'
import { useSessionView } from '../session/useSessionView'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { isFala, MessageBubble } from './MessageBubble'
import { PermissionPrompt } from './PermissionPrompt'
import { QuestionPrompt } from './QuestionPrompt'
import { StateBadge } from './StateBadge'
import { ToolEntry } from './ToolEntry'
import { TurnPulse } from './TurnPulse'

/**
 * O que o kanban guarda da sessão de um cartão para continuar desenhando-a depois que o chat sai da
 * tela. É o mínimo do CA-6: uma sessão viva num cartão fechado precisa ser visível para ser gerida.
 */
export interface CardSession {
  id: string
  state: SessionState
}

/** O registro do kanban inteiro: `itemId` → a sessão daquele cartão. */
export type CardSessions = Readonly<Record<string, CardSession>>

interface ChatProps {
  /** De quem é esta conversa. Objeto novo a cada render é seguro — ver `useSessionView`. */
  scope: SessionScope
  /**
   * Se sair de cena encerra a sessão. `false` no cartão (colapsar não encerra, CA-6 do #6); `true`
   * na triagem (trocar de aba encerra, CA-3 do #27).
   */
  closeOnUnmount: boolean
  /** Esta conversa roda sem o portão de permissões (CA-2 do #10). */
  dangerous: boolean
  /** O texto com que a caixa nasce. Ausente no cartão; `/gm-triage ` na triagem. */
  rascunhoInicial?: string
  /** A frase do CA-5 quando não há pasta conhecida: o cartão e a triagem não erram pelo mesmo motivo. */
  semPasta: string
  /**
   * A ação secundária do rodapé: colapsar fecha a vista, não a conversa (CA-6). Ausente = sem botão,
   * que é a triagem — ou ela está aberta conversando, ou não existe (Decisão 4 do #27).
   */
  onCollapse?: () => void
  /**
   * Chamado quando esta conversa deve **sair de cena de vez**. A triagem usa para sumir da coluna; o
   * cartão não o passa, porque ele continua existindo depois de a sessão morrer.
   */
  onEnded?: () => void
  /** De quem é a sessão, para o cartão fechado. Ausente na triagem, que não tem forma fechada. */
  onSession?: (session: CardSession) => void
  /** Recebe o valor **final**, não um "alterne" — quem inverte é este componente. */
  onToggleDangerous: (dangerous: boolean) => void
}

/**
 * Uma conversa com uma sessão do Claude Code, parametrizada pelo escopo dela: hoje o cartão do
 * kanban e o painel de triagem.
 *
 * É generalização, e não cópia (Decisão 8 do #27) — o mesmo argumento que criou o `useSessionView`:
 * duas cópias da mesma corrida divergem na primeira correção que só uma delas receber. O irmão de
 * nome parecido é o `Conversation`, e a diferença é esta: ele desenha mensagens que recebe pronto,
 * este **possui** a sessão.
 *
 * A sessão é pedida **pelo escopo**: quem traduz escopo em pasta é o main, e o renderer nunca manda
 * caminho. Se sair de cena a mata é o `closeOnUnmount`, e `false` no cartão é o CA-6 escrito em uma
 * linha: colapsar não encerra nada.
 *
 * O histórico tem scroll próprio e altura máxima porque isto vive dentro de uma coluna: sem o teto,
 * uma conversa longa empurraria a coluna para sempre e o kanban deixaria de ser um kanban.
 */
export function Chat({
  scope,
  closeOnUnmount,
  dangerous,
  rascunhoInicial,
  semPasta,
  onCollapse,
  onEnded,
  onSession,
  onToggleDangerous,
}: ChatProps): JSX.Element {
  const { view, send, decide, answer, stop, end, restart } = useSessionView({
    // O escopo vem montado no JSX, então é objeto novo a cada render — e é seguro: o hook depende da
    // **chave** dele, não da referência.
    scope,
    closeOnUnmount,
  })
  const [draft, setDraft] = useState(rascunhoInicial ?? '')
  const history = useRef<HTMLDivElement>(null)
  // O "uma vez" do `onEnded` abaixo. Num ref porque `onEnded` é arrow nova a cada render do pai: sem
  // ele, o efeito reentraria a cada quadro enquanto a sessão estivesse `closed`.
  const saiu = useRef(false)

  useEffect(() => {
    if (view.id === null) return

    // A triagem não passa `onSession`: aquele registro existe para o cartão **fechado**, e ela não
    // tem forma fechada (Decisão 4 do #27).
    onSession?.({ id: view.id, state: view.state })
  }, [view.id, view.state, onSession])

  // A saída de cena de quem tem `onEnded`, e o gatilho é o **estado**, não o clique: assim o painel
  // só some depois de a sessão ter morrido de verdade, e um `close` que falhe não apaga da tela a
  // conversa que ainda está lá.
  useEffect(() => {
    if (onEnded === undefined || view.state.kind !== 'closed' || saiu.current) return

    saiu.current = true
    onEnded()
  }, [view.state.kind, onEnded])

  // O scroll é do próprio histórico, e não um `scrollIntoView`: dentro de um cartão, pedir ao
  // navegador que traga o fim da conversa à vista arrastaria junto a coluna e o kanban inteiro.
  useEffect(() => {
    const node = history.current
    if (node) node.scrollTop = node.scrollHeight
  }, [view.messages])

  async function pickFolder(): Promise<void> {
    const { chosen } = await window.oc.chooseFolder({ scope })
    // Só o "houve escolha" volta pela ponte; a pasta fica no main. O `restart` é o caminho de volta:
    // o mesmo `start`, agora com o índice sabendo onde o repo está.
    if (chosen) restart()
  }

  if (view.unknownFolder) {
    return (
      <div className="mt-3 border-t-2 border-border pt-3">
        {/* Sem `card-chat` aqui, de propósito: não há sessão e não há conversa. O cartão está aberto
            para pedir a pasta, e é só isso que ele oferece (CA-5). */}
        <p className="text-xs break-words text-foreground/60">{semPasta}</p>

        <div className="mt-2 flex items-center justify-end gap-2">
          {/* A saída, e ela nunca falta — metade da Decisão 11 do #27. Aqui a sessão nem subiu (é o
              `view.id === null` da régua do rodapé, verdadeiro por construção neste ramo), então
              quem tem `onEnded` sai por ele direto: não há o que encerrar. Sem este botão, um painel
              que caísse aqui ficaria preso na coluna para sempre. */}
          {onCollapse ? (
            <Button
              type="button"
              data-testid="card-collapse"
              variant="neutral"
              size="xs"
              onClick={onCollapse}
            >
              Fechar
            </Button>
          ) : null}
          {onEnded ? (
            <Button
              type="button"
              data-testid="card-end-session"
              variant="neutral"
              size="xs"
              className="bg-danger text-danger-foreground"
              onClick={onEnded}
            >
              Fechar
            </Button>
          ) : null}
          {/* A ação primária desta vista, e a única que leva a algum lugar: sem pasta não há
              conversa, e o violet é o que separa "faça isto" de "saia daqui". */}
          <Button
            type="button"
            data-testid="choose-folder"
            size="xs"
            onClick={() => {
              void pickFolder()
            }}
          >
            Escolher a pasta…
          </Button>
        </div>
      </div>
    )
  }

  // A régua da saída do rodapé (Decisão 11 do #27). `view.id === null` entra junto com `closed` e
  // `failed` porque uma sessão que nunca subiu também não tem o que encerrar — é a mesma régua do
  // ramo sem pasta acima, onde ela é verdadeira por construção e por isso não precisa ser calculada.
  const morta = view.state.kind === 'closed' || view.state.kind === 'failed' || view.id === null
  // A outra metade do CA-4, e ela mora aqui porque é aqui que a lista está: silêncio com ferramenta
  // rodando é o normal de uma ferramenta demorada, e acusá-lo ensinaria a ignorar a marca.
  const somethingRunning = view.messages.some(
    (message) => message.role === 'tool' && message.status === 'running',
  )
  // A caixa trava enquanto há pergunta aberta, e **não** trava durante uma permissão: com a pergunta
  // o turno está parado esperando o `tool_result`, e o que fosse digitado aqui entraria na fila
  // atrás de uma resposta que ninguém deu. A saída para "nenhuma dessas" é o campo livre da própria
  // pergunta. Na permissão a fila de entrada do core funciona normalmente.
  const mute = morta || view.question !== null

  function submit(): void {
    const text = draft.trim()
    if (!text || mute) return

    setDraft('')
    send(text)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter envia, Shift+Enter quebra linha — a mesma convenção da tela de chat.
    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    submit()
  }

  return (
    <div data-testid="card-chat" className="mt-3 border-t-2 border-border pt-3">
      <div ref={history} className="max-h-80 space-y-2 overflow-y-auto">
        {view.messages.length === 0 ? (
          <p className="text-xs text-foreground/60">
            A sessão está de pé. Escreva a primeira mensagem.
          </p>
        ) : null}

        {/* A nota (`notice`) é o app falando sobre a sessão, e por isso não é bolha de ninguém: sem
            o desvio, o ternário abaixo a rotularia como fala do Claude. O `data-testid="message"`
            continua para ela ser contável pela mesma via dos seletores do smoke. */}
        {view.messages.map((message) => {
          // A ação entra na conversa pela mesma porta que a fala, e na posição em que aconteceu:
          // é isso que faz a trilha ser histórico, e não um painel ao lado dele.
          if (message.role === 'tool') return <ToolEntry key={message.id} entry={message} />

          return isFala(message) ? (
            <MessageBubble key={message.id} message={message} scale="xs" />
          ) : (
            <p
              key={message.id}
              data-testid="message"
              data-role="notice"
              className="py-0.5 text-center text-[10px] tracking-wide text-foreground/60 uppercase"
            >
              {message.text}
            </p>
          )
        })}
      </div>

      {view.permission ? (
        <div className="mt-2">
          <PermissionPrompt request={view.permission} onDecide={decide} queued={view.queued} />
        </div>
      ) : null}

      {view.question ? (
        <div className="mt-2">
          <QuestionPrompt request={view.question} onAnswer={answer} queued={view.queued} />
        </div>
      ) : null}

      {/* Entre o histórico e a caixa: é onde o spinner do Claude Code vive, e o único lugar em que
          o scroll da conversa não o leva embora justamente quando ele importa. */}
      <TurnPulse activity={view.activity} somethingRunning={somethingRunning} />

      {/* O `min-h-0` derruba o `min-h-[80px]` da primitiva pelo `twMerge`, e não é enfeite:
          aquela altura mínima estouraria a coluna de 288px que o CA-3 defende. Quem manda na
          altura aqui continua sendo o `rows`. */}
      <Textarea
        data-testid="card-chat-input"
        value={draft}
        disabled={mute}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onKeyDown={handleKeyDown}
        rows={2}
        placeholder={
          view.question
            ? 'Responda à pergunta acima para voltar a escrever.'
            : 'Escreva para a sessão…  Enter envia, Shift+Enter quebra linha.'
        }
        className="mt-2 min-h-0 resize-none text-xs"
      />

      {/* A pasta na tela é o CA-3, e não enfeite: é a única forma de flagrar a olho uma sessão que
          subiu no lugar errado. Ela só aparece quando o `init` chega — a âncora posta antes disso
          deixaria um teste ler um caminho que ainda não é o da sessão. */}
      {view.init ? (
        <p
          data-testid="card-chat-cwd"
          // Âncora de máquina, **sem sufixo visível**: M-7 mede que o `init` chega a cada turno,
          // então entre ligar o modo e mandar o próximo prompt o valor em mãos ainda é o do
          // nascimento da sessão — mostrá-lo seria mentir na única janela em que a divergência
          // importa. O sinal humano é o crachá, que é imediato; este é a segunda fonte, a do SDK, e
          // só é legível depois de um turno ter rodado no modo novo (que é quando o smoke a lê).
          data-permission-mode={view.init.permissionMode}
          title={view.init.cwd}
          className="mt-2 truncate font-mono text-[10px] text-foreground/60"
        >
          {view.init.cwd}
        </p>
      ) : (
        <p className="mt-2 text-[10px] text-foreground/60">Conectando à sessão do Claude Code…</p>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <StateBadge state={view.state} />
        </div>

        {/* Duas ações distintas no cartão, e é o CA-6 inteiro: colapsar devolve o cartão fechado
            com a sessão viva; encerrar mata a sessão. O app nunca faz o segundo por conta própria. */}
        <div className="flex shrink-0 gap-2">
          {/* Renderização condicional, e não `disabled`: o botão ausente é a afirmação que um teste
              faz sem ambiguidade, e o olho não precisa distinguir dois cinzas. A ação do turno vem
              antes das ações da sessão. */}
          {view.state.kind === 'working' ? (
            <Button
              type="button"
              data-testid="card-stop-turn"
              variant="neutral"
              size="xs"
              className="bg-warning text-warning-foreground"
              onClick={stop}
            >
              Parar
            </Button>
          ) : null}
          {/* Depois da ação do turno e antes das ações da vista, que é a ordem que este rodapé já
              enuncia.

              **Sem cor**, ao contrário do "Parar" (`bg-warning`) e do "Encerrar" (`bg-danger`):
              quem carrega a cor é o crachá, que é o sinal permanente. Repetir o `bg-danger` num
              botão vizinho ao "Encerrar sessão" faria o destrutivo deixar de ler como destrutivo —
              a separação que aqueles dois tokens existem para manter.

              **E não é desabilitado por `morta`**, ao contrário do "Encerrar sessão" no cartão:
              marcar um cartão cuja sessão morreu é decisão sobre a **próxima** sessão dele, e é
              legítima. */}
          <Button
            type="button"
            data-testid="card-danger-toggle"
            data-dangerous={String(dangerous)}
            variant="neutral"
            size="xs"
            onClick={() => {
              // A inversão acontece **aqui**, e num lugar só: é este componente que tem o valor
              // corrente na mão. Quem recebe o callback recebe o valor final, não um "alterne".
              onToggleDangerous(!dangerous)
            }}
          >
            {dangerous ? 'Voltar a pedir' : 'Rodar sem pedir permissão'}
          </Button>
          {/* Ausente na triagem, que não colapsa: ou está aberta conversando, ou não existe
              (Decisão 4 do #27). Renderização condicional, e não `disabled`, pela mesma razão do
              "Parar" acima. */}
          {onCollapse ? (
            <Button
              type="button"
              data-testid="card-collapse"
              variant="neutral"
              size="xs"
              onClick={onCollapse}
            >
              Colapsar
            </Button>
          ) : null}
          {/* Âmbar em "Parar" e vermelho em "Encerrar", pelos mesmos tokens do `StateBadge`: parar
              o turno é interrupção, encerrar a sessão é destruição, e a cor separa as duas antes de
              o olho chegar ao rótulo.

              Dois regimes, e é a outra metade da Decisão 11 do #27. **No cartão** (`onEnded`
              ausente) ele é o botão de hoje, desabilitado quando não há sessão viva: o cartão
              continua existindo depois de a conversa morrer, e nada fica preso. **Na triagem**
              (`onEnded` presente) ele é a única saída, e por isso **nunca** desabilita — com sessão
              viva encerra, e o painel some quando o estado vira `closed`; sem sessão viva (morta,
              falhada, ou que nem subiu) chama o `onEnded` direto, porque não há o que encerrar. */}
          <Button
            type="button"
            data-testid="card-end-session"
            variant="neutral"
            size="xs"
            className="bg-danger text-danger-foreground"
            disabled={onEnded === undefined && morta}
            onClick={() => {
              if (!morta) {
                end()
                return
              }

              onEnded?.()
            }}
          >
            {onEnded !== undefined && morta ? 'Fechar' : 'Encerrar sessão'}
          </Button>
        </div>
      </div>
    </div>
  )
}
