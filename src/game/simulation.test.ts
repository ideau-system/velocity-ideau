import { describe, expect, it } from 'vitest'
import { rulesFor } from './rules'
import {
  advanceRace,
  APEX_BOOST,
  APEX_LATERAL,
  BOOST_IN_CORNER,
  createRaceState,
  gripFor,
  lineFactorFor,
  MAX_CORNER_LOAD,
  LATERAL_LIMIT,
  MAX_FRAME_SECONDS,
  OFF_ROAD_LIMIT,
  RESET_SECONDS,
  slipstreamFrom,
  SLIPSTREAM_RANGE_M,
  SLIPSTREAM_WIDTH,
  speedForState,
  stepRace,
  WALL_IMPACT_KEEP,
  type RaceContext,
  type RaceEvent,
  type RaceInput,
  type RaceState,
} from './simulation'
import { HIT_HALF_WIDTH, obstacles, TRACK_LENGTH, WALL_LIMIT, type Obstacle } from './track'

/** Regras do nível de referência: é sobre elas que esta suíte fala. */
const REGRAS = rulesFor('normal')
const AGITATION_DEADBAND = REGRAS.agitationDeadband
const MAX_GRIP_LOSS = REGRAS.maxGripLoss
const PENALTY_SECONDS = REGRAS.penaltySeconds

const PARADO: RaceInput = { left: false, right: false, boost: false }
const SO_BOOST: RaceInput = { left: false, right: false, boost: true }
const DIREITA: RaceInput = { left: false, right: true, boost: false }
const ESQUERDA: RaceInput = { left: true, right: false, boost: false }

/** Velocidade de cruzeiro em pista livre, sem boost. */
const CRUZEIRO = speedForState(false, 0, false, REGRAS)

/**
 * Marca todos os obstáculos como já atingidos.
 *
 * Serve aos testes que medem só a curva de velocidade: sem isso, vinte
 * segundos de prova atravessam obstáculos e a penalidade contamina a medida.
 */
function semObstaculos(state: RaceState) {
  for (const obstacle of obstacles) state.hitObstacles.add(obstacle.id)
  return state
}

/** Segundos até o carro cruzar uma velocidade, partindo do zero. */
function tempoAte(alvo: number, dt = 1 / 60) {
  const state = createRaceState()
  for (let t = 0; t < 40; t += dt) {
    stepRace(state, PARADO, dt)
    if (state.speed >= alvo) return t + dt
  }
  return Infinity
}

type Corrida = { time: number; state: RaceState; events: RaceEvent[] }

function correr(policy: (t: number, state: RaceState) => RaceInput, dt = 1 / 60, limite = 300): Corrida {
  const state = createRaceState()
  const events: RaceEvent[] = []
  let time = 0
  while (!state.finished && time < limite) {
    events.push(...stepRace(state, policy(time, state), dt))
    time += dt
  }
  return { time, state, events }
}

/**
 * Avança mantendo vazio o medidor de saída de pista.
 *
 * Serve aos testes que medem a grama em si — quanto ela tira de velocidade,
 * quanto a profundidade pesa, como se volta dela. Sem isso, o reset por saída
 * de pista devolve o carro ao meio antes de a medida terminar, e o teste passa
 * a medir o reset. O reset tem os testes dele, mais abaixo.
 */
function naGrama(state: RaceState, input: RaceInput, segundos: number, dt = 1 / 60) {
  for (let t = 0; t < segundos; t += dt) {
    stepRace(state, input, dt)
    state.offTrack = 0
  }
}

function avancar(state: RaceState, input: RaceInput, segundos: number, dt = 1 / 60) {
  const events: RaceEvent[] = []
  for (let t = 0; t < segundos; t += dt) events.push(...stepRace(state, input, dt))
  return events
}

describe('física e progresso', () => {
  it('acelera sozinha: o piloto controla apenas direção e boost', () => {
    const state = createRaceState()
    avancar(state, PARADO, 2)
    expect(state.speed).toBeGreaterThan(50)
    expect(state.progress).toBeGreaterThan(0)
    expect(state.lateral).toBe(0)
  })

  it('um iniciante em linha reta completa a prova entre 60 e 90 segundos', () => {
    const { time, state } = correr(() => PARADO)
    expect(state.finished).toBe(true)
    expect(time).toBeGreaterThan(60)
    expect(time).toBeLessThan(90)
  })

  it('mantém o mesmo resultado em 60, 30 e 20 quadros por segundo', () => {
    const rapido = correr(() => PARADO, 1 / 60)
    const medio = correr(() => PARADO, 1 / 30)
    const lento = correr(() => PARADO, 0.05)
    expect(Math.abs(rapido.time - medio.time)).toBeLessThan(0.5)
    expect(Math.abs(rapido.time - lento.time)).toBeLessThan(0.5)
  })

  it('um celular a 12 quadros por segundo chega junto com o de 60', () => {
    const correrQuadros = (dt: number) => {
      const state = createRaceState()
      let time = 0
      while (!state.finished && time < 300) {
        advanceRace(state, PARADO, dt)
        time += dt
      }
      return time
    }
    // Só com stepRace o quadro longo perde física: o lento fica muito atrás.
    const soUmPasso = createRaceState()
    for (let t = 0; t < 10; t += 1 / 12) stepRace(soUmPasso, PARADO, 1 / 12)
    const inteiro = createRaceState()
    for (let t = 0; t < 10; t += 1 / 12) advanceRace(inteiro, PARADO, 1 / 12)
    expect(soUmPasso.progress).toBeLessThan(inteiro.progress * 0.7)

    expect(Math.abs(correrQuadros(1 / 60) - correrQuadros(1 / 12))).toBeLessThan(0.5)
  })

  it('um quadro de 0,25 s é o mesmo que cinco passos de 0,05 s', () => {
    const inteiro = createRaceState()
    const emPassos = createRaceState()
    avancar(inteiro, PARADO, 3)
    avancar(emPassos, PARADO, 3)
    const eventos = advanceRace(inteiro, DIREITA, 0.25)
    const eventosEmPassos: RaceEvent[] = []
    for (let i = 0; i < 5; i++) eventosEmPassos.push(...stepRace(emPassos, DIREITA, 0.05))
    expect(inteiro).toEqual(emPassos)
    expect(eventos).toEqual(eventosEmPassos)
  })

  it('um quadro enorme recupera só um quarto de segundo', () => {
    const parouMuito = createRaceState()
    const limite = createRaceState()
    advanceRace(parouMuito, PARADO, 5)
    advanceRace(limite, PARADO, MAX_FRAME_SECONDS)
    expect(parouMuito).toEqual(limite)
  })

  it('nunca ultrapassa a linha de chegada nem termina duas vezes', () => {
    const { state, events } = correr(() => SO_BOOST)
    expect(state.progress).toBe(TRACK_LENGTH)
    expect(events.filter((event) => event.type === 'finish')).toHaveLength(1)

    // Passos extras após a bandeirada não alteram mais nada.
    const antes = { ...state }
    expect(stepRace(state, SO_BOOST, 1 / 60)).toEqual([])
    expect(state.progress).toBe(antes.progress)
    expect(state.collisions).toBe(antes.collisions)
  })
})

