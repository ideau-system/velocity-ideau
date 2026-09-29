// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { rulesFor, type Difficulty, type RaceRules } from './rules.js'
import {
  HIT_HALF_WIDTH,
  HIT_IS_CRASH,
  HIT_PENALTY_SHARE,
  LATERAL_LIMIT,
  OFF_ROAD_LIMIT,
  TRACK_LENGTH,
  WALL_LIMIT,
} from './track.js'

// Os limites laterais são geometria da pista, e ficam definidos junto dela para
// o desenho, a simulação e o servidor nunca divergirem.
export { LATERAL_LIMIT, OFF_ROAD_LIMIT } from './track.js'

export type RaceInput = {
  left: boolean
  right: boolean
  boost: boolean
  /**
   * Pé no acelerador. Ausente vale pé no fundo: é o acelerador automático do
   * toque, o dos pilotos de referência e o de toda volta gravada antes de o
   * carro ter pedal.
   */
  throttle?: boolean
  /** Pé no freio. Vence o acelerador e o boost. */
  brake?: boolean
  /** Borboleta de subir marcha. Vale uma vez, no quadro em que chega. */
  shiftUp?: boolean
  /** Borboleta de reduzir. Vale uma vez, no quadro em que chega. */
  shiftDown?: boolean
  /**
   * Câmbio manual. Ausente, o câmbio troca sozinho no ponto certo — e nunca
   * rende troca perfeita, que é o prêmio de quem troca na mão.
   */
  manual?: boolean
}

export type RaceState = {
  /** Distância percorrida no circuito, em metros. */
  progress: number
  /** Posição entre os limites da pista, de -1.28 a 1.28. */
  lateral: number
  speed: number
  boost: number
  penalty: number
  collisions: number
  topSpeed: number
  offRoad: boolean
  boosting: boolean
  /** Bloqueio após esgotar o boost: evita o liga-desliga a cada quadro. */
  boostLocked: boolean
  /**
   * Posição do volante, de -1 a 1. Persegue o comando com inércia em vez de
   * saltar para ele, e é o que move o carro de fato.
   */
  steerInput: number
  /**
   * Quanto o volante andou no passado recente, com esquecimento.
   *
   * Uma correção de curva mexe pouco e some; um zigue-zague sustentado
   * acumula. É daqui que sai a perda de aderência.
   */
  agitation: number
  /**
   * Lado em que o volante assentou por último: -1, 1, ou zero antes do
   * primeiro comando. Só o volante indo para o outro lado conta como
   * zigue-zague.
   */
  steerSide: number
  /** Aderência de 0 a 1, derivada da agitação. Multiplica a velocidade-alvo. */
  grip: number
  /** Força do vácuo aproveitada neste passo, de 0 a 1. */
  slipstream: number
  /** Carga lateral que a curva impôs neste passo, de 0 a 1. */
  cornerLoad: number
  /** Batidas desde o último reset. Na terceira, o carro é resetado. */
  strikes: number
  /**
   * Medidor de saída de pista, de 0 a 1.
   *
   * Enche enquanto o carro está fora do asfalto, mais depressa quanto mais
   * fundo na grama, e esvazia de volta nele. Cheio, o carro é resetado.
   */
  offTrack: number
  /** Segundos que faltam do reset em curso. Enquanto isso o carro fica parado. */
  resetting: number
  /** Resets sofridos na prova. */
  resets: number
  /** Velocidade que o carro retoma quando o reset acaba. */
  resumeSpeed: number
  /**
   * Quanto a linha está encurtando o caminho neste passo: 1 no centro ou na
   * reta, acima de 1 por dentro da curva, abaixo por fora.
   */
  lineFactor: number
  /** Super curvas em que a tangência já foi feita. Cada uma rende uma vez. */
  apexes: Set<number>
  /**
   * Tangências seguidas, sem zebra perdida, muro ou reset no meio.
   *
   * É o encadeamento de Crash Team Racing, só que à vista: cada tangência da
   * sequência devolve mais boost que a anterior, e o HUD mostra a conta.
   */
  sequencia: number
  /** Zebra de tangência sob o carro no passo anterior, ou zero. */
  apiceEmCurso: number
  /** Super curvas em cujo muro o carro já bateu. Cada uma conta uma batida. */
  wallHits: Set<number>
  /** Verdadeiro enquanto o carro está encostado no muro, raspando. */
  onWall: boolean
  finished: boolean
  hitObstacles: Set<number>
  /** Obstáculos de batida por que o carro passou rente, sem tocar. Cada um rende uma vez. */
  raspoes: Set<number>
  /**
   * Segundos de turbo que não gastam a barra.
   *
   * É o que o mini-turbo de curva e a largada perfeita pagam: o carro persegue
   * a velocidade de boost, com a tração do boost, sem tocar na carga. Não passa
   * do teto do nível — é o mesmo alvo do boost —, então o tempo mínimo que o
   * servidor aceita continua valendo por construção.
   */
  impulso: number
  /** Segundos que faltam do motor afogado pela largada queimada. O carro fica parado. */
  afogado: number
  /**
   * Carga do mini-turbo, em segundos de carga ideal.
   *
   * Sobe enquanto o volante aponta para dentro de uma curva de verdade, mais
   * depressa com o carro na metade de dentro da pista. É a receita do Mario
   * Kart: a carga é por tempo, e mirar a curva a faz subir duas vezes e meia
   * mais rápido.
   */
  carga: number
  /** Nível que a carga já alcançou: 0 a 3. */
  nivelCarga: number
  /** Lado da curva que está sendo carregada: 1, -1, ou zero sem carga. */
  ladoDaCarga: number
  /** Segundos desde que o volante deixou de mirar a curva, com carga guardada. */
  semCarga: number
  /** Marcha engatada: 0 é a primeira, até `NUMERO_DE_MARCHAS - 1`. */
  marcha: number
  /** Giro dentro da marcha, de 0 a 1: em 1 o motor bate no corte. */
  giro: number
  /** Segundos seguidos no limitador de giro, sem trocar. */
  noCorte: number
  /**
   * Quanto o carro está ganhando de velocidade, em km/h por segundo, com um
   * instante de suavização. É o que diz quanto falta para o corte, e portanto
   * quando a janela da troca perfeita abre.
   */
  puxada: number
  /** A janela da troca perfeita está aberta: subir agora rende o impulso. */
  janelaDeTroca: boolean
  /** Trocas perfeitas seguidas, desde a última troca fora da janela ou redução. */
  trocasPerfeitas: number
  /** O câmbio está no manual neste passo. */
  manual: boolean
  /** Pé no acelerador neste passo: o pedal, ou o boost, que também acelera. */
  acelerando: boolean
  /** Pé no freio neste passo. */
  freando: boolean
  /**
   * Regras da corrida, fixadas na largada.
   *
   * Viajam dentro do estado de propósito: a dificuldade é decidida pela sala
   * antes da prova começar e não muda no meio dela. Quem simula não precisa
   * receber a dificuldade por fora, e não há como um trecho do código usar um
   * conjunto de regras e outro trecho usar outro.
   */
  rules: RaceRules
}

/** Por que o carro foi resetado: batidas demais ou tempo demais fora da pista. */
export type ResetReason = 'crashes' | 'offTrack'

export type RaceEvent =
  | { type: 'collision'; obstacleId: number }
  | { type: 'reset'; reason: ResetReason }
  /** Tangência feita: quanto de boost ela devolveu e em que ponto da sequência está. */
  | { type: 'apex'; curveId: number; boost: number; sequencia: number }
  | { type: 'wall'; curveId: number }
  /** A carga do mini-turbo chegou a um nível novo. */
  | { type: 'carga'; nivel: number }
  /** O mini-turbo disparou, com o nível que a carga tinha. */
  | { type: 'miniTurbo'; nivel: number }
  /** Passou rente a um obstáculo de batida sem tocar. */
  | { type: 'raspao'; obstacleId: number }
  /**
   * Troca de marcha, do câmbio automático ou da mão do piloto. `sequencia` é
   * quantas trocas perfeitas vieram seguidas, contando esta.
   */
  | { type: 'troca'; de: number; para: number; qualidade: QualidadeDaTroca; sequencia: number }
  /** Redução recusada: na marcha de baixo, o motor passaria do corte. */
  | { type: 'reducaoNegada' }
  | { type: 'finish' }

