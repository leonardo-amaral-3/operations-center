import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boardPadrao } from '../../src/core/fabrica/configuracao'
import { configuracaoDaFabrica } from '../../src/main/fabrica/configuracao'
import {
  avaliarComando,
  avaliarNota,
  cardDoComando,
  caminhosProibidos,
  marcaDaProva,
  marcaDoDespacho,
  montarPrompt,
  MANDATO_QUERY,
  textoDoMandato,
} from '../../src/core/fabrica/mandato'

const RAIZ = join(__dirname, '..', '..')
const proibidos = caminhosProibidos('/home/u', boardPadrao(configuracaoDaFabrica('/home/u')))

describe('avaliarComando', () => {
  it.each([
    '/gm-spec #1',
    '/gm-plan-tasks /home/u/pessoal/planning/118-x',
    '/gm-implement /home/u/pessoal/operations-center-121-despachante',
    '/gm-ship',
  ])('deixa passar %s', (c) => {
    expect(avaliarComando(c, proibidos)).toEqual({ ok: true })
  })

  const recusas: Array<[string, string]> = [
    ['/gm-release', 'a skill /gm-release não é despachada pela fábrica (fora do mandato)'],
    ['/gm-hotfix #3', 'a skill /gm-hotfix não é despachada pela fábrica (fora do mandato)'],
    ['/gm-prd x', 'a skill /gm-prd não é despachada pela fábrica (fora do mandato)'],
    ['merge na main', 'não é um comando /gm-*: merge na main'],
    ['/gm-ship --base main', 'o argumento cita main, release, tag ou hotfix'],
    ['/gm-implement criar tags', 'o argumento cita main, release, tag ou hotfix'],
    ['/gm-implement hotfix já', 'o argumento cita main, release, tag ou hotfix'],
    [
      '/gm-spec ~/.config/operations-center/x',
      'o argumento aponta para a instalação viva, o checkout principal ou os repos da Notoria',
    ],
    [
      '/gm-implement /home/u/pessoal/operations-center',
      'o argumento aponta para a instalação viva, o checkout principal ou os repos da Notoria',
    ],
    [
      '/gm-implement `~/pessoal/operations-center`',
      'o argumento aponta para a instalação viva, o checkout principal ou os repos da Notoria',
    ],
    [
      '/gm-implement /home/u/pessoal/operations-center.',
      'o argumento aponta para a instalação viva, o checkout principal ou os repos da Notoria',
    ],
    [
      '/gm-implement /home/u/pessoal/operations-center/dist',
      'o argumento aponta para a instalação viva, o checkout principal ou os repos da Notoria',
    ],
    [
      '/gm-implement $HOME/pessoal/operations-center',
      'o argumento aponta para a instalação viva, o checkout principal ou os repos da Notoria',
    ],
    [
      '/gm-spec ~/notoria/x',
      'o argumento aponta para a instalação viva, o checkout principal ou os repos da Notoria',
    ],
  ]
  it.each(recusas)('recusa %s', (comando, motivo) => {
    expect(avaliarComando(comando, proibidos)).toEqual({ ok: false, motivo })
  })
})

describe('avaliarNota', () => {
  it('recusa nota que cita main, e deixa passar a que não cita', () => {
    expect(avaliarNota('faça merge na main', proibidos)).toEqual({
      ok: false,
      motivo: 'a nota cita main, release, tag ou hotfix',
    })
    expect(avaliarNota('só a task 1', proibidos)).toEqual({ ok: true })
  })
})

describe('caminhosProibidos', () => {
  it('traz o caminho e as três grafias relativas dos que ficam dentro da home', () => {
    expect(proibidos.caminhos).toContain('/home/u/.local/bin/operations-center')
    expect(proibidos.caminhos).toContain('~/pessoal/operations-center')
    expect(proibidos.caminhos).toContain('$HOME/notoria')
    expect(proibidos.caminhos).toContain('${HOME}/.config/operations-center')
  })

  it('o board padrão proíbe o mesmo conjunto de hoje, com o mesmo motivo', () => {
    expect([...proibidos.caminhos].sort()).toEqual(
      [
        '/home/u/.local/bin/operations-center',
        '~/.local/bin/operations-center',
        '$HOME/.local/bin/operations-center',
        '${HOME}/.local/bin/operations-center',
        '/home/u/.config/operations-center',
        '~/.config/operations-center',
        '$HOME/.config/operations-center',
        '${HOME}/.config/operations-center',
        '/home/u/pessoal/operations-center',
        '~/pessoal/operations-center',
        '$HOME/pessoal/operations-center',
        '${HOME}/pessoal/operations-center',
        '/home/u/notoria',
        '~/notoria',
        '$HOME/notoria',
        '${HOME}/notoria',
      ].sort(),
    )
    expect(proibidos.motivo).toBe('a instalação viva, o checkout principal ou os repos da Notoria')
  })

  it('um alvo fora da home entra só pelo caminho absoluto', () => {
    const r = caminhosProibidos('/home/u', {
      checkoutPrincipal: '/srv/oc',
      proibidos: { caminhos: [], motivo: 'm' },
    })
    expect(r.caminhos).toContain('/srv/oc')
    expect(r.caminhos.filter((p) => p.includes('srv'))).toEqual(['/srv/oc'])
    expect(r.motivo).toBe('m')
  })
})

