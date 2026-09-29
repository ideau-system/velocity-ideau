import { describe, expect, it } from 'vitest'
import { DEFAULT_CAR } from '../src/game/cars.js'
import {
  LATERAL_LIMIT,
  MAX_SPECTATORS,
  minRaceSeconds,
  PROGRESS_TOLERANCE_M,
  RoomError,
  RoomStore,
  tetoDaTelemetria,
  type Telemetry,
} from './rooms.js'

/** Relógio controlado para testar agendamento e janela de reconexão. */
function createClock(start = 1_000_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

function roomWithTwoPilots(store: RoomStore) {
  const room = store.create('socket-a', 'a', 'Ana')
  store.join(room.code, 'socket-b', 'b', 'Beto')
  return room.code
}

function roomWithSixPilots(store: RoomStore) {
  const room = store.create('socket-a', 'a', 'Ana')
  for (const [id, name] of [
    ['b', 'Beto'],
    ['c', 'Caio'],
    ['d', 'Duda'],
    ['e', 'Eva'],
    ['f', 'Fábio'],
  ]) {
    store.join(room.code, `socket-${id}`, id, name)
  }
  return room.code
}

describe('salas multiplayer', () => {
  it('cria uma sala e aceita até seis pilotos', () => {
    const rooms = new RoomStore()
    const code = roomWithSixPilots(rooms)
    expect(code).toHaveLength(5)
    expect(rooms.get(code)?.players).toHaveLength(6)
    expect(() => rooms.join(code, 'socket-g', 'g', 'Gabi')).toThrow(RoomError)
  })

  it('fica pronta somente quando os dois confirmam', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    expect(rooms.setReady(code, 'a', true).status).toBe('waiting')
    expect(rooms.setReady(code, 'b', true).status).toBe('ready')
  })

  it('remove quem sai antes da largada', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.leaveBySocket('socket-b')
    expect(rooms.get(code)?.players.map((player) => player.name)).toEqual(['Ana'])
  })

  it('recusa entrada em sala inexistente', () => {
    const rooms = new RoomStore()
    expect(() => rooms.join('ZZZZZ', 'socket-a', 'a', 'Ana')).toThrow(RoomError)
  })

  it('descarta a sala quando o último piloto sai', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.leaveBySocket('socket-a')
    rooms.leaveBySocket('socket-b')
    expect(rooms.get(code)).toBeNull()
    expect(rooms.size).toBe(0)
  })
})

describe('sala de demonstração', () => {
  it('se cria sozinha quando o primeiro piloto entra', () => {
    const rooms = new RoomStore({ openRooms: ['demo1'] })
    expect(rooms.get('DEMO1')).toBeNull()

    const sala = rooms.join('DEMO1', 'socket-a', 'a', 'Ana')
    expect(sala.code).toBe('DEMO1')
    expect(sala.players.map((player) => player.name)).toEqual(['Ana'])
  })

  it('aceita o código em minúsculas e com espaços', () => {
    const rooms = new RoomStore({ openRooms: ['DEMO1'] })
    expect(rooms.join(' demo1 ', 'socket-a', 'a', 'Ana').code).toBe('DEMO1')
  })

  it('continua limitada a seis pilotos', () => {
    const rooms = new RoomStore({ openRooms: ['DEMO1'] })
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) rooms.join('DEMO1', `socket-${id}`, id, id)
    expect(() => rooms.join('DEMO1', 'socket-g', 'g', 'Gabi')).toThrow(RoomError)
  })

  it('reabre depois que todos saem', () => {
    const rooms = new RoomStore({ openRooms: ['DEMO1'] })
    rooms.join('DEMO1', 'socket-a', 'a', 'Ana')
    rooms.leaveBySocket('socket-a')
    expect(rooms.get('DEMO1')).toBeNull()

    // O QR code do slide continua funcionando na próxima demonstração.
    expect(rooms.join('DEMO1', 'socket-b', 'b', 'Beto').code).toBe('DEMO1')
  })

  it('não inventa salas fora da lista', () => {
    const rooms = new RoomStore({ openRooms: ['DEMO1'] })
    expect(() => rooms.join('OUTRA', 'socket-a', 'a', 'Ana')).toThrow(RoomError)
  })

  it('sem configuração nenhuma sala é aberta automaticamente', () => {
    const rooms = new RoomStore()
    expect(rooms.demoRooms).toEqual([])
    expect(() => rooms.join('DEMO1', 'socket-a', 'a', 'Ana')).toThrow(RoomError)
  })
})

