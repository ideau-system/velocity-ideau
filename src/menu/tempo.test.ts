import { describe, expect, it } from 'vitest'
import { cronometro, faltam, leituraDaFila, noHorarioNobre } from './tempo'

describe('relógios do paddock', () => {
  it('o cronômetro da fila conta minutos e segundos, sem nunca ficar negativo', () => {
    expect(cronometro(0)).toBe('0:00')
    expect(cronometro(7_900)).toBe('0:07')
    expect(cronometro(760_000)).toBe('12:40')
    expect(cronometro(-3_000)).toBe('0:00')
  })

  it('o quanto falta encurta conforme a distância, e o segundo arredonda para cima', () => {
    expect(faltam(45_100)).toBe('0:46')
    expect(faltam(12 * 60_000 + 5_000)).toBe('12:05')
    expect(faltam(2 * 3_600_000 + 5 * 60_000)).toBe('2H 05MIN')
    expect(faltam(3 * 86_400_000 + 4 * 3_600_000)).toBe('3D 04H')
    expect(faltam(-1)).toBe('0:00')
  })

  it('o horário nobre é das 20h às 22h de Brasília', () => {
    expect(noHorarioNobre(Date.parse('2026-09-30T22:59:00Z'))).toBe(false) // 19h59
    expect(noHorarioNobre(Date.parse('2026-09-30T23:00:00Z'))).toBe(true) // 20h
    expect(noHorarioNobre(Date.parse('2026-10-01T00:59:00Z'))).toBe(true) // 21h59
    expect(noHorarioNobre(Date.parse('2026-10-01T01:00:00Z'))).toBe(false) // 22h
  })
})

describe('leitura da fila', () => {
  const AGORA = 1_000_000

  it('com companhia, diz quantos esperam e quando a sala fecha', () => {
    const leitura = leituraDaFila({ tamanho: 3, desde: AGORA - 5_000, salaEm: AGORA + 15_000, fantasmasEm: null }, AGORA)
    expect(leitura.texto).toBe('3 NA FILA · A SALA FECHA EM 0:15')
    expect(leitura.progresso).toBeCloseTo(0.25)
    expect(leituraDaFila({ tamanho: 3, desde: AGORA - 5_000, salaEm: AGORA - 10, fantasmasEm: null }, AGORA)).toEqual({
      texto: '3 NA FILA · MONTANDO A SALA…',
      progresso: 1,
    })
  })

  it('sozinho, promete os fantasmas — e admite a espera quando eles não vêm', () => {
    const sozinho = { tamanho: 1, desde: AGORA - 10_000, salaEm: null, fantasmasEm: AGORA + 30_000 }
    expect(leituraDaFila(sozinho, AGORA).texto).toBe('SÓ VOCÊ NA FILA · FANTASMAS DO SEU NÍVEL EM 0:30')
    expect(leituraDaFila(sozinho, AGORA + 31_000).texto).toBe('SÓ VOCÊ NA FILA · CHAMANDO FANTASMAS DO SEU NÍVEL…')
    expect(leituraDaFila(sozinho, AGORA + 60_000).texto).toBe('SÓ VOCÊ NA FILA · ESPERANDO OUTRO PILOTO')
  })

  it('antes da primeira notícia do servidor, está entrando', () => {
    expect(leituraDaFila({ tamanho: 1, desde: null, salaEm: null, fantasmasEm: null }, AGORA)).toEqual({ texto: 'ENTRANDO NA FILA…', progresso: 0 })
  })
})
