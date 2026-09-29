import { describe, expect, it } from 'vitest'
import {
  atualizarRatings,
  chanceDeFicarAFrente,
  comAusencia,
  CORRIDAS_DE_COLOCACAO,
  divisaoDe,
  estadoInicial,
  multiplicadorDeConvergencia,
  nomeDaDivisao,
  ordemDaCorrida,
  PL_AO_CAIR,
  PL_DO_ABANDONO,
  PL_DO_MESTRE,
  PL_POR_TIER,
  plAlvo,
  plDaColocacao,
  temporadaDe,
  TETO_DA_COLOCACAO,
  viradaDeTemporada,
  type EstadoRanqueado,
  type Participante,
} from './rating.js'

const AGORA = Date.parse('2026-09-23T18:00:00Z')

/** Um piloto já colocado, com PL e MMR dados. */
function colocado(pl: number, mu = 25 + (pl - 750) / 50, extra: Partial<EstadoRanqueado> = {}): EstadoRanqueado {
  return { ...estadoInicial(), mmr: { mu, sigma: 3 }, pl, colocacao: 0, corridas: 30, ...extra }
}

function corrida(estados: EstadoRanqueado[], desfechos: Participante['desfecho'][] = []): Participante[] {
  return estados.map((estado, i) => ({
    perfilId: `p${i + 1}`,
    desfecho: desfechos[i] ?? 'chegou',
    tempo: (desfechos[i] ?? 'chegou') === 'chegou' ? 60 + i : null,
    estado,
  }))
}

describe('tabela de colocação', () => {
  it('com seis: +30 +20 +10 −10 −20 −30, a metade de cima nunca perde', () => {
    expect([1, 2, 3, 4, 5, 6].map((posicao) => plDaColocacao(posicao, 6))).toEqual([30, 20, 10, -10, -20, -30])
  })

  it('salas menores movem menos; com número ímpar, o do meio fica no zero', () => {
    expect([plDaColocacao(1, 2), plDaColocacao(2, 2)]).toEqual([10, -10])
    expect([1, 2, 3, 4, 5].map((posicao) => plDaColocacao(posicao, 5))).toEqual([25, 15, 0, -15, -25])
  })
})

describe('ordem da corrida', () => {
  it('chegada pelo tempo, depois quem não terminou, depois quem abandonou, empatados entre si', () => {
    const postos = ordemDaCorrida([
      { desfecho: 'chegou', tempo: 64 },
      { desfecho: 'abandonou', tempo: null },
      { desfecho: 'chegou', tempo: 61 },
      { desfecho: 'naoTerminou', tempo: null },
      { desfecho: 'abandonou', tempo: null },
    ])
    expect(postos).toEqual([2, 4, 1, 3, 4])
  })
})

describe('divisões', () => {
  it('Bronze III a Diamante I de 100 em 100, e o Mestre é a escada aberta', () => {
    expect(divisaoDe(0)).toEqual({ tier: 'bronze', divisao: 3, pl: 0 })
    expect(divisaoDe(299)).toEqual({ tier: 'bronze', divisao: 1, pl: 99 })
    expect(divisaoDe(750)).toEqual({ tier: 'ouro', divisao: 2, pl: 50 })
    expect(divisaoDe(PL_DO_MESTRE + 120)).toEqual({ tier: 'mestre', divisao: null, pl: 120 })
    expect(nomeDaDivisao(845)).toBe('Ouro I · 45 PL')
    expect(nomeDaDivisao(PL_DO_MESTRE + 7)).toBe('Mestre · 7 PL')
  })
})

describe('colocação', () => {
  it('cinco corridas sem perda, e na última os PL vão para onde o MMR aponta, com teto no Ouro I', () => {
    let estados = [estadoInicial(), estadoInicial()]
    for (let i = 0; i < CORRIDAS_DE_COLOCACAO; i += 1) {
      const [vence, perde] = atualizarRatings(corrida(estados), AGORA + i)
      // Quem perde na colocação não perde PL.
      expect(perde.deltaPl).toBeGreaterThanOrEqual(0)
      estados = [vence.depois, perde.depois]
    }
    expect(estados.every((estado) => estado.colocacao === 0)).toBe(true)
    expect(estados[0].pl).toBeGreaterThan(estados[1].pl)
    expect(estados[0].pl).toBeLessThanOrEqual(TETO_DA_COLOCACAO)
  })
})

