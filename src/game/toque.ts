import type { RaceInput } from './simulation'

/** Os comandos que se seguram: direção, boost e os dois pedais. */
export type Comando = 'left' | 'right' | 'boost' | 'throttle' | 'brake'

/** As borboletas do câmbio: cada toque troca uma marcha, e segurar não troca outra. */
export type Borboleta = 'shiftUp' | 'shiftDown'

const COMANDOS: readonly Comando[] = ['left', 'right', 'boost', 'throttle', 'brake']

function soltos(): Record<Comando, boolean> {
  return { left: false, right: false, boost: false, throttle: false, brake: false }
}

/**
 * Os comandos da corrida, de todas as origens: o teclado e cada dedo na tela.
 *
 * A física lê os comandos uma vez por quadro. Um toque curto — o pulso de
 * volante que segura a linha numa curva — pode começar e acabar entre dois
 * quadros, num engasgo, e aí não existiria para ela. Por isso todo comando
 * que liga fica pendente até o quadro seguinte consumi-lo: vale por pelo
 * menos um quadro.
 *
 * O estado é por dedo, e não por botão: dois dedos no mesmo botão não se
 * anulam quando um deles sai, e o dedo que desliza de um lado para o outro
 * leva o comando junto.
 *
 * As borboletas são contadas, e não seguradas: dois toques rápidos entre dois
 * quadros trocam duas marchas, uma em cada quadro, e segurar a tecla não troca
 * nenhuma a mais.
 */
export class Comandos {
  private readonly teclas = soltos()
  private readonly dedos = new Map<number, Comando>()
  private readonly pendentes = soltos()
  private readonly toques: Record<Borboleta, number> = { shiftUp: 0, shiftDown: 0 }
  /** A entrada entregue à física, reaproveitada a cada quadro. */
  private readonly doQuadro: Required<RaceInput> = {
    left: false,
    right: false,
    boost: false,
    throttle: false,
    brake: false,
    shiftUp: false,
    shiftDown: false,
    manual: false,
  }

  /** Câmbio manual: as borboletas trocam de marcha. No automático, elas não fazem nada. */
  manual = false

  /**
   * O pé fica no fundo sem ninguém segurar: é o acelerador do toque, em que os
   * dois polegares já estão ocupados com a direção e o boost. Só o freio o
   * levanta.
   */
  aceleradorAutomatico = false

  tecla(comando: Comando, ativa: boolean) {
    if (ativa && !this.teclas[comando]) this.pendentes[comando] = true
    this.teclas[comando] = ativa
  }

  /** Um toque na borboleta: da tecla que desceu, ou do dedo no botão. */
  borboleta(qual: Borboleta) {
    this.toques[qual] += 1
  }

  dedoDesceu(dedo: number, comando: Comando) {
    this.dedos.set(dedo, comando)
    this.pendentes[comando] = true
  }

  /** O dedo deslizou para outro botão sem levantar. */
  dedoMudou(dedo: number, comando: Comando) {
    const antes = this.dedos.get(dedo)
    if (antes === undefined || antes === comando) return
    this.dedos.set(dedo, comando)
    this.pendentes[comando] = true
  }

  /** Devolve o comando que o dedo segurava, se segurava algum. */
  dedoSubiu(dedo: number): Comando | undefined {
    const comando = this.dedos.get(dedo)
    this.dedos.delete(dedo)
    return comando
  }

  comandoDoDedo(dedo: number): Comando | undefined {
    return this.dedos.get(dedo)
  }

  /** Algum dedo segura este comando agora. */
  dedoEm(comando: Comando) {
    for (const segurado of this.dedos.values()) if (segurado === comando) return true
    return false
  }

  segurando(comando: Comando) {
    return this.teclas[comando] || this.dedoEm(comando)
  }

  /**
   * A entrada do quadro: o que está segurado agora, mais os toques que
   * acabaram antes de a física vê-los, e uma troca de marcha por borboleta
   * tocada. Esvazia os pendentes, então precisa ser chamada em todo quadro —
   * inclusive na contagem, para um toque dado antes do VAI! não vazar para a
   * largada.
   */
  consumir(): RaceInput {
    for (const comando of COMANDOS) {
      this.doQuadro[comando] = this.segurando(comando) || this.pendentes[comando]
      this.pendentes[comando] = false
    }
    if (this.aceleradorAutomatico) this.doQuadro.throttle = true
    for (const qual of ['shiftUp', 'shiftDown'] as const) {
      this.doQuadro[qual] = this.toques[qual] > 0
      if (this.toques[qual] > 0) this.toques[qual] -= 1
    }
    this.doQuadro.manual = this.manual
    return this.doQuadro
  }

  /** Solta tudo: a página perdeu o foco ou foi para o segundo plano. */
  soltarTudo() {
    this.dedos.clear()
    for (const comando of COMANDOS) {
      this.teclas[comando] = false
      this.pendentes[comando] = false
    }
    this.toques.shiftUp = 0
    this.toques.shiftDown = 0
  }
}

/**
 * Para que lado vai o dedo que desliza entre ‹ e ›, sem levantar.
 *
 * O dedo só troca de lado quando entra no outro botão: o vão entre os dois é
 * uma faixa neutra. Sem ela, um polegar apoiado na borda de dentro trocaria
 * de lado a cada tremida — e cada troca conta como agitação do volante, que
 * derruba a aderência.
 */
export function ladoDoDedo(
  x: number,
  atual: 'left' | 'right',
  fimDaEsquerda: number,
  inicioDaDireita: number,
): 'left' | 'right' {
  if (atual === 'left' && x >= inicioDaDireita) return 'right'
  if (atual === 'right' && x <= fimDaEsquerda) return 'left'
  return atual
}
