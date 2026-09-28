// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { aplicarLargada, type Largada } from './largada.js'
import { createRaceContext, createTrackLayout } from './layout.js'
import type { RaceRules } from './rules.js'
import { advanceRace, createRaceState, type RaceInput } from './simulation.js'
import type { Difficulty } from './rules.js'

/**
 * Os comandos de uma volta, para o servidor refazê-la.
 *
 * A física é determinística: dado o traçado, a duração de cada quadro e o
 * comando daquele quadro, a volta sai sempre igual. É o que o Trackmania usa
 * para validar recordes — mandar os comandos, e não o resultado —, e aqui vale
 * para o contrarrelógio, que não tem vácuo nem rival.
 *
 * A duração de cada quadro vai em microssegundos, e o jogo passa à física
 * exatamente esse valor arredondado: assim a volta refeita no servidor percorre
 * os mesmos passos que a do aparelho. O que ainda pode divergir é o último bit
 * de `Math.exp` e `Math.pow`, que muda de um motor de JavaScript para outro —
 * e por isso a comparação tem tolerância.
 */
export type RegistroDeEntradas = {
  /** Duração de cada quadro de física, em microssegundos. */
  quadrosUs: number[]
  /**
   * Os comandos, em trechos: `[bits, quadros, bits, quadros, …]`. Bit 1 é
   * esquerda, 2 é direita, 4 é boost, 8 é o pé fora do acelerador, 16 é o
   * freio, 32 e 64 são as borboletas de subir e de reduzir, e 128 é o câmbio
   * manual.
   *
   * O acelerador vai invertido de propósito: sem o bit, o pé está no fundo, que
   * é o que valia antes de o carro ter pedal — e o que vale no toque.
   */
  comandos: number[]
  /** A largada, e antes de qual quadro ela foi aplicada. */
  largada: (Largada & { quadro: number }) | null
  /**
   * Saltos do relógio da prova que não passaram pela física: a aba em segundo
   * plano congela o quadro, mas não o relógio. `[quadro, segundos, …]`.
   */
  saltos: number[]
}

/** Mais quadros que isto não é uma volta: são mais de oito minutos a 60 quadros por segundo. */
export const MAIOR_REGISTRO = 30_000

/** O passo que o jogo entrega à física: a duração do quadro, arredondada ao microssegundo. */
export function quantizarPasso(dt: number) {
  if (!Number.isFinite(dt) || dt <= 0) return 0
  return Math.round(Math.min(dt, 1) * 1e6) / 1e6
}

/** O maior valor que os bits de um quadro podem ter. */
const MAIORES_BITS = 255

export function bitsDe(input: RaceInput) {
  return (
    (input.left ? 1 : 0) |
    (input.right ? 2 : 0) |
    (input.boost ? 4 : 0) |
    (input.throttle === false ? 8 : 0) |
    (input.brake ? 16 : 0) |
    (input.shiftUp ? 32 : 0) |
    (input.shiftDown ? 64 : 0) |
    (input.manual ? 128 : 0)
  )
}

export function inputDe(bits: number): RaceInput {
  return {
    left: (bits & 1) !== 0,
    right: (bits & 2) !== 0,
    boost: (bits & 4) !== 0,
    throttle: (bits & 8) === 0,
    brake: (bits & 16) !== 0,
    shiftUp: (bits & 32) !== 0,
    shiftDown: (bits & 64) !== 0,
    manual: (bits & 128) !== 0,
  }
}

/** Grava os comandos de cada quadro de física. */
export class GravadorDeEntradas {
  private readonly quadrosUs: number[] = []
  private readonly comandos: number[] = []
  private readonly saltos: number[] = []
  private largada: RegistroDeEntradas['largada'] = null

  get quadros() {
    return this.quadrosUs.length
  }

  registrarLargada(largada: Largada) {
    this.largada = { ...largada, quadro: this.quadrosUs.length }
  }

  /** Registra um quadro: o passo já quantizado, o comando, e quanto o relógio saltou além dele. */
  registrar(passo: number, input: RaceInput, salto = 0) {
    if (this.quadrosUs.length >= MAIOR_REGISTRO) return
    if (salto > 0) this.saltos.push(this.quadrosUs.length, Math.round(salto * 1000) / 1000)
    this.quadrosUs.push(Math.round(passo * 1e6))
    const bits = bitsDe(input)
    const n = this.comandos.length
    if (n >= 2 && this.comandos[n - 2] === bits) this.comandos[n - 1] += 1
    else this.comandos.push(bits, 1)
  }

  terminar(): RegistroDeEntradas {
    return { quadrosUs: [...this.quadrosUs], comandos: [...this.comandos], largada: this.largada, saltos: [...this.saltos] }
  }
}