/**
 * Como foi a troca.
 *
 * `perfeita` é a subida dentro da janela, a única que rende impulso; `tarde`, a
 * que veio depois de o motor bater no corte; `cedo`, a que derrubou o giro
 * abaixo da faixa de força; `boa`, qualquer outra subida. As reduções e as
 * trocas do câmbio automático não são julgadas.
 */
export type QualidadeDaTroca = 'perfeita' | 'boa' | 'cedo' | 'tarde' | 'reducao' | 'automatica'

/** Maior passo de simulação aceito, protege contra abas em segundo plano. */
export const MAX_STEP_SECONDS = 0.05
/** Carga mínima para voltar a usar o boost depois de esgotá-lo. */
export const BOOST_UNLOCK = 25

/**
 * Passo fixo da integração, em segundos.
 *
 * A curva de tração não tem solução fechada, então ela é integrada em passos
 * curtos e sempre do mesmo tamanho. Sem isso, um aparelho de 20 quadros por
 * segundo chegaria a uma velocidade diferente de um de 60 — e num duelo isso
 * é vantagem de hardware. 60, 30 e 20 quadros por segundo são múltiplos
 * exatos deste passo, então os três percorrem a mesma sequência.
 */
export const PHYSICS_STEP = 1 / 120

/**
 * Aceleração com o carro parado, em km/h por segundo.
 *
 * A arrancada é forte, mas o ganho cede conforme a velocidade sobe — é o
 * oposto da aproximação exponencial anterior, que gastava quase tudo no
 * primeiro instante e colocava o carro perto de 200 km/h em menos de um
 * segundo, sem nenhuma progressão para o olho acompanhar.
 */
export const ACCELERATION_PEAK = 62

/**
 * Expoente da curva de tração.
 *
 * Com 4, a aceleração fica quase constante até dois terços da velocidade-alvo
 * e só então cede. É o que dá a sensação de ganho progressivo em vez de um
 * salto seguido de estagnação.
 */
export const ACCELERATION_SHAPE = 4

/**
 * Empurrão extra do boost sobre a tração.
 *
 * Sem ele o boost virava uma promessa: a velocidade-alvo subia para 314, mas
 * a carga acabava antes de o carro chegar perto disso. Com o empurrão, a
 * arrancada do boost é sentida na hora e a vantagem volta à faixa combinada.
 */
export const BOOST_TRACTION = 1.5

/** Perder velocidade é mais rápido que ganhar: a grama pesa. */
export const DECELERATION_RATE = 5

/** No impacto a queda é quase instantânea, e não uma frenagem suave. */
export const IMPACT_DECELERATION = 16

/** Deslocamento lateral por segundo com o volante todo virado, parado. */
export const STEER_RATE = 1.35

/** Inércia do volante, em segundos. Curto: não atrasa o comando, dá peso. */
export const STEER_TAU = 0.1

/** Tempo de esquecimento da agitação do volante, em segundos. */
export const AGITATION_TAU = 1

/**
 * Posição do volante, na direção do comando, a partir da qual ele assentou
 * daquele lado. Perto do batente: a troca de lado conta inteira, como contava
 * antes de o pulso deixar de contar.
 */
export const STEER_SETTLED = 0.9

/**
 * Faixa de agitação entre a primeira perda e a perda máxima.
 *
 * A zona morta e a perda máxima mudam com a dificuldade; a largura da rampa
 * entre elas não, para o volante responder com a mesma forma nos três níveis.
 */
export const AGITATION_RANGE = 3.4

/**
 * Quanto do que escapa à aderência da curva vira deslocamento, em unidades de
 * posição lateral por segundo.
 *
 * Multiplica apenas o excedente, não a carga inteira: a parte que o pneu
 * segura não desloca o carro. Calibrado contra a autoridade de esterço, que
 * vale `STEER_RATE + velocidade / 520`, pela regra de Top Gear: **quem segura o
 * volante segura a curva**. Em cruzeiro, a pior curva comum pede 72% do
 * volante e a super curva, no centro da pista, pouco mais de 90%; só de boost
 * a curva passa do que o volante segura, e aí ela joga o carro para fora.
 *
 * Já foi 2,55, e com ele a pior curva comum pedia 114% do volante e o grampo,
 * 354%: o carro era arremessado para fora fizesse o piloto o que fizesse. Uma
 * curva que não se consegue fazer não é pesada — é aleatória.
 */
export const CORNER_PUSH = 1.6

/**
 * Quanto a curva freia o carro, em km/h por segundo, por unidade do que escapa
 * à aderência.
 *
 * É o pneu esfregando de lado. Multiplica o mesmo excedente que empurra o
 * carro para fora, então só cobra onde a curva já está cobrando — e cobra mais
 * de quem entra embalado, porque a carga cresce com o quadrado da velocidade.
 *
 * É uma frenagem, e não um corte na velocidade-alvo, e de propósito. Com o
 * corte, o carro perdia a velocidade em dois décimos de segundo, a força da
 * curva caía junto, e nem entrando de boost na curva mais fechada alguém saía
 * da pista — medido. Esfregando aos poucos, quem entra embalado é jogado para
 * fora antes de perder a velocidade, que é o que a curva de verdade faz.
 *
 * Caiu de 45 para 22 junto com o empurrão. Com 45 o grampo tirava cem km/h por
 * segundo, e o carro saía de toda super curva se arrastando: a curva de Top
 * Gear é rápida, e custa velocidade a quem erra a linha, não a quem a faz.
 */
export const CORNER_SCRUB = 22

/**
 * Quanto o boost aumenta a carga da curva.
 *
 * De boost, o motor manda às rodas mais força do que o pneu segura de lado, e a
 * traseira escapa: é a lição de Top Gear, em que o nitro numa curva é o jeito
 * mais rápido de sair da pista. Sem este fator, entrar embalado num grampo só
 * abria a linha — medido, o carro nunca chegava à grama, e o boost na curva não
 * custava nada. Com ele, a super curva de boost passa de 170% do que o volante
 * segura, e quem entra assim vai para o muro.
 */
export const BOOST_IN_CORNER = 1.3

/**
 * Batidas que resetam o carro.
 *
 * A terceira batida não é mais uma penalidade de velocidade: o carro é tirado
 * da prova por `RESET_SECONDS` e devolvido ao meio da pista. As batidas
 * voltam a zero a cada reset.
 */
export const RESET_STRIKES = 3

/**
 * Quanto tempo o reset custa, em segundos.
 *
 * O carro fica parado e o relógio da prova não. Tem de ser tempo perdido de
 * verdade, e não um acréscimo no cronômetro: quem decide o tempo de chegada é
 * o servidor, pelo relógio dele, e um acréscimo feito no aparelho seria
 * cortado ali. Parado, o carro perde os segundos no único relógio que conta.
 */
export const RESET_SECONDS = 1.5

/**
 * Segundos no fundo da grama até o reset.
 *
 * Com o carro encostado no limite de fora, o medidor enche em pouco mais de
 * um segundo; raspando só a borda, bem mais devagar. Uma escapada curta numa
 * curva custa a velocidade que a grama já tira — o reset é para quem fica.
 */
export const OFF_TRACK_SECONDS = 1.3

/**
 * Parcela do medidor que enche mesmo com o carro só raspando a borda.
 *
 * Sem ela, ficar para sempre com uma roda na grama nunca resetaria, e a
 * beirada virava um lugar para morar.
 */
export const OFF_TRACK_SHALLOW = 0.25

/** Quanto o medidor esvazia por segundo, de volta ao asfalto. */
export const OFF_TRACK_RECOVERY = 0.5

