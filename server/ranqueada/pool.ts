import { DIFICULDADE_OFICIAL, tempoDoPiloto } from '../../src/game/contrarrelogio.js'
import { correrSemTela } from '../../src/game/corridaSimulada.js'
import { semanaDe } from '../../src/game/desafios.js'
import { hash32 } from '../../src/game/layout.js'
import { noLimiteDoAsfalto } from '../../src/game/piloto.js'

/**
 * O pool semanal de sementes da ranqueada.
 *
 * No jogo casual cada corrida estreia um traçado. Na ranqueada as pistas saem
 * de um pool de dez por semana, como a campanha do Trackmania: quem joga mais
 * aprende as pistas, e as voltas gravadas podem ser reaproveitadas como
 * fantasmas. O pool é curado pelos pilotos de teste: fica só a semente em que
 * o iniciante termina dentro da janela do plano — sessenta a noventa
 * segundos — e em que usar tudo rende mais que só desviar.
 */

export const SEMENTES_POR_SEMANA = 10
const CANDIDATAS = 16

// A semana do pool é a dos Desafios da Semana: vira na segunda, em Brasília.
export { semanaDe }

/** As candidatas de uma semana, antes da curadoria. */
export function candidatas(semana: number) {
  return Array.from({ length: CANDIDATAS }, (_, i) => hash32(semana, 0x5eed + i))
}

/** Se a semente serve à ranqueada: o iniciante termina na janela, e a habilidade rende tempo. */
export function sementeBoa(seed: number) {
  const iniciante = correrSemTela(() => noLimiteDoAsfalto(), { seed, difficulty: DIFICULDADE_OFICIAL }).tempo
  const referencia = tempoDoPiloto(seed, DIFICULDADE_OFICIAL)
  return iniciante > 60 && iniciante < 90 && referencia < iniciante * 0.95
}

/**
 * O pool, curado aos poucos, sem travar o servidor.
 *
 * Cada semente pede duas provas simuladas, umas dezenas de milissegundos cada.
 * A curadoria roda uma por vez, cedendo a vez ao resto do servidor entre elas,
 * e enquanto ela não termina o sorteio usa as candidatas cruas: a primeira
 * corrida da semana não espera.
 */
export class PoolDeSementes {
  private semana = -1
  private curadas: number[] = []
  private preparando: Promise<void> | null = null

  constructor(
    private readonly agora: () => number = Date.now,
    private readonly aleatorio: () => number = Math.random,
  ) {}

  /** Uma semente do pool desta semana. */
  sortear() {
    const semana = semanaDe(this.agora())
    if (semana !== this.semana) void this.preparar(semana)
    const lista = this.curadas.length > 0 ? this.curadas : candidatas(semana).slice(0, SEMENTES_POR_SEMANA)
    return lista[Math.floor(this.aleatorio() * lista.length)]
  }

  /** As sementes curadas desta semana, depois de prontas. */
  async sementes(): Promise<number[]> {
    const semana = semanaDe(this.agora())
    if (semana !== this.semana || this.preparando) await this.preparar(semana)
    return [...this.curadas]
  }

  private preparar(semana: number) {
    if (this.semana === semana && this.preparando) return this.preparando
    this.semana = semana
    this.curadas = []
    this.preparando = (async () => {
      const boas: number[] = []
      for (const seed of candidatas(semana)) {
        await new Promise((resolve) => setImmediate(resolve))
        if (this.semana !== semana) return
        if (sementeBoa(seed)) boas.push(seed)
        if (boas.length >= SEMENTES_POR_SEMANA) break
      }
      // Se a curadoria recusar demais, completa com as candidatas: melhor uma
      // pista comum que uma fila parada.
      const completas = boas.length >= 3 ? boas : [...boas, ...candidatas(semana).filter((seed) => !boas.includes(seed))].slice(0, SEMENTES_POR_SEMANA)
      if (this.semana === semana) this.curadas = completas
      this.preparando = null
    })()
    return this.preparando
  }
}