/** Confere um registro vindo da rede. Devolve null para o que não for um registro válido. */
export function registroValido(bruto: unknown): RegistroDeEntradas | null {
  if (!bruto || typeof bruto !== 'object') return null
  const { quadrosUs, comandos, largada, saltos } = bruto as Partial<RegistroDeEntradas>
  if (!Array.isArray(quadrosUs) || !Array.isArray(comandos) || !Array.isArray(saltos)) return null
  if (quadrosUs.length === 0 || quadrosUs.length > MAIOR_REGISTRO) return null
  if (!quadrosUs.every((us) => Number.isInteger(us) && us >= 0 && us <= 1_000_000)) return null
  if (comandos.length % 2 !== 0 || saltos.length % 2 !== 0) return null
  let total = 0
  for (let i = 0; i < comandos.length; i += 2) {
    if (!Number.isInteger(comandos[i]) || comandos[i] < 0 || comandos[i] > MAIORES_BITS) return null
    if (!Number.isInteger(comandos[i + 1]) || comandos[i + 1] <= 0) return null
    total += comandos[i + 1]
  }
  if (total !== quadrosUs.length) return null
  if (!saltos.every((valor) => Number.isFinite(valor) && valor >= 0)) return null
  let largadaValida: RegistroDeEntradas['largada'] = null
  if (largada) {
    const { nivel, queimou, quadro } = largada
    if (![0, 1, 2, 3].includes(nivel) || typeof queimou !== 'boolean' || !Number.isInteger(quadro) || quadro < 0) return null
    largadaValida = { nivel, queimou, quadro }
  }
  return { quadrosUs: [...quadrosUs], comandos: [...comandos], largada: largadaValida, saltos: [...saltos] }
}

export type VoltaRefeita = {
  terminou: boolean
  /** Tempo de parede de cada quadro, em segundos desde o primeiro. */
  relogio: Float64Array
  /** Progresso depois de cada quadro. */
  progresso: Float64Array
  /** Tempo de parede no quadro da chegada, ou null. */
  chegada: number | null
}

/**
 * Refaz a volta com a física do jogo, quadro a quadro, a partir dos comandos.
 *
 * `regras` troca as regras do nível — é o que os desafios com modificador usam.
 */
export function refazerVolta(
  registro: RegistroDeEntradas,
  seed: number,
  difficulty: Difficulty,
  regras?: (base: RaceRules) => RaceRules,
): VoltaRefeita {
  const layout = createTrackLayout(seed)
  const context = createRaceContext(layout)
  const state = createRaceState(difficulty)
  if (regras) state.rules = regras(state.rules)
  const n = registro.quadrosUs.length
  const relogio = new Float64Array(n)
  const progresso = new Float64Array(n)
  const saltos = new Map<number, number>()
  for (let i = 0; i < registro.saltos.length; i += 2) saltos.set(registro.saltos[i], registro.saltos[i + 1])

  let quadro = 0
  let tempo = 0
  let chegada: number | null = null
  for (let trecho = 0; trecho < registro.comandos.length && chegada === null; trecho += 2) {
    const input = inputDe(registro.comandos[trecho])
    for (let k = 0; k < registro.comandos[trecho + 1] && chegada === null; k += 1) {
      if (registro.largada && registro.largada.quadro === quadro) aplicarLargada(state, registro.largada)
      const passo = registro.quadrosUs[quadro] / 1e6
      tempo += passo + (saltos.get(quadro) ?? 0)
      // O mesmo avanço do jogo: o quadro longo vira passos iguais, e o
      // servidor os refaz na mesma sequência.
      for (const evento of advanceRace(state, input, passo, context)) {
        if (evento.type === 'finish') chegada = tempo
      }
      relogio[quadro] = tempo
      progresso[quadro] = state.progress
      quadro += 1
    }
  }
  return { terminou: chegada !== null, relogio: relogio.subarray(0, quadro), progresso: progresso.subarray(0, quadro), chegada }
}

/** Progresso da volta refeita num tempo de parede, interpolado entre quadros. */
export function progressoEm(volta: VoltaRefeita, tempo: number) {
  const { relogio, progresso } = volta
  if (relogio.length === 0 || tempo <= relogio[0]) return progresso[0] ?? 0
  let baixo = 0
  let alto = relogio.length - 1
  if (tempo >= relogio[alto]) return progresso[alto]
  while (alto - baixo > 1) {
    const meio = (baixo + alto) >> 1
    if (relogio[meio] < tempo) baixo = meio
    else alto = meio
  }
  const fracao = (tempo - relogio[baixo]) / Math.max(1e-9, relogio[alto] - relogio[baixo])
  return progresso[baixo] + (progresso[alto] - progresso[baixo]) * fracao
}
