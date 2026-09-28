import { describe, expect, it } from 'vitest'
import { correrSemTela } from './corridaSimulada'
import { GravadorDeVolta } from './gravador'
import { desviando, pilotoCompleto, type Piloto } from './piloto'
import { bitsDe, GravadorDeEntradas, inputDe, progressoEm, quantizarPasso, refazerVolta, registroValido } from './registroDeEntradas'
import { advanceRace, createRaceState, velocidadeDaMarcha, type RaceInput } from './simulation'
import { createRaceContext, createTrackLayout, type TrackLayout } from './layout'

const QUADRO = quantizarPasso(1 / 60)

/** Corre uma prova gravando a volta e os comandos, como o jogo faz. */
function voltaGravada(seed: number, criar: (layout: TrackLayout) => Piloto, largada = { nivel: 3 as const, queimou: false }) {
  const entradas = new GravadorDeEntradas()
  const gravador = new GravadorDeVolta()
  entradas.registrarLargada(largada)
  let ultimo: RaceInput = { left: false, right: false, boost: false }
  const prova = correrSemTela(
    (layout) => {
      const piloto = criar(layout)
      return (state) => (ultimo = piloto(state))
    },
    {
      seed,
      difficulty: 'dificil',
      quadro: QUADRO,
      largada,
      aCadaQuadro: (state, _eventos, tempo) => {
        entradas.registrar(QUADRO, ultimo)
        gravador.gravar(tempo * 1000, state)
      },
    },
  )
  return { prova, registro: entradas.terminar(), gravacao: gravador.terminar(prova.tempo * 1000, prova.state) }
}

