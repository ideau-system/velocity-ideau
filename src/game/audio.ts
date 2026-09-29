/**
 * Som da corrida.
 *
 * O motor é um V10 gravado, tocado por `motorF1.ts` a partir de laços em
 * `public/audio/motor`. Todo o resto — vento, rolamento, cascalho, boost — sai
 * de um buffer de ruído criado no próprio navegador, e o motor também tem a
 * sua versão de osciladores: é ela que toca enquanto as amostras não chegam,
 * ou se não chegarem. A demonstração nunca depende de um arquivo para ter som.
 *
 * A parte que decide *o quê* tocar é pura e fica aqui em cima, separada da
 * parte que fala com o Web Audio. É o que permite testar a marcha, a rotação
 * e a mistura sem precisar de um navegador.
 *
 * A música é a Rádio Fantasma, de `radio.ts`: cinco faixas — o rock de
 * `trilha.ts`, o Turbo de `trilhaTurbo.ts` e as de `trilhaMotorQuente.ts`,
 * `trilhaUltimaVolta.ts` e `trilhaLargada.ts` —, tocando pelo mesmo contexto e
 * pelo mesmo volume geral: desligar o som desliga a música junto.
 */
import { soltarAoAcabar } from './banda'
import type { CarId } from './cars'
import { MotorF1, vozDoCarro } from './motorF1'
import { Radio, type FaixaDaRadio } from './radio'

/** As faixas da trilha sonora. */
export type Faixa = 'rock' | 'turbo'

/**
 * A faixa de uma corrida sai da semente do traçado.
 *
 * A semente é a mesma em todos os aparelhos da sala, então todos os pilotos
 * largam ouvindo a mesma música — e a próxima prova, com outra semente, tem
 * metade de chance de trocar de faixa.
 */
export function faixaDaCorrida(semente: number): Faixa {
  const inteiro = Number.isFinite(semente) ? Math.abs(Math.floor(semente)) : 0
  return inteiro % 2 === 0 ? 'rock' : 'turbo'
}

/** O que a corrida informa ao som a cada quadro. */
export type AudioLevels = {
  /** Velocidade de 0 a 1, a mesma normalização de `feel`. */
  speed: number
  /** O quanto o boost está atuando, de 0 a 1. */
  boost: number
  /** O quanto o carro está fora do asfalto, de 0 a 1. */
  offRoad: number
  /** Falso antes da largada e depois da bandeirada: o motor fica em marcha lenta. */
  running: boolean
  /**
   * Marcha engatada na física: 0 é a primeira. Presente, o motor segue o
   * câmbio do carro, e cada troca que o piloto faz é a que se ouve. Ausente —
   * na arquibancada, que só conhece a velocidade —, o som escolhe a marcha.
   */
  marcha?: number
  /** Giro dentro da marcha, de 0 a 1: em 1 o motor bate no corte. */
  giro?: number
  /**
   * Pé no acelerador. Sem ele, o motor corre solto e o escapamento estoura; no
   * grid, com ele, o piloto segura o giro da largada.
   */
  acelerador?: boolean
  /** Pé no freio. */
  freando?: boolean
  /** Batendo no limitador de giro. */
  noCorte?: boolean
}

/**
 * Fim de cada marcha, em fração da velocidade máxima, para quando o som não
 * conhece o câmbio da física — a arquibancada.
 *
 * É a nota subindo, caindo e subindo de novo que dá escala à velocidade: uma
 * sirene que sobe uma vez só vira ruído de fundo, e o ouvido deixa de medir o
 * quanto o carro está rápido.
 */
export const GEAR_EDGES = [0.2, 0.36, 0.55, 0.78, 1.01]

/** Rotação em marcha lenta, para o motor nunca ficar mudo. */
export const IDLE_RPM = 0.18

/** Frequência do motor com o carro parado, em hertz. */
export const ENGINE_BASE_HZ = 58

