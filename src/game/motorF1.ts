/**
 * Motor de Fórmula 1 por amostras de gravações de verdade.
 *
 * O som do carro saía de três osciladores — uma serra, a oitava abaixo e uma
 * quadrada —, e é isso que continua tocando enquanto as amostras não chegam,
 * ou se elas não chegarem: a corrida nunca espera um arquivo para largar. Com
 * elas, cada carro ganha a voz do motor da época dele: o V6 turbo dos anos
 * oitenta, o V10, o V8 e o V6 turbo híbrido.
 *
 * Cada voz é um punhado de laços de rotação constante, cortados de gravações
 * (ver o README): camadas a plena carga em rotações diferentes e, quando a
 * gravação tem, uma sem carga — o pé fora, com os estalos do escapamento.
 * Cada laço foi reamostrado até o motor girar sempre na mesma rotação, e fecha
 * num múltiplo exato do ciclo de quatro tempos, então pode tocar para sempre
 * sem pulsar.
 *
 * Em cada instante tocam as duas camadas vizinhas da rotação pedida, cada uma
 * acelerada ou retardada até ela e cruzadas com potência constante — a
 * técnica de todo jogo de corrida com motor gravado. A rotação sai do câmbio
 * de cada voz, com o número de marchas e a queda de cada troca da época.
 *
 * A parte pura — vozes, câmbio, rotação, pesos — fica em cima e é testada sem
 * navegador; a de Web Audio, embaixo.
 *
 * Na corrida, quem manda na marcha é a física: o motor sobe e cai exatamente
 * quando o piloto troca, e cada troca soa como a de um Fórmula 1 — na subida,
 * a ignição corta por um instante e o escapamento estala; na redução, o
 * câmbio dá um toque no acelerador e o escapamento pipoca; no corte, o
 * limitador engasga; tirando o pé, o combustível estoura no escapamento. O
 * câmbio próprio de cada voz fica para quem só conhece a velocidade: a
 * arquibancada, que segue o carro pela telemetria.
 */
import type { AudioHost, AudioLevels } from './audio'
import { soltarAoAcabar } from './banda'
import type { CarId } from './cars'
import { GIRO_MINIMO_DA_JANELA, QUEDAS_DO_CAMBIO } from './simulation'

// ---------------------------------------------------------------------------
// Vozes
// ---------------------------------------------------------------------------

export type CamadaDoMotor = {
  nome: string
  /** Rotação em que o laço foi gravado. */
  rpm: number
  arquivo: string
}

export type IdDaVoz =
  | 'mercedes-v10'
  | 'honda-v6-turbo'
  | 'tag-v6-turbo'
  | 'renault-v10'
  | 'cosworth-v10'
  | 'ferrari-v8'
  | 'mercedes-v8'
  | 'renault-v8'
  | 'hibrido-v6'

export type EspecificacaoDoMotor = {
  id: IdDaVoz
  /** Como a voz aparece para quem lê: o motor e o carro da gravação. */
  nome: string
  /** Rotação da troca para cima, pouco abaixo do corte. */
  troca: number
  /** Corte de giro: acima disto o motor não vai, nem de boost. */
  corte: number
  /** Na largada a embreagem patina: o motor não cai abaixo disto em primeira. */
  largada: number
  /** Antes da luz apagar, o piloto segura o giro em volta disto. */
  segurando: number
  /**
   * Queda de rotação em cada troca para cima, em fração da rotação da troca,
   * da primeira para a segunda em diante. O número de marchas é um a mais.
   */
  quedas: readonly number[]
  /** As camadas a plena carga, em ordem de rotação. */
  camadas: readonly CamadaDoMotor[]
  /** O motor sem carga, se a gravação tem esse trecho. */
  alivio: CamadaDoMotor | null
}

const PASTA = '/audio/motor/'

function camada(nome: string, rpm: number, arquivo: string): CamadaDoMotor {
  return { nome, rpm, arquivo: PASTA + arquivo }
}

/**
 * Câmbio de corrida tem marchas próximas, e mais próximas quanto mais alta a
 * marcha: da primeira para a segunda o motor cai quase um terço; da última
 * troca, pouco mais de um décimo. É essa escada que o ouvido lê como câmbio de
 * Fórmula 1, e não de carro de rua. Os câmbios manuais dos anos oitenta tinham
 * menos marchas, mais espaçadas; os de hoje, oito.
 */
const QUEDAS_DE_SETE = [0.72, 0.78, 0.82, 0.855, 0.88, 0.861]
const QUEDAS_DE_SEIS = [0.68, 0.74, 0.79, 0.83, 0.86]
const QUEDAS_DE_SEIS_JUNTAS = [0.74, 0.78, 0.82, 0.855, 0.88]
const QUEDAS_DE_CINCO = [0.72, 0.76, 0.81, 0.85]
const QUEDAS_V8 = [0.75, 0.78, 0.82, 0.855, 0.88, 0.9]
const QUEDAS_DE_OITO = [0.7, 0.76, 0.8, 0.84, 0.865, 0.885, 0.9]

/**
 * As vozes do motor, uma por família de carro da garagem.
 *
 * As rotações das camadas saem da medição de cada gravação; as de troca, corte
 * e largada foram postas para a camada que domina o som nunca ser esticada
 * mais de um quinto — a gravação esticada demais vira desenho animado —, e a
 * primeira troca nunca derruba o motor abaixo do giro da largada.
 */