describe('largada sincronizada', () => {
  it('espera a confirmação dos seis pilotos do grid', () => {
    const rooms = new RoomStore()
    const code = roomWithSixPilots(rooms)
    for (const id of ['a', 'b', 'c', 'd', 'e']) rooms.setReady(code, id, true)
    expect(rooms.get(code)?.status).toBe('waiting')
    expect(rooms.scheduleStart(code)).toBeNull()

    expect(rooms.setReady(code, 'f', true).status).toBe('ready')
    expect(rooms.scheduleStart(code)?.status).toBe('countdown')
  })

  it('agenda a largada no futuro apenas com os dois pilotos prontos', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now, countdownMs: 5_400 })
    const code = roomWithTwoPilots(rooms)

    rooms.setReady(code, 'a', true)
    expect(rooms.scheduleStart(code)).toBeNull()

    rooms.setReady(code, 'b', true)
    const scheduled = rooms.scheduleStart(code)
    expect(scheduled?.status).toBe('countdown')
    expect(scheduled?.startAt).toBe(clock.now() + 5_400)
    expect(scheduled?.countdownMs).toBe(5_400)
  })

  it('entrega o mesmo instante de largada para os dois pilotos', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const scheduled = rooms.scheduleStart(code)

    // Qualquer leitura posterior da sala devolve o mesmo horário oficial.
    clock.advance(1_200)
    expect(rooms.get(code)?.startAt).toBe(scheduled?.startAt)
  })

  it('não reagenda uma largada já marcada', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const first = rooms.scheduleStart(code)
    clock.advance(500)
    expect(rooms.scheduleStart(code)).toBeNull()
    expect(rooms.get(code)?.startAt).toBe(first?.startAt)
  })

  it('não aceita novos pilotos depois que a largada foi marcada', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)

    expect(() => rooms.join(code, 'socket-c', 'c', 'Caio')).toThrowError('já começou')
  })

  it('cancela a largada quando um piloto desfaz a confirmação', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)

    const cancelled = rooms.setReady(code, 'b', false)
    expect(cancelled.status).toBe('waiting')
    expect(cancelled.startAt).toBeNull()
    expect(cancelled.players.every((player) => !player.ready)).toBe(true)
  })

  it('cancela a largada quando um piloto sai durante a contagem', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)

    const [update] = rooms.leaveBySocket('socket-b')
    expect(update.room?.status).toBe('waiting')
    expect(update.room?.startAt).toBeNull()
  })

  it('marca o início da corrida no instante agendado', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const scheduled = rooms.scheduleStart(code)

    clock.advance(5_400)
    const racing = rooms.beginRace(code)
    expect(racing?.status).toBe('racing')
    expect(racing?.startAt).toBe(scheduled?.startAt)
    expect(rooms.beginRace(code)).toBeNull()
  })

  it('libera uma nova largada quando os pilotos voltam ao lobby', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    rooms.beginRace(code)

    expect(rooms.setReady(code, 'a', false).status).toBe('waiting')
    expect(rooms.setReady(code, 'a', true).status).toBe('waiting')
    expect(rooms.setReady(code, 'b', true).status).toBe('ready')
    expect(rooms.scheduleStart(code)?.status).toBe('countdown')
  })
})

describe('telemetria do adversário', () => {
  /** Deixa a sala correndo, que é o único estado em que a telemetria vale. */
  function salaCorrendo(clock: ReturnType<typeof createClock>) {
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)
    return { rooms, code }
  }

  const medicao = (t: number, progress: number, extra: Partial<Telemetry> = {}): Telemetry => ({
    t,
    progress,
    lateral: 0,
    speed: 252,
    state: 'racing',
    ...extra,
  })

  it('aceita a telemetria de quem está correndo', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    const aceita = rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 120))
    expect(aceita?.progress).toBe(120)
    expect(aceita?.state).toBe('racing')
  })

  it('repassa o boost só como booleano, e nunca na chegada', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 120, { boosting: true }))?.boosting).toBe(true)
    clock.advance(100)
    const adulterada = { ...medicao(clock.now(), 130), boosting: 'sim' } as unknown as Telemetry
    expect(rooms.acceptTelemetry(code, 'a', adulterada)?.boosting).toBe(false)
    clock.advance(100)
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 140))?.boosting).toBe(false)
    clock.advance(100)
    const chegada = rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 150, { state: 'finished', boosting: true }))
    expect(chegada?.boosting).toBe(false)
  })

  it('recusa telemetria antes da largada', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 120))).toBeNull()
  })

  it('recusa telemetria de quem não está na sala', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    expect(rooms.acceptTelemetry(code, 'intruso', medicao(clock.now(), 120))).toBeNull()
  })

  it('descarta pacotes fora de ordem', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 120))
    clock.advance(200)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 134))

    // Um pacote com horário anterior ao último aceito é ignorado.
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now() - 100, 127))).toBeNull()
    expect(rooms.rivalTelemetry(code, 'b')?.progress).toBe(134)
  })

  it('não perde a chegada enviada no mesmo milissegundo da última medição', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    const agora = clock.now()
    rooms.acceptTelemetry(code, 'a', medicao(agora, 4_790))

    const chegada = rooms.acceptTelemetry(code, 'a', medicao(agora, 4_800, { speed: 0, state: 'finished' }))
    expect(chegada?.state).toBe('finished')
    expect(chegada?.t).toBe(agora + 1)
    expect(rooms.rivalTelemetry(code, 'b')?.state).toBe('finished')
  })

  it('recusa números inválidos', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), Number.NaN))).toBeNull()
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), Infinity))).toBeNull()
  })

  it('impede que o progresso ande para trás', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 400))
    clock.advance(100)
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 250))?.progress).toBe(400)
  })

  it('limita um avanço impossível ao máximo plausível', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 100))
    clock.advance(100) // 0,1 s permitem no máximo 12 m mais a folga

    const aceita = rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 4_000))
    expect(aceita?.progress).toBeLessThan(150)
    expect(aceita?.progress).toBeGreaterThan(100)
  })

  it('mantém a faixa dentro dos limites da pista', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    // O recorte usa o mesmo limite que o jogo desenha, e não um número à parte.
    const aceita = rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 10, { lateral: 9 }))
    expect(aceita?.lateral).toBe(LATERAL_LIMIT)
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now() + 100, 12, { lateral: -9 }))?.lateral).toBe(
      -LATERAL_LIMIT,
    )
  })

  it('corrige um horário incoerente usando o relógio do servidor', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    const aceita = rooms.acceptTelemetry(code, 'a', medicao(clock.now() + 600_000, 10))
    expect(aceita?.t).toBe(clock.now())
  })

  it('entrega ao rival a última posição conhecida', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 512))
    expect(rooms.rivalTelemetry(code, 'b')?.progress).toBe(512)
    expect(rooms.rivalTelemetry(code, 'a')).toBeNull()
  })

  it('entrega as posições de todos os outros pilotos ao reconectar', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithSixPilots(rooms)
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) rooms.setReady(code, id, true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)
    for (const [index, id] of ['a', 'b', 'c', 'd', 'e'].entries()) {
      rooms.acceptTelemetry(code, id, medicao(clock.now(), 100 + index * 10))
    }

    expect(rooms.rivalTelemetries(code, 'f').map(({ playerId }) => playerId)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('esquece a telemetria da corrida anterior', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 4_000))

    rooms.setReady(code, 'a', false)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)

    expect(rooms.rivalTelemetry(code, 'b')).toBeNull()
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 5))?.progress).toBe(5)
  })
})

