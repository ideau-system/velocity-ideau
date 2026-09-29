// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import type { GhostSample } from './ghost.js'
import { LATERAL_LIMIT, TRACK_LENGTH } from './track.js'

/**
 * A volta gravada: o fantasma do recorde.
 *
 * É o que o Trackmania e o contrarrelógio do Mario Kart usam para ensinar sem
 * texto: o próprio melhor tempo correndo ao lado, mostrando onde se ganhou e
 * onde se perdeu. São as mesmas medidas da telemetria da corrida online —
 * progresso, faixa e velocidade —, dez por segundo, guardadas como inteiros
 * para caber no armazenamento do navegador e numa mensagem ao servidor: uma
 * volta de setenta segundos fica em uns dez quilobytes.
 */
export type GravacaoDeVolta = {
  /** Milissegundos entre duas amostras. */
  intervaloMs: number
  /** Progresso em decímetros. */
  progresso: number[]
  /** Posição lateral em milésimos. */
  lateral: number[]
  /** Velocidade em km/h. */
  velocidade: number[]
}

/** Dez amostras por segundo, como a telemetria da corrida online. */
export const INTERVALO_DA_GRAVACAO_MS = 100

/** Maior gravação aceita: cinco minutos de prova. Nada legítimo passa disso. */
const MAIOR_GRAVACAO = 3_000

/** O que o gravador precisa ler do carro. */
type Medida = { progress: number; lateral: number; speed: number }

/** Grava uma volta em intervalos fixos do tempo de prova. */
export class GravadorDeVolta {
  private readonly dados: GravacaoDeVolta = {
    intervaloMs: INTERVALO_DA_GRAVACAO_MS,
    progresso: [],
    lateral: [],
    velocidade: [],
  }

  /** Registra o carro no tempo de prova dado, preenchendo as amostras que venceram até ali. */
  gravar(tempoMs: number, carro: Medida) {
    if (!Number.isFinite(tempoMs)) return
    while (this.dados.progresso.length * this.dados.intervaloMs <= tempoMs && this.dados.progresso.length < MAIOR_GRAVACAO) {
      this.dados.progresso.push(Math.round(carro.progress * 10))
      this.dados.lateral.push(Math.round(carro.lateral * 1000))
      this.dados.velocidade.push(Math.round(carro.speed))
    }
  }

  /** Fecha a gravação com a medida da chegada. */
  terminar(tempoMs: number, carro: Medida): GravacaoDeVolta {
    this.gravar(tempoMs, carro)
    this.dados.progresso.push(Math.round(carro.progress * 10))
    this.dados.lateral.push(Math.round(carro.lateral * 1000))
    this.dados.velocidade.push(Math.round(carro.speed))
    return {
      intervaloMs: this.dados.intervaloMs,
      progresso: [...this.dados.progresso],
      lateral: [...this.dados.lateral],
      velocidade: [...this.dados.velocidade],
    }
  }
}

/**
 * Confere uma gravação vinda de fora — do armazenamento do navegador ou da
 * rede — antes de usá-la. Devolve null para o que não for uma volta válida.
 */
export function gravacaoValida(bruta: unknown): GravacaoDeVolta | null {
  if (!bruta || typeof bruta !== 'object') return null
  const { intervaloMs, progresso, lateral, velocidade } = bruta as Partial<GravacaoDeVolta>
  if (intervaloMs !== INTERVALO_DA_GRAVACAO_MS) return null
  if (!Array.isArray(progresso) || !Array.isArray(lateral) || !Array.isArray(velocidade)) return null
  const n = progresso.length
  if (n < 2 || n > MAIOR_GRAVACAO || lateral.length !== n || velocidade.length !== n) return null
  for (let i = 0; i < n; i += 1) {
    const p = progresso[i]
    const l = lateral[i]
    const v = velocidade[i]
    if (!Number.isInteger(p) || !Number.isInteger(l) || !Number.isInteger(v)) return null
    if (p < 0 || p > TRACK_LENGTH * 10 || (i > 0 && p < progresso[i - 1])) return null
    if (Math.abs(l) > LATERAL_LIMIT * 1000 + 1 || v < 0 || v > 500) return null
  }
  return { intervaloMs, progresso: [...progresso], lateral: [...lateral], velocidade: [...velocidade] }
}

/** Tempo de prova da gravação, em segundos: o instante da última amostra. */
export function duracaoDaGravacao(gravacao: GravacaoDeVolta) {
  return ((gravacao.progresso.length - 1) * gravacao.intervaloMs) / 1000
}

/**
 * Reproduz uma volta gravada como um fantasma.
 *
 * Fala a mesma língua do fantasma de rede — `sample(agora)` —, então a pista o
 * desenha pelo mesmo caminho. O relógio é o da prova: a gravação começa no
 * apagar das luzes desta corrida, como se o recorde largasse junto.
 */
export class ReproducaoDeVolta {
  constructor(
    private readonly gravacao: GravacaoDeVolta,
    private readonly largada: number,
  ) {}

  sample(agora: number): GhostSample | null {
    const { progresso, lateral, velocidade, intervaloMs } = this.gravacao
    const ultima = progresso.length - 1
    const posicao = Math.max(0, (agora - this.largada) / intervaloMs)
    if (posicao >= ultima) {
      return { progress: progresso[ultima] / 10, lateral: lateral[ultima] / 1000, speed: 0, state: 'finished', stale: false }
    }
    const i = Math.floor(posicao)
    const t = posicao - i
    return {
      progress: (progresso[i] + (progresso[i + 1] - progresso[i]) * t) / 10,
      lateral: (lateral[i] + (lateral[i + 1] - lateral[i]) * t) / 1000,
      speed: velocidade[i] + (velocidade[i + 1] - velocidade[i]) * t,
      state: 'racing',
      stale: false,
    }
  }

  /**
   * Em que tempo de prova, em segundos, o recorde passou por aquele ponto da
   * pista. É o delta ao vivo: o tempo do piloto agora menos este.
   */
  tempoEm(metros: number): number | null {
    const { progresso, intervaloMs } = this.gravacao
    const alvo = metros * 10
    if (!(alvo >= 0) || alvo > progresso[progresso.length - 1]) return null
    let baixo = 0
    let alto = progresso.length - 1
    while (alto - baixo > 1) {
      const meio = (baixo + alto) >> 1
      if (progresso[meio] < alvo) baixo = meio
      else alto = meio
    }
    const trecho = progresso[alto] - progresso[baixo]
    const fracao = trecho > 0 ? (alvo - progresso[baixo]) / trecho : 0
    return ((baixo + Math.max(0, Math.min(1, fracao))) * intervaloMs) / 1000
  }
}
