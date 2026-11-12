import bruto from '../../../fabrica/boards.json'
import { parseConfiguracao, type ConfiguracaoDaFabrica } from '../../core/fabrica/configuracao'

/** O `fabrica/boards.json` do repo, empacotado no bundle (esbuild no CLI, Vite no app). */
export function configuracaoDaFabrica(home: string): ConfiguracaoDaFabrica {
  return parseConfiguracao(bruto, home)
}
