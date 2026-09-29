import { describe, expect, it } from 'vitest'
import { AFOGADO_SECONDS } from './largada'
import { rulesFor } from './rules'
import {
  APEX_BOOST,
  APEX_COMBO_STEP,
  APEX_LATERAL,
  CARGA_CURVA_MIN,
  CARGA_NIVEIS,
  createRaceState,
  IMPULSO_POR_NIVEL,
  nivelDaCarga,
  OFF_ROAD_LIMIT,
  RASPAO_BOOST,
  RASPAO_FOLGA,
  speedForState,
  stepRace,
  type RaceContext,
  type RaceEvent,
  type RaceInput,
  type RaceState,
} from './simulation'
import { HIT_HALF_WIDTH, obstacles, WALL_LIMIT, type Obstacle } from './track'

const REGRAS = rulesFor('normal')
const CRUZEIRO = speedForState(false, 0, false, REGRAS)

const PARADO: RaceInput = { left: false, right: false, boost: false }
const SO_BOOST: RaceInput = { left: false, right: false, boost: true }
const DIREITA: RaceInput = { left: false, right: true, boost: false }
const DIREITA_COM_BOOST: RaceInput = { left: false, right: true, boost: true }

/**
 * Uma curva à direita que empurra mais do que o pneu segura.
 *
 * Em cruzeiro, com o volante todo para dentro, o carro ainda avança um pouco
 * para o lado de dentro: é a situação de quem segura uma super curva pela
 * linha de dentro, e é nela que a carga sobe na taxa cheia.
 */
const CURVA: RaceContext = { curvature: 1.2, slipstream: 0 }
const RETA: RaceContext = { curvature: 0, slipstream: 0 }

/** Carro na curva, pela metade de dentro, com o volante já virado para dentro. */
function naCurva(lateral = 0.5) {
  const state = createRaceState()
  for (const obstacle of obstacles) state.hitObstacles.add(obstacle.id)
  state.speed = CRUZEIRO
  state.lateral = lateral
  state.steerInput = 1
  state.steerSide = 1
  return state
}

function avancar(state: RaceState, input: RaceInput, segundos: number, context: RaceContext, dt = 1 / 60) {
  const eventos: RaceEvent[] = []
  for (let t = 0; t < segundos - 1e-9; t += dt) eventos.push(...stepRace(state, input, dt, context))
  return eventos
}

const disparos = (eventos: RaceEvent[]) =>
  eventos.flatMap((evento) => (evento.type === 'miniTurbo' ? [evento.nivel] : []))

