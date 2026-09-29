/**
 * Piloto virtual: entra em uma sala como segundo jogador e corre sozinho.
 *
 * Serve para testar o fantasma, a largada sincronizada e o HUD sem precisar
 * de um segundo aparelho. Usa o mesmo protocolo do navegador, então tudo
 * passa pelo servidor de verdade.
 *
 *   npm run piloto -- ABC12
 *   npm run piloto -- ABC12 --nome Rival --velocidade 260 --carro schumacher
 *   npm run piloto -- ABC12 --parado
 *
 * Com `--parado`, entra no grid e nunca confirma: é o celular esquecido na
 * mesa, que segura a largada de todo mundo até o anfitrião tirá-lo da sala.
 *
 *   npm run piloto -- --ranqueada --nome Rival
 *
 * Com `--ranqueada`, não entra em sala nenhuma: entra numa conta de teste, na
 * fila pública, e corre as partidas que a fila formar, uma atrás da outra.
 * Corre com a física de verdade — o piloto de teste que usa tudo, largando
 * perfeito —, porque na ranqueada o servidor só aceita a chegada que a
 * telemetria sustenta. A conta de teste só vale num servidor subido com
 * `CONTAS_DE_TESTE=1`: nunca o de produção.
 *
 *   npm run piloto -- --copa --nome Rival
 *   npm run piloto -- --copa --nome Lento --novato --abandona
 *
 * Com `--copa`, entra numa conta de teste, se inscreve na Copa do Dia e, quando a
 * classificação abre, manda uma volta da Pista do Dia: calculada na hora com a
 * física do jogo e enviada só depois do tempo dela passar no relógio, com os
 * comandos de cada quadro — a mesma volta que o servidor refaz para conferir.
 * Depois corre as rodadas que a divisão tiver. `--novato` pilota pior, para
 * os tempos não empatarem; `--abandona` desiste de cada rodada logo depois da
 * largada, para testar a eliminação sem esperar a prova inteira.
 */
import { createHash } from 'node:crypto'
import { io, type Socket } from 'socket.io-client'
import { tokenDeTeste } from '../server/contas.js'
// A pista e a curva de tração vêm do jogo: uma cópia aqui divergiria em
// silêncio, e o fantasma arrancaria diferente do carro de verdade.
import { CARS, carById, isCarId } from '../src/game/cars.js'
import { correrSemTela } from '../src/game/corridaSimulada.js'
import { GravadorDeVolta } from '../src/game/gravador.js'
import { aplicarLargada } from '../src/game/largada.js'
import { createRaceContext, createTrackLayout } from '../src/game/layout.js'
import { desviando, pilotoCompleto, type Piloto } from '../src/game/piloto.js'
import { GravadorDeEntradas, quantizarPasso } from '../src/game/registroDeEntradas.js'
import { rulesFor, type Difficulty } from '../src/game/rules.js'
import { ACCELERATION_PEAK, ACCELERATION_SHAPE, createRaceState, motorForte, stepRace, type RaceInput } from '../src/game/simulation.js'
import { TRACK_LENGTH } from '../src/game/track.js'

type Room = {
  code: string
  players: Array<{ id: string; name: string; ready: boolean; connected: boolean; finished: boolean; rematch: boolean }>
  status: 'waiting' | 'ready' | 'countdown' | 'racing' | 'finished'
  startAt: number | null
  countdownMs: number
}

type RoomAck = { ok: boolean; room?: Room; error?: string }
type Scheduled = {
  code: string
  startAt: number
  countdownMs: number
  /** Semente oficial do traçado, a mesma que o navegador recebe. */
  trackSeed: number
  /** Dificuldade oficial da sala. */
  difficulty: Difficulty
  serverTime: number
}

const TELEMETRY_INTERVAL_MS = 100
const STEP_MS = 16

