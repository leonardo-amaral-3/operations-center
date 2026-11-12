import type { NomeDaTela } from '../../../src/renderer/fabrica/rotas'
import { agentes } from './agentes'
import { briefing } from './briefing'
import { card } from './card'
import type { TelaDoHarness } from './comum'
import { decisao } from './decisao'
import { entrada } from './entrada'
import { mandato } from './mandato'
import { pergunta } from './pergunta'
import { portfolio } from './portfolio'
import { relatorio } from './relatorio'
import { release } from './release'
import { sala } from './sala'

/** As 11 telas do protótipo; cada fase edita só os módulos das suas. */
export const TELAS_DO_HARNESS: Record<NomeDaTela, TelaDoHarness> = {
  sala,
  agentes,
  pergunta,
  decisao,
  card,
  entrada,
  relatorio,
  portfolio,
  mandato,
  briefing,
  release,
}