describe('limites da pista', () => {
  it('respeita o limite lateral em qualquer velocidade', () => {
    const { state } = correr(() => ({ left: false, right: true, boost: true }))
    expect(state.lateral).toBeLessThanOrEqual(LATERAL_LIMIT)
    expect(state.lateral).toBeGreaterThanOrEqual(-LATERAL_LIMIT)
  })

  it('reduz a velocidade fora da pista sem destruir o carro', () => {
    const state = createRaceState()
    naGrama(state, { left: false, right: true, boost: false }, 6)
    expect(state.offRoad).toBe(true)
    expect(state.speed).toBeLessThan(180)
    expect(state.finished).toBe(false)
  })

  it('o carro não fica preso fora da pista', () => {
    const state = createRaceState()
    naGrama(state, { left: false, right: true, boost: false }, 6)
    expect(state.offRoad).toBe(true)

    // Corrige a direção até voltar ao asfalto e então segue reto.
    let tempoDeVolta = 0
    for (let t = 0; t < 4 && state.offRoad; t += 1 / 60) {
      stepRace(state, { left: true, right: false, boost: false }, 1 / 60)
      tempoDeVolta = t
    }
    expect(tempoDeVolta).toBeLessThan(1)
    expect(state.offRoad).toBe(false)
    expect(Math.abs(state.lateral)).toBeLessThan(OFF_ROAD_LIMIT)

    avancar(state, PARADO, 3)
    expect(state.speed).toBeGreaterThan(200)
  })

  it('mesmo correndo sempre fora da pista a prova termina', () => {
    const { state, time } = correr(() => ({ left: false, right: true, boost: false }), 1 / 60, 400)
    expect(state.finished).toBe(true)
    expect(time).toBeGreaterThan(90)
  })
})

describe('obstáculos e penalidades', () => {
  it('cada obstáculo aplica no máximo uma colisão', () => {
    const { state, events } = correr(() => PARADO)
    const colisoes = events.filter((event) => event.type === 'collision')
    const ids = colisoes.map((event) => (event.type === 'collision' ? event.obstacleId : 0))
    expect(new Set(ids).size).toBe(ids.length)
    expect(state.collisions).toBe(ids.length)
  })

  it('quem vai pelo centro atinge apenas os obstáculos do centro', () => {
    const { events } = correr(() => PARADO)
    const atingidos = events.flatMap((event) => (event.type === 'collision' ? [event.obstacleId] : []))
    // O alcance sai do tipo de cada um, e a lista sai das regras da corrida.
    // Antes eram um 0,25 solto e a lista literal de `track.ts`: dava no mesmo
    // enquanto todo obstáculo tinha a mesma meia-largura e tudo o que fora
    // acrescentado depois morava nas beiradas. A mancha de óleo é larga e
    // passa pelo meio, e aí as duas simplificações deixaram de valer.
    const esperados = REGRAS.obstacles
      .filter((o) => Math.abs(o.lane) < HIT_HALF_WIDTH[o.kind])
      .map((o) => o.id)
    expect(atingidos.sort()).toEqual(esperados.sort())
    // E o centro é mesmo ameaçado: sem isto a conferência passaria vazia.
    expect(esperados.length).toBeGreaterThan(2)
  })

  it('a penalidade tem duração previsível', () => {
    const state = createRaceState()
    avancar(state, PARADO, 3)
    state.penalty = 0
    state.hitObstacles.clear()

    // Posiciona o carro logo antes de um obstáculo central.
    const alvo = obstacles.find((obstacle) => Math.abs(obstacle.lane) < 0.25)!
    state.progress = alvo.distance - 4
    state.lateral = alvo.lane

    const eventos = avancar(state, PARADO, 1 / 30)
    expect(eventos.some((event) => event.type === 'collision')).toBe(true)
    expect(state.penalty).toBeGreaterThan(PENALTY_SECONDS - 0.1)

    avancar(state, PARADO, PENALTY_SECONDS - 0.2)
    expect(state.penalty).toBeGreaterThan(0)
    avancar(state, PARADO, 0.4)
    expect(state.penalty).toBe(0)
  })

  it('a velocidade volta ao normal quando a penalidade acaba', () => {
    const state = createRaceState()
    avancar(state, PARADO, 12)
    state.penalty = PENALTY_SECONDS
    avancar(state, PARADO, 1)
    expect(state.speed).toBeLessThan(200)
    // A recuperação é a mesma curva de tração da largada, então recuperar os
    // últimos km/h leva tempo de propósito. O que importa é voltar perto do
    // ritmo: em 3 s o carro já está a 95% da velocidade de cruzeiro.
    avancar(state, PARADO, 3)
    expect(state.speed).toBeGreaterThan(CRUZEIRO * 0.95)
    avancar(state, PARADO, 4)
    expect(state.speed).toBeGreaterThan(CRUZEIRO * 0.995)
  })
})