describe('mini-turbo de curva', () => {
  it('os níveis crescem com a carga, e o terceiro pede o triplo do primeiro', () => {
    expect(nivelDaCarga(0)).toBe(0)
    expect(nivelDaCarga(CARGA_NIVEIS[0])).toBe(1)
    expect(nivelDaCarga(CARGA_NIVEIS[1])).toBe(2)
    expect(nivelDaCarga(CARGA_NIVEIS[2] + 5)).toBe(3)
    expect(CARGA_NIVEIS[2]).toBeCloseTo(CARGA_NIVEIS[0] * 3, 9)
    // O prêmio cresce mais depressa que o custo, como no Mario Kart.
    expect(IMPULSO_POR_NIVEL[3] / IMPULSO_POR_NIVEL[1]).toBeGreaterThan(CARGA_NIVEIS[2] / CARGA_NIVEIS[0])
  })

  it('mirando a curva pela linha de dentro, sobe um nível a cada limiar', () => {
    const state = naCurva()
    const eventos = avancar(state, DIREITA, CARGA_NIVEIS[2] + 0.05, CURVA)
    const niveis = eventos.flatMap((evento) => (evento.type === 'carga' ? [evento.nivel] : []))
    expect(niveis).toEqual([1, 2, 3])
    expect(state.nivelCarga).toBe(3)
    // Segurando, não dispara.
    expect(disparos(eventos)).toEqual([])
  })

  it('pela metade de fora a carga sobe bem mais devagar', () => {
    const dentro = naCurva(0.5)
    const fora = naCurva(-0.5)
    avancar(dentro, DIREITA, 0.5, CURVA)
    avancar(fora, DIREITA, 0.5, CURVA)
    expect(dentro.carga).toBeGreaterThan(fora.carga * 2)
    expect(fora.nivelCarga).toBe(0)
  })

  it('não carrega em reta nem em curva leve: não existe snaking', () => {
    const reta = naCurva()
    avancar(reta, DIREITA, 1, RETA)
    expect(reta.carga).toBe(0)

    const leve = naCurva()
    avancar(leve, DIREITA, 1, { curvature: CARGA_CURVA_MIN * 0.8, slipstream: 0 })
    expect(leve.carga).toBe(0)
  })

  it('o volante apontado para fora não carrega', () => {
    const state = naCurva()
    state.steerInput = -1
    state.steerSide = -1
    avancar(state, { left: true, right: false, boost: false }, 0.6, CURVA)
    expect(state.carga).toBe(0)
  })

  it('endireitar dispara o nível que a carga alcançou', () => {
    const state = naCurva()
    avancar(state, DIREITA, CARGA_NIVEIS[1] + 0.05, CURVA)
    expect(state.nivelCarga).toBe(2)
    const eventos = avancar(state, PARADO, 0.4, CURVA)
    expect(disparos(eventos)).toEqual([2])
    expect(state.carga).toBe(0)
    expect(state.impulso).toBeGreaterThan(IMPULSO_POR_NIVEL[2] - 0.4)
  })

  it('carga abaixo do primeiro nível se desfaz sem turbo', () => {
    const state = naCurva()
    avancar(state, DIREITA, CARGA_NIVEIS[0] * 0.5, CURVA)
    const eventos = avancar(state, PARADO, 0.4, CURVA)
    expect(disparos(eventos)).toEqual([])
    expect(state.impulso).toBe(0)
  })

  it('apertar o boost com a carga guardada a solta na hora', () => {
    const state = naCurva()
    avancar(state, DIREITA, CARGA_NIVEIS[0] + 0.05, CURVA)
    const eventos = stepRace(state, DIREITA_COM_BOOST, 1 / 60, CURVA)
    expect(disparos(eventos)).toEqual([1])
  })

  it('de boost não se carrega: na curva, ou o nitro, ou a carga', () => {
    const state = naCurva()
    avancar(state, DIREITA_COM_BOOST, 1, CURVA)
    expect(state.carga).toBe(0)
  })

  it('a grama e a batida jogam a carga fora, sem turbo', () => {
    const naGrama = naCurva()
    avancar(naGrama, DIREITA, CARGA_NIVEIS[1] + 0.05, CURVA)
    naGrama.lateral = OFF_ROAD_LIMIT + 0.05
    const eventos = stepRace(naGrama, DIREITA, 1 / 60, CURVA)
    expect(disparos(eventos)).toEqual([])
    expect(naGrama.carga).toBe(0)
    expect(naGrama.nivelCarga).toBe(0)

    const batido = naCurva()
    avancar(batido, DIREITA, CARGA_NIVEIS[1] + 0.05, CURVA)
    batido.penalty = REGRAS.penaltySeconds
    stepRace(batido, DIREITA, 1 / 60, CURVA)
    expect(batido.carga).toBe(0)
  })

  it('é igual em 60, 30 e 20 quadros por segundo', () => {
    const cenario = (dt: number) => {
      const state = naCurva()
      const eventos = [...avancar(state, DIREITA, 1, CURVA, dt), ...avancar(state, PARADO, 1.2, CURVA, dt)]
      return { niveis: disparos(eventos), progresso: state.progress, velocidade: state.speed }
    }
    const referencia = cenario(1 / 60)
    expect(referencia.niveis).toEqual([2])
    for (const dt of [1 / 30, 1 / 20]) {
      const outro = cenario(dt)
      expect(outro.niveis).toEqual(referencia.niveis)
      expect(Math.abs(outro.progresso - referencia.progresso)).toBeLessThan(0.5)
      expect(Math.abs(outro.velocidade - referencia.velocidade)).toBeLessThan(1)
    }
  })
})

describe('impulso', () => {
  it('leva o carro à velocidade do boost sem gastar a barra', () => {
    const state = naCurva(0)
    state.boost = 50
    state.impulso = 2
    avancar(state, PARADO, 1.8, RETA)
    expect(state.speed).toBeGreaterThan(CRUZEIRO + (REGRAS.boostSpeed - CRUZEIRO) * 0.6)
    expect(state.boost).toBeGreaterThanOrEqual(50)
  })

  it('com o boost apertado durante o impulso, a barra espera a vez dela', () => {
    const state = naCurva(0)
    state.boost = 50
    state.impulso = 1
    avancar(state, SO_BOOST, 0.9, RETA)
    expect(state.boosting).toBe(false)
    expect(state.boost).toBeGreaterThanOrEqual(50)
    // Acabado o impulso, o boost segurado assume e a barra passa a drenar.
    const noFimDoImpulso = state.boost
    avancar(state, SO_BOOST, 0.3, RETA)
    expect(state.boosting).toBe(true)
    expect(state.boost).toBeLessThan(noFimDoImpulso)
  })

  it('nunca passa do teto do nível, nem com boost e vácuo juntos', () => {
    const teto = speedForState(false, 0, true, REGRAS, 1)
    const state = naCurva(0)
    state.impulso = 5
    state.boost = 100
    let maior = 0
    for (let t = 0; t < 5; t += 1 / 60) {
      stepRace(state, SO_BOOST, 1 / 60, { curvature: 0, slipstream: 1 })
      maior = Math.max(maior, state.speed)
    }
    expect(maior).toBeLessThanOrEqual(teto + 1e-9)
  })

  it('some na grama e na batida', () => {
    const state = naCurva(0)
    state.impulso = 2
    state.lateral = OFF_ROAD_LIMIT + 0.05
    stepRace(state, PARADO, 1 / 60, RETA)
    expect(state.impulso).toBe(0)
  })
})

