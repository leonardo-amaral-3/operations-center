import { asArray, asNumber, asRecord, asString } from './narrow'
import type { PullRequestRef, PullRequestState } from './types'

/**
 * A primeira linha não vazia do corpo do PR declara de qual card ele é. Aceita `**Card:** #n`, a
 * forma medida em todos os PRs de card, e `Card: #n`, a forma da norma. O `\b` é a fronteira que
 * impede `#280` de passar por `#28`, e o `[1-9]` à frente impede `#028`: a regra é o grupo **igual**
 * a `n`, e o `Number` que o converte apagaria o zero à esquerda.
 */
const CARD_LINE = /^(\*\*)?Card:(\*\*)?\s*#([1-9]\d*)\b/

/** O BOM que alguns editores põem no início do corpo, montado por código porque o literal é invisível. */
const BOM = String.fromCharCode(0xfeff)

const ESTADOS: readonly PullRequestState[] = ['OPEN', 'MERGED', 'CLOSED']

/** Quanto menor, melhor: aberto vence mergeado, que vence fechado. */
const PRIORIDADE: Record<PullRequestState, number> = { OPEN: 0, MERGED: 1, CLOSED: 2 }

/**
 * Qual PR da timeline da issue é o do card.
 *
 * Recebe o objeto `timelineItems` cru e o lê com as guardas de `narrow.ts`. Uma referência só conta
 * se o PR for do mesmo repositório (um fork que cita o card fica de fora) **e** declarar o card na
 * primeira linha do corpo — PR de trem e PR de outro card que só citam o número não são o PR deste
 * card. Timeline ausente ou malformada devolve `null`: a aba é um acréscimo, e a falha dela não
 * derruba nada.
 *
 * Empate: o estado manda (`OPEN` > `MERGED` > `CLOSED`), depois o maior número.
 */
export function pickPullRequest(
  timeline: unknown,
  card: { owner: string; name: string; number: number },
): PullRequestRef | null {
  const repo = `${card.owner}/${card.name}`.toLowerCase()
  let melhor: PullRequestRef | null = null

  for (const raw of asArray(asRecord(timeline)?.['nodes'])) {
    const source = asRecord(asRecord(raw)?.['source'])
    const number = asNumber(source?.['number'])
    const url = asString(source?.['url'])
    const state = asString(source?.['state'])
    const body = asString(source?.['body'])
    if (number === null || url === null || body === null) continue
    if (state === null || !ESTADOS.includes(state as PullRequestState)) continue

    const nameWithOwner = asString(asRecord(source?.['repository'])?.['nameWithOwner'])
    if (nameWithOwner?.toLowerCase() !== repo) continue
    if (cardDeclarado(body) !== card.number) continue

    const candidato: PullRequestRef = { number, url, state: state as PullRequestState }
    if (melhor === null || vence(candidato, melhor)) melhor = candidato
  }

  return melhor
}

function cardDeclarado(body: string): number | null {
  const primeira = (body.startsWith(BOM) ? body.slice(1) : body)
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .find((linha) => linha !== '')
  const achou = primeira === undefined ? null : CARD_LINE.exec(primeira)
  return achou ? Number(achou[3]) : null
}

function vence(a: PullRequestRef, b: PullRequestRef): boolean {
  if (a.state !== b.state) return PRIORIDADE[a.state] < PRIORIDADE[b.state]
  return a.number > b.number
}
