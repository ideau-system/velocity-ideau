// A validação da chegada precisa da mesma pista que o jogo desenha, então a
// definição vem do módulo do jogo em vez de ser copiada para cá.
import { toCarId, type CarId } from '../src/game/cars.js'
import { rulesFor, toDifficulty, turboDoPiloto, type Difficulty } from '../src/game/rules.js'
import { speedForState } from '../src/game/simulation.js'
import { LATERAL_LIMIT, TRACK_LENGTH } from '../src/game/track.js'

export type RoomStatus = 'waiting' | 'ready' | 'countdown' | 'racing' | 'finished'

export type PublicPlayer = {
  id: string
  name: string
  ready: boolean
  connected: boolean
  /** Já cruzou a linha de chegada nesta corrida. */
  finished: boolean
  /** Já pediu revanche. */
  rematch: boolean
  /**
   * Carro escolhido na garagem.
   *
   * Vai para o rival porque é com esta pintura que ele desenha o fantasma.
   * Não entra em nenhuma validação: a física é a mesma para todos os carros.
   */
  car: CarId
  /** Volta gravada de outro piloto, correndo no lugar de quem faltou na fila ranqueada. */
  fantasma?: boolean
}

export type PublicRoom = {
  code: string
  players: PublicPlayer[]
  status: RoomStatus
  /** Instante oficial da largada, no relógio do servidor. */
  startAt: number | null
  /** Duração total da sequência de luzes, usada pelos clientes. */
  countdownMs: number
  /**
   * Semente oficial do traçado desta corrida.
   *
   * A curva e o cenário são gerados a partir dela, então os dois pilotos
   * precisam receber exatamente o mesmo número — senão cada um correria em uma
   * pista diferente. Quem manda é o servidor: o cliente nunca sorteia.
   */
  trackSeed: number
  /**
   * Dificuldade oficial da sala.
   *
   * Vale para os dois pilotos e decide a física da prova, então é estado do
   * servidor como o horário da largada. Um cliente que simulasse com regras
   * próprias estaria correndo outra corrida.
   */
  difficulty: Difficulty
  /**
   * Quem criou a sala e decide a dificuldade.
   *
   * Vai para os clientes porque a interface precisa saber de quem é a
   * escolha — mostrar um seletor a quem não manda nele seria mentir.
   */
  hostId: string | null
  /**
   * Sala da fila ranqueada: largada automática, nível oficial, sem anfitrião e
   * sem revanche — a próxima corrida sai da fila.
   */
  ranqueada: boolean
  /** Sala de uma rodada da Copa do Dia: largada automática, como a ranqueada, mas sem PL. */
  copa?: RodadaDaCopa
  /**
   * Quem assiste da arquibancada.
   *
   * Fora das vagas do grid: uma sala cheia, ou com a prova em andamento, ainda
   * aceita quem só quer assistir. Não confirma, não corre e não entra no
   * resultado — recebe a mesma sala, a mesma largada e a telemetria de todos.
   */
  spectators: PublicSpectator[]
}

export type PublicSpectator = {
  id: string
  name: string
}

/** A divisão e a rodada da Copa do Dia que uma sala corre. */
export type RodadaDaCopa = { divisao: number; rodada: number }

export type RivalState = 'racing' | 'finished'

export type Telemetry = {
  /** Instante da medição, no relógio do servidor. */
  t: number
  progress: number
  lateral: number
  speed: number
  state: RivalState
  /** De boost — o boost apertado, ou o impulso da largada ou do mini-turbo. Só aparência. */
  boosting?: boolean
}

type Player = {
  id: string
  name: string
  ready: boolean
  socketId: string
  disconnectedAt: number | null
  telemetry: Telemetry | null
  finish: FinishEntry | null
  rematch: boolean
  car: CarId
  /** Volta gravada: sem conexão, confirmada, com a chegada marcada pelo servidor. */
  fantasma: boolean
  /** O perfil da conta com que o piloto entrou, para as estatísticas. Convidado não tem. */
  perfilId: string | null
}

/** Um piloto que a fila da ranqueada ou a Copa põe direto numa sala. */
export type PilotoDaSalaAutomatica = {
  socketId: string
  playerId: string
  nome: string
  carro: string
  perfilId?: string | null
}

type Spectator = {
  id: string
  name: string
  socketId: string
}

type RaceState = 'idle' | 'countdown' | 'racing' | 'finished'

type Room = {
  code: string
  players: Player[]
  createdAt: number
  state: RaceState
  startAt: number | null
  /** Semente do traçado desta corrida, renovada a cada nova largada. */
  trackSeed: number
  /** Dificuldade escolhida no lobby, congelada quando a contagem começa. */
  difficulty: Difficulty
  /** Quem criou a sala. Passa adiante se ele sair. */
  hostId: string | null
  /** Resultado oficial da última corrida, idêntico para os dois pilotos. */
  outcome: RaceOutcome | null
  /**
   * Validação estrita, a da ranqueada: a telemetria é presa ao que cabe desde
   * a largada, e a chegada só vale se a telemetria validada a sustentar.
   */
  exigeTelemetria: boolean
  /** Sala da fila ranqueada. */
  ranqueada: boolean
  /** Sala de uma rodada da Copa do Dia. */
  copa: RodadaDaCopa | null
  /** De onde saem as sementes desta sala. A ranqueada usa o pool da semana. */
  sorteioDeSemente: (() => number) | null
  /** A arquibancada: não ocupa vaga e não mexe na prova. */
  spectators: Spectator[]
}

