import type { JSX } from 'react'

import { Card } from '../ui/card'
import { Chat } from './Chat'

interface TriagePanelProps {
  /** A aba de quem é esta triagem. É ela que vira `SessionScope` e decide a pasta, no main. */
  boardKey: string
  /** Esta triagem roda sem o portão. A marca é da aba e vive só em memória (CA-4). */
  dangerous: boolean
  /** O painel deve sair da coluna: a sessão morreu, ou nunca chegou a subir. */
  onEnd: () => void
  onToggleDangerous: (dangerous: boolean) => void
}

/**
 * O painel da nova triagem, no topo da coluna 📥 Triagem: a casca, e só ela.
 *
 * **Não é um cartão.** Não tem número, campos, responsável nem `data-testid="board-card"`, não entra
 * no `expanded` e não participa da regra "um cartão aberto por coluna" do #45 — abrir um cartão de
 * 📥 Triagem com a triagem aberta não fecha nenhum dos dois. O que ele empresta do cartão é a pele
 * (a mesma `Card` e o mesmo `skin` de `BoardCardView.tsx:108`), para a coluna continuar sendo uma
 * pilha de uma coisa só aos olhos.
 *
 * Sem `CardContent`, porque não há card a ler, e sem `onCollapse`, porque a triagem não colapsa
 * (Decisão 4 do #27): ou ela está aberta conversando, ou não existe. A saída é o `onEnded`, e é por
 * isso que ela nunca falta.
 */
export function TriagePanel({
  boardKey,
  dangerous,
  onEnd,
  onToggleDangerous,
}: TriagePanelProps): JSX.Element {
  return (
    <Card asChild className="bg-secondary-background px-3 py-2.5">
      <section data-testid="triage-panel">
        <div className="text-sm leading-snug">Nova triagem</div>
        {/* O lugar em que o app diz o que esta conversa é para fazer. A skill é quem conduz — o app
            só oferece o comando, e quem o dispara é o humano (RN-4). */}
        <p className="mt-1 text-[11px] text-foreground/70">
          Descreva o que reportaram. A skill conduz e cria o card.
        </p>
        <Chat
          // Objeto novo a cada render, e é seguro pela mesma razão do cartão: quem depende dele é o
          // `useSessionView`, e ele depende da **chave**, não da referência.
          scope={{ kind: 'triage', boardKey }}
          // Ao contrário do cartão: trocar de aba desmonta o painel, e desmontar encerra (CA-3).
          closeOnUnmount
          rascunhoInicial="/gm-triage "
          semPasta="Não sei em que pasta rodar a triagem deste board. Aponte-a e a sessão sobe lá."
          dangerous={dangerous}
          onEnded={onEnd}
          onToggleDangerous={onToggleDangerous}
        />
      </section>
    </Card>
  )
}