export const VOZES: Record<IdDaVoz, EspecificacaoDoMotor> = {
  'mercedes-v10': {
    id: 'mercedes-v10',
    nome: 'Mercedes V10 — McLaren MP4-16 (2001)',
    troca: 18_300,
    corte: 18_600,
    largada: 11_000,
    segurando: 10_500,
    quedas: QUEDAS_DE_SETE,
    camadas: [
      camada('baixa', 10_500, 'v10-baixa.wav'),
      camada('media', 13_500, 'v10-media.wav'),
      camada('alta', 16_300, 'v10-alta.wav'),
      camada('grito', 18_400, 'v10-grito.wav'),
    ],
    alivio: camada('alivio', 14_000, 'v10-alivio.wav'),
  },
  'honda-v6-turbo': {
    id: 'honda-v6-turbo',
    nome: 'Honda V6 turbo — McLaren MP4/4 (1988)',
    troca: 12_500,
    corte: 12_800,
    largada: 8_000,
    segurando: 8_500,
    quedas: QUEDAS_DE_SEIS,
    camadas: [
      camada('baixa', 8_150, 'honda-v6-turbo-baixa.wav'),
      camada('media', 10_100, 'honda-v6-turbo-media.wav'),
      camada('alta', 12_650, 'honda-v6-turbo-alta.wav'),
    ],
    alivio: null,
  },
  'tag-v6-turbo': {
    id: 'tag-v6-turbo',
    nome: 'TAG-Porsche V6 turbo — McLaren MP4/2C (1986)',
    troca: 11_400,
    corte: 11_600,
    largada: 8_000,
    segurando: 8_500,
    quedas: QUEDAS_DE_CINCO,
    camadas: [camada('media', 9_700, 'tag-v6-turbo-media.wav')],
    alivio: null,
  },
  'renault-v10': {
    id: 'renault-v10',
    nome: 'Renault V10 — Williams FW18 (1996)',
    troca: 16_600,
    corte: 16_900,
    largada: 12_000,
    segurando: 12_500,
    quedas: QUEDAS_DE_SEIS_JUNTAS,
    camadas: [camada('media', 14_700, 'renault-v10-media.wav'), camada('alta', 16_450, 'renault-v10-alta.wav')],
    alivio: null,
  },
  'cosworth-v10': {
    id: 'cosworth-v10',
    nome: 'Cosworth V10 — Red Bull RB1 (2005)',
    troca: 17_900,
    corte: 18_200,
    largada: 11_000,
    segurando: 12_000,
    quedas: QUEDAS_DE_SETE,
    camadas: [camada('baixa', 12_050, 'cosworth-v10-baixa.wav'), camada('alta', 15_200, 'cosworth-v10-alta.wav')],
    alivio: null,
  },
  'ferrari-v8': {
    id: 'ferrari-v8',
    nome: 'Ferrari V8 — Ferrari F60 (2009)',
    troca: 17_800,
    corte: 18_000,
    largada: 11_500,
    segurando: 12_000,
    quedas: QUEDAS_V8,
    camadas: [camada('media', 13_850, 'ferrari-v8-media.wav'), camada('alta', 15_900, 'ferrari-v8-alta.wav')],
    alivio: null,
  },
  'mercedes-v8': {
    id: 'mercedes-v8',
    nome: 'Mercedes V8 — Brawn BGP 001 (2009)',
    troca: 17_800,
    corte: 18_000,
    largada: 13_300,
    segurando: 14_000,
    quedas: QUEDAS_V8,
    camadas: [camada('alta', 16_400, 'mercedes-v8-alta.wav'), camada('grito', 17_200, 'mercedes-v8-grito.wav')],
    alivio: camada('alivio', 12_900, 'mercedes-v8-alivio.wav'),
  },
  'renault-v8': {
    id: 'renault-v8',
    nome: 'Renault V8 — Red Bull RB5 (2009) e RB8 (2012)',
    troca: 17_800,
    corte: 18_000,
    largada: 10_500,
    segurando: 11_000,
    quedas: QUEDAS_V8,
    camadas: [
      camada('baixa', 11_500, 'renault-v8-baixa.wav'),
      camada('media', 14_500, 'renault-v8-media.wav'),
      camada('alta', 15_550, 'renault-v8-alta.wav'),
    ],
    alivio: null,
  },
  'hibrido-v6': {
    id: 'hibrido-v6',
    nome: 'V6 turbo híbrido (2024)',
    troca: 14_600,
    corte: 15_000,
    largada: 9_500,
    segurando: 10_000,
    quedas: QUEDAS_DE_OITO,
    camadas: [
      camada('baixa', 10_200, 'hibrido-v6-baixa.wav'),
      camada('media', 12_600, 'hibrido-v6-media.wav'),
      camada('alta', 14_350, 'hibrido-v6-alta.wav'),
    ],
    alivio: null,
  },
}

/** A voz padrão: o V10 da primeira gravação, o de quem ainda não escolheu. */
export const MOTOR_PADRAO = VOZES['mercedes-v10']

/**
 * O motor de cada carro da garagem, pela época e pela fábrica da pintura.
 *
 * Quando a gravação da fábrica certa não existe, entra a da mesma época: a
 * Lotus de 1985 ganha o V6 turbo TAG de 1986, e as duas Ferrari de V10, o
 * Mercedes de 2001 e o Cosworth de 2005 — uma cada, para as duas não soarem
 * iguais. Toda a era híbrida divide a mesma voz.
 */
