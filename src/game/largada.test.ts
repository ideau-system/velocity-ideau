import { describe, expect, it } from 'vitest'
import { correrSemTela } from './corridaSimulada'
import {
  AFOGADO_SECONDS,
  aplicarLargada,
  classificarLargada,
  JuizDaLargada,
  LARGADA_ANTECIPADA_MS,
  LARGADA_COMUM,
  LARGADA_DECIDIDA_MS,
  LARGADA_IMPULSO,
  LARGADA_VELOCIDADE,
} from './largada'
import { desviando } from './piloto'
import { createRaceState } from './simulation'

describe('classificação da largada', () => {
  it('perfeita no apagar das luzes, pior quanto mais tarde, nada depois da janela', () => {
    expect(classificarLargada(-LARGADA_ANTECIPADA_MS)).toEqual({ nivel: 3, queimou: false })
    expect(classificarLargada(0)).toEqual({ nivel: 3, queimou: false })
    expect(classificarLargada(150)).toEqual({ nivel: 3, queimou: false })
    expect(classificarLargada(151)).toEqual({ nivel: 2, queimou: false })
    expect(classificarLargada(350)).toEqual({ nivel: 2, queimou: false })
    expect(classificarLargada(351)).toEqual({ nivel: 1, queimou: false })
    expect(classificarLargada(LARGADA_DECIDIDA_MS)).toEqual({ nivel: 1, queimou: false })
    expect(classificarLargada(LARGADA_DECIDIDA_MS + 1)).toEqual(LARGADA_COMUM)
  })

  it('antes da folga do relógio, queima', () => {
    expect(classificarLargada(-LARGADA_ANTECIPADA_MS - 1)).toEqual({ nivel: 0, queimou: true })
    expect(classificarLargada(Number.NEGATIVE_INFINITY)).toEqual(LARGADA_COMUM)
    expect(classificarLargada(Number.NaN)).toEqual(LARGADA_COMUM)
  })
})

describe('juiz da largada', () => {
  it('apertar e soltar antes da hora não custa nada', () => {
    const juiz = new JuizDaLargada()
    expect(juiz.observar(true, -2_000)).toBeNull()
    expect(juiz.observar(false, -1_500)).toBeNull()
    expect(juiz.observar(false, 0)).toBeNull()
    expect(juiz.observar(true, 100)).toEqual({ nivel: 3, queimou: false })
  })

  it('segurar desde antes da hora queima no apagar das luzes', () => {
    const juiz = new JuizDaLargada()
    juiz.observar(true, -500)
    expect(juiz.observar(true, 0)).toEqual({ nivel: 0, queimou: true })
  })

  it('apertar dentro da folga e segurar é a perfeita', () => {
    const juiz = new JuizDaLargada()
    juiz.observar(true, -40)
    expect(juiz.observar(true, 16)).toEqual({ nivel: 3, queimou: false })
  })

  it('sem aperto, a largada é comum quando a janela fecha', () => {
    const juiz = new JuizDaLargada()
    expect(juiz.observar(false, LARGADA_DECIDIDA_MS)).toBeNull()
    expect(juiz.observar(false, LARGADA_DECIDIDA_MS + 16)).toEqual(LARGADA_COMUM)
  })

  it('decide uma vez só', () => {
    const juiz = new JuizDaLargada()
    expect(juiz.observar(true, 200)).toEqual({ nivel: 2, queimou: false })
    expect(juiz.observar(false, 300)).toBeNull()
    expect(juiz.observar(true, 400)).toBeNull()
    expect(juiz.largada).toEqual({ nivel: 2, queimou: false })
  })
})

describe('efeito da largada', () => {
  it('a turbo tira o carro da linha em movimento e dá impulso; a queimada afoga o motor', () => {
    const perfeita = createRaceState()
    aplicarLargada(perfeita, { nivel: 3, queimou: false })
    expect(perfeita.speed).toBe(LARGADA_VELOCIDADE[3])
    expect(perfeita.impulso).toBe(LARGADA_IMPULSO[3])

    const queimada = createRaceState()
    aplicarLargada(queimada, { nivel: 0, queimou: true })
    expect(queimada.afogado).toBe(AFOGADO_SECONDS)
    expect(queimada.speed).toBe(0)

    const comum = createRaceState()
    aplicarLargada(comum, LARGADA_COMUM)
    expect(comum).toEqual(createRaceState())
  })

  it('numa prova inteira, a perfeita chega antes e a queimada depois', () => {
    const correr = (nivel: 0 | 3, queimou: boolean) =>
      correrSemTela(() => desviando(true), { seed: 42, largada: { nivel, queimou } }).tempo
    const perfeita = correr(3, false)
    const comum = correr(0, false)
    const queimada = correr(0, true)
    expect(comum - perfeita).toBeGreaterThan(0.3)
    expect(queimada - comum).toBeGreaterThan(AFOGADO_SECONDS * 0.75)
  })
})
