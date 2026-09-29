// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import type { RaceState } from './simulation.js'

/**
 * Largada turbo.
 *
 * Todo Mario Kart tem a sua: acelerar na hora certa da contagem rende um turbo,
 * e acelerar cedo demais afoga o motor. Aqui o comando é o boost, e a hora
 * certa é o apagar das cinco luzes.
 *
 * As luzes acendem em ritmo fixo — uma a cada 900 ms, a mesma sequência em
 * todos os aparelhos —, e isso faz da largada perfeita uma questão de
 * antecipar o ritmo, e não de reflexo. Reflexo puro premiaria a tela e o
 * controle de menor latência; o ritmo é igual para todo mundo.
 */

export type Largada = {
  /** 0 sem turbo, 3 a perfeita. */
  nivel: 0 | 1 | 2 | 3
  /** Boost apertado antes da hora: o motor afoga. */
  queimou: boolean
}

/**
 * Quanto antes do apagar das luzes o aperto ainda conta como perfeito.
 *
 * É a folga da sincronia de relógio entre os aparelhos, e não um prêmio a
 * quem adivinha: o relógio de cada um erra por algumas dezenas de
 * milissegundos, e quem apertou no apagar da própria tela não pode ser
 * punido pelo erro do relógio.
 */
export const LARGADA_ANTECIPADA_MS = 80

/** Até quantos milissegundos depois do apagar cada nível vale. */
export const LARGADA_JANELAS = [
  { ate: 150, nivel: 3 },
  { ate: 350, nivel: 2 },
  { ate: 700, nivel: 1 },
] as const

/** Depois disto, sem aperto, a largada foi comum. */
export const LARGADA_DECIDIDA_MS = 700

/** Segundos de motor afogado da largada queimada. */
export const AFOGADO_SECONDS = 0.8

/** Velocidade, em km/h, com que o carro sai da linha em cada nível. */
export const LARGADA_VELOCIDADE = [0, 30, 60, 90] as const

/** Segundos de impulso que cada nível paga depois de sair da linha. */
export const LARGADA_IMPULSO = [0, 0.3, 0.6, 1] as const

/** Largada sem nada: nem turbo, nem motor afogado. */
export const LARGADA_COMUM: Largada = { nivel: 0, queimou: false }

/**
 * Classifica o aperto do boost pelo instante em que ele começou, em
 * milissegundos relativos ao apagar das luzes (negativo é antes).
 */
export function classificarLargada(inicioDoAperto: number): Largada {
  if (!Number.isFinite(inicioDoAperto)) return LARGADA_COMUM
  if (inicioDoAperto < -LARGADA_ANTECIPADA_MS) return { nivel: 0, queimou: true }
  for (const janela of LARGADA_JANELAS) {
    if (inicioDoAperto <= janela.ate) return { nivel: janela.nivel, queimou: false }
  }
  return LARGADA_COMUM
}

/**
 * Acompanha o boost durante a contagem e decide a largada.
 *
 * Recebe o estado do botão e o instante, relativo ao apagar das luzes, a cada
 * mudança de tecla e a cada quadro. Apertar e soltar antes da hora não custa
 * nada — é o piloto nervoso na linha —; o que afoga o motor é estar com o
 * boost apertado desde antes da hora quando as luzes se apagam.
 *
 * Decide uma vez só: no apagar, se o boost está apertado; no primeiro aperto
 * depois dele; ou, sem aperto, quando a janela fecha.
 */
export class JuizDaLargada {
  private inicioDoAperto = Number.NEGATIVE_INFINITY
  private apertado = false
  private decisao: Largada | null = null

  /** A decisão, depois de tomada. */
  get largada(): Largada | null {
    return this.decisao
  }

  /**
   * Registra o botão num instante e devolve a decisão quando ela sai — uma
   * vez só, no instante em que é tomada. Nas chamadas seguintes, null.
   */
  observar(boost: boolean, instante: number): Largada | null {
    if (this.decisao || !Number.isFinite(instante)) return null
    if (boost && !this.apertado) this.inicioDoAperto = instante
    this.apertado = boost
    if (instante < 0) return null
    if (this.apertado) this.decisao = classificarLargada(this.inicioDoAperto)
    else if (instante > LARGADA_DECIDIDA_MS) this.decisao = LARGADA_COMUM
    return this.decisao
  }
}

/**
 * Aplica ao carro o que a largada rendeu.
 *
 * O turbo põe o carro em movimento e dá um impulso, que não gasta a barra; a
 * queimada afoga o motor. Nada disso passa do teto do nível: o impulso persegue
 * a velocidade do boost, que é o mesmo alvo que o boost já tinha.
 */
export function aplicarLargada(state: RaceState, largada: Largada) {
  if (largada.queimou) {
    state.afogado = AFOGADO_SECONDS
    state.speed = 0
    return
  }
  if (largada.nivel <= 0) return
  state.speed = Math.max(state.speed, LARGADA_VELOCIDADE[largada.nivel])
  state.impulso = Math.max(state.impulso, LARGADA_IMPULSO[largada.nivel])
}
