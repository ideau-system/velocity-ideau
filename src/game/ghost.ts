/**
 * Fantasma do adversário.
 *
 * Cada navegador envia dez medições por segundo, e cada uma chega um pouco
 * velha: a rede leva dezenas de milissegundos. Desenhar a última medição, ou
 * interpolar entre as duas últimas, põe o rival no passado — a 250 km/h, 160
 * ms de atraso são 11 m, e dois carros lado a lado viam cada um o outro atrás,
 * os dois se achando em primeiro e a esteira no lugar errado.
 *
 * Por isso o fantasma é projetado até o presente: da medição mais recente, na
 * velocidade dela e com a aceleração que as últimas medições mostram. Quando
 * uma medição nova corrige a projeção, o carro não salta — a diferença é
 * absorvida em pouco mais de um décimo de segundo, com um teto de ritmo, e o
 * fantasma nunca anda para trás.
 */
// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de ponta a ponta. O Vite resolve para o arquivo .ts normalmente.
import { LATERAL_LIMIT, TRACK_LENGTH } from './track.js'

export type RivalState = 'racing' | 'finished'

export type GhostSnapshot = {
  /** Instante da medição, no relógio do servidor. */
  t: number
  progress: number
  lateral: number
  speed: number
  state: RivalState
  /**
   * Motor com a força do boost: o boost apertado, ou o impulso da largada ou do
   * mini-turbo. Opcional — o fantasma gravado e o cliente antigo não mandam.
   */
  boosting?: boolean
}

export type GhostSample = {
  progress: number
  lateral: number
  speed: number
  state: RivalState
  /** Verdadeiro quando não chega telemetria nova há tempo demais. */
  stale: boolean
  /** Instante da chegada, no relógio do servidor, para quem já cruzou a linha. */
  finishedAt?: number | null
  /** O rival está de boost agora. Sem sinal ou na chegada, não está. */
  boosting?: boolean
}

/**
 * Atraso de exibição. Zero: o fantasma é desenhado no presente, e não mais
 * no passado recente. Continua exportado para quem compara a posição
 * mostrada com a verdadeira no mesmo instante.
 */
export const INTERPOLATION_DELAY_MS = 0
/** Por quanto tempo sem notícias a projeção segue; depois o fantasma congela, sem sinal. */
export const MAX_EXTRAPOLATION_MS = 900
/** Quantas medições guardamos. */
export const BUFFER_SIZE = 24
/** Intervalo de envio da telemetria. */
export const TELEMETRY_INTERVAL_MS = 100
/** Em quanto tempo uma correção de posição é absorvida (constante de tempo). */
export const CORRECAO_MS = 150
/** O mesmo para o lado da pista, que muda mais devagar e perdoa menos um tranco. */
export const CORRECAO_LATERAL_MS = 90
/**
 * Ritmo máximo com que o fantasma alcança uma correção para a frente, além do
 * próprio ritmo. Sem teto, fechar 20 m em 150 ms era o carro disparando.
 */
export const CORRECAO_MAXIMA_MPS = 35
/** Diferença a partir da qual a correção deixa de ser suave: o carro reaparece no lugar. */
export const SALTO_MAXIMO_M = 40
/** Janela de medições de onde sai a aceleração, e o trecho da projeção em que ela vale. */
const JANELA_DA_ACELERACAO_MS = 300
/** Distância mínima entre duas medições para a aceleração delas significar algo. */
const INTERVALO_MINIMO_MS = 150
/** Até onde a deriva lateral é projetada: esterço muda rápido e não se sustenta. */
const HORIZONTE_LATERAL_MS = 150
/** Limites da aceleração estimada, em m/s². O teto é o da arrancada; o piso, uma batida. */
const ACELERACAO_MAXIMA = 20
const DESACELERACAO_MAXIMA = -60

type Projecao = {
  progress: number
  lateral: number
  /** Velocidade no instante pedido, em m/s. */
  velocidade: number
  state: RivalState
  stale: boolean
  boosting: boolean
}

export class GhostTracker {
  private buffer: GhostSnapshot[] = []
  /** O que foi mostrado na última amostra: é dele que a correção parte. */
  private exibido: { now: number; progress: number; lateral: number } | null = null
  /** Instante da primeira medição de chegada. */
  private chegadaEm: number | null = null

