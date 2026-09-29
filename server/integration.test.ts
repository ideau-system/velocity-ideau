import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGameServer, type GameServer } from './app.js'
import type { PublicRoom } from './rooms.js'

const COUNTDOWN_MS = 400
const GRACE_MS = 600

type RoomAck = { ok: boolean; room?: PublicRoom; error?: string }
type Scheduled = {
  code: string
  startAt: number
  countdownMs: number
  trackSeed: number
  difficulty: string
  serverTime: number
}

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

function ask<T>(client: Socket, event: string, payload?: unknown) {
  return new Promise<T>((resolve) => client.emit(event, payload, resolve))
}

function waitFor<T>(client: Socket, event: string, timeout = 3_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`evento "${event}" não chegou`)), timeout)
    client.once(event, (payload: T) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

function waitForRoom(client: Socket, matches: (room: PublicRoom) => boolean, timeout = 3_000) {
  return new Promise<PublicRoom>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('a sala não atingiu o estado esperado')), timeout)
    const handler = (room: PublicRoom) => {
      if (!matches(room)) return
      clearTimeout(timer)
      client.off('room:update', handler)
      resolve(room)
    }
    client.on('room:update', handler)
  })
}

/** Cria a sala com dois pilotos conectados e devolve os dois clientes. */
async function gridCompleto() {
  const ana = await connect()
  const beto = await connect()
  const criada = await ask<RoomAck>(ana, 'room:create', { name: 'Ana', playerId: 'ana' })
  const code = criada.room!.code
  await ask<RoomAck>(beto, 'room:join', { code, name: 'Beto', playerId: 'beto' })
  return { ana, beto, code }
}

beforeEach(async () => {
  server = createGameServer({ countdownMs: COUNTDOWN_MS, graceMs: GRACE_MS, serveStatic: false })
  await new Promise<void>((resolve) => server.http.listen(0, resolve))
  port = (server.http.address() as AddressInfo).port
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server.close()
})

describe('sala pelo socket', () => {
  it('reúne os dois pilotos na mesma sala', async () => {
    const { ana, code } = await gridCompleto()
    const visaoDaAna = await waitForRoom(ana, (room) => room.players.length === 2, 1_000).catch(() => server.rooms.get(code)!)
    expect(visaoDaAna.players.map((player) => player.name)).toEqual(['Ana', 'Beto'])
    expect(visaoDaAna.players.every((player) => player.connected)).toBe(true)
  })

  it('aceita seis pilotos e recusa o sétimo e uma sala inexistente', async () => {
    const { code } = await gridCompleto()
    for (const [id, name] of [['caio', 'Caio'], ['duda', 'Duda'], ['eva', 'Eva'], ['fabio', 'Fábio']]) {
      const client = await connect()
      const entrada = await ask<RoomAck>(client, 'room:join', { code, name, playerId: id })
      expect(entrada.ok).toBe(true)
    }
    expect(server.rooms.get(code)?.players).toHaveLength(6)

    const gabi = await connect()
    const cheia = await ask<RoomAck>(gabi, 'room:join', { code, name: 'Gabi', playerId: 'gabi' })
    expect(cheia.ok).toBe(false)
    expect(cheia.error).toContain('cheia')

    const inexistente = await ask<RoomAck>(gabi, 'room:join', { code: 'ZZZZZ', name: 'Gabi', playerId: 'gabi' })
    expect(inexistente.ok).toBe(false)
    expect(inexistente.error).toContain('não encontrada')
  })

  it('avisa o rival quando alguém sai antes da largada', async () => {
    const { ana, beto } = await gridCompleto()
    const sozinha = waitForRoom(ana, (room) => room.players.length === 1)
    beto.emit('room:leave')
    expect((await sozinha).players.map((player) => player.name)).toEqual(['Ana'])
  })

  it('o anfitrião tira quem não confirma, e a largada sai com os que ficaram', async () => {
    const { ana, beto, code } = await gridCompleto()
    const caio = await connect()
    await ask<RoomAck>(caio, 'room:join', { code, name: 'Caio', playerId: 'caio' })
    await ask<RoomAck>(ana, 'room:set-ready', { code, playerId: 'ana', ready: true })
    await ask<RoomAck>(beto, 'room:set-ready', { code, playerId: 'beto', ready: true })

    const recusa = await ask<RoomAck>(beto, 'room:kick', { code, playerId: 'beto', targetId: 'caio' })
    expect(recusa.ok).toBe(false)

    const avisado = waitFor<{ code: string }>(caio, 'room:kicked')
    const largada = waitFor<Scheduled>(beto, 'race:scheduled')
    const resposta = await ask<RoomAck>(ana, 'room:kick', { code, playerId: 'ana', targetId: 'caio' })
    expect(resposta.ok).toBe(true)
    expect((await avisado).code).toBe(code)
    expect((await largada).code).toBe(code)
    expect(server.rooms.get(code)?.players.map((player) => player.name)).toEqual(['Ana', 'Beto'])
  })
})

