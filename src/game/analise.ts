// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { AFOGADO_SECONDS, type Largada } from './largada.js'
import type { SuperCurve } from './layout.js'
import type { RaceRules } from './rules.js'
import { RESET_SECONDS, type RaceEvent, type RaceState } from './simulation.js'
import { TRACK_LENGTH } from './track.js'

/**
 * O que a prova mostrou do piloto.
 *
 * Top Gear 3000 tinha bônus secretos para quem corria limpo — sem bater, sem
 * sair da pista —, e o Horizon Chase, o super troféu de quem pegava tudo. São
 * metas para quem não venceu, e ensinam a jogar bem sem uma linha de tutorial.
 * Aqui elas moram fora do rating de propósito: o que conta na classificação é
 * chegar primeiro, e um objetivo paralelo que valesse ponto desviaria o piloto
 * dele — a lição do Mario Kart Tour e da Aegis do LoL.
 */
export type AnaliseDaCorrida = {
  tangencias: number
  tangenciasPossiveis: number
  /** Maior sequência de tangências seguidas. */
  maiorSequencia: number
  /** Mini-turbos disparados, por nível: o índice 1 é o nível 1. */
  miniTurbos: [number, number, number, number]
  largada: Largada | null
  segundosNaGrama: number
  segundosDeBoostTravado: number
  /** Batidas em obstáculo e no muro. */
  batidas: number
  resets: number
  raspoes: number
  /** Subidas de marcha feitas na mão, no câmbio manual. */
  subidasNaMao: number
  /** Quantas delas foram na janela da troca perfeita. */
  trocasPerfeitas: number
  /** Segundos batendo no limitador de giro, sem trocar. */
  segundosNoCorte: number
  /**
   * Tempo de prova, em segundos, ao fim de cada setor — na saída de cada super
   * curva e na chegada —, ou null para o setor que o carro não completou.
   */
  parciais: Array<number | null>
}

/**
 * Onde terminam os setores: na saída de cada super curva e na chegada.
 *
 * A segunda metade do S emenda na primeira, e as duas fazem um setor só.
 */
export function fimDosSetores(curvas: readonly Pick<SuperCurve, 'start' | 'end'>[]): number[] {
  const fins: number[] = []
  for (const curva of curvas) {
    if (curvas.some((outra) => outra.start === curva.end)) continue
    fins.push(curva.end)
  }
  fins.push(TRACK_LENGTH)
  return fins.sort((a, b) => a - b)
}

/** Acompanha a prova quadro a quadro e monta a análise dela. */
export class AnalistaDaCorrida {
  private readonly fins: number[]
  private proximoSetor = 0
  private readonly dados: AnaliseDaCorrida

  constructor(curvas: readonly Pick<SuperCurve, 'start' | 'end' | 'tangency'>[]) {
    this.fins = fimDosSetores(curvas)
    this.dados = {
      tangencias: 0,
      tangenciasPossiveis: curvas.filter((curva) => curva.tangency).length,
      maiorSequencia: 0,
      miniTurbos: [0, 0, 0, 0],
      largada: null,
      segundosNaGrama: 0,
      segundosDeBoostTravado: 0,
      batidas: 0,
      resets: 0,
      raspoes: 0,
      subidasNaMao: 0,
      trocasPerfeitas: 0,
      segundosNoCorte: 0,
      parciais: this.fins.map(() => null),
    }
  }

  /** Onde termina cada setor, em metros. */
  get setores(): readonly number[] {
    return this.fins
  }

  /** Quantos setores o carro já completou. */
  get setoresCompletos() {
    return this.proximoSetor
  }

  /** Tempo de prova ao fim de um setor, ou null se ele ainda não terminou. */
  parcial(setor: number) {
    return this.dados.parciais[setor] ?? null
  }

  registrarLargada(largada: Largada) {
    this.dados.largada = largada
  }

  /** Um quadro de prova: o estado depois do passo, os eventos dele e o passo aplicado. */
  observar(state: RaceState, eventos: readonly RaceEvent[], passo: number, tempoDeProva: number) {
    if (state.offRoad) this.dados.segundosNaGrama += passo
    if (state.boostLocked) this.dados.segundosDeBoostTravado += passo
    if (state.noCorte > 0) this.dados.segundosNoCorte += passo
    for (const evento of eventos) {
      if (evento.type === 'troca' && evento.para > evento.de && evento.qualidade !== 'automatica') {
        this.dados.subidasNaMao += 1
        if (evento.qualidade === 'perfeita') this.dados.trocasPerfeitas += 1
      }
      if (evento.type === 'apex') {
        this.dados.tangencias += 1
        this.dados.maiorSequencia = Math.max(this.dados.maiorSequencia, evento.sequencia)
      }
      if (evento.type === 'miniTurbo') this.dados.miniTurbos[evento.nivel] += 1
      if (evento.type === 'raspao') this.dados.raspoes += 1
    }
    while (this.proximoSetor < this.fins.length && state.progress >= this.fins[this.proximoSetor]) {
      this.dados.parciais[this.proximoSetor] = tempoDeProva
      this.proximoSetor += 1
    }
    this.dados.batidas = state.collisions
    this.dados.resets = state.resets
  }

