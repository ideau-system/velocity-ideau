import { describe, expect, it } from 'vitest'
import { correrSemTela } from './corridaSimulada'
import { pilotoCompleto } from './piloto'
import { DIFFICULTIES, rulesFor } from './rules'
import {
  advanceRace,
  ALCANCE_DAS_MARCHAS,
  createRaceState,
  forcaDaMarcha,
  GIRO_CHEIO,
  IMPULSO_DA_TROCA,
  IMPULSO_DA_TROCA_MAXIMO,
  motorForte,
  NUMERO_DE_MARCHAS,
  QUEDAS_DO_CAMBIO,
  speedForState,
  stepRace,
  TOLERANCIA_DO_CORTE,
  velocidadeDaMarcha,
  type RaceEvent,
  type RaceInput,
  type RaceState,
} from './simulation'
import { obstacles } from './track'

const QUADRO = 1 / 60
const RETA: RaceInput = { left: false, right: false, boost: false }
const MANUAL: RaceInput = { ...RETA, manual: true, throttle: true }

/** Sem obstáculos: os testes de câmbio medem a curva de velocidade, e só ela. */
function limpo(state = createRaceState()) {
  for (const obstacle of obstacles) state.hitObstacles.add(obstacle.id)
  for (const obstacle of state.rules.obstacles) state.hitObstacles.add(obstacle.id)
  return state
}

type Politica = (state: RaceState) => RaceInput

/** Anda em linha reta até `alvo` km/h, ou até o limite de tempo, com uma política de pedal e câmbio. */
function arrancar(alvo: number, politica: Politica, limite = 20) {
  const state = limpo()
  const eventos: RaceEvent[] = []
  let tempo = 0
  while (tempo < limite && state.speed < alvo) {
    eventos.push(...stepRace(state, politica(state), QUADRO))
    tempo += QUADRO
  }
  return { tempo, state, trocas: eventos.filter((e) => e.type === 'troca') }
}

/** Troca na janela: o piloto que acerta todas. */
const perfeito: Politica = (state) => ({ ...MANUAL, shiftUp: state.janelaDeTroca })
/** Só troca depois de bater no corte e ficar lá. */
const atrasado: Politica = (state) => ({ ...MANUAL, shiftUp: state.noCorte > 0.3 })
/** Troca com o motor ainda em meio giro. */
const adiantado: Politica = (state) => ({ ...MANUAL, shiftUp: state.giro > GIRO_CHEIO })

describe('marchas', () => {
  it('sete marchas, cada uma mais longa, a última no teto do nível', () => {
    expect(ALCANCE_DAS_MARCHAS).toHaveLength(NUMERO_DE_MARCHAS)
    expect(QUEDAS_DO_CAMBIO).toHaveLength(NUMERO_DE_MARCHAS - 1)
    expect(ALCANCE_DAS_MARCHAS.at(-1)).toBe(1)
    for (let i = 1; i < NUMERO_DE_MARCHAS; i += 1) {
      expect(ALCANCE_DAS_MARCHAS[i - 1] / ALCANCE_DAS_MARCHAS[i]).toBeCloseTo(QUEDAS_DO_CAMBIO[i - 1], 9)
    }
    for (const nivel of DIFFICULTIES) {
      const regras = rulesFor(nivel)
      expect(velocidadeDaMarcha(regras, NUMERO_DE_MARCHAS - 1)).toBeCloseTo(speedForState(false, 0, true, regras, 1), 9)
    }
  })

  it('o cruzeiro cai na quinta, perto do corte; o boost, na sétima', () => {
    for (const nivel of DIFFICULTIES) {
      const regras = rulesFor(nivel)
      const quinta = velocidadeDaMarcha(regras, 4)
      expect(regras.cruiseSpeed, nivel).toBeGreaterThan(velocidadeDaMarcha(regras, 3))
      expect(regras.cruiseSpeed / quinta, nivel).toBeGreaterThan(0.9)
      expect(regras.cruiseSpeed / quinta, nivel).toBeLessThan(0.975)
      expect(regras.boostSpeed, nivel).toBeGreaterThan(velocidadeDaMarcha(regras, 5))
    }
  })

  it('uma marcha fora da faixa vira a mais próxima, e um valor inválido, a primeira', () => {
    const regras = rulesFor('normal')
    expect(velocidadeDaMarcha(regras, 99)).toBe(velocidadeDaMarcha(regras, NUMERO_DE_MARCHAS - 1))
    expect(velocidadeDaMarcha(regras, -3)).toBe(velocidadeDaMarcha(regras, 0))
    expect(velocidadeDaMarcha(regras, Number.NaN)).toBe(velocidadeDaMarcha(regras, 0))
  })

  it('a força cheia vai da faixa ao corte; abaixo dela, cai sem nunca zerar; a primeira sempre puxa', () => {
    expect(forcaDaMarcha(3, GIRO_CHEIO)).toBe(1)
    expect(forcaDaMarcha(3, 1)).toBe(1)
    expect(forcaDaMarcha(3, GIRO_CHEIO * 0.8)).toBeLessThan(1)
    expect(forcaDaMarcha(3, GIRO_CHEIO * 0.4)).toBeLessThan(forcaDaMarcha(3, GIRO_CHEIO * 0.8))
    expect(forcaDaMarcha(6, 0)).toBeGreaterThan(0.3)
    expect(forcaDaMarcha(0, 0)).toBe(1)
  })
})