describe('resultado da corrida', () => {
  /** Sala correndo, já passado o tempo mínimo em que a prova pode terminar. */
  function provaCompletavel(clock: ReturnType<typeof createClock>, segundos = 70) {
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)
    clock.advance(segundos * 1_000)
    return { rooms, code }
  }

  const chegada = (time: number) => ({ time, topSpeed: 252, collisions: 2 })

  it('classifica os seis pilotos e só fecha depois do último resultado', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithSixPilots(rooms)
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) rooms.setReady(code, id, true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)
    clock.advance(70_000)

    for (const [index, id] of ['f', 'e', 'd', 'c', 'b'].entries()) {
      expect(rooms.recordFinish(code, id, chegada(68 + index * 0.4))?.outcome).toBeNull()
    }
    const resultado = rooms.recordFinish(code, 'a', chegada(70))?.outcome
    expect(resultado?.entries).toHaveLength(6)
    expect(resultado?.winnerId).toBe('f')
    expect(resultado?.entries.map(({ playerId }) => playerId)).toEqual(['f', 'e', 'd', 'c', 'b', 'a'])
  })

  it('mantém a corrida dos demais quando um piloto abandona um grid maior', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithSixPilots(rooms)
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) rooms.setReady(code, id, true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)

    expect(rooms.abandonRace(code, 'f')?.outcome).toBeNull()
    expect(rooms.get(code)?.status).toBe('racing')
  })

  it('só fecha o resultado quando os dois cruzam a linha', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock)

    const primeira = rooms.recordFinish(code, 'a', chegada(69))
    expect(primeira?.outcome).toBeNull()
    expect(primeira?.room.status).toBe('racing')

    const segunda = rooms.recordFinish(code, 'b', chegada(70))
    expect(segunda?.outcome).not.toBeNull()
    expect(segunda?.room.status).toBe('finished')
  })

  it('entrega o mesmo vencedor e a mesma diferença para os dois', () => {
    const clock = createClock()
    // Cada piloto avisa a própria chegada no instante em que cruza a linha.
    const { rooms, code } = provaCompletavel(clock, 69.25)
    rooms.recordFinish(code, 'b', chegada(69.25))
    clock.advance(2_250)
    rooms.recordFinish(code, 'a', chegada(71.5))

    const resultado = rooms.outcomeFor(code)!
    expect(resultado.winnerId).toBe('b')
    expect(resultado.reason).toBe('time')
    expect(resultado.gap).toBeCloseTo(2.25, 5)
    expect(resultado.entries.map((entry) => entry.playerId)).toEqual(['b', 'a'])
  })

  it('recusa uma chegada antes do tempo mínimo da prova', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock, 20)
    expect(rooms.recordFinish(code, 'a', chegada(19))).toBeNull()
  })

  it('prende um tempo impossível ao que o servidor mediu', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock, 70)
    // Cliente adulterado tentando reivindicar uma volta de 10 segundos.
    const registrada = rooms.recordFinish(code, 'a', chegada(10))
    expect(registrada?.room).toBeTruthy()

    rooms.recordFinish(code, 'b', chegada(70))
    const vencedor = rooms.outcomeFor(code)!
    expect(vencedor.entries.find((entry) => entry.playerId === 'a')!.time).toBeGreaterThan(67)
  })

  it('não aceita um tempo no futuro', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock, 70)
    rooms.recordFinish(code, 'a', chegada(500))
    const tempo = rooms.outcomeFor(code) ?? null
    expect(tempo).toBeNull()
    rooms.recordFinish(code, 'b', chegada(70))
    const registrado = rooms.outcomeFor(code)!.entries.find((entry) => entry.playerId === 'a')!
    expect(registrado.time).toBeLessThanOrEqual(70)
  })

  it('ignora uma segunda chegada do mesmo piloto', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock)
    rooms.recordFinish(code, 'a', chegada(69))
    expect(rooms.recordFinish(code, 'a', chegada(60))).toBeNull()
  })

  it('dá a vitória por abandono a quem ficou', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock, 30)
    const encerrada = rooms.abandonRace(code, 'b')

    const resultado = encerrada?.outcome!
    expect(resultado.reason).toBe('abandon')
    expect(resultado.winnerId).toBe('a')
    expect(resultado.gap).toBeNull()
    expect(resultado.entries[0].outcome).toBe('unfinished')
    expect(resultado.entries[1].outcome).toBe('abandoned')
  })

  it('quem já chegou vence mesmo se o rival abandonar depois', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock)
    rooms.recordFinish(code, 'a', chegada(68))
    const resultado = rooms.abandonRace(code, 'b')?.outcome!
    expect(resultado.winnerId).toBe('a')
    expect(resultado.entries[0].outcome).toBe('finished')
  })
})

