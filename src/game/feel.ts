import { ACCELERATION_PEAK, motorForte, STEER_TAU, type RaceState } from './simulation.js'
import { OFF_ROAD_LIMIT } from './track.js'

/**
 * Intensidades contínuas para a apresentação.
 *
 * A simulação decide a corrida em estados discretos — está fora da pista ou
 * não, está com boost ou não. Isso é certo para a regra, mas péssimo para o
 * olho: liga e desliga sem meio-termo. Aqui derivamos grandezas suaves entre
 * 0 e 1 para inclinação, câmera, partículas e HUD reagirem por intensidade.
 *
 * Este módulo não é uma segunda simulação: ele só lê o `RaceState` e nunca o
 * modifica, e nada que ele produz volta para a decisão da corrida.
 */

/**
 * Aceleração de referência, em km/h por segundo.
 *
 * É a própria aceleração de arrancada do carro, e não um número escolhido à
 * parte: assim a saída da largada satura o indicador em 1 justamente no
 * momento mais dramático, e o boost passa disso.
 */
export const ACCEL_REFERENCE = ACCELERATION_PEAK

/**
 * Giro de volante por segundo que satura o indicador de esforço.
 *
 * Sai da inércia do volante: com ela, largar o volante do batente ao centro
 * gira a esta velocidade.
 */
export const STEER_RATE_REFERENCE = 1 / STEER_TAU

/** Constantes de tempo da suavização, em segundos. */
const TAU = {
  accel: 0.16,
  boost: 0.18,
  offRoad: 0.14,
  impact: 0.42,
  steerRate: 0.2,
  strain: 0.3,
  // A sujeira é o único sinal assimétrico do módulo, e é o que ela tem de
  // interessante: entra em menos de um segundo de grama e fica na carroceria
  // por uns bons trechos de reta depois. Iguais nos dois sentidos, ela lavaria
  // sozinha em meio segundo e ninguém veria que o carro se sujou.
  sujeiraSobe: 0.55,
  sujeiraDesce: 11,
  slipstream: 0.22,
  corner: 0.2,
}

/**
 * Constante de tempo da chama do boost, em segundos. É a mesma no carro do
 * jogador e nos fantasmas, que a acendem pela telemetria: a chama é uma só, e
 * o boost de um toque não pisca.
 */
export const BOOST_TAU = TAU.boost

export type FeelState = {
  /** Velocidade de 0 a 1, entre parado e o máximo do carro. */
  speed: number
  /** Aceleração de -1 a 1, suavizada. Positiva ao ganhar velocidade. */
  accel: number
  /** Posição do volante, de -1 a 1. Lida da simulação, não suavizada de novo. */
  steer: number
  /** O quanto o volante está sendo girado agora, de 0 a 1. */
  steerRate: number
  /** Esforço lateral acumulado, de 0 a 1. Chega a 1 na perda máxima de aderência. */
  strain: number
  /** O quanto o boost está atuando, de 0 a 1. */
  boost: number
  /** Sobe a 1 no impacto e decai. */
  impact: number
  /** O quanto o carro está fora do asfalto, de 0 a 1. */
  offRoad: number
  /** Terra acumulada na carroceria, de 0 a 1. Sobe na grama e sai devagar. */
  dirt: number
  /** O quanto o vácuo do rival está rendendo, de 0 a 1. */
  slipstream: number
  /** Carga lateral que a curva está impondo, de 0 a 1. */
  corner: number
  /** Velocidade do quadro anterior, para derivar a aceleração. */
  previousSpeed: number
  /** Volante do quadro anterior, para derivar o quanto ele está girando. */
  previousSteer: number
}

export function createFeel(): FeelState {
  return {
    speed: 0,
    accel: 0,
    steer: 0,
    steerRate: 0,
    strain: 0,
    boost: 0,
    impact: 0,
    offRoad: 0,
    dirt: 0,
    slipstream: 0,
    corner: 0,
    previousSpeed: 0,
    previousSteer: 0,
  }
}

/**
 * Fator de aproximação independente da taxa de quadros.
 *
 * Com `dt * k` o resultado muda conforme o aparelho desenha mais ou menos
 * quadros; a exponencial dá o mesmo valor em 20 ou 144 quadros por segundo.
 */
export function approach(current: number, target: number, tau: number, dt: number) {
  if (tau <= 0) return target
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** Atualiza as intensidades a partir do estado da corrida. */
export function updateFeel(feel: FeelState, race: RaceState, dt: number) {
  const step = Math.max(0, dt)
  if (step === 0) return feel

  // Normalizada pelo teto da própria dificuldade: em profissional o carro é
  // mais rápido, e o indicador continua chegando a 1 no mesmo lugar da escala.
  feel.speed = clamp(race.speed / race.rules.boostSpeed, 0, 1)

  const bruto = (race.speed - feel.previousSpeed) / step / ACCEL_REFERENCE
  feel.previousSpeed = race.speed
  feel.accel = approach(feel.accel, clamp(bruto, -1, 1), TAU.accel, step)

  // O volante já tem inércia dentro da simulação: aqui só lemos o valor. Uma
  // segunda suavização seria uma segunda verdade, e a carroceria acabaria
  // inclinando para um lado enquanto o carro anda para o outro.
  const giro = Math.abs(race.steerInput - feel.previousSteer) / step
  feel.previousSteer = race.steerInput
  feel.steer = race.steerInput
  feel.steerRate = approach(feel.steerRate, clamp(giro / STEER_RATE_REFERENCE, 0, 1), TAU.steerRate, step)

  // Esforço lateral: sai da aderência que a simulação já calculou.
  feel.strain = approach(feel.strain, clamp((1 - race.grip) / race.rules.maxGripLoss, 0, 1), TAU.strain, step)

  // O impulso do mini-turbo e da largada é força de boost, e se vê e se ouve como ela.
  feel.boost = approach(feel.boost, motorForte(race) ? 1 : 0, TAU.boost, step)

  // Fora da pista cresce com o quanto o carro avançou para além da borda.
  const excedente = (Math.abs(race.lateral) - OFF_ROAD_LIMIT) / 0.3
  feel.offRoad = approach(feel.offRoad, clamp(excedente, 0, 1), TAU.offRoad, step)

  // Sujeira: o alvo é acumular, não acompanhar. Enquanto houver roda na grama
  // a terra sobe rumo a cobrir o carro, por mais rasa que seja a saída — a
  // profundidade muda a poeira que levanta, não o quanto o carro se suja.
  const sujando = feel.offRoad > 0.05
  feel.dirt = approach(feel.dirt, sujando ? 1 : 0, sujando ? TAU.sujeiraSobe : TAU.sujeiraDesce, step)

  // Vácuo e carga de curva já saem contínuos da simulação; a suavização aqui
  // serve para o HUD e os efeitos não tremerem quando o valor oscila de um
  // quadro para o outro.
  feel.slipstream = approach(feel.slipstream, clamp(race.slipstream, 0, 1), TAU.slipstream, step)
  feel.corner = approach(feel.corner, clamp(race.cornerLoad, 0, 1), TAU.corner, step)

  feel.impact = approach(feel.impact, 0, TAU.impact, step)
  return feel
}

/** Marca um impacto: a intensidade vai a 1 e decai sozinha. */
export function registerImpact(feel: FeelState) {
  feel.impact = 1
  return feel
}
