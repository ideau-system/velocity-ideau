import { describe, expect, it } from 'vitest'
import {
  ENGINE_BASE_HZ,
  ENGINE_SWEEP_HZ,
  engineTone,
  GEAR_EDGES,
  IDLE_RPM,
  mixFor,
  tomDaMarcha,
  type AudioLevels,
} from './audio'

const PARADO: AudioLevels = { speed: 0, boost: 0, offRoad: 0, running: true }

function comVelocidade(speed: number, extra: Partial<AudioLevels> = {}): AudioLevels {
  return { ...PARADO, speed, ...extra }
}

describe('nota do motor', () => {
  it('com o carro parado fica na marcha lenta, nunca mudo', () => {
    const tom = engineTone(0)
    expect(tom.gear).toBe(0)
    expect(tom.rpm).toBeCloseTo(IDLE_RPM, 6)
    expect(tom.frequency).toBeCloseTo(ENGINE_BASE_HZ + IDLE_RPM * ENGINE_SWEEP_HZ, 6)
  })

  it('a rotação sobe dentro de cada marcha e recomeça na troca', () => {
    // É este serrote — sobe, cai, sobe de novo — que dá escala à velocidade.
    // Uma nota que sobe uma vez só vira ruído de fundo.
    let anterior = engineTone(0).rpm
    let quedas = 0
    for (let ratio = 0.005; ratio <= 1; ratio += 0.005) {
      const atual = engineTone(ratio).rpm
      if (atual < anterior - 1e-9) quedas += 1
      anterior = atual
    }
    expect(quedas).toBe(GEAR_EDGES.length - 1)
  })

  it('a marcha só avança, nunca volta, conforme a velocidade sobe', () => {
    let anterior = 0
    for (let ratio = 0; ratio <= 1; ratio += 0.01) {
      const marcha = engineTone(ratio).gear
      expect(marcha).toBeGreaterThanOrEqual(anterior)
      anterior = marcha
    }
    expect(anterior).toBe(GEAR_EDGES.length - 1)
  })

  it('a rotação fica sempre entre a marcha lenta e o corte', () => {
    for (let ratio = -0.5; ratio <= 1.5; ratio += 0.01) {
      const tom = engineTone(ratio)
      expect(tom.rpm).toBeGreaterThanOrEqual(IDLE_RPM - 1e-9)
      expect(tom.rpm).toBeLessThanOrEqual(1 + 1e-9)
      expect(tom.frequency).toBeGreaterThan(0)
    }
  })

  it('aguenta valores fora da faixa sem enlouquecer', () => {
    expect(engineTone(-3).frequency).toBe(engineTone(0).frequency)
    expect(engineTone(9).frequency).toBe(engineTone(1).frequency)
    expect(Number.isFinite(engineTone(0.5).frequency)).toBe(true)
  })
})

describe('mistura das camadas', () => {
  it('o vento cresce com o quadrado da velocidade', () => {
    const meio = mixFor(comVelocidade(0.5), engineTone(0.5)).wind
    const cheio = mixFor(comVelocidade(1), engineTone(1)).wind
    // Quadrático: dobrar a velocidade multiplica o vento por quatro.
    expect(cheio / meio).toBeCloseTo(4, 3)
  })

  it('o vento é o que separa 200 de 250 km/h para o ouvido', () => {
    // A nota do motor nessas duas velocidades é parecida; o ar não é.
    const a = mixFor(comVelocidade(200 / 314), engineTone(200 / 314)).wind
    const b = mixFor(comVelocidade(250 / 314), engineTone(250 / 314)).wind
    expect(b).toBeGreaterThan(a * 1.4)
  })

  it('na grama o cascalho entra e o rolamento no asfalto sai', () => {
    const asfalto = mixFor(comVelocidade(0.8), engineTone(0.8))
    const grama = mixFor(comVelocidade(0.8, { offRoad: 1 }), engineTone(0.8))

    expect(asfalto.gravel).toBe(0)
    expect(asfalto.roll).toBeGreaterThan(0)
    expect(grama.gravel).toBeGreaterThan(0)
    expect(grama.roll).toBe(0)
  })

  it('a transição para a grama é contínua, sem degrau', () => {
    const amostras: number[] = []
    for (let fora = 0; fora <= 1; fora += 0.05) {
      amostras.push(mixFor(comVelocidade(0.8, { offRoad: fora }), engineTone(0.8)).gravel)
    }
    for (let i = 1; i < amostras.length; i += 1) {
      expect(amostras[i]).toBeGreaterThan(amostras[i - 1])
      expect(amostras[i] - amostras[i - 1]).toBeLessThan(0.1)
    }
  })

  it('o boost abre o filtro do motor e acrescenta o assobio', () => {
    const normal = mixFor(comVelocidade(0.8), engineTone(0.8))
    const empurrando = mixFor(comVelocidade(0.8, { boost: 1 }), engineTone(0.8))

    expect(empurrando.cutoff).toBeGreaterThan(normal.cutoff)
    expect(empurrando.boost).toBeGreaterThan(0)
    expect(normal.boost).toBe(0)
  })

  it('antes da largada só resta o motor em marcha lenta', () => {
    const parado = mixFor({ speed: 0, boost: 0, offRoad: 0, running: false }, engineTone(0))
    expect(parado.engine).toBeGreaterThan(0)
    expect(parado.wind).toBe(0)
    expect(parado.roll).toBe(0)
    expect(parado.gravel).toBe(0)
  })

  it('nenhuma camada estoura, em nenhum estado', () => {
    for (let speed = 0; speed <= 1; speed += 0.1) {
      for (const boost of [0, 0.5, 1]) {
        for (const offRoad of [0, 0.5, 1]) {
          const mix = mixFor(comVelocidade(speed, { boost, offRoad }), engineTone(speed))
          for (const valor of [mix.engine, mix.wind, mix.roll, mix.gravel, mix.boost]) {
            expect(valor).toBeGreaterThanOrEqual(0)
            expect(valor).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })
})

describe('nota presa ao câmbio da física', () => {
  it('a marcha é a da física, e a nota sobe com o giro dentro dela', () => {
    expect(tomDaMarcha(3, 0.5).gear).toBe(3)
    expect(tomDaMarcha(3, 0.9).frequency).toBeGreaterThan(tomDaMarcha(3, 0.5).frequency)
    expect(tomDaMarcha(3, 1).rpm).toBeCloseTo(1, 9)
    expect(tomDaMarcha(3, 0).rpm).toBeCloseTo(IDLE_RPM, 9)
  })

  it('aguenta valores estranhos', () => {
    expect(tomDaMarcha(Number.NaN, Number.NaN)).toEqual(tomDaMarcha(0, 0))
    expect(tomDaMarcha(2, 7).rpm).toBeCloseTo(1, 9)
  })
})
