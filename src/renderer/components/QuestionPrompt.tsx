import { useState } from 'react'
import type { JSX } from 'react'

import type { Question, QuestionAnswers, QuestionRequest } from '../../shared/session'

interface QuestionPromptProps {
  request: QuestionRequest
  onAnswer: (answers: QuestionAnswers) => void
}

/** Os rótulos escolhidos em cada pergunta. A chave é o texto da pergunta, como no `QuestionAnswers`. */
type Picked = Readonly<Record<string, readonly string[]>>

/** O "Outro" digitado em cada pergunta, sob a mesma chave. */
type Typed = Readonly<Record<string, string>>

/**
 * A resposta de uma pergunta, pronta para a ferramenta: os rótulos escolhidos mais o texto livre.
 *
 * A vírgula é o formato que o próprio SDK documenta para `AskUserQuestionOutput.answers` quando há
 * multi-seleção. Na resposta única os dois lados nunca coexistem — escolher desfaz o digitado e
 * vice-versa —, então a junção devolve o único que existe.
 */
function answerOf(question: string, picked: Picked, typed: Typed): string {
  return [...(picked[question] ?? []), (typed[question] ?? '').trim()].filter(Boolean).join(', ')
}

/**
 * As perguntas do `AskUserQuestion` na tela: uma seção por pergunta, um botão por opção.
 *
 * O campo **"Outro"** não é enfeite: a própria ferramenta declara no schema que a opção livre é
 * provida pelo host, então não tê-la seria amputar o contrato — e é ele o caminho para "não é
 * nenhuma dessas", já que a caixa de texto do chat fica travada enquanto a pergunta está aberta.
 *
 * O envio é **um só**, com todas as perguntas juntas, porque é assim que a ferramenta as recebe de
 * volta: um `updatedInput` com o mapa completo. Responder uma de cada vez não tem para onde ir.
 */
export function QuestionPrompt({ request, onAnswer }: QuestionPromptProps): JSX.Element {
  const [picked, setPicked] = useState<Picked>({})
  const [typed, setTyped] = useState<Typed>({})

  const answers: QuestionAnswers = {}
  for (const question of request.questions) {
    const answer = answerOf(question.question, picked, typed)
    if (answer) answers[question.question] = answer
  }

  // **Toda** pergunta respondida, e não "alguma": um mapa com buraco chega ao modelo como pergunta
  // não respondida, e ele não tem como repetir o que já perguntou.
  const complete = Object.keys(answers).length === request.questions.length

  function choose(question: Question, label: string): void {
    setPicked((current) => {
      const already = current[question.question] ?? []

      if (!question.multiSelect) return { ...current, [question.question]: [label] }

      return {
        ...current,
        [question.question]: already.includes(label)
          ? already.filter((item) => item !== label)
          : [...already, label],
      }
    })

    // Numa pergunta de resposta única, escolher desfaz o "Outro": as duas são a mesma resposta, e o
    // clique é o humano dizendo qual delas vale.
    if (!question.multiSelect) setTyped((current) => ({ ...current, [question.question]: '' }))
  }

  function write(question: Question, value: string): void {
    setTyped((current) => ({ ...current, [question.question]: value }))

    if (!question.multiSelect) setPicked((current) => ({ ...current, [question.question]: [] }))
  }

  return (
    <section
      data-testid="question-prompt"
      // Azul, e não âmbar: é a cor do `awaiting_answer` no `StateBadge`, e a pergunta não é a
      // permissão — quem olha o cartão precisa distinguir os dois de longe.
      className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2.5"
    >
      <div className="space-y-3">
        {request.questions.map((question) => (
          // A chave é o texto da pergunta, que é a mesma chave da resposta: se ele não fosse único,
          // o mapa de respostas já não teria como distinguir as duas.
          <div key={question.question} data-question={question.question}>
            <p className="text-[10px] font-semibold tracking-wide text-sky-300 uppercase">
              {question.header}
              {question.multiSelect ? (
                <span className="ml-1.5 font-normal text-sky-300/60 normal-case">
                  escolha quantas quiser
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-sm break-words text-sky-100">{question.question}</p>

            <div className="mt-2 space-y-1.5">
              {question.options.map((option) => {
                const selected = (picked[question.question] ?? []).includes(option.label)

                return (
                  <button
                    key={option.label}
                    type="button"
                    data-testid="question-option"
                    data-label={option.label}
                    // `'false'` explícito, e não o atributo ausente: é o que deixa um teste afirmar
                    // "esta não está escolhida" em vez de só não achar a marca.
                    data-selected={selected ? 'true' : 'false'}
                    onClick={() => {
                      choose(question, option.label)
                    }}
                    className={`block w-full cursor-pointer rounded-md border px-2.5 py-1.5 text-left ${
                      selected
                        ? 'border-sky-400 bg-sky-400/20'
                        : 'border-sky-500/30 hover:bg-sky-400/10'
                    }`}
                  >
                    <span className="block text-xs font-medium text-sky-100">{option.label}</span>
                    {option.description ? (
                      <span className="mt-0.5 block text-[11px] break-words text-sky-200/70">
                        {option.description}
                      </span>
                    ) : null}
                  </button>
                )
              })}

              <input
                data-testid="question-other"
                data-question={question.question}
                value={typed[question.question] ?? ''}
                onChange={(event) => {
                  write(question, event.target.value)
                }}
                placeholder="Outro…"
                className="w-full rounded-md border border-sky-500/30 bg-neutral-950 px-2.5 py-1.5 text-xs text-sky-100 placeholder:text-sky-200/40 focus:border-sky-400 focus:outline-none"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          data-testid="question-submit"
          disabled={!complete}
          onClick={() => {
            onAnswer(answers)
          }}
          className="cursor-pointer rounded-md bg-sky-400 px-3 py-1.5 text-xs font-semibold text-sky-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Responder
        </button>
      </div>
    </section>
  )
}