describe('registro de comandos', () => {
  it('guarda os comandos em trechos, e é pequeno', () => {
    const { registro, prova } = voltaGravada(42, (layout) => pilotoCompleto(layout))
    expect(registro.quadrosUs).toHaveLength(Math.round(prova.tempo / QUADRO))
    // Trechos de comando, e não um por quadro.
    expect(registro.comandos.length / 2).toBeLessThan(registro.quadrosUs.length / 2)
    expect(JSON.stringify(registro).length).toBeLessThan(40_000)
    expect(registroValido(registro)).toEqual(registro)
  })

  it('a volta refeita pelos comandos é a mesma volta', () => {
    for (const seed of [7, 20_250]) {
      const { registro, prova } = voltaGravada(seed, (layout) => pilotoCompleto(layout))
      const refeita = refazerVolta(registro, seed, 'dificil')
      expect(refeita.terminou).toBe(true)
      expect(refeita.chegada).toBeCloseTo(prova.tempo, 9)
    }
  })

  it('a largada entra no quadro em que foi aplicada, e a queimada custa na volta refeita', () => {
    const { registro } = voltaGravada(7, () => desviando(true), { nivel: 3, queimou: false })
    const perfeita = refazerVolta(registro, 7, 'dificil')
    const queimada = refazerVolta({ ...registro, largada: { nivel: 0, queimou: true, quadro: 0 } }, 7, 'dificil')
    expect(perfeita.terminou).toBe(true)
    // Com o motor afogado, os mesmos comandos acabam antes da linha: a queimada
    // deixou o carro dezenas de metros para trás.
    expect(queimada.terminou).toBe(false)
    expect(queimada.progresso[queimada.progresso.length - 1]).toBeLessThan(4_800 - 30)
  })

  it('o quadro longo do celular lento é refeito pelos mesmos passos', () => {
    // O jogo entrega à física o quadro inteiro, em passos iguais de até 0,05 s:
    // a 60 quadros por segundo, com engasgos de 0,1 e 0,2 s no meio.
    const seed = 7
    const layout = createTrackLayout(seed)
    const context = createRaceContext(layout)
    const state = createRaceState('dificil')
    const piloto = pilotoCompleto(layout)
    const entradas = new GravadorDeEntradas()
    const quadros = [1 / 60, 1 / 60, 0.1, 1 / 30, 0.2, 1 / 60].map(quantizarPasso)
    let tempo = 0
    let chegada: number | null = null
    for (let i = 0; chegada === null && i < 20_000; i += 1) {
      const passo = quadros[i % quadros.length]
      const input = { ...piloto(state) }
      entradas.registrar(passo, input)
      tempo += passo
      for (const evento of advanceRace(state, input, passo, context)) if (evento.type === 'finish') chegada = tempo
    }
    expect(chegada).not.toBeNull()
    const refeita = refazerVolta(entradas.terminar(), seed, 'dificil')
    expect(refeita.chegada).toBeCloseTo(chegada!, 9)
  })

  it('o relógio da volta refeita inclui os saltos da aba escondida', () => {
    const { registro } = voltaGravada(7, () => desviando(true))
    const comSalto = refazerVolta({ ...registro, saltos: [100, 2] }, 7, 'dificil')
    const semSalto = refazerVolta(registro, 7, 'dificil')
    expect(comSalto.chegada!).toBeCloseTo(semSalto.chegada! + 2, 6)
    // Dentro do salto, o progresso é interpolado entre os dois quadros.
    const noMeio = progressoEm(comSalto, comSalto.relogio[99] + 1)
    expect(noMeio).toBeGreaterThanOrEqual(comSalto.progresso[99])
    expect(noMeio).toBeLessThanOrEqual(comSalto.progresso[100])
  })

  it('recusa registro malformado', () => {
    const { registro } = voltaGravada(7, () => desviando(true))
    expect(registroValido(null)).toBeNull()
    expect(registroValido({ ...registro, comandos: [...registro.comandos, 1] })).toBeNull()
    expect(registroValido({ ...registro, comandos: registro.comandos.map((valor, i) => (i === 0 ? 256 : valor)) })).toBeNull()
    expect(registroValido({ ...registro, comandos: registro.comandos.map((valor, i) => (i === 0 ? -1 : valor)) })).toBeNull()
    expect(registroValido({ ...registro, quadrosUs: registro.quadrosUs.slice(1) })).toBeNull()
    expect(registroValido({ ...registro, largada: { nivel: 5, queimou: false, quadro: 0 } })).toBeNull()
  })

  it('cada comando do carro cabe nos bits e volta igual', () => {
    for (let bits = 0; bits <= 255; bits += 1) expect(bitsDe(inputDe(bits))).toBe(bits)
    // Sem pedal informado é pé no fundo: o registro de antes do câmbio continua valendo.
    expect(inputDe(0)).toMatchObject({ throttle: true, brake: false, manual: false })
    expect(bitsDe({ left: false, right: false, boost: false })).toBe(0)
    expect(bitsDe({ left: false, right: false, boost: false, throttle: false, brake: true, manual: true })).toBe(8 | 16 | 128)
  })

  it('a volta de câmbio manual, com freio e borboletas, é refeita igual', () => {
    // O piloto completo, trocando na janela, freando antes de cada super curva
    // e tirando o pé na entrada dela, enquanto ainda vem embalado.
    const { registro, prova } = voltaGravada(7, (layout) => {
      const piloto = pilotoCompleto(layout)
      return (state) => {
        const antesDaCurva = layout.superCurves.some((curva) => state.progress > curva.start - 60 && state.progress < curva.start)
        const naCurva = layout.superCurves.some((curva) => state.progress >= curva.start && state.progress < curva.end)
        return {
          ...piloto(state),
          manual: true,
          throttle: !(naCurva && state.speed > 170),
          brake: antesDaCurva && !naCurva && state.speed > 150,
          shiftUp: state.janelaDeTroca,
          shiftDown: state.marcha > 0 && state.speed < velocidadeDaMarcha(state.rules, state.marcha - 1) * 0.9,
        }
      }
    })
    expect(prova.terminou).toBe(true)
    expect(registroValido(registro)).toEqual(registro)
    const refeita = refazerVolta(registro, 7, 'dificil')
    expect(refeita.terminou).toBe(true)
    expect(refeita.chegada).toBeCloseTo(prova.tempo, 9)
  })
})
