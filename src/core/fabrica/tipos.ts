/**
 * Os tipos do estado da fábrica (card 121, P2 do épico 118).
 *
 * O `estado.json` é um formato durável em disco, e a P3 vai lê-lo de dentro do app. Por isso
 * estes tipos são o contrato: mudar um campo aqui muda o arquivo dos outros.
 * O repo de um registro é o campo repo, ou o repo único do board quando ele falta (#152).
 */

export type EstadoDoDespacho = 'pendente' | 'lancando' | 'rodando' | 'concluido'

export type Desfecho =
  | { tipo: 'proximo'; comando: string }
  | { tipo: 'parada'; motivo: string }
  | { tipo: 'falha'; motivo: string }

export interface Frente {
  id: string // 'fr-0001'
  card: number
  repo?: string // 'owner/name' do card (#152); ausente = o repo único do board (registro de antes do #152)
  criadaEm: string // ISO 8601
  encerradaEm: string | null
}

export interface Despacho {
  id: string // 'd-0002'
  frente: string
  card: number
  repo?: string // 'owner/name' do card (#152); ausente = o repo único do board (registro de antes do #152)
  comando: string // '/gm-spec #121'
  nota: string | null
  estado: EstadoDoDespacho
  pid: number | null
  criadoEm: string
  lancadoEm: string | null
  concluidoEm: string | null
  sessaoClaude: string | null // session_id da saída JSON
  desfecho: Desfecho | null
}

export interface ItemDaFila {
  id: string // 'q-0004'
  card: number
  repo?: string // 'owner/name' do card (#152); ausente = o repo único do board (registro de antes do #152)
  motivo: string
  despacho: string
  sessaoClaude: string | null
  criadoEm: string
  fechadoEm: string | null
  resolucao: string | null
}

export interface EstadoDaFabrica {
  versao: 1
  instancia: string // UUID, nasce com o arquivo
  contador: number
  frentes: Frente[]
  despachos: Despacho[]
  fila: ItemDaFila[]
}
