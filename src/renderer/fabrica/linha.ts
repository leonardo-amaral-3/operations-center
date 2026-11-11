import type { EstacaoDaFabrica } from '../../shared/fabrica'

/**
 * A Linha da fábrica (#131, §F2.6): as nove colunas da Sala e os textos que as duas telas dividem.
 * Sem React, para o teste do protótipo importá-lo no programa do Node. `estadoNaLinha` e
 * `previsaoDosPendentes` chegam com o retrato da F2, que é quem lhes dá o `viva` e os `recursos`.
 */
export type ColunaDaLinha =
  | 'entrada'
  | 'card'
  | 'spec'
  | 'implementacao'
  | 'integracao'
  | 'revisao'
  | 'validacao'
  | 'release'
  | 'operacao'

/** Os níveis vêm do mandato #1439 (cofre #1720) e são provisórios até a F5 ler os portões. */
export const COLUNAS_DA_LINHA: ReadonlyArray<{
  coluna: ColunaDaLinha
  rotulo: string
  nivel: 'A' | 'B' | 'C'
  vazio: string
}> = [
  { coluna: 'entrada', rotulo: 'Entrada', nivel: 'A', vazio: 'Nenhuma triagem em voo.' },
  { coluna: 'card', rotulo: 'Card · G1', nivel: 'A', vazio: 'Nenhum card esperando promoção.' },
  { coluna: 'spec', rotulo: 'Spec · G2', nivel: 'A', vazio: 'Nenhuma spec em voo.' },
  {
    coluna: 'implementacao',
    rotulo: 'Implementação',
    nivel: 'A',
    vazio: 'Nenhuma task em voo.',
  },
  {
    coluna: 'integracao',
    rotulo: 'Integração',
    nivel: 'A',
    vazio: 'O merge na dev é da orquestradora; nenhuma sessão da fábrica para aqui.',
  },
  { coluna: 'revisao', rotulo: 'Revisão · G4', nivel: 'A', vazio: 'Nenhuma PR em voo.' },
  {
    coluna: 'validacao',
    rotulo: 'Validação dev',
    nivel: 'C',
    vazio: 'A validação em dev é sua; a fábrica não despacha esta estação.',
  },
  {
    coluna: 'release',
    rotulo: 'Release · G5',
    nivel: 'C',
    vazio: 'Trem vazio. Release e produção são sempre seus.',
  },
  {
    coluna: 'operacao',
    rotulo: 'Operação',
    nivel: 'C',
    vazio: 'A fábrica não observa produção nesta prova.',
  },
]

/** `tasks` roda com o card em 🎯 Especificação (M12), então cai na coluna da spec. */
export function colunaDaEstacao(e: EstacaoDaFabrica | null): ColunaDaLinha | null {
  if (e === null) return null
  return e === 'tasks' ? 'spec' : e
}

export const ROTULO_DA_ESTACAO: Record<EstacaoDaFabrica, string> = {
  entrada: 'Entrada',
  card: 'Card · G1',
  spec: 'Spec · G2',
  tasks: 'Tasks · G3',
  implementacao: 'Implementação',
  integracao: 'Integração',
  revisao: 'Revisão · G4',
  validacao: 'Validação dev',
  release: 'Release · G5',
  operacao: 'Operação',
}

export const ROTULO_DO_PASSO: Record<string, string> = {
  'gm-triage': 'Triagem',
  'gm-card': 'G1',
  'gm-spec': 'G2',
  'gm-plan-tasks': 'G3',
  'gm-implement': 'Task',
  'gm-correcao': 'Correção',
  'gm-ship': 'G4',
}

/** `'/gm-spec #4'` → `'gm-spec'`; o que não começa por `/skill` volta inteiro. */
export function skillDoComando(comando: string): string {
  return /^\/(\S+)/.exec(comando)?.[1] ?? comando
}

/** O único jeito de as telas escreverem um card. */
export function rotuloDoCard(card: number, titulo: string | null): string {
  return titulo === null ? `#${card}` : `#${card} ${titulo}`
}

export function plural(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios
}

export function horaCurta(iso: string): string {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return iso
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function gigas(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
}
