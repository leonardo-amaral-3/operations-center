import { useState } from 'react'
import type { JSX } from 'react'

import type { DecisaoDoDia, RevisaoNaSala } from '../../../shared/fabrica'
import { Button } from '../../ui/button'
import { Textarea } from '../../ui/textarea'
import { aberta } from '../decisoes'
import { quando } from '../Moldura'
import type { PropsDaTela } from '../telas'

/** Os botões de revisão, divididos pelo Relatório e pelo Portfólio (#134, §F5.10). */
export function BotoesDaRevisao(p: {
  decisao: DecisaoDoDia
  revisao: RevisaoNaSala | undefined
  podeLer: boolean // false quando as revisões não deram para ler
  comando: PropsDaTela['comando']
  emVoo: boolean
  aoGravar: () => Promise<void>
  terceiro: JSX.Element // "Ver no cofre" no Relatório, "Abrir o card" no Portfólio
  sempre: boolean // true no Portfólio (botões sempre à vista); false no Relatório (só se aberta)
}): JSX.Element | null {
  const [contestando, setContestando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const abertaAgora = aberta(p.decisao, p.revisao)
  const habilitado = p.podeLer && abertaAgora && !p.emVoo
  // A caixa some quando a contestação chega às revisões relidas, e não ao fim do comando: o comando
  // não lança quando falha (a raiz mostra o erro), e fechar ali perdia o motivo (G4 da PR #140).
  const caixaAberta = contestando && abertaAgora

  if (!p.sempre && !abertaAgora) return null

  const fechar = (): void => {
    setContestando(false)
    setMotivo('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="fabrica-confirmar"
          className="bg-attention text-attention-foreground"
          disabled={!habilitado}
          onClick={() => {
            void (async () => {
              await p.comando({ tipo: 'confirmar', arquivo: p.decisao.arquivo })
              await p.aoGravar()
            })()
          }}
        >
          Confirmar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="neutral"
          data-testid="fabrica-contestar"
          disabled={!habilitado}
          onClick={() => {
            setContestando(true)
          }}
        >
          Contestar
        </Button>
        {p.terceiro}
      </div>
      {caixaAberta && (
        <div className="flex flex-col gap-2">
          <Textarea
            data-testid="fabrica-contestar-motivo"
            aria-label="Por que contestar"
            maxLength={2000}
            value={motivo}
            onChange={(evento) => {
              setMotivo(evento.target.value)
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="fabrica-contestar-gravar"
              disabled={!habilitado || motivo.trim() === ''}
              onClick={() => {
                void (async () => {
                  await p.comando({
                    tipo: 'contestar',
                    arquivo: p.decisao.arquivo,
                    motivo,
                  })
                  await p.aoGravar()
                })()
              }}
            >
              Gravar contestação
            </Button>
            <Button
              type="button"
              size="sm"
              variant="neutral"
              data-testid="fabrica-contestar-cancelar"
              onClick={fechar}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function LinhaDaRevisao({
  revisao,
}: {
  revisao: RevisaoNaSala | undefined
}): JSX.Element | null {
  if (revisao === undefined) return null
  if (revisao.veredito === 'confirmada') {
    return (
      <p data-testid="fabrica-revisao" className="text-sm">
        Confirmada em {quando(revisao.em)}.
      </p>
    )
  }

  return (
    <p data-testid="fabrica-revisao" className="text-sm">
      Contestada em {quando(revisao.em)}: {revisao.motivo ?? ''}
      {revisao.atendida !== null &&
        ` · atendida em ${quando(revisao.atendida.em)}: ${revisao.atendida.resolucao}`}
    </p>
  )
}
