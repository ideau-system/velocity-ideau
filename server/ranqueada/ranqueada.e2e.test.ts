import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DIFICULDADE_OFICIAL } from '../../src/game/contrarrelogio.js'
import { createGameServer, type GameServer } from '../app.js'
import { tokenDeTeste, verificadorDeTeste } from '../contas.js'
import type { PerfilDoPiloto } from '../estatisticas.js'
import type { PublicRoom } from '../rooms.js'
import type { ResultadoRanqueado } from './servico.js'

/**
 * A ranqueada de ponta a ponta, pelo socket: perfil, fila, sala, largada e o
 * resultado com os PL de cada um. A prova não é corrida de verdade — o limite
 * de tempo da ranqueada a encerra —, o que basta para exercitar o caminho.
 */

type Resposta = { ok: boolean; error?: string } & Record<string, unknown>

let server: GameServer
let port = 0
const clients: Socket[] = []

function connect() {
  return new Promise<Socket>((resolve, reject) => {
    const client = connectClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true })
    clients.push(client)
    client.on('connect', () => resolve(client))
    client.on('connect_error', reject)
  })
}

function ask<T = Resposta>(client: Socket, event: string, payload?: unknown) {
  return new Promise<T>((resolve) => client.emit(event, payload, resolve))
}

