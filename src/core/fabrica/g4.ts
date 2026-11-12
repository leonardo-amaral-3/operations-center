import { type RepoDoBoard, nomeDoRepo } from './configuracao'
import { escaparRegex } from './mandato'

/**
 * A estação G4 do despachante (#143 §G4.1): depois que o `/gm-ship` abre a PR, a fábrica lança uma
 * sessão de revisão de IA independente na mesma frente. Módulo puro: sem IO, sem import de `sala.ts`.
 */

/** O comando do despachante para a revisão: não é skill do claude-brain, e o `iniciar` o recusa. */
export const COMANDO_DO_G4 = '/g4'
/** As ferramentas da sessão do G4 (`claude -p --tools`): sem Edit, Write nem NotebookEdit. */
export const FERRAMENTAS_DO_G4 = ['Bash', 'Read'] as const

export function comandoDoG4(card: number, pr: number): string {
  return `${COMANDO_DO_G4} #${card} PR #${pr}`
}

const COMANDO = /^\/g4 #([1-9]\d*) PR #([1-9]\d*)$/

/** `'/g4 #143 PR #141'` → `{ card: 143, pr: 141 }`; qualquer outra forma → null. */
export function lerComandoDoG4(comando: string): { card: number; pr: number } | null {
  const m = COMANDO.exec(comando.trim())
  if (m === null) return null
  return { card: Number(m[1] ?? ''), pr: Number(m[2] ?? '') }
}

const PR_ABERTA = /^PR #([1-9]\d*) aberta\b/

/** O PR de uma PARADA de ship que começa por `PR #<n> aberta`; qualquer outra → null. */
export function prAbertaDoShip(motivo: string): number | null {
  const m = PR_ABERTA.exec(motivo.trim())
  return m === null ? null : Number(m[1] ?? '')
}

export interface Parecer {
  pr: number
  bloqueantes: number
  url: string
}

/** O motivo de uma PARADA do G4 → parecer; fora do contrato → null. */
export function lerParecer(motivo: string, repo: RepoDoBoard): Parecer | null {
  const parecer = new RegExp(
    `^G4 da PR #([1-9]\\d*): (sem bloqueante|([1-9]\\d*) bloqueantes?) · parecer ` +
      `(https://github\\.com/${escaparRegex(nomeDoRepo(repo))}/pull/([1-9]\\d*)#issuecomment-\\d+)$`,
  )
  const m = parecer.exec(motivo.trim())
  if (m === null) return null
  const pr = Number(m[1] ?? '')
  if (Number(m[5] ?? '') !== pr) return null
  const bloqueantes = m[2] === 'sem bloqueante' ? 0 : Number(m[3] ?? '')
  return { pr, bloqueantes, url: m[4] ?? '' }
}

/** O prompt da sessão do G4 (#143 §G4.2). Só card, PR e repo são interpolados. */
export function promptDoG4(card: number, pr: number, r: RepoDoBoard): string {
  const repo = nomeDoRepo(r)
  return `Revisão G4 da PR #${pr} do card #${card}, despachada pela fábrica.

Você é o revisor de IA independente (G4) desta PR, num contexto novo. Não há humano nesta sessão. Só leitura: não edite arquivo, não faça commit, push, merge, fetch nem mude o board, e não grave no cofre (sem mcp__brain__lembrar: o parecer na PR é o registro); a única escrita permitida é um comentário na PR #${pr}. Não espere o CI. O mandato abaixo vale para as proibições; o "decide sozinho" dele, nesta sessão, é só o parecer.

1. Leia a PR: \`gh pr view ${pr} --repo ${repo} --json title,body,state,baseRefName,headRefName,headRefOid\` e o diff com \`gh pr diff ${pr} --repo ${repo}\`. PR que não está aberta: feche com \`PARADA: G4 da PR #${pr} não rodou: <motivo>\`.
2. Leia o contrato: \`gh issue view ${card} --repo ${repo} --json body,comments\` — o comentário \`<!-- gm:spec -->\` (e os \`<!-- gm:spec-N -->\`), ou o \`<!-- gm:spec-ref -->\` e o \`gm:spec\` do épico que ele aponta — e os critérios de aceite. Um arquivo inteiro na versão da PR, pela rede (a worktree do card já foi removida pelo /gm-ship): \`gh api "repos/${repo}/contents/<caminho>?ref=<headRefOid>" --jq .content | base64 -d\`.
3. A nota do despacho (última linha deste prompt) traz como o /gm-ship terminou. Se ela aponta um problema que a PR ainda carrega (CI vermelho, task faltando, desvio de spec), ele é bloqueante.
4. Revise: correção (bug que o diff introduz), aderência à spec e aos critérios de aceite, escopo (o que a spec põe fora), e os testes que a spec pede. Bloqueante é o que faz um critério de aceite falhar, quebra comportamento que já funcionava, perde ou corrompe dado, ou desvia da spec sem emenda registrada. O resto é menor. Todo achado leva \`arquivo:linha\`.
5. Comente o parecer na PR, uma vez: \`gh pr comment ${pr} --repo ${repo} --body-file -\`. Primeira linha exatamente \`<!-- gm:g4 -->\`; a segunda \`🤖 Fábrica · **G4 da PR #${pr} (revisão independente, contexto novo, só leitura): <sem bloqueante | N bloqueante(s)>.**\`; depois as listas **Bloqueantes** e **Menores**. A URL do comentário é a que o comando imprime; se ele não imprimir, \`gh pr view ${pr} --repo ${repo} --json comments --jq '.comments[-1].url'\`.
6. A última linha da sua resposta é exatamente uma destas, e nada vem depois dela:
PARADA: G4 da PR #${pr}: sem bloqueante · parecer <url do comentário>
PARADA: G4 da PR #${pr}: <N> bloqueante(s) · parecer <url do comentário>
Sem comentário publicado, nenhuma das duas: \`PARADA: G4 da PR #${pr} não rodou: <motivo>\`.`
}