const VOZ_DO_CARRO: Record<CarId, IdDaVoz> = {
  'senna-lotus': 'tag-v6-turbo',
  senna: 'honda-v6-turbo',
  'barrichello-ferrari': 'cosworth-v10',
  schumacher: 'mercedes-v10',
  'barrichello-brawn': 'mercedes-v8',
  'massa-ferrari': 'ferrari-v8',
  'massa-williams': 'hibrido-v6',
  'hamilton-mercedes': 'hibrido-v6',
  verstappen: 'hibrido-v6',
  'hamilton-ferrari': 'hibrido-v6',
  'bortoleto-audi': 'hibrido-v6',
  vettel: 'renault-v8',
  'raikkonen-mercedes': 'hibrido-v6',
  leclerc: 'hibrido-v6',
  'alonso-aston-martin': 'hibrido-v6',
  'alonso-renault': 'renault-v10',
}

/** A voz do motor de um carro; o desconhecido anda com a padrão. */
export function vozDoCarro(id: CarId | null | undefined): EspecificacaoDoMotor {
  const voz = id ? VOZ_DO_CARRO[id] : undefined
  return voz ? VOZES[voz] : MOTOR_PADRAO
}

// ---------------------------------------------------------------------------
// Câmbio e rotação
// ---------------------------------------------------------------------------

function limitar(valor: number, min: number, max: number) {
  return Math.max(min, Math.min(max, valor))
}

const marchasCalculadas = new Map<IdDaVoz, readonly number[]>()

/**
 * Rotação por unidade de velocidade em cada marcha de uma voz.
 *
 * A velocidade é a fração da de boost, a mesma de `feel`. A última marcha leva
 * o carro à rotação da troca no topo do boost, e as outras saem das quedas, de
 * cima para baixo. Com elas, o cruzeiro — perto de 0,8 — cai na penúltima,
 * a uns nove décimos da troca: o grito de uma reta, e não o ronco de volta de
 * apresentação.
 */
export function marchasDoMotor(voz: EspecificacaoDoMotor = MOTOR_PADRAO): readonly number[] {
  const guardadas = marchasCalculadas.get(voz.id)
  if (guardadas) return guardadas
  const marchas = [voz.troca]
  for (let i = voz.quedas.length - 1; i >= 0; i -= 1) marchas.unshift(marchas[0] / voz.quedas[i])
  marchasCalculadas.set(voz.id, marchas)
  return marchas
}

/** Velocidade em que cada marcha, exceto a última, troca para a seguinte. */
export function trocasDoMotor(voz: EspecificacaoDoMotor = MOTOR_PADRAO): readonly number[] {
  return marchasDoMotor(voz).slice(0, -1).map((k) => voz.troca / k)
}

/**
 * Folga para descer uma marcha, em fração da velocidade.
 *
 * Sem ela, um carro que anda justo na velocidade de uma troca — na grama, ou
 * encostado num obstáculo — sobe e desce de marcha a cada quadro, e o motor
 * gagueja.
 */
export const HISTERESE = 0.015

export type EstadoDoMotor = {
  /** Índice da marcha, de 0 (primeira) em diante. */
  marcha: number
  rpm: number
}

/**
 * Marcha e rotação para uma velocidade, lembrando a marcha anterior.
 *
 * Sobe de marcha na velocidade da troca e só desce um pouco abaixo dela. Em
 * primeira, a embreagem segura a rotação da largada até o carro alcançá-la.
 */
export function rotacaoF1(velocidade: number, marchaAnterior = 0, voz: EspecificacaoDoMotor = MOTOR_PADRAO): EstadoDoMotor {
  const marchas = marchasDoMotor(voz)
  const trocas = trocasDoMotor(voz)
  const v = Number.isFinite(velocidade) ? limitar(velocidade, 0, 1.2) : 0
  let marcha = Number.isInteger(marchaAnterior) ? limitar(marchaAnterior, 0, marchas.length - 1) : 0
  while (marcha < trocas.length && v >= trocas[marcha]) marcha += 1
  while (marcha > 0 && v < trocas[marcha - 1] - HISTERESE) marcha -= 1
  let rpm = v * marchas[marcha]
  if (marcha === 0) rpm = Math.max(voz.largada, rpm)
  return { marcha, rpm: Math.min(voz.corte, rpm) }
}

// A voz padrão, pelos nomes de sempre.
export const RPM_DA_TROCA = MOTOR_PADRAO.troca
export const RPM_DO_CORTE = MOTOR_PADRAO.corte
export const RPM_DA_LARGADA = MOTOR_PADRAO.largada
export const RPM_SEGURANDO = MOTOR_PADRAO.segurando
export const MARCHAS = marchasDoMotor(MOTOR_PADRAO)
export const TROCAS = trocasDoMotor(MOTOR_PADRAO)
export const CAMADAS_CHEIAS = MOTOR_PADRAO.camadas
export const CAMADA_DO_ALIVIO = MOTOR_PADRAO.alivio!

/** Todas as camadas de uma voz, na ordem em que a mistura as pesa: as cheias e o alívio. */
export function camadasDaVoz(voz: EspecificacaoDoMotor = MOTOR_PADRAO): readonly CamadaDoMotor[] {
  return voz.alivio ? [...voz.camadas, voz.alivio] : voz.camadas
}

export const CAMADAS = camadasDaVoz(MOTOR_PADRAO)

/**
 * O giro mais baixo em que a voz ainda soa como ela mesma: o da largada, ou
 * um pouco abaixo do que o piloto segura no grid. É a ponta de baixo da faixa
 * em que nenhuma camada é esticada além do que aguenta.
 */
