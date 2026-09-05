import { contextBridge } from 'electron'

// A superfície que o renderer enxerga. Os canais `session:*` entram junto com o contrato IPC;
// aqui existe só a ponte, para que a casca já suba com `contextIsolation` de verdade.
const api = {}

contextBridge.exposeInMainWorld('oc', api)