/**
 * Até quantos metros à frente do ponto do reset os obstáculos ficam para trás.
 *
 * O reset põe o carro no meio da pista, que não foi escolha do piloto. Um
 * obstáculo no meio, logo adiante, viraria uma batida que ninguém conseguiria
 * evitar — e numa terceira batida, um reset em cima do outro. Vinte metros é
 * mais do que o carro precisa para desviar depois de solto.
 */
export const RESET_CLEARANCE_M = 20

/** Alcance do vácuo, em metros atrás do rival. */
export const SLIPSTREAM_RANGE_M = 42
/** Diferença lateral a partir da qual o vácuo deixa de existir. */
export const SLIPSTREAM_WIDTH = 0.55

/**
 * Força do vácuo deixado pelo rival, de 0 a 1.
 *
 * É o que dá sentido mecânico à presença do adversário: sem isso o fantasma é
 * só uma imagem, e uma corrida on-line são duas provas solo sobrepostas. Colar
 * no rival rende velocidade, e ultrapassá-lo custa esse ganho — a esteira
 * desaparece no instante em que o carro passa à frente.
 *
 * Só aproveita quem vem atrás, alinhado com quem vai na frente, e cresce à
 * medida que a distância diminui.
 */
export function slipstreamFrom(
  playerProgress: number,
  playerLateral: number,
  rivalProgress: number,
  rivalLateral: number,
) {
  const atras = rivalProgress - playerProgress
  // As comparações são escritas para que qualquer NaN caia no retorno zero.
  if (!(atras > 0) || !(atras < SLIPSTREAM_RANGE_M)) return 0
  const alinhamento = 1 - Math.abs(rivalLateral - playerLateral) / SLIPSTREAM_WIDTH
  if (!(alinhamento > 0)) return 0
  return (1 - atras / SLIPSTREAM_RANGE_M) * alinhamento
}

/** `turbo` multiplica as velocidades: só o easter egg de `turboDoPiloto` passa algo além de 1. */
export function createRaceState(difficulty: Difficulty = 'normal', turbo = 1): RaceState {
  return {
    rules: rulesFor(difficulty, turbo),
    progress: 0,
    lateral: 0,
    speed: 0,
    boost: 100,
    penalty: 0,
    collisions: 0,
    topSpeed: 0,
    offRoad: false,
    boosting: false,
    boostLocked: false,
    steerInput: 0,
    agitation: 0,
    steerSide: 0,
    grip: 1,
    slipstream: 0,
    cornerLoad: 0,
    strikes: 0,
    offTrack: 0,
    resetting: 0,
    resets: 0,
    resumeSpeed: 0,
    lineFactor: 1,
    apexes: new Set<number>(),
    sequencia: 0,
    apiceEmCurso: 0,
    wallHits: new Set<number>(),
    onWall: false,
    finished: false,
    hitObstacles: new Set<number>(),
    raspoes: new Set<number>(),
    impulso: 0,
    afogado: 0,
    carga: 0,
    nivelCarga: 0,
    ladoDaCarga: 0,
    semCarga: 0,
    marcha: 0,
    giro: 0,
    noCorte: 0,
    puxada: 0,
    janelaDeTroca: false,
    trocasPerfeitas: 0,
    manual: false,
    acelerando: true,
    freando: false,
  }
}

/**
 * Quanto a linha encurta o caminho, para uma posição lateral.
 *
 * Numa curva de raio R, a linha a uma distância n do centro, por dentro, tem
 * raio R − n: o carro percorre (1 − n/R) do que a linha central percorre, e
 * portanto avança na pista 1 / (1 − n/R) mais depressa na mesma velocidade.
 * `lineGain` já é 1/R em unidades de posição lateral, com o sinal do lado.
 *
 * Nenhum pseudo-3D fazia isso: neles o carro avança pela linha central esteja
 * onde estiver, e a posição lateral só decide em que se bate. Aqui, a
 * tangência encurta o caminho de verdade — e, como a mesma conta é a do raio,
 * a linha por dentro também empurra um pouco mais. Por dentro é mais curto e
 * mais difícil de segurar; por fora é mais longo e mais folgado. É a escolha
 * de toda curva de verdade.
 */
export function lineFactorFor(lineGain: number, lateral: number) {
  if (!Number.isFinite(lineGain) || !Number.isFinite(lateral)) return 1
  const encurtamento = 1 - lineGain * lateral
  if (!(encurtamento > 0)) return LINE_FACTOR_MAX
  return clamp(1 / encurtamento, LINE_FACTOR_MIN, LINE_FACTOR_MAX)
}

/**
 * Tira o carro da prova por `RESET_SECONDS` e o devolve ao meio da pista.
 *
 * Tudo o que o carro vinha acumulando zera: batidas, medidor de saída,
 * penalidade, volante e aderência. O reset é a punição inteira, e não uma
 * punição por cima das outras. A velocidade que ele tinha fica guardada e
 * volta quando o tempo acaba — assim o reset custa exatamente o tempo
 * prometido, e não compensa provocá-lo: quem estava lento na grama volta lento.
 */
function resetar(state: RaceState) {
  state.resumeSpeed = state.speed
  state.speed = 0
  state.resetting = RESET_SECONDS
  state.resets += 1
  state.lateral = 0
  state.offRoad = false
  state.steerInput = 0
  state.agitation = 0
  state.steerSide = 0
  state.grip = 1
  state.penalty = 0
  state.boosting = false
  state.cornerLoad = 0
  state.strikes = 0
  state.offTrack = 0
  state.onWall = false
  // O reset é a punição inteira: leva junto o turbo, a carga e as sequências.
  state.impulso = 0
  state.sequencia = 0
  state.trocasPerfeitas = 0
  state.noCorte = 0
  state.janelaDeTroca = false
  state.puxada = 0
  perderCarga(state)
  for (const obstacle of state.rules.obstacles) {
    const delta = obstacle.distance - state.progress
    if (delta > -5 && delta < RESET_CLEARANCE_M) state.hitObstacles.add(obstacle.id)
  }
}

/** Aderência disponível para uma dada agitação do volante. */
export function gripFor(agitation: number, rules: RaceRules) {
  const excesso = (agitation - rules.agitationDeadband) / AGITATION_RANGE
  return 1 - clamp(excesso, 0, 1) * rules.maxGripLoss
}

/**
 * Velocidade que o carro persegue neste instante.
 *
 * Parte da tabela de estados — que é o contrato com o servidor — e aplica
 * sobre ela as perdas contínuas: o quanto o carro se embrenhou na grama e o
 * quanto vem maltratando o volante.
 */
export function targetSpeedFor(state: RaceState) {
  const base = speedForState(state.offRoad, state.penalty, motorForte(state), state.rules, state.slipstream)
  if (!state.offRoad) return base * state.grip
  const profundidade = clamp((Math.abs(state.lateral) - OFF_ROAD_LIMIT) / (LATERAL_LIMIT - OFF_ROAD_LIMIT), 0, 1)
  return base * (1 - profundidade * state.rules.offRoadDepthLoss) * state.grip
}

/**
 * Velocidade que o carro persegue em cada estado, para um conjunto de regras.
 *
 * É o contrato que o servidor usa para saber o tempo mínimo plausível da
 * prova, e por isso mora junto das regras e não dentro do laço de simulação.
 */
export function speedForState(
  offRoad: boolean,
  penalty: number,
  boosting: boolean,
  rules: RaceRules,
  slipstream = 0,
) {
  if (offRoad) return rules.offRoadSpeed
  if (penalty > 0) return rules.penaltySpeed
  // O vácuo acrescenta só nos estados livres: na grama e durante a penalidade
  // o carro está sendo punido, e a esteira do rival não anula punição.
  //
  // `Math.min` e `Math.max` propagam NaN, e a força do vácuo é derivada da
  // posição do rival, que chega pela rede: a faixa é conferida, não presumida.
  const forca = Number.isFinite(slipstream) ? Math.max(0, Math.min(1, slipstream)) : 0
  return (boosting ? rules.boostSpeed : rules.cruiseSpeed) + forca * rules.slipstreamBonus
}

