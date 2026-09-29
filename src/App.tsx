import type { AuthChangeEvent } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { carById, DEFAULT_CAR, toCarId, type CarId } from './game/cars'
import { carImageUrl, precarregarCarro } from './game/carSprites'
import { aoMudarASessao, sair as sairDoSupabase, sessaoAtual, type SessaoDaConta } from './conta/conta'
import Entrada, { type ModoDaEntrada } from './conta/Entrada'
import { haSessaoGuardada, voltaDeLinkDaConta } from './conta/supabase'
import {
  CIRCUITO_OFICIAL,
  CONTAGEM_DO_CONTRARRELOGIO_MS,
  diaDe,
  DIFICULDADE_OFICIAL,
  guardarSeRecorde,
  lerRecorde,
  limitesDasMedalhas,
  medalhaPara,
  MEDALHAS,
  NOME_DA_MEDALHA,
  sementeDoDia,
  tempoDoPiloto,
  type Armazenamento,
  type Medalha,
  type Recorde,
} from './game/contrarrelogio'
import { precarregarVoz, vozDoCarro } from './game/motorF1'
import { DEFAULT_COUNTDOWN_MS } from './game/countdown'
import { desafiosDaSemana, MODIFICADORES, semanaDe, type Desafio, type Modificador } from './game/desafios'
import { GhostTracker, type GhostSnapshot } from './game/ghost'
import RaceCanvas, { type RaceResult } from './game/RaceCanvas'
import { DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_NOTES, type Difficulty } from './game/rules'
import { formatTime } from './game/track'
import type { GravacaoDeVolta } from './game/gravador'
import { serverClock, type ClockState } from './multiplayer/clock'
import { identificadorDoPiloto } from './multiplayer/identity'
import Lobby from './multiplayer/Lobby'
import {
  apelidoLivre,
  entrarNaConta,
  sairDaConta,
  verPerfil,
  type PerfilDoPiloto,
  type PerfilPublico,
} from './multiplayer/perfil'
import {
  buscarEscada,
  buscarSituacao,
  entrarNaFila,
  sairDaFila,
  type LinhaDaEscada,
  type ResultadoRanqueado,
  type SituacaoDaRanqueada,
} from './multiplayer/ranqueada'
import Ranqueada from './ranqueada/Ranqueada'
import {
  buscarCopa,
  inscreverNaCopa,
  sairDaCopa,
  TACA,
  type RodadaDaCopa,
  type SituacaoDaCopa,
} from './multiplayer/copa'
import {
  abrirTentativa,
  baixarFantasma,
  buscarDesafios,
  buscarQuadro,
  enviarVolta,
  type LinhaDoQuadro,
  type PedidoDeProva,
  type QuadroDoDia,
  type ResumoDoDesafio,
  type VereditoDaVolta,
} from './multiplayer/pistaDoDia'
import { socket } from './multiplayer/socket'
import Perfil from './perfil/Perfil'
import PilotSelect from './PilotSelect'
import Ranking, { type AbaDoRanking } from './ranking/Ranking'
import ResumoDaProva from './ResumoDaProva'
import type {
  LobbyRoom,
  RaceCancelled,
  RaceOutcome,
  RivalTelemetry,
  RoomResponse,
  ScheduledRace,
} from './multiplayer/types'

type Screen = 'menu' | 'garage' | 'lobby' | 'race' | 'result' | 'ranqueada' | 'entrada' | 'perfil' | 'ranking'
type RaceSetup = {
  startAt: number
  countdownMs: number
  trackSeed: number
  difficulty: Difficulty
  mode: 'solo' | 'online' | 'contrarrelogio'
  /** O modificador do desafio da semana, quando a prova é de um. */
  modificador?: Modificador | null
}

/** Um fantasma de outro piloto, baixado do quadro do dia para correr contra ele. */
type FantasmaDeOutro = { nome: string; tempo: number; gravacao: GravacaoDeVolta }

/**
 * A prova do contrarrelógio em curso: o dia, a semente, o fantasma que corre
 * junto — o recorde pessoal ou o de outro piloto — e a tentativa aberta no
 * servidor, quando há conexão e perfil.
 */
type Contrarrelogio = {
  dia: string
  seed: number
  recorde: (Recorde & { nome?: string }) | null
  contra: FantasmaDeOutro | null
  tentativa: string | null
  /** O desafio da semana, ou null para a Pista do Dia. */
  desafio: Desafio | null
  /** A volta é no Circuito Oficial: vale no ranking mundial. */
  oficial: boolean
}

/** O que o contrarrelógio rendeu: tempo, medalha e se virou recorde. */
type ResultadoDoContrarrelogio = {
  tempo: number
  medalha: Medalha | null
  recordeAnterior: number | null
  novoRecorde: boolean
  /** O que o servidor disse da volta, quando ela foi para o quadro. */
  servidor: VereditoDaVolta | null
  enviando: boolean
}
type Connection = 'connected' | 'reconnecting'

const storedPlayerId = identificadorDoPiloto(sessionStorage, globalThis.crypto)

// Uma atualização acidental da página não pode custar a vaga na sala.
const ROOM_KEY = 'ghost-racer-room'
const NAME_KEY = 'ghost-racer-name'
/** Se a sala guardada é de piloto ou de arquibancada. */
const ROLE_KEY = 'ghost-racer-role'

type Papel = 'piloto' | 'espectador'

/** A navegação privada pode recusar o armazenamento; o jogo segue sem ele. */
function lerGuardado(chave: string) {
  try {
    return sessionStorage.getItem(chave)
  } catch {
    return null
  }
}

function guardar(chave: string, valor: string) {
  try {
    sessionStorage.setItem(chave, valor)
  } catch {
    // Sem armazenamento, só se perde a recuperação após recarregar a página.
  }
}

function esquecer(chave: string) {
  try {
    sessionStorage.removeItem(chave)
  } catch {
    // Nada a fazer.
  }
}

const storedRoom = lerGuardado(ROOM_KEY)
const storedName = lerGuardado(NAME_KEY) ?? 'Piloto'
// Sem sala guardada, não há arquibancada para onde voltar.
const storedRole: Papel = storedRoom && lerGuardado(ROLE_KEY) === 'espectador' ? 'espectador' : 'piloto'
/**
 * O link de assistir leva direto à arquibancada: é o do telão do evento, que
 * ninguém vai ficar clicando.
 */
const linkDeAssistir = new URLSearchParams(location.search).get('assistir') === '1'

/**
 * O carro, ao contrário da sala e do nome, fica guardado entre visitas: é uma
 * preferência do piloto, não da partida. O que vier do armazenamento passa
 * pela mesma validação do servidor — um id que saiu da garagem vira o padrão.
 */
const CAR_KEY = 'ghost-racer-car'

function lerCarro(): CarId {
  try {
    return toCarId(localStorage.getItem(CAR_KEY))
  } catch {
    return DEFAULT_CAR
  }
}

function guardarCarro(car: CarId) {
  try {
    localStorage.setItem(CAR_KEY, car)
  } catch {
    // Sem armazenamento a escolha vale só até recarregar a página.
  }
}

const storedCar = lerCarro()

/**
 * O armazenamento dos recordes, que ficam entre visitas. A navegação privada
 * pode recusá-lo: sem ele, o contrarrelógio corre igual, só não guarda nada.
 */
function armazenamentoLocal(): Armazenamento | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** A cor do carro vira variável de CSS para bordas e destaques. */
const destaque = (car: CarId) => ({ '--accent': carById(car).accent }) as CSSProperties

/** Quem escolheu correr sem conta: a porta de entrada não abre mais sozinha para ele. */
const CONVIDADO_KEY = 'corrida-convidado'

function escolheuConvidado() {
  try {
    return localStorage.getItem(CONVIDADO_KEY) === '1'
  } catch {
    return false
  }
}

function lembrarConvidado(convidado: boolean) {
  try {
    if (convidado) localStorage.setItem(CONVIDADO_KEY, '1')
    else localStorage.removeItem(CONVIDADO_KEY)
  } catch {
    // Sem armazenamento, a porta de entrada só volta a aparecer na próxima visita.
  }
}

/** O aparelho já tem uma conta aberta: ela entra sozinha, sem porta de entrada. */
const comContaGuardada = haSessaoGuardada()
/** A página abriu pelo link de um e-mail da conta — a confirmação, ou a troca de senha. */
const voltaDoEmail = voltaDeLinkDaConta()
/**
 * A porta de entrada abre na primeira visita. Não abre para quem volta a uma
 * sala depois de recarregar a página, nem no telão da arquibancada, que
 * ninguém vai ficar clicando.
 */
const abrirNaEntrada = !storedRoom && !linkDeAssistir && !comContaGuardada && !voltaDoEmail && !escolheuConvidado()

/** O cliente das contas só é acompanhado uma vez por página, e só por quem precisa dele. */
let acompanhandoAConta = false