export type RoomUpdate = {
  code: string
  room: PublicRoom | null
  /** Indica que a saída interrompeu uma contagem já agendada. */
  cancelledCountdown: boolean
}

export class RoomError extends Error {
  constructor(
    public code: 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'RACE_IN_PROGRESS' | 'NOT_IN_ROOM' | 'NOT_HOST' | 'RANKED' | 'SPECTATORS_FULL',
    message: string,
  ) {
    super(message)
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Tempo entre o agendamento e a largada: 900 ms de preparo mais cinco luzes de 900 ms. */
export const COUNTDOWN_MS = 5_400

/** Janela para o piloto voltar depois de uma queda de conexão. */
export const RECONNECT_GRACE_MS = 12_000

/** Quantidade máxima de pilotos que podem dividir a mesma sala. */
export const MAX_PLAYERS = 6

/**
 * Lugares na arquibancada de cada sala.
 *
 * Não é regra do jogo, é proteção do servidor: cada espectador recebe a
 * telemetria dos seis pilotos, sessenta mensagens por segundo. Trinta cabem
 * com folga numa máquina modesta — e uma turma inteira assistindo cabe neles.
 */
export const MAX_SPECTATORS = 30

/** Teto absoluto de velocidade aceito na telemetria: acima disso o avanço é impossível em qualquer nível. */
export const MAX_PLAUSIBLE_SPEED_MS = 120

/** Folga sobre o teto da física do nível, para arredondamento e variação de relógio. */
const FOLGA_DO_TETO = 1.05

/**
 * Teto de velocidade da telemetria num nível, em metros por segundo.
 *
 * É o teto da própria física — boost e vácuo inteiros —, com uma folga pequena.
 * O teto absoluto de 120 m/s passava de todos os níveis por mais de um quarto,
 * e um cliente acelerado podia avançar o próprio fantasma nessa folga.
 */
export function tetoDaTelemetria(difficulty: Difficulty, turbo = 1) {
  return Math.min(MAX_PLAUSIBLE_SPEED_MS * turbo, (speedForState(false, 0, true, rulesFor(difficulty, turbo), 1) / 3.6) * FOLGA_DO_TETO)
}

/**
 * O multiplicador do easter egg de `turboDoPiloto` numa sala. Na ranqueada e
 * na Copa ele não vale: onde há ponto ou troféu em jogo, o carro volta a ser
 * só pintura, e o cliente corre sem ele também.
 */
function turboNaSala(room: Room, player: Player) {
  return room.exigeTelemetria ? 1 : turboDoPiloto(player.name, player.car)
}

/** Folga em metros para não punir variação normal de rede. */
export const PROGRESS_TOLERANCE_M = 8
// O limite lateral é geometria da pista: vem do mesmo lugar que o jogo desenha,
// para o servidor não recortar uma faixa diferente da que o piloto enxerga.
export { LATERAL_LIMIT } from '../src/game/track.js'
/** Diferença máxima aceita entre o horário da medição e o do servidor. */
export const CLOCK_TOLERANCE_MS = 5_000

/**
 * Tempo mínimo fisicamente possível para a prova, por dificuldade: a pista
 * inteira na velocidade máxima daquele nível. Qualquer chegada mais rápida é
 * impossível.
 *
 * Precisa ser por dificuldade, e não um número só. Com o teto do nível mais
 * rápido, uma chegada impossível no normal passaria; com o teto do mais
 * lento, uma chegada legítima no profissional seria recusada.
 *
 * O teto inclui o vácuo. Sem ele, uma volta rápida feita legitimamente na
 * esteira do rival seria recusada como impossível — e é justamente o piloto
 * que colou no adversário a prova inteira quem tem mais chance de chegar perto
 * deste piso.
 */
export function minRaceSeconds(difficulty: Difficulty, turbo = 1) {
  return TRACK_LENGTH / (speedForState(false, 0, true, rulesFor(difficulty, turbo), 1) / 3.6)
}

/** Tempo mínimo do nível de referência, mantido para quem não passa a sala. */
export const MIN_RACE_SECONDS = minRaceSeconds('normal')

/** Folga para a viagem do aviso de chegada até o servidor. */
export const FINISH_TOLERANCE_SECONDS = 2

/**
 * Na ranqueada, quanto antes da linha a telemetria validada precisa estar para
 * a chegada valer: pouco mais de um segundo no teto do nível. É o que o
 * servidor sabe por conta própria do avanço do carro — a telemetria é presa ao
 * que cabe desde a largada —, e um cliente acelerado não chega lá antes da hora.
 */
export const FINISH_PROGRESS_TOLERANCE_M = 150

export type FinishOutcome = 'finished' | 'abandoned' | 'unfinished'

export type FinishEntry = {
  playerId: string
  name: string
  /** Tempo de prova em segundos, ou null para quem não completou. */
  time: number | null
  topSpeed: number
  collisions: number
  outcome: FinishOutcome
}

export type RaceOutcome = {
  code: string
  /** Quem venceu, ou null se ninguém completou. */
  winnerId: string | null
  /** Como a corrida foi decidida. */
  reason: 'time' | 'abandon'
  /** Diferença entre primeiro e segundo, em segundos, quando os dois completaram. */
  gap: number | null
  /** Ordenado: vencedor primeiro. */
  entries: FinishEntry[]
}

export type FinishReport = {
  time: number
  topSpeed: number
  collisions: number
}

export type RoomStoreOptions = {
  now?: () => number
  countdownMs?: number
  /**
   * Códigos que se criam sozinhos quando alguém entra.
   *
   * No workshop a sala de demonstração precisa existir antes de o
   * apresentador abrir o jogo, para o QR code do slide sempre funcionar.
   */
  openRooms?: string[]
  /** Sorteio da semente do traçado. Os testes injetam uma sequência previsível. */
  nextSeed?: () => number
}

export class RoomStore {
  private rooms = new Map<string, Room>()
  private now: () => number
  private countdownMs: number
  private openRooms: Set<string>
  private nextSeed: () => number

  constructor(options: RoomStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.countdownMs = options.countdownMs ?? COUNTDOWN_MS
    this.openRooms = new Set((options.openRooms ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean))
    this.nextSeed = options.nextSeed ?? (() => Math.floor(Math.random() * 0xffffffff))
  }

  /** Códigos que sempre aceitam entrada, mesmo sem ninguém dentro. */
  get demoRooms(): readonly string[] {
    return [...this.openRooms]
  }

  create(socketId: string, playerId: string, rawName: string, car?: unknown, perfilId: string | null = null) {
    const code = this.createCode()
    this.rooms.set(code, {
      code,
      createdAt: this.now(),
      state: 'idle',
      startAt: null,
      trackSeed: this.nextSeed(),
      difficulty: 'normal',
      hostId: playerId,
      outcome: null,
      exigeTelemetria: false,
      ranqueada: false,
      copa: null,
      sorteioDeSemente: null,
      players: [{ ...this.createPlayer(playerId, socketId, rawName, car), perfilId }],
      spectators: [],
    })
    return this.get(code)!
  }

  join(codeInput: string, socketId: string, playerId: string, rawName: string, car?: unknown, perfilId: string | null = null) {
    const room = this.ensureOpenRoom(codeInput) ?? this.requireRoom(codeInput)

    const returning = room.players.find((player) => player.id === playerId)
    if (returning) {
      returning.socketId = socketId
      returning.disconnectedAt = null
      returning.name = this.cleanName(rawName)
      // Quem entrou na conta durante a queda passa a contar para ela.
      if (perfilId) returning.perfilId = perfilId
      // Quem volta sem dizer o carro — um cliente antigo — mantém o que tinha.
      if (car !== undefined && this.canChangeCar(room)) returning.car = toCarId(car)
      return this.toPublic(room)
    }

    if (room.state !== 'idle') {
      throw new RoomError('RACE_IN_PROGRESS', 'A corrida desta sala já começou.')
    }
    if (room.players.length >= MAX_PLAYERS) throw new RoomError('ROOM_FULL', 'Esta sala já está cheia.')
    // Quem assistia e desceu para o grid deixa a arquibancada — só depois de a
    // vaga estar garantida, para uma recusa não o deixar sem lugar nenhum.
    room.spectators = room.spectators.filter((spectator) => spectator.id !== playerId)
    room.players.push({ ...this.createPlayer(playerId, socketId, rawName, car), perfilId })
    this.ensureHost(room)
    return this.toPublic(room)
  }

  /**
   * Entra na arquibancada da sala.
   *
   * Vale com o grid cheio e com a prova em andamento: é para isso que ela
   * existe. Quem estava no grid pode subir para assistir enquanto a largada não
   * foi marcada — depois, sair do grid seria abandonar. Quem volta depois de uma
   * queda reencontra o próprio lugar.
   */
  spectate(codeInput: string, socketId: string, spectatorId: string, rawName: string) {
    const room = this.ensureOpenRoom(codeInput) ?? this.requireRoom(codeInput)

    const noGrid = room.players.find((player) => player.id === spectatorId)
    if (noGrid) {
      if (room.state === 'countdown' || room.state === 'racing') {
        throw new RoomError('RACE_IN_PROGRESS', 'Com a largada marcada, quem está no grid não sai para assistir.')
      }
      room.players = room.players.filter((player) => player.id !== spectatorId)
      this.ensureHost(room)
      if (room.state === 'finished') this.resetRace(room)
    }

    const returning = room.spectators.find((spectator) => spectator.id === spectatorId)
    if (returning) {
      returning.socketId = socketId
      returning.name = this.cleanName(rawName)
      return this.toPublic(room)
    }
    if (room.spectators.length >= MAX_SPECTATORS) {
      throw new RoomError('SPECTATORS_FULL', 'A arquibancada desta sala está lotada.')
    }
    room.spectators.push({ id: spectatorId, name: this.cleanName(rawName), socketId })
    return this.toPublic(room)
  }

  /** Última telemetria conhecida de todos os pilotos: é o que o espectador vê ao chegar. */
  allTelemetries(codeInput: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room) return []
    return room.players.flatMap((player) => (player.telemetry ? [{ playerId: player.id, ...player.telemetry }] : []))
  }

  /**
   * Tira da arquibancada quem perdeu a conexão.
   *
   * Sem janela de retorno, ao contrário do piloto: o espectador não segura
   * nada de ninguém, e quem volta simplesmente entra de novo.
   */
  dropSpectatorsBySocket(socketId: string) {
    const updates: RoomUpdate[] = []
    for (const [code, room] of this.rooms) {
      if (!room.spectators.some((spectator) => spectator.socketId === socketId)) continue
      room.spectators = room.spectators.filter((spectator) => spectator.socketId !== socketId)
      updates.push(this.afterSpectatorLeft(code, room))
    }
    return updates
  }

  /**
   * Troca o carro do piloto.
   *
   * Não mexe nas confirmações, ao contrário da dificuldade: a pintura não
   * muda a prova de ninguém. Só fica travada da contagem até a bandeirada,
   * para o rival ver até o fim o mesmo carro com que viu a largada.
   */
  setCar(codeInput: string, playerId: string, car: unknown) {
    const room = this.requireRoom(codeInput)
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) throw new RoomError('NOT_IN_ROOM', 'Você não está nesta sala.')
    if (this.canChangeCar(room)) player.car = toCarId(car)
    return this.toPublic(room)
  }