describe('reset', () => {
  /** Estado com uma lista de obstáculos própria, para a batida cair onde o teste quer. */
  function comObstaculos(lista: Obstacle[]) {
    const state = createRaceState()
    state.rules = { ...state.rules, obstacles: lista }
    return state
  }

  const barreira = (id: number, distance: number, kind: Obstacle['kind'] = 'barrier'): Obstacle =>
    ({ id, distance, lane: 0, kind })

  it('a terceira batida reseta o carro, no meio da pista', () => {
    const state = comObstaculos([barreira(1, 300), barreira(2, 600), barreira(3, 900)])
    const eventos = avancar(state, PARADO, 40)
    const resets = eventos.filter((e) => e.type === 'reset')
    expect(state.collisions).toBe(3)
    expect(resets).toEqual([{ type: 'reset', reason: 'crashes' }])
    expect(state.resets).toBe(1)
    // As batidas voltam a zero: a contagem recomeça depois do reset.
    expect(state.strikes).toBe(0)
  })

  it('as duas primeiras batidas são só penalidade de velocidade', () => {
    const state = comObstaculos([barreira(1, 300), barreira(2, 600)])
    avancar(state, PARADO, 30)
    expect(state.collisions).toBe(2)
    expect(state.strikes).toBe(2)
    expect(state.resets).toBe(0)
  })

  it('o reset custa exatamente o tempo prometido: parado, e depois na mesma velocidade', () => {
    const state = comObstaculos([barreira(1, 300), barreira(2, 600), barreira(3, 900)])
    let antes = NaN
    let progresso = NaN
    let parado = 0
    for (let t = 0; t < 60 && Number.isNaN(antes); t += 1 / 60) {
      const velocidade = state.speed
      const eventos = stepRace(state, PARADO, 1 / 60)
      if (eventos.some((e) => e.type === 'reset')) {
        antes = velocidade
        progresso = state.progress
      }
    }
    expect(state.resetting).toBeGreaterThan(0)
    expect(state.speed).toBe(0)
    while (state.resetting > 0) {
      // Com o volante virado de propósito: parado de verdade, nem anda nem vira.
      expect(state.progress).toBe(progresso)
      expect(state.lateral).toBe(0)
      stepRace(state, DIREITA, 1 / 60)
      parado += 1 / 60
    }
    // O reset acaba no meio de um quadro, e o resto dele já anda: a conta fica
    // dentro de um quadro do prometido.
    expect(Math.abs(parado - RESET_SECONDS)).toBeLessThanOrEqual(1 / 60 + 1e-9)
    // Volta na velocidade que tinha, e o resto daquele quadro já é tração
    // normal: o reset não cobra mais do que promete.
    expect(state.speed).toBeGreaterThanOrEqual(antes - 1e-6)
    expect(state.speed).toBeLessThan(antes + 1)
  })

  it('ficar na grama enche o medidor e reseta o carro', () => {
    const state = semObstaculos(createRaceState())
    avancar(state, PARADO, 8)
    const eventos = avancar(state, DIREITA, 3)
    expect(eventos).toContainEqual({ type: 'reset', reason: 'offTrack' })
    expect(state.resets).toBe(1)
  })

  it('uma escapada curta custa velocidade, mas não reseta', () => {
    const state = semObstaculos(createRaceState())
    avancar(state, PARADO, 8)
    // Até a grama, um instante lá, e de volta ao asfalto.
    for (let t = 0; t < 4 && !state.offRoad; t += 1 / 60) stepRace(state, DIREITA, 1 / 60)
    avancar(state, DIREITA, 0.3)
    for (let t = 0; t < 4 && state.offRoad; t += 1 / 60) stepRace(state, ESQUERDA, 1 / 60)
    expect(state.offRoad).toBe(false)
    expect(state.resets).toBe(0)
    // E o medidor se esvazia sozinho no asfalto.
    avancar(state, PARADO, 4)
    expect(state.offTrack).toBe(0)
  })

  it('raspar a borda demora mais para resetar que ir ao fundo da grama', () => {
    const ateResetar = (lateral: number) => {
      const state = semObstaculos(createRaceState())
      avancar(state, PARADO, 8)
      state.lateral = lateral
      for (let t = 0; t < 30; t += 1 / 60) {
        if (stepRace(state, PARADO, 1 / 60).some((e) => e.type === 'reset')) return t
      }
      return Infinity
    }
    const fundo = ateResetar(LATERAL_LIMIT)
    const borda = ateResetar(OFF_ROAD_LIMIT + 0.01)
    expect(fundo).toBeLessThan(1.5)
    expect(borda).toBeGreaterThan(fundo * 2)
    // Mas a beirada não é lugar para morar: raspando também reseta.
    expect(borda).toBeLessThan(Infinity)
  })

  it('buraco, óleo e poça não contam como batida', () => {
    const state = comObstaculos([
      barreira(1, 300, 'pothole'), barreira(2, 600, 'oleo'), barreira(3, 900, 'poca'), barreira(4, 1_200, 'pothole'),
    ])
    avancar(state, PARADO, 40)
    expect(state.collisions).toBe(4)
    expect(state.strikes).toBe(0)
    expect(state.resets).toBe(0)
  })

  it('depois do reset, o carro não bate no que o reset pôs na frente dele', () => {
    // O reset devolve o carro ao meio da pista, e há outra barreira no meio a
    // dez metros: o piloto não escolheu estar ali, e não teria como desviar.
    const state = comObstaculos([
      barreira(1, 300), barreira(2, 600), barreira(3, 900), barreira(4, 910),
    ])
    avancar(state, PARADO, 40)
    expect(state.resets).toBe(1)
    expect(state.collisions).toBe(3)
  })

  it('parado no reset, o carro não bate em nada nem avança', () => {
    const state = comObstaculos([barreira(1, 300), barreira(2, 600), barreira(3, 900)])
    for (let t = 0; t < 60 && state.resetting === 0; t += 1 / 60) stepRace(state, PARADO, 1 / 60)
    const progresso = state.progress
    const colisoes = state.collisions
    avancar(state, DIREITA, RESET_SECONDS * 0.9)
    expect(state.progress).toBe(progresso)
    expect(state.collisions).toBe(colisoes)
  })

  it('o reset é o mesmo em 60, 30 e 20 quadros por segundo', () => {
    // Contagem inteira de quadros: somar `dt` em ponto flutuante até 30 roda um
    // quadro a mais em algumas taxas, e o teste passaria a comparar tempos de
    // prova diferentes.
    const final = (quadrosPorSegundo: number) => {
      const state = comObstaculos([barreira(1, 300), barreira(2, 600), barreira(3, 900)])
      for (let i = 0; i < 30 * quadrosPorSegundo; i += 1) stepRace(state, PARADO, 1 / quadrosPorSegundo)
      return state
    }
    const [a, b, c] = [final(60), final(30), final(20)]
    expect(a.resets).toBe(1)
    expect(b.resets).toBe(1)
    expect(c.resets).toBe(1)
    // As três taxas percorrem a mesma sequência de passos fixos, batidas
    // inclusive: o carro para no mesmo lugar, e não a um quadro de distância.
    expect(b.progress).toBeCloseTo(a.progress, 6)
    expect(c.progress).toBeCloseTo(a.progress, 6)
  })
})

describe('boost', () => {
  it('consome enquanto ativo e recarrega quando solto', () => {
    const state = createRaceState()
    avancar(state, SO_BOOST, 2)
    expect(state.boosting).toBe(true)
    expect(state.boost).toBeLessThan(100)

    const gasto = state.boost
    avancar(state, PARADO, 2)
    expect(state.boost).toBeGreaterThan(gasto)
  })

  it('esgota e fica bloqueado até recarregar, sem piscar a cada quadro', () => {
    const state = createRaceState()
    avancar(state, SO_BOOST, 6)
    expect(state.boostLocked).toBe(true)
    expect(state.boosting).toBe(false)
    expect(state.speed).toBeLessThan(300)

    // Segurando o botão com o tanque vazio o boost permanece desligado.
    for (let t = 0; t < 2; t += 1 / 60) {
      stepRace(state, SO_BOOST, 1 / 60)
      expect(state.boosting).toBe(false)
    }
    expect(state.boost).toBeGreaterThan(5)

    // Só volta a funcionar depois de atingir a carga mínima.
    avancar(state, PARADO, 4)
    expect(state.boostLocked).toBe(false)
    avancar(state, SO_BOOST, 0.2)
    expect(state.boosting).toBe(true)
  })

  it('não funciona fora da pista nem durante a penalidade', () => {
    const foraDaPista = createRaceState()
    avancar(foraDaPista, { left: false, right: true, boost: true }, 5)
    expect(foraDaPista.offRoad).toBe(true)
    expect(foraDaPista.boosting).toBe(false)

    const penalizado = createRaceState()
    avancar(penalizado, PARADO, 2)
    penalizado.penalty = PENALTY_SECONDS
    avancar(penalizado, SO_BOOST, 0.2)
    expect(penalizado.boosting).toBe(false)
  })

  it('não decide sozinho a corrida', () => {
    const semBoost = correr(() => PARADO)
    const comBoost = correr(() => SO_BOOST)
    const ganho = (semBoost.time - comBoost.time) / semBoost.time
    expect(ganho).toBeGreaterThan(0.02)
    expect(ganho).toBeLessThan(0.15)
  })
})

