import { describe, expect, it } from 'vitest'
import { tempoDoPiloto } from './contrarrelogio'
import { correrSemTela } from './corridaSimulada'
import { desafioDaSemana, desafiosDaSemana, inicioDaSemana, MODIFICADORES, ORDEM_DOS_DESAFIOS, regrasDo, semanaDe } from './desafios'
import { pilotoCompleto, tangenciando } from './piloto'
import { rulesFor } from './rules'
import { speedForState } from './simulation'

describe('semana dos desafios', () => {
  it('vira na segunda-feira, à meia-noite de Brasília', () => {
    const domingo = Date.parse('2026-09-28T02:59:00Z')
    const segunda = Date.parse('2026-09-28T03:00:00Z')
    expect(semanaDe(segunda)).toBe(semanaDe(domingo) + 1)
    expect(inicioDaSemana(semanaDe(segunda))).toBe('2026-09-28')
    expect(new Date(`${inicioDaSemana(semanaDe(segunda))}T12:00:00Z`).getUTCDay()).toBe(1)
  })

  it('cinco desafios por semana, um de cada modificador, com pistas diferentes', () => {
    const semana = semanaDe(Date.parse('2026-09-23T18:00:00Z'))
    const desafios = desafiosDaSemana(semana)
    expect(desafios.map((desafio) => desafio.modificador)).toEqual(ORDEM_DOS_DESAFIOS)
    expect(new Set(desafios.map((desafio) => desafio.seed)).size).toBe(5)
    expect(desafiosDaSemana(semana)).toEqual(desafios)
    expect(desafiosDaSemana(semana + 1)[0].seed).not.toBe(desafios[0].seed)
    expect(desafioDaSemana(desafios[2].id, Date.parse('2026-09-23T18:00:00Z'))).toEqual(desafios[2])
    // O desafio da semana passada não vale mais.
    expect(desafioDaSemana(`${semana - 1}-2`, Date.parse('2026-09-23T18:00:00Z'))).toBeNull()
  })
})

describe('modificadores', () => {
  const base = rulesFor('dificil')

  it('nenhum passa do teto do nível: o tempo mínimo do servidor continua valendo', () => {
    for (const modificador of ORDEM_DOS_DESAFIOS) {
      const definicao = MODIFICADORES[modificador]
      const regras = definicao.regras(rulesFor(definicao.dificuldade))
      expect(speedForState(false, 0, true, regras, 1)).toBe(speedForState(false, 0, true, rulesFor(definicao.dificuldade), 1))
    }
  })

  it('cada um mexe no que promete', () => {
    expect(MODIFICADORES.nitroLivre.regras(base).boostDrain).toBe(0)
    expect(MODIFICADORES.soTangencia.regras(base).boostRecharge).toBe(0)
    expect(MODIFICADORES.chuva.regras(base).cornerGrip).toBeLessThan(base.cornerGrip)
    expect(MODIFICADORES.classico.regras(base)).toBe(base)
    expect(regrasDo(null)).toBeUndefined()
  })

  it('mudam a prova: o tempo de referência de cada um é outro', () => {
    const seed = 42
    const classico = tempoDoPiloto(seed, 'dificil')
    expect(tempoDoPiloto(seed, 'dificil', 'nitroLivre')).toBeLessThan(classico)
    expect(tempoDoPiloto(seed, 'dificil', 'soTangencia')).toBeGreaterThan(classico)
  })

  it('na pista molhada, quem tangencia ainda termina, mas mais devagar', () => {
    const seco = correrSemTela((layout) => tangenciando(layout.superCurves, true), { seed: 7, difficulty: 'dificil' })
    const molhado = correrSemTela((layout) => tangenciando(layout.superCurves, true), {
      seed: 7,
      difficulty: 'dificil',
      regras: regrasDo('chuva'),
    })
    expect(molhado.terminou).toBe(true)
    expect(molhado.tempo).toBeGreaterThan(seco.tempo)
    // E o piloto completo continua completando a prova sem problema.
    expect(correrSemTela((layout) => pilotoCompleto(layout), { seed: 7, difficulty: 'dificil', regras: regrasDo('chuva') }).terminou).toBe(true)
  })
})