export function pisoDaVoz(voz: EspecificacaoDoMotor = MOTOR_PADRAO) {
  return Math.min(voz.largada, voz.segurando - 700)
}

/**
 * O giro mais baixo, em fração do corte, que a física deixa numa troca feita
 * na janela: a primeira puxada até onde a janela abre, caindo a queda da
 * primeira para a segunda.
 */
export const GIRO_DEPOIS_DA_TROCA = GIRO_MINIMO_DA_JANELA * QUEDAS_DO_CAMBIO[0]

/**
 * Quanto da queda de giro da física a voz reproduz, de 0 a 1.
 *
 * Um, sempre que a gravação aguenta: o motor cai na troca exatamente o que o
 * câmbio cai. A voz gravada só no alto do giro — o V8 da Brawn, o V10 da
 * Williams — encolhe a queda o bastante para a troca mais funda cair no piso
 * dela, e não abaixo.
 */
export function profundidadeDaVoz(voz: EspecificacaoDoMotor = MOTOR_PADRAO) {
  return Math.min(1, (1 - pisoDaVoz(voz) / voz.corte) / (1 - GIRO_DEPOIS_DA_TROCA))
}

/**
 * Rotação da voz para uma marcha e um giro da física.
 *
 * O corte da física é o corte da voz, e a troca cai onde a física troca. Na
 * primeira a embreagem patina: o motor não cai abaixo do giro da largada. Numa
 * marcha longa demais o giro afunda abaixo do piso — é o motor se arrastando,
 * e é para soar assim —, até um quinto abaixo dele.
 */
export function rpmDaVoz(voz: EspecificacaoDoMotor, marcha: number, giro: number) {
  const g = Number.isFinite(giro) ? limitar(giro, 0, 1) : 0
  const rpm = voz.corte * (1 - profundidadeDaVoz(voz) * (1 - g))
  if (!(marcha > 0)) return Math.max(voz.largada, rpm)
  return Math.max(pisoDaVoz(voz) * 0.8, rpm)
}

/**
 * O escapamento de cada voz: onde o estalo tem corpo (`tom`, em hertz),
 * quanto ele aparece por cima do motor (`forca`), e se a voz tem a válvula de
 * alívio dos turbos dos anos oitenta, que sopra a cada troca e a cada tirada
 * de pé.
 *
 * O V10 estala agudo e seco; o V8, um pouco mais grave. O híbrido também tem
 * turbina, mas ela abafa o escapamento em vez de soprar: estalos baixos e
 * escuros.
 */
export type Escapamento = { tom: number; forca: number; turbo: boolean }

export const ESCAPAMENTO: Record<IdDaVoz, Escapamento> = {
  'mercedes-v10': { tom: 2_300, forca: 0.5, turbo: false },
  'renault-v10': { tom: 2_200, forca: 0.5, turbo: false },
  'cosworth-v10': { tom: 2_400, forca: 0.5, turbo: false },
  'ferrari-v8': { tom: 1_900, forca: 0.55, turbo: false },
  'mercedes-v8': { tom: 1_800, forca: 0.55, turbo: false },
  'renault-v8': { tom: 1_850, forca: 0.55, turbo: false },
  'honda-v6-turbo': { tom: 1_400, forca: 0.45, turbo: true },
  'tag-v6-turbo': { tom: 1_300, forca: 0.45, turbo: true },
  'hibrido-v6': { tom: 1_100, forca: 0.3, turbo: false },
}

// ---------------------------------------------------------------------------
// Mistura
// ---------------------------------------------------------------------------

/**
 * Peso de cada camada para uma rotação e uma carga.
 *
 * A plena carga, tocam as duas camadas vizinhas da rotação, cruzadas com
 * potência constante: no meio do caminho entre duas, cada uma entra com
 * 0,71, e a soma de energia é sempre a mesma. O caminho é medido em escala
 * logarítmica, que é como o ouvido mede altura: no meio dele, as duas camadas
 * estão esticadas por igual, uma para cima e a outra para baixo, e nenhuma
 * passa da raiz da distância entre elas. Abaixo da primeira e acima da
 * última, toca só a da ponta, esticada até a rotação. `carga` de 0 a 1 passa
 * a mistura para o laço sem carga, também com potência constante; a voz que
 * não tem esse laço segue nas cheias, e quem abaixa o volume é o motor.
 *
 * Devolve um peso por camada de `camadasDaVoz`, na mesma ordem.
 */
export function pesosDasCamadas(rpm: number, carga = 1, voz: EspecificacaoDoMotor = MOTOR_PADRAO): number[] {
  const r = Number.isFinite(rpm) ? rpm : voz.segurando
  const c = Number.isFinite(carga) ? limitar(carga, 0, 1) : 1
  const cheias = voz.camadas
  const pesos = camadasDaVoz(voz).map(() => 0)
  if (r <= cheias[0].rpm) {
    pesos[0] = 1
  } else if (r >= cheias[cheias.length - 1].rpm) {
    pesos[cheias.length - 1] = 1
  } else {
    let i = 0
    while (r > cheias[i + 1].rpm) i += 1
    const t = Math.log(r / cheias[i].rpm) / Math.log(cheias[i + 1].rpm / cheias[i].rpm)
    pesos[i] = Math.cos((t * Math.PI) / 2)
    pesos[i + 1] = Math.sin((t * Math.PI) / 2)
  }
  if (!voz.alivio) return pesos
  const cheia = Math.sin((c * Math.PI) / 2)
  for (let i = 0; i < cheias.length; i += 1) pesos[i] *= cheia
  pesos[pesos.length - 1] = Math.cos((c * Math.PI) / 2)
  return pesos
}