/**
 * O que a simulação não sabe sozinha.
 *
 * A pista sob o carro e o rival à frente dele. Nenhum dos dois é propriedade
 * do carro: a curvatura vem do traçado gerado pela semente da sala, e a
 * esteira vem da telemetria do adversário. Viajam juntos num objeto, e não
 * como dois números na chamada, para não haver como trocá-los de lugar.
 */
export type RaceContext = {
  /**
   * Carga da curva no ponto do carro: negativa à esquerda, positiva à direita.
   *
   * Vai de -1 a 1 nas curvas comuns; as super curvas passam disso, até
   * `MAX_CORNER_LOAD`.
   */
  curvature: number
  /** Força do vácuo do rival, de 0 a 1. */
  slipstream: number
  /**
   * Quanto do caminho cada unidade de posição lateral encurta ali, com sinal.
   *
   * É a curvatura vezes os metros de uma unidade lateral: positiva numa curva
   * à direita, onde o lado de dentro é o de posição positiva. Zero na reta, e
   * quando nada é informado.
   */
  lineGain?: number
  /** Super curva cuja zebra da tangência está sob o carro, ou zero. */
  apexId?: number
  /** Para que lado vira a curva daquela zebra: 1, -1, ou zero sem zebra. */
  apexSide?: number
  /** Super curva cujo muro cobre o ponto do carro, ou zero. */
  wallId?: number
  /** De que lado está o muro: 1, -1, ou zero sem muro. É o lado de fora da curva. */
  wallSide?: number
  /**
   * Relê a pista num ponto, preenchendo os campos acima.
   *
   * Presente, a física a chama a cada passo fixo, e não só uma vez por
   * quadro. Numa super curva a carga muda de zero ao pico em cinquenta metros,
   * e a vinte quadros por segundo o carro anda 3,5 m entre dois quadros: lida
   * por quadro, a curva de um aparelho lento chegava atrasada — e um piloto
   * que passava limpo a sessenta ia para a grama a vinte, medido. Relida no
   * passo fixo, os três percorrem a mesma curva, como já percorriam a mesma
   * física.
   */
  sample?: (progress: number, out: RaceContext) => void
}

/** Pista reta e sem ninguém à frente: o que vale quando nada é informado. */
export const NO_CONTEXT: RaceContext = { curvature: 0, slipstream: 0 }

/**
 * Maior carga de curva que a física aceita.
 *
 * É o teto das super curvas, e é também a guarda contra uma entrada corrompida:
 * nenhuma curva de verdade passa disso, então nada acima disso é aceito.
 */
export const MAX_CORNER_LOAD = 3

/**
 * Limites do quanto a linha pode encurtar ou alongar o caminho.
 *
 * Com as curvas que o traçado faz, a conta nunca chega perto deles: no ápice
 * do grampo, encostado no limite de dentro, o fator é 1,35. São a guarda para
 * o fator nunca inverter o sinal nem explodir numa entrada absurda.
 */
const LINE_FACTOR_MIN = 0.6
const LINE_FACTOR_MAX = 1.5

/**
 * Posição lateral, do lado de dentro, a partir da qual a passagem pela zebra
 * de dentro conta como tangência.
 *
 * É mais da metade do caminho entre o centro e a borda: a tangência é uma
 * escolha, feita antes da curva, e não algo que acontece com quem só passou
 * por ali.
 */
export const APEX_LATERAL = 0.6

/** Carga de boost que a tangência devolve. */
export const APEX_BOOST = 22

/** Quanto cada tangência da sequência devolve a mais que a anterior. */
export const APEX_COMBO_STEP = 5

/** Degraus da sequência que ainda aumentam o que a tangência devolve: 22, 27, 32. */
export const APEX_COMBO_MAX = 2

/** O que a tangência devolve, na posição da sequência em que ela cai (0 é a primeira). */
export function apexRefund(sequenciaAnterior: number) {
  return APEX_BOOST + APEX_COMBO_STEP * clamp(Math.floor(sequenciaAnterior), 0, APEX_COMBO_MAX)
}

/**
 * Carga de curva, na escala da física, a partir da qual a curva carrega o
 * mini-turbo.
 *
 * Em reta não carrega nada, e é isso que impede o "snaking" do Mario Kart de
 * DS: encadear mini-turbos em zigue-zague numa reta. Só a curva de verdade
 * paga, e quem a faz pela linha de dentro recebe mais.
 */
export const CARGA_CURVA_MIN = 0.3

/**
 * Quanto o volante precisa apontar para dentro da curva para carregar.
 *
 * É lido do volante, que tem inércia, e não da tecla: segurar uma linha com
 * tecla ou toque é dar pulsos do mesmo lado, e o volante suaviza os pulsos no
 * mesmo número que o carro sente — o filtro de input de Horizon Chase.
 */
export const CARGA_VOLANTE = 0.3

/** Posição lateral, do lado de dentro, a partir da qual a carga sobe na taxa cheia. */
export const CARGA_DENTRO = 0.2

/** Carga por segundo na metade de dentro da pista, e fora dela: a proporção 5:2 do Mario Kart. */
export const CARGA_TAXA_DENTRO = 1
export const CARGA_TAXA_FORA = 0.4

/**
 * Carga, em segundos ideais, de cada nível do mini-turbo.
 *
 * O prêmio cresce mais depressa que o custo, como no Mario Kart 8 Deluxe
 * (0,62, 1,67 e 2,63 s de turbo): vale segurar a curva inteira pela linha de
 * dentro, e o terceiro nível só sai de uma super curva feita inteira.
 */
export const CARGA_NIVEIS = [0.4, 0.8, 1.2] as const

/** Segundos de impulso que cada nível paga ao disparar. */
export const IMPULSO_POR_NIVEL = [0, 0.6, 1.2, 2] as const

/**
 * Segundos com o volante fora da curva até a carga disparar.
 *
 * Endireitar solta o mini-turbo. A folga existe para o pulso de tecla não
 * disparar a carga no meio da curva: o volante suaviza, mas um toque solto por
 * um décimo de segundo ainda baixa a mira.
 */
export const CARGA_FOLGA = 0.12

/** Folga lateral, além da largura de batida, em que passar por um obstáculo conta como raspão. */
export const RASPAO_FOLGA = 0.12

/** Carga de boost que o raspão devolve. */
export const RASPAO_BOOST = 6

/**
 * Metros além do obstáculo em que o raspão é contado.
 *
 * Contado com o carro já passando, e não na chegada: a janela de batida vai de
 * oito metros antes a cinco depois, e um raspão pago na chegada ainda poderia
 * virar batida logo em seguida.
 */
export const RASPAO_PASSOU_M = -3

/** Nível que uma carga alcançou. */
export function nivelDaCarga(carga: number) {
  let nivel = 0
  for (const limiar of CARGA_NIVEIS) if (carga >= limiar) nivel += 1
  return nivel
}

/**
 * Se o motor está mandando a força do boost: pelo boost ou por um impulso em
 * curso — este, só com o pé no acelerador. Quem tira o pé no meio do turbo o
 * joga fora.
 */
export function motorForte(state: RaceState) {
  return state.boosting || (state.impulso > 0 && state.acelerando)
}

/** Joga fora a carga do mini-turbo, sem disparar. */
function perderCarga(state: RaceState) {
  state.carga = 0
  state.nivelCarga = 0
  state.ladoDaCarga = 0
  state.semCarga = 0
}

/** Dispara o mini-turbo com o nível que a carga alcançou, e zera a carga. */
function dispararCarga(state: RaceState, events: RaceEvent[]) {
  const nivel = state.nivelCarga
  perderCarga(state)
  if (nivel <= 0) return
  state.impulso = Math.max(state.impulso, IMPULSO_POR_NIVEL[nivel])
  events.push({ type: 'miniTurbo', nivel })
}