  /** Guarda uma medição, aceitando chegada fora de ordem. */
  push(snapshot: GhostSnapshot) {
    if (!Number.isFinite(snapshot.t) || !Number.isFinite(snapshot.progress)) return
    const medicao: GhostSnapshot = {
      t: snapshot.t,
      progress: snapshot.progress,
      lateral: Number.isFinite(snapshot.lateral) ? snapshot.lateral : 0,
      speed: Number.isFinite(snapshot.speed) ? Math.max(0, snapshot.speed) : 0,
      state: snapshot.state === 'finished' ? 'finished' : 'racing',
      boosting: snapshot.boosting === true,
    }

    const repetida = this.buffer.findIndex((item) => item.t === medicao.t)
    if (repetida >= 0) {
      // A chegada pode sair no mesmo milissegundo da última medição comum: ela
      // vale mais do que a repetição, senão o rival nunca chegaria na tela.
      if (medicao.state === 'finished' && this.buffer[repetida].state === 'racing') this.buffer[repetida] = medicao
      else return
    } else {
      let index = this.buffer.length
      while (index > 0 && this.buffer[index - 1].t > medicao.t) index -= 1
      this.buffer.splice(index, 0, medicao)
      if (this.buffer.length > BUFFER_SIZE) this.buffer.splice(0, this.buffer.length - BUFFER_SIZE)
    }
    if (medicao.state === 'finished' && (this.chegadaEm === null || medicao.t < this.chegadaEm)) this.chegadaEm = medicao.t
  }

  /** Posição do fantasma no instante pedido, já suavizada. */
  sample(now: number): GhostSample | null {
    if (this.buffer.length === 0) return null
    const alvo = this.projetar(now)
    const anterior = this.exibido

    let progress = alvo.progress
    let lateral = alvo.lateral
    if (anterior && now > anterior.now && now - anterior.now < 1_000) {
      const passo = now - anterior.now
      // Anda no ritmo que a projeção tem agora e fecha uma parte da diferença,
      // com teto: a correção parece o rival acelerando, não o carro saltando.
      const previsto = anterior.progress + alvo.velocidade * (passo / 1000)
      const erro = alvo.progress - previsto
      if (Math.abs(erro) > SALTO_MAXIMO_M) {
        progress = alvo.progress
      } else {
        const fracao = erro * (1 - Math.exp(-passo / CORRECAO_MS))
        // Só a correção para a frente tem teto; a para trás só desacelera o
        // carro, e o piso logo abaixo o impede de recuar.
        progress = previsto + Math.min(CORRECAO_MAXIMA_MPS * (passo / 1000), fracao)
      }
      lateral = anterior.lateral + (alvo.lateral - anterior.lateral) * (1 - Math.exp(-passo / CORRECAO_LATERAL_MS))
    }
    // O progresso mostrado nunca recua: uma projeção que passou do ponto espera
    // o rival alcançá-la, em vez de puxar o carro para trás.
    if (anterior) progress = Math.max(anterior.progress, progress)
    progress = Math.min(TRACK_LENGTH, progress)

    this.exibido = { now: Math.max(now, anterior?.now ?? now), progress, lateral }
    return {
      progress,
      lateral,
      speed: alvo.velocidade * 3.6,
      state: alvo.state,
      stale: alvo.stale,
      finishedAt: this.chegadaEm,
      boosting: alvo.boosting,
    }
  }

  get latest() {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null
  }

  reset() {
    this.buffer = []
    this.exibido = null
    this.chegadaEm = null
  }

  /** Onde o rival estaria em `now` pelas medições conhecidas, sem suavização. */
  private projetar(now: number): Projecao {
    const newest = this.buffer[this.buffer.length - 1]
    const oldest = this.buffer[0]

    if (now <= oldest.t) {
      return {
        progress: oldest.progress,
        lateral: oldest.lateral,
        velocidade: oldest.speed / 3.6,
        state: oldest.state,
        stale: false,
        boosting: oldest.state === 'racing' && oldest.boosting === true,
      }
    }
    if (now < newest.t) return this.interpolar(now)

    const idade = now - newest.t
    const stale = idade > MAX_EXTRAPOLATION_MS
    if (newest.state === 'finished') {
      return { progress: newest.progress, lateral: newest.lateral, velocidade: 0, state: 'finished', stale, boosting: false }
    }

    const h = Math.min(idade, MAX_EXTRAPOLATION_MS) / 1000
    const v0 = newest.speed / 3.6
    const a = this.aceleracao()
    // A aceleração vale no começo da projeção; depois o carro segue no ritmo
    // a que ela o levou. Frear até parar não vira ré.
    const ha = Math.min(h, JANELA_DA_ACELERACAO_MS / 1000)
    const v1 = Math.max(0, v0 + a * ha)
    const avancoAcelerando = a < 0 && v0 + a * ha < 0 ? (v0 * v0) / (2 * -a) : ((v0 + v1) / 2) * ha
    const progress = Math.min(TRACK_LENGTH, newest.progress + avancoAcelerando + v1 * (h - ha))

    const anterior = this.medicaoAntes(newest.t - INTERVALO_MINIMO_MS, newest.t - HORIZONTE_LATERAL_MS - 250)
    const deriva = anterior ? (newest.lateral - anterior.lateral) / ((newest.t - anterior.t) / 1000) : 0
    const lateral = Math.max(
      -LATERAL_LIMIT,
      Math.min(LATERAL_LIMIT, newest.lateral + Math.max(-3, Math.min(3, deriva)) * Math.min(h, HORIZONTE_LATERAL_MS / 1000)),
    )

    // O boost é o da medição mais nova; sem sinal, não se afirma nada.
    return { progress, lateral, velocidade: stale ? 0 : h < ha ? Math.max(0, v0 + a * h) : v1, state: 'racing', stale, boosting: !stale && newest.boosting === true }
  }