describe('marcas e card', () => {
  it('marcaDaProva é a primeira linha não vazia', () => {
    expect(marcaDaProva('\n\nMANDATO X\n- a')).toBe('MANDATO X')
    expect(() => marcaDaProva('')).toThrow('mandato vazio')
    expect(() => marcaDaProva(' \n\n')).toThrow('mandato vazio')
  })

  it('marcaDoDespacho junta instância e id', () => {
    expect(marcaDoDespacho('u', 'd-0002')).toBe('u/d-0002')
  })

  it('cardDoComando', () => {
    expect(cardDoComando('/gm-spec #121')).toBe(121)
    expect(cardDoComando('/gm-plan-tasks /p/118-x')).toBeNull()
    expect(cardDoComando('/gm-implement 12')).toBe(12)
  })
})

describe.skipIf(process.platform !== 'linux')('montarPrompt contra o bash do d.sh', () => {
  let pasta = ''
  afterEach(() => {
    if (pasta) rmSync(pasta, { recursive: true, force: true })
  })

  const linhaDoDsh =
    'M=$(cat "$ARQ"); { echo "$CMD"; echo; echo "Argumento do despacho:"; printf "%s\\n" "$M"; [ -n "$EXTRA" ] && echo "- Nesta sessão: $EXTRA"; } > "$P"; printf %s "$(cat "$P")"'

  for (const finais of ['', '\n', '\n\n']) {
    for (const extra of ['', 'só a task 1']) {
      it(`${finais.length} \\n finais, ${extra ? 'com' : 'sem'} nota`, () => {
        pasta = mkdtempSync(join(RAIZ, 'node_modules', '.oc-fabrica-teste-'))
        const mandato = `MANDATO DE TESTE\n\n- regra um\n- regra dois${finais}`
        const arq = join(pasta, 'mandato.txt')
        writeFileSync(arq, mandato)
        const r = spawnSync('bash', ['-c', linhaDoDsh], {
          encoding: 'utf8',
          env: {
            ...process.env,
            ARQ: arq,
            CMD: '/gm-spec #121',
            EXTRA: extra,
            P: join(pasta, 'p'),
          },
        })
        expect(r.status === 0 || extra === '').toBe(true)
        expect(montarPrompt('/gm-spec #121', mandato, extra || null)).toBe(r.stdout)
      })
    }
  }
})

describe('textoDoMandato', () => {
  const resposta = (text: unknown) => ({ data: { repository: { object: { text } } } })

  it('devolve o texto', () => {
    expect(textoDoMandato(resposta('MANDATO\nresto'), 'dev')).toBe('MANDATO\nresto')
  })
  it('erro da API lança com a mensagem', () => {
    expect(() =>
      textoDoMandato({ data: null, errors: [{ message: 'Bad credentials' }] }, 'dev'),
    ).toThrow('Bad credentials')
  })
  it.each([
    ['objeto nulo', { data: { repository: { object: null } } }],
    ['repositório nulo', { data: { repository: null } }],
    ['sem data', { data: null }],
    ['texto vazio', resposta('  \n')],
    ['texto que não é string', resposta(7)],
  ])('%s lança', (_, r) => {
    expect(() => textoDoMandato(r, 'dev')).toThrow('mandato ilegível na dev: vazio')
  })
  it('a mensagem do vazio traz o ref que veio', () => {
    expect(() => textoDoMandato({ data: null }, 'main2')).toThrow(
      'mandato ilegível na main2: vazio',
    )
  })
  it('a query pede a expressão pela variável', () => {
    expect(MANDATO_QUERY).toContain('object(expression: $expressao)')
  })
})