/**
 * Velocidade de leitura de uma camada para soar numa rotação.
 *
 * Limitada a meia oitava para cada lado: além disso a gravação vira desenho
 * animado. As camadas estão perto o bastante umas das outras para isso nunca
 * acontecer dentro da faixa do motor.
 */
export function taxaDaCamada(camada: CamadaDoMotor, rpm: number) {
  return limitar(rpm / camada.rpm, 0.7, 1.42)
}

/**
 * Ganho que casa o volume das amostras com o dos osciladores.
 *
 * Medido numa corrida renderizada fora de tempo real, com vento e rolamento
 * iguais nas duas: sem ele, o V10 gravado saía sete decibéis abaixo da serra
 * dos osciladores, e trocar de um para o outro no meio da contagem soava como
 * o carro se afastando. Todas as camadas foram gravadas no mesmo volume
 * eficaz, então o ganho vale para todas as vozes.
 */
const GANHO_DAS_AMOSTRAS = 2.1

/**
 * Volume do motor para o estado da corrida.
 *
 * Sobe com a rotação e com o boost, como o dos osciladores. Antes da largada e
 * depois da bandeirada o carro está parado, com o giro segurado, e o motor
 * fica mais baixo para deixar ouvir as luzes.
 */
export function volumeDoMotor(levels: AudioLevels, rpm: number, voz: EspecificacaoDoMotor = MOTOR_PADRAO) {
  const giro = limitar((rpm - voz.segurando) / (voz.corte - voz.segurando), 0, 1)
  if (!levels.running) return 0.55 * GANHO_DAS_AMOSTRAS
  return (0.8 + giro * 0.35 + limitar(levels.boost, 0, 1) * 0.2) * GANHO_DAS_AMOSTRAS
}

// ---------------------------------------------------------------------------
// Ligação com o Web Audio
// ---------------------------------------------------------------------------

/**
 * Laços já decodificados, compartilhados entre corridas.
 *
 * Cada corrida abre um contexto de áudio novo, mas um `AudioBuffer` pode tocar
 * em qualquer contexto: baixar e decodificar uma vez basta para a tarde toda.
 */
const lacos = new Map<string, Promise<AudioBuffer | null>>()

/**
 * Bytes da voz baixados antes da corrida, ainda por decodificar: decodificar
 * pede um contexto de áudio, e o da corrida só nasce na tela da corrida. Até
 * lá, o que dá para adiantar é o download.
 */
const bytesAdiantados = new Map<string, Promise<ArrayBuffer | null>>()

/**
 * Começa a baixar os arquivos da voz — no menu, na garagem, no lobby.
 *
 * A largada da sala é a mesma para todos: sem isso, os seis celulares pedem
 * os mesmos arquivos no mesmo segundo, pelo mesmo Wi-Fi, e a prova larga no
 * sintetizador. Guarda uma voz de cada vez: trocar de carro na garagem
 * descarta o que foi adiantado para a anterior.
 */
export function precarregarVoz(voz: EspecificacaoDoMotor) {
  if (typeof fetch === 'undefined') return
  const arquivos = camadasDaVoz(voz).map((camada) => camada.arquivo)
  for (const arquivo of [...bytesAdiantados.keys()]) {
    if (!arquivos.includes(arquivo)) bytesAdiantados.delete(arquivo)
  }
  for (const arquivo of arquivos) {
    if (lacos.has(arquivo) || bytesAdiantados.has(arquivo)) continue
    const bytes = fetch(arquivo)
      .then((resposta) => (resposta.ok ? resposta.arrayBuffer() : null))
      .catch(() => null)
    bytesAdiantados.set(arquivo, bytes)
  }
}

function laco(ctx: AudioHost, arquivo: string) {
  const guardado = lacos.get(arquivo)
  if (guardado) return guardado
  const decodificar = (ctx as Partial<Pick<AudioContext, 'decodeAudioData'>>).decodeAudioData
  if (typeof fetch === 'undefined' || typeof decodificar !== 'function') return Promise.resolve(null)
  // Os bytes adiantados servem uma vez só: decodificar consome o buffer.
  const adiantado = bytesAdiantados.get(arquivo) ?? Promise.resolve(null)
  bytesAdiantados.delete(arquivo)
  const baixar = () =>
    fetch(arquivo).then((resposta) =>
      resposta.ok ? resposta.arrayBuffer() : Promise.reject(new Error(`${resposta.status}`)),
    )
  const promessa = adiantado
    .then((bytes) => bytes ?? baixar())
    .then((bytes) => decodificar.call(ctx, bytes))
    .catch(() => {
      // Sem a amostra, o sintetizador segue valendo; na próxima corrida tenta de novo.
      lacos.delete(arquivo)
      return null
    })
  lacos.set(arquivo, promessa)
  return promessa
}

/** Constante de tempo das rampas de volume e de rotação. */
const RAMPA = 0.05

/** Desaceleração, em fração da velocidade por segundo, que tira o pé do motor. */
const DESACELERACAO_SEM_CARGA = 0.05

/** Quanto o motor abaixa com o pé fora, na voz que não tem o laço sem carga. */
const PE_FORA_SEM_LACO = 0.45

/**
 * Por quanto tempo, depois de tirar o pé, o escapamento ainda estoura, em
 * segundos. Os primeiros estouros vêm juntos e fortes; os últimos, espaçados.
 */