describe('largada sincronizada pelo socket', () => {
  it('responde ao pedido de sincronização de relógio', async () => {
    const ana = await connect()
    const clientSentAt = Date.now()
    const resposta = await ask<{ serverTime: number; clientSentAt: number }>(ana, 'time:sync', { clientSentAt })
    expect(resposta.clientSentAt).toBe(clientSentAt)
    expect(Math.abs(resposta.serverTime - Date.now())).toBeLessThan(1_000)
  })

  it('entrega exatamente o mesmo instante de largada para os dois pilotos', async () => {
    const { ana, beto, code } = await gridCompleto()
    const agendadaParaAna = waitFor<Scheduled>(ana, 'race:scheduled')
    const agendadaParaBeto = waitFor<Scheduled>(beto, 'race:scheduled')

    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })

    const [paraAna, paraBeto] = await Promise.all([agendadaParaAna, agendadaParaBeto])
    expect(paraAna.startAt).toBe(paraBeto.startAt)
    expect(paraAna.countdownMs).toBe(paraBeto.countdownMs)
    expect(paraAna.startAt).toBeGreaterThan(Date.now())
    // A pista também é uma só: a mesma semente chega aos dois aparelhos.
    expect(paraAna.trackSeed).toBe(paraBeto.trackSeed)
    expect(paraAna.trackSeed).toBe(server.rooms.get(code)?.trackSeed)
    // E a dificuldade idem: é ela que decide a física dos dois lados.
    expect(paraAna.difficulty).toBe(paraBeto.difficulty)
    expect(paraAna.difficulty).toBe(server.rooms.get(code)?.difficulty)
  })

  it('a dificuldade escolhida pelo anfitrião chega ao outro', async () => {
    const { ana, beto, code } = await gridCompleto()
    const recebida = waitForRoom(beto, (room) => room.difficulty === 'profissional')

    const resposta = await ask<RoomAck>(ana, 'room:set-difficulty', {
      code,
      playerId: 'ana',
      difficulty: 'profissional',
    })

    expect(resposta.ok).toBe(true)
    expect((await recebida).difficulty).toBe('profissional')
    expect(server.rooms.difficultyOf(code)).toBe('profissional')
  })

  it('o convidado não troca a dificuldade da sala', async () => {
    const { beto, code } = await gridCompleto()
    expect(server.rooms.hostOf(code)).toBe('ana')

    const resposta = await ask<RoomAck>(beto, 'room:set-difficulty', {
      code,
      playerId: 'beto',
      difficulty: 'profissional',
    })

    expect(resposta.ok).toBe(false)
    expect(resposta.error).toContain('criou a sala')
    expect(server.rooms.difficultyOf(code)).toBe('normal')
  })

  it('o carro de cada piloto chega ao rival, inclusive a troca', async () => {
    const ana = await connect()
    const beto = await connect()
    const criada = await ask<RoomAck>(ana, 'room:create', { name: 'Ana', playerId: 'ana', car: 'senna' })
    const code = criada.room!.code
    const entrou = await ask<RoomAck>(beto, 'room:join', { code, name: 'Beto', playerId: 'beto', car: 'verstappen' })
    // É com este carro que cada um desenha o fantasma do outro.
    expect(entrou.room!.players.map((player) => player.car)).toEqual(['senna', 'verstappen'])

    const vista = waitForRoom(beto, (room) => room.players.find((player) => player.id === 'ana')?.car === 'schumacher')
    const resposta = await ask<RoomAck>(ana, 'room:set-car', { code, playerId: 'ana', car: 'schumacher' })
    expect(resposta.ok).toBe(true)
    await vista
  })

  it('trocar de dificuldade desfaz as confirmações dos dois', async () => {
    const { ana, beto, code } = await gridCompleto()
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await waitForRoom(ana, (room) => room.status === 'countdown')

    // Com a largada marcada, a escolha não muda mais a prova.
    await ask<RoomAck>(ana, 'room:set-difficulty', { code, playerId: 'ana', difficulty: 'dificil' })
    expect(server.rooms.difficultyOf(code)).toBe('normal')
  })

  it('só agenda depois que os dois confirmam', async () => {
    const { ana, beto, code } = await gridCompleto()
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(server.rooms.get(code)?.status).toBe('waiting')
    expect(server.rooms.get(code)?.startAt).toBeNull()

    const agendada = waitFor<Scheduled>(beto, 'race:scheduled')
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await agendada
    expect(server.rooms.get(code)?.status).toBe('countdown')
  })

  it('inicia a corrida no instante combinado', async () => {
    const { ana, beto, code } = await gridCompleto()
    const correndoParaAna = waitForRoom(ana, (room) => room.status === 'racing')
    const correndoParaBeto = waitForRoom(beto, (room) => room.status === 'racing')
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')

    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })

    const { startAt } = await agendada
    const [salaDaAna, salaDoBeto] = await Promise.all([correndoParaAna, correndoParaBeto])
    const atraso = Date.now() - startAt

    expect(salaDaAna.startAt).toBe(startAt)
    expect(salaDoBeto.startAt).toBe(startAt)
    expect(atraso).toBeGreaterThanOrEqual(0)
    expect(atraso).toBeLessThan(250)
  })

  it('cancela a largada nos dois aparelhos quando um piloto desiste', async () => {
    const { ana, beto, code } = await gridCompleto()
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await agendada

    const canceladaParaAna = waitFor<{ reason: string }>(ana, 'race:cancelled')
    const canceladaParaBeto = waitFor<{ reason: string }>(beto, 'race:cancelled')
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: false })

    await Promise.all([canceladaParaAna, canceladaParaBeto])
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_MS + 150))
    expect(server.rooms.get(code)?.status).toBe('waiting')
    expect(server.rooms.get(code)?.startAt).toBeNull()
  })
})

