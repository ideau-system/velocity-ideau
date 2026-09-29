import type { CarId } from '../game/cars'
import type { Difficulty } from '../game/rules'

export type LobbyPlayer = {
  id: string
  name: string
  ready: boolean
  connected: boolean
  /** Já cruzou a linha de chegada nesta corrida. */
  finished: boolean
  /** Já pediu revanche. */
  rematch: boolean
  /** Carro escolhido na garagem; é com ele que o rival desenha o fantasma. */
  car: CarId
  /** Volta gravada de outro piloto, completando a sala de quem ficou sozinho na ranqueada. */
  fantasma?: boolean
}

export type LobbyStatus = 'waiting' | 'ready' | 'countdown' | 'racing' | 'finished'

export type LobbyRoom = {
  code: string
  players: LobbyPlayer[]
  status: LobbyStatus
  /** Instante oficial da largada, no relógio do servidor. */
  startAt: number | null
  /** Duração total da sequência de luzes definida pelo servidor. */
  countdownMs: number
  /** Semente oficial do traçado, igual para os dois pilotos. */
  trackSeed: number
  /** Dificuldade oficial da sala, igual para os dois pilotos. */
  difficulty: Difficulty
  /** Quem criou a sala. Só ele escolhe a dificuldade. */
  hostId: string | null
  /** Sala da fila ranqueada: largada automática, sem lobby e sem revanche. */
  ranqueada?: boolean
  /** Sala de uma rodada da Copa do Dia: largada automática, e o último sai. */
  copa?: { divisao: number; rodada: number }
  /** Quem assiste da arquibancada: fora das vagas do grid. */
  spectators?: LobbySpectator[]
}

export type LobbySpectator = {
  id: string
  name: string
}

export type RoomResponse = {
  ok: boolean
  room?: LobbyRoom | null
  error?: string
}

export type ScheduledRace = {
  code: string
  startAt: number
  countdownMs: number
  /** Semente do traçado desta corrida. */
  trackSeed: number
  /** Dificuldade desta corrida. */
  difficulty: Difficulty
  serverTime: number
}

export type RaceCancelled = {
  code: string
  reason: string
}

/** Resultado oficial, calculado pelo servidor e idêntico nas duas telas. */
export type FinishEntry = {
  playerId: string
  name: string
  /** Tempo de prova em segundos, ou null para quem não completou. */
  time: number | null
  topSpeed: number
  collisions: number
  outcome: 'finished' | 'abandoned' | 'unfinished'
}

export type RaceOutcome = {
  code: string
  winnerId: string | null
  reason: 'time' | 'abandon'
  /** Diferença entre primeiro e segundo, quando os dois completaram. */
  gap: number | null
  /** Ordenado: vencedor primeiro. */
  entries: FinishEntry[]
}

/** Telemetria de um dos outros pilotos da corrida. */
export type RivalTelemetry = {
  playerId: string
  /** Instante da medição, no relógio do servidor. */
  t: number
  progress: number
  lateral: number
  speed: number
  state: 'racing' | 'finished'
  /** O rival está de boost. Ausente no fantasma que o servidor reproduz. */
  boosting?: boolean
}
