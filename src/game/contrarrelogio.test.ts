import { describe, expect, it } from 'vitest'
import { AnalistaDaCorrida, fimDosSetores, medalhasLimpas, ondePerdeuTempo } from './analise'
import {
  chaveDoRecorde,
  diaDe,
  guardarSeRecorde,
  lerRecorde,
  limitesDasMedalhas,
  medalhaPara,
  sementeDoDia,
  tempoDoPiloto,
  type Armazenamento,
} from './contrarrelogio'
import { correrSemTela } from './corridaSimulada'
import { duracaoDaGravacao, GravadorDeVolta, gravacaoValida, ReproducaoDeVolta } from './gravador'
import { createTrackLayout } from './layout'
import { desviando, noLimiteDoAsfalto, pilotoCompleto } from './piloto'
import { rulesFor } from './rules'
import { TRACK_LENGTH } from './track'

/** Um armazenamento em memória, no lugar do `localStorage`. */
function memoria(): Armazenamento & { itens: Map<string, string> } {
  const itens = new Map<string, string>()
  return {
    itens,
    getItem: (chave) => itens.get(chave) ?? null,
    setItem: (chave, valor) => void itens.set(chave, valor),
  }
}

/** Grava uma prova inteira de um piloto de teste. */
function gravarProva(seed: number) {
  const gravador = new GravadorDeVolta()
  const prova = correrSemTela(() => desviando(true), {
    seed,
    aCadaQuadro: (state, _eventos, tempo) => gravador.gravar(tempo * 1000, state),
  })
  const gravacao = gravador.terminar(prova.tempo * 1000, prova.state)
  return { prova, gravacao }
}

describe('pista do dia', () => {
  it('o dia vira à meia-noite de Brasília, e não à de Greenwich', () => {
    expect(diaDe(new Date('2026-09-23T02:59:00Z'))).toBe('2026-09-22')
    expect(diaDe(new Date('2026-09-23T03:00:00Z'))).toBe('2026-09-23')
  })

  it('o mesmo dia dá a mesma pista, e dias diferentes dão pistas diferentes', () => {
    expect(sementeDoDia('2026-09-23')).toBe(sementeDoDia('2026-09-23'))
    expect(sementeDoDia('2026-09-23')).not.toBe(sementeDoDia('2026-09-24'))
    expect(Number.isInteger(sementeDoDia('2026-09-23'))).toBe(true)
    expect(() => sementeDoDia('ontem')).toThrow()
  })
})

describe('medalhas', () => {
  it('o tempo de referência é o do piloto que usa tudo, e sai igual toda vez', () => {
    const referencia = tempoDoPiloto(42, 'normal')
    expect(referencia).toBe(tempoDoPiloto(42, 'normal'))
    const completo = correrSemTela((layout) => pilotoCompleto(layout), { seed: 42, largada: { nivel: 3, queimou: false } })
    expect(referencia).toBe(completo.tempo)
  })

  it('cada medalha é mais folgada que a de cima, e o tempo ganha a melhor que alcança', () => {
    const limites = limitesDasMedalhas(60)
    expect(limites.autor).toBeLessThan(limites.ouro)
    expect(limites.ouro).toBeLessThan(limites.prata)
    expect(limites.prata).toBeLessThan(limites.bronze)
    expect(medalhaPara(59, limites)).toBe('autor')
    expect(medalhaPara(limites.ouro, limites)).toBe('ouro')
    expect(medalhaPara(limites.prata - 0.01, limites)).toBe('prata')
    expect(medalhaPara(limites.bronze + 0.01, limites)).toBeNull()
    expect(medalhaPara(Number.NaN, limites)).toBeNull()
  })

  it('quem desvia com boost leva medalha, e o iniciante que corrige na borda não', () => {
    const limites = limitesDasMedalhas(tempoDoPiloto(7, 'normal'))
    const desvia = correrSemTela(() => desviando(true), { seed: 7 })
    const iniciante = correrSemTela(() => noLimiteDoAsfalto(), { seed: 7 })
    expect(medalhaPara(desvia.tempo, limites)).not.toBeNull()
    expect(medalhaPara(iniciante.tempo, limites)).toBeNull()
  })
})