function readOption(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

/** O id da conta de teste de um nome: um UUID tirado do hash, sempre o mesmo. */
function contaDeTeste(nome: string) {
  const hex = createHash('sha256').update(`piloto-virtual:${nome}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const ranqueada = process.argv.includes('--ranqueada')
const naCopa = process.argv.includes('--copa')
const novato = process.argv.includes('--novato')
const abandona = process.argv.includes('--abandona')
/** Com a física de verdade: a ranqueada e a copa só aceitam a chegada que a telemetria sustenta. */
const comFisica = ranqueada || naCopa
let code = comFisica ? '' : (process.argv[2]?.trim().toUpperCase() ?? '')
if (!comFisica && (!code || code.startsWith('--'))) {
  console.error('Informe o código da sala, ou --ranqueada, ou --copa. Exemplo: npm run piloto -- ABC12')
  process.exit(1)
}

const serverUrl = process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001'
const name = readOption('nome', 'Fantasma')
const targetSpeed = Number(readOption('velocidade', '245'))
// Por padrão, um carro diferente do padrão do navegador: com os dois iguais,
// o teste não mostraria que o fantasma usa a pintura do rival.
const carroPedido = readOption('carro', 'verstappen')
const parado = process.argv.includes('--parado')
if (!isCarId(carroPedido)) {
  console.error(`Carro desconhecido: ${carroPedido}. Opções: ${CARS.map((car) => car.id).join(', ')}`)
  process.exit(1)
}
const car = carroPedido
/** Velocidade efetiva: o pedido, limitado ao cruzeiro da dificuldade da sala. */
let ritmo = targetSpeed
const playerId = `piloto-virtual-${Math.random().toString(36).slice(2, 8)}`

const socket: Socket = io(serverUrl, { transports: ['websocket'], forceNew: true })

let clockOffset = 0
const serverNow = () => Date.now() + clockOffset

/** Mesma estimativa usada pelo navegador: desconta metade da ida e volta. */
async function syncClock(samples = 5) {
  let best = { offset: 0, roundTrip: Number.POSITIVE_INFINITY }
  for (let index = 0; index < samples; index += 1) {
    const sentAt = Date.now()
    const serverTime = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 1_500)
      socket.emit('time:sync', { clientSentAt: sentAt }, (response: { serverTime: number }) => {
        clearTimeout(timer)
        resolve(response?.serverTime ?? null)
      })
    })
    if (serverTime === null) continue
    const receivedAt = Date.now()
    const roundTrip = receivedAt - sentAt
    const offset = serverTime + roundTrip / 2 - receivedAt
    if (roundTrip < best.roundTrip) best = { offset, roundTrip }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  clockOffset = best.offset
  console.log(`Relógio sincronizado: ${Math.round(best.offset)} ms de diferença, ida e volta ${best.roundTrip} ms.`)
}

let racing = false

/**
 * Corre com a física do jogo, na pista da semente oficial: o piloto de teste
 * que usa tudo, largando perfeito. É o que a ranqueada exige — a chegada só vale
 * se a telemetria validada a sustentar —, e dá ao fantasma o traçado de verdade.
 */
function raceWithPhysics(startAt: number, seed: number, difficulty: Difficulty) {
  if (racing) return
  racing = true
  const layout = createTrackLayout(seed)
  const context = createRaceContext(layout)
  const state = createRaceState(difficulty)
  const piloto = pilotoDoEstilo(layout)
  aplicarLargada(state, { nivel: 3, queimou: false })
  let lastTick = startAt
  let lastSent = 0
  // A prova é desta sala: se o piloto passou para outra, este laço para.
  const sala = code
  console.log('Largada recebida. Correndo com a física do jogo.')

  const send = (estado: 'racing' | 'finished') => {
    socket.emit('race:telemetry', {
      code,
      playerId,
      t: serverNow(),
      progress: state.progress,
      lateral: state.lateral,
      speed: estado === 'finished' ? 0 : state.speed,
      state: estado,
      boosting: estado !== 'finished' && motorForte(state),
    })
  }

  const loop = setInterval(() => {
    if (code !== sala) {
      clearInterval(loop)
      racing = false
      return
    }
    const clock = serverNow()
    if (clock < startAt) return
    const dt = Math.max(0, (clock - lastTick) / 1000)
    lastTick = clock
    // Passos de no máximo 50 ms, como o jogo: um temporizador atrasado não teleporta o carro.
    for (let restante = dt; restante > 1e-6; restante -= 0.05) stepRace(state, piloto(state), Math.min(0.05, restante), context)
    const elapsed = (clock - startAt) / 1000
    if (state.finished) {
      clearInterval(loop)
      racing = false
      send('finished')
      console.log(`Chegada em ${elapsed.toFixed(3)} s.`)
      socket.emit('race:finish', { code, playerId, time: elapsed, topSpeed: state.topSpeed, collisions: state.collisions })
      return
    }
    if (Date.now() - lastSent >= TELEMETRY_INTERVAL_MS) {
      lastSent = Date.now()
      send('racing')
    }
  }, STEP_MS)
}

/** O piloto de teste que usa tudo, ou um novato que serpenteia pela pista. */
function pilotoDoEstilo(layout: Parameters<typeof pilotoCompleto>[0]): Piloto {
  return novato ? desviando(true) : pilotoCompleto(layout)
}

type Resposta = { ok: boolean; error?: string } & Record<string, unknown>
const perguntar = (evento: string, dados?: unknown) =>
  new Promise<Resposta>((resolve) => socket.emit(evento, dados, resolve))

/**
 * A volta da classificação da copa: a Pista do Dia, calculada na hora com a
 * física do jogo e mandada ao servidor quando o tempo dela já passou no
 * relógio dele — com a volta gravada e os comandos de cada quadro, que o
 * servidor refaz para conferir.
 */
async function voltaDeClassificacao() {
  const aberta = await perguntar('tt:iniciar')
  if (!aberta.ok) return console.error(`Não foi possível abrir a tentativa: ${aberta.error}`)
  const quadro = quantizarPasso(1 / 60)
  const entradas = new GravadorDeEntradas()
  const gravador = new GravadorDeVolta()
  const largada = { nivel: 3 as const, queimou: false }
  entradas.registrarLargada(largada)
  let ultimo: RaceInput = { left: false, right: false, boost: false }
  const prova = correrSemTela(
    (layout) => {
      const base = pilotoDoEstilo(layout)
      return (state) => (ultimo = base(state))
    },
    {
      seed: aberta.seed as number,
      difficulty: aberta.dificuldade as Difficulty,
      quadro,
      largada,
      aCadaQuadro: (state, _eventos, tempo) => {
        entradas.registrar(quadro, ultimo)
        gravador.gravar(tempo * 1000, state)
      },
    },
  )
  const espera = (aberta.contagemMs as number) + prova.tempo * 1000 + 150
  console.log(`Volta de classificação: ${prova.tempo.toFixed(3)} s. Mandando em ${Math.round(espera / 1000)} s.`)
  await new Promise((resolve) => setTimeout(resolve, espera))
  const veredito = await perguntar('tt:terminar', {
    tentativa: aberta.tentativa,
    tempo: prova.tempo,
    gravacao: gravador.terminar(prova.tempo * 1000, prova.state),
    dispositivo: 'teclado',
    entradas: entradas.terminar(),
  })
  const naClassificacao = veredito.copa as { posicao: number } | undefined
  console.log(`Veredito: ${veredito.estado}${veredito.motivo ? ` (${veredito.motivo})` : ''}${naClassificacao ? `, #${naClassificacao.posicao} na classificação da copa` : ''}.`)
}

/** Inscreve na Copa do Dia e espera a classificação abrir para mandar a volta. */
async function entrarNaCopa() {
  const inscricao = await perguntar('copa:inscrever', { playerId, nome: name, carro: car })
  if (!inscricao.ok) return console.error(`Não foi possível se inscrever: ${inscricao.error}`)
  console.log(`"${name}" está inscrito na Copa do Dia.`)
  let classificou = false
  const relogio = setInterval(async () => {
    const painel = await perguntar('copa:painel')
    const copa = painel.copa as { fase: string; abertura: number } | undefined
    if (!copa || classificou || copa.fase !== 'classificacao') return
    classificou = true
    clearInterval(relogio)
    await voltaDeClassificacao()
  }, 2_000)
}

/** Entra na fila ranqueada, com um perfil criado agora. */
async function entrarNaFila() {
  const entrada = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
    socket.emit('ranqueada:entrar', { playerId, nome: name, carro: car }, resolve),
  )
  if (!entrada.ok) {
    console.error(`Não foi possível entrar na fila: ${entrada.error}`)
    return
  }
  console.log(`"${name}" está na fila da ranqueada.`)
}

/** Corre em ritmo constante, serpenteando de leve para o fantasma não ficar estático. */
function race(startAt: number) {
  if (racing) return
  racing = true

  let progress = 0
  let speed = 0
  let lastSent = 0
  // O temporizador do Node não é preciso, então integramos pelo tempo real.
  let lastTick = startAt
  console.log('Largada recebida. Acelerando.')

  const send = (state: 'racing' | 'finished', lateral: number) => {
    socket.emit('race:telemetry', {
      code,
      playerId,
      t: serverNow(),
      progress,
      lateral,
      speed: state === 'finished' ? 0 : speed,
      state,
    })
  }

  const loop = setInterval(() => {
    const clock = serverNow()
    const elapsed = (clock - startAt) / 1000
    if (elapsed < 0) return

    const dt = Math.min(0.25, Math.max(0, (clock - lastTick) / 1000))
    lastTick = clock
    if (dt === 0) return
    // Mesma curva de tração do jogo: arrancada forte que cede perto do teto.
    if (speed < ritmo) {
      const fracao = speed / ritmo
      speed = Math.min(ritmo, speed + ACCELERATION_PEAK * (1 - Math.pow(fracao, ACCELERATION_SHAPE)) * dt)
    }
    progress = Math.min(TRACK_LENGTH, progress + (speed / 3.6) * dt)
    const lateral = Math.sin(elapsed / 2.6) * 0.55

    if (progress >= TRACK_LENGTH) {
      clearInterval(loop)
      racing = false
      send('finished', lateral)
      console.log(`Chegada em ${elapsed.toFixed(3)} s.`)
      // O servidor é quem decide o vencedor: avisamos a chegada e esperamos.
      socket.emit('race:finish', { code, playerId, time: elapsed, topSpeed: ritmo, collisions: 0 })
      return
    }

    const now = Date.now()
    if (now - lastSent >= TELEMETRY_INTERVAL_MS) {
      lastSent = now
      send('racing', lateral)
    }
  }, STEP_MS)
}

socket.on('connect', async () => {
  console.log(`Conectado a ${serverUrl}.`)
  await syncClock()

  if (comFisica) {
    // Uma conta de teste por piloto, com o id tirado do nome: a mesma conta a
    // cada vez que o piloto volta, com o PL que ele já tinha.
    const entrou = await new Promise<{ ok: boolean; error?: string; perfil?: { apelido: string } }>((resolve) =>
      socket.emit('conta:entrar', { token: tokenDeTeste(contaDeTeste(name), name) }, resolve),
    )
    if (!entrou.ok) {
      console.error(`Não foi possível entrar na conta de teste: ${entrou.error} (o servidor precisa de CONTAS_DE_TESTE=1)`)
      process.exit(1)
    }
    if (naCopa) await entrarNaCopa()
    else await entrarNaFila()
    return
  }

  socket.emit('room:join', { code, name, playerId, car }, (response: RoomAck) => {
    if (!response.ok || !response.room) {
      console.error(`Não foi possível entrar na sala ${code}: ${response.error}`)
      process.exit(1)
    }
    if (parado) {
      console.log(`Na sala ${code} como "${name}", parado: não vai confirmar.`)
      return
    }
    console.log(`Na sala ${code} como "${name}", com o carro de ${carById(car).driver}. Confirmando presença.`)
    socket.emit('room:set-ready', { code, playerId, ready: true })
  })
})

// Tirado do grid pelo anfitrião: não há mais o que fazer aqui.
socket.on('room:kicked', () => {
  console.log(`O anfitrião tirou "${name}" da sala ${code}.`)
  process.exit(0)
})

// A fila formou a sala: a largada já vem marcada.
socket.on('ranqueada:partida', (payload: { room: Room }) => {
  code = payload.room.code
  console.log(`Partida ranqueada na sala ${code}, com ${payload.room.players.map((player) => player.name).join(', ')}.`)
})

// A divisão da copa largou uma rodada: a largada já vem marcada.
socket.on('copa:partida', (payload: { room: Room & { copa?: { divisao: number; rodada: number } } }) => {
  code = payload.room.code
  racing = false
  const { divisao, rodada } = payload.room.copa ?? { divisao: 0, rodada: 0 }
  console.log(`Copa: divisão ${divisao}, rodada ${rodada}, sala ${code}, com ${payload.room.players.map((player) => player.name).join(', ')}.`)
})

socket.on(
  'copa:rodada',
  (payload: { eliminados: Array<{ playerId: string; nome: string; posicao: number }>; campeao: { playerId: string; nome: string } | null }) => {
    const saiu = payload.eliminados.find((eliminado) => eliminado.playerId === playerId)
    if (payload.campeao?.playerId === playerId) console.log('Copa: campeão da divisão!')
    else if (saiu) console.log(`Copa: eliminado em ${saiu.posicao}º.`)
    else console.log(`Copa: saiu ${payload.eliminados.map((eliminado) => eliminado.nome).join(', ')}; sigo na disputa.`)
  },
)

socket.on('ranqueada:resultados', (payload: { resultados: Array<{ playerId: string; posto: number; deltaPl: number; divisao: string }> }) => {
  const meu = payload.resultados.find((resultado) => resultado.playerId === playerId)
  if (meu) console.log(`Ranqueada: ${meu.posto}º, ${meu.deltaPl >= 0 ? '+' : ''}${meu.deltaPl} PL — ${meu.divisao}.`)
  // Sai da sala e volta para a fila, para a próxima.
  socket.emit('room:leave')
  setTimeout(() => void entrarNaFila(), 1_500)
})

socket.on('ranqueada:cancelada', (payload: { motivo: string }) => {
  console.log(`Partida ranqueada cancelada: ${payload.motivo}`)
  socket.emit('room:leave')
  setTimeout(() => void entrarNaFila(), 1_500)
})

socket.on('room:update', (room: Room) => {
  // Na ranqueada e na copa ninguém confirma nem pede revanche: a largada é automática.
  if (comFisica) return
  const rivais = room.players.map((player) => `${player.name}${player.ready ? ' (pronto)' : ''}`).join(', ')
  console.log(`Sala ${room.status}: ${rivais}`)
  const me = room.players.find((player) => player.id === playerId)

  // Depois de uma corrida, confirma de novo para a próxima largada.
  if (room.status === 'waiting' && !racing && !parado && me && !me.ready && room.players.length === 2) {
    setTimeout(() => socket.emit('room:set-ready', { code, playerId, ready: true }), 800)
  }

  // Com o resultado fechado, aceita a revanche.
  if (room.status === 'finished' && !parado && me && !me.rematch) {
    setTimeout(() => socket.emit('race:rematch', { code, playerId }), 900)
  }
})

socket.on('race:result', (resultado: { winnerId: string | null; reason: string; gap: number | null }) => {
  const quem = resultado.winnerId === playerId ? 'eu' : resultado.winnerId ? 'o rival' : 'ninguém'
  const diferenca = resultado.gap === null ? 'sem diferença medida' : `${resultado.gap.toFixed(3)} s`
  console.log(`Resultado oficial: venceu ${quem} (${resultado.reason}), ${diferenca}.`)
})

socket.on('race:scheduled', (payload: Scheduled) => {
  const faltando = payload.startAt - serverNow()
  console.log(`Largada agendada para daqui a ${Math.round(faltando)} ms.`)
  // Impresso para conferir a olho que os dois lados receberam a mesma pista.
  console.log(`Traçado desta corrida: semente ${payload.trackSeed}, dificuldade ${payload.difficulty}.`)
  // O ritmo acompanha o nível da sala, senão o fantasma correria numa prova
  // diferente da do rival — e chegaria antes ou depois sem explicação.
  ritmo = Math.min(targetSpeed, rulesFor(payload.difficulty).cruiseSpeed)
  if (comFisica) raceWithPhysics(payload.startAt, payload.trackSeed, payload.difficulty)
  else race(payload.startAt)
  // Para testar a eliminação: desiste logo depois de largar.
  if (naCopa && abandona) {
    const sala = payload.code
    setTimeout(() => {
      console.log('Abandonando a rodada.')
      socket.emit('race:abandon', { code: sala, playerId })
      // Quem abandona está fora: o laço da prova para aqui.
      code = ''
    }, Math.max(0, payload.startAt - serverNow()) + 1_500)
  }
})

socket.on('race:cancelled', (payload: { reason: string }) => {
  console.log(`Largada cancelada: ${payload.reason}`)
  racing = false
})

socket.on('disconnect', () => console.log('Desconectado.'))

process.on('SIGINT', () => {
  socket.emit('room:leave')
  socket.disconnect()
  process.exit(0)
})