describe('câmbio automático', () => {
  it('sem pedal informado, o carro acelera sozinho e o câmbio sobe até a quinta', () => {
    const { state, trocas } = arrancar(245, () => RETA)
    expect(state.speed).toBeGreaterThanOrEqual(245)
    expect(state.marcha).toBe(4)
    expect(trocas.map((troca) => troca.type === 'troca' && `${troca.de}>${troca.para}`)).toEqual(['0>1', '1>2', '2>3', '3>4'])
    for (const troca of trocas) expect(troca).toMatchObject({ qualidade: 'automatica' })
  })

  it('nunca bate no corte, e nunca abre a janela da troca perfeita', () => {
    const state = limpo()
    let maior = 0
    for (let t = 0; t < 12; t += QUADRO) {
      stepRace(state, { ...RETA, boost: t > 6 }, QUADRO)
      expect(state.noCorte).toBe(0)
      expect(state.janelaDeTroca).toBe(false)
      expect(state.giro).toBeLessThan(0.99)
      maior = Math.max(maior, state.marcha)
    }
    // O boost leva à sétima.
    expect(maior).toBe(NUMERO_DE_MARCHAS - 1)
  })

  it('reduz quando o carro perde velocidade, e sobe de novo quando ela volta', () => {
    const state = limpo()
    for (let t = 0; t < 8; t += QUADRO) stepRace(state, RETA, QUADRO)
    expect(state.marcha).toBe(4)
    for (let t = 0; t < 1.5; t += QUADRO) stepRace(state, { ...RETA, brake: true }, QUADRO)
    expect(state.speed).toBeLessThan(110)
    expect(state.marcha).toBeLessThanOrEqual(1)
    for (let t = 0; t < 6; t += QUADRO) stepRace(state, RETA, QUADRO)
    expect(state.marcha).toBe(4)
  })

  it('as borboletas não mexem no automático', () => {
    const state = limpo()
    for (let t = 0; t < 1; t += QUADRO) stepRace(state, RETA, QUADRO)
    const marcha = state.marcha
    stepRace(state, { ...RETA, shiftUp: true }, QUADRO)
    stepRace(state, { ...RETA, shiftUp: true }, QUADRO)
    expect(state.marcha).toBe(marcha)
  })
})

