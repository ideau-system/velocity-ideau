import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { countdownAt, DEFAULT_COUNTDOWN_MS, LIGHT_COUNT, lateBy } from './countdown'
import {
  gapBetween,
  GhostTracker,
  offScreenNotice,
  rivalSide,
  TELEMETRY_INTERVAL_MS,
  type GhostSample,
  type GhostSnapshot,
} from './ghost'
import { RaceAudio, faixaDaCorrida } from './audio'
import { definirMusicaDesligada, definirSomDesligado, lerMusicaDesligada, lerSomDesligado } from './preferenciasDeSom'
import { aparelhoDeToque, definirCambio, lerCambio } from './preferenciasDeCambio'
import { carById, type CarId } from './cars'
import {
  carImageUrl,
  definirMaiorEscala,
  drawCar,
  prepareCar,
  soltarFolhasDeOutroAmbiente,
  type CarPose,
} from './carSprites'
import { classificar, diferencaEmSegundos, formatarDiferenca, liderEmProva, type CarroNaProva } from './classificacao'
import {
  ALCANCE_DO_RADAR_M,
  desenharEtiquetasDosFantasmas,
  desenharRadarTraseiro,
  hierarquiaDosFantasmas,
  opacidadeDoFantasma,
  type EtiquetaDoFantasma,
  type RivalAtras,
} from './fantasmaNaTela'
import { BOOST_TAU, createFeel, registerImpact, updateFeel } from './feel'
import { LUZ, misturar, rampa } from './paleta'
import {
  desenharFaixaDeFundo,
  desenharObjeto,
  desenharObstaculo,
  desenharPortico,
  medidasDoObstaculo,
  prepararCenario,
} from './cenarioSprites'
import type { FamiliaDeVaga } from './cenarioModel'
import {
  createGantry,
  createRaceContext,
  createSceneryItem,
  createTrackLayout,
  curvatureLoad,
  firstSceneryIndex,
  lastSceneryIndex,
  GANTRY_EVERY,
  SCENERY_SPACING,
  type Flora,
} from './layout'
import { definirDensidade } from './reducoes'
import { DIFFICULTY_LABELS, rulesFor, turboDoPiloto, type Difficulty } from './rules'
import {
  advanceRace,
  APEX_BOOST,
  APEX_LATERAL,
  CARGA_NIVEIS,
  createRaceState,
  MAX_FRAME_SECONDS,
  MAX_STEP_SECONDS,
  motorForte,
  RASPAO_BOOST,
  RESET_SECONDS,
  RESET_STRIKES,
  slipstreamFrom,
  IMPULSO_DA_TROCA,
  TOLERANCIA_DO_CORTE,
  type QualidadeDaTroca,
  type RaceContext,
  type ResetReason,
} from './simulation'
import { aplicarLargada, JuizDaLargada, type Largada } from './largada'
import { AnalistaDaCorrida, type AnaliseDaCorrida } from './analise'
import { GravadorDeVolta, ReproducaoDeVolta, type GravacaoDeVolta } from './gravador'
import { GravadorDeEntradas, quantizarPasso, type RegistroDeEntradas } from './registroDeEntradas'
import type { Recorde } from './contrarrelogio'
import { MODIFICADORES, type Modificador } from './desafios'
import { RitmoDoQuadro } from './ritmoDoQuadro'
import { Comandos, ladoDoDedo, type Borboleta, type Comando } from './toque'
import { EmissionRate, ParticleField, TRAIL_SETBACK, WHEEL_OFFSET, type Particle } from './particles'
import {
  CAMERA_DEPTH,
  CAR_SPRITE_REFERENCE_WIDTH,
  CAR_VIEW_DISTANCE,
  CURVE_BEND_SCALE,
  formatTime,
  HIT_IS_CRASH,
  isTallMarker,
  lateralOffset,
  OFF_ROAD_LIMIT,
  roadProjection,
  type ObstacleKind,
  HORIZON_RATIO,
  CAR_HALF_LATERAL,
  ROADSIDE_LATERAL,
  ROADSIDE_SPACING,
  SUPER_CURVE_WALL,
  SLOPE_RISE_SCALE,
  TRACK_LENGTH,
  VIEW_DISTANCE,
} from './track'

type RacePhase = 'countdown' | 'racing' | 'finished'

export type RaceResult = {
  time: number
  topSpeed: number
  collisions: number
  /** Atraso, em segundos, com que este dispositivo entrou na corrida. */
  lateStart: number
  /** O que a prova mostrou: tangências, mini-turbos, parciais e o que custou tempo. */
  analise?: AnaliseDaCorrida
  /** A volta inteira, para virar o fantasma do recorde. */
  gravacao?: GravacaoDeVolta
  /** Por onde o piloto dirigiu por último: o quadro mostra teclado e toque lado a lado. */
  dispositivo?: 'teclado' | 'toque'
  /** Os comandos de cada quadro, para o servidor refazer a volta e conferi-la. */
  entradas?: RegistroDeEntradas
}

type RaceCanvasProps = {
  pilotName: string
  /** Carro escolhido na garagem. Só muda a pintura; a física é a mesma. */
  car: CarId
  /** Outros pilotos, cada um com seu próprio fantasma de rede. */
  rivals?: RaceRival[]
  /** Instante oficial da largada, no relógio do servidor. */
  startAt: number
  /** Duração total da sequência de luzes enviada pelo servidor. */
  countdownMs?: number
  /**
   * Semente oficial do traçado. Vem do servidor no duelo e é sorteada
   * localmente no treino: a curva e o cenário saem inteiramente dela.
   */
  trackSeed: number
  /**
   * Dificuldade oficial da corrida. Vem do servidor no duelo e é escolhida no
   * menu no treino: toda a física sai dela.
   */
  difficulty: Difficulty
  /** Relógio sincronizado. No modo treino é o relógio local. */
  now?: () => number
  /**
   * Treino, corrida online, contrarrelógio ou arquibancada. O contrarrelógio é
   * o treino com o fantasma do recorde, as parciais contra ele e o recomeço
   * instantâneo. No modo espectador não há carro próprio: a câmera segue um dos
   * pilotos — o líder, ou quem se escolher — e `rivals` traz todos eles.
   */
  mode?: 'solo' | 'online' | 'contrarrelogio' | 'espectador'
  /** Quantos assistem da arquibancada, para a tela dizer que há público. */
  espectadores?: number
  /**
   * O fantasma do contrarrelógio: o recorde pessoal nesta semente e nível, ou a
   * volta de outro piloto do quadro, com o nome dele. Corre sem esteira.
   */
  recorde?: (Recorde & { nome?: string }) | null
  /** Recomeçar a prova na hora, sem passar pelo menu. */
  onRestart?: () => void
  /** O modificador do desafio da semana: troca as regras do nível nesta prova. */
  modificador?: Modificador | null
  /**
   * Prova que vale ponto ou troféu — a ranqueada e a Copa. Nela, como no
   * contrarrelógio, o carro é só pintura: o easter egg de `turboDoPiloto` não vale.
   */
  competitivo?: boolean
  /**
   * A sala exige o câmbio manual — é a regra da ranqueada. A corrida larga no
   * manual, qualquer que seja a preferência do piloto, e não deixa voltar ao
   * automático; a preferência guardada fica como estava.
   */
  manualObrigatorio?: boolean
  /** Aviso de conexão exibido sobre a pista sem interromper a corrida. */
  connectionNotice?: string | null
  /** Chamado a cada medição para ser enviada ao servidor. */
  onTelemetry?: (snapshot: GhostSnapshot) => void
  /** Desistir da prova em andamento, entregando a vitória ao rival. */
  onAbandon?: () => void
  onFinish: (result: RaceResult) => void
}

export type RaceRival = {
  id: string
  name: string
  car: CarId
  /** Falso enquanto o rival está sem sinal. */
  connected: boolean
  /**
   * Posições do rival. O fantasma de rede, já tratado contra atraso, ou a volta
   * gravada do recorde: os dois respondem onde o carro está num instante.
   */
  ghost: Pick<GhostTracker, 'sample'>
  /**
   * Sem esteira. O fantasma do recorde não deixa vácuo: se deixasse, o tempo
   * do contrarrelógio dependeria de correr colado nele, e deixaria de ser
   * comparável com o de quem correu sozinho.
   */
  semVacuo?: boolean
}

/** O que o HUD mostra sobre o rival mais perto. */
type RivalHud = {
  position: string
  name: string
  connected: boolean
  headline: string
  offScreen: string | null
  stale: boolean
  finished: boolean
  /** Com o fantasma à vista, o painel encolhe para não tapar a pista. */
  onScreen: boolean
  /** O rival está de boost agora. */
  boosting: boolean
}

/** Uma linha da classificação ao vivo, como o painel a mostra. */
type LinhaDoPainel = {
  id: string
  nome: string
  carro: CarId
  posicao: number
  /** Segundos em relação a quem se está olhando: positivo à frente. Null na própria linha. */
  diferenca: number | null
  chegou: boolean
  semSinal: boolean
  /** A linha de quem se está olhando: o próprio piloto, ou quem a câmera segue. */
  destaque: boolean
  /** Fração da prova já percorrida, de 0 a 1, para a marca na barra de progresso. */
  fracao: number
  /** De boost agora: a barra da cor do carro acende em ciano. */
  boost: boolean
}

/** Quem a câmera do espectador está seguindo, como o painel dele mostra. */
type Seguido = {
  id: string
  nome: string
  carro: CarId
  posicao: number
  velocidade: number
  chegou: boolean
}

type Telemetry = {
  progress: number
  speed: number
  boost: number
  elapsed: number
  offRoad: boolean
  penalty: number
  boosting: boolean
  boostLocked: boolean
  /** Aderência de 0 a 1. Abaixo de 1, o piloto está maltratando o volante. */
  grip: number
  /** Vácuo aproveitado, já suavizado, de 0 a 1. */
  slipstream: number
  /** Batidas desde o último reset. */
  strikes: number
  /** Medidor de saída de pista, de 0 a 1. */
  offTrack: number
  /** Segundos que faltam do reset em curso. */
  resetting: number
  /** Resets sofridos na prova: muda a cada reset, e é a chave da animação dele. */
  resets: number
  /** A próxima super curva, quando ela já está ao alcance da nota. */
  nota: NotaDeCurva | null
  /** Carga do mini-turbo, em segundos de carga ideal. */
  carga: number
  /** Nível que a carga já alcançou: 0 a 3. */
  nivelCarga: number
  /** Um impulso — mini-turbo ou largada — em curso. */
  impulso: boolean
  /** Diferença para o recorde no mesmo ponto da pista, em segundos, ou null sem recorde. */
  delta: number | null
  /** Segundos seguidos batendo no corte, sem trocar. */
  noCorte: number
  /** Pé no acelerador: o pedal ou o boost. */
  acelerando: boolean
}

const initialTelemetry: Telemetry = {
  progress: 0,
  speed: 0,
  boost: 100,
  elapsed: 0,
  offRoad: false,
  penalty: 0,
  boosting: false,
  boostLocked: false,
  grip: 1,
  slipstream: 0,
  strikes: 0,
  offTrack: 0,
  resetting: 0,
  resets: 0,
  nota: null,
  carga: 0,
  nivelCarga: 0,
  impulso: false,
  delta: null,
  noCorte: 0,
  acelerando: true,
}

/**
 * Lados da pista, em constante de módulo.
 *
 * Parece exagero, mas este vetor seria recriado quase cem vezes por quadro se
 * ficasse dentro do laço do cenário.
 */
const LADOS: Array<-1 | 1> = [-1, 1]

/** Identidade do próprio piloto na classificação: nenhum rival chega com ela. */
const ID_DO_JOGADOR = '\u0000jogador'

/**
 * Profundidade mínima em que um fantasma ainda é desenhado, em metros a partir
 * da câmera. Mais perto do que isso ele já passou dela: vira seta no radar.
 */
const PROFUNDIDADE_MINIMA_DO_FANTASMA = 0.8

/** Quanto as rodas descem abaixo do ponto em que o carro toca a pista, em unidades do sprite. */
const RODAS_ABAIXO_DO_CHAO = 26

/** Por quanto tempo um novo líder precisa se firmar na frente antes de a câmera automática trocar para ele. */
const FIRMEZA_DO_LIDER_MS = 1_200

/** Nome curto para a etiqueta: com seis na pista, o nome inteiro tapa a pista. */
const nomeDaEtiqueta = (nome: string) => nome.trim().toUpperCase().slice(0, 10)

/**
 * Ângulos das rajadas de velocidade, em torno do ponto de fuga.
 *
 * Vão de pouco acima do horizonte à esquerda até pouco acima dele à direita,
 * passando por baixo: rajada no céu não diz nada, e o que se quer é a sensação
 * de o chão fugir pelos cantos. O empurrãozinho de `sin` tira o leque regular
 * demais, e como a lista é constante ela é sempre a mesma corrida após corrida.
 */
const ANGULOS_DE_RAJADA = Array.from({ length: 18 }, (_, i) => {
  const passo = -0.18 * Math.PI + (i / 17) * 1.36 * Math.PI
  return passo + Math.sin(i * 12.9898) * 0.09
})

/**
 * Cerca e guardrail: as duas famílias que seguem procedurais.
 *
 * As duas são contínuas ao longo da pista, e o vão de cada vaga cobre metade
 * do espaçamento para os dois lados para as travessas se encontrarem. Isso
 * depende das projeções de duas vagas vizinhas, que diferem — assadas numa
 * célula por vaga, virariam uma fila de portõezinhos soltos.
 */
/** Tom para onde a poeira clareia ao subir do chão. */
const POEIRA_CLARA = '#c6b489'

/** A faísca nasce nesta cor e esfria para a cor dela. */
const FAISCA_QUENTE = '#fff3c4'

/** Fumaça de pneu queimado: cinza claro e frio, que não se confunde com a poeira da grama. */
const FUMACA_DE_PNEU = '#d7dcdf'

/**
 * Cor das faíscas da carga do mini-turbo, por nível: branco antes do
 * primeiro, depois azul, laranja e roxo — as cores do Mario Kart, que o
 * jogador já conhece. O tamanho cresce junto, para o nível não depender só da
 * cor.
 */
const COR_DA_CARGA = ['#e8f4ff', '#4fb6ff', '#ff9a2e', '#c86bff'] as const

/**
 * Quanto a paisagem gira por radiano de rumo, em larguras de tela.
 *
 * Com 0,42, um grampo de 180° passa 1,3 tela de céu diante do carro, e uma
 * curva comum, um terço de tela. Mais que isso, a serra patina nas curvas
 * comuns; menos, o grampo parece uma curva qualquer.
 */
const GIRO_DA_PAISAGEM = 0.42

/** Rolagem do horizonte por unidade de força lateral, em radianos, até a pior curva comum. */
const ROLAGEM_POR_CARGA = 0.052

/**
 * Rolagem a mais por unidade de força lateral acima da pior curva comum.
 *
 * É mais íngreme que a de baixo de propósito: a curva comum inclina o bastante
 * para ser sentida, e a super curva inclina o bastante para assustar. Um
 * grampo em cruzeiro passa dos dez graus.
 */
const ROLAGEM_ALEM_DA_COMUM = 0.09

/**
 * Maior rolagem do horizonte: pouco mais de 11°.
 *
 * O giro é em torno do ponto em que o carro toca a pista, então a borda do
 * asfalto junto dele quase não sai do lugar: o que inclina de verdade é o
 * horizonte, que é onde o exagero precisa aparecer.
 */
const ROLAGEM_MAXIMA = 0.2

/**
 * Altura do muro de pneus, em frações da largura da pista naquela distância.
 *
 * Quatro fileiras de pneu, mais alto que o carro: alto o bastante para parecer
 * que machuca, baixo o bastante para não tapar a pista que vem depois dele
 * numa curva de 180°.
 */
const ALTURA_DO_MURO = 0.12

/** Pintura dos pneus do muro: vermelho e branco, uma vaga de cada. */
const MURO_VERMELHO = '#d93a2f'
const MURO_BRANCO = '#eeeee6'
const MURO_BORRACHA = '#1d2024'

/** Inércia da rolagem, em segundos: a câmera acompanha, não chacoalha. */
const ROLAGEM_TAU = 0.3

/**
 * Força lateral em que o carro começa a atravessar, e quanto a mais ele leva
 * para a derrapagem cheia.
 *
 * A pior curva comum vale 1, e o carro começa a atravessar pouco antes dela.
 * O grampo em cruzeiro chega a 1,25 e atravessa bem; de boost ele passa de 1,9
 * e o carro vai todo de lado, que é o que acontece com quem entra embalado.
 */
const DERRAPAGEM_DE = 0.9
const DERRAPAGEM_FAIXA = 0.6

/**
 * Inércia da derrapagem, em segundos: entra depressa, porque a traseira escapa
 * de uma vez, e sai devagar, porque o piloto endireita o carro aos poucos.
 */
const DERRAPAGEM_ENTRA = 0.12
const DERRAPAGEM_SAI = 0.28

/**
 * Metros antes da super curva em que a nota de curva aparece.
 *
 * Em cruzeiro no normal são quatro segundos: tempo de ler, soltar o boost e
 * ir para o lado de dentro antes da entrada. É a mesma distância em que o
 * grampo começa a aparecer no horizonte.
 */
const ALCANCE_DA_NOTA = 280

/** O que o HUD anuncia da próxima super curva. */
type NotaDeCurva = {
  nome: string
  graus: number
  lado: 1 | -1
  /** Metros até a entrada; zero dentro dela. */
  metros: number
  dentro: boolean
  /** Lado da curva emendada logo depois, num S; zero se não há. */
  depois: 1 | -1 | 0
}

const CERCA = rampa('#6d7b7f')
const GUARDRAIL = rampa('#aeb6ba')

/**
 * Altura na tela de cada família, em frações da largura da pista.
 *
 * São os mesmos números de quando cada objeto era desenhado à mão aqui: o
 * que mudou foi de onde vem o desenho, não o tamanho que ele ocupa.
 */
const ALTURA_DA_FAMILIA: Record<FamiliaDeVaga, number> = {
  tree: 0.52,
  bush: 0.16,
  grass: 0.038,
  // A placa nova tem painel largo, então ela precisa ser mais baixa que a
  // antiga para ocupar a mesma mancha na beira da pista.
  sign: 0.085,
  pneus: 0.075,
  poste: 0.42,
  arquibancada: 0.26,
  bandeira: 0.3,
  pedra: 0.1,
  cacto: 0.34,
  predio: 0.52,
}

/**
 * Sombra que todo objeto deixa no chão.
 *
 * É o detalhe mais barato e o que mais rende: sem ela, árvore, arbusto, poste
 * e placa pairam alguns pixels acima da grama e a cena inteira perde o
 * assentamento. Deslocada para a direita, porque a luz vem da esquerda — a
 * mesma direção da face iluminada do carro.
 */
const SOMBRA_NO_CHAO = 'rgba(10,20,26,.3)'

/** Diferença de tempo com sinal, em segundos com centésimos: −0,42 é ganho. */
function formatarDelta(segundos: number) {
  const sinal = segundos <= 0 ? '−' : '+'
  return `${sinal}${Math.abs(segundos).toFixed(2).replace('.', ',')}`
}

/** Os botões de toque que acendem: os que se seguram e as borboletas. */
type BotaoDeToque = Comando | Borboleta

const BOTOES_DE_TOQUE: readonly BotaoDeToque[] = ['left', 'right', 'boost', 'brake', 'shiftUp', 'shiftDown']

/** Luzes do volante: cinco verdes, cinco vermelhas e cinco azuis, como num Fórmula 1. */
const LUZES_DO_CAMBIO = 15

/** Giro em que a primeira luz do volante acende. Abaixo dele, apagadas. */
const GIRO_DA_PRIMEIRA_LUZ = 0.55

/** Segundos no corte até a tela lembrar de subir a marcha. */
const LEMBRETE_DO_CORTE_S = 1

/** Segundos parado na largada, sem acelerar, até a tela lembrar do pedal. */
const LEMBRETE_DO_PEDAL_S = 1.5

/** O que a etiqueta ao lado da marcha diz de cada troca que ela comenta. */
const NOTA_DA_TROCA: Partial<Record<QualidadeDaTroca | 'negada', string>> = {
  perfeita: 'PERFEITA',
  cedo: 'CEDO',
  tarde: 'TARDE',
  negada: 'GIRO ALTO',
}