const DURACAO_DOS_ESTOUROS = 1.1

/**
 * Quanto o estalo da subida sai mais forte que um estouro comum: medido fora
 * de tempo real, é o que o faz passar por cima do motor por um instante, em
 * vez de só tapar o buraco do corte de ignição.
 */
const ESTALO_DA_SUBIDA = 1.8

/**
 * Engasgos do limitador por segundo. O corte de ignição liga e desliga
 * depressa, e o ouvido lê isso como o "brrrrr" de quem esqueceu de trocar.
 */
const FREQUENCIA_DO_LIMITADOR = 16

export class MotorF1 {
  private readonly saida: GainNode
  /** Por onde o motor passa antes de sair: é aqui que o limitador engasga. */
  private readonly corte: GainNode
  /** Estalos, estouros e sopros: fora do motor, para o corte da troca não abafá-los. */
  private readonly efeitos: GainNode
  private readonly fontes: AudioBufferSourceNode[] = []
  private readonly ganhos: GainNode[] = []
  private readonly camadas: readonly CamadaDoMotor[]
  private ativo = false
  private encerrado = false
  private marcha = 0
  private carga = 1
  private velocidadeAnterior = 0
  private tempoAnterior: number | null = null
  private oscilacao = 0
  /** Até quando a rotação e o volume seguem o que a troca agendou, no relógio do áudio. */
  private trocaAte = 0
  /** Desde quando o pé está fora, no relógio do áudio; null com o pé no acelerador. */
  private semCargaDesde: number | null = null
  private proximoEstouro = 0
  /** O limitador nasce na primeira batida no corte: quem nunca bate não paga o oscilador. */
  private limitador: { lfo: OscillatorNode; profundidade: GainNode } | null = null
  /** Mudo, os estalos nem são montados: atrás do volume zero custariam o mesmo. */
  silenciado = false

  constructor(
    private readonly ctx: AudioHost,
    destino: AudioNode,
    private readonly voz: EspecificacaoDoMotor = MOTOR_PADRAO,
    /** Ruído para os estalos e sopros; sem ele, as trocas soam só no motor. */
    private readonly ruido: AudioBuffer | null = null,
  ) {
    this.camadas = camadasDaVoz(voz)
    const agora = ctx.currentTime
    this.saida = ctx.createGain()
    this.saida.gain.setValueAtTime(0, agora)
    this.corte = ctx.createGain()
    this.corte.gain.setValueAtTime(1, agora)
    this.saida.connect(this.corte).connect(destino)
    this.efeitos = ctx.createGain()
    this.efeitos.gain.setValueAtTime(1, agora)
    this.efeitos.connect(destino)
    void this.carregar()
  }

  /** Verdadeiro depois que todas as camadas da voz chegaram e estão tocando. */
  get pronto() {
    return this.ativo
  }

  private async carregar() {
    const buffers = await Promise.all(this.camadas.map((camada) => laco(this.ctx, camada.arquivo)))
    if (this.encerrado || buffers.some((buffer) => !buffer)) return
    const agora = this.ctx.currentTime
    buffers.forEach((buffer, i) => {
      const fonte = this.ctx.createBufferSource()
      fonte.buffer = buffer
      fonte.loop = true
      const ganho = this.ctx.createGain()
      ganho.gain.setValueAtTime(0, agora)
      fonte.connect(ganho).connect(this.saida)
      // Cada laço começa num ponto diferente: se as voltas coincidissem, a
      // emenda de todas cairia no mesmo instante.
      fonte.start(agora, (buffer!.duration * (i + 1)) / (this.camadas.length + 1))
      this.fontes.push(fonte)
      this.ganhos.push(ganho)
    })
    this.ativo = true
  }