/**
 * O que sobra da velocidade na batida contra o muro da super curva.
 *
 * É mais que a barreira no meio da pista cobra de uma vez, porque o muro vem
 * de lado: o carro chega nele de raspão, e é o raspão que continua cobrando.
 */
export const WALL_IMPACT_KEEP = 0.72

/** Fração da penalidade de impacto que a batida no muro cobra. */
export const WALL_PENALTY_SHARE = 0.8

/**
 * Quanto o muro raspa de velocidade, em km/h por segundo, com o carro
 * encostado nele. Faísca e perda: ficar colado no muro é pior que sair dele.
 */
export const WALL_SCRUB = 70

// ---------------------------------------------------------------------------
// Pedais e câmbio
// ---------------------------------------------------------------------------

/**
 * Quanto o carro perde com o pé fora, sem frear, em km/h por segundo: arrasto
 * e freio-motor. A parcela do ar cresce com o quadrado da velocidade, medida
 * contra o cruzeiro.
 *
 * Um Fórmula 1 que tira o pé a 300 km/h desacelera quase 1 g só de arrasto.
 * Aqui é menos — tirar o pé é ferramenta de curva, não freio —, mas o bastante
 * para o carro sentir: em cruzeiro, uns 22 km/h a cada segundo sem acelerar.
 */
export const ARRASTO = 8
export const ARRASTO_AERODINAMICO = 14

/**
 * Frenagem, em km/h por segundo, e o reforço da asa em alta.
 *
 * O freio é o comando mais forte do carro, como num Fórmula 1 de verdade, que
 * freia mais do que acelera: do cruzeiro a 150 km/h em menos de um segundo.
 * É o que deixa entrar num grampo por dentro sem ir para o muro.
 */
export const FRENAGEM = 95
export const FRENAGEM_AERODINAMICA = 40

/** Marchas do câmbio: sete, como nos carros da era do V10 e do V8. */
export const NUMERO_DE_MARCHAS = 7

/**
 * Queda de giro em cada troca para cima, da primeira para a segunda em diante.
 *
 * Câmbio de corrida: marchas próximas, e mais próximas quanto mais alta a
 * marcha. Da primeira para a segunda o motor cai quase um terço; na última
 * troca, um décimo. O som do motor cai exatamente o que a física cai.
 */
export const QUEDAS_DO_CAMBIO = [0.72, 0.78, 0.82, 0.855, 0.88, 0.9] as const

/**
 * Velocidade de cada marcha no corte de giro, em fração do teto do nível.
 *
 * A última leva o carro ao teto — o boost com o vácuo inteiro —, e as outras
 * saem das quedas, de cima para baixo. O cruzeiro cai na quinta, com o motor a
 * mais de nove décimos do corte: o grito de uma reta. Só o boost chega à sétima.
 */
export const ALCANCE_DAS_MARCHAS: readonly number[] = QUEDAS_DO_CAMBIO.reduceRight<number[]>(
  (alcances, queda) => [alcances[0] * queda, ...alcances],
  [1],
)

/** Velocidade, em km/h, em que o motor bate no corte numa marcha. */
export function velocidadeDaMarcha(rules: RaceRules, marcha: number) {
  const indice = clamp(Math.round(Number.isFinite(marcha) ? marcha : 0), 0, NUMERO_DE_MARCHAS - 1)
  return speedForState(false, 0, true, rules, 1) * ALCANCE_DAS_MARCHAS[indice]
}

/** Giro em que o câmbio automático sobe de marcha: logo antes do corte. */
export const GIRO_DA_TROCA_AUTOMATICA = 0.975

/**
 * Giro que a marcha de baixo teria, abaixo do qual o automático reduz.
 *
 * Fica abaixo do giro da subida: senão o câmbio subiria e desceria a cada
 * quadro com o carro andando em cima de uma troca.
 */
export const GIRO_DA_REDUCAO_AUTOMATICA = 0.88

/**
 * Giro a partir do qual o motor entrega a força toda.
 *
 * É onde a subida perfeita da primeira para a segunda deixa o motor: quem
 * troca na janela nunca cai abaixo dele, e quem troca antes cai.
 */
export const GIRO_CHEIO = 0.62

/**
 * Força do motor muito abaixo da faixa, em fração da cheia.
 *
 * Numa marcha longa demais o motor se arrasta — é o que a troca adiantada
 * custa —, mas a embreagem patina antes de ele morrer: o carro nunca para.
 */
export const FORCA_MINIMA = 0.35

/**
 * Força que o motor entrega numa marcha e num giro, em fração da cheia.
 *
 * Cai com o quadrado da distância para a faixa: um pouco abaixo dela quase
 * não se sente, e a marcha muito longa se arrasta. Na primeira a embreagem
 * patina e a força é toda: é a marcha de sair parado.
 */
export function forcaDaMarcha(marcha: number, giro: number) {
  if (marcha <= 0 || giro >= GIRO_CHEIO) return 1
  const faixa = clamp(giro / GIRO_CHEIO, 0, 1)
  return FORCA_MINIMA + (1 - FORCA_MINIMA) * faixa * faixa
}

/**
 * Quanto antes do corte a janela da troca perfeita abre, em segundos.
 *
 * Em tempo, e não em giro, de propósito: na primeira o carro atravessa o alto
 * do giro num piscar, e na sexta leva meio segundo. Em giro, a janela da
 * primeira seria impossível e a da sexta, de graça. Em tempo, é a mesma troca
 * em toda marcha — e é quando as luzes do volante piscam.
 */
export const ANTECIPACAO_DA_TROCA = 0.25

/** Quanto tempo batendo no corte ainda conta como troca perfeita, em segundos. */
export const TOLERANCIA_DO_CORTE = 0.15

/** Abaixo deste giro a janela nunca abre, por mais depressa que o carro ganhe velocidade. */
export const GIRO_MINIMO_DA_JANELA = 0.8

/**
 * Ganho mínimo de velocidade, em km/h por segundo, para a janela abrir.
 *
 * A troca perfeita é prêmio de quem está puxando a marcha até o fim. Em
 * cruzeiro o carro não ganha nada, e subir e descer de marcha ali não rende
 * impulso nenhum — senão o câmbio virava uma fábrica de boost.
 */
export const PUXADA_MINIMA = 4

/** Suavização da puxada, em segundos: um instante, para a janela não piscar. */
const PUXADA_TAU = 0.08

/** Abaixo deste giro, subir de marcha acelerando é adiantado: derruba o motor abaixo da força. */
export const GIRO_CEDO = 0.8

/**
 * Segundos de impulso que a troca perfeita paga, e o máximo que trocas
 * seguidas acumulam.
 *
 * É o mesmo turbo da largada e do mini-turbo: tração de boost rumo à
 * velocidade do boost, sem gastar a barra, e sem passar do teto do nível.
 * Menos que o mini-turbo de nível um, porque se troca de marcha muito mais
 * vezes do que se faz curva; mas quem acerta a subida inteira de uma largada
 * sai dela com mais de um segundo de turbo.
 */
export const IMPULSO_DA_TROCA = 0.4
export const IMPULSO_DA_TROCA_MAXIMO = 1.2

/** Recalcula o giro na marcha engatada. */
function atualizarGiro(state: RaceState) {
  state.giro = clamp(state.speed / velocidadeDaMarcha(state.rules, state.marcha), 0, 1)
}

/** Sobe uma marcha pela mão do piloto, e julga a troca. */
function subirMarcha(state: RaceState, events: RaceEvent[]) {
  if (state.marcha >= NUMERO_DE_MARCHAS - 1) return
  const de = state.marcha
  // Parado no reset ou com o motor afogado não há o que puxar.
  const parado = state.resetting > 0 || state.afogado > 0
  const qualidade: QualidadeDaTroca =
    !parado && state.janelaDeTroca
      ? 'perfeita'
      : state.noCorte > TOLERANCIA_DO_CORTE
        ? 'tarde'
        : state.acelerando && state.giro < GIRO_CEDO
          ? 'cedo'
          : 'boa'
  state.marcha += 1
  state.noCorte = 0
  state.janelaDeTroca = false
  atualizarGiro(state)
  if (qualidade === 'perfeita') {
    state.trocasPerfeitas += 1
    state.impulso = Math.max(state.impulso, Math.min(state.impulso + IMPULSO_DA_TROCA, IMPULSO_DA_TROCA_MAXIMO))
  } else {
    state.trocasPerfeitas = 0
  }
  events.push({ type: 'troca', de, para: state.marcha, qualidade, sequencia: state.trocasPerfeitas })
}