describe('acelerador e freio', () => {
  it('sem o pé no acelerador o carro não sai do lugar', () => {
    const state = limpo()
    for (let t = 0; t < 3; t += QUADRO) stepRace(state, { ...RETA, throttle: false }, QUADRO)
    expect(state.speed).toBe(0)
    expect(state.progress).toBe(0)
  })

  it('o boost também acelera, mesmo sem o pedal', () => {
    const state = limpo()
    for (let t = 0; t < 1; t += QUADRO) stepRace(state, { ...RETA, throttle: false, boost: true }, QUADRO)
    expect(state.speed).toBeGreaterThan(40)
  })

  it('tirar o pé desacelera aos poucos: arrasto, não freio', () => {
    const state = limpo()
    for (let t = 0; t < 12; t += QUADRO) stepRace(state, RETA, QUADRO)
    const antes = state.speed
    for (let t = 0; t < 1; t += QUADRO) stepRace(state, { ...RETA, throttle: false }, QUADRO)
    const perda = antes - state.speed
    expect(perda).toBeGreaterThan(15)
    expect(perda).toBeLessThan(30)
  })

  it('o freio é o comando mais forte do carro, e para o carro sem passar do zero', () => {
    const state = limpo()
    for (let t = 0; t < 12; t += QUADRO) stepRace(state, RETA, QUADRO)
    const antes = state.speed
    for (let t = 0; t < 1; t += QUADRO) stepRace(state, { ...RETA, brake: true }, QUADRO)
    expect(antes - state.speed).toBeGreaterThan(100)
    for (let t = 0; t < 4; t += QUADRO) stepRace(state, { ...RETA, brake: true }, QUADRO)
    expect(state.speed).toBe(0)
  })

  it('o freio vence o acelerador e o boost, e frear não gasta a barra', () => {
    const state = limpo()
    for (let t = 0; t < 12; t += QUADRO) stepRace(state, RETA, QUADRO)
    const antes = state.speed
    const barra = state.boost
    stepRace(state, { ...RETA, throttle: true, boost: true, brake: true }, QUADRO)
    expect(state.speed).toBeLessThan(antes)
    expect(state.boosting).toBe(false)
    expect(state.boost).toBeGreaterThanOrEqual(barra)
    expect(state.freando).toBe(true)
    expect(state.acelerando).toBe(false)
  })

  it('frear diminui a força da curva: entra-se no grampo por dentro sem ir para o muro', () => {
    // A carga cresce com o quadrado da velocidade: a 70% do cruzeiro, a curva
    // empurra menos da metade.
    const curva = { curvature: 0.8, slipstream: 0 }
    const embalado = limpo()
    const freado = limpo()
    for (const state of [embalado, freado]) for (let t = 0; t < 12; t += QUADRO) stepRace(state, RETA, QUADRO)
    for (let t = 0; t < 0.6; t += QUADRO) stepRace(freado, { ...RETA, brake: true }, QUADRO)
    stepRace(embalado, RETA, QUADRO, curva)
    stepRace(freado, { ...RETA, throttle: false }, QUADRO, curva)
    expect(freado.cornerLoad).toBeLessThan(embalado.cornerLoad * 0.7)
  })

  it('o impulso com o pé fora é jogado fora: não empurra nem acende a chama', () => {
    const state = limpo()
    for (let t = 0; t < 12; t += QUADRO) stepRace(state, RETA, QUADRO)
    state.impulso = 1
    const antes = state.speed
    stepRace(state, { ...RETA, throttle: false }, QUADRO)
    expect(motorForte(state)).toBe(false)
    expect(state.speed).toBeLessThan(antes)
    expect(state.impulso).toBeLessThan(1)
  })
})