describe('PL depois da colocação', () => {
  it('quem está no próprio nível ganha e perde a tabela', () => {
    const iguais = Array.from({ length: 6 }, () => colocado(750, plAlvo({ mu: 25, sigma: 3 }) / 50 + 10))
    const deltas = atualizarRatings(corrida(iguais), AGORA).map((a) => a.deltaPl)
    expect(deltas[0]).toBeGreaterThan(20)
    expect(deltas[5]).toBeLessThan(-20)
    expect(deltas.slice(0, 3).every((delta) => delta > 0)).toBe(true)
    expect(deltas.slice(3).every((delta) => delta < 0)).toBe(true)
  })

  it('a convergência tem limite: nunca um +10/−30', () => {
    expect(multiplicadorDeConvergencia(colocado(100, 45))).toBe(1.25)
    expect(multiplicadorDeConvergencia(colocado(1400, 5))).toBe(0.75)
    const abaixoDoNivel = colocado(700, 40)
    const [primeiro] = atualizarRatings(corrida([abaixoDoNivel, colocado(700)]), AGORA)
    expect(primeiro.multiplicador).toBeGreaterThan(1.1)
    expect(primeiro.deltaPl).toBeLessThanOrEqual(Math.round(10 * 1.25))
  })

  it('Bronze e Prata perdem pela metade e não caem de tier', () => {
    const naPrata = colocado(PL_POR_TIER + 3)
    const [, ultimo] = atualizarRatings(corrida([colocado(PL_POR_TIER + 3), naPrata]), AGORA)
    expect(ultimo.deltaPl).toBe(-3)
    expect(ultimo.depois.pl).toBe(PL_POR_TIER)
    expect(ultimo.mudouDeTier).toBeNull()
  })

  it('acima da Prata, cair do tier leva para a divisão I de baixo com 75 PL — menos com escudo', () => {
    const noOuro = colocado(PL_POR_TIER * 3 + 2)
    const [, caiu] = atualizarRatings(corrida([colocado(PL_POR_TIER * 3 + 2), noOuro]), AGORA)
    expect(caiu.mudouDeTier).toBe('caiu')
    expect(caiu.depois.pl).toBe(PL_POR_TIER * 3 - 100 + PL_AO_CAIR)

    const comEscudo = colocado(PL_POR_TIER * 3 + 2, undefined, { escudo: 2 })
    const [, segurou] = atualizarRatings(corrida([colocado(PL_POR_TIER * 3 + 2), comEscudo]), AGORA)
    expect(segurou.depois.pl).toBe(PL_POR_TIER * 3)
    expect(segurou.depois.escudo).toBe(1)
  })

  it('subir de tier dá três corridas de escudo', () => {
    const [subiu] = atualizarRatings(corrida([colocado(PL_POR_TIER * 3 - 5), colocado(PL_POR_TIER * 3 - 5)]), AGORA)
    expect(subiu.mudouDeTier).toBe('subiu')
    expect(subiu.depois.escudo).toBe(3)
  })

  it('abandonar é o último lugar e ainda custa PL extra', () => {
    const iguais = [colocado(1000), colocado(1000), colocado(1000)]
    const comAbandono = atualizarRatings(corrida(iguais, ['chegou', 'naoTerminou', 'abandonou']), AGORA)
    const semAbandono = atualizarRatings(corrida(iguais, ['chegou', 'chegou', 'chegou']), AGORA)
    expect(comAbandono[2].deltaPl).toBeLessThanOrEqual(semAbandono[2].deltaPl - PL_DO_ABANDONO + 1)
    expect(comAbandono[2].depois.abandonos).toBe(1)
  })

  it('o retorno decrescente reduz os PL, e não o MMR', () => {
    const iguais = [colocado(1000), colocado(1000)]
    const cheio = atualizarRatings(corrida(iguais), AGORA)[0]
    const reduzido = atualizarRatings(corrida(iguais), AGORA, 0.5)[0]
    expect(reduzido.deltaPl).toBeLessThan(cheio.deltaPl)
    expect(reduzido.depois.mmr).toEqual(cheio.depois.mmr)
  })

  it('mostra a chance que o MMR dava contra cada rival', () => {
    const [forte] = atualizarRatings(corrida([colocado(1200, 35), colocado(600, 18)]), AGORA)
    expect(forte.rivais[0].chance).toBeGreaterThan(0.7)
    expect(forte.rivais[0].ficouAFrente).toBe(true)
    expect(chanceDeFicarAFrente({ mu: 25, sigma: 3 }, { mu: 25, sigma: 3 })).toBeCloseTo(0.5, 5)
  })
})