  private interpolar(target: number): Projecao {
    let after = this.buffer.length - 1
    while (after > 0 && this.buffer[after - 1].t > target) after -= 1
    const next = this.buffer[after]
    const previous = this.buffer[after - 1] ?? next
    const span = next.t - previous.t
    const ratio = span > 0 ? (target - previous.t) / span : 1
    const speed = previous.speed + (next.speed - previous.speed) * ratio
    return {
      progress: previous.progress + (next.progress - previous.progress) * ratio,
      lateral: previous.lateral + (next.lateral - previous.lateral) * ratio,
      velocidade: speed / 3.6,
      state: ratio >= 1 ? next.state : previous.state,
      stale: false,
      boosting: (ratio >= 1 ? next : previous).state === 'racing' && (ratio >= 1 ? next : previous).boosting === true,
    }
  }

  /** Aceleração das últimas medições, em m/s², já limitada ao que um carro faz. */
  private aceleracao() {
    const newest = this.buffer[this.buffer.length - 1]
    const anterior = this.medicaoAntes(newest.t - INTERVALO_MINIMO_MS, newest.t - JANELA_DA_ACELERACAO_MS - 250)
    if (!anterior || anterior.state === 'finished') return 0
    const a = (newest.speed - anterior.speed) / 3.6 / ((newest.t - anterior.t) / 1000)
    return Math.max(DESACELERACAO_MAXIMA, Math.min(ACELERACAO_MAXIMA, a))
  }

  /** A medição mais recente feita até `ate`, desde que não seja anterior a `desde`. */
  private medicaoAntes(ate: number, desde: number) {
    for (let i = this.buffer.length - 2; i >= 0; i -= 1) {
      const medicao = this.buffer[i]
      if (medicao.t > ate) continue
      return medicao.t >= desde ? medicao : null
    }
    return null
  }
}

export type RivalGap = {
  /** Positivo quando o rival está à frente. */
  meters: number
  seconds: number
  ahead: boolean
  /** P1 quando o jogador lidera. */
  position: 'P1' | 'P2'
}

/**
 * Diferença entre os dois carros. Os segundos usam o ritmo médio da dupla,
 * com um piso para o número não explodir quando alguém está quase parado.
 */
export function gapBetween(
  playerProgress: number,
  rivalProgress: number,
  playerSpeed: number,
  rivalSpeed: number,
): RivalGap {
  const meters = rivalProgress - playerProgress
  const pace = Math.max(15, (playerSpeed + rivalSpeed) / 2 / 3.6)
  return {
    meters,
    seconds: Math.abs(meters) / pace,
    ahead: meters > 0,
    position: meters > 0 ? 'P2' : 'P1',
  }
}

export type RivalSide = 'esquerda' | 'direita' | 'mesma faixa'

export function rivalSide(playerLateral: number, rivalLateral: number): RivalSide {
  const difference = rivalLateral - playerLateral
  if (Math.abs(difference) < 0.12) return 'mesma faixa'
  return difference < 0 ? 'esquerda' : 'direita'
}

/** Texto do indicador usado quando o rival não aparece na tela. */
export function offScreenNotice(gap: RivalGap, side: RivalSide) {
  const direction = gap.ahead ? 'à frente' : 'atrás'
  const distance = `${Math.round(Math.abs(gap.meters))} m`
  return side === 'mesma faixa'
    ? `Adversário ${direction} — ${distance}`
    : `Adversário ${direction} — lado ${side} — ${distance}`
}

/** Texto da posição, no formato dos exemplos do plano. */
export function positionNotice(gap: RivalGap) {
  const direction = gap.ahead ? 'à frente' : 'atrás'
  return `${gap.position} — Rival ${gap.seconds.toFixed(1).replace('.', ',')} s ${direction}`
}