describe('câmbio manual', () => {
  it('sem trocar, o carro fica preso no corte da primeira', () => {
    const { state } = arrancar(200, () => MANUAL, 6)
    expect(state.marcha).toBe(0)
    expect(state.speed).toBeCloseTo(velocidadeDaMarcha(state.rules, 0), 0)
    expect(state.giro).toBe(1)
    expect(state.noCorte).toBeGreaterThan(4)
  })

  it('subir na janela é troca perfeita, e cada uma paga um impulso', () => {
    const { trocas, state } = arrancar(245, perfeito)
    expect(trocas).toHaveLength(4)
    trocas.forEach((troca, i) => expect(troca).toMatchObject({ qualidade: 'perfeita', sequencia: i + 1 }))
    expect(state.marcha).toBe(4)
  })

  it('a troca perfeita acende o turbo na hora, sem gastar a barra', () => {
    const state = limpo()
    while (!state.janelaDeTroca) stepRace(state, MANUAL, QUADRO)
    const eventos = stepRace(state, { ...MANUAL, shiftUp: true }, QUADRO)
    expect(eventos).toContainEqual({ type: 'troca', de: 0, para: 1, qualidade: 'perfeita', sequencia: 1 })
    expect(state.impulso).toBeGreaterThan(IMPULSO_DA_TROCA - 0.05)
    expect(motorForte(state)).toBe(true)
    expect(state.boost).toBe(100)
  })

  it('as trocas perfeitas seguidas acumulam turbo, até um teto', () => {
    const state = limpo()
    state.impulso = IMPULSO_DA_TROCA_MAXIMO - 0.1
    while (!state.janelaDeTroca) stepRace(state, MANUAL, QUADRO)
    const antes = state.impulso
    stepRace(state, { ...MANUAL, shiftUp: true }, QUADRO)
    expect(state.impulso).toBeLessThanOrEqual(IMPULSO_DA_TROCA_MAXIMO)
    expect(state.impulso).toBeGreaterThanOrEqual(antes - 0.05)
  })

  it('quem acerta as trocas chega ao cruzeiro bem antes do automático', () => {
    const automatico = arrancar(245, () => RETA)
    const certo = arrancar(245, perfeito)
    expect(certo.tempo).toBeLessThan(automatico.tempo - 1)
  })

  it('trocar tarde custa: o carro fica parado no corte', () => {
    const automatico = arrancar(245, () => RETA)
    const tarde = arrancar(245, atrasado)
    expect(tarde.tempo).toBeGreaterThan(automatico.tempo + 0.8)
    for (const troca of tarde.trocas) expect(troca).toMatchObject({ qualidade: 'tarde' })
  })

  it('trocar cedo custa: o motor cai abaixo da faixa e se arrasta', () => {
    const automatico = arrancar(245, () => RETA)
    const cedo = arrancar(245, adiantado)
    expect(cedo.tempo).toBeGreaterThan(automatico.tempo + 0.2)
    expect(cedo.trocas[0]).toMatchObject({ qualidade: 'cedo' })
  })

  it('a troca fora da janela quebra a sequência', () => {
    const state = limpo()
    while (!state.janelaDeTroca) stepRace(state, MANUAL, QUADRO)
    stepRace(state, { ...MANUAL, shiftUp: true }, QUADRO)
    expect(state.trocasPerfeitas).toBe(1)
    stepRace(state, { ...MANUAL, shiftUp: true }, QUADRO)
    expect(state.trocasPerfeitas).toBe(0)
  })

  it('a janela abre um instante antes do corte e fecha pouco depois de bater nele', () => {
    const state = limpo()
    let abriu = -1
    let bateu = -1
    let fechou = -1
    for (let t = 0; t < 4 && fechou < 0; t += QUADRO) {
      stepRace(state, MANUAL, QUADRO)
      if (state.janelaDeTroca && abriu < 0) abriu = t
      if (state.noCorte > 0 && bateu < 0) bateu = t
      if (abriu >= 0 && !state.janelaDeTroca) fechou = t
    }
    expect(bateu - abriu).toBeGreaterThan(0.15)
    expect(bateu - abriu).toBeLessThan(0.35)
    expect(fechou - bateu).toBeCloseTo(TOLERANCIA_DO_CORTE, 1)
  })

  it('em cruzeiro a janela não abre: subir e descer ali não rende turbo', () => {
    const state = limpo()
    for (let t = 0; t < 12; t += QUADRO) stepRace(state, { ...perfeito(state), shiftDown: false }, QUADRO)
    expect(state.marcha).toBe(4)
    const eventos: RaceEvent[] = []
    for (let i = 0; i < 120; i += 1) {
      eventos.push(...stepRace(state, { ...MANUAL, shiftUp: i % 2 === 0, shiftDown: i % 2 === 1 }, QUADRO))
    }
    expect(eventos.some((e) => e.type === 'troca' && e.qualidade === 'perfeita')).toBe(false)
    expect(state.impulso).toBe(0)
  })

  it('reduzir para uma marcha em que o motor passaria do corte é recusado', () => {
    const state = limpo()
    for (let t = 0; t < 12; t += QUADRO) stepRace(state, perfeito(state), QUADRO)
    expect(state.marcha).toBe(4)
    const eventos = stepRace(state, { ...MANUAL, shiftDown: true }, QUADRO)
    expect(eventos).toContainEqual({ type: 'reducaoNegada' })
    expect(state.marcha).toBe(4)
  })

  it('freando, a redução entra quando a velocidade cabe na marcha de baixo', () => {
    const state = limpo()
    for (let t = 0; t < 12; t += QUADRO) stepRace(state, perfeito(state), QUADRO)
    let reduziu = false
    for (let t = 0; t < 2 && !reduziu; t += QUADRO) {
      const eventos = stepRace(state, { ...MANUAL, brake: true, shiftDown: true }, QUADRO)
      reduziu = eventos.some((e) => e.type === 'troca' && e.qualidade === 'reducao')
    }
    expect(reduziu).toBe(true)
    expect(state.marcha).toBe(3)
    expect(state.speed).toBeLessThanOrEqual(velocidadeDaMarcha(state.rules, 3))
  })

  it('numa marcha longa demais o carro ainda anda, devagar', () => {
    const state = limpo()
    state.marcha = NUMERO_DE_MARCHAS - 1
    for (let t = 0; t < 2; t += QUADRO) stepRace(state, MANUAL, QUADRO)
    expect(state.speed).toBeGreaterThan(5)
    const primeira = limpo()
    for (let t = 0; t < 2; t += QUADRO) stepRace(primeira, MANUAL, QUADRO)
    expect(state.speed).toBeLessThan(primeira.speed * 0.6)
  })

  it('frear e reacelerar para colher trocas perfeitas nunca compensa', () => {
    const embalado = limpo()
    const colhendo = limpo()
    for (const state of [embalado, colhendo]) for (let t = 0; t < 12; t += QUADRO) stepRace(state, perfeito(state), QUADRO)
    const inicio = colhendo.progress
    for (let t = 0; t < 8; t += QUADRO) {
      stepRace(embalado, MANUAL, QUADRO)
      // A cada dois segundos, freia fundo, reduz duas e sobe de novo na janela.
      const fase = t % 2
      const reduz = colhendo.marcha > 2 && colhendo.speed < velocidadeDaMarcha(colhendo.rules, colhendo.marcha - 1)
      stepRace(colhendo, fase < 0.4 ? { ...MANUAL, brake: true, shiftDown: reduz } : perfeito(colhendo), QUADRO)
    }
    expect(colhendo.progress - inicio).toBeLessThan(embalado.progress - inicio)
  })

  it('nem com todas as trocas perfeitas, boost e vácuo o carro passa do teto do nível', () => {
    const state = limpo()
    const teto = speedForState(false, 0, true, state.rules, 1)
    for (let t = 0; t < 20; t += QUADRO) {
      stepRace(state, { ...perfeito(state), boost: true }, QUADRO, { curvature: 0, slipstream: 1 })
      expect(state.speed).toBeLessThanOrEqual(teto + 1e-9)
    }
    expect(state.marcha).toBe(NUMERO_DE_MARCHAS - 1)
  })

  it('num quadro longo, a borboleta troca uma marcha só', () => {
    const state = limpo()
    for (let t = 0; t < 0.5; t += QUADRO) stepRace(state, MANUAL, QUADRO)
    const eventos = advanceRace(state, { ...MANUAL, shiftUp: true }, 0.25)
    expect(eventos.filter((e) => e.type === 'troca')).toHaveLength(1)
    expect(state.marcha).toBe(1)
  })

  it('o reset não troca a marcha, mas zera a sequência de trocas perfeitas', () => {
    const state = limpo()
    while (!state.janelaDeTroca) stepRace(state, MANUAL, QUADRO)
    stepRace(state, { ...MANUAL, shiftUp: true }, QUADRO)
    state.offTrack = 1
    state.lateral = 1.2
    stepRace(state, MANUAL, QUADRO)
    expect(state.resetting).toBeGreaterThan(0)
    expect(state.marcha).toBe(1)
    expect(state.trocasPerfeitas).toBe(0)
  })
})

