import { describe, expect, it } from 'vitest'
import { minRaceSeconds } from '../../server/rooms'
import { correrSemTela } from './corridaSimulada'
import { desviando, noLimiteDoAsfalto, pilotoCompleto, tangenciando } from './piloto'
import { DIFFICULTIES } from './rules'

/**
 * Habilidade rende tempo.
 *
 * A crítica mais dura ao Top Gear relançado é a sensação de que não há muito
 * input vindo do jogador — e aqui a aceleração é automática, então o risco é
 * maior. Esta suíte mede a escada: quem corrige só na borda do asfalto, quem
 * desvia com o boost ligado, quem lê a nota de curva e tangencia, e quem usa
 * tudo — tangência, mini-turbo de curva e largada perfeita. Cada degrau tem de
 * valer tempo, em qualquer nível e semente, senão a mecânica é enfeite.
 */

const SEMENTES = [1, 7, 42, 20_250, 99_999]
const PERFEITA = { nivel: 3, queimou: false } as const

const media = (valores: number[]) => valores.reduce((soma, valor) => soma + valor, 0) / valores.length

describe('a escada de habilidade', () => {
  for (const nivel of DIFFICULTIES) {
    describe(`no ${nivel}`, () => {
      const provas = SEMENTES.map((seed) => ({
        seed,
        novato: correrSemTela(() => noLimiteDoAsfalto(), { seed, difficulty: nivel }),
        desvia: correrSemTela(() => desviando(true), { seed, difficulty: nivel }),
        tangencia: correrSemTela((layout) => tangenciando(layout.superCurves, true), { seed, difficulty: nivel }),
        completo: correrSemTela((layout) => pilotoCompleto(layout), { seed, difficulty: nivel, largada: PERFEITA }),
      }))

      it('cada degrau chega antes do de baixo, na média das sementes', () => {
        const novato = media(provas.map((p) => p.novato.tempo))
        const desvia = media(provas.map((p) => p.desvia.tempo))
        const tangencia = media(provas.map((p) => p.tangencia.tempo))
        const completo = media(provas.map((p) => p.completo.tempo))
        expect(desvia).toBeLessThan(novato)
        expect(tangencia).toBeLessThan(desvia)
        expect(completo).toBeLessThan(tangencia)
      })

      it('quem usa tudo chega ao menos 5% antes de quem só desvia com boost, e 1% antes de quem só tangencia', () => {
        const desvia = media(provas.map((p) => p.desvia.tempo))
        const tangencia = media(provas.map((p) => p.tangencia.tempo))
        const completo = media(provas.map((p) => p.completo.tempo))
        expect(completo).toBeLessThan(desvia * 0.95)
        expect(completo).toBeLessThan(tangencia * 0.99)
      })

      it('em nenhuma semente usar tudo custa mais que meio segundo', () => {
        for (const prova of provas) {
          expect(prova.completo.tempo, `semente ${prova.seed}`).toBeLessThan(prova.tangencia.tempo + 0.5)
        }
      })

      it('o mini-turbo sai em toda prova, e o terceiro nível existe', () => {
        for (const prova of provas) {
          const disparos = prova.completo.miniTurbos.reduce((soma, vezes) => soma + vezes, 0)
          expect(disparos, `semente ${prova.seed}`).toBeGreaterThanOrEqual(2)
        }
        expect(provas.reduce((soma, prova) => soma + prova.completo.miniTurbos[3], 0)).toBeGreaterThan(0)
      })

      it('nem o melhor piloto passa do tempo mínimo que o servidor aceita', () => {
        for (const prova of provas) {
          expect(prova.completo.terminou).toBe(true)
          expect(prova.completo.tempo, `semente ${prova.seed}`).toBeGreaterThan(minRaceSeconds(nivel))
        }
      })
    })
  }
})