describe('curva de aceleração', () => {
  it('a arrancada é forte, mas não coloca o carro em 200 km/h de imediato', () => {
    // O problema medido na versão anterior: 0 a 200 km/h em 0,88 s, o que
    // fazia a corrida começar já em velocidade de cruzeiro.
    expect(tempoAte(100)).toBeGreaterThan(1.2)
    expect(tempoAte(200)).toBeGreaterThan(2.8)
  })

  it('mas também não é lenta a ponto de parecer que o carro não anda', () => {
    expect(tempoAte(50)).toBeLessThan(1.3)
    expect(tempoAte(100)).toBeLessThan(2.4)
    expect(tempoAte(200)).toBeLessThan(5)
  })

  it('o ganho é progressivo: as faixas altas custam mais que as baixas', () => {
    const marcos = [50, 100, 150, 200, 240].map((alvo) => tempoAte(alvo))
    const trechos = marcos.map((t, i) => (i === 0 ? t : t - marcos[i - 1]))

    // A tração é quase plana no começo — é isso que dá a arrancada — e só
    // cede perto do teto. Então nenhuma faixa é mais barata que a anterior,
    // e a última é bem mais cara que a primeira.
    for (let i = 1; i < trechos.length; i += 1) {
      expect(trechos[i]).toBeGreaterThan(trechos[i - 1] - 0.02)
    }
    expect(trechos[trechos.length - 1]).toBeGreaterThan(trechos[0] * 1.8)
  })

  it('chega à velocidade de cruzeiro e para nela', () => {
    const state = createRaceState()
    avancar(state, PARADO, 20)
    expect(state.speed).toBeCloseTo(CRUZEIRO, 3)
  })

  it('o boost é sentido na saída e some ao soltar', () => {
    const state = semObstaculos(createRaceState())
    avancar(state, PARADO, 20)
    const cruzeiro = state.speed

    avancar(state, SO_BOOST, 1)
    const comUmSegundo = state.speed
    expect(comUmSegundo).toBeGreaterThan(cruzeiro + 15)

    avancar(state, SO_BOOST, 2)
    expect(state.speed).toBeGreaterThan(comUmSegundo)
    expect(state.speed).toBeLessThanOrEqual(speedForState(false, 0, true, REGRAS))

    // Ao soltar, a queda é contínua: passa por valores intermediários.
    const descida: number[] = []
    for (let t = 0; t < 1.2; t += 1 / 60) {
      stepRace(state, PARADO, 1 / 60)
      descida.push(state.speed)
    }
    expect(descida.some((v) => v > cruzeiro + 5 && v < comUmSegundo)).toBe(true)
  })
})

describe('perdas de velocidade', () => {
  it('o impacto derruba a velocidade de imediato, não aos poucos', () => {
    const state = createRaceState()
    avancar(state, PARADO, 20)
    const antes = state.speed
    const alvo = obstacles.find((obstacle) => Math.abs(obstacle.lane) < 0.25)!
    state.progress = alvo.distance - 4
    state.lateral = alvo.lane

    const eventos = avancar(state, PARADO, 0.2)
    expect(eventos.some((event) => event.type === 'collision')).toBe(true)
    // Em dois décimos de segundo a maior parte da queda já aconteceu.
    expect(antes - state.speed).toBeGreaterThan((antes - speedForState(false, 1, false, REGRAS)) * 0.7)
  })

  it('a grama tira mais velocidade quanto mais fundo o carro entra', () => {
    const naBorda = createRaceState()
    avancar(naBorda, PARADO, 20)
    // Posiciona o carro logo depois da borda e deixa a velocidade assentar.
    naBorda.lateral = OFF_ROAD_LIMIT + 0.01
    naGrama(naBorda, PARADO, 6)

    const fundo = createRaceState()
    avancar(fundo, PARADO, 20)
    fundo.lateral = LATERAL_LIMIT
    naGrama(fundo, PARADO, 6)

    expect(naBorda.offRoad).toBe(true)
    expect(fundo.offRoad).toBe(true)
    expect(fundo.speed).toBeLessThan(naBorda.speed - 10)
  })

  it('a desaceleração fora da pista é contínua, sem degrau', () => {
    const state = semObstaculos(createRaceState())
    avancar(state, PARADO, 20)
    const partida = state.speed

    const amostras: number[] = []
    for (let t = 0; t < 1.5; t += 1 / 60) {
      stepRace(state, DIREITA, 1 / 60)
      if (state.offRoad) amostras.push(state.speed)
    }

    // Só perde velocidade, nunca recupera no meio da grama.
    for (let i = 1; i < amostras.length; i += 1) {
      expect(amostras[i]).toBeLessThanOrEqual(amostras[i - 1])
    }
    // E leva tempo: não é um degrau para o piso no primeiro quadro.
    const piso = amostras[amostras.length - 1]
    const meioCaminho = (partida + piso) / 2
    expect(amostras.findIndex((valor) => valor <= meioCaminho)).toBeGreaterThan(6)
    expect(piso).toBeLessThan(150)
  })

  it('penalidades somadas não deixam o carro irrecuperável', () => {
    const state = createRaceState()
    avancar(state, PARADO, 20)
    // O pior caso possível: fundo da grama, penalidade ativa e volante em pânico.
    state.lateral = LATERAL_LIMIT
    state.penalty = PENALTY_SECONDS
    for (let t = 0; t < 3; t += 1 / 60) {
      stepRace(state, Math.floor(t / 0.2) % 2 === 0 ? DIREITA : ESQUERDA, 1 / 60)
    }
    expect(state.speed).toBeGreaterThan(50)

    // E volta ao ritmo assim que o piloto endireita.
    for (let t = 0; t < 4 && state.offRoad; t += 1 / 60) stepRace(state, ESQUERDA, 1 / 60)
    expect(state.offRoad).toBe(false)
    avancar(state, PARADO, 6)
    expect(state.speed).toBeGreaterThan(CRUZEIRO * 0.95)
  })
})