describe('câmbio numa prova inteira', () => {
  /** O piloto completo, com o câmbio de cada política e reduções quando a velocidade cai. */
  function correr(seed: number, subir?: (state: RaceState) => boolean) {
    return correrSemTela(
      (layout) => {
        const piloto = pilotoCompleto(layout)
        if (!subir) return piloto
        return (state) => ({
          ...piloto(state),
          manual: true,
          shiftUp: subir(state),
          shiftDown: state.marcha > 0 && state.speed < velocidadeDaMarcha(state.rules, state.marcha - 1) * 0.9,
        })
      },
      { seed },
    )
  }

  it.each([1, 7, 42])('semente %i: quem acerta as trocas vence o automático, e quem atrasa perde', (seed) => {
    const automatico = correr(seed)
    const certo = correr(seed, (state) => state.janelaDeTroca)
    const tarde = correr(seed, (state) => state.noCorte > 0.3)
    expect(automatico.terminou && certo.terminou && tarde.terminou).toBe(true)
    expect(certo.tempo).toBeLessThan(automatico.tempo - 0.5)
    expect(tarde.tempo).toBeGreaterThan(automatico.tempo + 0.3)
    // O prêmio é de habilidade, e não decide a prova sozinho.
    expect(automatico.tempo - certo.tempo).toBeLessThan(3)
  })
})