function waitFor<T>(client: Socket, event: string, timeout = 5_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`evento "${event}" não chegou`)), timeout)
    client.once(event, (payload: T) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

/** Um aparelho com conta, pronto para a fila. */
async function piloto(nome: string) {
  const client = await connect()
  const entrou = await ask(client, 'conta:entrar', { token: tokenDeTeste(crypto.randomUUID(), nome) })
  expect(entrou.ok).toBe(true)
  return { client, nome, playerId: `aba-${nome}` }
}

beforeEach(async () => {
  server = createGameServer({
    countdownMs: 150,
    graceMs: 5_000,
    serveStatic: false,
    esperaDaFila: 100,
    esperaComFantasmas: 200,
    limiteDaRanqueadaMs: 300,
    sementesRanqueadas: { sortear: () => 42 },
    contas: verificadorDeTeste(),
  })
  await new Promise<void>((resolve) => server.http.listen(0, resolve))
  port = (server.http.address() as AddressInfo).port
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server.close()
})

describe('ranqueada pelo socket', () => {
  it('sem conta não há fila', async () => {
    const client = await connect()
    expect((await ask(client, 'ranqueada:entrar', { playerId: 'x', nome: 'X' })).ok).toBe(false)
    expect((await ask(client, 'ranqueada:painel')).ok).toBe(false)
  })

  it('o painel de quem nunca correu mostra a colocação pela frente', async () => {
    const { client } = await piloto('Ana')
    const painel = await ask(client, 'ranqueada:painel')
    expect(painel.ok).toBe(true)
    expect((painel.painel as { colocacao: number; pl: number }).colocacao).toBe(5)
    expect((painel.painel as { pl: number }).pl).toBe(0)
  })

  it('a fila forma a sala, a largada sai sozinha no nível oficial, e o resultado traz os PL de todos', async () => {
    const pilotos = await Promise.all(['Ana', 'Beto', 'Caio'].map(piloto))
    const partidas = pilotos.map(({ client }) => waitFor<{ room: PublicRoom }>(client, 'ranqueada:partida'))
    // A largada é marcada no mesmo instante em que a sala nasce.
    const largada = waitFor(pilotos[0].client, 'race:scheduled')
    const resultados = waitFor<{ resultados: ResultadoRanqueado[] }>(pilotos[0].client, 'ranqueada:resultados', 8_000)
    for (const { client, nome, playerId } of pilotos) {
      expect((await ask(client, 'ranqueada:entrar', { playerId, nome, carro: 'senna' })).ok).toBe(true)
    }
    // O mesmo perfil não entra duas vezes.
    expect((await ask(pilotos[0].client, 'ranqueada:entrar', { playerId: 'outra-aba', nome: 'Ana' })).ok).toBe(false)

    const [{ room }] = await Promise.all(partidas)
    expect(room.ranqueada).toBe(true)
    expect(room.difficulty).toBe(DIFICULDADE_OFICIAL)
    expect(room.trackSeed).toBe(42)
    expect(room.players.every((player) => player.ready)).toBe(true)

    // Na ranqueada ninguém confirma à mão, nem pede revanche.
    const recusa = await ask(pilotos[0].client, 'room:set-ready', { code: room.code, playerId: pilotos[0].playerId, ready: false })
    expect(recusa.ok).toBe(false)

    await largada
    // Um abandona; os outros ficam sem terminar até o limite de tempo encerrar a prova.
    await new Promise((resolve) => setTimeout(resolve, 200))
    pilotos[2].client.emit('race:abandon', { code: room.code, playerId: pilotos[2].playerId })

    const { resultados: lista } = await resultados
    expect(lista).toHaveLength(3)
    const doCaio = lista.find((resultado) => resultado.apelido === 'Caio')!
    expect(doCaio.posto).toBe(3)
    expect(lista.every((resultado) => resultado.colocacao === 4)).toBe(true)
    expect(lista.every((resultado) => resultado.rivais.length === 2)).toBe(true)

    const revanche = await ask(pilotos[0].client, 'race:rematch', { code: room.code, playerId: pilotos[0].playerId })
    expect(revanche.ok).toBe(false)

    const painel = await ask(pilotos[0].client, 'ranqueada:painel')
    expect((painel.painel as { corridas: number }).corridas).toBe(1)
    expect(painel.painel).toMatchObject({ colocacao: 4, colocacaoTotal: 5 })

    // A corrida entra no perfil de cada um, com os PL que rendeu.
    const perfil = (await ask(pilotos[2].client, 'perfil:ver')).perfil as PerfilDoPiloto
    expect(perfil.porModo.ranqueada.corridas).toBe(1)
    expect(perfil.recentes[0]).toMatchObject({ modo: 'ranqueada', posicao: 3, pilotos: 3, desfecho: 'abandonou', deltaPl: doCaio.deltaPl })
    // A escada é pública: quem ainda está em colocação não aparece nela.
    const escada = await ask(await connect(), 'ranqueada:escada')
    expect(escada).toMatchObject({ ok: true, escada: [] })
  }, 15_000)

  it('sozinho na fila, corre contra fantasmas de voltas ranqueadas, e só ele é atualizado', async () => {
    // Duas voltas guardadas de outros pilotos, na mesma pista. Curtíssimas, para
    // o teste não esperar uma prova inteira: o servidor não as julga de novo.
    const volta = {
      intervaloMs: 100,
      progresso: [0, 9_600, 19_200, 28_800, 38_400, 48_000],
      lateral: [0, 100, 200, 100, 0, 0],
      velocidade: [0, 250, 250, 250, 250, 0],
    }
    for (const [nome, mu] of [['Beto', 24], ['Caio', 30]] as const) {
      const perfil = await server.repositorio.perfilDaConta(crypto.randomUUID(), nome)
      await server.repositorio.registrarVoltaRanqueada({
        perfilId: perfil.id,
        seed: 42,
        dificuldade: DIFICULDADE_OFICIAL,
        tempo: 0.5,
        mmr: { mu, sigma: 3 },
        carro: 'senna',
        gravacao: volta,
      })
    }

    const ana = await piloto('Ana')
    const partida = waitFor<{ room: PublicRoom; contraFantasmas: boolean }>(ana.client, 'ranqueada:partida', 6_000)
    const rival = waitFor<{ playerId: string }>(ana.client, 'race:rival', 8_000)
    const resultados = waitFor<{ resultados: ResultadoRanqueado[] }>(ana.client, 'ranqueada:resultados', 10_000)
    expect((await ask(ana.client, 'ranqueada:entrar', { playerId: ana.playerId, nome: 'Ana', carro: 'senna' })).ok).toBe(true)

    const { room, contraFantasmas } = await partida
    expect(contraFantasmas).toBe(true)
    expect(room.trackSeed).toBe(42)
    expect(room.players.filter((player) => player.fantasma).map((player) => player.name).sort()).toEqual(['Beto', 'Caio'])

    // Os fantasmas correm como telemetria, pelo mesmo caminho dos rivais de verdade.
    expect((await rival).playerId).toMatch(/^fantasma-/)
    ana.client.emit('race:abandon', { code: room.code, playerId: ana.playerId })

    const { resultados: lista } = await resultados
    expect(lista).toHaveLength(1)
    expect(lista[0].apelido).toBe('Ana')
    expect(lista[0].rivais.map((r) => r.apelido).sort()).toEqual(['Beto (fantasma)', 'Caio (fantasma)'])
    // O MMR congelado do fantasma entra na conta: o de μ 30 era mais difícil de vencer.
    const contraCaio = lista[0].rivais.find((r) => r.apelido.startsWith('Caio'))!
    const contraBeto = lista[0].rivais.find((r) => r.apelido.startsWith('Beto'))!
    expect(contraCaio.chance).toBeLessThan(contraBeto.chance)
    // E nenhum fantasma ganhou estado ranqueado.
    expect((await server.repositorio.escada(server.ranqueada.temporada(), 10)).map((linha) => linha.apelido)).not.toContain('Beto')
  }, 20_000)

  it('sair na contagem cancela a sala sem PL e faz quem saiu esperar para voltar', async () => {
    const pilotos = await Promise.all(['Ana', 'Beto'].map(piloto))
    const partidas = pilotos.map(({ client }) => waitFor<{ room: PublicRoom }>(client, 'ranqueada:partida'))
    for (const { client, nome, playerId } of pilotos) await ask(client, 'ranqueada:entrar', { playerId, nome })
    await Promise.all(partidas)
    const cancelada = waitFor<{ motivo: string }>(pilotos[1].client, 'ranqueada:cancelada')
    pilotos[0].client.emit('room:leave')
    expect((await cancelada).motivo).toContain('Ninguém ganha nem perde')

    const deVolta = await ask(pilotos[0].client, 'ranqueada:entrar', { playerId: pilotos[0].playerId, nome: 'Ana' })
    expect(deVolta.ok).toBe(false)
    expect(typeof deVolta.ate).toBe('number')
    // Quem ficou pode voltar na hora.
    expect((await ask(pilotos[1].client, 'ranqueada:entrar', { playerId: pilotos[1].playerId, nome: 'Beto' })).ok).toBe(true)
  })
})