  /**
   * Atualiza rotação e mistura. Devolve verdadeiro quando as amostras estão
   * tocando — é a deixa para o sintetizador se calar.
   */
  update(levels: AudioLevels): boolean {
    if (this.encerrado || !this.ativo) return false
    const agora = this.ctx.currentTime
    const dt = this.tempoAnterior === null ? 0 : Math.max(0, agora - this.tempoAnterior)
    this.tempoAnterior = agora

    // Na corrida, a marcha e o giro vêm da física. Sem eles — na arquibancada,
    // que só conhece a velocidade —, o câmbio da voz escolhe sozinho.
    const daFisica = levels.running && levels.marcha !== undefined && levels.giro !== undefined
    let estado: EstadoDoMotor
    if (daFisica) {
      const marcha = Math.max(0, Math.round(levels.marcha!))
      estado = { marcha, rpm: rpmDaVoz(this.voz, marcha, levels.giro!) }
    } else if (levels.running) {
      estado = rotacaoF1(levels.speed, this.marcha, this.voz)
    } else if (levels.acelerador) {
      // No grid, pé no acelerador: o piloto segura o giro da largada, com o
      // tremor de quem está com o pé no fundo e a embreagem no ponto.
      this.oscilacao += dt
      estado = { marcha: 0, rpm: this.voz.largada + Math.sin(this.oscilacao * 11) * 110 }
    } else {
      // Parado no grid, o piloto brinca com o acelerador em volta do giro da
      // largada: uma onda lenta, para o motor não soar como gravação em laço.
      this.oscilacao += dt
      const brinca = Math.sin(this.oscilacao * 2.3) * 0.5 + Math.sin(this.oscilacao * 5.1) * 0.25
      estado = { marcha: 0, rpm: this.voz.segurando + brinca * 900 }
    }
    const trocouParaCima = estado.marcha > this.marcha
    const trocouParaBaixo = estado.marcha < this.marcha
    this.marcha = estado.marcha

    // Carga: com o pedal da física, o pé é o do piloto. Sem ele, pé fora
    // quando o carro perde velocidade: batida, grama, reset.
    const desacelerando = dt > 0 && (levels.speed - this.velocidadeAnterior) / dt < -DESACELERACAO_SEM_CARGA
    this.velocidadeAnterior = levels.speed
    const pedal = levels.acelerador !== undefined
    const cargaAlvo = !levels.running ? 1 : pedal ? (levels.acelerador && !levels.freando ? 1 : 0) : desacelerando ? 0 : 1
    const tempo = cargaAlvo < this.carga ? 0.06 : 0.22
    this.carga += (cargaAlvo - this.carga) * (1 - Math.exp(-dt / tempo))

    const pesos = pesosDasCamadas(estado.rpm, this.carga, this.voz)
    const peFora = this.voz.alivio ? 1 : 1 - PE_FORA_SEM_LACO * (1 - this.carga)
    const volume = volumeDoMotor(levels, estado.rpm, this.voz) * peFora
    const naTroca = agora < this.trocaAte
    this.camadas.forEach((camada, i) => {
      if (!naTroca) this.fontes[i].playbackRate.setTargetAtTime(taxaDaCamada(camada, estado.rpm), agora, RAMPA * 0.4)
      this.ganhos[i].gain.setTargetAtTime(pesos[i], agora, RAMPA)
    })
    if (trocouParaCima) this.subiu(agora, estado.rpm, volume)
    else if (trocouParaBaixo && levels.running) this.reduziu(agora, estado.rpm, volume)
    else if (!naTroca) this.saida.gain.setTargetAtTime(volume, agora, RAMPA)
    this.bateNoCorte(agora, daFisica && levels.noCorte === true)
    this.estouros(agora, levels.running && pedal && cargaAlvo === 0, estado.rpm)
    return true
  }

  /** O contexto andando e o som ligado: só então vale montar um estalo. */
  private get audivel() {
    return !this.silenciado && this.ctx.state === 'running'
  }

  /**
   * Troca para cima. A de Fórmula 1 leva uns quarenta milissegundos: o giro
   * despenca, a ignição corta por um instante — o soluço que marca cada
   * marcha — e o escapamento estala. No turbo dos anos oitenta, a válvula de
   * alívio sopra junto.
   */
  private subiu(agora: number, rpm: number, volume: number) {
    this.trocaAte = agora + 0.05
    this.camadas.forEach((camada, i) => {
      const taxa = this.fontes[i].playbackRate
      taxa.cancelScheduledValues(agora)
      taxa.setTargetAtTime(taxaDaCamada(camada, rpm), agora, 0.01)
    })
    const ganho = this.saida.gain
    ganho.cancelScheduledValues(agora)
    ganho.setTargetAtTime(volume * 0.28, agora, 0.006)
    ganho.setTargetAtTime(volume, agora + 0.028, 0.016)
    if (!this.audivel) return
    const { tom, forca, turbo } = ESCAPAMENTO[this.voz.id]
    // O estalo passa por cima do motor: é o "brap" que marca a troca.
    this.estalo(agora + 0.004, forca * ESTALO_DA_SUBIDA, tom, 0.035)
    if (turbo) this.sopro(agora + 0.012, forca * 0.45)
  }

  /**
   * Redução. Ninguém pisa na embreagem num Fórmula 1: o câmbio dá um toque no
   * acelerador, o giro pula acima do da marcha nova e volta, e o escapamento
   * pipoca. Numa frenagem forte, é a sequência de "bwap, bwap, bwap".
   */
  private reduziu(agora: number, rpm: number, volume: number) {
    this.trocaAte = agora + 0.1
    const pulo = Math.min(this.voz.corte, rpm * 1.07)
    this.camadas.forEach((camada, i) => {
      const taxa = this.fontes[i].playbackRate
      taxa.cancelScheduledValues(agora)
      taxa.setTargetAtTime(taxaDaCamada(camada, pulo), agora, 0.01)
      taxa.setTargetAtTime(taxaDaCamada(camada, rpm), agora + 0.06, 0.025)
    })
    const ganho = this.saida.gain
    ganho.cancelScheduledValues(agora)
    ganho.setTargetAtTime(volume * 1.18, agora, 0.008)
    ganho.setTargetAtTime(volume, agora + 0.06, 0.03)
    if (!this.audivel) return
    const { tom, forca } = ESCAPAMENTO[this.voz.id]
    this.estalo(agora + 0.035 + Math.random() * 0.02, forca * 0.7, tom * 0.55, 0.035)
    this.estalo(agora + 0.09 + Math.random() * 0.04, forca * 0.45, tom * 0.5, 0.03)
  }

  /**
   * O limitador: batendo no corte, a ignição liga e desliga depressa e o motor
   * engasga. Um oscilador quadrado, suavizado para não estalar a cada corte,
   * mexe no volume do motor enquanto o carro está no corte.
   */
  private bateNoCorte(agora: number, ligado: boolean) {
    if (!ligado && !this.limitador) return
    if (!this.limitador) {
      const lfo = this.ctx.createOscillator()
      lfo.type = 'square'
      lfo.frequency.setValueAtTime(FREQUENCIA_DO_LIMITADOR, agora)
      const suave = this.ctx.createBiquadFilter()
      suave.type = 'lowpass'
      suave.frequency.setValueAtTime(140, agora)
      const profundidade = this.ctx.createGain()
      profundidade.gain.setValueAtTime(0, agora)
      lfo.connect(suave).connect(profundidade).connect(this.corte.gain)
      lfo.start(agora)
      this.limitador = { lfo, profundidade }
    }
    // O volume oscila entre um terço e o cheio: o motor não some, engasga.
    this.limitador.profundidade.gain.setTargetAtTime(ligado ? 0.33 : 0, agora, 0.015)
    this.corte.gain.setTargetAtTime(ligado ? 0.67 : 1, agora, 0.015)
  }