/** Quanto a frequência sobe entre a marcha lenta e o corte. */
export const ENGINE_SWEEP_HZ = 210

/** Volume geral. Baixo de propósito: é um jogo de navegador, não um cinema. */
export const MASTER_GAIN = 0.34

export type EngineTone = {
  /** Índice da marcha, de 0 em diante. */
  gear: number
  /** Rotação dentro da marcha, de IDLE_RPM a 1. */
  rpm: number
  frequency: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Marcha, rotação e frequência para a marcha e o giro da física.
 *
 * É a mesma nota de `engineTone`, só que presa ao câmbio do carro: a troca
 * que o piloto faz é a que o sintetizador toca.
 */
export function tomDaMarcha(marcha: number, giro: number): EngineTone {
  const g = Number.isFinite(giro) ? clamp(giro, 0, 1) : 0
  const rpm = IDLE_RPM + (1 - IDLE_RPM) * g
  return { gear: Number.isFinite(marcha) ? Math.max(0, Math.round(marcha)) : 0, rpm, frequency: ENGINE_BASE_HZ + rpm * ENGINE_SWEEP_HZ }
}

/** Marcha, rotação e frequência para uma dada fração da velocidade máxima. */
export function engineTone(speedRatio: number): EngineTone {
  const ratio = clamp(speedRatio, 0, 1)
  let gear = 0
  while (gear < GEAR_EDGES.length - 1 && ratio >= GEAR_EDGES[gear]) gear += 1

  const base = gear === 0 ? 0 : GEAR_EDGES[gear - 1]
  const topo = GEAR_EDGES[gear]
  const dentro = topo > base ? (ratio - base) / (topo - base) : 0
  const rpm = IDLE_RPM + (1 - IDLE_RPM) * clamp(dentro, 0, 1)

  return { gear, rpm, frequency: ENGINE_BASE_HZ + rpm * ENGINE_SWEEP_HZ }
}

export type AudioMix = {
  engine: number
  /** Ar batendo na carroceria: cresce com o quadrado da velocidade. */
  wind: number
  /** Pneu no asfalto. */
  roll: number
  /** Pneu na grama: mais áspero e mais alto que o asfalto. */
  gravel: number
  boost: number
  /** Corte do filtro do motor, em hertz. Abre com a rotação e com o boost. */
  cutoff: number
}

/** Volume de cada camada para um dado estado da corrida. */
export function mixFor(levels: AudioLevels, tone: EngineTone): AudioMix {
  const speed = clamp(levels.speed, 0, 1)
  const offRoad = clamp(levels.offRoad, 0, 1)
  const boost = clamp(levels.boost, 0, 1)

  return {
    engine: levels.running ? 0.42 + tone.rpm * 0.3 + boost * 0.2 : 0.22,
    // O arrasto do ar é quadrático, e é isso que faz a diferença entre 200 e
    // 250 km/h ser audível mesmo com a nota do motor parecida.
    wind: levels.running ? speed * speed * 0.6 : 0,
    roll: levels.running ? speed * 0.26 * (1 - offRoad) : 0,
    gravel: levels.running ? offRoad * (0.2 + speed * 0.55) : 0,
    boost: boost * 0.42,
    cutoff: 320 + tone.rpm * 2_400 + boost * 900,
  }
}

// ---------------------------------------------------------------------------
// Ligação com o Web Audio
// ---------------------------------------------------------------------------

/** Só o que este módulo usa de um AudioContext, para o teste poder fingir. */
export type AudioHost = Pick<
  AudioContext,
  | 'createOscillator'
  | 'createGain'
  | 'createBiquadFilter'
  | 'createBufferSource'
  | 'createBuffer'
  | 'createWaveShaper'
  | 'createDelay'
  | 'currentTime'
  | 'destination'
  | 'sampleRate'
  | 'state'
  | 'resume'
  | 'close'
>

/** Constante de tempo das rampas: curta para responder, longa para não chiar. */
const RAMPA = 0.06

export class RaceAudio {
  private readonly master: GainNode
  private readonly engineGain: GainNode
  private readonly engineFilter: BiquadFilterNode
  private readonly osciladores: OscillatorNode[] = []
  private readonly ruido: AudioBufferSourceNode
  private readonly windGain: GainNode
  private readonly rollGain: GainNode
  private readonly gravelGain: GainNode
  private readonly boostGain: GainNode
  /** O V10 gravado. Enquanto ele não está pronto, tocam os osciladores. */
  private readonly motorF1: MotorF1
  private readonly trilha: Radio
  private silenciado = false
  /** A música como o jogador a deixou; mudo, ela também para de tocar notas. */
  private musicaLigada = true
  private encerrado = false
  /** Marcha do quadro anterior, para marcar a troca. */
  private marcha = 0
  /**
   * Até quando os osciladores de reserva tocam, no relógio do áudio. Infinito
   * enquanto o motor gravado não assume.
   */
  private sintetizadorAte = Infinity
  /** Quando o som foi pedido, para saber se o contexto ficou travado. */
  private readonly criadoEm = performance.now()

  /** `carro` escolhe a voz do motor: o V6 turbo, o V10, o V8 ou o híbrido da época dele. */
  constructor(private readonly ctx: AudioHost, faixa: Faixa = 'rock', carro?: CarId) {
    const agora = ctx.currentTime

    this.master = ctx.createGain()
    this.master.gain.setValueAtTime(MASTER_GAIN, agora)
    this.master.connect(ctx.destination)

    // Motor: uma serra na fundamental e outra uma oitava abaixo, levemente
    // desafinadas. Duas vozes bastam para soar como motor em vez de apito.
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.Q.setValueAtTime(3.2, agora)
    this.engineGain = ctx.createGain()
    this.engineGain.gain.setValueAtTime(0, agora)
    this.engineFilter.connect(this.engineGain).connect(this.master)

    // Uma única fonte de ruído alimenta vento, rolamento, cascalho e os
    // estalos do escapamento. Várias soariam igual e custariam mais.
    const ruido = ruidoBranco(ctx)

    // As amostras começam a chegar agora; até ficarem prontas, os osciladores
    // abaixo fazem o papel do motor.
    this.motorF1 = new MotorF1(ctx, this.master, vozDoCarro(carro), ruido)

    for (const [tipo, desafinacao, ganho] of [
      ['sawtooth', 0, 1],
      ['sawtooth', -1_200, 0.7],
      ['square', 7, 0.25],
    ] as const) {
      const osc = ctx.createOscillator()
      osc.type = tipo
      osc.detune.setValueAtTime(desafinacao, agora)
      const voz = ctx.createGain()
      voz.gain.setValueAtTime(ganho, agora)
      osc.connect(voz).connect(this.engineFilter)
      osc.start()
      this.osciladores.push(osc)
    }

    this.ruido = ctx.createBufferSource()
    this.ruido.buffer = ruido
    this.ruido.loop = true

    this.windGain = this.camadaDeRuido(ctx, 'bandpass', 1_100, 0.8)
    this.rollGain = this.camadaDeRuido(ctx, 'lowpass', 420, 1)
    this.gravelGain = this.camadaDeRuido(ctx, 'bandpass', 1_900, 1.6)
    this.boostGain = this.camadaDeRuido(ctx, 'highpass', 2_600, 0.7)
    this.ruido.start()

    // A rádio abre na faixa da corrida e usa o mesmo ruído para a bateria: é
    // o mesmo chiado que vira vento, só que cortado em golpes.
    this.trilha = new Radio(ctx, this.master, this.ruido.buffer!, faixa)
  }

  private camadaDeRuido(ctx: AudioHost, tipo: BiquadFilterType, frequencia: number, q: number) {
    const agora = ctx.currentTime
    const filtro = ctx.createBiquadFilter()
    filtro.type = tipo
    filtro.frequency.setValueAtTime(frequencia, agora)
    filtro.Q.setValueAtTime(q, agora)
    const ganho = ctx.createGain()
    ganho.gain.setValueAtTime(0, agora)
    this.ruido.connect(filtro).connect(ganho).connect(this.master)
    return ganho
  }

  /** Atualiza as camadas a partir do estado da corrida. Chamado por quadro. */
  update(levels: AudioLevels) {
    if (this.encerrado) return
    const agora = this.ctx.currentTime
    const tone =
      levels.running && levels.marcha !== undefined && levels.giro !== undefined
        ? tomDaMarcha(levels.marcha, levels.giro)
        : engineTone(levels.speed)
    const mix = mixFor(levels, tone)

    // A troca de marcha corta o som por um instante, como uma embreagem. É o
    // detalhe que faz o ouvido perceber que a escala recomeçou.
    const trocou = tone.gear !== this.marcha
    this.marcha = tone.gear

    // Com o V10 gravado tocando, os osciladores se calam: os dois juntos
    // soariam como um motor e uma sirene. E depois param de vez, porque um
    // oscilador mudo com a frequência automatizada ainda custa, amostra por
    // amostra, até o fim da corrida. O motor gravado, uma vez pronto, não
    // volta atrás.
    const comAmostras = this.motorF1.update(levels)
    if (comAmostras && this.sintetizadorAte === Infinity) {
      // Dez constantes de tempo da queda: o que sobra está 87 dB abaixo.
      this.sintetizadorAte = agora + 1.5
      this.engineGain.gain.setTargetAtTime(0, agora, 0.15)
      for (const osc of this.osciladores) osc.stop(this.sintetizadorAte)
      soltarAoAcabar(this.osciladores[2], this.engineFilter, this.engineGain)
    }
    // Durante a queda, o tom ainda acompanha o carro.
    if (agora < this.sintetizadorAte) {
      this.osciladores[0].frequency.setTargetAtTime(tone.frequency, agora, RAMPA * 0.5)
      this.osciladores[1].frequency.setTargetAtTime(tone.frequency, agora, RAMPA * 0.5)
      this.osciladores[2].frequency.setTargetAtTime(tone.frequency * 2, agora, RAMPA * 0.5)
      this.engineFilter.frequency.setTargetAtTime(mix.cutoff, agora, RAMPA)
    }
    if (!comAmostras) {
      this.engineGain.gain.setTargetAtTime(trocou ? mix.engine * 0.35 : mix.engine, agora, trocou ? 0.01 : RAMPA)
    }
    this.windGain.gain.setTargetAtTime(mix.wind, agora, RAMPA)
    this.rollGain.gain.setTargetAtTime(mix.roll, agora, RAMPA)
    this.gravelGain.gain.setTargetAtTime(mix.gravel, agora, RAMPA)
    this.boostGain.gain.setTargetAtTime(mix.boost, agora, RAMPA)
  }

  /**
   * O contexto travado — sem gesto que o destravasse — tem o relógio parado.
   * Os bipes e os baques agendados nele se empilhariam no mesmo instante e
   * sairiam todos juntos no primeiro toque, num estouro. Passado o tempo de a
   * saída abrir, o que o contexto travado pede é descartado.
   */
  private get travado() {
    return this.ctx.state !== 'running' && performance.now() - this.criadoEm > 1_500
  }

  /** Baque do impacto: um estouro grave que decai rápido. */
  impact(intensidade = 1) {
    // Mudo, seria inaudível de todo jeito.
    if (this.encerrado || this.silenciado || this.travado) return
    const agora = this.ctx.currentTime
    const forca = clamp(intensidade, 0, 1)

    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(190, agora)
    osc.frequency.exponentialRampToValueAtTime(46, agora + 0.26)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0.5 * forca, agora)
    ganho.gain.exponentialRampToValueAtTime(0.001, agora + 0.3)
    osc.connect(ganho).connect(this.master)
    osc.start(agora)
    osc.stop(agora + 0.32)
    soltarAoAcabar(osc, ganho)
  }

  /**
   * Bipe das luzes da largada. Passa pelo mesmo contexto de todo o resto.
   *
   * `atraso` agenda o bipe no relógio do áudio, que não engasga com o quadro.
   */
  beep(frequencia: number, duracao = 0.12, atraso = 0) {
    if (this.encerrado || this.silenciado || this.travado) return
    const agora = this.ctx.currentTime + Math.max(0, atraso)
    const osc = this.ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(frequencia, agora)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0.16, agora)
    ganho.gain.exponentialRampToValueAtTime(0.001, agora + duracao)
    osc.connect(ganho).connect(this.master)
    osc.start(agora)
    osc.stop(agora + duracao + 0.02)
    soltarAoAcabar(osc, ganho)
  }

  /** Começa a trilha do primeiro compasso: é o "VAI!" da largada. */
  startMusic() {
    if (!this.encerrado) this.trilha.start()
  }

  /** A trilha some aos poucos, na bandeirada. */
  stopMusic() {
    if (!this.encerrado) this.trilha.stop()
  }

  /** Liga ou desliga só a música, deixando motor e efeitos como estão. */
  setMusicEnabled(ligada: boolean) {
    this.musicaLigada = ligada
    if (!this.encerrado) this.trilha.setEnabled(ligada && !this.silenciado)
  }

  /** Pula para a próxima faixa da rádio. */
  proximaFaixa() {
    if (!this.encerrado) this.trilha.proxima()
  }

  /** A faixa no ar — ou a que abre a corrida, antes da largada. */
  get faixaNoAr(): FaixaDaRadio {
    return this.trilha.faixa
  }

  /** Avisa a cada faixa que entra no ar. Devolve a função que cancela o aviso. */
  aoTrocarDeFaixa(ouvinte: (faixa: FaixaDaRadio) => void) {
    return this.trilha.aoTrocar(ouvinte)
  }

  get muted() {
    return this.silenciado
  }

  /**
   * Mudo, a trilha também para de montar notas: atrás do volume zero elas
   * custariam o mesmo que tocando. Religado, ela volta no ponto em que estaria.
   */
  setMuted(silenciado: boolean) {
    if (this.encerrado) return
    this.silenciado = silenciado
    this.motorF1.silenciado = silenciado
    this.master.gain.setTargetAtTime(silenciado ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.05)
    this.trilha.setEnabled(this.musicaLigada && !silenciado)
  }

  /**
   * O navegador começa suspenso até um gesto do usuário, e o iPhone
   * interrompe o áudio numa ligação ou na troca de app (o estado
   * `interrupted`, que o tipo do DOM ainda não conhece).
   */
  resume() {
    if (this.encerrado) return
    const estado = this.ctx.state as string
    if (estado !== 'running' && estado !== 'closed') void this.ctx.resume().catch(() => {})
  }

  close() {
    if (this.encerrado) return
    this.trilha.close()
    this.motorF1.close()
    this.encerrado = true
    for (const osc of this.osciladores) {
      try {
        osc.stop()
      } catch {
        // Já parado: não há o que fazer.
      }
    }
    try {
      this.ruido.stop()
    } catch {
      // Idem.
    }
    void this.ctx.close()
  }
}

/** Dois segundos de ruído branco em laço: base do vento e do cascalho. */
export function ruidoBranco(ctx: Pick<AudioHost, 'createBuffer' | 'sampleRate'>) {
  const amostras = Math.floor(ctx.sampleRate * 2)
  const buffer = ctx.createBuffer(1, amostras, ctx.sampleRate)
  const canal = buffer.getChannelData(0)
  for (let i = 0; i < amostras; i += 1) canal[i] = Math.random() * 2 - 1
  return buffer
}