describe('ausência e temporadas', () => {
  it('dias sem correr aumentam a incerteza, sem tirar o MMR e sem passar da inicial', () => {
    const depois = comAusencia({ mu: 30, sigma: 2 }, AGORA - 30 * 86_400_000, AGORA)
    expect(depois.mu).toBe(30)
    expect(depois.sigma).toBeGreaterThan(2)
    expect(comAusencia({ mu: 30, sigma: 2 }, AGORA - 10_000 * 86_400_000, AGORA).sigma).toBeCloseTo(25 / 3, 5)
  })

  it('uma temporada por semestre, no fuso de Brasília', () => {
    expect(temporadaDe(Date.parse('2026-06-30T12:00:00Z'))).toBe('2026.1')
    expect(temporadaDe(Date.parse('2026-07-01T12:00:00Z'))).toBe('2026.2')
    expect(temporadaDe(Date.parse('2027-01-01T02:00:00Z'))).toBe('2026.2')
  })

  it('a virada puxa o MMR para a média e pede três corridas de colocação', () => {
    const virado = viradaDeTemporada(colocado(1400, 40))
    expect(virado.mmr.mu).toBeCloseTo(25 + 15 * 0.7, 5)
    expect(virado.pl).toBe(0)
    expect(virado.colocacao).toBe(3)
    expect(viradaDeTemporada(null)).toEqual(estadoInicial())
  })
})

describe('o rating encontra quem é bom', () => {
  it('sessenta pilotos, salas de seis, vinte corridas cada: a ordem do MMR bate com a habilidade real', () => {
    // Gerador fixo, para o teste não depender da sorte.
    let semente = 0x2f6b
    const aleatorio = () => {
      semente = (semente + 0x6d2b79f5) >>> 0
      let t = semente
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const normal = () => Math.sqrt(-2 * Math.log(1 - aleatorio())) * Math.cos(2 * Math.PI * aleatorio())

    const pilotos = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, habilidade: 25 + normal() * 8, estado: estadoInicial() }))
    for (let rodada = 0; rodada < 20; rodada += 1) {
      const embaralhados = [...pilotos].sort(() => aleatorio() - 0.5)
      for (let sala = 0; sala < embaralhados.length; sala += 6) {
        const grupo = embaralhados.slice(sala, sala + 6)
        const desempenho = grupo.map((piloto) => piloto.habilidade + normal() * (25 / 6))
        const participantes: Participante[] = grupo.map((piloto, i) => ({
          perfilId: piloto.id,
          desfecho: 'chegou',
          // Mais desempenho, menos tempo.
          tempo: 100 - desempenho[i],
          estado: piloto.estado,
        }))
        for (const atualizacao of atualizarRatings(participantes, AGORA + rodada * 60_000)) {
          pilotos.find((piloto) => piloto.id === atualizacao.perfilId)!.estado = atualizacao.depois
        }
      }
    }

    const spearman = (a: number[], b: number[]) => {
      const posto = (valores: number[]) => {
        const ordem = valores.map((valor, i) => [valor, i] as const).sort((x, y) => x[0] - y[0])
        const postos: number[] = []
        ordem.forEach(([, i], p) => (postos[i] = p))
        return postos
      }
      const pa = posto(a)
      const pb = posto(b)
      const n = a.length
      const d2 = pa.reduce((soma, valor, i) => soma + (valor - pb[i]) ** 2, 0)
      return 1 - (6 * d2) / (n * (n * n - 1))
    }
    const habilidades = pilotos.map((piloto) => piloto.habilidade)
    expect(spearman(habilidades, pilotos.map((piloto) => piloto.estado.mmr.mu))).toBeGreaterThan(0.9)
    // Os PL visíveis também acompanham, mais devagar: é para isso que existe a convergência.
    expect(spearman(habilidades, pilotos.map((piloto) => piloto.estado.pl))).toBeGreaterThan(0.75)
  })
})