describe('telemetria e carro fantasma pelo socket', () => {
  type Rival = { playerId: string; t: number; progress: number; lateral: number; speed: number; state: string; boosting?: boolean }

  /** Coloca os dois pilotos correndo de verdade, já passado o instante da largada. */
  async function emCorrida() {
    const { ana, beto, code } = await gridCompleto()
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await agendada
    await waitForRoom(ana, (room) => room.status === 'racing')
    return { ana, beto, code }
  }

  const medicao = (code: string, playerId: string, progress: number, extra: Record<string, unknown> = {}) => ({
    code,
    playerId,
    t: Date.now(),
    progress,
    lateral: 0,
    speed: 252,
    state: 'racing',
    ...extra,
  })

  it('repassa a telemetria de um piloto para o adversário', async () => {
    const { ana, beto, code } = await emCorrida()
    const recebida = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 340, { lateral: 0.4 }))

    const rival = await recebida
    expect(rival.progress).toBe(340)
    expect(rival.lateral).toBeCloseTo(0.4, 5)
    expect(rival.playerId).toBe('ana')
  })

  it('o boost do piloto chega ao adversário, para a chama acender no fantasma', async () => {
    const { ana, beto, code } = await emCorrida()
    const deBoost = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 200, { boosting: true }))
    expect((await deBoost).boosting).toBe(true)

    const semBoost = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 220, { t: Date.now() + 1 }))
    expect((await semBoost).boosting).toBe(false)
  })

  it('não devolve a própria telemetria para quem a enviou', async () => {
    const { ana, beto, code } = await emCorrida()
    let voltou = false
    ana.on('race:rival', () => {
      voltou = true
    })

    const recebida = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 120))
    await recebida
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(voltou).toBe(false)
  })

  it('os dois pilotos enxergam o fantasma um do outro', async () => {
    const { ana, beto, code } = await emCorrida()
    const paraBeto = waitFor<Rival>(beto, 'race:rival')
    const paraAna = waitFor<Rival>(ana, 'race:rival')

    ana.emit('race:telemetry', medicao(code, 'ana', 300))
    beto.emit('race:telemetry', medicao(code, 'beto', 320))

    expect((await paraBeto).progress).toBe(300)
    expect((await paraAna).progress).toBe(320)
  })

  it('avisa o rival quando o piloto cruza a chegada', async () => {
    const { ana, beto, code } = await emCorrida()
    const recebida = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 4_800, { speed: 0, state: 'finished' }))

    const rival = await recebida
    expect(rival.state).toBe('finished')
    expect(rival.speed).toBe(0)
  })

  it('recusa um avanço impossível em vez de teleportar o fantasma', async () => {
    const { ana, beto, code } = await emCorrida()

    const primeira = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 100))
    await primeira

    const segunda = waitFor<Rival>(beto, 'race:rival')
    await new Promise((resolve) => setTimeout(resolve, 60))
    ana.emit('race:telemetry', medicao(code, 'ana', 4_700))

    expect((await segunda).progress).toBeLessThan(200)
  })

  it('ignora telemetria enviada antes da largada', async () => {
    const { ana, beto, code } = await gridCompleto()
    let recebeu = false
    beto.on('race:rival', () => {
      recebeu = true
    })

    ana.emit('race:telemetry', medicao(code, 'ana', 500))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(recebeu).toBe(false)
  })

  it('entrega a última posição do rival a quem reconecta durante a corrida', async () => {
    const { ana, beto, code } = await emCorrida()
    const recebida = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 1_250))
    await recebida

    beto.disconnect()
    const betoDeVolta = await connect()
    const fantasma = waitFor<Rival>(betoDeVolta, 'race:rival')
    await ask<RoomAck>(betoDeVolta, 'room:join', { code, name: 'Beto', playerId: 'beto' })

    expect((await fantasma).progress).toBe(1_250)
  })
})