describe('combo de tangência', () => {
  const zebra = (apexId: number): RaceContext => ({ curvature: 0, slipstream: 0, apexId, apexSide: 1 })
  const tangenciar = (state: RaceState, apexId: number) => {
    state.lateral = APEX_LATERAL + 0.1
    const antes = state.boost
    stepRace(state, PARADO, 1 / 60, zebra(apexId))
    // Sai da zebra, para a próxima ser outra passagem.
    stepRace(state, PARADO, 1 / 60, RETA)
    return state.boost - antes
  }

  it('tangências seguidas devolvem 22, 27 e 32, e param de crescer aí', () => {
    const state = naCurva(0)
    state.boost = 0
    const devolvidos = [1, 2, 3, 4].map((id) => {
      const antes = state.boost
      state.boost = 0
      const ganho = tangenciar(state, id)
      state.boost = antes
      return ganho
    })
    expect(devolvidos[0]).toBeCloseTo(APEX_BOOST, 0)
    expect(devolvidos[1]).toBeCloseTo(APEX_BOOST + APEX_COMBO_STEP, 0)
    expect(devolvidos[2]).toBeCloseTo(APEX_BOOST + APEX_COMBO_STEP * 2, 0)
    expect(devolvidos[3]).toBeCloseTo(APEX_BOOST + APEX_COMBO_STEP * 2, 0)
  })

  it('uma zebra perdida quebra a sequência', () => {
    const state = naCurva(0)
    tangenciar(state, 1)
    tangenciar(state, 2)
    expect(state.sequencia).toBe(2)
    // Passa pela zebra 3 pelo meio da pista e sai dela sem tangência.
    state.lateral = 0
    stepRace(state, PARADO, 1 / 60, zebra(3))
    stepRace(state, PARADO, 1 / 60, RETA)
    expect(state.sequencia).toBe(0)
    state.boost = 0
    expect(tangenciar(state, 4)).toBeCloseTo(APEX_BOOST, 0)
  })

  it('o muro quebra a sequência', () => {
    const state = naCurva(0)
    tangenciar(state, 1)
    tangenciar(state, 2)
    expect(state.sequencia).toBe(2)
    // O volante solto, para o carro ficar colado no muro de fora.
    state.lateral = -WALL_LIMIT
    state.steerInput = 0
    stepRace(state, PARADO, 1 / 60, { curvature: 0, slipstream: 0, wallId: 9, wallSide: -1 })
    expect(state.sequencia).toBe(0)
  })
})

describe('raspão', () => {
  /** Carro a dez metros de um obstáculo só, numa reta. */
  const diante = (obstaculo: Omit<Obstacle, 'id' | 'distance'>, lateral: number) => {
    const state = createRaceState()
    state.rules = { ...REGRAS, obstacles: [{ id: 99, distance: 20, ...obstaculo }] }
    state.progress = 10
    state.speed = CRUZEIRO
    state.lateral = lateral
    state.boost = 50
    return state
  }

  it('passar rente a uma barreira, sem tocar, devolve um pouco de boost', () => {
    const state = diante({ lane: 0, kind: 'barrier' }, HIT_HALF_WIDTH.barrier + RASPAO_FOLGA / 2)
    const eventos = avancar(state, PARADO, 0.5, RETA)
    expect(eventos).toContainEqual({ type: 'raspao', obstacleId: 99 })
    expect(eventos.some((evento) => evento.type === 'collision')).toBe(false)
    expect(eventos.filter((evento) => evento.type === 'raspao')).toHaveLength(1)
    expect(state.boost).toBeGreaterThan(50 + RASPAO_BOOST * 0.9)
  })

  it('passar longe não é raspão', () => {
    const state = diante({ lane: 0, kind: 'barrier' }, HIT_HALF_WIDTH.barrier + RASPAO_FOLGA + 0.1)
    expect(avancar(state, PARADO, 0.5, RETA).some((evento) => evento.type === 'raspao')).toBe(false)
  })

  it('bater não é raspão', () => {
    const state = diante({ lane: 0, kind: 'barrier' }, 0)
    const eventos = avancar(state, PARADO, 0.5, RETA)
    expect(eventos.some((evento) => evento.type === 'collision')).toBe(true)
    expect(eventos.some((evento) => evento.type === 'raspao')).toBe(false)
  })

  it('passar rente a uma poça não é risco nenhum', () => {
    const state = diante({ lane: 0, kind: 'poca' }, HIT_HALF_WIDTH.poca + RASPAO_FOLGA / 2)
    expect(avancar(state, PARADO, 0.5, RETA).some((evento) => evento.type === 'raspao')).toBe(false)
  })
})

describe('motor afogado', () => {
  it('segura o carro na linha pelo tempo da largada queimada, e depois solta', () => {
    const state = createRaceState()
    state.afogado = AFOGADO_SECONDS
    avancar(state, SO_BOOST, AFOGADO_SECONDS - 0.05, RETA)
    expect(state.speed).toBe(0)
    expect(state.progress).toBe(0)
    avancar(state, SO_BOOST, 0.3, RETA)
    expect(state.speed).toBeGreaterThan(0)
  })
})