/**
 * Reduz uma marcha pela mão do piloto — se o motor aguentar o giro da de baixo.
 *
 * O câmbio de Fórmula 1 recusa a redução que passaria do corte, e aqui também:
 * a borboleta apertada cedo demais na frenagem não faz nada, e o piloto aperta
 * de novo quando a velocidade cair.
 */
function reduzirMarcha(state: RaceState, events: RaceEvent[]) {
  if (state.marcha <= 0) return
  if (state.speed > velocidadeDaMarcha(state.rules, state.marcha - 1)) {
    events.push({ type: 'reducaoNegada' })
    return
  }
  const de = state.marcha
  state.marcha -= 1
  state.noCorte = 0
  state.janelaDeTroca = false
  state.trocasPerfeitas = 0
  atualizarGiro(state)
  events.push({ type: 'troca', de, para: state.marcha, qualidade: 'reducao', sequencia: 0 })
}

/**
 * O câmbio automático: sobe logo antes do corte e reduz quando o giro cai
 * demais, uma marcha por passo.
 *
 * Nunca deixa o motor bater no corte nem sair da faixa de força, e a física
 * não aplica a força da marcha a quem está no automático: com ele, o carro
 * anda exatamente o que andava antes de ter câmbio. É o que mantém valendo os
 * tempos de referência, as medalhas e o piso que o servidor usa.
 */
function cambioAutomatico(state: RaceState, events: RaceEvent[]) {
  const de = state.marcha
  if (state.marcha < NUMERO_DE_MARCHAS - 1 && state.giro >= GIRO_DA_TROCA_AUTOMATICA) {
    state.marcha += 1
  } else if (
    state.marcha > 0 &&
    state.speed < velocidadeDaMarcha(state.rules, state.marcha - 1) * GIRO_DA_REDUCAO_AUTOMATICA
  ) {
    state.marcha -= 1
  } else {
    return
  }
  state.noCorte = 0
  state.trocasPerfeitas = 0
  atualizarGiro(state)
  events.push({ type: 'troca', de, para: state.marcha, qualidade: 'automatica', sequencia: 0 })
}

/**
 * Avança a simulação em `dt` segundos e devolve os eventos ocorridos no passo.
 *
 * Sem pedal informado, o acelerador fica no fundo e o câmbio troca sozinho:
 * é a corrida de quem só controla direção e boost, como sempre foi. Com o
 * pedal e o câmbio manual, o piloto acelera, freia e troca de marcha.
 */
