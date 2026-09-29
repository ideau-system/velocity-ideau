import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DIFICULDADE_OFICIAL } from '../../src/game/contrarrelogio.js'
import { createGameServer, type GameServer } from '../app.js'
import { tokenDeTeste, verificadorDeTeste } from '../contas.js'
import type { PublicRoom } from '../rooms.js'
import type { SituacaoDaCopa } from './copa.js'

/**
 * A Copa do Dia de ponta a ponta, pelo socket: inscrição, classificação,
 * divisão, rodadas com eliminação e o troféu. As provas não são corridas de
 * verdade — o abandono e o limite de tempo as encerram —, o que basta para
 * exercitar o caminho entre uma rodada e a próxima.
 */

type Resposta = { ok: boolean; error?: string } & Record<string, unknown>
type Rodada = {
  code: string | null
  divisao: number
  rodada: number
  eliminados: Array<{ playerId: string; nome: string; posicao: number; desistiu: boolean }>
  seguem: Array<{ playerId: string; nome: string }>
  campeao: { nome: string } | null
  proximaEm: number | null
}

let server: GameServer
let port = 0
let inicio = 0
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

/** Espera uma condição ficar verdadeira, conferindo a cada 20 ms. */
async function ate(condicao: () => boolean, timeout = 5_000) {
  const limite = Date.now() + timeout
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('a condição não aconteceu a tempo')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Um aparelho com perfil, inscrito na copa, anotando o que o servidor manda. */
async function inscrito(nome: string) {
  const client = await connect()
  const criado = await ask(client, 'conta:entrar', { token: tokenDeTeste(crypto.randomUUID(), nome) })
  expect(criado.ok).toBe(true)
  const playerId = `aba-${nome}`
  expect((await ask(client, 'copa:inscrever', { playerId, nome, carro: 'senna' })).ok).toBe(true)
  const piloto = {
    client,
    nome,
    playerId,
    perfilId: (criado.perfil as { id: string }).id,
    partidas: [] as PublicRoom[],
    rodadas: [] as Rodada[],
    sala: null as PublicRoom | null,
  }
  client.on('copa:partida', ({ room }: { room: PublicRoom }) => piloto.partidas.push(room))
  client.on('copa:rodada', (rodada: Rodada) => piloto.rodadas.push(rodada))
  client.on('room:update', (room: PublicRoom) => (piloto.sala = room))
  return piloto
}

beforeEach(async () => {
  inicio = Date.now()
  server = createGameServer({
    // Uma contagem longa o bastante para o teste sair no meio dela.
    countdownMs: 400,
    graceMs: 5_000,
    serveStatic: false,
    limiteDaRanqueadaMs: 300,
    // A classificação abre agora e dura um segundo e meio; entre as rodadas, 150 ms.
    copa: { abertura: () => inicio, classificacaoMs: 1_500, folgaMs: 0, intervaloMs: 150 },
    contas: verificadorDeTeste(),
  })
  await new Promise<void>((resolve) => server.http.listen(0, resolve))
  port = (server.http.address() as AddressInfo).port
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server.close()
})

describe('copa do dia pelo socket', () => {
  it('sem perfil não há inscrição, mas a situação da copa é pública', async () => {
    const client = await connect()
    expect((await ask(client, 'copa:inscrever', { playerId: 'x', nome: 'X' })).ok).toBe(false)
    const painel = await ask<Resposta & { copa: SituacaoDaCopa }>(client, 'copa:painel')
    expect(painel.ok).toBe(true)
    expect(painel.copa.fase).toBe('classificacao')
    expect(painel.copa.inscrito).toBe(false)
  })

  it('classifica, monta a divisão, elimina um por rodada e entrega o troféu ao campeão', async () => {
    const pilotos = await Promise.all(['Ana', 'Beto', 'Caio'].map(inscrito))
    const [ana, beto, caio] = pilotos
    const { seed } = server.copa.hoje()
    // A classificação: as voltas chegam como se viessem da Pista do Dia julgada.
    pilotos.forEach((piloto, i) => {
      const volta = { largada: inicio + 10, tempo: 70 + i, seed, dificuldade: DIFICULDADE_OFICIAL, modificador: null, estado: 'valido' as const }
      expect(server.copa.registrarVolta(piloto.perfilId, volta)).toEqual({ posicao: i + 1 })
    })
    const classificacao = await ask<Resposta & { copa: SituacaoDaCopa }>(caio.client, 'copa:painel')
    expect(classificacao.copa.classificacao.map((linha) => linha.apelido)).toEqual(['Ana', 'Beto', 'Caio'])
    expect(classificacao.copa.voce).toEqual({ tempo: 72, posicao: 3 })

    // Fechada a classificação, a divisão 1 larga sozinha, na pista do dia.
    await ate(() => pilotos.every((piloto) => piloto.partidas.length === 1))
    const primeira = ana.partidas[0]
    expect(primeira.copa).toEqual({ divisao: 1, rodada: 1 })
    expect(primeira.ranqueada).toBe(false)
    expect(primeira.trackSeed).toBe(seed)
    expect(primeira.players.map((player) => player.name).sort()).toEqual(['Ana', 'Beto', 'Caio'])
    // Sem revanche e sem confirmação manual: a próxima rodada sai sozinha.
    expect((await ask(ana.client, 'race:rematch', { code: primeira.code, playerId: ana.playerId })).ok).toBe(false)

    // Caio abandona a primeira rodada e sai; Ana e Beto seguem.
    await ate(() => caio.sala?.code === primeira.code && caio.sala.status === 'racing')
    caio.client.emit('race:abandon', { code: primeira.code, playerId: caio.playerId })
    await ate(() => pilotos.every((piloto) => piloto.rodadas.length === 1))
    const rodada1 = ana.rodadas[0]
    expect(rodada1.eliminados).toEqual([{ playerId: caio.playerId, nome: 'Caio', posicao: 3, desistiu: true }])
    expect(rodada1.seguem.map((piloto) => piloto.nome).sort()).toEqual(['Ana', 'Beto'])
    expect(rodada1.proximaEm).not.toBeNull()

    // A final: os dois não completam no limite, e a classificação desempata.
    await ate(() => ana.partidas.length === 2 && beto.partidas.length === 2)
    expect(ana.partidas[1].copa).toEqual({ divisao: 1, rodada: 2 })
    expect(ana.partidas[1].players.map((player) => player.name).sort()).toEqual(['Ana', 'Beto'])
    expect(caio.partidas).toHaveLength(1)

    await ate(() => ana.rodadas.length === 2)
    const final = ana.rodadas[1]
    expect(final.campeao?.nome).toBe('Ana')
    expect(final.eliminados.map(({ nome, posicao }) => [nome, posicao])).toEqual([['Beto', 2]])
    expect(final.proximaEm).toBeNull()

    const painel = await ask<Resposta & { copa: SituacaoDaCopa }>(ana.client, 'copa:painel')
    expect(painel.copa.fase).toBe('encerrada')
    expect(painel.copa.minhaDivisao).toMatchObject({ numero: 1, participantes: 3, posicao: 1, campeao: true })
    expect(painel.copa.trofeus.map(({ posicao, divisao }) => ({ posicao, divisao }))).toEqual([{ posicao: 1, divisao: 1 }])
    // Quem abandonou não leva o bronze.
    expect(await server.repositorio.trofeusDe(caio.perfilId)).toEqual([])
    expect((await server.repositorio.trofeusDe(beto.perfilId))[0].posicao).toBe(2)
  }, 20_000)

  it('quem sai na contagem é eliminado, e os outros largam de novo numa sala nova', async () => {
    const pilotos = await Promise.all(['Ana', 'Beto', 'Caio'].map(inscrito))
    const [ana, , caio] = pilotos
    const { seed } = server.copa.hoje()
    pilotos.forEach((piloto, i) =>
      server.copa.registrarVolta(piloto.perfilId, { largada: inicio + 10, tempo: 70 + i, seed, dificuldade: DIFICULDADE_OFICIAL, modificador: null, estado: 'valido' }),
    )
    await ate(() => pilotos.every((piloto) => piloto.partidas.length === 1))
    const primeira = ana.partidas[0]
    await ate(() => caio.sala?.code === primeira.code && caio.sala.status === 'countdown')
    caio.client.emit('room:leave')

    await ate(() => ana.partidas.length === 2)
    expect(ana.partidas[1].code).not.toBe(primeira.code)
    // A rodada que não largou não conta.
    expect(ana.partidas[1].copa).toEqual({ divisao: 1, rodada: 1 })
    expect(ana.partidas[1].players.map((player) => player.name).sort()).toEqual(['Ana', 'Beto'])
    const painel = await ask<Resposta & { copa: SituacaoDaCopa }>(caio.client, 'copa:painel')
    expect(painel.copa.minhaDivisao).toMatchObject({ posicao: 3 })
  }, 20_000)
})
