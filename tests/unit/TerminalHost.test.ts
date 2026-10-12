import { describe, expect, it } from 'vitest'
import { TerminalHost } from '../../src/core'
import { createFakeSpawner } from '../fakes/fakePty'

const ENTRADA = { shell: 'sh', args: ['-i'], env: {}, cwd: '/tmp', cols: 80, rows: 24 }

function montar() {
  const fake = createFakeSpawner()
  let cargas = 0
  const host = new TerminalHost(() => {
    cargas++
    return Promise.resolve({ ok: true, spawn: fake.spawn })
  })
  return { host, fake, cargas: () => cargas }
}

describe('TerminalHost', () => {
  it('abre no tamanho pedido, repassa write/resize e entrega data a quem ouve', async () => {
    const { host, fake } = montar()
    const aberto = await host.open(ENTRADA)
    if (!aberto.ok) throw new Error('não abriu')
    const recebido: string[] = []
    host.onData(aberto.id, (d) => recebido.push(d))

    host.write(aberto.id, 'ls')
    host.resize(aberto.id, 100, 30)
    fake.ptys[0]!.emitData('oi')

    expect(fake.calls[0]).toMatchObject({ shell: 'sh', cwd: '/tmp', cols: 80, rows: 24 })
    expect(fake.ptys[0]!.writes).toEqual(['ls'])
    expect(fake.ptys[0]!.resizes).toEqual([[100, 30]])
    expect(recebido).toEqual(['oi'])
  })

  it('o exit chega com o código e o terminal deixa de existir', async () => {
    const { host, fake } = montar()
    const aberto = await host.open(ENTRADA)
    if (!aberto.ok) throw new Error('não abriu')
    const saidas: number[] = []
    host.onExit(aberto.id, (c) => saidas.push(c))

    fake.ptys[0]!.emitExit(3)
    host.write(aberto.id, 'tarde demais')

    expect(saidas).toEqual([3])
    expect(fake.ptys[0]!.writes).toEqual([])
  })

  it('id desconhecido é no-op em write, resize e close', () => {
    const { host } = montar()

    expect(() => {
      host.write('nada', 'x')
      host.resize('nada', 1, 1)
      host.close('nada')
    }).not.toThrow()
  })

  it('close mata o PTY e descarta data que chegue depois', async () => {
    const { host, fake } = montar()
    const aberto = await host.open(ENTRADA)
    if (!aberto.ok) throw new Error('não abriu')
    const recebido: string[] = []
    host.onData(aberto.id, (d) => recebido.push(d))

    host.close(aberto.id)
    fake.ptys[0]!.emitData('fantasma')

    expect(fake.ptys[0]!.killed).toBe(true)
    expect(recebido).toEqual([])
  })

  it('closeAll mata todos', async () => {
    const { host, fake } = montar()
    await host.open(ENTRADA)
    await host.open(ENTRADA)

    host.closeAll()

    expect(fake.ptys.map((p) => p.killed)).toEqual([true, true])
  })

  it('carrega o spawner uma vez só', async () => {
    const { host, cargas } = montar()
    await host.open(ENTRADA)
    await host.open(ENTRADA)

    expect(cargas()).toBe(1)
  })

  it('módulo que não carrega vira { ok: false, detail }, sem jogar', async () => {
    const host = new TerminalHost(() =>
      Promise.resolve({
        ok: false,
        detail: 'Cannot find module node-pty',
      }),
    )

    expect(await host.open(ENTRADA)).toEqual({ ok: false, detail: 'Cannot find module node-pty' })
  })

  it('spawn que joga também vira { ok: false, detail }', async () => {
    const host = new TerminalHost(() =>
      Promise.resolve({
        ok: true,
        spawn: () => {
          throw new Error('File not found')
        },
      }),
    )

    expect(await host.open(ENTRADA)).toEqual({ ok: false, detail: 'File not found' })
  })
})