export function stepRace(
  state: RaceState,
  input: RaceInput,
  dt: number,
  context: RaceContext = NO_CONTEXT,
): RaceEvent[] {
  const events: RaceEvent[] = []
  if (state.finished) return events

  // O câmbio e os pedais. As borboletas valem uma vez por chamada, antes do
  // passo — é o quadro em que o dedo apertou —, com o giro e a janela que o
  // piloto via na tela naquele instante. No automático, elas não fazem nada.
  const manual = input.manual === true
  state.manual = manual
  if (manual) {
    if (input.shiftUp) subirMarcha(state, events)
    if (input.shiftDown) reduzirMarcha(state, events)
  }
  const freio = input.brake === true
  // O boost também acelera: apertá-lo sem o pedal é pedir tudo.
  state.freando = freio
  state.acelerando = ((input.throttle ?? true) || input.boost) && !freio

  const step = Math.min(Math.max(0, dt), MAX_STEP_SECONDS)
  if (step === 0) return events

  const comando = Number(input.right) - Number(input.left)
  // Uma medição corrompida do rival não pode apagar a velocidade do carro, e
  // uma curvatura inválida não pode arrastá-lo para fora da pista.
  state.slipstream = Number.isFinite(context.slipstream) ? clamp(context.slipstream, 0, 1) : 0
  // O que a pista impõe no passo. Lido do contexto uma vez, ou a cada passo
  // quando o contexto sabe se reler.
  let curvatura = 0
  let ganhoDaLinha = 0
  let apice = 0
  let ladoDoApice = 0
  let muro = 0
  let ladoDoMuro = 0
  let pistaLida = false
  // A linha pode encurtar o caminho, mas nunca fazer o carro avançar mais
  // depressa que o teto do nível. É esse teto que o servidor usa para o tempo
  // mínimo plausível da prova, e ele continua valendo por construção.
  const tetoDeAvanco = speedForState(false, 0, true, state.rules, 1)

  let restante = step
  while (restante > 1e-9) {
    const h = Math.min(PHYSICS_STEP, restante)
    restante -= h

    // Reset em curso: o relógio corre e o carro não. Nada mais anda — nem a
    // carga do boost, que recarregar parado seria prêmio.
    if (state.resetting > 0) {
      state.resetting = Math.max(0, state.resetting - h)
      if (state.resetting === 0) state.speed = state.resumeSpeed
      continue
    }
    // Largada queimada: o motor afogou, e o carro fica na linha enquanto os
    // outros saem. Como o reset, custa tempo no único relógio que conta.
    if (state.afogado > 0) {
      state.afogado = Math.max(0, state.afogado - h)
      state.speed = 0
      continue
    }

    // A pista relida no ponto em que o carro está neste passo, e não no do
    // começo do quadro. Sem leitor, vale o que o chamador informou.
    if (context.sample) context.sample(state.progress, context)
    if (context.sample || !pistaLida) {
      curvatura = Number.isFinite(context.curvature) ? clamp(context.curvature, -MAX_CORNER_LOAD, MAX_CORNER_LOAD) : 0
      ganhoDaLinha = Number.isFinite(context.lineGain) ? (context.lineGain as number) : 0
      apice = context.apexId ?? 0
      ladoDoApice = context.apexSide ?? 0
      muro = context.wallId ?? 0
      ladoDoMuro = context.wallSide ?? 0
      pistaLida = true
    }

    // O volante tem inércia, e o esforço lateral é o quanto ele andou. Medir
    // o curso do volante — e não a posição do carro na pista — é o que separa
    // a correção necessária numa curva do zigue-zague deliberado.
    //
    // Só conta o volante indo para o outro lado. Com tecla ou toque não existe
    // meio volante: segura-se uma linha de curva pulsando o mesmo lado, e
    // punir o pulso era punir justamente quem está fazendo a curva direito —
    // quatro toques por segundo já acendiam o aviso de aderência.
    const antesDoGiro = state.steerInput
    state.steerInput += (comando - antesDoGiro) * (1 - Math.exp(-h / STEER_TAU))
    const trocandoDeLado = comando !== 0 && state.steerSide !== 0 && comando !== state.steerSide
    state.agitation =
      state.agitation * Math.exp(-h / AGITATION_TAU) + (trocandoDeLado ? Math.abs(state.steerInput - antesDoGiro) : 0)
    // O volante assenta do outro lado quando chega perto do batente: é o fim
    // da troca, e o que vier depois dela para o mesmo lado é pulso.
    if (comando !== 0 && state.steerInput * comando > STEER_SETTLED) state.steerSide = comando
    state.grip = gripFor(state.agitation, state.rules)

    // Força lateral da curva.
    //
    // Aqui a pista passa a cobrar. O carro é jogado para fora, e segurá-lo
    // gasta esterço que deixa de estar disponível para escolher a faixa — é o
    // que cria linha de corrida e diferença de ritmo entre dois pilotos. A
    // carga cresce com o quadrado da velocidade, como a força centrífuga real,
    // então é a velocidade escolhida que decide se a mesma curva é tranquila
    // ou está no limite.
    //
    // O pneu segura a carga até `cornerGrip`; só o excedente desloca o carro.
    // Sem esse limiar, qualquer curvatura arrastava, e quem não corrigisse a
    // cada quadro terminava a prova na grama — o que é punição, não jogo.
    //
    // A linha entra na carga: por dentro o raio é menor, e a mesma velocidade
    // pede mais do pneu. Entra pela raiz do fator, e não por ele inteiro: com o
    // fator inteiro, o caminho mais curto e o empurrão maior se anulavam, e a
    // tangência não rendia nada a quem não usava o boost que ela devolve —
    // medido. Pela raiz, por dentro continua mais difícil de segurar, e passa a
    // ser o caminho rápido, que é o que a nota de curva promete.
    const proporcao = state.speed / state.rules.cruiseSpeed
    state.lineFactor = lineFactorFor(ganhoDaLinha, state.lateral)
    // O impulso é força de boost, e a curva cobra dele o mesmo que do boost.
    const carga =
      curvatura * proporcao * proporcao * Math.sqrt(state.lineFactor) * (motorForte(state) ? BOOST_IN_CORNER : 1)
    state.cornerLoad = Math.min(1, Math.abs(carga))
    const escapa = Math.max(0, Math.abs(carga) - state.rules.cornerGrip)
    // Curva à direita joga o carro para a esquerda, daí o sinal invertido.
    const empurrao = -Math.sign(carga) * escapa * CORNER_PUSH

    state.lateral = clamp(
      state.lateral + (state.steerInput * (STEER_RATE + state.speed / 520) + empurrao) * h,
      -LATERAL_LIMIT,
      LATERAL_LIMIT,
    )

    // O muro da super curva segura o carro como a borda física da pista, só
    // que mais perto dela — e encostar nele é batida. A primeira de cada curva
    // conta para o reset; encostado, o carro raspa velocidade até sair dele.
    state.onWall = false
    if (ladoDoMuro !== 0 && state.lateral * ladoDoMuro >= WALL_LIMIT) {
      state.lateral = ladoDoMuro * WALL_LIMIT
      state.onWall = true
      state.speed = Math.max(0, state.speed - WALL_SCRUB * h)
      if (muro > 0 && !state.wallHits.has(muro)) {
        state.wallHits.add(muro)
        state.collisions += 1
        state.strikes += 1
        state.speed *= WALL_IMPACT_KEEP
        // O muro quebra o que o piloto vinha construindo: turbo, carga e sequência.
        state.impulso = 0
        state.sequencia = 0
        perderCarga(state)
        events.push({ type: 'wall', curveId: muro })
        if (state.strikes >= RESET_STRIKES) {
          resetar(state)
          events.push({ type: 'reset', reason: 'crashes' })
          continue
        }
        state.penalty = Math.max(state.penalty, state.rules.penaltySeconds * WALL_PENALTY_SHARE)
      }
    }
    state.offRoad = Math.abs(state.lateral) > OFF_ROAD_LIMIT

    // Saída de pista: o medidor enche com a profundidade e esvazia no asfalto.
    if (state.offRoad) {
      const profundidade = clamp(
        (Math.abs(state.lateral) - OFF_ROAD_LIMIT) / (LATERAL_LIMIT - OFF_ROAD_LIMIT),
        0,
        1,
      )
      state.offTrack += ((OFF_TRACK_SHALLOW + profundidade) / OFF_TRACK_SECONDS) * h
    } else {
      state.offTrack = Math.max(0, state.offTrack - OFF_TRACK_RECOVERY * h)
    }
    if (state.offTrack >= 1) {
      resetar(state)
      events.push({ type: 'reset', reason: 'offTrack' })
      continue
    }

    // Tangência: passar colado na zebra de dentro, na entrada de uma super
    // curva, no asfalto. É a linha mais curta e a que mais empurra, e quem a
    // faz recebe de volta parte do boost — que só vai poder usar na reta,
    // porque de boost a super curva joga o carro para fora.
    if (
      apice > 0 &&
      !state.offRoad &&
      state.lateral * ladoDoApice >= APEX_LATERAL &&
      !state.apexes.has(apice)
    ) {
      state.apexes.add(apice)
      // Tangências seguidas devolvem mais: 22, 27, 32. O HUD mostra a conta.
      const devolvido = apexRefund(state.sequencia)
      state.sequencia += 1
      state.boost = Math.min(100, state.boost + devolvido)
      events.push({ type: 'apex', curveId: apice, boost: devolvido, sequencia: state.sequencia })
    }
    // Zebra que ficou para trás sem tangência quebra a sequência.
    if (state.apiceEmCurso > 0 && apice !== state.apiceEmCurso && !state.apexes.has(state.apiceEmCurso)) {
      state.sequencia = 0
    }
    state.apiceEmCurso = apice

    // O impulso some na grama e na penalidade, como qualquer turbo que o
    // carro perde ao bater ou escapar; livre, corre o relógio dele.
    if (state.offRoad || state.penalty > 0) state.impulso = 0
    else state.impulso = Math.max(0, state.impulso - h)

    // Mini-turbo: carga por tempo com a mira na curva, disparo ao endireitar.
    // Grama e batida jogam a carga fora. O boost não carrega — na curva o
    // piloto escolhe entre o nitro, que a curva cobra, e a carga, que ela paga
    // na saída —, e apertá-lo com a carga guardada a solta: é o gesto natural
    // de quem endireita e acelera, e não pode custar a curva inteira.
    if (state.offRoad || state.penalty > 0) {
      perderCarga(state)
    } else if (input.boost) {
      if (state.carga > 0) dispararCarga(state, events)
    } else {
      const ladoDaCurva = Math.abs(curvatura) >= CARGA_CURVA_MIN ? Math.sign(curvatura) : 0
      const mirando =
        ladoDaCurva !== 0 &&
        state.impulso <= 0 &&
        state.steerInput * ladoDaCurva >= CARGA_VOLANTE &&
        (state.ladoDaCarga === 0 || state.ladoDaCarga === ladoDaCurva)
      if (mirando) {
        const taxa = state.lateral * ladoDaCurva >= CARGA_DENTRO ? CARGA_TAXA_DENTRO : CARGA_TAXA_FORA
        state.carga += taxa * h
        state.ladoDaCarga = ladoDaCurva
        state.semCarga = 0
        const nivel = nivelDaCarga(state.carga)
        if (nivel > state.nivelCarga) {
          state.nivelCarga = nivel
          events.push({ type: 'carga', nivel })
        }
      } else if (state.carga > 0) {
        state.semCarga += h
        if (state.semCarga >= CARGA_FOLGA) dispararCarga(state, events)
      }
    }

    // O turbo grátis é gasto antes da barra: com um impulso em curso o boost
    // não drena nada, e o carro já tem a força dele.
    if (state.boostLocked && state.boost >= BOOST_UNLOCK) state.boostLocked = false
    state.boosting =
      input.boost &&
      !freio &&
      state.boost > 0 &&
      !state.boostLocked &&
      !state.offRoad &&
      state.penalty <= 0 &&
      state.impulso <= 0
    state.boost = clamp(
      state.boost + (state.boosting ? -state.rules.boostDrain : state.rules.boostRecharge) * h,
      0,
      100,
    )
    if (state.boost <= 0) state.boostLocked = true
    state.penalty = Math.max(0, state.penalty - h)

    const alvo = targetSpeedFor(state)
    const antes = state.speed
    // A queda rumo a um alvo mais baixo — a grama, a penalidade — vale com
    // qualquer pedal. É exponencial, que é a forma certa para arrasto e
    // frenagem, e tem solução fechada, então não depende do tamanho do passo.
    const taxaDeQueda = state.penalty > 0 ? IMPACT_DECELERATION : DECELERATION_RATE
    const queda = alvo < state.speed ? state.speed + (alvo - state.speed) * (1 - Math.exp(-h * taxaDeQueda)) : state.speed
    const noAr = state.speed / state.rules.cruiseSpeed
    const tetoDaMarcha = velocidadeDaMarcha(state.rules, state.marcha)
    if (state.freando) {
      const frenagem = (FRENAGEM + FRENAGEM_AERODINAMICA * noAr * noAr) * state.rules.turbo
      state.speed = Math.min(queda, Math.max(0, state.speed - frenagem * h))
    } else if (!state.acelerando) {
      const arrasto = (ARRASTO + ARRASTO_AERODINAMICO * noAr * noAr) * state.rules.turbo
      state.speed = Math.min(queda, Math.max(0, state.speed - arrasto * h))
    } else if (alvo > state.speed) {
      // Tração: forte na saída, cedendo perto do teto. No manual, a marcha
      // manda: fora da faixa o motor se arrasta, e no corte ele não passa.
      const fracao = state.speed / Math.max(1, alvo)
      const forca = manual ? forcaDaMarcha(state.marcha, state.giro) : 1
      const tracao = ACCELERATION_PEAK * (motorForte(state) ? BOOST_TRACTION : 1) * state.rules.turbo * forca
      const nova = Math.min(alvo, state.speed + tracao * (1 - Math.pow(fracao, ACCELERATION_SHAPE)) * h)
      state.speed = manual ? Math.min(nova, Math.max(state.speed, tetoDaMarcha)) : nova
    } else {
      state.speed = queda
    }
    // E o pneu que escapa esfrega: a curva também cobra velocidade, aos poucos.
    state.speed = Math.max(0, state.speed - CORNER_SCRUB * escapa * h)

    // O giro depois do passo, e o que o câmbio faz com ele.
    atualizarGiro(state)
    state.puxada += ((state.speed - antes) / h - state.puxada) * (1 - Math.exp(-h / PUXADA_TAU))
    if (manual) {
      // No corte: acelerando, encostado no fim da marcha, com a pista pedindo
      // mais. A folga cobre o que a curva esfrega entre dois passos.
      const noLimitador =
        state.acelerando && state.marcha < NUMERO_DE_MARCHAS - 1 && state.speed >= tetoDaMarcha - 0.5 && alvo > tetoDaMarcha
      state.noCorte = noLimitador ? state.noCorte + h : 0
      const podeSubir = state.acelerando && state.marcha < NUMERO_DE_MARCHAS - 1 && !state.offRoad && state.penalty <= 0
      if (!podeSubir) state.janelaDeTroca = false
      else if (state.noCorte > 0) state.janelaDeTroca = state.noCorte <= TOLERANCIA_DO_CORTE
      else {
        state.janelaDeTroca =
          state.giro >= GIRO_MINIMO_DA_JANELA &&
          state.puxada > PUXADA_MINIMA &&
          (tetoDaMarcha - state.speed) / state.puxada <= ANTECIPACAO_DA_TROCA
      }
    } else {
      state.noCorte = 0
      state.janelaDeTroca = false
      cambioAutomatico(state, events)
    }

    const avanco = Math.min(state.speed * state.lineFactor, Math.max(state.speed, tetoDeAvanco))
    state.progress = Math.min(TRACK_LENGTH, state.progress + (avanco / 3.6) * h)

    // As batidas são conferidas a cada passo fixo, e não a cada quadro. Com a
    // conferência por quadro, um aparelho a vinte quadros por segundo batia
    // até três metros mais adiante que um a sessenta — e o reset, que para o
    // carro onde a batida acontece, herdava a diferença. No passo fixo os três
    // percorrem a mesma sequência, como o resto da física.
    if (conferirBatidas(state, events)) continue
  }

  state.topSpeed = Math.max(state.topSpeed, state.speed)

  if (state.progress >= TRACK_LENGTH) {
    state.finished = true
    events.push({ type: 'finish' })
  }

  return events
}