describe('revanche', () => {
  function salaDecidida(clock: ReturnType<typeof createClock>) {
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)
    clock.advance(70_000)
    rooms.recordFinish(code, 'a', { time: 69, topSpeed: 252, collisions: 1 })
    rooms.recordFinish(code, 'b', { time: 70, topSpeed: 250, collisions: 3 })
    return { rooms, code }
  }

  it('espera os dois pedidos antes de liberar nova largada', () => {
    const clock = createClock()
    const { rooms, code } = salaDecidida(clock)

    const primeiro = rooms.requestRematch(code, 'a')
    expect(primeiro.status).toBe('finished')
    expect(rooms.scheduleStart(code)).toBeNull()

    const segundo = rooms.requestRematch(code, 'b')
    expect(segundo.status).toBe('ready')
    expect(rooms.scheduleStart(code)?.status).toBe('countdown')
  })

  it('limpa o resultado e a telemetria da corrida anterior', () => {
    const clock = createClock()
    const { rooms, code } = salaDecidida(clock)
    rooms.requestRematch(code, 'a')
    rooms.requestRematch(code, 'b')

    expect(rooms.outcomeFor(code)).toBeNull()
    expect(rooms.rivalTelemetry(code, 'a')).toBeNull()
    expect(rooms.get(code)?.players.every((player) => !player.finished)).toBe(true)
  })

  it('mostra quem já pediu revanche', () => {
    const clock = createClock()
    const { rooms, code } = salaDecidida(clock)
    const sala = rooms.requestRematch(code, 'a')
    expect(sala.players.find((player) => player.id === 'a')?.rematch).toBe(true)
    expect(sala.players.find((player) => player.id === 'b')?.rematch).toBe(false)
  })

  it('voltar ao lobby também libera a sala', () => {
    const clock = createClock()
    const { rooms, code } = salaDecidida(clock)
    const sala = rooms.setReady(code, 'a', false)
    expect(sala.status).toBe('waiting')
    expect(rooms.outcomeFor(code)).toBeNull()
  })
})

describe('perda momentânea de conexão', () => {
  it('mantém o piloto na sala durante a janela de retorno', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)

    const [update] = rooms.markDisconnected('socket-b')
    expect(update.room?.players).toHaveLength(2)
    expect(update.room?.players.find((player) => player.id === 'b')?.connected).toBe(false)
  })

  it('cancela a contagem quando um piloto cai', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)

    const [update] = rooms.markDisconnected('socket-b')
    expect(update.room?.status).toBe('waiting')
    expect(update.room?.startAt).toBeNull()
  })

  it('a reconexão devolve o piloto sem criar um terceiro', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)

    rooms.markDisconnected('socket-b')
    clock.advance(3_000)
    const back = rooms.join(code, 'socket-b2', 'b', 'Beto')

    expect(back.players).toHaveLength(2)
    expect(back.players.find((player) => player.id === 'b')?.connected).toBe(true)
    expect(rooms.dropIfStillDisconnected(code, 'b')).toBeNull()
  })

  it('remove quem não volta dentro da janela', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)

    rooms.markDisconnected('socket-b')
    clock.advance(12_000)
    const dropped = rooms.dropIfStillDisconnected(code, 'b')

    expect(dropped?.room?.players.map((player) => player.id)).toEqual(['a'])
  })

  it('a reconexão devolve o instante oficial de uma corrida em andamento', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const scheduled = rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)

    clock.advance(2_000)
    const back = rooms.join(code, 'socket-b2', 'b', 'Beto')
    expect(back.status).toBe('racing')
    expect(back.startAt).toBe(scheduled?.startAt)
  })
})

describe('semente oficial do traçado', () => {
  /** Sementes previsíveis: 1, 2, 3… para o teste poder afirmar qual é qual. */
  function storeComSementes() {
    let proxima = 0
    return new RoomStore({ nextSeed: () => (proxima += 1) })
  }

  it('a sala nasce com uma semente e ela vale para os dois pilotos', () => {
    const rooms = storeComSementes()
    const criada = rooms.create('socket-a', 'a', 'Ana')
    const entrou = rooms.join(criada.code, 'socket-b', 'b', 'Beto')

    expect(criada.trackSeed).toBe(1)
    // O segundo piloto recebe exatamente o mesmo número, não um novo sorteio.
    expect(entrou.trackSeed).toBe(criada.trackSeed)
  })

  it('cada largada estreia um traçado, e os dois pilotos recebem o mesmo', () => {
    const rooms = storeComSementes()
    const code = roomWithTwoPilots(rooms)
    const noLobby = rooms.get(code)!.trackSeed

    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const agendada = rooms.scheduleStart(code)!

    expect(agendada.trackSeed).not.toBe(noLobby)
    // A sala publicada é a mesma para quem quer que a leia.
    expect(rooms.get(code)?.trackSeed).toBe(agendada.trackSeed)
  })

  it('a semente não muda durante a contagem nem durante a corrida', () => {
    const rooms = storeComSementes()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const daLargada = rooms.scheduleStart(code)!.trackSeed

    expect(rooms.beginRace(code)?.trackSeed).toBe(daLargada)
    rooms.acceptTelemetry(code, 'a', { t: Date.now(), progress: 10, lateral: 0, speed: 100, state: 'racing' })
    expect(rooms.get(code)?.trackSeed).toBe(daLargada)
  })

  it('quem cai e volta no meio da prova recupera a mesma pista', () => {
    const rooms = storeComSementes()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const daLargada = rooms.scheduleStart(code)!.trackSeed
    rooms.beginRace(code)

    rooms.markDisconnected('socket-b')
    // Volta com outro socket, mas o mesmo identificador de piloto.
    const devolta = rooms.join(code, 'socket-b2', 'b', 'Beto')
    expect(devolta.trackSeed).toBe(daLargada)
  })

  it('a revanche sorteia uma pista nova, igual para os dois', () => {
    const clock = createClock()
    let proxima = 0
    const rooms = new RoomStore({ now: clock.now, nextSeed: () => (proxima += 1) })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const primeira = rooms.scheduleStart(code)!.trackSeed
    rooms.beginRace(code)
    // A prova precisa durar o mínimo plausível para a chegada ser aceita.
    clock.advance(80_000)

    const relatorio = { time: 70, topSpeed: 252, collisions: 1 }
    rooms.recordFinish(code, 'a', relatorio)
    rooms.recordFinish(code, 'b', { ...relatorio, time: 72 })

    rooms.requestRematch(code, 'a')
    // Com os dois pedidos a sala volta a ficar pronta e a largada é reagendada.
    rooms.requestRematch(code, 'b')
    const segunda = rooms.scheduleStart(code)!

    expect(segunda.trackSeed).not.toBe(primeira)
    expect(rooms.get(code)?.trackSeed).toBe(segunda.trackSeed)
  })

  it('a sala de demonstração também nasce com traçado próprio', () => {
    let proxima = 0
    const rooms = new RoomStore({ openRooms: ['DEMO1'], nextSeed: () => (proxima += 1) })
    const room = rooms.join('DEMO1', 'socket-a', 'a', 'Ana')
    expect(Number.isFinite(room.trackSeed)).toBe(true)
    expect(room.trackSeed).toBe(1)
  })
})

