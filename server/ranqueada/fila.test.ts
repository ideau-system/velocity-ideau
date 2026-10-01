import { describe, expect, it } from 'vitest'
import { ESPERA_DA_FILA_MS, formarSalas, previsaoDaFila, type EntradaDaFila } from './fila.js'

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

  it('a previsão diz quando a sala fecha, ou quando o sozinho corre contra fantasmas', () => {
    const FANTASMAS = 40_000
    expect(previsaoDaFila([], AGORA, ESPERA_DA_FILA_MS, FANTASMAS)).toEqual({ salaEm: null, fantasmasEm: null })
    // Sozinho, só os fantasmas prometem alguma coisa.
    expect(previsaoDaFila([piloto(1, 25, 5_000)], AGORA, ESPERA_DA_FILA_MS, FANTASMAS)).toEqual({
      salaEm: null,
      fantasmasEm: AGORA - 5_000 + FANTASMAS,
    })
    // Com companhia, a sala fecha quando o primeiro da fila completa a espera.
    const tres = [piloto(1, 25, 1_000), piloto(2, 30, 7_000), piloto(3, 20, 3_000)]
    const previsao = previsaoDaFila(tres, AGORA, ESPERA_DA_FILA_MS, FANTASMAS)
    expect(previsao).toEqual({ salaEm: AGORA - 7_000 + ESPERA_DA_FILA_MS, fantasmasEm: null })
    // E a previsão bate com a fila: um instante antes não sai sala; no instante, sai.
    expect(formarSalas(tres, previsao.salaEm! - 1).salas).toEqual([])
    expect(formarSalas(tres, previsao.salaEm!).salas).toHaveLength(1)
    // Com seis, é agora.
    const seis = Array.from({ length: 6 }, (_, i) => piloto(i, 20 + i))
    expect(previsaoDaFila(seis, AGORA, ESPERA_DA_FILA_MS, FANTASMAS).salaEm).toBe(AGORA)
  })

  it('divide pela ordem do MMR em salas equilibradas: sete viram quatro e três', () => {
    const sete = Array.from({ length: 7 }, (_, i) => piloto(i, 40 - i * 3))
    const { salas } = formarSalas(sete, AGORA)
    expect(salas.map((sala) => sala.length)).toEqual([4, 3])
    // Os de MMR mais baixo juntos, os de mais alto juntos.
    expect(Math.max(...salas[0].map((entrada) => entrada.mu))).toBeLessThan(Math.min(...salas[1].map((entrada) => entrada.mu)))
  })
})