/**
 * Maior intervalo entre dois quadros que a física recupera, em segundos.
 *
 * O mesmo quarto de segundo que a telemetria usa para dizer que o carro está
 * parado: acima disso não é quadro lento, é a aba que parou.
 */
export const MAX_FRAME_SECONDS = 0.25

/**
 * Avança a simulação por um quadro inteiro, em passos de até
 * `MAX_STEP_SECONDS`, e devolve os eventos de todos eles.
 *
 * O relógio da prova é o do servidor. Se o quadro de um celular lento durasse
 * mais que um passo e só um passo fosse simulado, o carro andaria menos que o
 * relógio: a 12 quadros por segundo, pouco mais da metade da distância. É a
 * vantagem de hardware que o passo fixo existe para evitar. Até 20 quadros por
 * segundo o quadro cabe num passo só, e nada muda.
 */
export function advanceRace(
  state: RaceState,
  input: RaceInput,
  dt: number,
  context: RaceContext = NO_CONTEXT,
): RaceEvent[] {
  const quadro = Math.min(Math.max(0, dt), MAX_FRAME_SECONDS)
  if (quadro <= MAX_STEP_SECONDS) return stepRace(state, input, quadro, context)
  // Pedaços iguais: um quadro de 0,1 s vira dois passos de 0,05 s exatos, a
  // mesma sequência de um aparelho a 20 quadros por segundo.
  const pedacos = Math.ceil(quadro / MAX_STEP_SECONDS - 1e-9)
  const passo = quadro / pedacos
  // A borboleta é um toque, e não um comando segurado: troca uma marcha só,
  // no primeiro pedaço, por mais pedaços que o quadro longo tenha.
  const semTroca = input.shiftUp || input.shiftDown ? { ...input, shiftUp: false, shiftDown: false } : input
  const events: RaceEvent[] = []
  for (let i = 0; i < pedacos && !state.finished; i++) {
    events.push(...stepRace(state, i === 0 ? input : semTroca, passo, context))
  }
  return events
}

/**
 * Confere as batidas na posição atual e aplica o que cada uma cobra.
 *
 * Devolve true quando a batida resetou o carro: a terceira batida não é mais
 * uma penalidade de velocidade, é o reset, que já vem com a punição inteira.
 */
function conferirBatidas(state: RaceState, events: RaceEvent[]) {
  for (const obstacle of state.rules.obstacles) {
    const delta = obstacle.distance - state.progress
    if (delta <= -5 || delta >= 8) continue
    const afastamento = Math.abs(state.lateral - obstacle.lane)
    if (afastamento >= HIT_HALF_WIDTH[obstacle.kind]) {
      // Raspão: o carro já passou do obstáculo, colado nele, sem tocar. É o
      // boost ganho por risco de Burnout, pequeno e uma vez por peça — só nas
      // que batem, porque passar rente a uma poça não é risco nenhum.
      if (
        delta <= RASPAO_PASSOU_M &&
        HIT_IS_CRASH[obstacle.kind] &&
        afastamento < HIT_HALF_WIDTH[obstacle.kind] + RASPAO_FOLGA &&
        !state.offRoad &&
        !state.hitObstacles.has(obstacle.id) &&
        !state.raspoes.has(obstacle.id)
      ) {
        state.raspoes.add(obstacle.id)
        state.boost = Math.min(100, state.boost + RASPAO_BOOST)
        events.push({ type: 'raspao', obstacleId: obstacle.id })
      }
      continue
    }
    if (state.hitObstacles.has(obstacle.id)) continue
    state.hitObstacles.add(obstacle.id)
    state.collisions += 1
    events.push({ type: 'collision', obstacleId: obstacle.id })
    if (HIT_IS_CRASH[obstacle.kind]) state.strikes += 1
    if (state.strikes >= RESET_STRIKES) {
      resetar(state)
      events.push({ type: 'reset', reason: 'crashes' })
      return true
    }
    // Nunca encurta uma penalidade em curso: cair num buraco logo depois de
    // bater numa barreira não pode virar alívio.
    state.penalty = Math.max(
      state.penalty,
      state.rules.penaltySeconds * HIT_PENALTY_SHARE[obstacle.kind],
    )
  }
  return false
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