describe('dificuldade oficial da sala', () => {
  it('a sala nasce no nível de referência', () => {
    const rooms = new RoomStore()
    expect(rooms.create('socket-a', 'a', 'Ana').difficulty).toBe('normal')
  })

  it('a escolha vale para os dois pilotos', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    const depois = rooms.setDifficulty(code, 'a', 'profissional')
    expect(depois.difficulty).toBe('profissional')
    // Qualquer leitura posterior devolve o mesmo: é estado da sala, não do piloto.
    expect(rooms.get(code)?.difficulty).toBe('profissional')
    expect(rooms.difficultyOf(code)).toBe('profissional')
  })

  it('trocar de nível desfaz as confirmações', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    expect(rooms.setReady(code, 'b', true).status).toBe('ready')

    // Ninguém deve largar numa dificuldade que não viu.
    const depois = rooms.setDifficulty(code, 'a', 'dificil')
    expect(depois.status).toBe('waiting')
    expect(depois.players.every((player) => !player.ready)).toBe(true)
  })

  it('confirmar de novo no mesmo nível não desfaz nada', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    expect(rooms.setDifficulty(code, 'a', 'normal').status).toBe('ready')
  })

  it('um nível desconhecido cai no padrão em vez de passar', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setDifficulty(code, 'a', 'profissional')
    // Um cliente adulterado não instala uma regra que não existe.
    expect(rooms.setDifficulty(code, 'a', 'impossivel').difficulty).toBe('normal')
  })

  it('não muda com a largada marcada nem durante a corrida', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setDifficulty(code, 'a', 'dificil')
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)

    expect(rooms.setDifficulty(code, 'a', 'profissional').difficulty).toBe('dificil')
    rooms.beginRace(code)
    expect(rooms.setDifficulty(code, 'a', 'profissional').difficulty).toBe('dificil')
  })

  it('recusa quem não está na sala', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    expect(() => rooms.setDifficulty(code, 'intruso', 'profissional')).toThrow(RoomError)
  })

  it('só quem criou a sala escolhe', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    expect(rooms.hostOf(code)).toBe('a')

    // O convidado está na sala, mas a decisão não é dele.
    expect(() => rooms.setDifficulty(code, 'b', 'profissional')).toThrow(RoomError)
    expect(rooms.difficultyOf(code)).toBe('normal')

    expect(rooms.setDifficulty(code, 'a', 'profissional').difficulty).toBe('profissional')
  })

  it('quem fica assume quando o anfitrião sai de vez', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.leaveBySocket('socket-a')

    // Sem isso a dificuldade ficaria trancada no valor que ele deixou.
    expect(rooms.hostOf(code)).toBe('b')
    expect(rooms.setDifficulty(code, 'b', 'dificil').difficulty).toBe('dificil')
  })

  it('uma queda de conexão não transfere a sala', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.markDisconnected('socket-a')

    // Ele continua dono enquanto a janela de retorno corre.
    expect(rooms.hostOf(code)).toBe('a')
    expect(() => rooms.setDifficulty(code, 'b', 'profissional')).toThrow(RoomError)

    // E perde a sala só quando é removido de fato.
    rooms.dropIfStillDisconnected(code, 'a')
    expect(rooms.hostOf(code)).toBe('b')
  })

  it('na sala de demonstração o primeiro a entrar é o anfitrião', () => {
    const rooms = new RoomStore({ openRooms: ['DEMO1'] })
    rooms.join('DEMO1', 'socket-a', 'a', 'Ana')
    rooms.join('DEMO1', 'socket-b', 'b', 'Beto')
    expect(rooms.hostOf('DEMO1')).toBe('a')
    expect(rooms.get('DEMO1')?.hostId).toBe('a')
  })

  it('quem volta depois de sair não retoma a sala', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.leaveBySocket('socket-a')
    expect(rooms.hostOf(code)).toBe('b')

    rooms.join(code, 'socket-a2', 'a', 'Ana')
    expect(rooms.hostOf(code)).toBe('b')
  })

  it('o piso da chegada acompanha o nível da sala', () => {
    // No profissional o carro é mais rápido: um tempo legítimo lá seria
    // recusado pelo piso do normal.
    expect(minRaceSeconds('profissional')).toBeLessThan(minRaceSeconds('dificil'))
    expect(minRaceSeconds('dificil')).toBeLessThan(minRaceSeconds('normal'))

    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setDifficulty(code, 'a', 'profissional')
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    rooms.beginRace(code)

    // O relógio precisa passar da contagem antes de a prova começar a contar.
    const minimo = Math.round(minRaceSeconds('profissional') * 1_000)

    // Tempo impossível até para o profissional: recusado.
    clock.advance(5_400 + minimo - 2_000)
    expect(rooms.recordFinish(code, 'a', { time: 10, topSpeed: 362, collisions: 0 })).toBeNull()

    // E logo acima do piso daquele nível: aceito.
    clock.advance(4_000)
    const registrada = rooms.recordFinish(code, 'a', { time: 55, topSpeed: 362, collisions: 0 })
    expect(registrada).not.toBeNull()
  })

  it('a revanche mantém o nível escolhido', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setDifficulty(code, 'a', 'profissional')
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    rooms.beginRace(code)
    clock.advance(80_000)

    const relatorio = { time: 70, topSpeed: 362, collisions: 1 }
    rooms.recordFinish(code, 'a', relatorio)
    rooms.recordFinish(code, 'b', { ...relatorio, time: 72 })
    rooms.requestRematch(code, 'a')
    rooms.requestRematch(code, 'b')

    // A pista muda; a dificuldade combinada, não.
    expect(rooms.scheduleStart(code)?.difficulty).toBe('profissional')
  })
})