describe('resultado e revanche pelo socket', () => {
  type Resultado = {
    code: string
    winnerId: string | null
    reason: 'time' | 'abandon'
    gap: number | null
    entries: Array<{ playerId: string; name: string; time: number | null; outcome: string }>
  }

  /** Troca o servidor do teste, para escolher quando a largada aconteceu. */
  async function comCountdown(countdownMs: number) {
    for (const client of clients.splice(0)) client.disconnect()
    await server.close()
    server = createGameServer({ countdownMs, graceMs: GRACE_MS, serveStatic: false })
    await new Promise<void>((resolve) => server.http.listen(0, resolve))
    port = (server.http.address() as AddressInfo).port
  }

  /**
   * Sala correndo. Um countdown negativo coloca a largada no passado, que é
   * como conseguimos uma prova longa o bastante para o servidor aceitar a
   * chegada — ele exige o tempo mínimo físico da pista.
   */
  async function provaEmAndamento(countdownMs = COUNTDOWN_MS) {
    if (countdownMs !== COUNTDOWN_MS) await comCountdown(countdownMs)
    const { ana, beto, code } = await gridCompleto()

    // Com a largada no passado o aviso chega no mesmo instante do agendamento,
    // então os dois ouvintes precisam estar prontos antes de confirmar.
    const correndo = waitForRoom(ana, (room) => room.status === 'racing')
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await correndo
    return { ana, beto, code }
  }

  /** Largada 72 s no passado: a prova já pode ser concluída. */
  const PROVA_LONGA = -72_000

  it('recusa uma chegada antes do tempo mínimo da prova', async () => {
    const { ana, beto, code } = await provaEmAndamento()
    let chegou = false
    beto.on('race:result', () => {
      chegou = true
    })

    ana.emit('race:finish', { code, playerId: 'ana', time: 3, topSpeed: 300, collisions: 0 })
    beto.emit('race:finish', { code, playerId: 'beto', time: 4, topSpeed: 300, collisions: 0 })
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(chegou).toBe(false)
    expect(server.rooms.get(code)?.status).toBe('racing')
  })

  it('entrega o mesmo vencedor e os mesmos tempos para os dois pilotos', async () => {
    const { ana, beto, code } = await provaEmAndamento(PROVA_LONGA)

    const paraAna = waitFor<Resultado>(ana, 'race:result')
    const paraBeto = waitFor<Resultado>(beto, 'race:result')
    ana.emit('race:finish', { code, playerId: 'ana', time: 71.2, topSpeed: 252, collisions: 2 })
    beto.emit('race:finish', { code, playerId: 'beto', time: 70.4, topSpeed: 258, collisions: 1 })

    const [resultadoDaAna, resultadoDoBeto] = await Promise.all([paraAna, paraBeto])
    // O critério da fase: as duas telas recebem exatamente o mesmo resultado.
    expect(resultadoDaAna).toEqual(resultadoDoBeto)
    expect(resultadoDaAna.winnerId).toBe('beto')
    expect(resultadoDaAna.reason).toBe('time')
    expect(resultadoDaAna.entries.map((entry) => entry.playerId)).toEqual(['beto', 'ana'])
    expect(resultadoDaAna.gap).toBeCloseTo(0.8, 2)
    expect(server.rooms.get(code)?.status).toBe('finished')
  })

  it('abandonar no meio da prova entrega a vitória ao rival', async () => {
    const { ana, beto, code } = await provaEmAndamento()
    const paraAna = waitFor<Resultado>(ana, 'race:result')
    beto.emit('race:abandon', { code, playerId: 'beto' })

    const resultado = await paraAna
    expect(resultado.reason).toBe('abandon')
    expect(resultado.winnerId).toBe('ana')
    expect(resultado.entries.find((entry) => entry.playerId === 'beto')?.outcome).toBe('abandoned')
  })

  it('a revanche só larga quando os dois pedem', async () => {
    const { ana, beto, code } = await provaEmAndamento()
    const resultado = waitFor<Resultado>(ana, 'race:result')
    beto.emit('race:abandon', { code, playerId: 'beto' })
    await resultado

    const pedido = waitForRoom(beto, (room) => room.players.some((player) => player.rematch))
    ana.emit('race:rematch', { code, playerId: 'ana' })
    await pedido
    expect(server.rooms.get(code)?.status).toBe('finished')

    const novaLargada = waitFor<Scheduled>(ana, 'race:scheduled')
    beto.emit('race:rematch', { code, playerId: 'beto' })
    const agendada = await novaLargada

    expect(agendada.startAt).toBeGreaterThan(Date.now())
    expect(server.rooms.get(code)?.status).toBe('countdown')
    expect(server.rooms.get(code)?.players.every((player) => !player.finished)).toBe(true)
  })

  it('o rival que não volta perde por abandono e libera a vaga', async () => {
    const { ana, beto, code } = await provaEmAndamento()
    const resultado = waitFor<Resultado>(ana, 'race:result')
    const vagaLivre = waitForRoom(ana, (room) => room.players.length === 1, 4_000)
    beto.disconnect()

    expect((await resultado).winnerId).toBe('ana')
    // A sala não pode ficar presa com um piloto que não volta mais.
    await vagaLivre
    expect(server.rooms.get(code)?.players).toHaveLength(1)
    expect(server.rooms.get(code)?.status).toBe('waiting')
  }, 15_000)

  it('a revanche recomeça a corrida nos dois aparelhos', async () => {
    const { ana, beto, code } = await provaEmAndamento()
    const resultado = waitFor<Resultado>(ana, 'race:result')
    beto.emit('race:abandon', { code, playerId: 'beto' })
    await resultado

    const correndoParaAna = waitForRoom(ana, (room) => room.status === 'racing')
    const correndoParaBeto = waitForRoom(beto, (room) => room.status === 'racing')
    ana.emit('race:rematch', { code, playerId: 'ana' })
    beto.emit('race:rematch', { code, playerId: 'beto' })

    const [salaDaAna, salaDoBeto] = await Promise.all([correndoParaAna, correndoParaBeto])
    expect(salaDaAna.startAt).toBe(salaDoBeto.startAt)
  })
})