describe('esforço lateral', () => {
  /**
   * Roda a prova inteira com uma política de direção e devolve o essencial.
   *
   * A política recebe o tempo e também o número do quadro: comparar taxas de
   * quadros exige que o comando seja idêntico nas três, e só o índice do
   * quadro garante isso.
   */
  function provaCom(policy: (t: number, quadro: number, dt: number) => RaceInput, dt = 1 / 60) {
    const state = createRaceState()
    let time = 0
    let quadro = 0
    let piorAderencia = 1
    let maiorAgitacao = 0
    while (!state.finished && time < 400) {
      stepRace(state, policy(time, quadro, dt), dt)
      time += dt
      quadro += 1
      piorAderencia = Math.min(piorAderencia, state.grip)
      maiorAgitacao = Math.max(maiorAgitacao, state.agitation)
    }
    return { time, piorAderencia, maiorAgitacao, state }
  }

  /**
   * Zigue-zague de meio período exato em quadros.
   *
   * Medir por tempo acumulado daria fases de tamanho diferente em cada taxa
   * — em 30 quadros por segundo, meio período de 0,35 s cai entre dois
   * quadros — e o comando assimétrico faria o carro derivar para um lado. O
   * teste mediria a amostragem do próprio teste, não a simulação.
   */
  const zigueZague = (meioPeriodo: number) => (_t: number, quadro: number, dt: number) => {
    const quadrosPorFase = Math.max(1, Math.round(meioPeriodo / dt))
    return Math.floor(quadro / quadrosPorFase) % 2 === 0 ? DIREITA : ESQUERDA
  }

  /** Correção de curva: um toque curto para cada lado, com folga entre eles. */
  const correcaoDeCurva = (t: number) => {
    const ciclo = t % 2.4
    if (ciclo < 0.25) return DIREITA
    if (ciclo >= 1.45 && ciclo < 1.7) return ESQUERDA
    return PARADO
  }

  it('a aderência só começa a cair depois da zona morta', () => {
    expect(gripFor(0, REGRAS)).toBe(1)
    expect(gripFor(AGITATION_DEADBAND, REGRAS)).toBe(1)
    expect(gripFor(AGITATION_DEADBAND + 0.5, REGRAS)).toBeLessThan(1)
    // E nunca passa da perda máxima, por mais que o piloto insista.
    expect(gripFor(1_000, REGRAS)).toBeCloseTo(1 - MAX_GRIP_LOSS, 9)
  })

  it('o zigue-zague sustentado custa tempo de prova', () => {
    const reto = provaCom(() => PARADO)
    const agitado = provaCom(zigueZague(0.3))
    expect(agitado.piorAderencia).toBeLessThan(0.9)
    expect(agitado.time).toBeGreaterThan(reto.time * 1.08)
  })

  it('pulsar o mesmo lado não é zigue-zague: é como se segura uma curva com tecla', () => {
    // Com tecla ou toque não existe meio volante. Quatro toques por segundo
    // para o mesmo lado — o jeito de segurar uma linha de curva — não podem
    // custar aderência; antes, custavam, e o aviso acendia em quem dirigia certo.
    const pulsando = provaCom((t) => (t % 0.25 < 0.1 ? DIREITA : PARADO))
    expect(pulsando.maiorAgitacao).toBeLessThan(AGITATION_DEADBAND)
    expect(pulsando.piorAderencia).toBe(1)
  })

  it('a correção necessária numa curva não é punida', () => {
    const corrigindo = provaCom(correcaoDeCurva)
    expect(corrigindo.maiorAgitacao).toBeLessThan(AGITATION_DEADBAND)
    expect(corrigindo.piorAderencia).toBe(1)
  })

  it('a aderência volta sozinha quando o piloto para de serpentear', () => {
    const state = createRaceState()
    for (let t = 0; t < 6; t += 1 / 60) {
      stepRace(state, Math.floor(t / 0.35) % 2 === 0 ? DIREITA : ESQUERDA, 1 / 60)
    }
    expect(state.grip).toBeLessThan(0.95)
    avancar(state, PARADO, 4)
    expect(state.grip).toBe(1)
  })

  it('o volante tem inércia, mas não atrasa o comando a ponto de atrapalhar', () => {
    const state = createRaceState()
    stepRace(state, DIREITA, 1 / 60)
    // Já saiu do lugar no primeiro quadro: o comando não fica preso.
    expect(state.steerInput).toBeGreaterThan(0)
    expect(state.lateral).toBeGreaterThan(0)

    avancar(state, DIREITA, 0.4)
    expect(state.steerInput).toBeGreaterThan(0.95)
  })

  it('a punição por esforço é a mesma em 60, 30 e 20 quadros por segundo', () => {
    const tempos = [60, 30, 20].map((fps) => provaCom(zigueZague(0.3), 1 / fps).time)
    for (const tempo of tempos.slice(1)) {
      expect(Math.abs(tempo - tempos[0])).toBeLessThan(1)
    }
  })
})

describe('a curva cobra velocidade', () => {
  /**
   * Curvatura acima da aderência, para o pneu escapar. O valor sai da própria
   * regra em vez de ser um número escolhido a olho, então continua válido se a
   * aderência do nível for reajustada.
   */
  const FECHADA = REGRAS.cornerGrip + 0.4

  /** Avança com a pista curvando, sem ninguém no volante. */
  function semVolante(state: RaceState, curvature: number, segundos: number, dt = 1 / 60) {
    for (let t = 0; t < segundos; t += dt) stepRace(state, PARADO, dt, { curvature, slipstream: 0 })
    return state
  }

  it('empurra o carro para fora da curva, e não para dentro', () => {
    for (const curvatura of [FECHADA, -FECHADA]) {
      const state = semObstaculos(createRaceState())
      state.speed = CRUZEIRO
      semVolante(state, curvatura, 0.5)
      // Curva à direita (curvatura positiva) joga o carro para a esquerda.
      expect(Math.sign(state.lateral)).toBe(-Math.sign(curvatura))
    }
  })

  it('a pista reta não desloca o carro', () => {
    const state = semObstaculos(createRaceState())
    state.speed = CRUZEIRO
    semVolante(state, 0, 2)
    expect(state.lateral).toBe(0)
    expect(state.cornerLoad).toBe(0)
  })

  it('abaixo do limite de aderência o pneu segura sozinho', () => {
    const segurando = semObstaculos(createRaceState())
    segurando.speed = CRUZEIRO
    // Na velocidade de cruzeiro a carga é a própria curvatura, então uma
    // curvatura abaixo da aderência não pode mover o carro.
    semVolante(segurando, REGRAS.cornerGrip * 0.9, 2)
    expect(segurando.lateral).toBe(0)

    // Acima do limite o carro escapa: a aderência é um limiar, não um muro.
    const escapando = semObstaculos(createRaceState())
    escapando.speed = CRUZEIRO
    semVolante(escapando, REGRAS.cornerGrip * 1.2, 2)
    expect(escapando.lateral).not.toBe(0)
  })

  it('a força cresce com o quadrado da velocidade', () => {
    const deslocamento = (velocidade: number) => {
      const state = semObstaculos(createRaceState())
      state.speed = velocidade
      // Um passo só: assim a velocidade usada é a que foi escolhida aqui, e
      // não a que a aceleração automática teria alcançado depois.
      stepRace(state, PARADO, 1 / 60, { curvature: FECHADA, slipstream: 0 })
      return Math.abs(state.lateral)
    }

    const normal = deslocamento(CRUZEIRO)
    const rapido = deslocamento(CRUZEIRO * 1.25)
    // Com o quadrado, 25% mais velocidade dá bem mais que 25% de empurrão.
    expect(rapido).toBeGreaterThan(normal * 1.5)
  })

  it('o esterço vence a curva: a força custa margem, não controle', () => {
    const state = semObstaculos(createRaceState())
    state.speed = CRUZEIRO
    // Segurando o volante contra a curva, o carro caminha para o outro lado.
    for (let t = 0; t < 1.5; t += 1 / 60) {
      stepRace(state, DIREITA, 1 / 60, { curvature: FECHADA, slipstream: 0 })
    }
    expect(state.lateral).toBeGreaterThan(0)
  })

  it('registra a carga lateral entre 0 e 1, para a apresentação ler', () => {
    const state = semObstaculos(createRaceState())
    for (let t = 0; t < 20; t += 1 / 60) {
      stepRace(state, SO_BOOST, 1 / 60, { curvature: 1, slipstream: 0 })
      expect(state.cornerLoad).toBeGreaterThanOrEqual(0)
      expect(state.cornerLoad).toBeLessThanOrEqual(1)
    }
    // Acima da velocidade de cruzeiro, curvatura máxima satura a carga. Medido
    // em um passo, porque ao ser jogado para a grama o carro perde velocidade
    // e a carga cai junto — o que também está certo, e é o que o laço acima vê.
    const embalado = semObstaculos(createRaceState())
    embalado.speed = REGRAS.boostSpeed
    stepRace(embalado, PARADO, 1 / 60, { curvature: 1, slipstream: 0 })
    expect(embalado.cornerLoad).toBe(1)
  })

  it('uma curvatura inválida não arrasta o carro para fora da pista', () => {
    const state = semObstaculos(createRaceState())
    state.speed = CRUZEIRO
    semVolante(state, Number.NaN, 1)
    expect(state.lateral).toBe(0)
    expect(Number.isFinite(state.speed)).toBe(true)
  })

  it('a curva também freia: o pneu que escapa esfrega', () => {
    // Segurando a linha na curva mais fechada, o carro não sustenta o
    // cruzeiro. Na reta, sustenta.
    const naCurva = semObstaculos(createRaceState())
    naCurva.speed = CRUZEIRO
    for (let t = 0; t < 3; t += 1 / 60) stepRace(naCurva, DIREITA, 1 / 60, { curvature: 1, slipstream: 0 })
    naCurva.offTrack = 0

    const naReta = semObstaculos(createRaceState())
    naReta.speed = CRUZEIRO
    avancar(naReta, PARADO, 3)

    expect(naReta.speed).toBeCloseTo(CRUZEIRO, 1)
    expect(naCurva.speed).toBeLessThan(CRUZEIRO - 8)
  })

  it('esfrega aos poucos: quem entra embalado é jogado para fora antes de frear', () => {
    // Se a velocidade caísse de uma vez, a força da curva cairia junto, e
    // ninguém sairia da pista nem entrando de boost — era o que acontecia
    // quando o esfregão cortava a velocidade-alvo em vez de frear.
    const state = semObstaculos(createRaceState())
    state.speed = REGRAS.boostSpeed
    stepRace(state, PARADO, 0.25, { curvature: 1, slipstream: 0 })
    expect(state.speed).toBeGreaterThan(CRUZEIRO)
  })

  it('a pior curva, em cruzeiro, cabe na pista para quem vira o volante desde o meio', () => {
    // É a garantia que torna a curva pesada, e não injusta: na curvatura
    // máxima o carro abre antes de o pneu esfregar a velocidade para baixo —
    // no profissional, três décimos de faixa —, mas quem vinha pelo meio e
    // virou tudo não chega nem à metade do caminho até a grama. A outra metade
    // fica para quem vinha um pouco de fora.
    for (const nivel of ['normal', 'dificil', 'profissional'] as const) {
      const state = semObstaculos(createRaceState(nivel))
      state.speed = state.rules.cruiseSpeed
      let pior = 0
      for (let t = 0; t < 3; t += 1 / 60) {
        // Curva à direita empurra para a esquerda: segura à direita.
        stepRace(state, DIREITA, 1 / 60, { curvature: 1, slipstream: 0 })
        pior = Math.min(pior, state.lateral)
      }
      expect(Math.abs(pior), nivel).toBeLessThan(OFF_ROAD_LIMIT / 2)
    }
  })

  it('de boost, a curva mais fechada joga o carro para fora mesmo com o volante todo virado', () => {
    // A lição de toda curva de verdade: o boost é para a reta.
    const state = semObstaculos(createRaceState())
    state.speed = REGRAS.boostSpeed
    stepRace(state, { left: false, right: true, boost: true }, 0.05, { curvature: 1, slipstream: 0 })
    const antes = state.lateral
    for (let t = 0; t < 0.3; t += 1 / 60) {
      stepRace(state, { left: false, right: true, boost: true }, 1 / 60, { curvature: 1, slipstream: 0 })
    }
    expect(state.lateral).toBeLessThan(antes)
  })

  it('os níveis mais duros dão menos aderência na curva', () => {
    const normal = rulesFor('normal').cornerGrip
    const dificil = rulesFor('dificil').cornerGrip
    const profissional = rulesFor('profissional').cornerGrip
    expect(dificil).toBeLessThan(normal)
    expect(profissional).toBeLessThan(dificil)
  })
})