describe('carro de cada piloto', () => {
  const carros = (store: RoomStore, code: string) =>
    Object.fromEntries(store.get(code)!.players.map((player) => [player.id, player.car]))

  it('cada piloto entra com o carro que escolheu', () => {
    const rooms = new RoomStore()
    const { code } = rooms.create('socket-a', 'a', 'Ana', 'senna')
    rooms.join(code, 'socket-b', 'b', 'Beto', 'verstappen')
    // É estado do piloto, não da sala: cada um tem o seu.
    expect(carros(rooms, code)).toEqual({ a: 'senna', b: 'verstappen' })
  })

  it('sem carro, ou com um que não existe, entra com o padrão', () => {
    const rooms = new RoomStore()
    const { code } = rooms.create('socket-a', 'a', 'Ana')
    // Um cliente adulterado não faz o rival procurar uma imagem que não existe.
    rooms.join(code, 'socket-b', 'b', 'Beto', '../../segredo')
    expect(carros(rooms, code)).toEqual({ a: DEFAULT_CAR, b: DEFAULT_CAR })
  })

  it('trocar de carro não desfaz as confirmações', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)

    // Ao contrário da dificuldade, a pintura não muda a prova de ninguém.
    const depois = rooms.setCar(code, 'a', 'hamilton-ferrari')
    expect(depois.status).toBe('ready')
    expect(carros(rooms, code).a).toBe('hamilton-ferrari')
  })

  it('fica travado da contagem até a bandeirada', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const { code } = rooms.create('socket-a', 'a', 'Ana', 'senna')
    rooms.join(code, 'socket-b', 'b', 'Beto', 'verstappen')
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)

    // O rival viu este carro no grid e deve vê-lo até a chegada.
    rooms.scheduleStart(code)
    expect(carros(rooms, code).a).toBe('senna')
    rooms.setCar(code, 'a', 'schumacher')
    rooms.beginRace(code)
    rooms.setCar(code, 'a', 'schumacher')
    expect(carros(rooms, code).a).toBe('senna')

    clock.advance(80_000)
    rooms.recordFinish(code, 'a', { time: 70, topSpeed: 300, collisions: 0 })
    rooms.recordFinish(code, 'b', { time: 72, topSpeed: 300, collisions: 0 })

    // Com a corrida encerrada, a garagem volta a abrir.
    expect(rooms.setCar(code, 'a', 'schumacher').players[0].car).toBe('schumacher')
  })

  it('recusa quem não está na sala', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    expect(() => rooms.setCar(code, 'intruso', 'senna')).toThrow(RoomError)
  })

  it('quem volta de uma queda mantém o carro, a menos que traga outro', () => {
    const rooms = new RoomStore()
    const { code } = rooms.create('socket-a', 'a', 'Ana', 'hamilton-mercedes')
    rooms.markDisconnected('socket-a')

    // Um cliente antigo volta sem dizer o carro: nada muda.
    rooms.join(code, 'socket-a2', 'a', 'Ana')
    expect(carros(rooms, code).a).toBe('hamilton-mercedes')

    rooms.join(code, 'socket-a3', 'a', 'Ana', 'verstappen')
    expect(carros(rooms, code).a).toBe('verstappen')
  })

  it('a reconexão no meio da prova não troca o carro', () => {
    const rooms = new RoomStore()
    const { code } = rooms.create('socket-a', 'a', 'Ana', 'senna')
    rooms.join(code, 'socket-b', 'b', 'Beto', 'verstappen')
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    rooms.beginRace(code)

    rooms.markDisconnected('socket-a')
    rooms.join(code, 'socket-a2', 'a', 'Ana', 'schumacher')
    expect(carros(rooms, code).a).toBe('senna')
  })
})