function App() {
  const [screen, setScreen] = useState<Screen>(abrirNaEntrada ? 'entrada' : 'menu')
  const [pilotName, setPilotName] = useState(storedName)
  const [draftName, setDraftName] = useState('')
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '')
  const [room, setRoom] = useState<LobbyRoom | null>(null)
  const [lobbyError, setLobbyError] = useState('')
  const [lobbyNotice, setLobbyNotice] = useState('')
  const [raceKey, setRaceKey] = useState(0)
  const [raceSetup, setRaceSetup] = useState<RaceSetup | null>(null)
  const [result, setResult] = useState<RaceResult | null>(null)
  const [outcome, setOutcome] = useState<RaceOutcome | null>(null)
  const [connection, setConnection] = useState<Connection>(socket.connected ? 'connected' : 'reconnecting')
  const [clock, setClock] = useState<ClockState>(serverClock.snapshot)
  /** Dificuldade do modo treino. Na corrida online quem manda é a sala. */
  const [soloDifficulty, setSoloDifficulty] = useState<Difficulty>('normal')
  const [car, setCar] = useState<CarId>(storedCar)
  /** De onde se chegou à garagem, que é para onde ela devolve. */
  const [garageFrom, setGarageFrom] = useState<'menu' | 'lobby'>('menu')
  const [contrarrelogio, setContrarrelogio] = useState<Contrarrelogio | null>(null)
  const [resultadoDoContrarrelogio, setResultadoDoContrarrelogio] = useState<ResultadoDoContrarrelogio | null>(null)
  /** Muda quando um recorde é guardado, para o menu reler o dele. */
  const [versaoDosRecordes, setVersaoDosRecordes] = useState(0)
  const contrarrelogioRef = useRef(contrarrelogio)
  contrarrelogioRef.current = contrarrelogio
  /**
   * A conta: a sessão do Supabase, que mora no aparelho, e o perfil que o
   * servidor do jogo ligou a esta conexão depois de conferi-la. Convidado não
   * tem nenhum dos dois.
   */
  const [sessao, setSessao] = useState<SessaoDaConta | null>(null)
  const sessaoRef = useRef(sessao)
  sessaoRef.current = sessao
  /** Há conta guardada, e o Supabase ainda não respondeu se ela vale. */
  const [contaCarregando, setContaCarregando] = useState(comContaGuardada || voltaDoEmail)
  /** A sessão vale, mas o servidor do jogo não respondeu ao ligá-la: o menu oferece tentar de novo. */
  const [contaSemServidor, setContaSemServidor] = useState(false)
  const [perfil, setPerfil] = useState<PerfilPublico | null>(null)
  const perfilRef = useRef(perfil)
  perfilRef.current = perfil
  /** A porta de entrada: em que formulário abre, para onde volta e o recado de quem a abriu. */
  const [modoDaEntrada, setModoDaEntrada] = useState<ModoDaEntrada>('entrar')
  const [entradaVoltaPara, setEntradaVoltaPara] = useState<Screen | null>(null)
  const [avisoDaEntrada, setAvisoDaEntrada] = useState('')
  /** O perfil aberto: o id do piloto (null é o próprio), o que o servidor mandou e para onde voltar. */
  const [perfilAberto, setPerfilAberto] = useState<string | null>(null)
  const [perfilVisto, setPerfilVisto] = useState<PerfilDoPiloto | null>(null)
  const [perfilCarregando, setPerfilCarregando] = useState(false)
  const [perfilErro, setPerfilErro] = useState('')
  const [perfilVoltaPara, setPerfilVoltaPara] = useState<Screen>('menu')
  /** O ranking mundial: a aba, os três quadros e para onde voltar. */
  const [abaDoRanking, setAbaDoRanking] = useState<AbaDoRanking>('mundial')
  const [rankingMundial, setRankingMundial] = useState<QuadroDoDia | null>(null)
  const [rankingDoDia, setRankingDoDia] = useState<QuadroDoDia | null>(null)
  const [escadaDoRanking, setEscadaDoRanking] = useState<{ temporada: string; escada: LinhaDaEscada[] } | null>(null)
  const [rankingCarregando, setRankingCarregando] = useState(false)
  const [rankingVoltaPara, setRankingVoltaPara] = useState<Screen>('menu')
  const [quadroDoDia, setQuadroDoDia] = useState<QuadroDoDia | null>(null)
  /** Os desafios da semana, com o líder de cada um, quando há servidor. */
  const [desafiosDoServidor, setDesafiosDoServidor] = useState<ResumoDoDesafio[] | null>(null)
  /** A ranqueada: o painel do piloto, a fila e o resultado da última corrida. */
  const [situacaoRanqueada, setSituacaoRanqueada] = useState<SituacaoDaRanqueada | null>(null)
  const [naFila, setNaFila] = useState(false)
  const [tamanhoDaFila, setTamanhoDaFila] = useState(0)
  const [naFilaDesde, setNaFilaDesde] = useState<number | null>(null)
  const [avisoRanqueado, setAvisoRanqueado] = useState('')
  const [resultadosRanqueados, setResultadosRanqueados] = useState<ResultadoRanqueado[] | null>(null)
  /** A Copa do Dia: a situação de hoje e o que a última rodada decidiu. */
  const [copa, setCopa] = useState<SituacaoDaCopa | null>(null)
  const [rodadaDaCopa, setRodadaDaCopa] = useState<RodadaDaCopa | null>(null)
  const [avisoDaCopa, setAvisoDaCopa] = useState('')
  /** Bate uma vez por segundo enquanto há relógio da copa na tela. */
  const [, setTique] = useState(0)

  /**
   * A Pista do Dia: a mesma semente para todo mundo, no nível oficial. O tempo
   * de referência das medalhas sai do piloto de teste que usa tudo, rodado uma
   * vez fora da tela.
   */
  const hoje = diaDe(new Date())
  const pistaDoDia = useMemo(() => {
    const seed = sementeDoDia(hoje)
    return { dia: hoje, seed, limites: limitesDasMedalhas(tempoDoPiloto(seed, DIFICULDADE_OFICIAL)) }
  }, [hoje])
  // A versão não entra na conta, mas é ela que diz quando reler o recorde.
  const recordeDoDia = useMemo(
    () => (versaoDosRecordes >= 0 ? lerRecorde(armazenamentoLocal(), pistaDoDia.seed, DIFICULDADE_OFICIAL) : null),
    [pistaDoDia.seed, versaoDosRecordes],
  )
  /** O recorde pessoal no Circuito Oficial, guardado no aparelho como o da Pista do Dia. */
  const recordeDoCircuito = useMemo(
    () => (versaoDosRecordes >= 0 ? lerRecorde(armazenamentoLocal(), CIRCUITO_OFICIAL.seed, CIRCUITO_OFICIAL.dificuldade) : null),
    [versaoDosRecordes],
  )
  /** Piloto no grid ou espectador na arquibancada da sala atual. */
  const [papel, setPapel] = useState<Papel>(storedRole)

  // Refs para o ciclo do socket, que não deve depender do estado da tela.
  const ghostsRef = useRef(new Map<string, GhostTracker>())
  /** A abertura da sala, para o ciclo do socket chamar a versão atual. */
  const abrirSalaRef = useRef<(sala: LobbyRoom, papel: Papel) => void>(() => undefined)
  const abrirSala = (sala: LobbyRoom, papel: Papel) => abrirSalaRef.current(sala, papel)
  /**
   * Sai da arquibancada junto com a sala. Todo caminho que esquece a sala passa
   * por aqui: senão o papel de espectador sobraria para a próxima sala, e quem
   * entrasse nela por outro caminho que não o `openRoom` correria como plateia.
   */
  const voltarAPiloto = () => {
    esquecer(ROLE_KEY)
    papelRef.current = 'piloto'
    setPapel('piloto')
  }
  const roomCodeRef = useRef<string | null>(storedRoom)
  const pilotNameRef = useRef(pilotName)
  const carRef = useRef(car)
  /** A sala atual é da fila ranqueada: a chegada leva a volta gravada, para virar fantasma. */
  const salaRanqueadaRef = useRef(false)
  salaRanqueadaRef.current = Boolean(room?.ranqueada)
  const screenRef = useRef(screen)
  /**
   * O modo da prova em andamento. A chegada decide por ele se é contrarrelógio:
   * antes decidia por haver um contrarrelógio guardado, e uma corrida online
   * depois dele virava recorde pessoal em vez de chegar ao servidor.
   */
  const modoDaProvaRef = useRef<RaceSetup['mode'] | null>(null)
  modoDaProvaRef.current = raceSetup?.mode ?? null
  const papelRef = useRef(papel)
  pilotNameRef.current = pilotName
  carRef.current = car
  screenRef.current = screen
  papelRef.current = papel

  useEffect(() => serverClock.subscribe(setClock), [])

  /**
   * O que depende de quem está conectado: o quadro de hoje, os desafios e a
   * copa valem para todos — o convidado vê, só não aparece —, e a ranqueada é
   * só da conta.
   */
  const lerOQueMudaComAConta = useCallback(() => {
    void buscarQuadro(socket).then(setQuadroDoDia)
    void buscarDesafios(socket).then(setDesafiosDoServidor)
    void buscarCopa(socket).then(setCopa)
    void buscarQuadro(socket, { circuito: 'oficial' }, 3).then(setRankingMundial)
    if (perfilRef.current) void buscarSituacao(socket).then(setSituacaoRanqueada)
    else setSituacaoRanqueada(null)
  }, [])

  /** O token que esta conexão já mandou ao servidor: o mesmo não vai duas vezes. */
  const tokenLigadoRef = useRef<string | null>(null)
  /**
   * Liga esta conexão à conta: o servidor confere o token do Supabase e devolve
   * o perfil. É o apelido do cadastro que passa a ser o nome do piloto.
   */
  const ligarAConta = useCallback(
    async (token: string) => {
      if (!socket.connected || tokenLigadoRef.current === token) return
      tokenLigadoRef.current = token
      setContaSemServidor(false)
      const resposta = await entrarNaConta(socket, token)
      if ('perfil' in resposta) {
        perfilRef.current = resposta.perfil
        setPerfil(resposta.perfil)
        pilotNameRef.current = resposta.perfil.apelido
        setPilotName(resposta.perfil.apelido)
      } else {
        tokenLigadoRef.current = null
        perfilRef.current = null
        setPerfil(null)
        if (resposta.recusada) {
          // A sessão do aparelho não vale mais no servidor: ela sai daqui também,
          // e o piloto segue como convidado até entrar de novo.
          sessaoRef.current = null
          setSessao(null)
          void sairDoSupabase()
          setLobbyError('Sua sessão venceu. Entre de novo para voltar à conta.')
        } else {
          setContaSemServidor(true)
        }
      }
      lerOQueMudaComAConta()
    },
    [lerOQueMudaComAConta],
  )
  const ligarAContaRef = useRef(ligarAConta)
  ligarAContaRef.current = ligarAConta

  /** A conta saiu — por escolha, ou porque a sessão acabou em outro aparelho. */
  const esquecerAConta = useCallback(() => {
    tokenLigadoRef.current = null
    setContaSemServidor(false)
    perfilRef.current = null
    setPerfil(null)
    const nome = lerGuardado(NAME_KEY) ?? 'Piloto'
    pilotNameRef.current = nome
    setPilotName(nome)
    setSituacaoRanqueada(null)
    setNaFila(false)
    setNaFilaDesde(null)
    if (socket.connected) void sairDaConta(socket)
    lerOQueMudaComAConta()
  }, [lerOQueMudaComAConta])

  /**
   * Acompanha a sessão do Supabase: a que já estava no aparelho, a que o
   * formulário acabou de abrir, a renovação do token e a saída. Só começa
   * para quem tem conta ou vai entrar numa — o convidado nem baixa o cliente.
   */
  const acompanharAConta = useCallback(() => {
    if (acompanhandoAConta) return
    acompanhandoAConta = true
    void aoMudarASessao((nova, evento: AuthChangeEvent) => {
      setContaCarregando(false)
      if (evento === 'PASSWORD_RECOVERY') {
        // O link de trocar a senha abre a conta e pede a senha nova.
        setModoDaEntrada('nova-senha')
        setEntradaVoltaPara('menu')
        setScreen('entrada')
      }
      const tinha = sessaoRef.current
      sessaoRef.current = nova
      setSessao(nova)
      if (nova) {
        lembrarConvidado(false)
        // Renovar o token não muda a conta: a conexão continua ligada a ela.
        if (evento !== 'TOKEN_REFRESHED' || !perfilRef.current) void ligarAContaRef.current(nova.token)
      } else if (tinha) {
        esquecerAConta()
      }
    }).catch(() => {
      acompanhandoAConta = false
      setContaCarregando(false)
    })
  }, [esquecerAConta])

  // Quem já tinha conta no aparelho, ou voltou por um link do e-mail, entra nela sozinho.
  useEffect(() => {
    if (comContaGuardada || voltaDoEmail) acompanharAConta()
  }, [acompanharAConta])

  // A arte e a voz do carro da corrida começam a baixar antes dela — no menu,
  // na garagem, no lobby —, e não nas luzes da largada, quando a sala inteira
  // disputa o mesmo Wi-Fi. Na arquibancada, a voz é a do primeiro piloto.
  const carroDaVoz = papel === 'espectador' ? (room?.players[0]?.car ?? car) : car
  useEffect(() => {
    precarregarCarro(car)
  }, [car])
  useEffect(() => {
    precarregarVoz(vozDoCarro(carroDaVoz))
  }, [carroDaVoz])
  // Os carros da sala também: são os fantasmas que a corrida vai desenhar.
  const carrosDaSala = room?.players.map((player) => player.car).join(' ') ?? ''
  useEffect(() => {
    for (const id of carrosDaSala.split(' ')) if (id) precarregarCarro(toCarId(id))
  }, [carrosDaSala])

  useEffect(() => {
    const onConnect = () => {
      setConnection('connected')
      void serverClock.sync(socket)
      // Com conta, a conexão nova — ou a que voltou de uma queda — liga-se a ela
      // com um token fresco. Sem conta, o jogo segue como convidado.
      tokenLigadoRef.current = null
      if (sessaoRef.current) {
        void sessaoAtual().then((atual) => {
          if (atual) void ligarAContaRef.current(atual.token)
          else lerOQueMudaComAConta()
        })
      } else {
        lerOQueMudaComAConta()
      }
      // Depois de uma queda, volta para a mesma sala com o mesmo identificador.
      const code = roomCodeRef.current
      if (!code) {
        // Aberto pelo link de assistir: vai direto para a arquibancada.
        const pedido = linkDeAssistir ? new URLSearchParams(location.search).get('room')?.toUpperCase() : null
        if (pedido && screenRef.current === 'menu') {
          socket.emit('room:spectate', { code: pedido, name: pilotNameRef.current, spectatorId: storedPlayerId }, (response: RoomResponse) => {
            if (response.ok && response.room) abrirSala(response.room, 'espectador')
            else setLobbyError(response.error ?? 'Não foi possível assistir a esta sala.')
          })
        }
        return
      }
      const espectando = papelRef.current === 'espectador'
      const payload = espectando
        ? { code, name: pilotNameRef.current, spectatorId: storedPlayerId }
        : { code, name: pilotNameRef.current, playerId: storedPlayerId, car: carRef.current }
      socket.emit(espectando ? 'room:spectate' : 'room:join', payload, (response: RoomResponse) => {
        if (response.ok && response.room) {
          setRoom(response.room)
          setLobbyError('')
          // Depois de recarregar a página o piloto volta direto para a sala.
          if (screenRef.current === 'menu') setScreen('lobby')
          return
        }
        roomCodeRef.current = null
        esquecer(ROOM_KEY)
        voltarAPiloto()
        setRoom(null)
        setRaceSetup(null)
        setScreen('menu')
        setLobbyError(response.error ?? 'A sala não está mais disponível.')
      })
    }

    const onDisconnect = () => setConnection('reconnecting')
    const onRoomUpdate = (nextRoom: LobbyRoom) => setRoom(nextRoom)

    const onScheduled = (payload: ScheduledRace) => {
      // O horário enviado pelo servidor impede que um relógio atrasado largue tarde.
      serverClock.guard(payload.serverTime)
    }

    const onCancelled = (payload: RaceCancelled) => {
      setRaceSetup(null)
      setLobbyNotice(payload.reason)
      if (screenRef.current === 'race') setScreen('lobby')
    }

    // Cada adversário tem seu próprio buffer contra atraso e pacotes fora de ordem.
    const onRival = (payload: RivalTelemetry) => {
      let tracker = ghostsRef.current.get(payload.playerId)
      if (!tracker) {
        tracker = new GhostTracker()
        ghostsRef.current.set(payload.playerId, tracker)
      }
      tracker.push(payload)
    }

    // O anfitrião tirou este piloto do grid: volta ao menu dizendo por quê.
    const onKicked = (payload: { code: string }) => {
      if (roomCodeRef.current !== payload.code) return
      roomCodeRef.current = null
      esquecer(ROOM_KEY)
      voltarAPiloto()
      setRoom(null)
      setRaceSetup(null)
      setLobbyNotice('')
      setScreen('menu')
      setLobbyError('O anfitrião tirou você da sala.')
      history.replaceState(null, '', location.pathname)
    }

    // Resultado oficial: o mesmo objeto chega nas duas telas.
    const onResult = (payload: RaceOutcome) => {
      setOutcome(payload)
      setScreen('result')
    }

    // Ranqueada: a fila achou a sala. A largada já está marcada, e a tela vai
    // direto para as luzes, sem lobby.
    const onPartida = (payload: { room: LobbyRoom }) => {
      roomCodeRef.current = payload.room.code
      guardar(ROOM_KEY, payload.room.code)
      voltarAPiloto()
      setRoom(payload.room)
      setNaFila(false)
      setNaFilaDesde(null)
      setResultadosRanqueados(null)
      setAvisoRanqueado('')
    }
    const onFila = (payload: { tamanho: number; desde: number }) => {
      setTamanhoDaFila(payload.tamanho)
      setNaFilaDesde(payload.desde)
    }
    // A largada caiu antes de sair: ninguém ganha nem perde, e quem ficou volta
    // para a fila sozinho.
    const onCancelada = (payload: { code: string; motivo: string }) => {
      if (roomCodeRef.current !== payload.code) return
      socket.emit('room:leave')
      roomCodeRef.current = null
      esquecer(ROOM_KEY)
      voltarAPiloto()
      setRoom(null)
      setRaceSetup(null)
      setScreen('ranqueada')
      setAvisoRanqueado(payload.motivo)
      void entrarNaFila(socket, { playerId: storedPlayerId, carro: carRef.current }).then((entrada) => {
        setNaFila(entrada.ok)
        if (entrada.ok) setNaFilaDesde(Date.now())
      })
    }
    const onResultadosRanqueados = (payload: { code: string; resultados: ResultadoRanqueado[] }) => {
      if (roomCodeRef.current !== payload.code) return
      setResultadosRanqueados(payload.resultados)
      void buscarSituacao(socket).then(setSituacaoRanqueada)
    }

    // Copa do Dia: a próxima rodada da divisão já tem sala e largada marcada.
    // Quem estava no menu vai direto para as luzes, passando pelo lobby.
    const onPartidaDaCopa = (payload: { room: LobbyRoom }) => {
      roomCodeRef.current = payload.room.code
      guardar(ROOM_KEY, payload.room.code)
      voltarAPiloto()
      setRoom(payload.room)
      setRodadaDaCopa(null)
      setScreen((atual) => (atual === 'menu' ? 'lobby' : atual))
    }
    const onRodadaDaCopa = (payload: RodadaDaCopa) => {
      // Sem sala é o campeão por desistência dos outros: a notícia é dele.
      if (payload.code !== null && roomCodeRef.current !== payload.code) return
      setRodadaDaCopa(payload)
      void buscarCopa(socket).then(setCopa)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('room:update', onRoomUpdate)
    socket.on('race:scheduled', onScheduled)
    socket.on('race:cancelled', onCancelled)
    socket.on('race:rival', onRival)
    socket.on('race:result', onResult)
    socket.on('room:kicked', onKicked)
    socket.on('ranqueada:partida', onPartida)
    socket.on('ranqueada:fila', onFila)
    socket.on('ranqueada:cancelada', onCancelada)
    socket.on('ranqueada:resultados', onResultadosRanqueados)
    socket.on('copa:partida', onPartidaDaCopa)
    socket.on('copa:rodada', onRodadaDaCopa)
    if (socket.connected) onConnect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('room:update', onRoomUpdate)
      socket.off('race:scheduled', onScheduled)
      socket.off('race:cancelled', onCancelled)
      socket.off('race:rival', onRival)
      socket.off('race:result', onResult)
      socket.off('room:kicked', onKicked)
      socket.off('ranqueada:partida', onPartida)
      socket.off('ranqueada:fila', onFila)
      socket.off('ranqueada:cancelada', onCancelada)
      socket.off('ranqueada:resultados', onResultadosRanqueados)
      socket.off('copa:partida', onPartidaDaCopa)
      socket.off('copa:rodada', onRodadaDaCopa)
    }
  }, [])

  // No menu, a copa se atualiza sozinha: a fase muda com o relógio, e a
  // classificação com as voltas dos outros.
  const faseDaCopa = copa?.fase ?? null
  useEffect(() => {
    if (screen !== 'menu' || connection !== 'connected') return
    const relogio = window.setInterval(() => setTique((tique) => tique + 1), 1_000)
    const releitura = window.setInterval(() => void buscarCopa(socket).then(setCopa), 15_000)
    return () => {
      window.clearInterval(relogio)
      window.clearInterval(releitura)
    }
  }, [screen, connection, faseDaCopa])

  // Na tela de resultado, a contagem até a próxima rodada da copa.
  const proximaRodadaEm = rodadaDaCopa?.proximaEm ?? null
  useEffect(() => {
    if (screen !== 'result' || proximaRodadaEm === null) return
    const relogio = window.setInterval(() => setTique((tique) => tique + 1), 250)
    return () => window.clearInterval(relogio)
  }, [screen, proximaRodadaEm])

  // A largada é disparada pelo estado oficial da sala, igual nos dois dispositivos.
  useEffect(() => {
    if (!room?.startAt) return
    if (room.status !== 'countdown' && room.status !== 'racing') return
    setRaceSetup((current) => {
      if (current?.startAt === room.startAt && current.mode === 'online') return current
      // Cada largada começa com todos os fantasmas zerados.
      ghostsRef.current.clear()
      // O traçado vem da sala: é o servidor que decide, e o mesmo número chega
      // a todos os pilotos antes da contagem começar.
      return {
        startAt: room.startAt!,
        countdownMs: room.countdownMs,
        trackSeed: room.trackSeed,
        difficulty: room.difficulty,
        mode: 'online',
      }
    })
    setLobbyNotice('')
    setResult(null)
    setOutcome(null)
    // Quem estava na garagem, vindo do lobby, também vai para a largada: a
    // confirmação dele continua valendo enquanto escolhe.
    setScreen((current) =>
      current === 'result' || current === 'lobby' || current === 'garage' || current === 'ranqueada' ? 'race' : current,
    )
  }, [room?.startAt, room?.status, room?.countdownMs])

  /** O nome do piloto: na conta, o do cadastro; como convidado, o que ele digitou. */
  const selectedName = () => {
    if (perfilRef.current) return perfilRef.current.apelido
    const name = draftName.trim().slice(0, 16) || pilotName
    setPilotName(name)
    pilotNameRef.current = name
    guardar(NAME_KEY, name)
    return name
  }

  const openRoom = (nextRoom: LobbyRoom, novoPapel: Papel = 'piloto') => {
    roomCodeRef.current = nextRoom.code
    guardar(ROOM_KEY, nextRoom.code)
    guardar(ROLE_KEY, novoPapel)
    setPapel(novoPapel)
    papelRef.current = novoPapel
    setRoom(nextRoom)
    setLobbyError('')
    setLobbyNotice('')
    // Quem chega à arquibancada no meio da prova vai direto para a pista: o
    // efeito da largada cuida disso. Os outros esperam no lobby.
    setScreen((atual) => (atual === 'race' ? atual : 'lobby'))
    history.replaceState(null, '', novoPapel === 'espectador' ? `?room=${nextRoom.code}&assistir=1` : `?room=${nextRoom.code}`)
  }
  abrirSalaRef.current = openRoom

  const createRoom = () => {
    socket.emit('room:create', { name: selectedName(), playerId: storedPlayerId, car }, (response: RoomResponse) => {
      if (response.ok && response.room) openRoom(response.room)
      else setLobbyError(response.error ?? 'Não foi possível criar a sala.')
    })
  }

  const enterRoom = () => {
    const code = joinCode.trim().toUpperCase()
    if (!code) return setLobbyError('Digite o código da sala.')
    socket.emit('room:join', { code, name: selectedName(), playerId: storedPlayerId, car }, (response: RoomResponse) => {
      if (response.ok && response.room) openRoom(response.room)
      else setLobbyError(response.error ?? 'Não foi possível entrar na sala.')
    })
  }

  /** Arquibancada: assistir sem ocupar vaga, com o grid cheio ou a prova em andamento. */
  const spectateRoom = () => {
    const code = joinCode.trim().toUpperCase()
    if (!code) return setLobbyError('Digite o código da sala.')
    socket.emit('room:spectate', { code, name: selectedName(), spectatorId: storedPlayerId }, (response: RoomResponse) => {
      if (response.ok && response.room) openRoom(response.room, 'espectador')
      else setLobbyError(response.error ?? 'Não foi possível assistir a esta sala.')
    })
  }

  /** Do lobby: quem assistia desce para uma vaga livre do grid. */
  const entrarNoGrid = () => {
    if (!room) return
    socket.emit('room:join', { code: room.code, name: pilotName, playerId: storedPlayerId, car }, (response: RoomResponse) => {
      if (response.ok && response.room) openRoom(response.room, 'piloto')
      else setLobbyNotice(response.error ?? 'Não foi possível entrar no grid.')
    })
  }

  /** Do lobby: quem estava no grid sobe para assistir, liberando a vaga. */
  const irParaArquibancada = () => {
    if (!room) return
    socket.emit('room:spectate', { code: room.code, name: pilotName, spectatorId: storedPlayerId }, (response: RoomResponse) => {
      if (response.ok && response.room) openRoom(response.room, 'espectador')
      else setLobbyNotice(response.error ?? 'Não foi possível ir para a arquibancada.')
    })
  }

  const openGarage = (from: 'menu' | 'lobby') => {
    setGarageFrom(from)
    setScreen('garage')
  }

  const leaveGarage = useCallback(() => {
    setScreen(garageFrom === 'lobby' && roomCodeRef.current ? 'lobby' : 'menu')
  }, [garageFrom])

  const chooseCar = useCallback(
    (next: CarId) => {
      setCar(next)
      carRef.current = next
      guardarCarro(next)
      // Na sala, o servidor precisa saber: é com este carro que os rivais vão
      // desenhar o fantasma.
      const code = roomCodeRef.current
      if (garageFrom === 'lobby' && code) {
        socket.emit('room:set-car', { code, playerId: storedPlayerId, car: next }, (response: RoomResponse) => {
          if (response.ok && response.room) setRoom(response.room)
          else setLobbyNotice(response.error ?? 'Não foi possível trocar o carro.')
        })
      }
      leaveGarage()
    },
    [garageFrom, leaveGarage],
  )

  const startSoloRace = () => {
    selectedName()
    setResult(null)
    // No treino não há com quem sincronizar: cada volta estreia um traçado.
    setRaceSetup({
      startAt: Date.now() + DEFAULT_COUNTDOWN_MS,
      countdownMs: DEFAULT_COUNTDOWN_MS,
      trackSeed: Math.floor(Math.random() * 0xffffffff),
      difficulty: soloDifficulty,
      mode: 'solo',
    })
    setRaceKey((value) => value + 1)
    setScreen('race')
  }

  /**
   * Larga o contrarrelógio: a Pista do Dia, um desafio da semana ou o Circuito
   * Oficial do ranking mundial. A contagem é curta e o recomeço é o mesmo
   * caminho: tentar de novo não pode custar mais que desistir.
   */
  const startTimeTrial = async (contra: FantasmaDeOutro | null = null, desafio: Desafio | null = null, oficial = false) => {
    selectedName()
    const dia = diaDe(new Date())
    // Sem desafio é a Pista do Dia; com um, a semente, o nível e o modificador dele.
    const seed = oficial ? CIRCUITO_OFICIAL.seed : (desafio?.seed ?? sementeDoDia(dia))
    const dificuldade = oficial ? CIRCUITO_OFICIAL.dificuldade : (desafio?.dificuldade ?? DIFICULDADE_OFICIAL)
    const pedido: PedidoDeProva = oficial ? { circuito: 'oficial' } : desafio ? { desafio: desafio.id } : {}
    // Com conta, o servidor abre a tentativa e passa a contar o tempo dela;
    // sem resposta rápida — ou como convidado —, a volta vale só para o recorde pessoal.
    const aberta = perfilRef.current ? await abrirTentativa(socket, pedido) : null
    const fantasma = contra
      ? { tempo: contra.tempo, gravacao: contra.gravacao, em: '', nome: contra.nome }
      : lerRecorde(armazenamentoLocal(), seed, dificuldade)
    setResult(null)
    setResultadoDoContrarrelogio(null)
    setContrarrelogio({ dia, seed, recorde: fantasma, contra, tentativa: aberta?.tentativa ?? null, desafio, oficial })
    setRaceSetup({
      startAt: Date.now() + CONTAGEM_DO_CONTRARRELOGIO_MS,
      countdownMs: CONTAGEM_DO_CONTRARRELOGIO_MS,
      trackSeed: seed,
      difficulty: dificuldade,
      mode: 'contrarrelogio',
      modificador: desafio?.modificador ?? null,
    })
    setRaceKey((value) => value + 1)
    setScreen('race')
  }

  /** Abre a tela da ranqueada, com o painel e a escada frescos. */
  const abrirRanqueada = () => {
    selectedName()
    setAvisoRanqueado('')
    setScreen('ranqueada')
    if (socket.connected) void buscarSituacao(socket).then(setSituacaoRanqueada)
  }

  const entrarNaFilaRanqueada = async () => {
    setAvisoRanqueado('')
    const entrada = await entrarNaFila(socket, { playerId: storedPlayerId, carro: carRef.current })
    if (entrada.ok) {
      setNaFila(true)
      setNaFilaDesde(Date.now())
      setTamanhoDaFila(1)
      return
    }
    setAvisoRanqueado(entrada.motivo)
    void buscarSituacao(socket).then(setSituacaoRanqueada)
  }

  const sairDaFilaRanqueada = async () => {
    await sairDaFila(socket)
    setNaFila(false)
    setNaFilaDesde(null)
  }

  /** Deixa a sala ranqueada que terminou. */
  const deixarSalaRanqueada = () => {
    socket.emit('room:leave')
    roomCodeRef.current = null
    esquecer(ROOM_KEY)
    setRoom(null)
    setRaceSetup(null)
    setOutcome(null)
    setResult(null)
    setResultadosRanqueados(null)
    void buscarSituacao(socket).then(setSituacaoRanqueada)
  }

  /** Depois da corrida ranqueada: sai da sala e volta para a fila. */
  const voltarParaAFila = () => {
    deixarSalaRanqueada()
    setScreen('ranqueada')
    void entrarNaFilaRanqueada()
  }

  const inscreverSeNaCopa = async () => {
    setAvisoDaCopa('')
    const inscricao = await inscreverNaCopa(socket, { playerId: storedPlayerId, carro: car })
    if (!inscricao.ok) setAvisoDaCopa(inscricao.motivo)
    void buscarCopa(socket).then(setCopa)
  }

  /** Sai da copa: antes das eliminatórias a inscrição some; durante, é desistência. */
  const deixarACopa = async () => {
    await sairDaCopa(socket)
    if (room?.copa) {
      deixarSalaRanqueada()
      setRodadaDaCopa(null)
      setScreen('menu')
    }
    void buscarCopa(socket).then(setCopa)
  }

  /** Abre a porta de entrada: para entrar, criar a conta ou trocar a senha. */
  const abrirEntrada = (modo: ModoDaEntrada = 'entrar', voltaPara: Screen | null = screen) => {
    acompanharAConta()
    setModoDaEntrada(modo)
    setEntradaVoltaPara(voltaPara)
    setAvisoDaEntrada('')
    setScreen('entrada')
  }

  /** A conta abriu: volta para onde o piloto estava, ou para o menu. */
  const aoEntrarNaConta = () => {
    lembrarConvidado(false)
    setContaCarregando(true)
    setScreen(entradaVoltaPara && entradaVoltaPara !== 'entrada' ? entradaVoltaPara : 'menu')
    // O cliente pode ter aberto a sessão antes de a porta começar a acompanhá-la.
    void sessaoAtual().then((atual) => {
      setContaCarregando(false)
      if (!atual) return
      sessaoRef.current = atual
      setSessao(atual)
      void ligarAContaRef.current(atual.token)
    })
  }

  const correrComoConvidado = () => {
    lembrarConvidado(true)
    setScreen(entradaVoltaPara && entradaVoltaPara !== 'entrada' ? entradaVoltaPara : 'menu')
  }

  const sairDaContaAgora = async () => {
    if (naFila) await sairDaFila(socket)
    // A conta sai daqui primeiro: o aviso de saída do Supabase chega depois e
    // não repete nada, porque já não há sessão a esquecer.
    sessaoRef.current = null
    setSessao(null)
    esquecerAConta()
    await sairDoSupabase()
    setModoDaEntrada('entrar')
    setEntradaVoltaPara(null)
    setAvisoDaEntrada('Você saiu da conta.')
    setScreen('entrada')
  }

  /** Abre um perfil: o próprio (sem id) ou o de outro piloto, e lembra para onde voltar. */
  const abrirPerfil = (id: string | null, voltaPara: Screen = screen) => {
    setPerfilVoltaPara(voltaPara === 'perfil' ? perfilVoltaPara : voltaPara)
    setPerfilAberto(id)
    setPerfilVisto(null)
    setPerfilErro('')
    setPerfilCarregando(true)
    setScreen('perfil')
    void verPerfil(socket, id ?? undefined).then((resposta) => {
      setPerfilCarregando(false)
      if ('perfil' in resposta) setPerfilVisto(resposta.perfil)
      else setPerfilErro(resposta.erro)
    })
  }

  /** Abre o ranking mundial numa aba, com os três quadros frescos. */
  const abrirRanking = (aba: AbaDoRanking = 'mundial', voltaPara: Screen = screen) => {
    setRankingVoltaPara(voltaPara === 'ranking' ? rankingVoltaPara : voltaPara)
    setAbaDoRanking(aba)
    setScreen('ranking')
    setRankingCarregando(true)
    void Promise.all([
      buscarQuadro(socket, { circuito: 'oficial' }, 50).then((quadro) => quadro && setRankingMundial(quadro)),
      buscarQuadro(socket, {}, 50).then(setRankingDoDia),
      buscarEscada(socket).then(setEscadaDoRanking),
    ]).finally(() => setRankingCarregando(false))
  }

  /**
   * Os desafios desta semana: calculados no aparelho — é a mesma conta do
   * servidor —, com o líder e a sua linha quando o servidor responde.
   */
  const semanaAtual = semanaDe(Date.now())
  const desafios = useMemo(() => desafiosDaSemana(semanaAtual), [semanaAtual])

  /** Baixa o fantasma de uma linha do quadro e larga a pista dele — a do dia ou o Circuito Oficial. */
  const correrContra = async (linha: LinhaDoQuadro, quadro: 'dia' | 'mundial' = 'dia') => {
    const gravacao = await baixarFantasma(socket, linha.id)
    if (!gravacao) {
      setLobbyError('Não foi possível baixar esse fantasma agora.')
      return
    }
    await startTimeTrial({ nome: linha.apelido, tempo: linha.tempo, gravacao }, null, quadro === 'mundial')
  }

  const leaveLobby = () => {
    roomCodeRef.current = null
    esquecer(ROOM_KEY)
    voltarAPiloto()
    setRoom(null)
    setRaceSetup(null)
    setLobbyNotice('')
    setScreen('menu')
    history.replaceState(null, '', location.pathname)
  }

  const backToLobby = () => {
    setResult(null)
    setOutcome(null)
    setRaceSetup(null)
    if (room && papel === 'piloto') socket.emit('room:set-ready', { code: room.code, playerId: storedPlayerId, ready: false })
    setScreen(room ? 'lobby' : 'menu')
  }

  const askRematch = () => {
    if (room) socket.emit('race:rematch', { code: room.code, playerId: storedPlayerId })
  }

  const abandonRace = () => {
    if (!room) return
    // Em grids maiores os demais continuam correndo. Esta tela passa a esperar
    // o resultado oficial sem manter o carro abandonado em movimento.
    setResult({ time: 0, topSpeed: 0, collisions: 0, lateStart: 0 })
    setScreen('result')
    socket.emit('race:abandon', { code: room.code, playerId: storedPlayerId })
  }

  const finishRace = useCallback((raceResult: RaceResult) => {
    setResult(raceResult)
    // No contrarrelógio a volta vira recorde, se bater o anterior, e o
    // fantasma dele corre na próxima tentativa.
    const prova = contrarrelogioRef.current
    if (prova && raceResult.gravacao && modoDaProvaRef.current === 'contrarrelogio') {
      const dificuldade = prova.desafio?.dificuldade ?? DIFICULDADE_OFICIAL
      const anterior = lerRecorde(armazenamentoLocal(), prova.seed, dificuldade)
      const novoRecorde = guardarSeRecorde(armazenamentoLocal(), prova.seed, dificuldade, {
        tempo: raceResult.time,
        gravacao: raceResult.gravacao,
        em: new Date().toISOString(),
      })
      const limites = limitesDasMedalhas(tempoDoPiloto(prova.seed, dificuldade, prova.desafio?.modificador ?? null))
      setResultadoDoContrarrelogio({
        tempo: raceResult.time,
        medalha: medalhaPara(raceResult.time, limites),
        recordeAnterior: anterior?.tempo ?? null,
        novoRecorde,
        servidor: null,
        enviando: Boolean(prova.tentativa),
      })
      if (novoRecorde) setVersaoDosRecordes((versao) => versao + 1)
      // A volta vai ao servidor, que a julga pelo relógio dele e a põe no quadro.
      if (prova.tentativa) {
        void enviarVolta(socket, {
          tentativa: prova.tentativa,
          tempo: raceResult.time,
          gravacao: raceResult.gravacao,
          dispositivo: raceResult.dispositivo ?? 'desconhecido',
          entradas: raceResult.entradas,
        }).then((veredito) => {
          setResultadoDoContrarrelogio((atual) => (atual ? { ...atual, servidor: veredito, enviando: false } : atual))
          if (veredito?.copa) void buscarCopa(socket).then(setCopa)
          void buscarQuadro(socket).then(setQuadroDoDia)
          void buscarDesafios(socket).then(setDesafiosDoServidor)
          if (prova.oficial) void buscarQuadro(socket, { circuito: 'oficial' }, 3).then((quadro) => quadro && setRankingMundial(quadro))
        })
      }
      setScreen('result')
      return
    }
    // Na corrida online, quem decide as posições é o servidor: aqui só avisamos
    // a chegada e esperamos o resultado oficial chegar a todas as telas.
    const code = roomCodeRef.current
    if (code && socket.connected) {
      socket.emit('race:finish', {
        code,
        playerId: storedPlayerId,
        time: raceResult.time,
        topSpeed: raceResult.topSpeed,
        collisions: raceResult.collisions,
        // Na ranqueada, a volta vai junto: pode virar o fantasma de quem ficar
        // sozinho na fila.
        ...(salaRanqueadaRef.current && raceResult.gravacao ? { gravacao: raceResult.gravacao } : {}),
      })
    }
    setScreen('result')
  }, [])

  const sendTelemetry = useCallback((snapshot: GhostSnapshot) => {
    const code = roomCodeRef.current
    if (!code || !socket.connected) return
    socket.emit('race:telemetry', { code, playerId: storedPlayerId, ...snapshot })
  }, [])

  const connectionNotice =
    connection === 'reconnecting' ? 'CONEXÃO INSTÁVEL — RECONECTANDO' : null

  /** A conta existe no aparelho, mas o servidor ainda não a ligou a esta conexão. */
  const entrandoNaConta = !perfil && !contaSemServidor && (contaCarregando || sessao !== null)
  /** Tenta de novo ligar a conta, com um token fresco, depois de o servidor não responder. */
  const religarAConta = () => {
    void sessaoAtual().then((atual) => {
      if (atual) void ligarAContaRef.current(atual.token)
    })
  }

  if (screen === 'entrada') {
    return (
      <Entrada
        modoInicial={modoDaEntrada}
        aviso={avisoDaEntrada}
        verificarApelido={(apelido) => apelidoLivre(socket, apelido)}
        onEntrou={aoEntrarNaConta}
        onConvidado={correrComoConvidado}
        onVoltar={entradaVoltaPara && entradaVoltaPara !== 'entrada' ? () => setScreen(entradaVoltaPara) : undefined}
      />
    )
  }

  if (screen === 'perfil') {
    const proprio = perfilAberto === null || perfilAberto === perfil?.id
    return (
      <Perfil
        perfil={perfilVisto}
        carregando={perfilCarregando}
        erro={perfilErro}
        proprio={proprio}
        email={proprio ? sessao?.email : null}
        onVoltar={() => setScreen(perfilVoltaPara)}
        onSair={proprio ? () => void sairDaContaAgora() : undefined}
        onCorrerCircuito={() => void startTimeTrial(null, null, true)}
      />
    )
  }

  if (screen === 'ranking') {
    return (
      <Ranking
        aba={abaDoRanking}
        onAba={setAbaDoRanking}
        mundial={rankingMundial}
        dia={rankingDoDia}
        escada={escadaDoRanking}
        carregando={rankingCarregando}
        conectado={connection === 'connected'}
        meuPerfil={perfil?.id ?? null}
        onVerPiloto={(id) => abrirPerfil(id, 'ranking')}
        onCorrerContra={(linha, quadro) => void correrContra(linha, quadro)}
        onCorrerCircuito={() => void startTimeTrial(null, null, true)}
        onCorrerPistaDoDia={() => void startTimeTrial()}
        onEntrar={perfil || entrandoNaConta ? undefined : () => abrirEntrada('entrar', 'ranking')}
        onVoltar={() => setScreen(rankingVoltaPara)}
      />
    )
  }

  if (screen === 'garage') {
    const rivalCars = garageFrom === 'lobby'
      ? room?.players.filter((player) => player.id !== storedPlayerId).map((player) => player.car) ?? []
      : []
    return (
      <PilotSelect
        selected={car}
        rivalCars={rivalCars}
        backLabel={garageFrom === 'lobby' ? 'VOLTAR AO LOBBY' : 'VOLTAR AO PADDOCK'}
        onConfirm={chooseCar}
        onBack={leaveGarage}
      />
    )
  }

  if (screen === 'ranqueada') {
    return (
      <Ranqueada
        perfil={perfil}
        situacao={situacaoRanqueada}
        conectado={connection === 'connected'}
        naFila={naFila}
        tamanhoDaFila={tamanhoDaFila}
        naFilaDesde={naFilaDesde}
        aviso={avisoRanqueado}
        entrandoNaConta={entrandoNaConta}
        onEntrar={() => void entrarNaFilaRanqueada()}
        onSair={() => void sairDaFilaRanqueada()}
        onVoltar={() => {
          if (naFila) void sairDaFilaRanqueada()
          setScreen('menu')
        }}
        onVerPerfil={() => abrirPerfil(null, 'ranqueada')}
        onVerRanking={() => abrirRanking('ranqueada', 'ranqueada')}
        onEntrarNaConta={() => abrirEntrada('entrar', 'ranqueada')}
      />
    )
  }

  if (screen === 'lobby' && room) {
    return (
      <Lobby
        room={room}
        playerId={storedPlayerId}
        clock={clock}
        connection={connection}
        notice={lobbyNotice}
        onRoomChange={setRoom}
        onLeave={leaveLobby}
        onError={setLobbyError}
        onChangeCar={() => openGarage('lobby')}
        espectador={papel === 'espectador'}
        onJoinGrid={entrarNoGrid}
        onSpectate={irParaArquibancada}
      />
    )
  }

  if (screen === 'race' && raceSetup) {
    const online = raceSetup.mode === 'online'
    const assistindo = online && papel === 'espectador'
    const me = room?.players.find((player) => player.id === storedPlayerId)
    const rivals = online
      ? (room?.players ?? []).filter((player) => assistindo || player.id !== storedPlayerId).map((player) => {
          let ghost = ghostsRef.current.get(player.id)
          if (!ghost) {
            ghost = new GhostTracker()
            ghostsRef.current.set(player.id, ghost)
          }
          return { ...player, ghost }
        })
      : []
    return (
      <RaceCanvas
        key={`${raceSetup.mode}-${papel}-${raceSetup.startAt}-${raceSetup.difficulty}-${raceKey}`}
        pilotName={pilotName}
        // Online vale o carro que o servidor registrou: é o mesmo que os rivais
        // veem. Na arquibancada, o grid mostra o carro do primeiro piloto até a
        // câmera ter alguém para seguir.
        car={assistindo ? (room?.players[0]?.car ?? car) : online ? (me?.car ?? car) : car}
        rivals={rivals}
        startAt={raceSetup.startAt}
        countdownMs={raceSetup.countdownMs}
        trackSeed={raceSetup.trackSeed}
        difficulty={raceSetup.difficulty}
        now={online ? serverClock.now : undefined}
        mode={assistindo ? 'espectador' : raceSetup.mode}
        espectadores={room?.spectators?.length ?? 0}
        connectionNotice={online ? connectionNotice : null}
        onTelemetry={online && !assistindo ? sendTelemetry : undefined}
        onAbandon={online && !assistindo ? abandonRace : undefined}
        recorde={raceSetup.mode === 'contrarrelogio' ? contrarrelogio?.recorde : null}
        onRestart={
          raceSetup.mode === 'contrarrelogio'
            ? () => void startTimeTrial(contrarrelogio?.contra ?? null, contrarrelogio?.desafio ?? null, contrarrelogio?.oficial ?? false)
            : undefined
        }
        modificador={raceSetup.modificador ?? null}
        competitivo={online && Boolean(room?.ranqueada || room?.copa)}
        onFinish={finishRace}
      />
    )
  }

  if (screen === 'result' && (result || outcome)) {
    const online = Boolean(room)
    const me = outcome?.entries.find((entry) => entry.playerId === storedPlayerId)
    const venci = Boolean(outcome && outcome.winnerId === storedPlayerId)
    const pedidoFeito = room?.players.find((player) => player.id === storedPlayerId)?.rematch ?? false
    const outros = room?.players.filter((player) => player.id !== storedPlayerId) ?? []
    const pedidosDeRevanche = outros.filter((player) => player.rematch).length
    const gridConectado = (room?.players.length ?? 0) >= 2 && room!.players.every((player) => player.connected)
    const minhaPosicao = outcome ? outcome.entries.findIndex((entry) => entry.playerId === storedPlayerId) + 1 : 0
    const aindaCorrendo = room?.players.filter((player) => !player.finished).length ?? 0
    const ranqueada = Boolean(room?.ranqueada)
    const daCopa = room?.copa ?? null
    const saiNaCopa = rodadaDaCopa?.eliminados.find((eliminado) => eliminado.playerId === storedPlayerId) ?? null
    const campeaoDaCopa = rodadaDaCopa?.campeao?.playerId === storedPlayerId
    const sigoNaCopa = Boolean(rodadaDaCopa?.seguem.some((piloto) => piloto.playerId === storedPlayerId))
    const segundosAteARodada = rodadaDaCopa?.proximaEm ? Math.max(0, Math.ceil((rodadaDaCopa.proximaEm - serverClock.now()) / 1000)) : null
    const meuRanqueado = resultadosRanqueados?.find((resultado) => resultado.playerId === storedPlayerId) ?? null
    const plDe = (playerId: string) => resultadosRanqueados?.find((resultado) => resultado.playerId === playerId) ?? null

    const contra = !online && raceSetup?.mode === 'contrarrelogio' ? resultadoDoContrarrelogio : null
    const assistiu = online && papel === 'espectador'
    const vencedor = outcome?.entries.find((entry) => entry.playerId === outcome.winnerId)
    const manchete = contra
      ? contra.novoRecorde
        ? 'Novo recorde.'
        : 'Prova concluída.'
      : !online
      ? 'Prova concluída.'
      : assistiu
        ? outcome
          ? 'Bandeirada.'
          : 'Chegada a caminho.'
        : !outcome
        ? 'Chegada registrada.'
        : me?.outcome === 'abandoned'
          ? 'Você abandonou.'
          : venci
            ? 'Vitória.'
            : outcome.winnerId
              ? 'Derrota.'
              : 'Prova encerrada.'

    return (
      <main className="screen result-screen">
        <div className="ambient-grid" />
        <section className="result-card">
          <p className="eyebrow">
            {daCopa
              ? `COPA DO DIA · DIVISÃO ${daCopa.divisao} · RODADA ${daCopa.rodada}`
              : contra && contrarrelogio?.oficial
              ? `RANKING MUNDIAL · ${CIRCUITO_OFICIAL.nome.toUpperCase()}`
              : contra && contrarrelogio?.desafio
              ? `DESAFIO DA SEMANA · ${MODIFICADORES[contrarrelogio.desafio.modificador].nome.toUpperCase()}`
              : contra
                ? 'PISTA DO DIA'
                : 'BANDEIRA QUADRICULADA'}
          </p>
          <div className={`result-mark ${venci || contra?.novoRecorde ? 'winner' : ''}`}>
            {online && outcome && !assistiu ? String(minhaPosicao).padStart(2, '0') : '01'}
          </div>
          <h1>{manchete}</h1>
          <p className="result-pilot">
            {assistiu ? (vencedor && outcome?.winnerId ? `VENCEU ${vencedor.name}` : 'VOCÊ ASSISTIU DA ARQUIBANCADA') : pilotName}
          </p>

          {online && outcome ? (
            <>
              <div className="scoreboard">
                {outcome.entries.map((entry, posicao) => {
                  // Quem já deixou a sala não tem mais carro registrado.
                  const carro = room?.players.find((player) => player.id === entry.playerId)?.car
                  return (
                    <div
                      key={entry.playerId}
                      className={`score-row ${entry.playerId === storedPlayerId ? 'me' : ''} ${
                        entry.playerId === outcome.winnerId ? 'winner' : ''
                      }`}
                    >
                      <b>P{posicao + 1}</b>
                      {carro ? <img className="score-car" src={carImageUrl(carro)} alt="" /> : <span />}
                      <strong>
                        {entry.name}
                        {room?.players.find((player) => player.id === entry.playerId)?.fantasma && <small className="score-ghost"> FANTASMA</small>}
                      </strong>
                      <i>
                        {entry.outcome === 'finished' && entry.time !== null
                          ? formatTime(entry.time)
                          : entry.outcome === 'abandoned'
                            ? 'ABANDONOU'
                            : 'NÃO COMPLETOU'}
                        {/* Na ranqueada, o delta de cada um fica à vista de todos. */}
                        {plDe(entry.playerId) && (
                          <em className={`score-pl ${plDe(entry.playerId)!.deltaPl >= 0 ? 'ganho' : 'perda'}`}>
                            {plDe(entry.playerId)!.colocacao > 0 && plDe(entry.playerId)!.deltaPl === 0
                              ? 'COLOCAÇÃO'
                              : `${plDe(entry.playerId)!.deltaPl >= 0 ? '+' : ''}${plDe(entry.playerId)!.deltaPl} PL`}
                          </em>
                        )}
                      </i>
                    </div>
                  )
                })}
              </div>
              <p className="result-note">
                {outcome.gap !== null
                  ? `DIFERENÇA DE ${outcome.gap.toFixed(3).replace('.', ',')} S · RESULTADO CONFERIDO PELO SERVIDOR`
                  : 'RESULTADO CONFERIDO PELO SERVIDOR'}
              </p>
              {ranqueada && !meuRanqueado && <p className="result-note">CALCULANDO OS PONTOS DE LIGA…</p>}
              {/* Copa do Dia: quem saiu, quem segue, e quando larga a próxima. */}
              {daCopa && (
                <section className="cup-result" aria-label="Copa do Dia">
                  {!rodadaDaCopa ? (
                    <p className="result-note">APURANDO A RODADA…</p>
                  ) : campeaoDaCopa ? (
                    <strong className="cup-verdict campeao">CAMPEÃO DA DIVISÃO {rodadaDaCopa.divisao} · TROFÉU DE OURO</strong>
                  ) : saiNaCopa ? (
                    <strong className="cup-verdict fora">
                      ELIMINADO · {saiNaCopa.posicao}º NA DIVISÃO {rodadaDaCopa.divisao}
                      {saiNaCopa.posicao <= 3 && !saiNaCopa.desistiu && <small> TROFÉU DE {TACA[saiNaCopa.posicao]}</small>}
                    </strong>
                  ) : sigoNaCopa ? (
                    <strong className="cup-verdict segue">
                      CLASSIFICADO · {rodadaDaCopa.seguem.length} NA DISPUTA
                      <small> PRÓXIMA RODADA {segundosAteARodada ? `EM ${segundosAteARodada} S` : 'LARGANDO'}</small>
                    </strong>
                  ) : null}
                  {rodadaDaCopa && rodadaDaCopa.eliminados.length > 0 && !saiNaCopa && (
                    <p className="result-note">
                      SAIU NESTA RODADA: {rodadaDaCopa.eliminados.map((eliminado) => eliminado.nome.toUpperCase()).join(', ')}
                    </p>
                  )}
                  {rodadaDaCopa?.campeao && !campeaoDaCopa && (
                    <p className="result-note">CAMPEÃO DA DIVISÃO: {rodadaDaCopa.campeao.nome.toUpperCase()}</p>
                  )}
                </section>
              )}
              {meuRanqueado && (
                <section className="ranked-result" aria-label="Pontos de liga">
                  {meuRanqueado.mudouDeTier && (
                    <p className={`ranked-tier-change ${meuRanqueado.mudouDeTier}`}>
                      {meuRanqueado.mudouDeTier === 'subiu' ? 'SUBIU DE TIER' : 'CAIU DE TIER'} · {meuRanqueado.divisao.replace(/ · .*/, '')}
                    </p>
                  )}
                  <div className="ranked-delta">
                    <strong className={meuRanqueado.deltaPl >= 0 ? 'ganho' : 'perda'}>
                      {meuRanqueado.colocacao > 0
                        ? `COLOCAÇÃO ${meuRanqueado.colocacaoTotal - meuRanqueado.colocacao}/${meuRanqueado.colocacaoTotal}`
                        : `${meuRanqueado.deltaPl >= 0 ? '+' : ''}${meuRanqueado.deltaPl} PL`}
                    </strong>
                    <span>{meuRanqueado.colocacao > 0 ? 'SEM PERDA DE PL ATÉ O FIM DA COLOCAÇÃO' : meuRanqueado.divisao}</span>
                  </div>
                  {meuRanqueado.subindo && <p className="ranked-note subindo">▲ ACIMA DOS SEUS PL: GANHA MAIS E PERDE MENOS ATÉ ALCANÇÁ-LOS</p>}
                  {meuRanqueado.reduzido && (
                    <p className="ranked-note">PL PELA METADE: O MESMO GRUPO CORREU JUNTO VEZES DEMAIS NA ÚLTIMA HORA</p>
                  )}
                  <ul className="ranked-rivals" aria-label="Contra cada rival">
                    {meuRanqueado.rivais.map((rival) => (
                      <li key={rival.apelido} className={rival.ficouAFrente === null ? '' : rival.ficouAFrente ? 'ganho' : 'perda'}>
                        <span>{rival.ficouAFrente === null ? '=' : rival.ficouAFrente ? '▲' : '▼'} {rival.apelido}</span>
                        <i>{Math.round(rival.chance * 100)}% DE CHANCE DE FICAR À FRENTE</i>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {me && me.outcome === 'finished' && (
                <div className="result-stats">
                  <div><span>SEU TEMPO</span><strong>{formatTime(me.time ?? 0)}</strong></div>
                  <div><span>VELOCIDADE MÁX.</span><strong>{Math.round(me.topSpeed)} <small>KM/H</small></strong></div>
                  <div><span>IMPACTOS</span><strong>{me.collisions}</strong></div>
                </div>
              )}
            </>
          ) : online ? (
            <p className="result-note waiting">
              AGUARDANDO {aindaCorrendo} {aindaCorrendo === 1 ? 'PILOTO' : 'PILOTOS'} CONCLUIR A PROVA…
            </p>
          ) : contra ? (
            <div className="result-stats">
              <div><span>TEMPO</span><strong>{formatTime(contra.tempo)}</strong></div>
              <div>
                <span>MEDALHA</span>
                <strong className={`medal-name ${contra.medalha ?? 'nenhuma'}`}>
                  {contra.medalha ? NOME_DA_MEDALHA[contra.medalha] : '—'}
                </strong>
              </div>
              <div>
                <span>{contra.novoRecorde && contra.recordeAnterior !== null ? 'RECORDE ANTERIOR' : 'SEU RECORDE'}</span>
                <strong>
                  {contra.recordeAnterior === null
                    ? contra.novoRecorde ? 'ESTE' : '—'
                    : formatTime(contra.recordeAnterior)}
                </strong>
              </div>
            </div>
          ) : (
            <div className="result-stats">
              <div><span>TEMPO TOTAL</span><strong>{formatTime(result!.time)}</strong></div>
              <div><span>VELOCIDADE MÁX.</span><strong>{Math.round(result!.topSpeed)} <small>KM/H</small></strong></div>
              <div><span>IMPACTOS</span><strong>{result!.collisions}</strong></div>
            </div>
          )}

          {contra?.enviando && <p className="result-note">CONFERINDO O TEMPO NO SERVIDOR…</p>}
          {contra?.servidor?.copa && (
            <p className="result-note veredito-valido">VALEU NA CLASSIFICAÇÃO DA COPA: VOCÊ ESTÁ EM #{contra.servidor.copa.posicao}</p>
          )}
          {contra?.servidor && (
            <p className={`result-note veredito-${contra.servidor.estado}`}>
              {contra.servidor.estado === 'valido'
                ? contra.servidor.linha
                  ? `SEU MELHOR TEMPO ESTÁ EM #${contra.servidor.linha.posicao} ${contrarrelogio?.oficial ? 'NO RANKING MUNDIAL' : contrarrelogio?.desafio ? 'NO QUADRO DO DESAFIO' : 'NO QUADRO DE HOJE'}`
                  : 'TEMPO ACEITO NO QUADRO'
                : contra.servidor.estado === 'pendente'
                  ? 'TEMPO EM CONFERÊNCIA — ENTRA NO QUADRO DEPOIS DE CONFERIDO'
                  : `TEMPO FORA DO QUADRO: ${(contra.servidor.motivo ?? 'recusado').toUpperCase()}`}
            </p>
          )}
          {contra && !contrarrelogio?.tentativa && !perfil && (
            <p className="result-note">COMO CONVIDADO, O TEMPO FICA SÓ NESTE APARELHO. ENTRE NUMA CONTA PARA ELE VALER NO QUADRO.</p>
          )}
          {contra && contra.recordeAnterior !== null && (
            <p className="result-note">
              {contra.novoRecorde
                ? `${(contra.recordeAnterior - contra.tempo).toFixed(3).replace('.', ',')} S MAIS RÁPIDO QUE O RECORDE`
                : `${(contra.tempo - contra.recordeAnterior).toFixed(3).replace('.', ',')} S ATRÁS DO RECORDE`}
            </p>
          )}

          {result?.analise && (!online || outcome) && (
            <ResumoDaProva analise={result.analise} difficulty={raceSetup?.difficulty ?? 'normal'} />
          )}

          {result && result.lateStart > 0.4 && (
            <p className="result-note">LARGADA PERDIDA POR {result.lateStart.toFixed(1)} S NESTE DISPOSITIVO</p>
          )}

          {assistiu ? (
            outcome && <p className="result-note">A PRÓXIMA LARGADA DA SALA TAMBÉM APARECE AQUI</p>
          ) : daCopa && outcome ? (
            // Na copa, quem segue só espera: a próxima rodada larga sozinha.
            sigoNaCopa || !rodadaDaCopa ? null : (
              <button
                className="primary-button"
                onClick={() => {
                  deixarSalaRanqueada()
                  setRodadaDaCopa(null)
                  setScreen('menu')
                  void buscarCopa(socket).then(setCopa)
                }}
              >
                VOLTAR AO PADDOCK <span>↗</span>
              </button>
            )
          ) : ranqueada && outcome ? (
            <button className="primary-button" onClick={voltarParaAFila}>VOLTAR À FILA <span>↗</span></button>
          ) : online && outcome ? (
            gridConectado ? (
              <>
                <button className="primary-button" disabled={pedidoFeito} onClick={askRematch}>
                  {pedidoFeito ? 'AGUARDANDO OS DEMAIS' : 'REVANCHE'} <span>↗</span>
                </button>
                {pedidosDeRevanche > 0 && !pedidoFeito && (
                  <p className="result-note rematch">{pedidosDeRevanche} DE {outros.length} RIVAIS JÁ PEDIRAM REVANCHE</p>
                )}
              </>
            ) : (
              <p className="result-note waiting">O GRID ESTÁ INCOMPLETO — VOLTE AO LOBBY PARA REORGANIZAR A SALA</p>
            )
          ) : online ? null : contra ? (
            <button
              className="primary-button"
              onClick={() => void startTimeTrial(contrarrelogio?.contra ?? null, contrarrelogio?.desafio ?? null, contrarrelogio?.oficial ?? false)}
            >
              TENTAR DE NOVO <span>↗</span>
            </button>
          ) : (
            <button className="primary-button" onClick={startSoloRace}>CORRER NOVAMENTE <span>↗</span></button>
          )}

          {daCopa && outcome ? (
            sigoNaCopa && (
              <button className="text-button" onClick={() => void deixarACopa()}>
                SAIR DA COPA
              </button>
            )
          ) : ranqueada && outcome ? (
            <button
              className="text-button"
              onClick={() => {
                deixarSalaRanqueada()
                setScreen('menu')
              }}
            >
              SAIR DA RANQUEADA
            </button>
          ) : (!online || outcome) && (
            <button className="text-button" onClick={online ? backToLobby : () => { setRaceSetup(null); setScreen('menu') }}>
              {online ? 'VOLTAR AO LOBBY' : 'VOLTAR AO PADDOCK'}
            </button>
          )}
        </section>
      </main>
    )
  }

  // A fase da copa anda com o relógio: a tela não espera a próxima releitura
  // para abrir a classificação no segundo em que ela abre.
  const copaVista = copa ? { ...copa, fase: faseNoRelogio(copa, serverClock.now()) } : null

  return (
    <main className="screen menu-screen">
      <div className="ambient-grid" />
      <header className="site-header">
        <div className="logo"><i /><span>CORRIDA<br /><b>FANTASMA</b></span></div>
        <div className="header-meta">
          <div className="institutional-mark">
            <img src="/iedau.jpeg" alt="Faculdades IDEAU" />
            <span>PROJETO<br />ACADÊMICO</span>
          </div>
          <span className="build-tag">PROTÓTIPO // 002</span>
          {/* A conta: o nome leva ao perfil; o convidado vê onde entrar. */}
          {perfil ? (
            <button type="button" className="conta-chip on" onClick={() => abrirPerfil(null, 'menu')}>
              <i aria-hidden="true" />
              <span>{perfil.apelido}<small>SEU PERFIL</small></span>
            </button>
          ) : contaSemServidor && sessao ? (
            <button type="button" className="conta-chip" onClick={religarAConta}>
              <span>SUA CONTA<small>SEM RESPOSTA · TENTAR DE NOVO</small></span>
            </button>
          ) : entrandoNaConta ? (
            <span className="conta-chip"><span>ENTRANDO…<small>NA SUA CONTA</small></span></span>
          ) : (
            <button type="button" className="conta-chip" onClick={() => abrirEntrada('entrar', 'menu')}>
              <span>CONVIDADO<small>ENTRAR OU CRIAR CONTA</small></span>
            </button>
          )}
        </div>
      </header>

      <div className="menu-content">
        <section className="menu-hero">
          <div className="hero-heading">
            <p className="eyebrow">CORRIDA MULTIPLAYER EM TEMPO REAL</p>
            <h1>DOMINE O<br /><em>ASFALTO.</em></h1>
            <p className="hero-copy">Uma volta decisiva, largada sincronizada e até seis pilotos disputando o mesmo traçado.</p>
          </div>

          <button type="button" className="hero-car" style={destaque(car)} onClick={() => openGarage('menu')}>
            <span className="hero-car-number" aria-hidden="true">{carById(car).number}</span>
            <img src={carImageUrl(car)} alt={`Carro de ${carById(car).driver}`} />
            <span className="hero-car-caption">
              <small>PILOTO SELECIONADO</small>
              <strong>{carById(car).driver}</strong>
              <em>{carById(car).team} · #{carById(car).number}</em>
            </span>
            <span className="hero-car-action">TROCAR <b>↗</b></span>
          </button>

          <dl className="race-facts">
            <div><dt>FORMATO</dt><dd>1 VOLTA</dd></div>
            <div><dt>GRID</dt><dd>2—6 PILOTOS</dd></div>
            <div><dt>SINCRONIA</dt><dd>{clock.synced ? `±${Math.round(clock.roundTrip / 2)} MS` : 'CONECTANDO'}</dd></div>
          </dl>
        </section>

        <section className="start-panel" aria-labelledby="start-title">
          <header className="start-panel-header">
            <span className="panel-step">01</span>
            <div>
              <p className="eyebrow">PREPARE-SE PARA A LARGADA</p>
              <h2 id="start-title">ENTRE NA PISTA</h2>
            </div>
            <span className={`server-status ${connection === 'connected' ? 'online' : ''}`}>
              <i /> {connection === 'connected' ? 'SERVIDOR ONLINE' : 'CONECTANDO'}
            </span>
          </header>

          {perfil ? (
            <p className="identity-conta">
              PILOTANDO COMO <b>{perfil.apelido}</b>
              <button type="button" className="text-button" onClick={() => abrirRanking('mundial', 'menu')}>RANKING MUNDIAL ↗</button>
            </p>
          ) : (
            <div className="identity-field">
              <label htmlFor="pilot-name">NOME DO PILOTO</label>
              <input id="pilot-name" value={draftName} maxLength={16} onChange={(event) => setDraftName(event.target.value)} placeholder={pilotName} autoComplete="nickname" />
            </div>
          )}

          {connection !== 'connected' && <p className="form-notice">PROCURANDO O SERVIDOR DA PARTIDA…</p>}
          {lobbyError && <p className="form-error">{lobbyError}</p>}

          <div className="mode-list">
            <section className="mode-card online-mode">
              <header className="mode-heading">
                <span>01</span>
                <div>
                  <p>ATÉ SEIS PILOTOS</p>
                  <h3>CORRIDA ONLINE</h3>
                </div>
              </header>
              <p className="mode-copy">Crie um grid e envie o convite, ou use o código de uma sala existente.</p>
              <button className="primary-button create-room-button" onClick={createRoom} disabled={connection !== 'connected'}>
                CRIAR NOVA SALA <span>↗</span>
              </button>
              <div className="join-divider"><span>JÁ TEM UM CÓDIGO?</span></div>
              <div className="join-control">
                <input value={joinCode} maxLength={5} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ABCDE" aria-label="Código da sala" />
                <button onClick={enterRoom} disabled={connection !== 'connected'}>ENTRAR <span>↗</span></button>
              </div>
              {/* Sala cheia ou prova em andamento não barram quem só quer ver. */}
              <button type="button" className="text-button watch-button" onClick={spectateRoom} disabled={connection !== 'connected'}>
                SÓ ASSISTIR, SEM OCUPAR VAGA <span>↗</span>
              </button>
            </section>

            <section className="mode-card training-mode">
              <header className="mode-heading">
                <span>02</span>
                <div>
                  <p>SEM SALA · SEM ESPERA</p>
                  <h3>TREINO SOLO</h3>
                </div>
              </header>
              <p className="mode-copy">Conheça a pista, ajuste o ritmo e prepare-se para disputar o grid.</p>
              <fieldset className="difficulty-picker">
                <legend>NÍVEL DO TREINO</legend>
                {DIFFICULTIES.map((nivel) => (
                  <button
                    key={nivel}
                    type="button"
                    className={soloDifficulty === nivel ? 'on' : ''}
                    aria-pressed={soloDifficulty === nivel}
                    onClick={() => setSoloDifficulty(nivel)}
                  >
                    {DIFFICULTY_LABELS[nivel]}
                  </button>
                ))}
              </fieldset>
              <p className="difficulty-note">{DIFFICULTY_NOTES[soloDifficulty]}</p>
              <button className="solo-button" onClick={startSoloRace}>INICIAR TREINO <span>↗</span></button>
            </section>

            {/* A ranqueada: a fila pública, com pontos de liga e escada. */}
            <section className="mode-card ranked-mode">
              <header className="mode-heading">
                <span>03</span>
                <div>
                  <p>FILA PÚBLICA · PONTOS DE LIGA · TEMPORADA {situacaoRanqueada?.painel.temporada ?? '—'}</p>
                  <h3>RANQUEADA</h3>
                </div>
              </header>
              <p className="mode-copy">
                Até seis pilotos de nível parecido, largada automática, sem itens e sem sorte: sobe quem chega na frente.
              </p>
              <p className="daily-record">
                {situacaoRanqueada
                  ? situacaoRanqueada.painel.colocacao > 0
                    ? <>EM COLOCAÇÃO <b>{situacaoRanqueada.painel.colocacaoTotal - situacaoRanqueada.painel.colocacao}/{situacaoRanqueada.painel.colocacaoTotal}</b></>
                    : <>SEU TIER <b>{situacaoRanqueada.painel.divisao}</b></>
                  : perfil || entrandoNaConta
                    ? 'CONECTE-SE PARA VER O SEU TIER'
                    : 'A RANQUEADA É DE QUEM TEM CONTA: NOME ÚNICO, PL E TIER EM QUALQUER APARELHO'}
              </p>
              {perfil || entrandoNaConta ? (
                <button className="solo-button" onClick={abrirRanqueada} disabled={connection !== 'connected'}>
                  ABRIR A RANQUEADA <span>↗</span>
                </button>
              ) : (
                <button className="solo-button" onClick={() => abrirEntrada('entrar', 'menu')}>
                  ENTRAR OU CRIAR CONTA <span>↗</span>
                </button>
              )}
            </section>

            {/* A mesma pista para todo mundo, o dia inteiro: é onde os tempos se
                comparam. As medalhas saem do piloto de teste que usa tudo. */}
            {/* Desafios da Semana: cinco pistas com a regra mexida, e um quadro
                que zera toda segunda — o Playground do Horizon Chase Turbo. */}
            <section className="mode-card weekly-mode">
              <header className="mode-heading">
                <span>05</span>
                <div>
                  <p>CINCO PISTAS · REGRAS MEXIDAS · ZERA NA SEGUNDA</p>
                  <h3>DESAFIOS DA SEMANA</h3>
                </div>
              </header>
              <ol className="weekly-list" aria-label="Desafios da semana">
                {desafios.map((desafio) => {
                  const definicao = MODIFICADORES[desafio.modificador]
                  const doServidor = desafiosDoServidor?.find((resumo) => resumo.id === desafio.id)
                  const meu = lerRecorde(armazenamentoLocal(), desafio.seed, desafio.dificuldade)
                  return (
                    <li key={desafio.id}>
                      <div>
                        <strong>{definicao.nome}</strong>
                        <small>{definicao.descricao}</small>
                      </div>
                      <span className="weekly-times">
                        <em>{meu ? `VOCÊ ${formatTime(meu.tempo)}` : 'SEM TEMPO'}</em>
                        {doServidor?.lider && <em>LÍDER {doServidor.lider.apelido} {formatTime(doServidor.lider.tempo)}</em>}
                      </span>
                      <button type="button" onClick={() => void startTimeTrial(null, desafio)} aria-label={`Correr o desafio ${definicao.nome}`}>
                        ▶
                      </button>
                    </li>
                  )
                })}
              </ol>
            </section>

            <section className="mode-card daily-mode">
              <header className="mode-heading">
                <span>04</span>
                <div>
                  <p>A MESMA PISTA PARA TODOS · {pistaDoDia.dia.slice(8, 10)}/{pistaDoDia.dia.slice(5, 7)}</p>
                  <h3>PISTA DO DIA</h3>
                </div>
              </header>
              <p className="mode-copy">
                Contrarrelógio no nível {DIFFICULTY_LABELS[DIFICULDADE_OFICIAL].toLowerCase()}: corra contra o fantasma do seu
                recorde, bata as medalhas e recomece na hora com ⌫.
              </p>
              <ol className="medal-ladder" aria-label="Medalhas da Pista do Dia">
                {MEDALHAS.map((medalha) => (
                  <li
                    key={medalha}
                    className={`${medalha} ${recordeDoDia && recordeDoDia.tempo <= pistaDoDia.limites[medalha] ? 'on' : ''}`}
                  >
                    <span>{NOME_DA_MEDALHA[medalha]}</span>
                    <b>{formatTime(pistaDoDia.limites[medalha])}</b>
                  </li>
                ))}
              </ol>
              <p className="daily-record">
                SEU RECORDE <b>{recordeDoDia ? formatTime(recordeDoDia.tempo) : 'NENHUM AINDA'}</b>
                {quadroDoDia?.voce && <> · QUADRO <b>#{quadroDoDia.voce.posicao}</b></>}
              </p>
              {/* O quadro de hoje. O ▶ baixa o fantasma daquele piloto e corre
                  contra ele — o jeito do Trackmania de aprender a linha de quem
                  é mais rápido. */}
              {quadroDoDia && quadroDoDia.linhas.length > 0 && (
                <ol className="daily-board" aria-label="Quadro da Pista do Dia">
                  {quadroDoDia.linhas.slice(0, 5).map((linha) => (
                    <li key={linha.id} className={linha.perfilId === perfil?.id ? 'me' : ''}>
                      <b>{linha.posicao}</b>
                      <span>{linha.apelido}</span>
                      {linha.dispositivo === 'toque' && <em title="Feito no toque">TOQUE</em>}
                      <i>{formatTime(linha.tempo)}</i>
                      <button type="button" onClick={() => void correrContra(linha)} aria-label={`Correr contra o fantasma de ${linha.apelido}`}>▶</button>
                    </li>
                  ))}
                </ol>
              )}
              {!perfil && !entrandoNaConta && (
                <p className="daily-note">COMO CONVIDADO, O RECORDE FICA NO APARELHO. COM CONTA, ELE ENTRA NO QUADRO.</p>
              )}
              <button className="solo-button" onClick={() => void startTimeTrial()}>CORRER A PISTA DO DIA <span>↗</span></button>
            </section>

            {/* O ranking mundial: o melhor tempo de cada piloto numa pista que não
                muda nunca — tempo só se compara na mesma pista. */}
            <section className="mode-card world-mode">
              <header className="mode-heading">
                <span>07</span>
                <div>
                  <p>{CIRCUITO_OFICIAL.nome.toUpperCase()} · A MESMA PISTA PARA SEMPRE · TODOS OS TEMPOS</p>
                  <h3>RANKING MUNDIAL</h3>
                </div>
              </header>
              <p className="mode-copy">
                O melhor tempo de cada piloto no Circuito Oficial, no nível {DIFFICULTY_LABELS[DIFICULDADE_OFICIAL].toLowerCase()}. Corra
                contra o fantasma do recordista e suba no ranking.
              </p>
              {rankingMundial && rankingMundial.linhas.length > 0 ? (
                <ol className="daily-board world-board" aria-label="Topo do ranking mundial">
                  {rankingMundial.linhas.slice(0, 3).map((linha) => (
                    <li key={linha.id} className={linha.perfilId === perfil?.id ? 'me' : ''}>
                      <b>{linha.posicao}</b>
                      <span>{linha.apelido}</span>
                      {linha.dispositivo === 'toque' ? <em title="Feito no toque">TOQUE</em> : <em />}
                      <i>{formatTime(linha.tempo)}</i>
                      <button type="button" onClick={() => void correrContra(linha, 'mundial')} aria-label={`Correr contra o fantasma de ${linha.apelido}`}>▶</button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="daily-record">{rankingMundial ? 'NINGUÉM MARCOU TEMPO AINDA: O PRIMEIRO RECORDE PODE SER SEU' : 'CONECTE-SE PARA VER O RANKING'}</p>
              )}
              <p className="daily-record">
                SEU RECORDE <b>{recordeDoCircuito ? formatTime(recordeDoCircuito.tempo) : 'NENHUM AINDA'}</b>
                {rankingMundial?.voce && <> · NO MUNDO <b>#{rankingMundial.voce.posicao}</b></>}
              </p>
              <div className="world-actions">
                <button className="solo-button" onClick={() => void startTimeTrial(null, null, true)}>
                  CORRER O CIRCUITO OFICIAL <span>↗</span>
                </button>
                <button className="solo-button" onClick={() => abrirRanking('mundial', 'menu')} disabled={connection !== 'connected'}>
                  VER O RANKING MUNDIAL <span>↗</span>
                </button>
              </div>
            </section>

            {/* A Copa do Dia: hora marcada, classificação no contrarrelógio e
                eliminação em salas de seis — o Cup of the Day do Trackmania. */}
            <section className="mode-card cup-mode">
              <header className="mode-heading">
                <span>06</span>
                <div>
                  <p>
                    TODO DIA ÀS {copa ? horaDe(copa.abertura) : '21:00'} · {copa ? Math.round((copa.fechamento - copa.abertura) / 60_000) : 10} MIN DE
                    CLASSIFICAÇÃO · UM SAI POR CORRIDA
                  </p>
                  <h3>COPA DO DIA</h3>
                </div>
              </header>
              <p className="mode-copy">
                Classifique-se na Pista do Dia e dispute sua divisão de até seis pilotos: a cada corrida, o último sai. Vale troféu, não PL.
              </p>
              <p className="daily-record">{copaVista ? textoDaCopa(copaVista, serverClock.now()) : 'CONECTE-SE PARA VER A COPA'}</p>
              {copaVista && copaVista.classificacao.length > 0 && (copaVista.fase === 'classificacao' || copaVista.fase === 'apuracao') && (
                <ol className="daily-board cup-board" aria-label="Classificação da copa">
                  {copaVista.classificacao.slice(0, 6).map((linha) => (
                    <li key={linha.posicao} className={linha.voce ? 'me' : ''}>
                      <b>{linha.posicao}</b>
                      <span>{linha.apelido}</span>
                      <i>{formatTime(linha.tempo)}</i>
                    </li>
                  ))}
                </ol>
              )}
              {copa && copa.podios.length > 0 && (
                <ol className="cup-podiums" aria-label="Pódios de hoje">
                  {copa.podios.slice(0, 4).map((podio) => (
                    <li key={podio.divisao}>
                      <b>DIV. {podio.divisao}</b>
                      {podio.pilotos.map((piloto) => (
                        <span key={piloto.posicao} className={`taca-${piloto.posicao}`}>{piloto.posicao}º {piloto.apelido}</span>
                      ))}
                    </li>
                  ))}
                </ol>
              )}
              {copa && copa.trofeus.length > 0 && (
                <p className="cup-trophies" aria-label="Seus troféus">
                  SEUS TROFÉUS
                  {[1, 2, 3].map((posicao) => {
                    const quantos = copa.trofeus.filter((trofeu) => trofeu.posicao === posicao).length
                    return quantos > 0 ? <b key={posicao} className={`taca-${posicao}`}>{posicao}º ×{quantos}</b> : null
                  })}
                </p>
              )}
              {avisoDaCopa && <p className="form-error">{avisoDaCopa}</p>}
              {copaVista && (copaVista.fase === 'inscricoes' || copaVista.fase === 'classificacao') && !copaVista.inscrito && (
                perfil || entrandoNaConta ? (
                  <button className="solo-button" onClick={() => void inscreverSeNaCopa()} disabled={connection !== 'connected' || !perfil}>
                    INSCREVER-SE NA COPA <span>↗</span>
                  </button>
                ) : (
                  <button className="solo-button" onClick={() => abrirEntrada('entrar', 'menu')}>
                    ENTRAR PARA SE INSCREVER <span>↗</span>
                  </button>
                )
              )}
              {copaVista?.inscrito && copaVista.fase === 'classificacao' && (
                <button className="solo-button" onClick={() => void startTimeTrial()}>CORRER A CLASSIFICAÇÃO <span>↗</span></button>
              )}
              {copaVista?.inscrito && (copaVista.fase === 'inscricoes' || copaVista.fase === 'classificacao') && (
                <button className="text-button" onClick={() => void deixarACopa()}>CANCELAR INSCRIÇÃO</button>
              )}
            </section>
          </div>
        </section>
      </div>

      <footer className="menu-footer">
        <span>LARGADA SINCRONIZADA · FANTASMAS EM TEMPO REAL</span>
        <span className="developer-credit">Desenvolvido por: <strong>Richarlison Ávila e Rafael Severo</strong></span>
      </footer>
    </main>
  )
}

/** Minutos e segundos até um instante, para os relógios da copa. */
function faltam(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const segundos = String(total % 60).padStart(2, '0')
  return horas > 0 ? `${horas}H${String(minutos).padStart(2, '0')}` : `${minutos}:${segundos}`
}

/** A fase da copa agora, pelo relógio do servidor: as viradas marcadas não esperam a releitura. */
function faseNoRelogio(copa: SituacaoDaCopa, agora: number): SituacaoDaCopa['fase'] {
  if (copa.fase === 'inscricoes' && agora >= copa.abertura) return agora >= copa.fechamento ? 'apuracao' : 'classificacao'
  if (copa.fase === 'classificacao' && agora >= copa.fechamento) return 'apuracao'
  return copa.fase
}

/** A hora de um instante no relógio do aparelho. */
function horaDe(instante: number) {
  return new Date(instante).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Uma linha que diz onde a copa de hoje está, e onde o piloto está nela. */
function textoDaCopa(copa: SituacaoDaCopa, agora: number) {
  const hora = horaDe(copa.abertura)
  const meuTempo = copa.voce?.tempo != null ? ` · SEU TEMPO ${formatTime(copa.voce.tempo)} (#${copa.voce.posicao})` : ''
  switch (copa.fase) {
    case 'inscricoes':
      return `ABRE ÀS ${hora} · FALTAM ${faltam(copa.abertura - agora)} · ${copa.inscritos} ${copa.inscritos === 1 ? 'INSCRITO' : 'INSCRITOS'}${copa.inscrito ? ' · VOCÊ ESTÁ DENTRO' : ''}`
    case 'classificacao':
      return `CLASSIFICAÇÃO ABERTA · FECHA EM ${faltam(copa.fechamento - agora)}${meuTempo}`
    case 'apuracao':
      return `CLASSIFICAÇÃO FECHADA · AS DIVISÕES LARGAM EM ${faltam(copa.eliminatorias - agora)}${meuTempo}`
    case 'eliminatorias':
      return copa.minhaDivisao
        ? copa.minhaDivisao.posicao
          ? `VOCÊ FICOU EM ${copa.minhaDivisao.posicao}º NA DIVISÃO ${copa.minhaDivisao.numero} · ELIMINATÓRIAS EM ANDAMENTO`
          : `DIVISÃO ${copa.minhaDivisao.numero} · RODADA ${copa.minhaDivisao.rodada} · ${copa.minhaDivisao.restantes} NA DISPUTA`
        : 'ELIMINATÓRIAS EM ANDAMENTO'
    case 'encerrada':
      return copa.motivo
        ? `${copa.motivo.toUpperCase()} VOLTE AMANHÃ ÀS ${hora}`
        : copa.minhaDivisao?.posicao
          ? `VOCÊ FICOU EM ${copa.minhaDivisao.posicao}º NA DIVISÃO ${copa.minhaDivisao.numero} · VOLTE AMANHÃ ÀS ${hora}`
          : `A COPA DE HOJE TERMINOU · VOLTE AMANHÃ ÀS ${hora}`
  }
}

export default App