describe('vácuo do rival', () => {
  it('só existe para quem vem atrás, e some ao ultrapassar', () => {
    expect(slipstreamFrom(1_000, 0, 1_020, 0)).toBeGreaterThan(0)
    // Lado a lado ou à frente não há esteira para aproveitar.
    expect(slipstreamFrom(1_000, 0, 1_000, 0)).toBe(0)
    expect(slipstreamFrom(1_020, 0, 1_000, 0)).toBe(0)
  })

  it('enfraquece com a distância e acaba fora do alcance', () => {
    const colado = slipstreamFrom(1_000, 0, 1_002, 0)
    const longe = slipstreamFrom(1_000, 0, 1_030, 0)
    expect(colado).toBeGreaterThan(longe)
    expect(longe).toBeGreaterThan(0)
    expect(slipstreamFrom(1_000, 0, 1_000 + SLIPSTREAM_RANGE_M, 0)).toBe(0)
    expect(slipstreamFrom(1_000, 0, 1_500, 0)).toBe(0)
  })

  it('exige alinhamento: quem passa por outra faixa não pega esteira', () => {
    const atras = slipstreamFrom(1_000, 0, 1_010, 0)
    const deslocado = slipstreamFrom(1_000, 0, 1_010, SLIPSTREAM_WIDTH / 2)
    expect(deslocado).toBeGreaterThan(0)
    expect(deslocado).toBeLessThan(atras)
    expect(slipstreamFrom(1_000, 0, 1_010, SLIPSTREAM_WIDTH)).toBe(0)
    expect(slipstreamFrom(1_000, 0, 1_010, -SLIPSTREAM_WIDTH * 2)).toBe(0)
  })

  it('fica entre 0 e 1 em qualquer combinação, inclusive com valor inválido', () => {
    for (const progresso of [-100, 0, 1_000, Number.NaN]) {
      for (const lateral of [-2, 0, 1.4, Number.NaN]) {
        const forca = slipstreamFrom(1_000, 0, progresso, lateral)
        expect(forca).toBeGreaterThanOrEqual(0)
        expect(forca).toBeLessThanOrEqual(1)
      }
    }
  })

  it('acrescenta até o bônus do nível, proporcional à força', () => {
    expect(speedForState(false, 0, false, REGRAS, 0)).toBe(REGRAS.cruiseSpeed)
    expect(speedForState(false, 0, false, REGRAS, 1)).toBe(REGRAS.cruiseSpeed + REGRAS.slipstreamBonus)
    expect(speedForState(false, 0, false, REGRAS, 0.5)).toBe(REGRAS.cruiseSpeed + REGRAS.slipstreamBonus / 2)
    expect(speedForState(false, 0, true, REGRAS, 1)).toBe(REGRAS.boostSpeed + REGRAS.slipstreamBonus)
  })

  it('não anula punição: na grama e na penalidade o vácuo não vale', () => {
    expect(speedForState(true, 0, false, REGRAS, 1)).toBe(speedForState(true, 0, false, REGRAS))
    expect(speedForState(false, 1, false, REGRAS, 1)).toBe(speedForState(false, 1, false, REGRAS))
  })

  it('valor fora da faixa ou inválido não quebra a velocidade', () => {
    expect(speedForState(false, 0, false, REGRAS, -5)).toBe(REGRAS.cruiseSpeed)
    expect(speedForState(false, 0, false, REGRAS, 99)).toBe(REGRAS.cruiseSpeed + REGRAS.slipstreamBonus)
    expect(speedForState(false, 0, false, REGRAS, Number.NaN)).toBe(REGRAS.cruiseSpeed)
  })

  it('rende velocidade de verdade, e uma medição corrompida não apaga a do carro', () => {
    const sem = semObstaculos(createRaceState())
    const com = semObstaculos(createRaceState())
    const quebrado = semObstaculos(createRaceState())
    for (let t = 0; t < 12; t += 1 / 60) {
      stepRace(sem, PARADO, 1 / 60)
      stepRace(com, PARADO, 1 / 60, { curvature: 0, slipstream: 1 })
      stepRace(quebrado, PARADO, 1 / 60, { curvature: 0, slipstream: Number.NaN })
    }

    expect(com.speed).toBeGreaterThan(sem.speed)
    expect(com.progress).toBeGreaterThan(sem.progress)
    expect(quebrado.slipstream).toBe(0)
    expect(quebrado.speed).toBeCloseTo(sem.speed, 6)
  })
})