describe('anfitrião tira piloto do grid', () => {
  it('libera a vaga e devolve o socket de quem saiu', () => {
    const rooms = new RoomStore()
    const code = roomWithSixPilots(rooms)
    const saida = rooms.kick(code, 'a', 'c')
    expect(saida.socketId).toBe('socket-c')
    expect(saida.room?.players.map((player) => player.id)).toEqual(['a', 'b', 'd', 'e', 'f'])
    // A vaga liberada aceita outro piloto.
    expect(rooms.join(code, 'socket-g', 'g', 'Gabi').players).toHaveLength(6)
  })

  it('tirar o único que faltava deixa a sala pronta para largar', () => {
    const rooms = new RoomStore()
    const code = roomWithSixPilots(rooms)
    for (const id of ['a', 'b', 'c', 'd', 'e']) rooms.setReady(code, id, true)
    expect(rooms.get(code)?.status).toBe('waiting')
    expect(rooms.kick(code, 'a', 'f').room?.status).toBe('ready')
  })

  it('só o anfitrião tira, e ninguém tira a si mesmo', () => {
    const rooms = new RoomStore()
    const code = roomWithSixPilots(rooms)
    expect(() => rooms.kick(code, 'b', 'c')).toThrow(RoomError)
    expect(() => rooms.kick(code, 'a', 'a')).toThrow(RoomError)
    expect(() => rooms.kick(code, 'a', 'fantasma')).toThrow(RoomError)
    expect(rooms.get(code)?.players).toHaveLength(6)
  })

  it('com a largada marcada, ninguém sai do grid', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.join(code, 'socket-c', 'c', 'Caio')
    for (const id of ['a', 'b', 'c']) rooms.setReady(code, id, true)
    rooms.scheduleStart(code)
    expect(rooms.get(code)?.status).toBe('countdown')
    expect(() => rooms.kick(code, 'a', 'c')).toThrow(RoomError)
    expect(rooms.get(code)?.players).toHaveLength(3)
  })
})

describe('arquibancada', () => {
  /** Dois pilotos confirmados e a prova já correndo. */
  function provaCorrendo() {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now, countdownMs: 1_000 })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(1_000)
    rooms.beginRace(code)
    return { rooms, code, clock }
  }

  it('assiste a uma sala cheia sem ocupar vaga', () => {
    const rooms = new RoomStore()
    const code = roomWithSixPilots(rooms)
    expect(() => rooms.join(code, 'socket-g', 'g', 'Gil')).toThrow(RoomError)
    const sala = rooms.spectate(code, 'socket-g', 'g', 'Gil')
    expect(sala.players).toHaveLength(6)
    expect(sala.spectators).toEqual([{ id: 'g', name: 'Gil' }])
  })

  it('entra para assistir com a prova em andamento', () => {
    const { rooms, code } = provaCorrendo()
    expect(() => rooms.join(code, 'socket-g', 'g', 'Gil')).toThrow(/já começou/)
    expect(rooms.spectate(code, 'socket-g', 'g', 'Gil').status).toBe('racing')
  })

  it('não conta para a largada: os pilotos confirmam sem esperar a arquibancada', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.spectate(code, 'socket-g', 'g', 'Gil')
    rooms.setReady(code, 'a', true)
    expect(rooms.setReady(code, 'b', true).status).toBe('ready')
  })

  it('a saída do espectador não mexe na contagem', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.spectate(code, 'socket-g', 'g', 'Gil')
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    const [saida] = rooms.leaveBySocket('socket-g')
    expect(saida.cancelledCountdown).toBe(false)
    expect(saida.room?.status).toBe('countdown')
    expect(saida.room?.spectators).toEqual([])
  })

  it('a saída do espectador no meio da prova não reinicia a corrida de ninguém', () => {
    const { rooms, code } = provaCorrendo()
    rooms.spectate(code, 'socket-g', 'g', 'Gil')
    expect(rooms.leaveBySocket('socket-g')[0].room?.status).toBe('racing')
  })

  it('queda de conexão tira o espectador na hora, e só ele', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.spectate(code, 'socket-g', 'g', 'Gil')
    const [update] = rooms.dropSpectatorsBySocket('socket-g')
    expect(update.room?.spectators).toEqual([])
    expect(rooms.dropSpectatorsBySocket('socket-a')).toEqual([])
    expect(rooms.get(code)?.players).toHaveLength(2)
  })

  it('quem volta reencontra o próprio lugar, sem se repetir', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.spectate(code, 'socket-g', 'g', 'Gil')
    expect(rooms.spectate(code, 'socket-g2', 'g', 'Gil Novo').spectators).toEqual([{ id: 'g', name: 'Gil Novo' }])
  })

  it('desce da arquibancada para uma vaga livre do grid', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.spectate(code, 'socket-g', 'g', 'Gil')
    const sala = rooms.join(code, 'socket-g', 'g', 'Gil')
    expect(sala.players.map((player) => player.id)).toContain('g')
    expect(sala.spectators).toEqual([])
  })

  it('recusado no grid, continua na arquibancada', () => {
    const rooms = new RoomStore()
    const code = roomWithSixPilots(rooms)
    rooms.spectate(code, 'socket-g', 'g', 'Gil')
    expect(() => rooms.join(code, 'socket-g', 'g', 'Gil')).toThrow(RoomError)
    expect(rooms.get(code)?.spectators).toEqual([{ id: 'g', name: 'Gil' }])
  })

  it('sobe do grid para assistir antes da largada, e abre a vaga', () => {
    const rooms = new RoomStore()
    const code = roomWithSixPilots(rooms)
    const sala = rooms.spectate(code, 'socket-f', 'f', 'Fábio')
    expect(sala.players).toHaveLength(5)
    expect(sala.spectators.map((spectator) => spectator.id)).toEqual(['f'])
    // Quem subiu não conta mais: os outros cinco confirmados largam.
    for (const id of ['a', 'b', 'c', 'd', 'e']) rooms.setReady(code, id, true)
    expect(rooms.get(code)?.status).toBe('ready')
  })

  it('com a largada marcada, quem está no grid não sai para assistir', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    expect(() => rooms.spectate(code, 'socket-b', 'b', 'Beto')).toThrow(/largada marcada/)
    expect(rooms.get(code)?.players).toHaveLength(2)
  })

  it('o anfitrião que sobe para assistir passa a sala adiante', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    expect(rooms.spectate(code, 'socket-a', 'a', 'Ana').hostId).toBe('b')
  })

  it('a sala segue aberta enquanto houver alguém na arquibancada', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.spectate(code, 'socket-g', 'g', 'Gil')
    rooms.leaveBySocket('socket-a')
    rooms.leaveBySocket('socket-b')
    expect(rooms.get(code)?.players).toEqual([])
    expect(rooms.get(code)?.hostId).toBeNull()
    // O primeiro a chegar no grid vazio vira o anfitrião.
    expect(rooms.join(code, 'socket-h', 'h', 'Hugo').hostId).toBe('h')
    rooms.leaveBySocket('socket-h')
    rooms.leaveBySocket('socket-g')
    expect(rooms.get(code)).toBeNull()
  })

  it('a arquibancada tem lotação', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    for (let i = 0; i < MAX_SPECTATORS; i += 1) rooms.spectate(code, `socket-x${i}`, `x${i}`, `X${i}`)
    expect(() => rooms.spectate(code, 'socket-y', 'y', 'Yuri')).toThrow(/lotada/)
    // Quem já está lá continua podendo voltar depois de uma queda.
    expect(rooms.spectate(code, 'socket-x0-de-novo', 'x0', 'X0').spectators).toHaveLength(MAX_SPECTATORS)
  })

  it('quem chega no meio da prova recebe a última posição de todos os pilotos', () => {
    const { rooms, code, clock } = provaCorrendo()
    const medicao = (progress: number): Telemetry => ({ t: clock.now(), progress, lateral: 0, speed: 200, state: 'racing' })
    rooms.acceptTelemetry(code, 'a', medicao(10))
    rooms.acceptTelemetry(code, 'b', medicao(12))
    expect(rooms.allTelemetries(code).map((telemetria) => telemetria.playerId).sort()).toEqual(['a', 'b'])
  })

  it('não entra no resultado da prova', () => {
    const { rooms, code } = provaCorrendo()
    rooms.spectate(code, 'socket-g', 'g', 'Gil')
    const encerrada = rooms.abandonRace(code, 'a')
    expect(encerrada?.outcome?.entries.map((entry) => entry.playerId).sort()).toEqual(['a', 'b'])
  })
})