/**
 * Quanto tempo, no mínimo, o botão de toque fica aceso. É perto do que o
 * `:active` do Chrome dura num toque rápido: menos que isso, o pulso de
 * volante acenderia e apagaria antes de a tela ser pintada.
 */
const ACESO_MINIMO_MS = 120

/** As teclas de quem pilota: direção, pedais, borboletas e boost. */
const TECLAS_DE_PILOTAR = [
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyE', 'KeyQ', 'Space',
]

/** Janela para o segundo toque que confirma o abandono, a mesma do TIRAR do lobby. */
const JANELA_DO_ABANDONO_MS = 3_000

function RaceCanvas({
  pilotName,
  car,
  rivals = [],
  startAt,
  countdownMs = DEFAULT_COUNTDOWN_MS,
  trackSeed,
  difficulty,
  now,
  mode = 'solo',
  recorde = null,
  onRestart,
  modificador = null,
  competitivo = false,
  manualObrigatorio = false,
  espectadores = 0,
  connectionNotice = null,
  onTelemetry,
  onAbandon,
  onFinish,
}: RaceCanvasProps) {
  const espectador = mode === 'espectador'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const comandosRef = useRef(new Comandos())
  /** Os controles de toque, cujos botões acendem pelo comando e não pelo `:active`. */
  const controlesRef = useRef<HTMLDivElement>(null)
  const acesoRef = useRef<Record<BotaoDeToque, { desde: number; timer: number }>>({
    left: { desde: 0, timer: 0 },
    right: { desde: 0, timer: 0 },
    boost: { desde: 0, timer: 0 },
    throttle: { desde: 0, timer: 0 },
    brake: { desde: 0, timer: 0 },
    shiftUp: { desde: 0, timer: 0 },
    shiftDown: { desde: 0, timer: 0 },
  })
  /** As luzes do volante e o número da marcha: acesos a cada quadro, sem passar pelo React. */
  const luzesRef = useRef<HTMLDivElement>(null)
  const marchaRef = useRef<HTMLElement>(null)
  /** Onde terminam ‹ e começa ›, medidos quando o dedo desce. */
  const vaoDasSetasRef = useRef({ fimDaEsquerda: 0, inicioDaDireita: 0 })
  const clockRef = useRef(now ?? Date.now)
  const finishRef = useRef(onFinish)
  // Na arquibancada não há carro próprio: o easter egg só vale para quem pilota.
  // Nem onde há ponto, troféu ou quadro em jogo: lá o servidor também o ignora.
  const turbo = espectador || competitivo || mode === 'contrarrelogio' ? 1 : turboDoPiloto(pilotName, car)
  const raceRef = useRef(createRaceState(difficulty, turbo))
  const startedRef = useRef(false)
  const doneRef = useRef(false)
  const rivalsRef = useRef(rivals)
  // Os carros entram por referência: o laço de quadro não é refeito por eles.
  const carRef = useRef(car)
  const sendTelemetryRef = useRef(onTelemetry)
  /** A semente escolhe a faixa: todos os pilotos da sala ouvem a mesma. */
  const trackSeedRef = useRef(trackSeed)
  const [telemetry, setTelemetry] = useState(initialTelemetry)
  const [rival, setRival] = useState<RivalHud | null>(null)
  const [phase, setPhase] = useState<RacePhase>('countdown')
  const [countdownLight, setCountdownLight] = useState(0)
  /** O aviso curto da vez: uma batida é alerta; um mini-turbo, prêmio. Cada tipo mora de um lado. */
  const [flash, setFlash] = useState<{ texto: string; tipo: 'alerta' | 'premio' } | null>(null)
  /** O câmbio desta corrida: manual, com as borboletas e a troca perfeita, ou automático. */
  const [cambioManual, setCambioManual] = useState(() => manualObrigatorio || lerCambio() === 'manual')
  // A regra vem da sala e vale a corrida inteira: a corrida nasce de novo a cada largada.
  const manualObrigatorioRef = useRef(manualObrigatorio)
  /** Aparelho de toque: o pé fica no fundo sozinho e o freio mora ao lado do boost. */
  const [deToque] = useState(aparelhoDeToque)
  /** A última troca de marcha que merece comentário, e quantas trocas perfeitas vieram seguidas. */
  const [notaDaTroca, setNotaDaTroca] = useState<{ qualidade: QualidadeDaTroca | 'negada'; vez: number } | null>(null)
  const [trocaPerfeita, setTrocaPerfeita] = useState<{ sequencia: number; vez: number } | null>(null)
  const [motivoDoReset, setMotivoDoReset] = useState<ResetReason>('crashes')
  /** Tangências feitas na prova: cada uma reinicia o aviso dela. */
  const [tangencias, setTangencias] = useState(0)
  /** O que a última tangência devolveu, e em que ponto da sequência ela caiu. */
  const [ultimaTangencia, setUltimaTangencia] = useState({ boost: APEX_BOOST, sequencia: 1 })
  /** A última parcial: o setor, o tempo dele e a diferença para o recorde. */
  const [parcial, setParcial] = useState<{ setor: number; tempo: number; delta: number | null } | null>(null)
  /**
   * Quem decide a largada turbo. Ouve o boost pelas teclas, com o instante
   * exato do aperto, e pelo quadro, para o apagar das luzes e o fim da janela.
   */
  const juizRef = useRef(new JuizDaLargada())
  /** Teclado ou toque: o último comando que chegou. */
  const dispositivoRef = useRef<'teclado' | 'toque'>('teclado')
  /** Largada decidida fora do laço de quadro, esperando o quadro aplicá-la. */
  const largadaPendenteRef = useRef<Largada | null>(null)
  const startAtRef = useRef(startAt)
  startAtRef.current = startAt
  const [lateStart, setLateStart] = useState(0)
  const audioRef = useRef<RaceAudio | null>(null)
  const [mudo, setMudo] = useState(lerSomDesligado)
  const [semMusica, setSemMusica] = useState(lerMusicaDesligada)
  /** A faixa que acabou de entrar na rádio, enquanto o aviso dela está na tela. */
  const [faixaNoAr, setFaixaNoAr] = useState<{ nome: string; estilo: string; desde: number } | null>(null)
  /** Classificação ao vivo, de todos os que estão na pista. */
  const [painel, setPainel] = useState<LinhaDoPainel[]>([])
  /** Quem a câmera do espectador segue agora. */
  const [seguido, setSeguido] = useState<Seguido | null>(null)
  /** No automático, a câmera fica com o líder de quem ainda corre. */
  const [autoLider, setAutoLider] = useState(true)
  /** O primeiro toque em ABANDONAR só pergunta. */
  const [abandonoArmado, setAbandonoArmado] = useState(false)
  const modeRef = useRef(mode)
  /** Escolha manual do espectador: o piloto que ele pediu para seguir. */
  const seguindoRef = useRef<string | null>(null)
  const autoLiderRef = useRef(autoLider)
  /** Ordem da classificação no último quadro, para trocar de piloto com as setas. */
  const ordemRef = useRef<string[]>([])
  /** Instante do último passo de física: sem ele, a aba parada mandaria velocidade de corrida. */
  const ultimoPassoRef = useRef(0)

  /**
   * O recorde corre como mais um fantasma, com o carro do próprio piloto, e
   * larga no mesmo apagar de luzes. Não deixa esteira.
   */
  const fantasmaDoRecorde = useMemo(
    () => (recorde ? new ReproducaoDeVolta(recorde.gravacao, startAt) : null),
    [recorde, startAt],
  )
  const recordeRef = useRef(fantasmaDoRecorde)
  recordeRef.current = fantasmaDoRecorde
  const rivaisDaPista = useMemo<RaceRival[]>(
    () =>
      fantasmaDoRecorde
        ? [
            ...rivals,
            { id: 'recorde', name: recorde?.nome ?? 'SEU RECORDE', car, connected: true, ghost: fantasmaDoRecorde, semVacuo: true },
          ]
        : rivals,
    [rivals, fantasmaDoRecorde, car, recorde?.nome],
  )
  const restartRef = useRef(onRestart)
  restartRef.current = onRestart

  const pilotNameRef = useRef(pilotName)
  pilotNameRef.current = pilotName
  modeRef.current = mode
  autoLiderRef.current = autoLider
  clockRef.current = now ?? Date.now
  finishRef.current = onFinish
  rivalsRef.current = rivaisDaPista
  carRef.current = car
  sendTelemetryRef.current = onTelemetry
  trackSeedRef.current = trackSeed

  /**
   * Motor, vento e rolamento, criados na primeira vez que o som é pedido.
   *
   * O pedido vem na montagem da tela, antes da primeira luz: o celular leva
   * de dezenas a centenas de milissegundos para abrir a saída de som, e as
   * amostras do motor começam a baixar ali. No treino a montagem ainda está
   * dentro do clique que iniciou a corrida, então o contexto nasce destravado;
   * na sala, a largada vem do servidor, e quem destrava é o primeiro toque.
   */
  const som = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.resume()
      return audioRef.current
    }
    const AudioContextClass = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return null
    try {
      // O carro escolhe a voz do motor; a semente, a faixa que abre a rádio.
      const motor = new RaceAudio(new AudioContextClass(), faixaDaCorrida(trackSeedRef.current), carRef.current)
      motor.setMuted(lerSomDesligado())
      motor.setMusicEnabled(!lerMusicaDesligada())
      motor.resume()
      audioRef.current = motor
      // Cada faixa que entra na rádio aparece por uns segundos na tela.
      motor.aoTrocarDeFaixa((faixa) => setFaixaNoAr({ nome: faixa.nome, estilo: faixa.estilo, desde: Date.now() }))
      return motor
    } catch {
      // Sem áudio o jogo segue igual: é reforço, não regra.
      return null
    }
  }, [])

  const beep = useCallback((frequency: number, duration = 0.12) => {
    som()?.beep(frequency, duration)
  }, [som])

  const alternarSom = useCallback(() => {
    const proximo = !lerSomDesligado()
    definirSomDesligado(proximo)
    setMudo(proximo)
    audioRef.current?.setMuted(proximo)
  }, [])

  const alternarMusica = useCallback(() => {
    const proximo = !lerMusicaDesligada()
    definirMusicaDesligada(proximo)
    setSemMusica(proximo)
    audioRef.current?.setMusicEnabled(!proximo)
  }, [])

  /** Pula para a próxima faixa da Rádio Fantasma. */
  const proximaFaixa = useCallback(() => {
    audioRef.current?.proximaFaixa()
  }, [])

  /**
   * Troca entre o câmbio manual e o automático. Vale na hora: os comandos
   * levam o câmbio em todo quadro, e o registro da volta guarda quando ele
   * mudou — o servidor refaz a volta com a troca no mesmo quadro.
   */
  const definirCambioManual = useCallback((manual: boolean) => {
    // Na sala de câmbio manual não há o que trocar, e a regra dela não vira a
    // preferência do piloto para as outras corridas.
    if (manualObrigatorioRef.current) return
    comandosRef.current.manual = manual
    definirCambio(manual ? 'manual' : 'automatico')
    setCambioManual(manual)
  }, [])

  const alternarCambio = useCallback(() => {
    definirCambioManual(!comandosRef.current.manual)
  }, [definirCambioManual])

  // Os comandos nascem com o câmbio escolhido e, no aparelho de toque, com o
  // pé no fundo: os dois polegares já têm o que fazer.
  useEffect(() => {
    comandosRef.current.manual = manualObrigatorioRef.current || lerCambio() === 'manual'
    comandosRef.current.aceleradorAutomatico = aparelhoDeToque()
  }, [])

  // As etiquetas da troca somem sozinhas.
  useEffect(() => {
    if (!notaDaTroca) return
    const timer = window.setTimeout(() => setNotaDaTroca(null), 700)
    return () => window.clearTimeout(timer)
  }, [notaDaTroca])
  useEffect(() => {
    if (!trocaPerfeita) return
    const timer = window.setTimeout(() => setTrocaPerfeita(null), 900)
    return () => window.clearTimeout(timer)
  }, [trocaPerfeita])

  /** Quem a câmera está seguindo neste quadro, escolhido ou automático. */
  const seguidoIdRef = useRef<string | null>(null)

  /**
   * Troca o piloto seguido pela câmera do espectador, na ordem da
   * classificação. Escolher alguém desliga o automático; o botão do líder volta
   * a ligá-lo.
   */
  const seguirOutro = useCallback((passo: number) => {
    const ordem = ordemRef.current
    if (ordem.length === 0) return
    const indice = Math.max(0, ordem.indexOf(seguidoIdRef.current ?? ''))
    seguindoRef.current = ordem[(indice + passo + ordem.length) % ordem.length]
    setAutoLider(false)
  }, [])

  const seguirPiloto = useCallback((id: string) => {
    seguindoRef.current = id
    setAutoLider(false)
  }, [])

  const seguirLider = useCallback(() => {
    seguindoRef.current = null
    setAutoLider(true)
  }, [])

  // O aviso da faixa some sozinho depois de uns segundos.
  useEffect(() => {
    if (!faixaNoAr) return
    const timer = window.setTimeout(() => setFaixaNoAr(null), 4_500)
    return () => window.clearTimeout(timer)
  }, [faixaNoAr])

  /**
   * O boost vai ao juiz da largada no instante em que muda, e não no quadro
   * seguinte: a janela da perfeita é de poucos quadros. A tecla e o dedo chegam
   * por caminhos diferentes, e os dois passam por aqui depois de mexer nos
   * comandos.
   */
  const observarBoost = useCallback(() => {
    const decisao = juizRef.current.observar(comandosRef.current.segurando('boost'), clockRef.current() - startAtRef.current)
    if (decisao) largadaPendenteRef.current = decisao
  }, [])

  // O ABANDONAR mora ao lado do RÁDIO, e abandonar não tem volta: o primeiro
  // toque só arma o botão, como o TIRAR do lobby. Armado, ele desarma sozinho.
  useEffect(() => {
    if (!abandonoArmado) return
    const timer = window.setTimeout(() => setAbandonoArmado(false), JANELA_DO_ABANDONO_MS)
    return () => window.clearTimeout(timer)
  }, [abandonoArmado])

  const tocarEmAbandonar = () => {
    if (!abandonoArmado) {
      setAbandonoArmado(true)
      return
    }
    setAbandonoArmado(false)
    onAbandon?.()
  }

  const botao = useCallback(
    (comando: BotaoDeToque) => controlesRef.current?.querySelector<HTMLButtonElement>(`[data-comando="${comando}"]`) ?? null,
    [],
  )

  /**
   * O botão acende no mesmo evento que liga o comando, e não pelo `:active`
   * do navegador: com o dedo deslizando de ‹ para ›, o `:active` ficaria no
   * botão de onde o dedo saiu. O toque rápido fica aceso um instante mínimo,
   * senão acenderia e apagaria antes de a tela ser pintada.
   */
  const acender = useCallback((comando: BotaoDeToque) => {
    const aceso = acesoRef.current[comando]
    window.clearTimeout(aceso.timer)
    aceso.timer = 0
    aceso.desde = performance.now()
    botao(comando)?.setAttribute('data-on', '')
  }, [botao])

  /** A borboleta não se segura: nenhum dedo a mantém acesa. */
  const seguraAceso = useCallback(
    (comando: BotaoDeToque) => comando !== 'shiftUp' && comando !== 'shiftDown' && comandosRef.current.dedoEm(comando),
    [],
  )

  /** O dedo que desliza para a outra seta apaga a de origem na hora: não houve toque rápido ali. */
  const apagarSeSolto = useCallback((comando: BotaoDeToque, naHora = false) => {
    if (seguraAceso(comando)) return
    const aceso = acesoRef.current[comando]
    const apagar = () => {
      aceso.timer = 0
      if (!seguraAceso(comando)) botao(comando)?.removeAttribute('data-on')
    }
    window.clearTimeout(aceso.timer)
    const falta = naHora ? 0 : ACESO_MINIMO_MS - (performance.now() - aceso.desde)
    if (falta > 0) aceso.timer = window.setTimeout(apagar, falta)
    else apagar()
  }, [botao, seguraAceso])

  const apagarTodos = useCallback(() => {
    for (const comando of BOTOES_DE_TOQUE) {
      window.clearTimeout(acesoRef.current[comando].timer)
      acesoRef.current[comando].timer = 0
      botao(comando)?.removeAttribute('data-on')
    }
  }, [botao])

  const soltarDedo = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const comando = comandosRef.current.dedoSubiu(event.pointerId)
    if (comando) apagarSeSolto(comando)
    if (comando === 'boost') observarBoost()
  }

  /**
   * Controles de toque. O comando é registrado antes de capturar o ponteiro:
   * se a captura falhar no aparelho, o botão continua funcionando.
   */
  const holdControl = (comando: Comando) => ({
    'data-comando': comando,
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      dispositivoRef.current = 'toque'
      // Quem pilota pelo toque não tem pedal: o pé volta ao fundo sozinho.
      comandosRef.current.aceleradorAutomatico = true
      comandosRef.current.dedoDesceu(event.pointerId, comando)
      acender(comando)
      if (comando === 'boost') observarBoost()
      if (comando === 'left' || comando === 'right') {
        // As bordas de dentro das setas, para o dedo que deslizar de uma para a outra.
        const esquerda = botao('left')?.getBoundingClientRect()
        const direita = botao('right')?.getBoundingClientRect()
        if (esquerda && direita) {
          vaoDasSetasRef.current = { fimDaEsquerda: esquerda.right, inicioDaDireita: direita.left }
        }
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Sem captura o botão ainda responde ao soltar.
      }
    },
    // O polegar que balança entre ‹ e › sem levantar leva a direção junto. O
    // boost fica de fora: não tem vizinho para onde deslizar.
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const atual = comandosRef.current.comandoDoDedo(event.pointerId)
      if (atual !== 'left' && atual !== 'right') return
      const { fimDaEsquerda, inicioDaDireita } = vaoDasSetasRef.current
      const lado = ladoDoDedo(event.clientX, atual, fimDaEsquerda, inicioDaDireita)
      if (lado === atual) return
      comandosRef.current.dedoMudou(event.pointerId, lado)
      acender(lado)
      apagarSeSolto(atual, true)
    },
    onPointerUp: soltarDedo,
    onPointerCancel: soltarDedo,
    onLostPointerCapture: soltarDedo,
  })

  /** A borboleta de toque: cada toque troca uma marcha, e o botão pisca um instante. */
  const tocarBorboleta = (qual: Borboleta) => ({
    'data-comando': qual,
    onPointerDown: () => {
      dispositivoRef.current = 'toque'
      comandosRef.current.aceleradorAutomatico = true
      comandosRef.current.borboleta(qual)
      acender(qual)
      apagarSeSolto(qual)
    },
  })

  // O áudio só destrava num gesto que o navegador aceita — soltar o dedo,
  // clicar ou teclar; o toque que desce não conta. Quem chega pelo link da
  // arquibancada, ou recarrega a página, abre a corrida sem gesto nenhum: o
  // primeiro toque na tela é que libera o som. Também traz o som de volta
  // depois de uma ligação, que suspende o áudio no iPhone.
  useEffect(() => {
    const destravar = () => audioRef.current?.resume()
    const opcoes = { capture: true, passive: true }
    const eventos = ['pointerup', 'touchend', 'click', 'keydown'] as const
    for (const evento of eventos) window.addEventListener(evento, destravar, opcoes)
    return () => {
      for (const evento of eventos) window.removeEventListener(evento, destravar, opcoes)
    }
  }, [])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(event.code)) event.preventDefault()
      if (TECLAS_DE_PILOTAR.includes(event.code)) dispositivoRef.current = 'teclado'
      // Na arquibancada as setas trocam de piloto, e o L volta para o líder.
      if (modeRef.current === 'espectador') {
        if (event.repeat) return
        if (event.code === 'ArrowLeft' || event.code === 'KeyA') seguirOutro(-1)
        if (event.code === 'ArrowRight' || event.code === 'KeyD') seguirOutro(1)
        if (event.code === 'KeyL') seguirLider()
        if (event.code === 'KeyR') audioRef.current?.proximaFaixa()
        return
      }
      const comandos = comandosRef.current
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') comandos.tecla('left', true)
      if (event.code === 'ArrowRight' || event.code === 'KeyD') comandos.tecla('right', true)
      if (event.code === 'Space') {
        comandos.tecla('boost', true)
        observarBoost()
      }
      // Os pedais: quem pisa pelo teclado assume o acelerador.
      if (event.code === 'ArrowUp' || event.code === 'KeyW') {
        comandos.aceleradorAutomatico = false
        comandos.tecla('throttle', true)
      }
      if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        comandos.aceleradorAutomatico = false
        comandos.tecla('brake', true)
      }
      // As borboletas: uma troca por toque, e não enquanto a tecla repete. No
      // automático, tocar numa delas é pedir o câmbio na mão.
      if ((event.code === 'KeyE' || event.code === 'KeyQ') && !event.repeat) {
        if (!comandos.manual) definirCambioManual(true)
        comandos.borboleta(event.code === 'KeyE' ? 'shiftUp' : 'shiftDown')
      }
      // R troca a estação: uma vez por toque, e não enquanto a tecla repete.
      if (event.code === 'KeyR' && !event.repeat) audioRef.current?.proximaFaixa()
      // Backspace recomeça o contrarrelógio na hora, como no Trackmania: tentar
      // de novo tem de custar menos que desistir da tentativa.
      if (event.code === 'Backspace' && !event.repeat && restartRef.current) {
        event.preventDefault()
        restartRef.current()
      }
    }
    const up = (event: KeyboardEvent) => {
      const comandos = comandosRef.current
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') comandos.tecla('left', false)
      if (event.code === 'ArrowRight' || event.code === 'KeyD') comandos.tecla('right', false)
      if (event.code === 'Space') {
        comandos.tecla('boost', false)
        observarBoost()
      }
      if (event.code === 'ArrowUp' || event.code === 'KeyW') comandos.tecla('throttle', false)
      if (event.code === 'ArrowDown' || event.code === 'KeyS') comandos.tecla('brake', false)
    }
    // Perder o foco solta teclas e dedos, senão o carro segue virando sozinho.
    // No celular, trocar de app ou apagar a tela nem sempre tira o foco antes
    // de a página congelar: sumir da tela também solta.
    const release = () => {
      comandosRef.current.soltarTudo()
      apagarTodos()
      observarBoost()
    }
    const aoSumir = () => {
      if (document.hidden) release()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    window.addEventListener('pagehide', release)
    document.addEventListener('visibilitychange', aoSumir)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      window.removeEventListener('pagehide', release)
      document.removeEventListener('visibilitychange', aoSumir)
    }
  }, [apagarTodos, definirCambioManual, observarBoost, seguirLider, seguirOutro])

  useEffect(() => {
    // Quem abre a tela depois do instante combinado larga já em atraso.
    setLateStart(lateBy(clockRef.current(), startAt))
  }, [startAt])

  /**
   * Máquina de estados da largada.
   *
   * Roda em um temporizador, e não no ciclo de animação, porque o navegador
   * congela `requestAnimationFrame` em abas que não estão em primeiro plano.
   * Assim as luzes e o instante da largada continuam corretos nos dois
   * aparelhos mesmo que um deles esteja com a tela em segundo plano.
   */
  useEffect(() => {
    raceRef.current = createRaceState(difficulty, turbo)
    // O desafio da semana mexe nas regras do nível, e a física corre com elas.
    if (modificador) raceRef.current.rules = MODIFICADORES[modificador].regras(raceRef.current.rules)
    juizRef.current = new JuizDaLargada()
    largadaPendenteRef.current = null
    startedRef.current = false
    doneRef.current = false
    setPhase('countdown')
    setCountdownLight(0)
    setTelemetry(initialTelemetry)
    setParcial(null)

    let timer = 0
    let lightsShown = -1

    const tick = () => {
      const state = countdownAt(clockRef.current(), startAt, countdownMs)

      if (state.phase !== 'go') {
        if (state.lights === lightsShown) return
        lightsShown = state.lights
        setCountdownLight(state.lights)
        if (state.lights > 0) beep(330 + state.lights * 24)
        return
      }

      if (!startedRef.current) {
        startedRef.current = true
        setCountdownLight(0)
        setPhase('racing')
        beep(740, 0.35)
        // A trilha entra no "VAI!", com o prato do primeiro compasso. No duelo
        // a largada é a mesma nos dois aparelhos, então a música também.
        som()?.startMusic()
      }
      if (timer) {
        window.clearInterval(timer)
        timer = 0
      }
    }

    // A saída de som já aberta quando a primeira luz acender: o bipe sai junto
    // com ela, e não atrasado.
    som()
    tick()
    if (!startedRef.current) timer = window.setInterval(tick, 50)
    return () => {
      if (timer) window.clearInterval(timer)
    }
  }, [beep, countdownMs, difficulty, modificador, som, startAt, turbo])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Opaco: todo quadro cobre a tela inteira com céu e chão opacos, e um
    // canvas transparente obrigaria o navegador a misturá-lo, pixel a pixel,
    // com o fundo da página em todo quadro — na resolução nativa do celular.
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const race = raceRef.current
    const lateAtStart = lateBy(clockRef.current(), startAt)

    // O traçado da prova, reconstruído a partir da semente oficial. O outro
    // piloto monta exatamente o mesmo a partir do mesmo número.
    const layout = createTrackLayout(trackSeed)
    // Céu, terreno e vegetação desta corrida, sorteados da mesma semente: os
    // dois pilotos correm no mesmo lugar, à mesma hora do dia.
    const ambiente = layout.ambient
    // Rampas do fundo, montadas uma vez por corrida: a serra de perto em tom
    // cheio, a de longe já misturada com o céu, que é o que a afasta.
    const serra = rampa(ambiente.serra)
    const serraLonge = rampa(misturar(ambiente.serra, ambiente.ceuMeio, 0.42))
    const nuvem = rampa(misturar(ambiente.ceuMeio, LUZ, 0.3))
    // A faixa de meio-campo fica entre a serra e a grama, e a cor dela também:
    // mais fechada que a montanha lavada pelo céu, mais aberta que o chão.
    const corDaFaixa = misturar(ambiente.serra, ambiente.chao, 0.38)
    // O buraco é a única peça que continua sendo pintada ao vivo, e a única
    // cuja cor vem do chão em que ela está: asfalto quebrado é asfalto, e uma
    // borda de cinza fixo apareceria clara demais ao entardecer e escura
    // demais ao meio-dia.
    const buraco = rampa(ambiente.asfaltoClaro)
    // Poeira da grama, da cor do chão daquele lugar. Clareada, porque poeira
    // no ar pega luz que o chão não pega — mas puxada para o tom dele, senão
    // a mesma nuvem bege subiria do campo verde e da duna.
    const poeira = misturar(ambiente.chao, POEIRA_CLARA, 0.55)
    let width = 0
    let height = 0
    let previous = performance.now()
    // Resolução e ritmo que cedem só no aparelho que não fecha o quadro.
    const ritmo = new RitmoDoQuadro(Math.min(window.devicePixelRatio || 1, 2))
    let densidadeAplicada = 0
    let ultimoDesenho = performance.now()
    /**
     * Um só compasso para o HUD. Telemetria, painel do rival e lista ao vivo
     * mudam no mesmo quadro, e o React junta os três num render só; em
     * compassos próprios, eram três renders do componente inteiro em quadros
     * diferentes, cada um num quadro que ainda precisa desenhar a pista.
     */
    let ultimaTela = 0
    let tiquesDaTela = 0
    /** A lista ao vivo vazia não precisa ser mandada de novo a cada tique. */
    let painelVazio = true
    let animationFrame = 0
    const flashTimers: number[] = []

    // O que a prova mostrou, e a volta inteira: viram a análise da tela de
    // resultado e o fantasma do próximo recorde.
    const analista = new AnalistaDaCorrida(layout.superCurves)
    const gravador = new GravadorDeVolta()
    // Os comandos de cada quadro: o contrarrelógio os manda ao servidor, que
    // refaz a volta com a mesma física e confere se ela bate com a gravada.
    const gravadorDeEntradas = new GravadorDeEntradas()
    let ultimoTempoDeProva: number | null = null
    let setoresAnunciados = 0
    /** Tempo de prova agora menos o do recorde no mesmo ponto da pista. */
    const deltaParaORecorde = (metros: number, tempo: number) => {
      const referencia = recordeRef.current?.tempoEm(metros) ?? null
      return referencia === null || metros < 1 ? null : tempo - referencia
    }
    /**
     * A parcial de cada setor, na saída de cada super curva. Com recorde, vem
     * com a diferença para ele, em verde ou vermelho; sem, só o tempo.
     */
    const anunciarParcial = (tempo: number) => {
      while (setoresAnunciados < analista.setoresCompletos) {
        const setor = setoresAnunciados
        setoresAnunciados += 1
        const fim = analista.setores[setor]
        // A chegada tem a tela de resultado: a parcial é dos setores do meio.
        if (fim >= TRACK_LENGTH) continue
        const referencia = recordeRef.current?.tempoEm(fim) ?? null
        setParcial({
          setor: setor + 1,
          tempo: analista.parcial(setor) ?? tempo,
          delta: referencia === null ? null : (analista.parcial(setor) ?? tempo) - referencia,
        })
      }
    }

    // Intensidades contínuas para a apresentação, derivadas da corrida.
    const feel = createFeel()

    // Quem pede menos movimento no sistema recebe a cena sem tremor.
    const semTremor = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const forcaDoMovimento = semTremor ? 0.25 : 1
    const effects = new ParticleField()
    const dustRate = new EmissionRate(34)
    const boostRate = new EmissionRate(26)
    const skidRate = new EmissionRate(22)
    const smokeRate = new EmissionRate(30)
    const wallRate = new EmissionRate(40)
    const cargaRate = new EmissionRate(36)

    // Voltar do segundo plano não pode gerar um passo gigante de simulação.
    const resumeClock = () => {
      previous = performance.now()
    }
    document.addEventListener('visibilitychange', resumeClock)

    const resize = () => {
      const box = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, ritmo.densidade)
      if (box.width === width && box.height === height && pixelRatio === densidadeAplicada) return
      densidadeAplicada = pixelRatio
      width = box.width
      height = box.height
      canvas.width = Math.floor(width * pixelRatio)
      canvas.height = Math.floor(height * pixelRatio)
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      // O canvas opaco redimensionado nasce preto: até o próximo quadro, fica
      // da cor da página, como ficaria transparente.
      ctx.fillStyle = '#07101a'
      ctx.fillRect(0, 0, width, height)
      // As folhas de sprite escolhem a redução pelo tamanho em pixels do
      // aparelho, e não pelo do CSS.
      definirDensidade(ctx, pixelRatio)
      // O maior carro da tela é o do jogador: é por ele que as folhas sabem
      // se precisam guardar o tamanho cheio.
      definirMaiorEscala(Math.max(0.76, width / CAR_SPRITE_REFERENCE_WIDTH) * pixelRatio)
      // Mudar o tamanho do canvas zera o contexto, e com ele a qualidade da
      // ampliação. Quem reduz — carro e cenário — escolhe a própria.
      ctx.imageSmoothingQuality = 'high'
    }
    resize()
    soltarFolhasDeOutroAmbiente(ambiente.nevoaRGB)
    prepareCar(carRef.current, ambiente.nevoaRGB)
    for (const rival of rivalsRef.current) {
      prepareCar(rival.car, ambiente.nevoaRGB, true)
      // Na arquibancada, qualquer um deles pode virar o carro da câmera, inteiro.
      if (modeRef.current === 'espectador') prepareCar(rival.car, ambiente.nevoaRGB)
    }
    prepararCenario(ambiente.flora, ambiente.nevoaRGB)

    // A janela nem sempre muda de tamanho junto com a tela do jogo: em telas
    // divididas, ao girar o celular ou quando a barra do navegador some, só o
    // elemento muda. Observar o próprio canvas evita a pista fora de escala.
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    window.addEventListener('resize', resize)

    // Cada aviso apaga só a si mesmo. Na terceira batida, o aviso da batida e o
    // do reset saem no mesmo quadro, e o temporizador do primeiro apagaria o
    // segundo antes da hora.
    let avisoAtual = 0
    const announce = (message: string, tipo: 'alerta' | 'premio' = 'alerta') => {
      const este = (avisoAtual += 1)
      setFlash({ texto: message, tipo })
      flashTimers.push(window.setTimeout(() => {
        if (avisoAtual === este) setFlash(null)
      }, 1_200))
    }

    /**
     * As luzes do volante e o número da marcha, pintados a cada quadro.
     *
     * Não passam pelo React: a janela da troca perfeita dura um quarto de
     * segundo, e o compasso do HUD — um render a cada 80 ms — acenderia as
     * luzes atrasadas justo onde o atraso custa. Aqui só se mexe no que mudou.
     */
    let luzesAcesas = -1
    let janelaAcesa = false
    let corteAceso = false
    let marchaMostrada = -1
    const pintarCambio = () => {
      const luzes = luzesRef.current
      const marcha = marchaRef.current
      if (!luzes || !marcha) return
      const parado = race.resetting > 0 || race.afogado > 0 || !startedRef.current
      const giro = parado ? 0 : race.giro
      const acesas = Math.max(
        0,
        Math.min(LUZES_DO_CAMBIO, Math.ceil(((giro - GIRO_DA_PRIMEIRA_LUZ) / (1 - GIRO_DA_PRIMEIRA_LUZ)) * LUZES_DO_CAMBIO)),
      )
      if (acesas !== luzesAcesas) {
        luzesAcesas = acesas
        for (let i = 0; i < luzes.children.length; i += 1) luzes.children[i].classList.toggle('on', i < acesas)
      }
      // A janela aberta pisca todas as luzes: é a hora de subir.
      const janela = race.janelaDeTroca && !parado
      if (janela !== janelaAcesa) {
        janelaAcesa = janela
        luzes.toggleAttribute('data-janela', janela)
      }
      // Passou da janela, batendo no corte: as luzes piscam em vermelho.
      const corte = race.noCorte > TOLERANCIA_DO_CORTE
      if (corte !== corteAceso) {
        corteAceso = corte
        luzes.toggleAttribute('data-corte', corte)
      }
      if (race.marcha !== marchaMostrada) {
        marchaMostrada = race.marcha
        marcha.textContent = String(race.marcha + 1)
      }
    }
    const NOME_DO_TRANCO: Record<ObstacleKind, string> = {
      barrier: 'BATIDA',
      debris: 'BATIDA',
      pothole: 'BURACO',
      oleo: 'ÓLEO NA PISTA',
      poca: 'POÇA',
    }

    /**
     * Deslocamentos de câmera do quadro. Não existe câmera 3D aqui: o efeito é
     * obtido movendo a projeção inteira. Como pista, marcadores, obstáculos,
     * partículas, fantasma, linha de chegada e carro passam todos por
     * `roadGeometry`, nada consegue descolar do resto — por construção.
     *
     * Tudo é multiplicado pela perspectiva, então o que está perto se move
     * mais do que o horizonte, como em um deslocamento real de câmera.
     */
    const camera = { lift: 0, shake: 0, roll: 0 }

    // Curva e esteira do quadro, entregues à simulação. É um objeto só,
    // reaproveitado, e não um novo a cada quadro: este laço não aloca.
    const raceContext: RaceContext = createRaceContext(layout)

    /** Rumo da pista sob o carro: é dele que sai o giro da paisagem. */
    let rumoAqui = 0
    /** Altura e inclinação sob o carro, referência do relevo neste quadro. */
    let alturaAqui = 0
    let inclinacaoAqui = 0
    /**
     * Rolagem do mundo, em radianos, já suavizada.
     *
     * É o horizonte inclinando para dentro da curva, na proporção da força
     * lateral: nas curvas comuns, dois graus e pouco; num grampo embalado,
     * quase sete. Pseudo-3D nenhum da linhagem de Top Gear e Horizon Chase
     * inclina o horizonte — é o que diz, sem texto nenhum, que aquela curva é
     * outra coisa.
     */
    let rolagem = 0
    /** O quanto o carro deita com a força lateral, em radianos. */
    let deitadaDoCarro = 0
    /** Derrapagem do jogador, de -1 a 1, já suavizada. A de cada rival mora no estado dele. */
    let derrapagemDoJogador = 0

    const roadGeometry = (distanceAhead: number) => {
      const { y, roadWidth, perspective } = roadProjection(distanceAhead, width, height)
      // A pista no referencial do carro: só conta o quanto ela vira dali em
      // diante. É o que deixa uma curva de 180° caber na tela.
      const bend = layout.bendAhead(race.progress, distanceAhead) * width * CURVE_BEND_SCALE
      // O relevo entra pelo mesmo caminho da curva, só que na vertical: o
      // trecho mais alto que o ponto do carro sobe na tela, e a perspectiva
      // faz o efeito sumir no horizonte. Como tudo o que aparece na pista
      // passa por aqui, pista, cenário, obstáculos, partículas, fantasma,
      // chegada e carro sobem e descem juntos — por construção.
      const rise = (layout.elevation(race.progress + distanceAhead) - alturaAqui) * height * SLOPE_RISE_SCALE
      return {
        y: y + (camera.lift + camera.shake - rise) * perspective,
        roadWidth,
        perspective,
        center: width / 2 + bend * (1 - perspective * 0.25) + camera.roll * perspective,
      }
    }

    // O gradiente do céu só muda quando a tela muda de tamanho.
    let ceu: CanvasGradient | null = null
    let ceuAltura = -1
    const gradienteDoCeu = () => {
      if (ceu && ceuAltura === height) return ceu
      ceu = ctx.createLinearGradient(0, 0, 0, height * 0.5)
      ceu.addColorStop(0, ambiente.ceuTopo)
      ceu.addColorStop(0.58, ambiente.ceuMeio)
      ceu.addColorStop(1, ambiente.ceuBaixo)
      ceuAltura = height
      return ceu
    }

    // Névoa do horizonte. Out Run e Top Gear dissolvem o fundo na cor do céu:
    // é isso que separa uma projeção com profundidade de uma chapada, em que
    // o longe aparece nítido e minúsculo. O gradiente é montado uma vez por
    // tamanho de tela, não por quadro.
    let bruma: CanvasGradient | null = null
    let brumaAltura = -1
    const gradienteDaBruma = () => {
      if (bruma && brumaAltura === height) return bruma
      // Começa acima da linha do horizonte porque numa subida a pista passa
      // dela — e a faixa extra cai sobre o céu, que já é desta cor.
      bruma = ctx.createLinearGradient(0, height * (HORIZON_RATIO - 0.1), 0, height * 0.64)
      bruma.addColorStop(0, `rgba(${ambiente.nevoaRGB},.5)`)
      bruma.addColorStop(0.45, `rgba(${ambiente.nevoaRGB},.22)`)
      bruma.addColorStop(1, `rgba(${ambiente.nevoaRGB},0)`)
      brumaAltura = height
      return bruma
    }

    /**
     * Uma cordilheira, do topo da crista até a base do quadro.
     *
     * `onda` e `passo` dão o perfil, `desvio` corre com a curva e `queda`
     * desloca a mesma crista para baixo e para a direita — é desenhando a
     * serra duas vezes, uma clara e outra deslocada por cima, que sobra a
     * lasca acesa na encosta voltada para o sol. Duas chamadas de preenchimento
     * para uma montanha com duas faces.
     */
    const desenharSerra = (
      cor: string, base: number, onda: number, passo: number, fase: number, desvio: number, queda: number,
      margem: number,
    ) => {
      ctx.fillStyle = cor
      ctx.beginPath()
      ctx.moveTo(-margem, height * base + queda)
      for (let x = -margem; x <= width + margem + 40; x += 40) {
        const crista = height * (base + onda * Math.sin((x + desvio) * passo + fase)) + queda
        ctx.lineTo(x, crista)
      }
      // A serra termina onde o chão começa: abaixo disso ele a cobre inteira,
      // e cada faixa pintada por baixo dele é preenchimento jogado fora. Os
      // dois pixels de sobra ficam sob a borda suavizada do chão.
      ctx.lineTo(width + margem + 40, height * 0.38 + 2)
      ctx.lineTo(-margem, height * 0.38 + 2)
      ctx.closePath()
      ctx.fill()
    }

    /**
     * Folga de desenho além da tela, para a rolagem não descobrir os cantos.
     *
     * Girando o mundo em torno do carro, os cantos da tela passam a mostrar o
     * que ficava fora dela. É proporcional à rolagem de agora, e não à máxima,
     * porque cada pixel a mais no céu e na grama é preenchimento pago em todo
     * quadro — e na reta a rolagem é zero.
     */
    const margemDaRolagem = () => Math.ceil(Math.abs(Math.sin(rolagem)) * Math.max(width, height) * 1.1) + 2

    /** Leva x para dentro de [−margem, período − margem): o que sai por um lado volta pelo outro. */
    const envolver = (x: number, periodo: number, margem: number) =>
      ((((x + margem) % periodo) + periodo) % periodo) - margem

    /** Uma nuvem chapada: três bossas e uma aresta acesa em cima. */
    const desenharNuvem = (x: number, y: number, escala: number) => {
      const largura = width * 0.036 * escala
      const altura = largura * 0.34
      ctx.fillStyle = nuvem[2]
      elipse(x, y, largura, altura)
      elipse(x - largura * 0.72, y + altura * 0.22, largura * 0.52, altura * 0.62)
      elipse(x + largura * 0.66, y + altura * 0.26, largura * 0.58, altura * 0.58)
      ctx.fillStyle = nuvem[4]
      elipse(x - largura * 0.16, y - altura * 0.24, largura * 0.62, altura * 0.5)
    }

    /**
     * Posição das nuvens no céu, em fração da tela.
     *
     * Ficam em constante de módulo pelo mesmo motivo de todo o resto: o laço
     * de quadro não pode alocar.
     */
    const NUVENS: readonly (readonly [number, number, number])[] = [
      [0.1, 0.09, 1.1], [0.38, 0.16, 0.7], [0.66, 0.07, 0.95], [0.88, 0.18, 0.8],
    ]

    const drawBackdrop = () => {
      const margem = margemDaRolagem()
      // O céu também para no chão, com a mesma sobra das serras.
      ctx.fillStyle = gradienteDoCeu()
      ctx.fillRect(-margem, -margem, width + margem * 2, height * 0.38 + 2 + margem)

      // A paisagem gira com o rumo do carro. Ela está longe demais para
      // acompanhar a pista, e é esse giro em sentido oposto ao da curva que
      // faz a cena parecer virar. Antes ela corria com o desvio da pista na
      // tela, que tinha teto; agora corre com o rumo, que não tem: um grampo
      // passa o céu inteiro diante do carro, o sol vai para trás dele e volta.
      const desvio = -rumoAqui * width * GIRO_DA_PAISAGEM

      // E descem quando o carro sobe. A câmera acompanha a inclinação da
      // pista, então na subida ela aponta para cima e o que está longe cai na
      // tela — até ficar escondido atrás da própria lomba. É a regra clássica
      // do horizonte reagindo ao relevo.
      const subida = inclinacaoAqui * height * 0.75

      // Sol baixo à esquerda, que é de onde vem a luz de tudo o mais no jogo.
      // Três discos de opacidade decrescente no lugar de um degradê: é o mesmo
      // halo em degraus que o resto do desenho usa. Ele está no infinito, então
      // gira com o rumo por inteiro, e só volta depois de uma volta completa.
      const volta = Math.PI * 2 * width * GIRO_DA_PAISAGEM
      const solX = envolver(width * 0.26 + desvio, volta, height * 0.12)
      const solY = height * 0.23 + subida * 0.5
      ctx.fillStyle = `rgba(${ambiente.nevoaRGB},.05)`
      elipse(solX, solY, height * 0.115, height * 0.115)
      ctx.fillStyle = `rgba(${ambiente.nevoaRGB},.09)`
      elipse(solX, solY, height * 0.068, height * 0.068)
      ctx.fillStyle = `rgba(${ambiente.nevoaRGB},.3)`
      elipse(solX, solY, height * 0.034, height * 0.034)

      // As nuvens correm com a curva, mais devagar que a serra por estarem
      // ainda mais longe. Uma nuvem que sai por um lado volta pelo outro: com
      // o rumo sem teto, sem isso o céu ficaria vazio depois do primeiro grampo.
      // O período é fixo, e não a largura com a folga da rolagem: a folga muda
      // a cada quadro, e com ela todas as nuvens pulariam de lugar.
      for (const [fx, fy, escala] of NUVENS) {
        desenharNuvem(envolver(width * fx + desvio * 0.22, width * 1.6, width * 0.3), height * fy + subida * 0.4, escala)
      }

      // Duas cordilheiras: a de trás mais alta, já lavada pela cor do céu, e a
      // da frente em tom cheio. É a diferença entre as duas que dá fundo ao
      // fundo, em vez de uma silhueta só recortada contra o azul.
      desenharSerra(serraLonge[3], 0.27, 0.05, 0.008, 1.9, desvio * 0.5, subida, margem)
      desenharSerra(serraLonge[1], 0.27, 0.05, 0.008, 1.9, desvio * 0.5, subida + height * 0.018, margem)
      desenharSerra(serra[3], 0.31, 0.035, 0.017, race.progress * 0.0005, desvio, subida, margem)
      desenharSerra(serra[1], 0.31, 0.035, 0.017, race.progress * 0.0005, desvio, subida + height * 0.014, margem)

      ctx.fillStyle = ambiente.chao
      ctx.fillRect(-margem, height * 0.38, width + margem * 2, height * 0.62 + margem)

      // A faixa de meio-campo vem por último, apoiada no chão distante: é o
      // degrau que faltava entre a montanha e a grama. Corre mais depressa que
      // a serra e mais devagar que as árvores da beira, e é essa diferença de
      // velocidade que dá a leitura de camadas. Desenhada a partir de fora da
      // tela, para a rolagem não descobrir o canto.
      ctx.save()
      ctx.translate(-margem, 0)
      desenharFaixaDeFundo(
        ctx, ambiente.lugar, corDaFaixa,
        width + margem * 2, height * 0.4 + subida * 0.8, height * 0.1, desvio * 1.7 - margem,
      )
      ctx.restore()
    }

    /**
     * Distância da fatia, distribuída por escala de tela e não por distância.
     *
     * Com `1/z`, 84 fatias uniformes em distância dariam uma primeira faixa
     * ocupando 11% da altura da tela — e como a cor da listra é decidida por
     * fatia, a faixa junto à câmera saltaria de uma vez só, pulsando. Espaçar
     * por escala dá fatias de altura constante na tela.
     */
    const escalaMinima = CAMERA_DEPTH / (CAMERA_DEPTH + VIEW_DISTANCE)
    const distanciaDaFatia = (fracao: number) => {
      const escala = 1 - fracao * (1 - escalaMinima)
      return CAMERA_DEPTH * (1 / escala - 1)
    }

    /**
     * Quantas fatias a pista tem, e quais delas o recorte deixou visíveis.
     *
     * O vetor é reaproveitado entre quadros: ele é consultado pelo cenário,
     * pelos obstáculos e pelo fantasma para saber se aquela profundidade está
     * atrás de uma lomba.
     */
    const FATIAS = 84
    const fatiaVisivel = new Uint8Array(FATIAS + 1)

    /** Índice da fatia em que uma distância cai. */
    const fatiaDe = (distanceAhead: number) => {
      const escala = CAMERA_DEPTH / (CAMERA_DEPTH + Math.max(0, distanceAhead))
      const fracao = (1 - escala) / (1 - escalaMinima)
      return Math.min(FATIAS, Math.max(0, Math.round(fracao * FATIAS)))
    }

    /** Verdadeiro quando aquela profundidade está escondida atrás de uma lomba. */
    const atrasDaLomba = (distanceAhead: number) => fatiaVisivel[fatiaDe(distanceAhead)] === 0

    /** Faixas do tracejado central, em constante para o laço não alocar. */
    const FAIXAS = [-0.33, 0.33]

    const drawRoad = () => {
      fatiaVisivel.fill(0)
      fatiaVisivel[0] = 1
      const margem = margemDaRolagem()

      // Do perto para o longe, guardando o ponto mais alto já desenhado. Uma
      // fatia que cairia abaixo dele está atrás de uma lomba e some. Sem esse
      // recorte a pista se desenha sobre si mesma na crista — e é ele que
      // permite ao relevo ter amplitude de verdade, em vez de ficar limitado
      // ao que a projeção aguenta sem dobrar.
      //
      // Como cada faixa ocupa a fatia entre a última desenhada e esta, e o
      // recorte garante que elas nunca se sobrepõem, desenhar do perto para o
      // longe não pinta uma por cima da outra.
      let perto = roadGeometry(0)
      let maxy = perto.y

      for (let j = 1; j <= FATIAS; j += 1) {
        const distancia = distanciaDaFatia(j / FATIAS)
        const longe = roadGeometry(distancia)
        if (longe.y >= maxy) continue
        fatiaVisivel[j] = 1

        // A cada 12 m, e não 18: são 5,8 faixas por segundo em cruzeiro em
        // vez de 3,9. É a referência mais barata que existe para o olho medir
        // o avanço, e ela decide também o zebrado e o tracejado das pistas.
        const onde = race.progress + distancia
        const stripe = Math.floor(onde / 12) % 2 === 0
        const superCurva = layout.superCurveAt(onde)

        ctx.fillStyle = stripe ? ambiente.gramaClara : ambiente.gramaEscura
        ctx.fillRect(-margem, longe.y, width + margem * 2, Math.max(1, perto.y - longe.y + 1))

        ctx.fillStyle = stripe ? ambiente.asfaltoClaro : ambiente.asfaltoEscuro
        ctx.beginPath()
        ctx.moveTo(longe.center - longe.roadWidth / 2, longe.y)
        ctx.lineTo(longe.center + longe.roadWidth / 2, longe.y)
        ctx.lineTo(perto.center + perto.roadWidth / 2, perto.y)
        ctx.lineTo(perto.center - perto.roadWidth / 2, perto.y)
        ctx.closePath()
        ctx.fill()

        // Na super curva a zebra engrossa e alterna mais depressa: é a moldura
        // que diz, de longe, que ali a pista é outra.
        const zebraCurta = superCurva ? Math.floor(onde / 4) % 2 === 0 : stripe
        ctx.strokeStyle = zebraCurta ? '#f6f7ee' : '#e84037'
        ctx.lineWidth = Math.max(1, perto.roadWidth * (superCurva ? 0.042 : 0.018))
        ctx.beginPath()
        ctx.moveTo(longe.center - longe.roadWidth / 2, longe.y)
        ctx.lineTo(perto.center - perto.roadWidth / 2, perto.y)
        ctx.moveTo(longe.center + longe.roadWidth / 2, longe.y)
        ctx.lineTo(perto.center + perto.roadWidth / 2, perto.y)
        ctx.stroke()

        // A faixa da tangência: o trecho de dentro, na entrada, pintado de
        // âmbar desde onde a passagem conta até a zebra. É o alvo que a nota de
        // curva manda buscar, e ele precisa ser visto antes de ser alcançado.
        if (superCurva && superCurva.tangency && onde >= superCurva.kerbStart && onde <= superCurva.kerbEnd) {
          const lado = superCurva.side
          const dentroLonge = longe.center + lateralOffset(APEX_LATERAL * lado, longe.roadWidth)
          const dentroPerto = perto.center + lateralOffset(APEX_LATERAL * lado, perto.roadWidth)
          const bordaLonge = longe.center + (lado * longe.roadWidth) / 2
          const bordaPerto = perto.center + (lado * perto.roadWidth) / 2
          ctx.fillStyle = zebraCurta ? 'rgba(255,198,48,.34)' : 'rgba(255,198,48,.2)'
          ctx.beginPath()
          ctx.moveTo(dentroLonge, longe.y)
          ctx.lineTo(bordaLonge, longe.y)
          ctx.lineTo(bordaPerto, perto.y)
          ctx.lineTo(dentroPerto, perto.y)
          ctx.closePath()
          ctx.fill()
          ctx.strokeStyle = zebraCurta ? '#ffc630' : '#ff4b2b'
          ctx.beginPath()
          ctx.moveTo(bordaLonge, longe.y)
          ctx.lineTo(bordaPerto, perto.y)
          ctx.stroke()
        }

        if (stripe) {
          // As duas faixas da mesma fatia entram no mesmo traço: mesma cor,
          // mesma espessura e nunca se tocam, então o resultado é idêntico —
          // com metade das chamadas de traço, que são a operação mais cara
          // do quadro a 2,1 µs cada.
          ctx.strokeStyle = 'rgba(255,255,255,.5)'
          ctx.lineWidth = Math.max(1, perto.roadWidth * 0.008)
          ctx.beginPath()
          for (const lane of FAIXAS) {
            ctx.moveTo(longe.center + longe.roadWidth * lane, longe.y)
            ctx.lineTo(perto.center + perto.roadWidth * lane, perto.y)
          }
          ctx.stroke()
        }

        maxy = longe.y
        perto = longe
      }
    }

    /** Objetos reaproveitados pelo cenário: o laço não pode alocar. */
    const cenario = createSceneryItem()
    const portico = createGantry()

    // Poses reaproveitadas entre quadros, pelo mesmo motivo.
    const poseDoJogador: CarPose = { tilt: 0, suspension: 0, steer: 0, drift: 0, boost: 0, jitter: 0, travel: 0, dirt: 0 }

    /**
     * Pose de cada fantasma, pela identidade do rival.
     *
     * Cada um guarda a última posição lateral, para derivar o esterço dele, e a
     * própria derrapagem suavizada: dividir uma só entre cinco rivais faria o
     * carro de um virar com a curva do outro.
     */
    const posesDosFantasmas = new Map<string, { pose: CarPose; lateral: number; derrapagem: number }>()

    const elipse = (x: number, y: number, rx: number, ry: number) => {
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    const triangulo = (x: number, topo: number, meiaBase: number, altura: number) => {
      ctx.beginPath()
      ctx.moveTo(x, topo)
      ctx.lineTo(x + meiaBase, topo + altura)
      ctx.lineTo(x - meiaBase, topo + altura)
      ctx.closePath()
      ctx.fill()
    }

    /**
     * Placa de seta na beira de fora de uma super curva.
     *
     * É o aviso de Top Gear e Horizon Chase, e o mais antigo das pistas de
     * verdade: uma fila de setas no lado para onde o carro vai ser jogado,
     * apontando para onde a pista vai. Procedural, como a cerca, porque são
     * três retângulos e dois polígonos — e porque a seta muda de sentido com
     * a curva, o que numa folha pedia duas cópias.
     */
    const desenharPlacaDeSeta = (x: number, chao: number, referencia: number, lado: number, sobre = 0) => {
      const largura = referencia * 0.25
      const altura = referencia * 0.13
      const base = chao - sobre - referencia * 0.035
      const topo = base - altura
      // Apoiada no muro, a sombra fica nele; no chão, fica na grama.
      if (sobre === 0) {
        ctx.fillStyle = SOMBRA_NO_CHAO
        ctx.fillRect(x - largura * 0.4, chao, largura * 0.95, Math.max(1, referencia * 0.009))
      }
      chao -= sobre
      // Dois pés escuros, e a placa por cima deles.
      const pe = Math.max(1, largura * 0.05)
      ctx.fillStyle = '#23272c'
      ctx.fillRect(x - largura * 0.32 - pe / 2, base, pe, chao - base)
      ctx.fillRect(x + largura * 0.32 - pe / 2, base, pe, chao - base)
      ctx.fillStyle = '#4a0d0a'
      ctx.fillRect(x - largura / 2, topo, largura, altura)
      const moldura = Math.max(1, altura * 0.09)
      ctx.fillStyle = '#e2362b'
      ctx.fillRect(x - largura / 2 + moldura, topo + moldura, largura - moldura * 2, altura - moldura * 2)
      // Fio aceso em cima: a luz vem de cima, como em todo o resto do jogo.
      ctx.fillStyle = '#ff7a5c'
      ctx.fillRect(x - largura / 2 + moldura, topo + moldura, largura - moldura * 2, Math.max(1, moldura * 0.7))

      // Duas setas em V deitado, apontando para o lado da curva.
      const meio = topo + altura / 2
      const meiaAltura = altura * 0.3
      const abertura = largura * 0.11
      const traco = abertura * 0.55
      ctx.fillStyle = '#f6f7ee'
      for (const deslocamento of [-0.2, 0.16]) {
        const ponta = x + lado * (largura * deslocamento + abertura)
        const costas = x + lado * largura * deslocamento
        ctx.beginPath()
        ctx.moveTo(costas, meio - meiaAltura)
        ctx.lineTo(costas + lado * traco, meio - meiaAltura)
        ctx.lineTo(ponta + lado * traco, meio)
        ctx.lineTo(costas + lado * traco, meio + meiaAltura)
        ctx.lineTo(costas, meio + meiaAltura)
        ctx.lineTo(ponta, meio)
        ctx.closePath()
        ctx.fill()
      }
    }

    /** Um quadrilátero preenchido, a peça de que o muro é feito. */
    const quadrilatero = (
      x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number,
    ) => {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.lineTo(x3, y3)
      ctx.lineTo(x4, y4)
      ctx.closePath()
      ctx.fill()
    }

    /**
     * Um trecho do muro de pneus, de uma vaga à seguinte.
     *
     * Liga as projeções das duas vagas, e não desenha um bloco por vaga: numa
     * curva de 180° duas vagas vizinhas caem longe uma da outra na tela, e blocos
     * soltos virariam uma fila de caixotes. Ligado, o muro acompanha a curva e
     * vira uma parede atravessando a vista quando a pista dobra atrás dele.
     */
    const desenharTrechoDeMuro = (
      x1: number, y1: number, h1: number, x2: number, y2: number, h2: number, indice: number,
    ) => {
      // A base, deitada na grama: é o que assenta o muro no chão.
      ctx.fillStyle = SOMBRA_NO_CHAO
      quadrilatero(x1, y1, x2, y2, x2, y2 + h2 * 0.14, x1, y1 + h1 * 0.14)
      // A face, pintada: vermelho e branco, uma vaga de cada.
      ctx.fillStyle = indice % 2 === 0 ? MURO_VERMELHO : MURO_BRANCO
      quadrilatero(x1, y1, x2, y2, x2, y2 - h2, x1, y1 - h1)
      // As juntas entre as fileiras de pneu, e a de cima em borracha pura.
      ctx.fillStyle = 'rgba(18,20,24,.4)'
      for (const altura of [0.25, 0.47, 0.69]) {
        quadrilatero(
          x1, y1 - h1 * altura, x2, y2 - h2 * altura,
          x2, y2 - h2 * (altura + 0.06), x1, y1 - h1 * (altura + 0.06),
        )
      }
      ctx.fillStyle = MURO_BORRACHA
      quadrilatero(x1, y1 - h1, x2, y2 - h2, x2, y2 - h2 * 0.8, x1, y1 - h1 * 0.8)
    }

    /**
     * Cenário e marcadores de distância, do fundo para a frente.
     *
     * Tudo sai do traçado, que é função pura da semente: o outro piloto vê
     * exatamente as mesmas árvores nos mesmos lugares. O laço percorre índices
     * e preenche sempre o mesmo objeto, sem montar lista nem alocar.
     */
    const drawScenery = () => {
      const ultimo = lastSceneryIndex(race.progress)
      const primeiro = firstSceneryIndex(race.progress)

      // O muro de pneus é contínuo: cada trecho liga esta vaga à anterior, mais
      // distante, e vem antes do que mora nesta vaga — que está mais perto.
      let muroAnterior = false
      let muroX = 0
      let muroY = 0
      let muroAltura = 0
      let muroLado = 0

      for (let indice = ultimo; indice >= primeiro; indice -= 1) {
        const ahead = indice * SCENERY_SPACING - race.progress
        const projetado = roadGeometry(ahead)
        const referencia = projetado.roadWidth

        const curvaDoMuro = layout.wallAt(indice * SCENERY_SPACING)
        let temMuro = false
        if (curvaDoMuro && referencia >= 4 && !atrasDaLomba(ahead)) {
          const lado = -curvaDoMuro.side
          const x = projetado.center + lateralOffset(lado * SUPER_CURVE_WALL, referencia)
          const altura = referencia * ALTURA_DO_MURO
          if (muroAnterior && muroLado === lado) {
            ctx.globalAlpha = Math.min(1, 0.16 + projetado.perspective * 2.6)
            desenharTrechoDeMuro(muroX, muroY, muroAltura, x, projetado.y, altura, indice)
          }
          muroX = x
          muroY = projetado.y
          muroAltura = altura
          muroLado = lado
          temMuro = true
        }
        muroAnterior = temMuro

        // Longe demais para render qualquer coisa legível: sairia um pixel
        // sujo, e sob a bruma nem isso. O corte era 6, e deixava passar
        // objetos de três pixels que custavam a passada inteira do laço.
        if (referencia < 14) continue
        // Atrás de uma lomba não há chão para apoiar nada, e um objeto
        // desenhado aqui flutuaria no céu acima da crista.
        if (atrasDaLomba(ahead)) continue

        // Névoa: o que está longe se dissolve no horizonte em vez de aparecer
        // nítido e minúsculo, que é justamente o que denuncia a projeção falsa.
        const nitidez = Math.min(1, 0.16 + projetado.perspective * 2.6)
        const perto = projetado.perspective > 0.16

        // A única coisa que muda de estado aqui é a opacidade, e ela é
        // reescrita em toda fatia — guardar e devolver o contexto inteiro a
        // cada uma seria pagar caro por nada. É reposta uma vez no fim.
        ctx.globalAlpha = nitidez

        // O pórtico vem antes do que fica na beira desta mesma vaga: ele está
        // atravessando a pista, atrás da árvore que cresce ao lado dela.
        if (indice % GANTRY_EVERY === 0 && layout.gantry(indice, portico)) {
          // A crista esconde o arco inteiro um pouco antes de escondê-lo pela
          // base. Sem a folga, um arco de largura de tela pisca na lomba.
          if (!atrasDaLomba(Math.min(VIEW_DISTANCE - 1, ahead + 8))) {
            desenharPortico(ctx, projetado, portico.variant, nitidez)
          }
        }

        for (const lado of LADOS) {
          if (!layout.scenery(indice, lado, cenario)) continue
          const x = projetado.center + lateralOffset(cenario.lateral, referencia)
          const tamanho = referencia * cenario.scale

          if (cenario.kind === 'fence' || cenario.kind === 'guardrail') {
            /**
             * A cerca é a única família que continua procedural.
             *
             * O vão cobre metade do espaçamento para cada lado, e é assim que
             * as travessas de vagas vizinhas se encontram e a cerca sai
             * contínua. Isso depende das projeções das **duas** vagas, que
             * diferem: assada numa célula por vaga, ela viraria uma fila de
             * portõezinhos soltos.
             */
            const metal = cenario.kind === 'guardrail'
            const tons = metal ? GUARDRAIL : CERCA
            // O guardrail é mais baixo que a cerca e tem uma lâmina só, larga.
            const altura = tamanho * (metal ? 0.042 : 0.058)
            const vao = referencia * 0.055
            const travessa = Math.max(1, altura * (metal ? 0.22 : 0.07))
            const poste = Math.max(1, altura * 0.14)
            ctx.fillStyle = SOMBRA_NO_CHAO
            ctx.fillRect(x - poste * 0.6, projetado.y, poste * 1.8, Math.max(1, travessa * 0.5))
            // As travessas primeiro e o mourão por cima: é assim que o mourão
            // parece estar deste lado da cerca, e não embutido nela.
            const alturas = metal ? [0.86] : [0.94, 0.52]
            for (const parte of alturas) {
              ctx.fillStyle = tons[1]
              ctx.fillRect(x - vao, projetado.y - altura * parte, vao * 2, travessa)
              ctx.fillStyle = tons[3]
              ctx.fillRect(x - vao, projetado.y - altura * parte, vao * 2, Math.max(1, travessa * 0.35))
              if (!metal) continue
              // Vinco central da lâmina, que é o que faz o perfil em W.
              ctx.fillStyle = tons[0]
              ctx.fillRect(x - vao, projetado.y - altura * parte + travessa * 0.45, vao * 2, Math.max(1, travessa * 0.2))
            }
            ctx.fillStyle = tons[2]
            ctx.fillRect(x - poste / 2, projetado.y - altura, poste, altura)
            ctx.fillStyle = tons[4]
            ctx.fillRect(x - poste / 2, projetado.y - altura, Math.max(1, poste * 0.35), altura)
            continue
          }

          // Todo o resto sai da folha, com uma chamada só. A altura de cada
          // família é a mesma de antes; o que mudou é de onde vem o desenho.
          desenharObjeto(
            ctx, cenario.kind, cenario.variant, Math.floor(cenario.tone * 3),
            x, projetado.y, tamanho * ALTURA_DA_FAMILIA[cenario.kind],
          )
        }

        // Placas de seta, por fora da super curva, a cada doze metros. Moram no
        // mesmo laço do cenário para entrar na ordem de profundidade dele.
        // Em cima do muro, onde o piloto olha quando a pista some para o lado.
        const superCurva = indice % 2 === 0 ? layout.superCurveAt(indice * SCENERY_SPACING) : null
        if (superCurva) {
          const lateral = -superCurva.side * SUPER_CURVE_WALL
          desenharPlacaDeSeta(
            projetado.center + lateralOffset(lateral, referencia), projetado.y, referencia, superCurva.side,
            referencia * ALTURA_DO_MURO,
          )
        }

        // Marcador de distância: cai em toda vaga par, porque o espaçamento do
        // cenário é metade do dele. Fica no mesmo laço para a ordem de
        // profundidade valer para tudo o que está na beira da pista.
        if (indice % 2 === 0) {
          const alto = isTallMarker(indice / 2)
          // A caixa do modelo vai do chão ao alto da cabeça, e o poste ocupa
          // 78% dela: dividir devolve ao poste a mesma altura de antes.
          const altura = (referencia * (alto ? 0.2 : 0.115)) / 0.78
          for (const lado of LADOS) {
            const x = projetado.center + lateralOffset(ROADSIDE_LATERAL * lado, referencia)
            desenharObjeto(ctx, 'marcador', alto ? 1 : 0, 0, x, projetado.y, altura)
          }
        }
      }

      // Opacidade reposta uma vez, e não 36 vezes por quadro.
      ctx.globalAlpha = 1
    }

    /**
     * Derrapagem que uma força lateral pede, de -1 a 1.
     *
     * Começa onde a curva comum acaba: até a carga da pior curva comum o pneu
     * ainda aponta o carro para onde ele vai. Passado dela, cada unidade de
     * carga atravessa o carro um pouco mais, até a derrapagem cheia.
     */
    const derrapagemPara = (forca: number) => {
      if (!Number.isFinite(forca)) return 0
      return Math.sign(forca) * Math.max(0, Math.min(1, (Math.abs(forca) - DERRAPAGEM_DE) / DERRAPAGEM_FAIXA))
    }
    const aproximarDerrapagem = (atual: number, alvo: number, dt: number) =>
      atual + (alvo - atual) * (1 - Math.exp(-Math.max(0, dt) / (alvo === 0 ? DERRAPAGEM_SAI : DERRAPAGEM_ENTRA)))

    /**
     * Desenha um fantasma na mesma projeção e com o mesmo modelo do jogador.
     *
     * A pose dele não vem de `feel` — não temos a simulação do rival, só a
     * telemetria — mas sai da mesma grandeza: o quanto ele andou de lado
     * desde o quadro anterior. Cor e transparência continuam sendo dele.
     */
    const drawGhost = (rival: RaceRival, distanceAhead: number, sample: GhostSample, dt: number, etiqueta: string | null, destaque = false) => {
      const { lateral, speed: velocidade } = sample
      const projected = roadGeometry(distanceAhead)
      const x = projected.center + lateralOffset(lateral, projected.roadWidth)
      const scale = Math.max(0.76, width / CAR_SPRITE_REFERENCE_WIDTH) * Math.max(0.06, projected.perspective)

      let estado = posesDosFantasmas.get(rival.id)
      if (!estado) {
        estado = {
          pose: { tilt: 0, suspension: 0, steer: 0, drift: 0, boost: 0, jitter: 0, travel: 0, dirt: 0 },
          lateral,
          derrapagem: 0,
        }
        posesDosFantasmas.set(rival.id, estado)
      }
      const pose = estado.pose
      const deriva = dt > 0 ? (lateral - estado.lateral) / dt : 0
      estado.lateral = lateral
      const volante = Math.max(-1, Math.min(1, deriva / 1.8))
      pose.steer += (volante - pose.steer) * (1 - Math.exp(-Math.max(0, dt) / 0.18))
      pose.travel = race.progress + distanceAhead
      pose.tilt = pose.steer * 0.075 * forcaDoMovimento
      // O rival derrapa pela mesma conta, com a curva do ponto em que ele está e
      // a velocidade que ele informou: não temos a física dele, só a telemetria.
      const proporcaoDoRival = velocidade / race.rules.cruiseSpeed
      const forcaDoRival = curvatureLoad(layout.curvature(race.progress + distanceAhead)) * proporcaoDoRival * proporcaoDoRival
      estado.derrapagem = aproximarDerrapagem(estado.derrapagem, derrapagemPara(forcaDoRival), dt)
      pose.drift = estado.derrapagem

      const semSinal = sample.stale || !rival.connected
      // A chama do boost sai da telemetria: o rival mandou que está de boost, e
      // ela acende no fantasma como acende no nosso carro, pela mesma constante.
      const deBoost = !semSinal && sample.state === 'racing' && sample.boosting === true
      pose.boost += ((deBoost ? 1 : 0) - pose.boost) * (1 - Math.exp(-Math.max(0, dt) / BOOST_TAU))
      const opacidade = opacidadeDoFantasma(distanceAhead, { semSinal, chegou: sample.state === 'finished', destaque })
      drawCar(ctx, x, projected.y, scale, rival.car, pose, opacidade, ambiente.nevoaRGB)
      // A etiqueta sai depois da bruma, para o nome de quem vai longe continuar nítido.
      if (etiqueta) {
        etiquetas.push({ x, chao: projected.y, escala: scale, texto: etiqueta, cor: carById(rival.car).accent, profundidade: distanceAhead, boost: deBoost })
      }
    }

    /** Etiquetas dos fantasmas deste quadro, desenhadas por cima da bruma. */
    const etiquetas: EtiquetaDoFantasma[] = []

    /** Poeira, faíscas, rastro de boost e marcas de pneu, na projeção da pista. */
    const drawParticle = (particle: Particle, distanceAhead: number) => {
      const projected = roadGeometry(distanceAhead)
      const fade = Math.max(0, particle.life / particle.maxLife)
      const x = projected.center + lateralOffset(particle.lateral, projected.roadWidth)
      const scale = Math.max(0.2, projected.perspective)
      const size = particle.size * scale
      const y = projected.y - particle.lift * (1 - fade) * scale

      ctx.save()
      // Um caso por tipo, sem saída padrão. A versão anterior era uma cadeia
      // de `if` com a poeira no `else` do fim: um tipo novo cairia calado em
      // poeira e ninguém ia notar até ver nuvem bege onde devia haver outra
      // coisa. Aqui ele para o compilador.
      switch (particle.kind) {
        case 'skid':
          // A marca escurece o asfalto e vai sumindo, como borracha queimada.
          ctx.globalAlpha = 0.55 * fade
          ctx.fillStyle = particle.tint
          ctx.fillRect(x - size / 2, projected.y, Math.max(1.5, size), Math.max(1.5, size * 0.8))
          break
        case 'spark':
          ctx.globalAlpha = fade
          ctx.fillStyle = fade > 0.5 ? FAISCA_QUENTE : particle.tint
          ctx.translate(x, y)
          ctx.rotate(particle.spin * (particle.maxLife - particle.life))
          ctx.fillRect(-size / 2, -size / 2, size, size)
          break
        case 'boost':
          ctx.globalAlpha = 0.55 * fade
          ctx.fillStyle = particle.tint
          ctx.fillRect(x - size / 2, y, size, Math.max(1, size * 1.6))
          break
        case 'dust':
          ctx.globalAlpha = 0.42 * fade
          ctx.fillStyle = particle.tint
          ctx.beginPath()
          ctx.arc(x, y, Math.max(1, size * (1.4 - fade * 0.6)), 0, Math.PI * 2)
          ctx.fill()
          break
        default:
          particle.kind satisfies never
      }
      ctx.restore()
    }

    /**
     * Rajadas de velocidade no boost.
     *
     * Riscos correndo para fora a partir do ponto de fuga: é o recurso de
     * arcade de sempre para dizer "rápido" sem mexer em nada da física. Só
     * aparecem no boost, nunca no meio da tela — ali tapariam a pista —, e a
     * fase vem dos metros percorridos, não do número do quadro, para a rajada
     * parar quando o carro para e não acelerar quando a taxa de quadros varia.
     */
    const desenharRajadas = (forca: number, percorrido: number) => {
      if (forca <= 0.02) return
      const centroX = width / 2
      const centroY = height * HORIZON_RATIO
      const alcance = Math.hypot(width, height) * 0.62
      const fase = ((percorrido * 0.35) % 1 + 1) % 1
      ctx.save()
      ctx.strokeStyle = '#e9f3ff'
      ctx.lineWidth = Math.max(1, width * 0.002)
      ctx.globalAlpha = 0.2 * forca
      ctx.beginPath()
      for (let i = 0; i < ANGULOS_DE_RAJADA.length; i += 1) {
        const angulo = ANGULOS_DE_RAJADA[i]
        const avanco = (i / ANGULOS_DE_RAJADA.length + fase) % 1
        const dentro = alcance * (0.34 + avanco * 0.58)
        const fora = dentro + alcance * (0.04 + avanco * 0.1)
        const cosseno = Math.cos(angulo)
        const seno = Math.sin(angulo)
        ctx.moveTo(centroX + cosseno * dentro, centroY + seno * dentro)
        ctx.lineTo(centroX + cosseno * fora, centroY + seno * fora)
      }
      ctx.stroke()
      ctx.restore()
    }

    /** Escala de tela do carro, que é a régua de tudo que anda sobre o asfalto. */
    const escalaDoCarro = () => Math.max(0.76, width / CAR_SPRITE_REFERENCE_WIDTH)

    /**
     * Carga vertical do relevo, para a suspensão.
     *
     * Não é a inclinação: subida constante não empurra ninguém para baixo. O
     * que carrega ou alivia a suspensão é a **mudança** de inclinação — o
     * fundo de uma depressão, onde a pista para de descer e começa a subir,
     * comprime; a crista de uma lomba alivia. É por isso que a conta é uma
     * diferença entre dois pontos em volta do carro, e não `layout.slope`
     * lido direto, que já alimenta o fundo e não serviria aqui.
     *
     * A janela é de doze metros para cada lado porque o relevo é montado em
     * trechos de cento e cinquenta e cinco: menor que isso a conta só pega
     * ruído da interpolação, e muito maior atravessa a lomba inteira e sai
     * quase zero justamente onde o efeito deveria ser máximo.
     */
    /**
     * A nota de curva, como a de um copiloto de rali: a próxima super curva,
     * o lado, o tamanho e quanto falta. Some quando a curva termina.
     */
    const notaDaProximaCurva = (): NotaDeCurva | null => {
      const curvas = layout.superCurves
      for (let i = 0; i < curvas.length; i += 1) {
        const curva = curvas[i]
        if (race.progress > curva.end) continue
        const emendada = i + 1 < curvas.length && curvas[i + 1].linked ? curvas[i + 1] : null
        // No S, passado o ápice da primeira metade, a nota já fala da segunda:
        // é hora de deixar o carro abrir e encostar por dentro dela.
        if (emendada && race.progress > curva.apex) continue
        const metros = curva.start - race.progress
        if (metros > ALCANCE_DA_NOTA) return null
        return {
          nome: curva.name,
          graus: Math.round((curva.turn * 180) / Math.PI),
          lado: curva.side,
          metros: Math.max(0, Math.round(metros)),
          dentro: metros <= 0,
          depois: emendada ? emendada.side : 0,
        }
      }
      return null
    }

    const JANELA_DO_RELEVO = 12
    const RELEVO_NA_SUSPENSAO = 34
    const cargaDoRelevo = () => {
      const atras = layout.slope(Math.max(0, race.progress - JANELA_DO_RELEVO))
      const adiante = layout.slope(race.progress + JANELA_DO_RELEVO)
      return ((adiante - atras) / (JANELA_DO_RELEVO * 2)) * RELEVO_NA_SUSPENSAO
    }

    /**
     * Um obstáculo, na régua da pista.
     *
     * O tamanho e o achatamento saem de `roadGeometry`, a mesma projeção que
     * desenha o asfalto, e não mais de uma curva própria: é o que faz o
     * obstáculo encolher com a pista em vez de flutuar sobre ela. Fica sem o
     * banho de opacidade que o cenário recebe ao longe — o piloto precisa ler
     * a barreira a tempo de desviar dela, e a bruma do horizonte, desenhada
     * depois, já a assenta na distância.
     */
    const drawObstacle = (distanceAhead: number, lane: number, kind: ObstacleKind, id: number) => {
      desenharObstaculo(
        ctx, medidasDoObstaculo(kind, lane, distanceAhead, roadGeometry), id, buraco, ambiente.ceuBaixo,
      )
    }

    /** Instante da chegada do próprio piloto, no relógio do servidor. */
    let chegadaDoJogador: number | null = null
    /** Candidato a líder no automático do espectador, e desde quando ele lidera. */
    let novoLider: { id: string; desde: number } | null = null

    /**
     * Quem a câmera do espectador segue neste quadro.
     *
     * A escolha manual vale enquanto o piloto estiver na pista. No automático,
     * a câmera fica com o líder de quem ainda corre, mas só troca depois de o
     * novo líder se firmar na frente: dois carros lado a lado fariam a imagem
     * pular de um para o outro a cada quadro. Quando o seguido cruza a linha, a
     * câmera passa na hora para quem ainda está em prova.
     */
    const escolherSeguido = (amostras: Array<{ rival: RaceRival; sample: GhostSample }>, frame: number): string | null => {
      if (amostras.length === 0) return null
      const manual = seguindoRef.current
      if (!autoLiderRef.current && manual && amostras.some(({ rival }) => rival.id === manual)) return manual
      const lider = liderEmProva(
        classificar(
          amostras.map(({ rival, sample }) => ({
            id: rival.id,
            progress: sample.progress,
            speed: sample.speed,
            state: sample.state,
            chegadaEm: sample.finishedAt ?? null,
          })),
        ),
      )?.id ?? null
      const atual = amostras.find(({ rival }) => rival.id === seguidoIdRef.current)
      if (!atual || lider === null) return lider
      if (lider === atual.rival.id || atual.sample.state === 'finished') {
        novoLider = null
        return lider
      }
      if (novoLider?.id !== lider) novoLider = { id: lider, desde: frame }
      return frame - novoLider.desde > FIRMEZA_DO_LIDER_MS ? lider : atual.rival.id
    }

    const draw = (frame: number) => {
      // Na tela de 120 Hz que não acompanha, um quadro sim, outro não: 60
      // constantes no lugar de 80 a 100 irregulares, com metade do trabalho.
      // O quadro pulado não mexe no relógio da física.
      if (ritmo.pular(frame - ultimoDesenho)) {
        animationFrame = requestAnimationFrame(draw)
        return
      }
      // Mede só com a prova andando: a contagem é outra cena, e comparar uma
      // janela dela com uma da corrida decidiria pelo motivo errado.
      const medindo = startedRef.current && !doneRef.current
      if (medindo && ritmo.registrar(frame - ultimoDesenho, frame) === 'densidade') resize()
      ultimoDesenho = frame
      const serverNow = clockRef.current()
      const dt = (frame - previous) / 1000
      previous = frame
      // Os comandos do quadro, com os toques rápidos que acabaram desde o
      // anterior. Consumidos em todo quadro, até na contagem: um toque dado
      // antes do VAI! não pode sobrar para a largada.
      const entrada = comandosRef.current.consumir()
      const tique = frame - ultimaTela > 80
      if (tique) {
        ultimaTela = frame
        tiquesDaTela += 1
      }

      // Posições dos fantasmas neste quadro, já interpoladas. São lidas antes
      // da simulação porque o rival não é só desenho: a melhor esteira
      // disponível entra no passo de física como ganho de velocidade.
      const rivalSamples: Array<{ rival: RaceRival; sample: GhostSample }> = []
      for (const rival of rivalsRef.current) {
        const sample = rival.ghost.sample(serverNow)
        if (sample) rivalSamples.push({ rival, sample })
      }

      // Na arquibancada não há carro próprio: a câmera assume o lugar de um dos
      // pilotos — quem se escolheu, ou o líder de quem ainda corre — e a pista
      // inteira passa a ser desenhada do ponto de vista dele.
      const noModoEspectador = modeRef.current === 'espectador'
      const seguidoId = noModoEspectador ? escolherSeguido(rivalSamples, frame) : null
      seguidoIdRef.current = seguidoId
      const seguidoAgora = seguidoId ? rivalSamples.find(({ rival }) => rival.id === seguidoId) : undefined
      if (seguidoAgora) {
        race.progress = seguidoAgora.sample.progress
        race.lateral = seguidoAgora.sample.lateral
        race.speed = seguidoAgora.sample.speed
        // O boost de quem a câmera segue acende a chama, o rastro e o som dele.
        race.boosting = seguidoAgora.sample.boosting === true
        race.offRoad = Math.abs(seguidoAgora.sample.lateral) > OFF_ROAD_LIMIT
        carRef.current = seguidoAgora.rival.car
      }

      // A classificação do quadro: dela saem a etiqueta de cada fantasma, a
      // posição no painel e a lista ao vivo. O próprio piloto entra nela com
      // uma identidade que nenhum rival usa.
      const naPista: Array<CarroNaProva & { nome: string; carro: CarId; semSinal: boolean; boost: boolean }> = rivalSamples.map(({ rival, sample }) => ({
        id: rival.id,
        progress: sample.progress,
        speed: sample.speed,
        state: sample.state,
        chegadaEm: sample.finishedAt ?? null,
        nome: rival.name,
        carro: rival.car,
        semSinal: sample.stale || !rival.connected,
        boost: sample.boosting === true && rival.connected,
      }))
      if (modeRef.current === 'online') {
        naPista.push({
          id: ID_DO_JOGADOR,
          progress: race.progress,
          speed: race.speed,
          state: doneRef.current ? 'finished' : 'racing',
          chegadaEm: chegadaDoJogador,
          nome: pilotNameRef.current,
          carro: carRef.current,
          semSinal: false,
          boost: !doneRef.current && motorForte(race),
        })
      }
      const ordem = classificar(naPista)
      const posicaoDe = new Map(ordem.map((carro) => [carro.id, carro.posicao]))
      ordemRef.current = ordem.map((carro) => carro.id)

      // A largada turbo: o juiz também ouve o quadro, que é quem vê as luzes
      // se apagarem com o boost apertado e a janela se fechar sem ele.
      const decisaoDaLargada = noModoEspectador
        ? null
        : juizRef.current.observar(comandosRef.current.segurando('boost'), serverNow - startAt)
      if (decisaoDaLargada) largadaPendenteRef.current = decisaoDaLargada
      const largada = largadaPendenteRef.current
      if (largada && !doneRef.current && !noModoEspectador) {
        largadaPendenteRef.current = null
        aplicarLargada(race, largada)
        analista.registrarLargada(largada)
        gravadorDeEntradas.registrarLargada(largada)
        if (largada.queimou) {
          announce('QUEIMOU A LARGADA!')
          audioRef.current?.beep(196, 0.3)
        } else if (largada.nivel > 0) {
          announce(largada.nivel === 3 ? 'LARGADA PERFEITA!' : largada.nivel === 2 ? 'BOA LARGADA' : 'LARGADA TURBO', 'premio')
          // As notas saem no relógio do áudio, como os bipes da tangência.
          for (let i = 0; i < largada.nivel; i += 1) audioRef.current?.beep(660 * 1.26 ** i, 0.06, i * 0.07)
        }
      }

      // No grid o motor já está ligado: em volta do giro da largada, ou no giro
      // dela com o pé no fundo — o ronco de quem espera as luzes apagarem.
      if (!startedRef.current) {
        audioRef.current?.update({
          speed: 0,
          boost: 0,
          offRoad: 0,
          running: false,
          acelerador: !noModoEspectador && comandosRef.current.segurando('throttle'),
        })
      }

      if (startedRef.current && !doneRef.current) {
        const elapsed = Math.max(0, (serverNow - startAt) / 1000)
        // O que o carro não sabe por si: a curva sob ele e a esteira do rival.
        // A curvatura vem do mesmo traçado que está sendo desenhado, então o
        // empurrão que o piloto sente é o da curva que ele está vendo. Quem já
        // chegou está parado na linha e não deixa mais esteira.
        // O traçado preenche a curva, a linha e a zebra da tangência de uma vez.
        layout.fillContext(race.progress, raceContext)
        raceContext.slipstream = rivalSamples.reduce(
          (melhor, { rival, sample }) =>
            sample.state === 'racing' && !rival.semVacuo
              ? Math.max(melhor, slipstreamFrom(race.progress, race.lateral, sample.progress, sample.lateral))
              : melhor,
          0,
        )
        // A física recebe o passo arredondado ao microssegundo, o mesmo que vai
        // no registro: é o que deixa o servidor refazer a volta passo a passo.
        const passoDaFisica = quantizarPasso(dt)
        // O relógio da prova anda mesmo com a aba escondida; a física, não.
        const salto = ultimoTempoDeProva === null ? 0 : elapsed - ultimoTempoDeProva - passoDaFisica
        ultimoTempoDeProva = elapsed
        // Quem assiste não pilota: a física é a do carro seguido, que chega pela
        // telemetria. O resto do quadro — câmera, som, efeitos, painel — segue igual.
        // O quadro inteiro vai à física, em passos iguais de até 0,05 s: o
        // celular lento não pode andar menos que o relógio. O servidor refaz a
        // volta pelo mesmo caminho, com o mesmo passo registrado.
        if (!noModoEspectador) gravadorDeEntradas.registrar(passoDaFisica, entrada, salto > 0.1 ? salto : 0)
        const eventosDoQuadro = noModoEspectador ? [] : advanceRace(race, entrada, passoDaFisica, raceContext)
        if (!noModoEspectador) {
          ultimoPassoRef.current = performance.now()
          // O analista e o gravador leem o quadro antes dos avisos: a chegada
          // fecha a análise e a volta gravada no mesmo quadro em que acontece.
          analista.observar(race, eventosDoQuadro, Math.min(passoDaFisica, MAX_FRAME_SECONDS), elapsed)
          gravador.gravar(elapsed * 1000, race)
          anunciarParcial(elapsed)
        }
        for (const event of eventosDoQuadro) {
          if (event.type === 'collision') {
            const kind = race.rules.obstacles.find((o) => o.id === event.obstacleId)?.kind ?? 'barrier'
            // A batida conta para o reset, e o piloto precisa ver a conta antes
            // de ela cobrar: "BATIDA 2 DE 3" avisa que a próxima para o carro.
            // Na batida que já resetou, quem fala é o aviso do reset.
            if (race.resetting === 0) {
              announce(
                HIT_IS_CRASH[kind]
                  ? `${NOME_DO_TRANCO[kind]} ${race.strikes} DE ${RESET_STRIKES}`
                  : `${NOME_DO_TRANCO[kind]} — VELOCIDADE REDUZIDA`,
              )
            }
            audioRef.current?.impact(0.6 + feel.speed * 0.4)
            // As faíscas saltam à frente do bico, onde a batida aconteceu.
            // Quanto mais rápido o carro estava, mais faíscas saltam.
            const faiscas = Math.round(8 + feel.speed * 10)
            effects.burst('spark', faiscas, race.progress + CAR_VIEW_DISTANCE + 5, race.lateral, {
              drift: 1.4 + feel.speed,
              life: 0.35 + feel.speed * 0.25,
            })
            registerImpact(feel)
          }
          if (event.type === 'wall') {
            // O muro é batida, e o aviso diz isso junto da conta do reset. Na
            // batida que já resetou, quem fala é o aviso do reset.
            if (race.resetting === 0) announce(`MURO! BATIDA ${race.strikes} DE ${RESET_STRIKES}`)
            audioRef.current?.impact(0.8 + feel.speed * 0.2)
            const lado = raceContext.wallSide ?? 0
            effects.burst('spark', Math.round(16 + feel.speed * 14), race.progress + CAR_VIEW_DISTANCE + 4, race.lateral + lado * (CAR_HALF_LATERAL + 0.06), {
              drift: 1.6 + feel.speed,
              life: 0.45 + feel.speed * 0.3,
            })
            registerImpact(feel)
          }
          if (event.type === 'apex') {
            // A tangência é o maior prêmio da pista: aparece por cima de tudo,
            // e some sozinha, sem disputar com os avisos de batida.
            setUltimaTangencia({ boost: event.boost, sequencia: event.sequencia })
            setTangencias((vezes) => vezes + 1)
            // Dois bipes subindo: o som de acerto, o oposto do tranco da batida.
            // Na sequência, o segundo sobe mais: o ouvido acompanha a conta. Ele
            // sai no relógio do áudio, 80 ms exatos depois: num temporizador, o
            // celular lento o atrasaria um quadro ou mais.
            audioRef.current?.beep(880, 0.07)
            audioRef.current?.beep(1_320 * 1.12 ** Math.min(event.sequencia - 1, 2), 0.1, 0.08)
          }
          if (event.type === 'carga') {
            // Cada nível da carga tem a sua nota, subindo: dá para carregar de
            // ouvido, sem tirar o olho da curva.
            audioRef.current?.beep([0, 660, 880, 1_175][event.nivel] ?? 1_175, 0.05)
          }
          if (event.type === 'miniTurbo') {
            if (event.nivel >= 2) announce(`MINI-TURBO ${'I'.repeat(event.nivel)}`, 'premio')
            audioRef.current?.beep(520 + event.nivel * 180, 0.09)
            // O estouro sai das rodas de trás, na cor do nível que disparou.
            effects.burst('spark', 4 + event.nivel * 4, race.progress + CAR_VIEW_DISTANCE - TRAIL_SETBACK, race.lateral, {
              drift: 1,
              life: 0.3,
              tint: COR_DA_CARGA[event.nivel],
            })
          }
          if (event.type === 'troca') {
            // A troca perfeita é prêmio: o aviso do lado dos prêmios, a
            // etiqueta ao lado da marcha e duas notas subindo, a segunda mais
            // alta na sequência — dá para acertar a largada inteira de ouvido.
            if (event.qualidade === 'perfeita') {
              setTrocaPerfeita({ sequencia: event.sequencia, vez: frame })
              audioRef.current?.beep(1_046, 0.05)
              audioRef.current?.beep(1_568 * 1.06 ** Math.min(event.sequencia - 1, 5), 0.07, 0.05)
            }
            if (NOTA_DA_TROCA[event.qualidade]) setNotaDaTroca({ qualidade: event.qualidade, vez: frame })
          }
          if (event.type === 'reducaoNegada') {
            setNotaDaTroca({ qualidade: 'negada', vez: frame })
            audioRef.current?.beep(220, 0.05)
          }
          if (event.type === 'raspao') {
            announce(`RASPÃO +${RASPAO_BOOST}%`, 'premio')
            audioRef.current?.beep(1_480, 0.04)
          }
          if (event.type === 'reset') {
            setMotivoDoReset(event.reason)
            setFlash(null)
            audioRef.current?.impact(0.9)
            registerImpact(feel)
            // O reset põe o carro parado no meio da pista: a poeira e as marcas
            // de antes ficam onde estavam, na grama.
          }
          if (event.type === 'finish') {
            doneRef.current = true
            chegadaDoJogador = serverNow
            setPhase('finished')
            audioRef.current?.update({ speed: 0, boost: 0, offRoad: 0, running: false })
            audioRef.current?.stopMusic()
            const result: RaceResult = {
              time: elapsed,
              // O easter egg é secreto: nenhum número mostra a velocidade a mais.
              topSpeed: race.topSpeed / race.rules.turbo,
              collisions: race.collisions,
              lateStart: lateAtStart,
              analise: analista.resultado(),
              gravacao: gravador.terminar(elapsed * 1000, race),
              dispositivo: dispositivoRef.current,
              entradas: gravadorDeEntradas.terminar(),
            }
            setTelemetry((current) => ({ ...current, progress: TRACK_LENGTH, elapsed, speed: 0 }))
            // O rival precisa saber imediatamente que o carro parou na chegada.
            sendTelemetryRef.current?.({
              t: serverNow,
              progress: race.progress,
              lateral: race.lateral,
              speed: 0,
              state: 'finished',
              boosting: false,
            })
            flashTimers.push(window.setTimeout(() => finishRef.current(result), 850))
          }
        }

        // Efeitos nascem onde o carro aparece na tela e descem junto com a pista.
        // A cadência segue o passo que a simulação aplicou, e não o tempo do
        // quadro: um quadro longo não pode virar uma rajada de poeira.
        const passo = Math.min(Math.max(0, dt), MAX_STEP_SECONDS)
        updateFeel(feel, race, passo)

        // O som lê as mesmas intensidades que a imagem: motor, vento e
        // cascalho saem de `feel`, não de uma segunda leitura da corrida.
        // Com carro próprio, o motor segue o câmbio da física: a marcha, o giro,
        // o pé e o corte. Parado no reset ou afogado, o motor fica na primeira,
        // com a embreagem no ponto. Na arquibancada, só a velocidade é conhecida.
        const parado = race.resetting > 0 || race.afogado > 0
        audioRef.current?.update(
          noModoEspectador
            ? { speed: feel.speed, boost: feel.boost, offRoad: feel.offRoad, running: true }
            : {
                speed: feel.speed,
                boost: feel.boost,
                offRoad: feel.offRoad,
                running: true,
                marcha: parado ? 0 : race.marcha,
                giro: parado ? 0 : race.giro,
                acelerador: race.acelerando,
                freando: race.freando,
                noCorte: race.noCorte > 0,
              },
        )

        // A câmera baixa um pouco com a velocidade, inclina no esterço e leva
        // um tranco curto no impacto. Tudo contínuo, limitado e proporcional
        // à tela, para não atrapalhar a leitura nem os controles de toque.
        const segundos = frame / 1000
        const vibracao = Math.pow(feel.speed, 4) * Math.sin(segundos * 37) * height * 0.0022
        const tranco = feel.impact * Math.sin(segundos * 46) * height * 0.022
        camera.lift = feel.speed * height * 0.016 * forcaDoMovimento
        camera.shake = (vibracao + tranco) * forcaDoMovimento
        camera.roll = -feel.steer * width * 0.014 * forcaDoMovimento

        // O horizonte inclina para dentro da curva, na proporção da força
        // lateral que ela impõe naquela velocidade. Lida um pouco à frente do
        // carro, para a inclinação começar na entrada, e não no meio.
        const proporcao = race.speed / race.rules.cruiseSpeed
        const forcaLateral = curvatureLoad(layout.curvature(race.progress + 6)) * proporcao * proporcao
        const comum = Math.max(-1, Math.min(1, forcaLateral)) * ROLAGEM_POR_CARGA
        const alem = Math.sign(forcaLateral) * Math.max(0, Math.abs(forcaLateral) - 1) * ROLAGEM_ALEM_DA_COMUM
        const inclinacao = Math.max(-ROLAGEM_MAXIMA, Math.min(ROLAGEM_MAXIMA, comum + alem))
        // O carro deita junto, no mesmo sentido do volante: é o exagero de
        // arcade, que diz a força da curva no próprio carro.
        deitadaDoCarro = Math.max(-0.08, Math.min(0.08, forcaLateral * 0.03)) * forcaDoMovimento
        // E atravessa: passada a carga da pior curva comum, a traseira escapa e a
        // folha anda para os quadros de derrapagem. Entra e sai com inércia, e é
        // essa inércia que faz a troca de quadros virar movimento.
        derrapagemDoJogador = aproximarDerrapagem(derrapagemDoJogador, derrapagemPara(forcaLateral), passo)
        // Curva à direita gira o mundo no sentido anti-horário: o horizonte
        // sobe do lado para onde a pista vai, como numa curva inclinada.
        rolagem += (-inclinacao * forcaDoMovimento - rolagem) * (1 - Math.exp(-passo / ROLAGEM_TAU))

        // Os efeitos saem de trás das rodas, e não do centro: nascendo sob o
        // carro, o próprio sprite os esconderia por toda a vida útil.
        const rastro = race.progress + CAR_VIEW_DISTANCE - TRAIL_SETBACK

        // A intensidade dos efeitos acompanha a velocidade e o quanto o carro
        // se afastou do asfalto, em vez de ligar e desligar por estado.
        const forcaPoeira = 0.3 + feel.speed * 0.9 + feel.offRoad * 0.4
        for (let i = dustRate.take(passo, race.offRoad, forcaPoeira); i > 0; i -= 1) {
          const roda = Math.random() < 0.5 ? -1 : 1
          effects.spawn('dust', rastro, race.lateral + roda * (WHEEL_OFFSET + Math.random() * 0.08), {
            drift: roda * (0.2 + Math.random() * 0.5) * (0.5 + feel.speed),
            size: (6 + Math.random() * 6) * (0.7 + feel.speed * 0.6),
            life: 0.5 + feel.speed * 0.35,
            tint: poeira,
          })
        }

        // Faíscas da carga, das rodas de trás, na cor e no tamanho do nível:
        // azul, laranja e roxo, cada um maior que o anterior, para o nível
        // ler também por quem não distingue as cores.
        for (let i = cargaRate.take(passo, race.carga > 0, 0.4 + race.nivelCarga * 0.3); i > 0; i -= 1) {
          const roda = Math.random() < 0.5 ? -1 : 1
          effects.spawn('spark', rastro, race.lateral + roda * WHEEL_OFFSET, {
            drift: -race.ladoDaCarga * (0.4 + Math.random() * 0.6),
            size: 2 + race.nivelCarga * 1.6 + Math.random() * 1.5,
            life: 0.18 + race.nivelCarga * 0.05,
            tint: COR_DA_CARGA[race.nivelCarga],
          })
        }

        for (let i = boostRate.take(passo, motorForte(race), feel.boost); i > 0; i -= 1) {
          const roda = Math.random() < 0.5 ? -1 : 1
          effects.spawn('boost', rastro, race.lateral + roda * WHEEL_OFFSET, {
            size: 6 + feel.boost * 4,
            life: 0.25 + feel.boost * 0.2,
          })
        }

        // A marca de pneu acompanha o esforço lateral que a simulação mediu, e
        // não um "velocidade > X e lateral > Y" — que era justamente o tipo de
        // corte binário que fazia o efeito piscar ao cruzar o limite.
        // A carga da curva entra junto: no limite de aderência o pneu raspa, e
        // é esse o retorno visual de que a curva está cobrando a velocidade
        // escolhida. Começa onde o pneu começa a escapar, não antes.
        const limiar = race.rules.cornerGrip
        const raspagem = Math.max(0, (feel.corner - limiar) / (1 - limiar))
        const forcaDerrapagem = Math.max(feel.offRoad, feel.strain, raspagem, race.penalty > 0 ? 1 : 0)
        for (let i = skidRate.take(passo, forcaDerrapagem > 0.05, forcaDerrapagem); i > 0; i -= 1) {
          for (const roda of [-1, 1]) {
            effects.spawn('skid', rastro, race.lateral + roda * WHEEL_OFFSET, {
              size: 5 + forcaDerrapagem * 3,
            })
          }
        }

        // Raspando no muro, o carro solta faísca do lado dele a cada instante —
        // atrás da roda e já do lado de fora, senão o próprio carro a esconde.
        const ladoDoMuro = raceContext.wallSide ?? 0
        for (let i = wallRate.take(passo, race.onWall, 1); i > 0; i -= 1) {
          effects.spawn('spark', rastro - Math.random() * 2, race.lateral + ladoDoMuro * (CAR_HALF_LATERAL + 0.06), {
            drift: -ladoDoMuro * (0.6 + Math.random()),
            size: 3 + Math.random() * 3,
            life: 0.25 + Math.random() * 0.2,
          })
        }

        // Fumaça de pneu: só a super curva passa da carga que a curva comum
        // mais fechada impõe, e é ali que o pneu queima. No asfalto, porque na
        // grama o que sobe é poeira, e ela já tem o próprio efeito.
        const excessoDeCarga = Math.abs(raceContext.curvature) * proporcao * proporcao - 1
        const forcaFumaca = race.offRoad || race.resetting > 0 ? 0 : Math.min(1, excessoDeCarga)
        for (let i = smokeRate.take(passo, forcaFumaca > 0.05, forcaFumaca); i > 0; i -= 1) {
          // A roda de fora é a que carrega o peso, e a que mais fumaça.
          const fora = raceContext.curvature > 0 ? -1 : 1
          const roda = Math.random() < 0.7 ? fora : -fora
          effects.spawn('dust', rastro, race.lateral + roda * (WHEEL_OFFSET + Math.random() * 0.06), {
            drift: fora * (0.3 + Math.random() * 0.5),
            size: (9 + Math.random() * 8) * (0.6 + forcaFumaca * 0.6),
            life: 0.55 + forcaFumaca * 0.4,
            tint: FUMACA_DE_PNEU,
          })
        }

        if (tique) {
          setTelemetry({
            progress: race.progress,
            speed: race.speed / race.rules.turbo,
            boost: race.boost,
            elapsed,
            offRoad: race.offRoad,
            penalty: race.penalty,
            boosting: race.boosting,
            boostLocked: race.boostLocked,
            grip: race.grip,
            slipstream: feel.slipstream,
            strikes: race.strikes,
            offTrack: race.offTrack,
            resetting: race.resetting,
            resets: race.resets,
            nota: notaDaProximaCurva(),
            carga: race.carga,
            nivelCarga: race.nivelCarga,
            impulso: race.impulso > 0,
            delta: deltaParaORecorde(race.progress, elapsed),
            noCorte: race.noCorte,
            acelerando: race.acelerando,
          })
        }
      }

      if (!noModoEspectador) pintarCambio()

      // A simulação já avançou: a partir daqui o quadro inteiro usa o mesmo
      // progresso, e portanto a mesma curva de referência.
      rumoAqui = layout.drawnHeading(race.progress)
      alturaAqui = layout.elevation(race.progress)
      inclinacaoAqui = layout.slope(race.progress)

      // O mundo inteiro gira em torno do ponto em que o carro toca a pista —
      // céu, pista, cenário, fantasma, efeitos e o próprio carro. O HUD fica
      // de fora, e continua reto: quem inclina é a câmera, não a tela.
      ctx.save()
      if (rolagem !== 0) {
        const pivoY = roadProjection(CAR_VIEW_DISTANCE, width, height).y
        ctx.translate(width / 2, pivoY)
        ctx.rotate(rolagem)
        ctx.translate(-width / 2, -pivoY)
      }

      drawBackdrop()
      drawRoad()
      drawScenery()

      // As marcas de pneu ficam no asfalto, abaixo de tudo o que corre na pista.
      effects.update(Math.min(Math.max(0, dt), MAX_STEP_SECONDS), race.progress)
      const efeitos = effects.visible(race.progress)
      for (const particula of efeitos) {
        if (particula.kind === 'skid') drawParticle(particula, particula.distance - race.progress)
      }

      // Profundidade de cada fantasma a partir da câmera. O carro de quem mandou
      // a telemetria fica CAR_VIEW_DISTANCE à frente da câmera dele, como o
      // nosso: um rival lado a lado aparece ao lado do carro, e não embaixo da
      // câmera, e quem vem colado atrás ainda aparece, por cima do nosso.
      etiquetas.length = 0
      const fantasmas = rivalSamples
        .filter(({ rival }) => rival.id !== seguidoId)
        .map(({ rival, sample }) => ({ rival, sample, ahead: sample.progress - race.progress + CAR_VIEW_DISTANCE }))
      const fantasmasVisiveis = fantasmas
        .filter(({ ahead }) => ahead >= CAR_VIEW_DISTANCE && ahead < VIEW_DISTANCE && !atrasDaLomba(ahead))
        .sort((a, b) => b.ahead - a.ahead)
      const fantasmasColados = fantasmas
        .filter(({ ahead }) => ahead > PROFUNDIDADE_MINIMA_DO_FANTASMA && ahead < CAR_VIEW_DISTANCE)
        .sort((a, b) => b.ahead - a.ahead)
      // A hierarquia vale para os que estão à vista, à frente: os colados atrás
      // passam por cima do nosso carro e continuam translúcidos, sem etiqueta.
      const hierarquia = hierarquiaDosFantasmas(
        fantasmasVisiveis.map(({ rival, ahead }) => ({ id: rival.id, distancia: ahead - CAR_VIEW_DISTANCE, recorde: rival.semVacuo === true })),
      )
      const destaqueDe = (rival: RaceRival) => hierarquia.get(rival.id)?.destaque ?? false
      const etiquetaDe = (rival: RaceRival) => {
        if (rival.semVacuo) return nomeDaEtiqueta(rival.name)
        const posicao = `P${posicaoDe.get(rival.id) ?? '?'}`
        return hierarquia.get(rival.id)?.comNome === false ? posicao : `${posicao} ${nomeDaEtiqueta(rival.name)}`
      }

      // Os obstáculos já estão em ordem de distância, então basta percorrer do
      // fim para o começo — do mais distante para o mais próximo — sem montar
      // lista nova a cada quadro. Os fantasmas entram na ordem de profundidade.
      let proximoFantasma = 0
      const pedras = race.rules.obstacles
      for (let indice = pedras.length - 1; indice >= 0; indice -= 1) {
        const obstaculo = pedras[indice]
        const ahead = obstaculo.distance - race.progress
        if (ahead <= 0 || ahead >= VIEW_DISTANCE) continue
        if (atrasDaLomba(ahead)) continue

        while (fantasmasVisiveis[proximoFantasma]?.ahead > ahead) {
          const fantasma = fantasmasVisiveis[proximoFantasma]
          drawGhost(fantasma.rival, fantasma.ahead, fantasma.sample, dt, etiquetaDe(fantasma.rival), destaqueDe(fantasma.rival))
          proximoFantasma += 1
        }
        drawObstacle(ahead, obstaculo.lane, obstaculo.kind, obstaculo.id)
      }
      while (proximoFantasma < fantasmasVisiveis.length) {
        const fantasma = fantasmasVisiveis[proximoFantasma]
        drawGhost(fantasma.rival, fantasma.ahead, fantasma.sample, dt, etiquetaDe(fantasma.rival), destaqueDe(fantasma.rival))
        proximoFantasma += 1
      }

      // O painel fala do rival mais perto, à frente ou atrás: é com ele que se
      // disputa a posição naquele trecho. A posição conta todos os que estão à
      // frente.
      if (tique) {
        const maisProximo = rivalSamples.reduce<(typeof rivalSamples)[number] | null>((atual, candidato) => {
          if (!atual) return candidato
          return Math.abs(candidato.sample.progress - race.progress) < Math.abs(atual.sample.progress - race.progress)
            ? candidato
            : atual
        }, null)
        if (!maisProximo) {
          setRival(null)
        } else {
          const gap = gapBetween(race.progress, maisProximo.sample.progress, race.speed, maisProximo.sample.speed)
          // A mesma posição da lista ao vivo: quem já chegou conta pela ordem de chegada.
          const position = `P${posicaoDe.get(ID_DO_JOGADOR) ?? 1 + rivalSamples.filter(({ sample }) => sample.progress > race.progress).length}`
          const visivel = [...fantasmasVisiveis, ...fantasmasColados].some(({ rival }) => rival.id === maisProximo.rival.id)
          const direcao = gap.ahead ? 'à frente' : 'atrás'
          setRival({
            position,
            name: maisProximo.rival.name,
            connected: maisProximo.rival.connected,
            headline: `${Math.max(0.1, gap.seconds).toFixed(1).replace('.', ',')} s ${direcao}`,
            offScreen: visivel ? null : offScreenNotice(gap, rivalSide(race.lateral, maisProximo.sample.lateral)),
            stale: maisProximo.sample.stale,
            finished: maisProximo.sample.state === 'finished',
            onScreen: visivel,
            boosting: maisProximo.sample.boosting === true && maisProximo.rival.connected,
          })
        }
      }

      // A lista ao vivo, a cada dois tiques: mais do que isso só gasta React.
      if (tique && tiquesDaTela % 2 === 0 && (ordem.length > 0 || !painelVazio)) {
        painelVazio = ordem.length === 0
        const referencia = ordem.find((carro) => carro.id === (noModoEspectador ? seguidoId : ID_DO_JOGADOR)) ?? null
        setPainel(
          ordem.map((carro) => ({
            id: carro.id,
            nome: carro.nome,
            carro: carro.carro,
            posicao: carro.posicao,
            diferenca: referencia && carro.id !== referencia.id ? diferencaEmSegundos(referencia, carro) : null,
            chegou: carro.state === 'finished',
            semSinal: carro.semSinal,
            destaque: carro.id === referencia?.id,
            fracao: Math.min(1, carro.progress / TRACK_LENGTH),
            boost: carro.boost && carro.state === 'racing',
          })),
        )
        if (noModoEspectador) {
          const alvo = ordem.find((carro) => carro.id === seguidoId)
          setSeguido(
            alvo
              ? { id: alvo.id, nome: alvo.nome, carro: alvo.carro, posicao: alvo.posicao, velocidade: alvo.speed, chegou: alvo.state === 'finished' }
              : null,
          )
        }
      }

      /**
       * A linha de chegada.
       *
       * Era doze células num retângulo de cinco pixels — a superfície mais
       * pobre do jogo, no momento que mais importa dele. Agora é uma
       * estrutura: duas fileiras de quadriculado com espessura no asfalto, e o
       * pórtico por cima, que é o que se enxerga de longe e o que diz onde a
       * prova acaba.
       */
      const ateAChegada = TRACK_LENGTH - race.progress
      if (ateAChegada < VIEW_DISTANCE && !atrasDaLomba(ateAChegada)) {
        const finish = roadGeometry(ateAChegada)
        const espessura = Math.max(3, finish.roadWidth * 0.026)
        const casas = 14
        const passo = finish.roadWidth / casas
        const esquerda = finish.center - finish.roadWidth / 2
        // Duas fileiras defasadas: é a espessura que tira a chegada de uma
        // listra pintada e a põe deitada no asfalto.
        for (let fileira = 0; fileira < 2; fileira += 1) {
          for (let i = 0; i < casas; i += 1) {
            ctx.fillStyle = (i + fileira) % 2 === 0 ? '#f3f3ed' : '#11151a'
            ctx.fillRect(esquerda + i * passo, finish.y + fileira * espessura, passo + 1, espessura + 1)
          }
        }
        desenharPortico(ctx, finish, 0, 1, true)
      }

      // A bruma entra depois de tudo que tem profundidade — pista, cenário,
      // obstáculos, fantasma e chegada — e antes do carro e dos efeitos dele,
      // que estão sempre perto da câmera e continuam nítidos.
      ctx.fillStyle = gradienteDaBruma()
      const margemDaBruma = margemDaRolagem()
      ctx.fillRect(-margemDaBruma, height * (HORIZON_RATIO - 0.1), width + margemDaBruma * 2, height * 0.75 - height * HORIZON_RATIO)
      desenharEtiquetasDosFantasmas(ctx, etiquetas)

      // Poeira, faíscas e rastro de boost passam por cima da pista e dos carros.
      for (const particula of efeitos) {
        if (particula.kind !== 'skid') drawParticle(particula, particula.distance - race.progress)
      }

      // O carro usa a mesma projeção da pista, dos obstáculos e do fantasma.
      // Assim ele acompanha a curva e a borda do asfalto significa a mesma
      // coisa para o desenho e para a regra de sair da pista.
      const ondeEstaOCarro = roadGeometry(CAR_VIEW_DISTANCE)
      const playerX = ondeEstaOCarro.center + lateralOffset(race.lateral, ondeEstaOCarro.roadWidth)
      if (!doneRef.current) {
        // A pose inteira sai de `feel`, que só lê a simulação: o corpo inclina
        // no esterço, a suspensão reage à arrancada e ao impacto, as rodas da
        // frente seguem o volante e a carroceria treme na grama. Quem pediu
        // menos movimento recebe tudo isso — inclusive o rolamento do pneu —
        // no quarto da intensidade.
        // A rolagem tem duas parcelas: a de regime, que segue o volante, e a
        // transferência de peso do giro — quando o volante é jogado depressa,
        // a carroceria passa do ponto antes de assentar. `steerRate` traz a
        // pressa e `steer` traz o lado, e é por isso que os dois se
        // multiplicam em vez de somar.
        poseDoJogador.tilt =
          (feel.steer * 0.075 + feel.steer * feel.steerRate * 0.02) * forcaDoMovimento + deitadaDoCarro
        poseDoJogador.suspension =
          (feel.accel * 0.05 - feel.impact * 0.1 + cargaDoRelevo() * feel.speed) * forcaDoMovimento
        poseDoJogador.steer = feel.steer * forcaDoMovimento
        poseDoJogador.drift = derrapagemDoJogador
        poseDoJogador.boost = feel.boost
        // Freando, a luz de chuva pisca quatro vezes por segundo — a de um
        // Fórmula 1 recuperando energia. Na arquibancada não se sabe quem freia.
        poseDoJogador.freio = race.freando && !noModoEspectador ? (Math.floor(frame / 125) % 2 === 0 ? 1 : 0.2) : 0
        poseDoJogador.travel = race.progress * forcaDoMovimento
        poseDoJogador.dirt = feel.dirt
        // Três tremores, com frequências separadas para não virarem um só: a
        // grama, o tranco da batida e o carro no limite de aderência. O do
        // limite é o mais rápido e o menor — é vibração, não solavanco.
        poseDoJogador.jitter =
          (feel.offRoad * Math.sin(frame * 0.055) * 1.6 +
            feel.impact * Math.sin(frame * 0.085) * 2.4 +
            feel.strain * Math.sin(frame * 0.21) * 0.7) *
          forcaDoMovimento
        // Parado no reset, o carro pisca: é o sinal universal de "fora do jogo
        // por um instante". Quem pediu menos movimento vê o carro translúcido,
        // sem piscar.
        if (race.resetting > 0) {
          const aceso = Math.floor(race.resetting * 8) % 2 === 0
          ctx.globalAlpha = forcaDoMovimento < 1 ? 0.5 : aceso ? 0.95 : 0.25
        }
        drawCar(
          ctx,
          playerX,
          ondeEstaOCarro.y,
          escalaDoCarro(),
          carRef.current,
          poseDoJogador,
          1,
          ambiente.nevoaRGB,
        )
        ctx.globalAlpha = 1
      }
      for (const fantasma of fantasmasColados) drawGhost(fantasma.rival, fantasma.ahead, fantasma.sample, dt, null)

      // Quem vem atrás, fora da vista da câmera: vira seta no radar, na coluna
      // em que vem, logo abaixo do carro.
      const radar: RivalAtras[] = []
      for (const { rival, sample, ahead } of fantasmas) {
        const atras = CAR_VIEW_DISTANCE - ahead
        if (ahead > PROFUNDIDADE_MINIMA_DO_FANTASMA || atras > ALCANCE_DO_RADAR_M || sample.state === 'finished') continue
        radar.push({
          x: ondeEstaOCarro.center + lateralOffset(sample.lateral, ondeEstaOCarro.roadWidth),
          distancia: atras,
          nome: nomeDaEtiqueta(rival.name),
          cor: carById(rival.car).accent,
        })
      }
      // Fim do mundo girado: dali em diante é tela.
      ctx.restore()
      // O radar é de quem pilota: na arquibancada, a classificação já diz quem
      // vem atrás, e o painel da câmera ocupa a base da tela.
      if (startedRef.current && !noModoEspectador) {
        desenharRadarTraseiro(ctx, radar, width, ondeEstaOCarro.y + RODAS_ABAIXO_DO_CHAO * escalaDoCarro() + 10)
      }

      desenharRajadas(feel.boost * forcaDoMovimento, race.progress)

      // O aviso de fora da pista cresce conforme o carro se afasta da borda,
      // em vez de aparecer inteiro de uma vez.
      if (feel.offRoad > 0.01 && startedRef.current && !doneRef.current) {
        ctx.fillStyle = `rgba(255, 87, 48, ${(0.11 * feel.offRoad).toFixed(3)})`
        ctx.fillRect(0, 0, width, height)
      }
      animationFrame = requestAnimationFrame(draw)
    }

    animationFrame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', resumeClock)
      for (const timer of flashTimers) window.clearTimeout(timer)
    }
  }, [beep, countdownMs, difficulty, startAt, trackSeed])

  /**
   * Envio da telemetria.
   *
   * Fica em um temporizador, e não no ciclo de animação, por dois motivos: a
   * frequência não pode depender da taxa de quadros do aparelho, e uma aba em
   * segundo plano precisa continuar dizendo ao rival onde o carro parou — o
   * fantasma congelado é a informação correta, melhor do que sumir do mapa.
   */
  useEffect(() => {
    if (!onTelemetry) return
    const timer = window.setInterval(() => {
      if (!startedRef.current || doneRef.current) return
      const race = raceRef.current
      // Com a aba em segundo plano o navegador congela o quadro, e a física com
      // ele: o carro está parado. Mandar a velocidade de antes faria o fantasma
      // seguir andando na tela dos rivais e depois esperar o carro alcançá-lo.
      const parado = performance.now() - ultimoPassoRef.current > 250
      sendTelemetryRef.current?.({
        t: clockRef.current(),
        progress: race.progress,
        lateral: race.lateral,
        speed: parado ? 0 : race.speed / race.rules.turbo,
        state: 'racing',
        boosting: !parado && motorForte(race),
      })
    }, TELEMETRY_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [onTelemetry, startAt])

  useEffect(() => () => {
    audioRef.current?.close()
    audioRef.current = null
  }, [])

  const progressPercent = Math.min(100, (telemetry.progress / TRACK_LENGTH) * 100)
  /** Na arquibancada, a tela descreve o carro que a câmera segue. */
  const carroDaTela = espectador && seguido ? seguido.carro : car
  const referenciaChegou = painel.find((linha) => linha.destaque)?.chegou ?? false
  /** O que a coluna da diferença diz em cada linha da classificação. */
  const textoDaDiferenca = (linha: LinhaDoPainel) => {
    if (linha.diferenca === null) return linha.chegou ? 'CHEGOU' : espectador ? 'CÂMERA' : 'VOCÊ'
    if (linha.semSinal && !linha.chegou) return 'SEM SINAL'
    // Quem chegou antes de quem se olha ainda corre: a diferença de chegada ainda não existe.
    if (linha.chegou && !referenciaChegou) return 'CHEGOU'
    return formatarDiferenca(linha.diferenca)
  }
  /** Ganho máximo do vácuo nesta dificuldade, para o HUD mostrar em km/h. */
  const bonusDoVacuo = rulesFor(difficulty).slipstreamBonus

  /** A próxima super curva, enquanto a nota dela vale para quem pilota. */
  const nota = !espectador && phase === 'racing' && telemetry.resetting === 0 ? telemetry.nota : null
  /** A nota de curva, na coluna do lado para onde a pista vai. Antes da curva ela diz o que fazer; dentro, diz para segurar. */
  const notaDeCurva = nota && (
    <div
      className={`pace-note ${nota.lado > 0 ? 'right' : 'left'} ${nota.dentro ? 'inside' : ''} ${!nota.dentro && nota.metros < 90 ? 'close' : ''}`}
      role="status"
    >
      <b className="pace-arrows" aria-hidden="true">
        {nota.lado > 0 ? '›››' : '‹‹‹'}
        {nota.depois !== 0 && <i>{nota.depois > 0 ? ' ›››' : ' ‹‹‹'}</i>}
      </b>
      <span className="pace-name">
        {nota.nome} <em>{nota.graus}°</em>
      </span>
      <small>
        {nota.dentro
          ? `SEGURE ${nota.lado > 0 ? 'À DIREITA' : 'À ESQUERDA'}`
          : telemetry.boosting
            ? 'SOLTE O BOOST'
            : `${nota.metros} M · ENTRE POR DENTRO`}
      </small>
    </div>
  )

  /**
   * O que a tela lembra a quem esqueceu um comando: subir a marcha quando o
   * motor já bate no corte há um segundo, ou pisar no acelerador, parado na
   * largada. No toque o pé já está no fundo, e o lembrete do pedal não vale.
   */
  const lembrete =
    espectador || phase !== 'racing' || telemetry.resetting > 0
      ? null
      : cambioManual && telemetry.noCorte > LEMBRETE_DO_CORTE_S
        ? `SUBA A MARCHA · ${deToque ? '▲' : 'E'}`
        : !deToque && !telemetry.acelerando && telemetry.speed < 1 && telemetry.elapsed > LEMBRETE_DO_PEDAL_S
          ? 'ACELERE · W OU ↑'
          : null

  /** Os comandos, ditos na contagem: é o único momento em que o piloto tem tempo de ler. */
  const dicaDosComandos = deToque
    ? `O CARRO ACELERA SOZINHO · FREIO AO LADO DO BOOST${cambioManual ? ' · ▲ ▼ TROCAM A MARCHA' : ''}`
    : `W ACELERA · S FREIA · ${cambioManual ? 'E SOBE E Q REDUZ A MARCHA' : 'CÂMBIO AUTOMÁTICO'}`

  return (
    <main className="race-shell">
      <canvas ref={canvasRef} className="race-canvas" aria-label="Pista de corrida" />

      <div className="topbar">
        <div className="brand-mini">
          <i /> CORRIDA FANTASMA
          {espectador && <b className="ao-vivo">AO VIVO</b>}
          {/* Quem corre sabe que tem plateia; quem assiste, quantos assistem junto. */}
          {espectadores > 0 && mode !== 'solo' && (
            <span className="publico">{espectadores} ASSISTINDO</span>
          )}
        </div>
        <div className="topbar-actions">
          <button
            className={`sound-button ${mudo ? 'off' : ''}`}
            onClick={alternarSom}
            aria-pressed={!mudo}
            aria-label={mudo ? 'Ligar o som' : 'Desligar o som'}
          >
            {mudo ? 'SOM ✕' : 'SOM ♪'}
          </button>
          <button
            className={`sound-button ${semMusica ? 'off' : ''}`}
            onClick={alternarMusica}
            aria-pressed={!semMusica}
            aria-label={semMusica ? 'Ligar a música' : 'Desligar a música'}
          >
            {semMusica ? 'MÚSICA ✕' : 'MÚSICA ♫'}
          </button>
          <button
            className="sound-button"
            onClick={proximaFaixa}
            disabled={semMusica}
            aria-label="Próxima faixa da rádio"
            title="Próxima faixa (R)"
          >
            RÁDIO ⏭
          </button>
          {onAbandon && phase === 'racing' && (
            <button
              className={`abandon-button ${abandonoArmado ? 'armed' : ''}`}
              onClick={tocarEmAbandonar}
              aria-label={abandonoArmado ? 'Confirmar: abandonar a corrida' : 'Abandonar a corrida'}
            >
              {abandonoArmado ? 'CONFIRMAR' : 'ABANDONAR'}
            </button>
          )}
          {onRestart && (
            <button className="abandon-button restart-button" onClick={onRestart} title="Recomeçar (Backspace)">
              RECOMEÇAR ⌫
            </button>
          )}
        </div>
        <div className="pilot-tag">
          <span>{espectador ? 'CÂMERA NO CARRO DE' : 'PILOTO'}</span>
          {espectador ? (seguido?.nome ?? '—') : pilotName}
          <em style={{ color: carById(carroDaTela).accent }}>{carById(carroDaTela).team} #{carById(carroDaTela).number}</em>
        </div>
      </div>

      {faixaNoAr && !semMusica && (
        <div key={faixaNoAr.desde} className="radio-no-ar" role="status" aria-live="polite">
          <span>RÁDIO FANTASMA</span>
          <strong>♫ {faixaNoAr.nome}</strong>
          <em>{faixaNoAr.estilo}</em>
        </div>
      )}

      <section className="hud" aria-label="Telemetria">
        <div className="position-block">
          <span>{espectador ? 'CÂMERA' : mode === 'online' && rival ? 'POSIÇÃO' : 'MODO'}</span>
          <strong>
            {espectador ? (seguido ? `P${seguido.posicao}` : 'GRID') : mode === 'online' ? (rival?.position ?? 'GRID') : mode === 'contrarrelogio' ? 'RELÓGIO' : 'SOLO'}
          </strong>
          <em className="difficulty-tag">
            {DIFFICULTY_LABELS[difficulty]}
            {modificador && modificador !== 'classico' && modificador !== 'profissional' ? ` · ${MODIFICADORES[modificador].nome}` : ''}
          </em>
        </div>
        <div className="timer-block">
          <span>TEMPO DE CORRIDA</span>
          <strong>{formatTime(telemetry.elapsed)}</strong>
          {/* O delta contra o recorde, no mesmo ponto da pista: verde é ganho. */}
          {telemetry.delta !== null && phase === 'racing' && (
            <em className={`recorde-delta ${telemetry.delta <= 0 ? 'ganho' : 'perda'}`}>
              {formatarDelta(telemetry.delta)} <small>{recorde?.nome ? recorde.nome.toUpperCase() : 'RECORDE'}</small>
            </em>
          )}
        </div>
        {/* O volante de Fórmula 1: as luzes do giro em cima, a marcha e a
            velocidade embaixo. As luzes e a marcha são pintadas a cada quadro
            pelo laço da corrida, e não pelo React. */}
        <div className="speed-block">
          {!espectador && (
            <div ref={luzesRef} className="luzes" aria-hidden="true">
              {Array.from({ length: LUZES_DO_CAMBIO }, (_, i) => <i key={i} />)}
            </div>
          )}
          {!espectador && (
            <div className="marcha-bloco">
              <b ref={marchaRef} className="marcha" aria-hidden="true">1</b>
              {manualObrigatorio ? (
                // A regra da sala: o manual não tem volta, e o botão diz por quê.
                <span
                  className="modo-do-cambio manual obrigatorio"
                  role="img"
                  aria-label="Câmbio manual, obrigatório nesta sala"
                  title="Câmbio manual obrigatório nesta sala: E sobe, Q reduz."
                >
                  MANUAL
                </span>
              ) : (
                <button
                  type="button"
                  className={`modo-do-cambio ${cambioManual ? 'manual' : ''}`}
                  onClick={(event) => {
                    alternarCambio()
                    // Sem foco no botão: o espaço é o boost, e não um clique nele.
                    event.currentTarget.blur()
                  }}
                  aria-pressed={cambioManual}
                  aria-label={cambioManual ? 'Câmbio manual: trocar para o automático' : 'Câmbio automático: trocar para o manual'}
                  title={cambioManual ? 'Câmbio manual (E sobe, Q reduz). Clique para o automático.' : 'Câmbio automático. Clique para o manual.'}
                >
                  {cambioManual ? 'MANUAL' : 'AUTO'}
                </button>
              )}
              {notaDaTroca && (
                <em key={notaDaTroca.vez} className={`nota-da-troca ${notaDaTroca.qualidade}`}>
                  {NOTA_DA_TROCA[notaDaTroca.qualidade]}
                </em>
              )}
            </div>
          )}
          <div className="velocidade">
            <strong>{Math.round(telemetry.speed)}</strong>
            <span>KM/H</span>
          </div>
        </div>
      </section>

      <div className="progress-wrap">
        <div className="progress-copy">
          <span>SETOR ÚNICO</span>
          {/* As batidas que faltam para o reset, sempre à vista: a regra só é
              justa se o piloto enxergar a conta antes de ela cobrar. Moram na
              mesma linha do setor, e não embaixo dela: uma linha a mais
              empurrava o bloco para cima do painel do rival. */}
          <div className="strikes" aria-label={`${telemetry.strikes} de ${RESET_STRIKES} batidas até o reset`}>
            <span>BATIDAS</span>
            {Array.from({ length: RESET_STRIKES }, (_, i) => (
              <i key={i} className={i < telemetry.strikes ? 'on' : ''} />
            ))}
          </div>
          <strong>{progressPercent.toFixed(0)}%</strong>
        </div>
        <div className="progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
        {/* Onde está cada um na volta, na cor do carro: com seis na pista, é a
            única vista da prova inteira. */}
        {painel.length > 1 && phase !== 'countdown' && (
          <div className="progress-marcas" aria-hidden="true">
            {painel.map((linha) => (
              <i
                key={linha.id}
                className={linha.destaque ? 'destaque' : ''}
                style={{ left: `${linha.fracao * 100}%`, background: carById(linha.carro).accent }}
              />
            ))}
          </div>
        )}
      </div>

      {/* A classificação ao vivo. Na arquibancada, tocar numa linha põe a câmera nela. */}
      {(mode === 'online' || espectador) && painel.length > 1 && phase !== 'countdown' && (
        <ol className={`classificacao ${espectador ? 'clicavel' : ''}`} aria-label="Classificação ao vivo">
          {painel.map((linha) => {
            const conteudo = (
              <>
                <b>{linha.posicao}</b>
                <i />
                <span>{linha.nome}</span>
                <em>{textoDaDiferenca(linha)}</em>
              </>
            )
            return (
              <li
                key={linha.id}
                className={`${linha.destaque ? 'destaque' : ''} ${linha.semSinal ? 'sem-sinal' : ''} ${linha.chegou ? 'chegou' : ''} ${linha.boost ? 'boost' : ''}`}
                style={{ '--cor': carById(linha.carro).accent } as CSSProperties}
              >
                {espectador ? (
                  <button type="button" className="linha" onClick={() => seguirPiloto(linha.id)} aria-label={`Seguir ${linha.nome}`}>
                    {conteudo}
                  </button>
                ) : (
                  <div className="linha">{conteudo}</div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {!espectador && (
        <div className={`boost-meter ${telemetry.boosting || telemetry.impulso ? 'active' : ''} ${telemetry.boostLocked ? 'empty' : ''}`}>
          <div className="boost-copy"><span>BOOST</span><b>{Math.round(telemetry.boost)}%</b></div>
          <div className="boost-track"><i style={{ width: `${telemetry.boost}%` }} /></div>
        </div>
      )}

      {/* A carga do mini-turbo só aparece enquanto existe: três degraus, cada
          um maior e na cor do nível, que é o que as faíscas do carro mostram. */}
      {phase === 'racing' && telemetry.carga > 0 && (
        <div className={`carga-meter nivel-${telemetry.nivelCarga}`} role="status" aria-label={`Mini-turbo nível ${telemetry.nivelCarga} de 3`}>
          <span>MINI-TURBO</span>
          <div className="carga-degraus" aria-hidden="true">
            {CARGA_NIVEIS.map((limiar, indice) => (
              <i
                key={limiar}
                className={telemetry.nivelCarga > indice ? 'on' : ''}
                style={{ '--enchido': `${Math.min(1, telemetry.carga / limiar) * 100}%` } as CSSProperties}
              />
            ))}
          </div>
          <small>{telemetry.nivelCarga > 0 ? 'SOLTE NA SAÍDA' : 'SEGURE POR DENTRO'}</small>
        </div>
      )}

      {/* O vácuo só existe com rival na pista, e só aparece quando rende algo:
          um medidor parado em zero durante toda a prova seria ruído no HUD. */}
      {mode === 'online' && phase === 'racing' && telemetry.slipstream > 0.04 && (
        <div className="slipstream-meter">
          <div className="boost-copy">
            <span>VÁCUO</span>
            <b>+{Math.round(telemetry.slipstream * bonusDoVacuo)} KM/H</b>
          </div>
          <div className="boost-track">
            <i style={{ width: `${Math.round(telemetry.slipstream * 100)}%` }} />
          </div>
        </div>
      )}

      {connectionNotice && <div className="connection-notice">{connectionNotice}</div>}

      {/* Os avisos da prova moram em duas colunas, uma de cada lado do
          cronômetro: à esquerda o que cobra — fora da pista, batida, reset —,
          à direita o rival e o que a pista paga — tangência, troca perfeita,
          parcial. No monitor e no notebook as duas ficam na faixa do HUD,
          acima do horizonte, e a pista fica inteira à vista; a nota de curva
          vai para a coluna do lado da curva. No celular as colunas somem da
          caixa (`display: contents`), e cada aviso fica onde sempre esteve. */}
      <div className="avisos avisos-alerta">
        {/* A nota de curva vem primeiro: ela dura a aproximação inteira, e os
            avisos rápidos passam por baixo dela. */}
        {nota && nota.lado < 0 && notaDeCurva}
        {!espectador && lateStart > 0.4 && phase !== 'finished' && (
          <div className="late-notice">LARGADA PERDIDA POR {lateStart.toFixed(1)} S — RECUPERANDO</div>
        )}
        {!espectador && telemetry.resetting > 0 && phase === 'racing' && (
          <div className="reset-banner" role="alert">
            RESET
            <small>{motivoDoReset === 'crashes' ? `${RESET_STRIKES} BATIDAS` : 'FORA DA PISTA'} · −{RESET_SECONDS.toFixed(1).replace('.', ',')} S</small>
            {/* A chave reinicia a animação a cada reset. */}
            <span className="reset-track"><i key={telemetry.resets} style={{ animationDuration: `${RESET_SECONDS}s` }} /></span>
          </div>
        )}
        {!espectador && telemetry.offRoad && phase === 'racing' && telemetry.resetting === 0 && (
          <div className="warning">
            FORA DA PISTA
            {/* O medidor que leva ao reset: enche na grama, esvazia no asfalto. */}
            <span className="offtrack-track"><i style={{ width: `${Math.round(telemetry.offTrack * 100)}%` }} /></span>
          </div>
        )}
        {/* A perda por esforço lateral precisa ser vista para ser justa: uma
            punição que o piloto não percebe é só um bug do ponto de vista dele. */}
        {!espectador && !telemetry.offRoad && telemetry.grip < 0.97 && phase === 'racing' && (
          <div className="warning grip">PERDENDO ADERÊNCIA</div>
        )}
        {flash?.tipo === 'alerta' && <div className="impact">{flash.texto}</div>}
        {lembrete && <div className="warning lembrete" role="status">{lembrete}</div>}
      </div>

      <div className="avisos avisos-premio">
        {nota && nota.lado > 0 && notaDeCurva}
        {mode === 'online' && phase !== 'countdown' && (
          <div
            className={`rival-panel ${rival?.stale || rival?.connected === false ? 'stale' : ''} ${rival?.onScreen && rival.connected ? 'compact' : ''}`}
            aria-live="polite"
          >
            <span>{rival?.name ?? `${rivals.length} RIVAIS`}</span>
            {rival?.connected === false ? (
              <strong>SEM SINAL — AGUARDANDO O RETORNO</strong>
            ) : !rival ? (
              <strong>AGUARDANDO TELEMETRIA</strong>
            ) : rival.finished ? (
              <strong>CRUZOU A LINHA DE CHEGADA</strong>
            ) : (
              <strong>
                {rival.headline}
                {rival.boosting && <b className="rival-boost"> · DE BOOST</b>}
              </strong>
            )}
            {rival?.offScreen && rival.connected && !rival.finished && <em>{rival.offScreen}</em>}
          </div>
        )}
        {!espectador && tangencias > 0 && (
          <div key={tangencias} className="tangency-flash" role="status">
            TANGÊNCIA{ultimaTangencia.sequencia > 1 && <b className="tangency-combo"> ×{ultimaTangencia.sequencia}</b>}
            <small>+{ultimaTangencia.boost}% DE BOOST</small>
          </div>
        )}
        {!espectador && trocaPerfeita && phase === 'racing' && (
          <div key={trocaPerfeita.vez} className="troca-perfeita" role="status">
            TROCA PERFEITA{trocaPerfeita.sequencia > 1 && <b> ×{trocaPerfeita.sequencia}</b>}
            <small>+{IMPULSO_DA_TROCA.toFixed(1).replace('.', ',')} S DE TURBO</small>
          </div>
        )}
        {flash?.tipo === 'premio' && <div className="impact premio">{flash.texto}</div>}
        {parcial && phase === 'racing' && (
          <div
            key={parcial.setor}
            className={`parcial-flash ${parcial.delta === null ? '' : parcial.delta <= 0 ? 'ganho' : 'perda'}`}
            role="status"
          >
            <span>SETOR {parcial.setor}</span>
            <strong>{parcial.delta === null ? formatTime(parcial.tempo) : formatarDelta(parcial.delta)}</strong>
          </div>
        )}
      </div>

      {phase === 'countdown' && (
        <div className="countdown-layer">
          <div className="lights" aria-label={`${countdownLight} de ${LIGHT_COUNT} luzes`}>
            {[1, 2, 3, 4, 5].map((light) => (
              <i key={light} className={countdownLight >= light ? 'on' : ''} />
            ))}
          </div>
          <p>{espectador ? 'A LARGADA VAI SAIR' : countdownLight === 0 ? 'PREPARE-SE' : 'AGUARDE AS LUZES APAGAREM'}</p>
          {!espectador && <p className="countdown-dica">{dicaDosComandos}</p>}
          {mode !== 'solo' && <p className="countdown-sync">LARGADA SINCRONIZADA PELO SERVIDOR</p>}
        </div>
      )}

      {phase === 'racing' && telemetry.elapsed < 1.1 && <div className="go-signal">VAI!</div>}

      {espectador ? (
        <div
          className="espectador-controles"
          role="group"
          aria-label="Câmera do espectador"
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" className="trocar" onClick={() => seguirOutro(-1)} aria-label="Seguir o piloto anterior" title="Piloto anterior (A)">‹</button>
          <div className="seguido" aria-live="polite">
            {seguido ? (
              <>
                <img src={carImageUrl(seguido.carro)} alt="" draggable={false} />
                <span>{autoLider ? 'SEGUINDO O LÍDER' : 'SEGUINDO'}</span>
                <strong>P{seguido.posicao} · {seguido.nome}</strong>
                <em>{seguido.chegou ? 'CRUZOU A LINHA' : `${Math.round(seguido.velocidade)} KM/H`}</em>
              </>
            ) : (
              <strong>AGUARDANDO A LARGADA</strong>
            )}
          </div>
          <button type="button" className="trocar" onClick={() => seguirOutro(1)} aria-label="Seguir o próximo piloto" title="Próximo piloto (D)">›</button>
          <button type="button" className={`lider ${autoLider ? 'on' : ''}`} onClick={seguirLider} aria-pressed={autoLider} title="Seguir o líder (L)">
            LÍDER
          </button>
        </div>
      ) : (
        // Segurar o BOOST é toque longo por definição: nada de menu por cima dele.
        <div
          ref={controlesRef}
          className="touch-controls"
          aria-label="Controles de toque"
          onContextMenu={(event) => event.preventDefault()}
        >
          <button className="steer left" aria-label="Virar à esquerda" {...holdControl('left')}>‹</button>
          <button className="steer right" aria-label="Virar à direita" {...holdControl('right')}>›</button>
          {/* As borboletas só existem no manual: no automático, seriam dois
              botões a mais para o polegar errar. */}
          {cambioManual && (
            <div className="borboletas">
              <button className="borboleta" aria-label="Subir marcha" {...tocarBorboleta('shiftUp')}>▲</button>
              <button className="borboleta" aria-label="Reduzir marcha" {...tocarBorboleta('shiftDown')}>▼</button>
            </div>
          )}
          {/* O freio fica à esquerda do boost, como o pedal fica à esquerda do acelerador. */}
          <button className="brake-button" aria-label="Frear" {...holdControl('brake')}>
            <span>FREIO</span>
          </button>
          <button className="boost-button" aria-label="Ativar boost" {...holdControl('boost')}>
            <span>BOOST</span><small>SEGURE</small>
          </button>
        </div>
      )}

      {/* Na arquibancada o painel da câmera mora na base, e os botões dizem as teclas. */}
      {!espectador && (
        <div className="keyboard-hint">
          <kbd>W</kbd><kbd>S</kbd> ACELERA E FREIA <kbd>A</kbd><kbd>D</kbd> DIREÇÃO
          {cambioManual && <> <kbd>E</kbd><kbd>Q</kbd> MARCHA</>} <kbd>ESPAÇO</kbd> BOOST
          {onRestart && <> <kbd>⌫</kbd> RECOMEÇAR</>}
        </div>
      )}
    </main>
  )
}

export default RaceCanvas
