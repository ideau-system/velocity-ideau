import { describe, expect, it } from 'vitest'
import { ESPERA_DA_FILA_MS, formarSalas, type EntradaDaFila } from './fila.js'

const AGORA = 1_000_000

function piloto(i: number, mu: number, esperou = 0): EntradaDaFila {
  return { perfilId: `p${i}`, playerId: `j${i}`, socketId: `s${i}`, nome: `P${i}`, carro: 'senna', mu, desde: AGORA - esperou }
}

describe('fila da ranqueada', () => {
  it('sozinho na fila não corre, por mais que espere', () => {
    expect(formarSalas([piloto(1, 25, ESPERA_DA_FILA_MS * 10)], AGORA).salas).toEqual([])
  })

  it('com poucos, espera encher; passado o tempo, larga com quem tem', () => {
    const tres = [piloto(1, 25, 1_000), piloto(2, 30, 2_000), piloto(3, 20, 3_000)]
    expect(formarSalas(tres, AGORA).salas).toEqual([])
    const depois = formarSalas(tres.map((entrada) => ({ ...entrada, desde: AGORA - ESPERA_DA_FILA_MS })), AGORA)
    expect(depois.salas).toHaveLength(1)
    expect(depois.salas[0].map((entrada) => entrada.perfilId)).toEqual(['p3', 'p1', 'p2'])
    expect(depois.restantes).toEqual([])
  })

  it('com seis, larga na hora', () => {
    const seis = Array.from({ length: 6 }, (_, i) => piloto(i, 20 + i))
    expect(formarSalas(seis, AGORA).salas).toHaveLength(1)
  })

  it('divide pela ordem do MMR em salas equilibradas: sete viram quatro e três', () => {
    const sete = Array.from({ length: 7 }, (_, i) => piloto(i, 40 - i * 3))
    const { salas } = formarSalas(sete, AGORA)
    expect(salas.map((sala) => sala.length)).toEqual([4, 3])
    // Os de MMR mais baixo juntos, os de mais alto juntos.
    expect(Math.max(...salas[0].map((entrada) => entrada.mu))).toBeLessThan(Math.min(...salas[1].map((entrada) => entrada.mu)))
  })
})