describe('gravação da volta', () => {
  it('grava dez amostras por segundo e termina na chegada', () => {
    const { prova, gravacao } = gravarProva(1)
    expect(gravacaoValida(gravacao)).toEqual(gravacao)
    expect(duracaoDaGravacao(gravacao)).toBeCloseTo(prova.tempo, 1)
    expect(gravacao.progresso[gravacao.progresso.length - 1]).toBe(TRACK_LENGTH * 10)
    // Uns dez quilobytes: cabe no navegador e numa mensagem ao servidor.
    expect(JSON.stringify(gravacao).length).toBeLessThan(16_000)
  })

  it('a reprodução refaz o caminho gravado, e para na chegada', () => {
    const { gravacao } = gravarProva(1)
    const largada = 1_000_000
    const fantasma = new ReproducaoDeVolta(gravacao, largada)
    const meio = fantasma.sample(largada + 30_000)!
    expect(meio.state).toBe('racing')
    expect(meio.progress).toBeCloseTo(gravacao.progresso[300] / 10, 5)
    // Entre duas amostras, interpola.
    const entre = fantasma.sample(largada + 30_050)!
    expect(entre.progress).toBeGreaterThan(meio.progress)
    expect(entre.progress).toBeLessThan(gravacao.progresso[301] / 10 + 1e-9)
    const depois = fantasma.sample(largada + 10_000_000)!
    expect(depois.state).toBe('finished')
    expect(depois.progress).toBe(TRACK_LENGTH)
    // Antes da largada, na linha.
    expect(fantasma.sample(largada - 5_000)!.progress).toBe(0)
  })

  it('sabe em que tempo passou por cada ponto da pista: é o delta ao vivo', () => {
    const { gravacao } = gravarProva(1)
    const fantasma = new ReproducaoDeVolta(gravacao, 0)
    const noMeio = gravacao.progresso[300] / 10
    expect(fantasma.tempoEm(noMeio)).toBeCloseTo(30, 1)
    expect(fantasma.tempoEm(0)).toBe(0)
    expect(fantasma.tempoEm(TRACK_LENGTH)).toBeCloseTo(duracaoDaGravacao(gravacao), 1)
    expect(fantasma.tempoEm(TRACK_LENGTH + 1)).toBeNull()
    expect(fantasma.tempoEm(Number.NaN)).toBeNull()
  })

  it('recusa gravação adulterada', () => {
    const { gravacao } = gravarProva(1)
    expect(gravacaoValida(null)).toBeNull()
    expect(gravacaoValida({ ...gravacao, intervaloMs: 50 })).toBeNull()
    expect(gravacaoValida({ ...gravacao, lateral: gravacao.lateral.slice(1) })).toBeNull()
    const recuando = { ...gravacao, progresso: [...gravacao.progresso] }
    recuando.progresso[100] = recuando.progresso[99] - 50
    expect(gravacaoValida(recuando)).toBeNull()
    const voando = { ...gravacao, velocidade: [...gravacao.velocidade] }
    voando.velocidade[10] = 900
    expect(gravacaoValida(voando)).toBeNull()
  })
})

