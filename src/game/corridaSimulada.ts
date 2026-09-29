// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { aplicarLargada, type Largada } from './largada.js'
import { createRaceContext, createTrackLayout, type TrackLayout } from './layout.js'
import type { Piloto } from './piloto.js'
import type { Difficulty, RaceRules } from './rules.js'
import { createRaceState, stepRace, type RaceEvent, type RaceState } from './simulation.js'

/**
 * Uma prova inteira, fora da tela e fora do relógio.
 *
 * É a mesma física e a mesma pista do jogo — o traçado gerado pela semente,
 * relido a cada passo fixo —, com um piloto de referência no volante. Serve aos
 * testes, que medem se a prova cabe na janela do plano e se habilidade rende
 * tempo, e serve para calcular o tempo de referência de uma semente: as
 * medalhas do contrarrelógio e o piso que o servidor usa para desconfiar de um
 * tempo bom demais.
 */

export type OpcoesDaCorrida = {
  seed: number
  difficulty?: Difficulty
  /** Duração de cada quadro, em segundos. Sessenta por segundo, se omitido. */
  quadro?: number
  /** Como o piloto largou. Aplicada no apagar das luzes, antes do primeiro passo. */
  largada?: Largada
  /** Tempo máximo de prova, em segundos: um piloto que não termina não trava o teste. */
  limite?: number
  /** Troca as regras do nível: é o que os modificadores dos desafios usam. */
  regras?: (base: RaceRules) => RaceRules
  /** Chamado depois de cada quadro, com os eventos dele. */
  aCadaQuadro?: (state: RaceState, eventos: readonly RaceEvent[], tempo: number, layout: TrackLayout) => void
}

export type CorridaSimulada = {
  /** Tempo de prova, em segundos, contado em quadros. */
  tempo: number
  terminou: boolean
  state: RaceState
  layout: TrackLayout
  /** Quantas vezes cada tipo de evento aconteceu. */
  contagem: Partial<Record<RaceEvent['type'], number>>
  /** Mini-turbos disparados, por nível: o índice 1 é o nível 1. */
  miniTurbos: [number, number, number, number]
}

/**
 * Roda a prova com o piloto que `criarPiloto` monta para aquela pista.
 *
 * Recebe uma fábrica, e não o piloto pronto, porque os pilotos têm memória —
 * um por corrida — e porque os melhores precisam ver a pista, como o jogador
 * vê as curvas chegando.
 */
export function correrSemTela(criarPiloto: (layout: TrackLayout) => Piloto, opcoes: OpcoesDaCorrida): CorridaSimulada {
  const quadro = opcoes.quadro ?? 1 / 60
  const limite = opcoes.limite ?? 300
  const layout = createTrackLayout(opcoes.seed)
  const context = createRaceContext(layout)
  const state = createRaceState(opcoes.difficulty ?? 'normal')
  if (opcoes.regras) state.rules = opcoes.regras(state.rules)
  const piloto = criarPiloto(layout)
  const contagem: CorridaSimulada['contagem'] = {}
  const miniTurbos: CorridaSimulada['miniTurbos'] = [0, 0, 0, 0]
  if (opcoes.largada) aplicarLargada(state, opcoes.largada)

  let quadros = 0
  while (!state.finished && quadros * quadro < limite) {
    const eventos = stepRace(state, piloto(state), quadro, context)
    quadros += 1
    for (const evento of eventos) {
      contagem[evento.type] = (contagem[evento.type] ?? 0) + 1
      if (evento.type === 'miniTurbo') miniTurbos[evento.nivel] += 1
    }
    opcoes.aCadaQuadro?.(state, eventos, quadros * quadro, layout)
  }
  return { tempo: quadros * quadro, terminou: state.finished, state, layout, contagem, miniTurbos }
}
