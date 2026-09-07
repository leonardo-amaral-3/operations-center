import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * A entrada do usuário, como o `query()` do SDK a quer: um `AsyncIterable` que nós alimentamos de
 * fora, quando a pessoa digita.
 *
 * O consumidor (o `query()`) fica estacionado numa Promise enquanto não há nada pendente; `push()`
 * a resolve. Fechar a fila encerra o turno corrente e termina o `query()` — é assim que a sessão
 * morre de forma limpa quando a janela fecha.
 */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  #pending: SDKUserMessage[] = []
  #wake: (() => void) | undefined
  #closed = false

  /** Enfileira uma mensagem do usuário. Depois de `close()` não há mais sessão para receber: no-op. */
  push(text: string): void {
    if (this.#closed) return

    this.#pending.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    })
    this.#wake?.()
  }

  /** Termina a iteração — depois de drenar o que já estava enfileirado. */
  close(): void {
    this.#closed = true
    this.#wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    for (;;) {
      while (this.#pending.length > 0) yield this.#pending.shift()!
      if (this.#closed) return
      await new Promise<void>((resolve) => {
        this.#wake = resolve
      })
      // O despertador é de uso único: guardá-lo depois de resolvido só deixaria `push()`
      // chamando uma Promise morta.
      this.#wake = undefined
    }
  }
}