  /**
   * Pé fora em giro alto: o combustível que sobra estoura no escapamento. É o
   * som de toda frenagem de Fórmula 1 — estouros fortes e juntos logo que o
   * piloto tira o pé, cada vez mais fracos e espaçados.
   */
  private estouros(agora: number, peFora: boolean, rpm: number) {
    if (!peFora) {
      this.semCargaDesde = null
      return
    }
    const { tom, forca, turbo } = ESCAPAMENTO[this.voz.id]
    if (this.semCargaDesde === null) {
      this.semCargaDesde = agora
      this.proximoEstouro = agora + 0.04
      if (turbo && this.audivel) this.sopro(agora + 0.02, forca * 0.4)
    }
    const desde = agora - this.semCargaDesde
    const piso = pisoDaVoz(this.voz)
    const giroAlto = (rpm - piso) / Math.max(1, this.voz.corte - piso)
    if (desde > DURACAO_DOS_ESTOUROS || giroAlto < 0.2 || agora < this.proximoEstouro) return
    this.proximoEstouro = agora + 0.045 + Math.random() * 0.12 + desde * 0.12
    if (!this.audivel) return
    const resto = 1 - desde / DURACAO_DOS_ESTOUROS
    const forcaDoEstouro = forca * (0.25 + Math.random() * 0.35) * resto
    this.estalo(agora + Math.random() * 0.015, forcaDoEstouro, tom * (0.45 + Math.random() * 0.2), 0.025 + Math.random() * 0.03)
  }

  /**
   * Um estalo do escapamento: um golpe de ruído na faixa do tom, que some em
   * poucas dezenas de milissegundos, com um baque grave por baixo.
   */
  private estalo(quando: number, forca: number, tom: number, duracao: number) {
    if (!this.ruido || !(forca > 0)) return
    const fonte = this.ctx.createBufferSource()
    fonte.buffer = this.ruido
    const filtro = this.ctx.createBiquadFilter()
    filtro.type = 'bandpass'
    filtro.frequency.setValueAtTime(tom, quando)
    filtro.Q.setValueAtTime(0.9, quando)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, quando)
    ganho.gain.linearRampToValueAtTime(forca, quando + 0.002)
    ganho.gain.exponentialRampToValueAtTime(0.0005, quando + duracao)
    fonte.connect(filtro).connect(ganho).connect(this.efeitos)
    // Cada estalo lê um trecho diferente do ruído: dois seguidos não soam iguais.
    fonte.start(quando, Math.random() * Math.max(0, this.ruido.duration - 0.2), duracao + 0.02)
    soltarAoAcabar(fonte, filtro, ganho)

    const baque = this.ctx.createOscillator()
    baque.type = 'sine'
    baque.frequency.setValueAtTime(70 + tom * 0.04, quando)
    baque.frequency.exponentialRampToValueAtTime(42, quando + duracao * 1.3)
    const ganhoDoBaque = this.ctx.createGain()
    ganhoDoBaque.gain.setValueAtTime(0, quando)
    ganhoDoBaque.gain.linearRampToValueAtTime(forca * 0.7, quando + 0.003)
    ganhoDoBaque.gain.exponentialRampToValueAtTime(0.0005, quando + duracao * 1.3)
    baque.connect(ganhoDoBaque).connect(this.efeitos)
    baque.start(quando)
    baque.stop(quando + duracao * 1.3 + 0.02)
    soltarAoAcabar(baque, ganhoDoBaque)
  }

  /** A válvula de alívio do turbo: um sopro agudo que some em dois décimos. */
  private sopro(quando: number, forca: number) {
    if (!this.ruido || !(forca > 0)) return
    const fonte = this.ctx.createBufferSource()
    fonte.buffer = this.ruido
    const grave = this.ctx.createBiquadFilter()
    grave.type = 'highpass'
    grave.frequency.setValueAtTime(1_800, quando)
    const faixa = this.ctx.createBiquadFilter()
    faixa.type = 'bandpass'
    faixa.frequency.setValueAtTime(4_200, quando)
    faixa.frequency.exponentialRampToValueAtTime(2_600, quando + 0.22)
    faixa.Q.setValueAtTime(0.7, quando)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, quando)
    ganho.gain.linearRampToValueAtTime(forca, quando + 0.015)
    ganho.gain.exponentialRampToValueAtTime(0.0005, quando + 0.22)
    fonte.connect(grave).connect(faixa).connect(ganho).connect(this.efeitos)
    fonte.start(quando, Math.random() * Math.max(0, this.ruido.duration - 0.4), 0.25)
    soltarAoAcabar(fonte, grave, faixa, ganho)
  }

  close() {
    if (this.encerrado) return
    this.encerrado = true
    const fontes: AudioScheduledSourceNode[] = [...this.fontes]
    if (this.limitador) fontes.push(this.limitador.lfo)
    for (const fonte of fontes) {
      try {
        fonte.stop()
      } catch {
        // Já parada.
      }
    }
  }
}