describe('recorde pessoal', () => {
  it('guarda só o que bate o recorde, por semente e nível', () => {
    const { prova, gravacao } = gravarProva(1)
    const armazenamento = memoria()
    const recorde = { tempo: duracaoDaGravacao(gravacao), gravacao, em: '2026-09-23T12:00:00Z' }
    expect(lerRecorde(armazenamento, 1, 'normal')).toBeNull()
    expect(guardarSeRecorde(armazenamento, 1, 'normal', recorde)).toBe(true)
    expect(lerRecorde(armazenamento, 1, 'normal')?.tempo).toBeCloseTo(prova.tempo, 1)
    // Mais lento não substitui.
    expect(guardarSeRecorde(armazenamento, 1, 'normal', { ...recorde, tempo: recorde.tempo + 1 })).toBe(false)
    // Outro nível é outro recorde.
    expect(lerRecorde(armazenamento, 1, 'dificil')).toBeNull()
    expect(armazenamento.itens.has(chaveDoRecorde(1, 'normal'))).toBe(true)
  })

  it('um recorde corrompido, ou com tempo que não bate com a gravação, é como não ter recorde', () => {
    const { gravacao } = gravarProva(1)
    const armazenamento = memoria()
    armazenamento.setItem(chaveDoRecorde(1, 'normal'), '{isto não é json')
    expect(lerRecorde(armazenamento, 1, 'normal')).toBeNull()
    armazenamento.setItem(chaveDoRecorde(1, 'normal'), JSON.stringify({ tempo: 10, gravacao, em: '' }))
    expect(lerRecorde(armazenamento, 1, 'normal')).toBeNull()
    const quebrado: Armazenamento = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
    }
    expect(lerRecorde(quebrado, 1, 'normal')).toBeNull()
    expect(guardarSeRecorde(quebrado, 1, 'normal', { tempo: duracaoDaGravacao(gravacao), gravacao, em: '' })).toBe(false)
    expect(lerRecorde(null, 1, 'normal')).toBeNull()
  })
})

describe('análise da corrida', () => {
  it('um setor termina na saída de cada super curva, e o S conta como um', () => {
    const curvas = createTrackLayout(1).superCurves
    const fins = fimDosSetores(curvas)
    expect(fins).toHaveLength(5)
    expect(fins[fins.length - 1]).toBe(TRACK_LENGTH)
    for (let i = 1; i < fins.length; i += 1) expect(fins[i]).toBeGreaterThan(fins[i - 1])
  })

  it('mede a prova: tangências, mini-turbos, parciais e o que custou tempo', () => {
    const layout = createTrackLayout(20_250)
    const analista = new AnalistaDaCorrida(layout.superCurves)
    analista.registrarLargada({ nivel: 3, queimou: false })
    const prova = correrSemTela((pista) => pilotoCompleto(pista), {
      seed: 20_250,
      largada: { nivel: 3, queimou: false },
      aCadaQuadro: (state, eventos, tempo) => analista.observar(state, eventos, 1 / 60, tempo),
    })
    const analise = analista.resultado()
    expect(analise.tangencias).toBe(prova.state.apexes.size)
    expect(analise.tangenciasPossiveis).toBe(4)
    expect(analise.maiorSequencia).toBeGreaterThanOrEqual(1)
    expect(analise.miniTurbos).toEqual(prova.miniTurbos)
    expect(analise.parciais.every((parcial) => parcial !== null)).toBe(true)
    expect(analise.parciais[analise.parciais.length - 1]).toBeCloseTo(prova.tempo, 5)
    const medalhas = medalhasLimpas(analise)
    expect(medalhas.find((medalha) => medalha.id === 'largada')?.conquistada).toBe(true)
  })

  it('aponta primeiro onde mais se perdeu, e não inventa perda de quem correu limpo', () => {
    const regras = rulesFor('normal')
    const base = new AnalistaDaCorrida(createTrackLayout(1).superCurves).resultado()
    const bagunçada = {
      ...base,
      tangencias: 1,
      batidas: 5,
      resets: 1,
      segundosNaGrama: 4,
      largada: { nivel: 0 as const, queimou: true },
    }
    const perdas = ondePerdeuTempo(bagunçada, regras)
    expect(perdas.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < perdas.length; i += 1) expect(perdas[i].segundos).toBeLessThanOrEqual(perdas[i - 1].segundos)
    expect(perdas.some((perda) => perda.motivo.includes('queimada'))).toBe(true)

    const limpa = { ...base, tangencias: base.tangenciasPossiveis, largada: { nivel: 3 as const, queimou: false } }
    expect(ondePerdeuTempo(limpa, regras)).toEqual([])
    expect(medalhasLimpas(limpa).every((medalha) => medalha.conquistada)).toBe(true)
  })
})