  setReady(codeInput: string, playerId: string, ready: boolean) {
    const room = this.requireRoom(codeInput)
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) throw new RoomError('NOT_IN_ROOM', 'Você não está nesta sala.')

    // Voltar ao lobby depois da corrida libera a sala para uma nova largada.
    if (room.state === 'finished') {
      // Quem esgotou a janela de reconexão ficou até o placar para preservar a
      // classificação; ao voltar ao lobby sua vaga enfim é liberada.
      room.players = room.players.filter((candidate) => candidate.disconnectedAt === null)
      this.ensureHost(room)
      this.resetRace(room)
    } else if (room.state === 'racing') {
      this.resetRace(room)
    }

    player.ready = ready
    if (room.state === 'countdown' && !this.everyoneReady(room)) this.resetRace(room)
    return this.toPublic(room)
  }

  /**
   * Troca a dificuldade da sala.
   *
   * Só antes da contagem: mudar a regra com a largada já marcada seria trocar
   * a prova debaixo de quem já confirmou. E confirmar de novo é obrigatório —
   * a escolha volta a zero para os dois, porque ninguém deve largar numa
   * dificuldade que não viu.
   */
  setDifficulty(codeInput: string, playerId: string, difficulty: unknown) {
    const room = this.requireRoom(codeInput)
    if (!room.players.some((candidate) => candidate.id === playerId)) {
      throw new RoomError('NOT_IN_ROOM', 'Você não está nesta sala.')
    }
    // Só quem criou a sala escolhe. Com os dois podendo trocar, a decisão
    // viraria um cabo de guerra e ninguém saberia em que prova vai largar.
    if (room.hostId !== playerId) {
      throw new RoomError('NOT_HOST', 'Só quem criou a sala escolhe a dificuldade.')
    }
    if (room.state === 'countdown' || room.state === 'racing') return this.toPublic(room)

    const escolhida = toDifficulty(difficulty)
    if (escolhida === room.difficulty) return this.toPublic(room)

    if (room.state === 'finished') this.resetRace(room)
    room.difficulty = escolhida
    for (const candidate of room.players) candidate.ready = false
    return this.toPublic(room)
  }

  /** Quem manda na sala agora. */
  hostOf(codeInput: string) {
    return this.rooms.get(this.normalize(codeInput))?.hostId ?? null
  }

  /** Dificuldade oficial da sala, para o servidor validar a chegada. */
  difficultyOf(codeInput: string): Difficulty {
    return this.rooms.get(this.normalize(codeInput))?.difficulty ?? 'normal'
  }

  /** Define o instante oficial da largada. Retorna null se a sala ainda não puder largar. */
  scheduleStart(codeInput: string) {
    const room = this.requireRoom(codeInput)
    if (room.state !== 'idle' || !this.everyoneReady(room)) return null
    room.state = 'countdown'
    room.startAt = this.now() + this.countdownMs
    // Cada largada estreia um traçado. Como a semente é renovada aqui, e só
    // aqui, ela fica congelada durante a contagem, a corrida e qualquer
    // reconexão no meio da prova — e a revanche, que passa por este mesmo
    // caminho, ganha uma pista nova para os dois ao mesmo tempo.
    room.trackSeed = room.sorteioDeSemente?.() ?? this.nextSeed()
    return this.toPublic(room)
  }

  /**
   * Cria a sala de uma partida da fila ranqueada, com todos os pilotos já
   * confirmados: a largada sai sozinha, no nível oficial, com a pista do pool.
   */
  criarRanqueada(
    pilotos: ReadonlyArray<PilotoDaSalaAutomatica>,
    difficulty: Difficulty,
    sorteioDeSemente: () => number,
    fantasmas: ReadonlyArray<{ id: string; nome: string; carro: string }> = [],
  ) {
    return this.criarAutomatica(pilotos, difficulty, sorteioDeSemente, fantasmas, null)
  }

  /**
   * Cria a sala de uma rodada da Copa do Dia: como a da ranqueada — todos
   * confirmados, largada sozinha, telemetria estrita —, na pista do dia.
   */
  criarDaCopa(
    pilotos: ReadonlyArray<PilotoDaSalaAutomatica>,
    difficulty: Difficulty,
    seed: number,
    copa: RodadaDaCopa,
  ) {
    return this.criarAutomatica(pilotos, difficulty, () => seed, [], copa)
  }

  private criarAutomatica(
    pilotos: ReadonlyArray<PilotoDaSalaAutomatica>,
    difficulty: Difficulty,
    sorteioDeSemente: () => number,
    fantasmas: ReadonlyArray<{ id: string; nome: string; carro: string }>,
    copa: RodadaDaCopa | null,
  ) {
    const code = this.createCode()
    this.rooms.set(code, {
      code,
      createdAt: this.now(),
      state: 'idle',
      startAt: null,
      trackSeed: sorteioDeSemente(),
      difficulty,
      hostId: null,
      outcome: null,
      exigeTelemetria: true,
      ranqueada: copa === null,
      copa,
      sorteioDeSemente,
      spectators: [],
      players: [
        ...pilotos.map((piloto) => ({
          ...this.createPlayer(piloto.playerId, piloto.socketId, piloto.nome, piloto.carro),
          ready: true,
          perfilId: piloto.perfilId ?? null,
        })),
        // Fantasmas não têm conexão: nenhuma queda ou saída os alcança.
        ...fantasmas.map((fantasma) => ({
          ...this.createPlayer(fantasma.id, '', fantasma.nome, fantasma.carro),
          ready: true,
          fantasma: true,
        })),
      ],
    })
    return this.toPublic(this.rooms.get(code)!)
  }

  /**
   * A chegada de um fantasma, no tempo da volta gravada. Não passa pela
   * validação: a volta foi validada quando foi corrida.
   */
  registrarChegadaDoFantasma(codeInput: string, playerId: string, tempo: number) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'racing') return null
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player || !player.fantasma || player.finish) return null
    player.finish = {
      playerId,
      name: player.name,
      time: tempo,
      topSpeed: player.telemetry?.speed ?? 0,
      collisions: 0,
      outcome: 'finished',
    }
    const outcome = this.settleIfComplete(room)
    return { room: this.toPublic(room), outcome }
  }

  /** A chegada registrada de um piloto, com o tempo oficial. */
  chegadaDe(codeInput: string, playerId: string) {
    const player = this.rooms.get(this.normalize(codeInput))?.players.find((candidate) => candidate.id === playerId)
    return player?.finish ? { ...player.finish, car: player.car } : null
  }

  /** A telemetria de um fantasma, que o servidor mesmo produz da volta gravada. */
  telemetriaDoFantasma(codeInput: string, playerId: string, telemetria: Telemetry) {
    const room = this.rooms.get(this.normalize(codeInput))
    const player = room?.players.find((candidate) => candidate.id === playerId)
    if (!room || room.state !== 'racing' || !player?.fantasma || player.finish) return null
    player.telemetry = telemetria
    return telemetria
  }

  cancelStart(codeInput: string, options: { clearReady?: boolean } = {}) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'countdown') return null
    this.resetRace(room, options.clearReady ?? true)
    return this.toPublic(room)
  }

  /**
   * Quem correu a prova com conta: o perfil, o carro e a largada, para o
   * servidor guardar a corrida nas estatísticas de cada um.
   */
  pilotosComConta(codeInput: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room) return null
    return {
      largada: room.startAt,
      seed: room.trackSeed,
      dificuldade: room.difficulty,
      pilotos: room.players
        .filter((player) => player.perfilId !== null && !player.fantasma)
        .map((player) => ({ playerId: player.id, perfilId: player.perfilId!, car: player.car })),
    }
  }

  /** Transição executada pelo servidor no instante agendado. */
  beginRace(codeInput: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'countdown') return null
    room.state = 'racing'
    for (const player of room.players) player.telemetry = null
    return this.toPublic(room)
  }

  /**
   * Valida a telemetria antes de repassá-la ao adversário.
   *
   * Descarta medições fora de ordem, corrige horários incoerentes e limita o
   * avanço ao que é fisicamente possível, para que um cliente com problema —
   * ou adulterado — não teleporte o próprio fantasma na tela do rival.
   */
  acceptTelemetry(codeInput: string, playerId: string, input: Telemetry): Telemetry | null {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'racing') return null
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player || player.finish) return null

    if (![input.t, input.progress, input.lateral, input.speed].every(Number.isFinite)) return null

    const now = this.now()
    const previous = player.telemetry
    let t = Math.abs(input.t - now) > CLOCK_TOLERANCE_MS ? now : input.t

    // Pacote genuinamente atrasado: o adversário já viu uma posição mais nova.
    if (previous && t < previous.t) return null
    // Dois envios no mesmo milissegundo — caso da chegada — não podem sumir.
    if (previous && t === previous.t) t = previous.t + 1

    // O carro do easter egg anda mais: o teto dele sobe na mesma proporção.
    const teto = tetoDaTelemetria(room.difficulty, turboNaSala(room, player))
    let progress = Math.max(0, input.progress)
    if (previous) {
      const elapsed = Math.max(0, (t - previous.t) / 1000)
      const ceiling = previous.progress + teto * elapsed + PROGRESS_TOLERANCE_M
      progress = Math.min(Math.max(progress, previous.progress), ceiling)
    }
    // Na ranqueada, nem a primeira medição passa do que caberia desde a
    // largada: sem isto, o primeiro pacote podia dizer qualquer progresso. Na
    // sala casual o primeiro pacote segue livre, como sempre foi — é ele que
    // devolve o fantasma de quem reconecta no meio da prova.
    if (room.exigeTelemetria && room.startAt !== null) {
      const desdeALargada = Math.max(0, (t - room.startAt) / 1000)
      progress = Math.min(progress, teto * desdeALargada + PROGRESS_TOLERANCE_M)
    }
    progress = Math.min(progress, TRACK_LENGTH)

    const accepted: Telemetry = {
      t,
      progress,
      lateral: Math.max(-LATERAL_LIMIT, Math.min(LATERAL_LIMIT, input.lateral)),
      speed: Math.max(0, Math.min(teto * 3.6, input.speed)),
      state: input.state === 'finished' ? 'finished' : 'racing',
      // Só aparência — a chama e o contorno ciano na tela do rival; a
      // velocidade continua presa pelo teto acima. Booleano de verdade, e
      // nunca na chegada: quem cruzou a linha não está mais acelerando.
      boosting: input.state !== 'finished' && input.boosting === true,
    }
    player.telemetry = accepted
    return accepted
  }

  /**
   * Registra a passagem pela linha de chegada.
   *
   * O cliente informa o próprio tempo, mas quem manda é o servidor: o valor é
   * preso entre o mínimo fisicamente possível e o tempo já decorrido desde a
   * largada oficial, com uma folga para a viagem da mensagem. Assim um relógio
   * errado — ou um cliente adulterado — não consegue reivindicar uma volta
   * impossível.
   */
  recordFinish(codeInput: string, playerId: string, report: FinishReport) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'racing' || room.startAt === null) return null
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player || player.finish) return null

    // O piso vem da dificuldade da própria sala: no profissional o carro é
    // mais rápido, e um tempo legítimo lá seria recusado pelo piso do normal.
    const minimo = minRaceSeconds(room.difficulty, turboNaSala(room, player))
    const elapsed = (this.now() - room.startAt) / 1000
    if (elapsed < minimo) return null
    // Na ranqueada, a chegada precisa da telemetria que a sustente: o avanço
    // que o servidor aceitou tem de estar perto da linha.
    if (room.exigeTelemetria && (player.telemetry?.progress ?? 0) < TRACK_LENGTH - FINISH_PROGRESS_TOLERANCE_M) return null

    const reported = Number.isFinite(report.time) ? report.time : elapsed
    const floor = Math.max(minimo, elapsed - FINISH_TOLERANCE_SECONDS)
    player.finish = {
      playerId,
      name: player.name,
      time: Math.min(Math.max(reported, floor), elapsed),
      topSpeed: Number.isFinite(report.topSpeed) ? Math.max(0, report.topSpeed) : 0,
      collisions: Number.isFinite(report.collisions) ? Math.max(0, Math.trunc(report.collisions)) : 0,
      outcome: 'finished',
    }

    // Fecha o resultado antes de fotografar a sala, senão o estado enviado
    // aos clientes ainda diria que a corrida está em andamento.
    const outcome = this.settleIfComplete(room)
    return { room: this.toPublic(room), outcome }
  }

  /**
   * Encerra a corrida a favor de quem ficou, quando o rival não volta a tempo
   * ou desiste no meio da prova.
   */
  abandonRace(codeInput: string, playerId: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'racing') return null
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) return null

    player.finish = {
      playerId,
      name: player.name,
      time: null,
      topSpeed: player.telemetry?.speed ?? 0,
      collisions: 0,
      outcome: 'abandoned',
    }
    // Num duelo, o abandono decide a prova imediatamente. Com três ou mais
    // pilotos, os demais continuam correndo e o abandono ocupa sua posição
    // normal no resultado final.
    if (room.players.length === 2) {
      for (const rival of room.players) {
        if (rival.id === playerId || rival.finish) continue
        rival.finish = {
          playerId: rival.id,
          name: rival.name,
          time: null,
          topSpeed: rival.telemetry?.speed ?? 0,
          collisions: 0,
          outcome: 'unfinished',
        }
      }
    }

    // Fecha o resultado antes de fotografar a sala, senão o estado enviado
    // aos clientes ainda diria que a corrida está em andamento.
    const outcome = this.settleIfComplete(room)
    return { room: this.toPublic(room), outcome }
  }

  /**
   * Fecha a prova de quem ainda não chegou, como não completada.
   *
   * É o limite de tempo da ranqueada: um piloto que largou o celular com a aba
   * aberta não pode segurar o resultado — e os PL — dos outros cinco.
   */
  encerrarPorTempo(codeInput: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'racing') return null
    for (const player of room.players) {
      if (player.finish) continue
      player.finish = {
        playerId: player.id,
        name: player.name,
        time: null,
        topSpeed: player.telemetry?.speed ?? 0,
        collisions: 0,
        outcome: 'unfinished',
      }
    }
    const outcome = this.settleIfComplete(room)
    return { room: this.toPublic(room), outcome }
  }

  /** Resultado oficial da última corrida, igual para os dois pilotos. */
  outcomeFor(codeInput: string) {
    return this.rooms.get(this.normalize(codeInput))?.outcome ?? null
  }

  /** Pedido de revanche. Com os dois pedidos, a sala volta a ficar pronta. */
  requestRematch(codeInput: string, playerId: string) {
    const room = this.requireRoom(codeInput)
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) throw new RoomError('NOT_IN_ROOM', 'Você não está nesta sala.')
    if (room.ranqueada) throw new RoomError('RANKED', 'Na ranqueada, a próxima corrida sai da fila.')
    if (room.copa) throw new RoomError('RANKED', 'Na copa, a próxima rodada sai sozinha.')
    if (room.state !== 'finished') return this.toPublic(room)

    player.rematch = true
    const todos =
      room.players.length >= 2 &&
      room.players.every((candidate) => candidate.rematch && candidate.disconnectedAt === null)

    if (todos) {
      this.resetRace(room, false)
      for (const candidate of room.players) candidate.ready = true
    }
    return this.toPublic(room)
  }

  /** Última telemetria conhecida de quem não é o jogador informado. */
  rivalTelemetry(codeInput: string, playerId: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    const rival = room?.players.find((candidate) => candidate.id !== playerId)
    return rival?.telemetry ?? null
  }

  /** Última telemetria conhecida de todos os outros pilotos. */
  rivalTelemetries(codeInput: string, playerId: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room) return []
    return room.players.flatMap((candidate) =>
      candidate.id !== playerId && candidate.telemetry
        ? [{ playerId: candidate.id, ...candidate.telemetry }]
        : [],
    )
  }

  /** Saída explícita: remove o piloto — ou o espectador — imediatamente. */
  leaveBySocket(socketId: string) {
    const updates: RoomUpdate[] = []
    for (const [code, room] of this.rooms) {
      if (room.players.some((player) => player.socketId === socketId)) {
        room.players = room.players.filter((player) => player.socketId !== socketId)
        updates.push(this.afterDeparture(code, room))
      } else if (room.spectators.some((spectator) => spectator.socketId === socketId)) {
        room.spectators = room.spectators.filter((spectator) => spectator.socketId !== socketId)
        updates.push(this.afterSpectatorLeft(code, room))
      }
    }
    return updates
  }

  /**
   * O anfitrião tira um piloto do grid.
   *
   * Com seis vagas, basta um piloto que largou o celular na mesa para
   * ninguém largar: a prova só começa com todos confirmados. Só vale antes da
   * contagem — com as luzes acesas, tirar alguém seria cancelar a largada dos
   * outros cinco. Devolve o socket de quem saiu, para o servidor avisá-lo.
   */
  kick(codeInput: string, requesterId: string, targetId: string) {
    const room = this.requireRoom(codeInput)
    if (room.hostId !== requesterId) {
      throw new RoomError('NOT_HOST', 'Só o anfitrião pode tirar um piloto da sala.')
    }
    if (targetId === requesterId) throw new RoomError('NOT_IN_ROOM', 'Para sair, use o botão de sair da sala.')
    const target = room.players.find((player) => player.id === targetId)
    if (!target) throw new RoomError('NOT_IN_ROOM', 'Esse piloto já não está na sala.')
    if (room.state === 'countdown' || room.state === 'racing') {
      throw new RoomError('RACE_IN_PROGRESS', 'Com a largada marcada, ninguém sai do grid.')
    }
    room.players = room.players.filter((player) => player.id !== targetId)
    return { ...this.afterDeparture(room.code, room), socketId: target.socketId }
  }

  /** Queda de conexão: o piloto continua na sala até a janela de retorno expirar. */
  markDisconnected(socketId: string) {
    const updates: Array<RoomUpdate & { playerId: string }> = []
    for (const [code, room] of this.rooms) {
      const player = room.players.find((candidate) => candidate.socketId === socketId)
      if (!player) continue
      player.disconnectedAt = this.now()
      player.ready = false
      const cancelledCountdown = room.state === 'countdown'
      if (cancelledCountdown) this.resetRace(room)
      updates.push({ code, room: this.toPublic(room), playerId: player.id, cancelledCountdown })
    }
    return updates
  }

  /** Remove quem não voltou dentro da janela de reconexão. */
  dropIfStillDisconnected(codeInput: string, playerId: string): RoomUpdate | null {
    const room = this.rooms.get(this.normalize(codeInput))
    const player = room?.players.find((candidate) => candidate.id === playerId)
    if (!room || !player || player.disconnectedAt === null) return null
    // Durante uma corrida com mais de dois participantes, o piloto que caiu
    // continua no resultado como abandono. Retirá-lo aqui encerraria/resetaria
    // a prova de quem ainda está correndo.
    if (room.state === 'racing' && player.finish) {
      return { code: room.code, room: this.toPublic(room), cancelledCountdown: false }
    }
    room.players = room.players.filter((candidate) => candidate.id !== playerId)
    return this.afterDeparture(room.code, room)
  }

  get(codeInput: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    return room ? this.toPublic(room) : null
  }

  get size() {
    return this.rooms.size
  }

  private afterDeparture(code: string, room: Room): RoomUpdate {
    const cancelledCountdown = room.state === 'countdown'
    // Uma sala só de fantasmas não tem mais ninguém para correr — a não ser que
    // haja gente na arquibancada: aí ela espera, e fecha quando o último sair.
    if (room.players.every((player) => player.fantasma) && room.spectators.length === 0) {
      this.rooms.delete(code)
      return { code, room: null, cancelledCountdown }
    }
    this.ensureHost(room)
    if (room.state !== 'idle') this.resetRace(room)
    return { code, room: this.toPublic(room), cancelledCountdown }
  }

  /** A saída de um espectador não mexe na prova: só fecha a sala se ela ficou vazia. */
  private afterSpectatorLeft(code: string, room: Room): RoomUpdate {
    if (room.players.every((player) => player.fantasma) && room.spectators.length === 0) {
      this.rooms.delete(code)
      return { code, room: null, cancelledCountdown: false }
    }
    return { code, room: this.toPublic(room), cancelledCountdown: false }
  }

  /**
   * Fecha a corrida quando os dois pilotos já têm um desfecho e monta o
   * resultado uma única vez, para que as duas telas recebam exatamente o mesmo.
   */
  private settleIfComplete(room: Room): RaceOutcome | null {
    if (room.players.length < 2) return null
    if (!room.players.every((player) => player.finish)) return null

    const entries = room.players.map((player) => player.finish!)
    const abandono = entries.some((entry) => entry.outcome === 'abandoned')
    const completos = entries.filter((entry) => entry.outcome === 'finished' && entry.time !== null)

    const ordenado = [...entries].sort((a, b) => {
      if (a.outcome === 'finished' && b.outcome !== 'finished') return -1
      if (b.outcome === 'finished' && a.outcome !== 'finished') return 1
      if (a.outcome === 'unfinished' && b.outcome === 'abandoned') return -1
      if (b.outcome === 'unfinished' && a.outcome === 'abandoned') return 1
      return (a.time ?? Infinity) - (b.time ?? Infinity)
    })

    const vencedor = ordenado[0]
    room.state = 'finished'
    room.outcome = {
      code: room.code,
      winnerId: vencedor.outcome === 'abandoned' ? null : vencedor.playerId,
      reason: abandono ? 'abandon' : 'time',
      gap:
        ordenado.length >= 2 && ordenado[0].time !== null && ordenado[1].time !== null
          ? Math.abs(ordenado[0].time - ordenado[1].time)
          : null,
      entries: ordenado,
    }
    return room.outcome
  }

  private resetRace(room: Room, clearReady = true) {
    room.state = 'idle'
    room.startAt = null
    room.outcome = null
    for (const player of room.players) {
      player.telemetry = null
      player.finish = null
      player.rematch = false
      if (clearReady) player.ready = false
    }
  }

  /**
   * Garante que a sala sempre tenha um anfitrião presente.
   *
   * Se o criador sai de vez, quem ficou assume — sem isso a dificuldade
   * ficaria trancada no valor que ele deixou. Uma queda de conexão não
   * transfere nada: ele continua dono enquanto a janela de retorno correr.
   */
  private ensureHost(room: Room) {
    if (room.players.some((player) => player.id === room.hostId)) return
    room.hostId = room.players[0]?.id ?? null
  }

  private canChangeCar(room: Room) {
    return room.state !== 'countdown' && room.state !== 'racing'
  }

  private everyoneReady(room: Room) {
    return (
      room.players.length >= 2 &&
      room.players.length <= MAX_PLAYERS &&
      room.players.every((player) => player.ready && player.disconnectedAt === null)
    )
  }

  /** Abre na hora uma sala de demonstração que ainda não existe. */
  private ensureOpenRoom(codeInput: string) {
    const code = this.normalize(codeInput)
    if (!this.openRooms.has(code) || this.rooms.has(code)) return null
    const room: Room = {
      code,
      createdAt: this.now(),
      state: 'idle',
      startAt: null,
      trackSeed: this.nextSeed(),
      difficulty: 'normal',
      // A sala de demonstração nasce vazia: o primeiro a entrar é o anfitrião.
      hostId: null,
      outcome: null,
      exigeTelemetria: false,
      ranqueada: false,
      copa: null,
      sorteioDeSemente: null,
      players: [],
      spectators: [],
    }
    this.rooms.set(code, room)
    return room
  }

  private requireRoom(codeInput: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Sala não encontrada.')
    return room
  }

  private createPlayer(id: string, socketId: string, rawName: string, car: unknown): Player {
    return {
      id,
      socketId,
      name: this.cleanName(rawName),
      ready: false,
      disconnectedAt: null,
      telemetry: null,
      finish: null,
      rematch: false,
      car: toCarId(car),
      fantasma: false,
      perfilId: null,
    }
  }

  private normalize(code: string) {
    return code.trim().toUpperCase()
  }

  private cleanName(name: string) {
    return name.trim().slice(0, 16) || 'Piloto'
  }

  private createCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = ''
      for (let index = 0; index < 5; index += 1) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
      }
      if (!this.rooms.has(code)) return code
    }
    throw new Error('Não foi possível gerar um código de sala.')
  }

  private toPublic(room: Room): PublicRoom {
    const players = room.players.map(({ id, name, ready, disconnectedAt, finish, rematch, car, fantasma }) => ({
      id,
      name,
      ready,
      connected: disconnectedAt === null,
      finished: finish !== null,
      rematch,
      car,
      ...(fantasma ? { fantasma: true } : {}),
    }))
    const status: RoomStatus =
      room.state === 'finished'
        ? 'finished'
        : room.state === 'racing'
          ? 'racing'
          : room.state === 'countdown'
            ? 'countdown'
            : this.everyoneReady(room)
              ? 'ready'
              : 'waiting'
    return {
      code: room.code,
      players,
      status,
      startAt: room.startAt,
      countdownMs: this.countdownMs,
      trackSeed: room.trackSeed,
      difficulty: room.difficulty,
      hostId: room.hostId,
      ranqueada: room.ranqueada,
      ...(room.copa ? { copa: { ...room.copa } } : {}),
      spectators: room.spectators.map(({ id, name }) => ({ id, name })),
    }
  }
}