describe('easter egg do Hamilton na Mercedes no servidor', () => {
  it('aceita a chegada mais rápida só de quem ativou o easter egg', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const { code } = rooms.create('socket-a', 'a', 'Ideau', 'hamilton-mercedes')
    rooms.join(code, 'socket-b', 'b', 'Beto', 'hamilton-mercedes')
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)

    const turbo = minRaceSeconds('normal', 1.5)
    expect(turbo).toBeLessThan(minRaceSeconds('normal'))
    clock.advance((turbo + 1) * 1_000)

    const chegada = { time: turbo + 0.5, topSpeed: 450, collisions: 0 }
    expect(rooms.recordFinish(code, 'b', chegada)).toBeNull()
    expect(rooms.recordFinish(code, 'a', chegada)).not.toBeNull()
  })

  it('na ranqueada ele não vale: a telemetria fica no teto de todo mundo', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const pilotos = [
      { socketId: 'socket-a', playerId: 'a', nome: 'Ideau', carro: 'hamilton-mercedes' },
      { socketId: 'socket-b', playerId: 'b', nome: 'Beto', carro: 'hamilton-mercedes' },
    ]
    const ranqueada = rooms.criarRanqueada(pilotos, 'dificil', () => 42)
    const casual = rooms.create('socket-c', 'c', 'Ideau', 'hamilton-mercedes')
    rooms.join(casual.code, 'socket-d', 'd', 'Duda')
    rooms.setDifficulty(casual.code, 'c', 'dificil')
    rooms.setReady(casual.code, 'c', true)
    rooms.setReady(casual.code, 'd', true)
    for (const code of [ranqueada.code, casual.code]) rooms.scheduleStart(code)
    clock.advance(5_400)
    for (const code of [ranqueada.code, casual.code]) rooms.beginRace(code)

    const teto = tetoDaTelemetria('dificil')
    const corrida = (code: string, playerId: string) => {
      rooms.acceptTelemetry(code, playerId, { t: clock.now(), progress: 0, lateral: 0, speed: 0, state: 'racing' })
      return (progress: number) => rooms.acceptTelemetry(code, playerId, { t: clock.now(), progress, lateral: 0, speed: progress * 3.6, state: 'racing' })
    }
    const naRanqueada = corrida(ranqueada.code, 'a')
    const naCasual = corrida(casual.code, 'c')
    clock.advance(1_000)
    const rapido = teto * 1.4
    expect(naRanqueada(rapido)!.progress).toBeLessThanOrEqual(teto + PROGRESS_TOLERANCE_M)
    expect(naCasual(rapido)!.progress).toBeCloseTo(rapido)
  })
})