  /** Uma cópia do que foi medido até aqui. */
  resultado(): AnaliseDaCorrida {
    return {
      ...this.dados,
      miniTurbos: [...this.dados.miniTurbos],
      parciais: [...this.dados.parciais],
    }
  }
}

/** Onde o piloto perdeu tempo, com uma estimativa em segundos. */
export type PerdaDeTempo = { motivo: string; segundos: number }

/**
 * Tempo que custou uma tangência perdida: o boost que ela devolveria, gasto
 * numa reta, mais o caminho mais curto que a linha de dentro dá. É estimativa,
 * medida com os pilotos de teste, e não conta exata.
 */
const TANGENCIA_PERDIDA_S = 0.3

/**
 * Fração do tempo no limitador que virou tempo de prova perdido. No corte o
 * carro não ganha velocidade, mas também não perde: o prejuízo é o que ele
 * deixou de ganhar, menos que o tempo inteiro. Estimativa, medida com os
 * pilotos de teste.
 */
const CORTE_PERDIDO = 0.5

/** Largada perfeita contra cada outra: o que o carro deixou na linha. */
const LARGADA_PERDIDA_S = [0.5, 0.3, 0.15, 0] as const

/**
 * Onde o piloto perdeu tempo, do maior para o menor.
 *
 * São estimativas — a física não guarda o tempo que não aconteceu —, feitas
 * com as regras do nível: quanto a penalidade e a grama tiram da velocidade, e
 * quanto um reset deixa parado. Servem para apontar o que treinar, e é assim
 * que a tela as apresenta.
 */
export function ondePerdeuTempo(analise: AnaliseDaCorrida, rules: RaceRules): PerdaDeTempo[] {
  const perdas: PerdaDeTempo[] = []
  const tangenciasPerdidas = Math.max(0, analise.tangenciasPossiveis - analise.tangencias)
  if (tangenciasPerdidas > 0) {
    perdas.push({
      motivo: tangenciasPerdidas === 1 ? '1 tangência perdida' : `${tangenciasPerdidas} tangências perdidas`,
      segundos: tangenciasPerdidas * TANGENCIA_PERDIDA_S,
    })
  }
  const batidasSemReset = Math.max(0, analise.batidas - analise.resets * 3)
  if (batidasSemReset > 0) {
    perdas.push({
      motivo: batidasSemReset === 1 ? '1 batida' : `${batidasSemReset} batidas`,
      segundos: batidasSemReset * rules.penaltySeconds * (1 - rules.penaltySpeed / rules.cruiseSpeed) * 1.5,
    })
  }
  if (analise.resets > 0) {
    perdas.push({
      motivo: analise.resets === 1 ? '1 reset' : `${analise.resets} resets`,
      segundos: analise.resets * (RESET_SECONDS + 1),
    })
  }
  if (analise.segundosNaGrama > 0.2) {
    perdas.push({
      motivo: `${analise.segundosNaGrama.toFixed(1).replace('.', ',')} s na grama`,
      segundos: analise.segundosNaGrama * (1 - rules.offRoadSpeed / rules.cruiseSpeed),
    })
  }
  if (analise.segundosNoCorte > 0.2) {
    perdas.push({
      motivo: `${analise.segundosNoCorte.toFixed(1).replace('.', ',')} s batendo no corte`,
      segundos: analise.segundosNoCorte * CORTE_PERDIDO,
    })
  }
  if (analise.largada) {
    const { nivel, queimou } = analise.largada
    const segundos = queimou ? AFOGADO_SECONDS + LARGADA_PERDIDA_S[0] : LARGADA_PERDIDA_S[nivel]
    if (segundos > 0) perdas.push({ motivo: queimou ? 'largada queimada' : 'largada sem turbo perfeito', segundos })
  }
  return perdas.filter((perda) => perda.segundos >= 0.05).sort((a, b) => b.segundos - a.segundos)
}

export type MedalhaLimpa = { id: string; nome: string; conquistada: boolean }

/** As metas de corrida limpa, conquistadas ou não. */
export function medalhasLimpas(analise: AnaliseDaCorrida): MedalhaLimpa[] {
  return [
    {
      id: 'tangencias',
      nome: 'Todas as tangências',
      conquistada: analise.tangenciasPossiveis > 0 && analise.tangencias >= analise.tangenciasPossiveis,
    },
    { id: 'limpa', nome: 'Sem batidas', conquistada: analise.batidas === 0 },
    { id: 'asfalto', nome: 'Nunca na grama', conquistada: analise.segundosNaGrama === 0 },
    { id: 'boost', nome: 'Boost sem travar', conquistada: analise.segundosDeBoostTravado === 0 },
    { id: 'largada', nome: 'Largada perfeita', conquistada: analise.largada?.nivel === 3 },
  ]
}