describe('super curvas e tangência', () => {
  /** Uma super curva à direita: a carga do grampo no ápice. */
  const SUPER = 1.25
  /** Ganho da linha de um grampo no ápice: 1/R em unidades laterais. */
  const GANHO = 0.17

  it('por dentro o caminho é mais curto, por fora é mais longo', () => {
    // Curva à direita: o lado de dentro é o de posição positiva.
    expect(lineFactorFor(GANHO, 1)).toBeGreaterThan(1)
    expect(lineFactorFor(GANHO, -1)).toBeLessThan(1)
    expect(lineFactorFor(GANHO, 0)).toBe(1)
    // Na reta, a linha não muda nada.
    expect(lineFactorFor(0, 1.1)).toBe(1)
    // É a conta do raio: a linha a n do centro tem raio R − n.
    expect(lineFactorFor(GANHO, 1)).toBeCloseTo(1 / (1 - GANHO), 9)
    // E nunca inverte o sinal nem explode, nem com entrada absurda.
    expect(lineFactorFor(50, 1)).toBeGreaterThan(1)
    expect(lineFactorFor(50, 1)).toBeLessThanOrEqual(1.5)
    expect(lineFactorFor(Number.NaN, 1)).toBe(1)
    expect(lineFactorFor(GANHO, Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('na mesma velocidade, quem vai por dentro avança mais na pista', () => {
    const avanco = (lateral: number) => {
      const state = semObstaculos(createRaceState())
      state.speed = 160
      state.lateral = lateral
      // Carga abaixo da aderência, para o carro não escapar e a medida ser só
      // a da linha.
      stepRace(state, PARADO, 0.05, { curvature: REGRAS.cornerGrip * 0.5, slipstream: 0, lineGain: GANHO })
      return state.progress
    }
    const dentro = avanco(0.9)
    const meio = avanco(0)
    const fora = avanco(-0.9)
    expect(dentro).toBeGreaterThan(meio * 1.1)
    expect(fora).toBeLessThan(meio * 0.9)
  })

  it('por dentro a curva empurra mais: o raio é menor', () => {
    const empurrao = (lateral: number) => {
      const state = semObstaculos(createRaceState())
      state.speed = CRUZEIRO
      state.lateral = lateral
      stepRace(state, PARADO, 1 / 60, { curvature: 1, slipstream: 0, lineGain: GANHO })
      return lateral - state.lateral
    }
    // Um pouco mais, e não na proporção do caminho: é o que faz o lado de
    // dentro ser mais difícil de segurar e, ainda assim, o mais rápido.
    expect(empurrao(0.8)).toBeGreaterThan(empurrao(0) * 1.04)
    expect(empurrao(-0.8)).toBeLessThan(empurrao(0) * 0.96)
  })

  it('a linha nunca faz o carro avançar mais depressa que o teto que o servidor conhece', () => {
    // O servidor recusa chegadas mais rápidas que a pista inteira no teto do
    // nível. Por dentro de uma curva o fator passa de 1, então é o teto que
    // segura a garantia — com boost, vácuo cheio e a linha mais curta que há.
    for (const nivel of ['normal', 'dificil', 'profissional'] as const) {
      const state = semObstaculos(createRaceState(nivel))
      const teto = speedForState(false, 0, true, state.rules, 1)
      state.speed = teto
      state.lateral = 1.1
      const antes = state.progress
      stepRace(state, SO_BOOST, 0.05, { curvature: 0, slipstream: 1, lineGain: 0.3 })
      expect((state.progress - antes) / 0.05, nivel).toBeLessThanOrEqual(teto / 3.6 + 1e-9)
    }
  })

  it('a carga da super curva passa da curva comum, mas é presa no teto da física', () => {
    const deslocamento = (curvature: number) => {
      const state = semObstaculos(createRaceState())
      state.speed = CRUZEIRO
      stepRace(state, PARADO, 1 / 60, { curvature, slipstream: 0 })
      return -state.lateral
    }
    expect(deslocamento(SUPER)).toBeGreaterThan(deslocamento(1) * 1.2)
    // Acima do teto não empurra mais: é a guarda contra entrada corrompida.
    expect(deslocamento(MAX_CORNER_LOAD * 4)).toBeCloseTo(deslocamento(MAX_CORNER_LOAD), 9)
  })

  it('em cruzeiro, quem segura o volante segura a super curva', () => {
    // A regra de Top Gear: a curva mais fechada da prova se faz segurando o
    // volante. Antes ela empurrava três vezes e meia o que o volante segura, e
    // o carro ia para o muro fizesse o piloto o que fizesse.
    const state = semObstaculos(createRaceState())
    state.speed = CRUZEIRO
    for (let t = 0; t < 1.5; t += 1 / 60) stepRace(state, DIREITA, 1 / 60, { curvature: SUPER, slipstream: 0 })
    expect(state.lateral).toBeGreaterThanOrEqual(0)
    // E cobra pouco de quem a faz: a curva é rápida.
    expect(state.speed).toBeGreaterThan(CRUZEIRO * 0.85)
  })

  it('sem ninguém no volante, a super curva leva o carro para fora', () => {
    const state = semObstaculos(createRaceState())
    state.speed = CRUZEIRO
    for (let t = 0; t < 0.8; t += 1 / 60) stepRace(state, PARADO, 1 / 60, { curvature: SUPER, slipstream: 0 })
    expect(state.lateral).toBeLessThan(-1)
  })

  it('de boost, a super curva leva o carro para fora mesmo com o volante todo virado', () => {
    // É a lição do nitro: a curva se faz segurando o volante, não acelerando.
    const state = semObstaculos(createRaceState())
    state.speed = REGRAS.boostSpeed
    const deBoost = { left: false, right: true, boost: true }
    for (let t = 0; t < 0.8; t += 1 / 60) stepRace(state, deBoost, 1 / 60, { curvature: SUPER, slipstream: 0 })
    expect(state.lateral).toBeLessThan(-0.4)
  })

  it('o boost aumenta a carga da curva: a traseira escapa', () => {
    const empurrao = (boost: boolean) => {
      const state = semObstaculos(createRaceState())
      state.speed = REGRAS.boostSpeed
      stepRace(state, { left: false, right: false, boost }, 0.1, { curvature: 1, slipstream: 0 })
      return -state.lateral
    }
    expect(BOOST_IN_CORNER).toBeGreaterThan(1)
    expect(empurrao(true)).toBeGreaterThan(empurrao(false) * 1.2)
  })

  it('a tangência devolve boost, uma vez por curva, só por dentro e no asfalto', () => {
    const zebra = (apexId: number): RaceContext => ({ curvature: 0, slipstream: 0, apexId, apexSide: 1 })
    const state = semObstaculos(createRaceState())
    state.speed = CRUZEIRO
    state.boost = 40
    state.lateral = APEX_LATERAL + 0.1
    const eventos = stepRace(state, PARADO, 1 / 60, zebra(1))
    expect(eventos).toContainEqual({ type: 'apex', curveId: 1, boost: APEX_BOOST, sequencia: 1 })
    expect(state.boost).toBeCloseTo(40 + APEX_BOOST, 0)

    // A mesma curva não paga duas vezes.
    const deNovo = stepRace(state, PARADO, 1 / 60, zebra(1))
    expect(deNovo.some((evento) => evento.type === 'apex')).toBe(false)

    // Pelo lado de fora não conta.
    const porFora = semObstaculos(createRaceState())
    porFora.lateral = -0.9
    expect(stepRace(porFora, PARADO, 1 / 60, zebra(2)).some((evento) => evento.type === 'apex')).toBe(false)

    // Nem no meio da pista: a tangência é uma escolha, não um acaso.
    const noMeio = semObstaculos(createRaceState())
    noMeio.lateral = APEX_LATERAL * 0.5
    expect(stepRace(noMeio, PARADO, 1 / 60, zebra(3)).some((evento) => evento.type === 'apex')).toBe(false)

    // Nem com as rodas na grama.
    const naGrama = semObstaculos(createRaceState())
    naGrama.lateral = LATERAL_LIMIT - 0.01
    expect(stepRace(naGrama, PARADO, 1 / 60, zebra(4)).some((evento) => evento.type === 'apex')).toBe(false)
  })

  it('o leitor da pista é chamado a cada passo fixo, no ponto do carro', () => {
    const lidos: number[] = []
    const context: RaceContext = {
      curvature: 0,
      slipstream: 0,
      sample: (progress, out) => {
        lidos.push(progress)
        out.curvature = 0
      },
    }
    const state = semObstaculos(createRaceState())
    state.speed = CRUZEIRO
    stepRace(state, PARADO, 0.05, context)
    // 0,05 s em passos de 1/120 s são seis passos.
    expect(lidos).toHaveLength(6)
    for (let i = 1; i < lidos.length; i += 1) expect(lidos[i]).toBeGreaterThan(lidos[i - 1])
  })

  it('a super curva vale o mesmo em 60, 30 e 20 quadros por segundo', () => {
    // Uma super curva sintética de 90 m: a carga sobe e desce com a distância.
    // Relida a cada passo fixo, ela chega na mesma hora para os três.
    const curva = (progress: number, out: RaceContext) => {
      const t = (progress - 60) / 90
      const dentro = t > 0 && t < 1
      out.curvature = dentro ? SUPER * 4 * t * (1 - t) : 0
      out.lineGain = dentro ? GANHO * 4 * t * (1 - t) : 0
      out.apexId = t > 0.08 && t < 0.4 ? 1 : 0
      out.apexSide = out.apexId ? 1 : 0
    }
    const final = (dt: number) => {
      const state = semObstaculos(createRaceState())
      state.speed = CRUZEIRO
      state.lateral = 0.99
      const context: RaceContext = { curvature: 0, slipstream: 0, sample: curva }
      // Passos inteiros de cada taxa, somando exatamente quatro segundos.
      const passos = Math.round(4 / dt)
      for (let i = 0; i < passos; i += 1) stepRace(state, DIREITA, dt, context)
      return state
    }
    const rapido = final(1 / 60)
    const medio = final(1 / 30)
    const lento = final(1 / 20)
    for (const outro of [medio, lento]) {
      expect(outro.progress).toBeCloseTo(rapido.progress, 6)
      expect(outro.lateral).toBeCloseTo(rapido.lateral, 6)
      expect(outro.speed).toBeCloseTo(rapido.speed, 6)
      expect(outro.apexes.size).toBe(rapido.apexes.size)
    }
    expect(rapido.apexes.size).toBe(1)
  })
})

describe('muro da super curva', () => {
  /** Uma super curva à direita, com o muro por fora — do lado esquerdo. */
  const COM_MURO: RaceContext = { curvature: 2.4, slipstream: 0, wallId: 7, wallSide: -1 }

  /** Carro embalado, sem ninguém no volante, jogado contra o muro. */
  function contraOMuro(segundos: number, context: RaceContext = COM_MURO) {
    const state = semObstaculos(createRaceState())
    state.speed = REGRAS.boostSpeed
    const eventos: RaceEvent[] = []
    for (let t = 0; t < segundos; t += 1 / 60) eventos.push(...stepRace(state, PARADO, 1 / 60, context))
    return { state, eventos }
  }

  it('segura o carro antes do limite físico da grama', () => {
    const { state } = contraOMuro(1)
    expect(WALL_LIMIT).toBeLessThan(LATERAL_LIMIT)
    expect(state.lateral).toBeGreaterThanOrEqual(-WALL_LIMIT - 1e-9)
    expect(state.lateral).toBeCloseTo(-WALL_LIMIT, 6)
  })

  it('a primeira encostada é batida: conta para o reset e derruba a velocidade', () => {
    const state = semObstaculos(createRaceState())
    state.speed = REGRAS.boostSpeed
    state.lateral = -WALL_LIMIT + 0.01
    const antes = state.speed
    const eventos = stepRace(state, PARADO, 1 / 60, COM_MURO)
    expect(eventos).toContainEqual({ type: 'wall', curveId: 7 })
    expect(state.strikes).toBe(1)
    expect(state.collisions).toBe(1)
    expect(state.speed).toBeLessThan(antes * WALL_IMPACT_KEEP + 1)
    expect(state.penalty).toBeGreaterThan(0)
  })

  it('raspar no muro não conta outra batida, mas continua cobrando velocidade', () => {
    const { state, eventos } = contraOMuro(1.2)
    expect(eventos.filter((evento) => evento.type === 'wall')).toHaveLength(1)
    expect(state.strikes).toBe(1)
    // Encostado, o carro raspa: termina mais lento que o mesmo carro na grama
    // sem muro, que só perde o que a grama tira.
    const semMuro = contraOMuro(1.2, { curvature: 2.4, slipstream: 0 })
    expect(state.speed).toBeLessThan(semMuro.state.speed)
  })

  it('outra super curva é outro muro: a batida conta de novo', () => {
    const state = semObstaculos(createRaceState())
    state.speed = REGRAS.boostSpeed
    state.lateral = -WALL_LIMIT
    stepRace(state, PARADO, 1 / 60, COM_MURO)
    state.lateral = -WALL_LIMIT
    stepRace(state, PARADO, 1 / 60, { ...COM_MURO, wallId: 8 })
    expect(state.strikes).toBe(2)
  })

  it('a terceira batida, no muro, reseta o carro', () => {
    const state = semObstaculos(createRaceState())
    state.speed = REGRAS.boostSpeed
    state.strikes = 2
    state.lateral = -WALL_LIMIT
    const eventos = stepRace(state, PARADO, 1 / 60, COM_MURO)
    expect(eventos).toContainEqual({ type: 'reset', reason: 'crashes' })
    expect(state.resetting).toBeGreaterThan(0)
    expect(state.lateral).toBe(0)
  })

  it('o muro só existe do lado de fora: por dentro, o carro vai até a grama', () => {
    const state = semObstaculos(createRaceState())
    state.lateral = WALL_LIMIT + 0.05
    const eventos = stepRace(state, PARADO, 1 / 60, { curvature: 0, slipstream: 0, wallId: 7, wallSide: -1 })
    expect(eventos.some((evento) => evento.type === 'wall')).toBe(false)
    expect(state.lateral).toBeGreaterThan(WALL_LIMIT)
  })
})