describe('perda momentânea de conexão pelo socket', () => {
  it('cancela a contagem e mantém a vaga quando o rival cai', async () => {
    const { ana, beto, code } = await gridCompleto()
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await agendada

    const cancelada = waitFor<{ reason: string }>(ana, 'race:cancelled')
    const semSinal = waitForRoom(ana, (room) => room.players.some((player) => !player.connected))
    beto.disconnect()

    expect((await cancelada).reason).toContain('conexão')
    const sala = await semSinal
    expect(sala.players).toHaveLength(2)
    expect(sala.status).toBe('waiting')
  })

  it('a volta rápida do piloto não cria um terceiro carro', async () => {
    const { ana, beto, code } = await gridCompleto()
    const semSinal = waitForRoom(ana, (room) => room.players.some((player) => !player.connected))
    beto.disconnect()
    await semSinal

    const betoDeVolta = await connect()
    const resposta = await ask<RoomAck>(betoDeVolta, 'room:join', { code, name: 'Beto', playerId: 'beto' })

    expect(resposta.ok).toBe(true)
    expect(resposta.room?.players).toHaveLength(2)
    expect(resposta.room?.players.every((player) => player.connected)).toBe(true)

    // A janela de retorno expira sem remover quem já voltou.
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS + 200))
    expect(server.rooms.get(code)?.players).toHaveLength(2)
  })

  it('libera a vaga de quem não volta dentro da janela', async () => {
    const { ana, beto, code } = await gridCompleto()
    const sozinha = waitForRoom(ana, (room) => room.players.length === 1, 3_000)
    beto.disconnect()
    expect((await sozinha).players.map((player) => player.name)).toEqual(['Ana'])
    expect(server.rooms.get(code)?.players).toHaveLength(1)
  })

  it('devolve o instante oficial para quem volta durante a corrida', async () => {
    const { ana, beto, code } = await gridCompleto()
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    const { startAt, trackSeed } = await agendada

    await waitForRoom(ana, (room) => room.status === 'racing')
    beto.disconnect()

    const betoDeVolta = await connect()
    const reagendada = waitFor<Scheduled>(betoDeVolta, 'race:scheduled')
    const resposta = await ask<RoomAck>(betoDeVolta, 'room:join', { code, name: 'Beto', playerId: 'beto' })

    expect(resposta.room?.status).toBe('racing')
    const voltou = await reagendada
    expect(voltou.startAt).toBe(startAt)
    // E volta para a mesma pista: a semente não é sorteada de novo.
    expect(voltou.trackSeed).toBe(trackSeed)
    expect(resposta.room?.trackSeed).toBe(trackSeed)
  })
})
