/**
 * Folha de sprites do carro.
 *
 * A pintura de cada carro é a arte de `public/carros`, a mesma que o menu, a
 * seleção e o lobby mostram. Girá-la e cisalhá-la para cada pose de curva a
 * cada quadro, para seis carros na pista, custaria caro num celular — e não
 * haveria ganho nenhum, porque entre um quadro e o outro quase nada muda no
 * desenho. Então o carro é assado uma vez numa folha de sprites, do jeito que
 * um jogo de pista sempre fez: uma tira de quadros de curva, da derrapagem
 * toda à esquerda à derrapagem toda à direita, passando pelo carro reto no
 * meio. O laço de corrida escolhe o quadro e faz um `drawImage`.
 *
 * O que sobra para a hora do desenho é o que varia continuamente e não caberia
 * em quadro nenhum: a posição, a escala com a distância, a inclinação da
 * carroceria, a trepidação fora do asfalto e o brilho do boost.
 *
 * Enquanto a imagem não chega — ou se ela não chegar —, a folha sai do molde
 * vetorial de `carModel.ts`, que tem as mesmas medidas: a corrida nunca espera
 * um arquivo para largar.
 */
import { CAR_ART, type CarId } from './cars'
import {
  CAIXA_CARRO,
  COR_DA_TERRA,
  LINHA_DO_CHAO,
  MANCHAS_DE_TERRA,
  PARTS,
  RODAS,
  SOMBRA_DE_CONTATO,
  WHEEL_CENTERS,
  carModel,
  manchasDeTerra,
  sombraDeContato,
  yawTransform,
  type CarModel,
  type ManchaDeSombra,
  type ManchaDeTerra,
  type Part,
  type Roda,
} from './carModel'
import { densidadeDe, nivelDaReducao } from './reducoes'
import { CAR_SPRITE_HALF_WIDTH } from './track'

const RODAS_TRASEIRAS = ['traseiraEsquerda', 'traseiraDireita'] as const
const RODA_ESQUERDA = 'dianteiraEsquerda'
const RODA_DIREITA = 'dianteiraDireita'

function ehRoda(part: Part): part is keyof typeof WHEEL_CENTERS {
  return part in WHEEL_CENTERS
}

/** Tipografia dos decalques, a mesma da interface do jogo. */
const FONTE = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif"

/** Endereço da arte do carro, gerada por `npm run carros` a partir de `arte/carros`. */
export function carImageUrl(id: CarId) {
  return `/carros/${id}.png`
}

/**
 * Deformações de apresentação do carro.
 *
 * Tudo aqui sai de `feel.ts`, que por sua vez só lê a simulação. Nada disso
 * volta para a corrida: não desloca a hitbox, não muda a posição competitiva e
 * não atrasa o comando.
 */
export type CarPose = {
  /** Inclinação da carroceria, em radianos. */
  tilt: number
  /** Curso da suspensão: negativo estica, positivo afunda. */
  suspension: number
  /** Esterço visual das rodas dianteiras, de -1 a 1. */
  steer: number
  /**
   * Derrapagem, de -1 a 1, com o sinal do lado para onde o carro gira.
   *
   * Soma ao esterço no eixo de poses da folha: com o volante todo virado e a
   * derrapagem cheia, o carro está atravessado, com as rodas contraesterçando.
   */
  drift: number
  /** Brilho da luz de chuva e do escapamento durante o boost, de 0 a 1. */
  boost: number
  /**
   * Brilho da luz de chuva na frenagem, de 0 a 1, já com a piscada. É a luz
   * que o Fórmula 1 pisca quando recupera energia freando: o aviso a quem
   * vem atrás. Ausente, apagada.
   */
  freio?: number
  /** Trepidação fora do asfalto, em unidades do desenho. */
  jitter: number
  /** Terra na carroceria depois da grama, de 0 a 1. */
  dirt: number
  /** Distância percorrida: é dela que sai a fase do rolamento dos pneus. */
  travel: number
}

/**
 * As poses da folha, num eixo só: de -2 a 2.
 *
 * De -1 a 1 é a curva comum, e são os nove quadros de sempre: nove é o menor
 * número em que a passagem de um ao seguinte não se nota na velocidade em que
 * o volante anda. Além de 1 é a derrapagem, em três quadros de cada lado: o
 * carro gira mais do que a curva pede, a traseira escapa e as rodas da frente
 * voltam para o outro lado. Três bastam porque a derrapagem entra e sai em
 * dois décimos de segundo, e ninguém conta quadros nesse tempo.
 */
const POSES = [-2, -5 / 3, -4 / 3, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 4 / 3, 5 / 3, 2]
const QUADROS = POSES.length
/** Índice do quadro reto, no meio da tira. */
const QUADRO_RETO = POSES.indexOf(0)

/** Guinada do carro no esterço máximo da curva comum: sete graus. */
const GUINADA_NA_CURVA = 0.122

/** Guinada a mais na derrapagem cheia: o carro chega a treze graus atravessado. */
const GUINADA_NA_DERRAPAGEM = 0.105

/**
 * Quanto as rodas da frente contraesterçam na derrapagem cheia, em frações do
 * esterço máximo. É o detalhe que diz "o piloto está segurando o carro" e não
 * "o carro está só virando mais".
 */
const CONTRAESTERCO = 0.65

/** Rolagem a mais na derrapagem cheia, em frações da rolagem do esterço máximo. */
const ROLAGEM_NA_DERRAPAGEM = 0.6

/** Guinada de uma pose, em radianos: positiva com o bico para a direita. */
function guinadaDaPose(pose: number) {
  const a = Math.min(2, Math.abs(pose))
  return Math.sign(pose) * (a <= 1 ? a * GUINADA_NA_CURVA : GUINADA_NA_CURVA + (a - 1) * GUINADA_NA_DERRAPAGEM)
}

/** Esterço das rodas da frente em relação à carroceria, de -1 a 1. */
function estercoDaPose(pose: number) {
  const a = Math.min(2, Math.abs(pose))
  return Math.sign(pose) * (a <= 1 ? a : 1 - (a - 1) * (1 + CONTRAESTERCO))
}

/** Rolagem da carroceria sobre a suspensão, em radianos. */
function rolagemDaPose(pose: number) {
  const a = Math.min(2, Math.abs(pose))
  return Math.sign(pose) * INCLINACAO * (a <= 1 ? a : 1 + (a - 1) * ROLAGEM_NA_DERRAPAGEM)
}

/** Quadro da folha mais perto de uma pose contínua. */
export function frameForPose(pose: number) {
  const valida = Number.isFinite(pose) ? pose : 0
  const a = Math.min(2, Math.abs(valida))
  const passos = a <= 1 ? Math.round(a * 4) : 4 + Math.round((a - 1) * 3)
  return QUADRO_RETO + Math.sign(valida) * passos
}

/** A pose que um quadro da folha guarda. */
export function poseOfFrame(quadro: number) {
  return POSES[quadro]
}

/** Quantos quadros a folha tem. */
export const CAR_FRAMES = QUADROS

/**
 * Pixels por unidade do desenho na folha.
 *
 * O carro do jogador chega a ocupar umas três vezes a escala base numa tela
 * larga. Quatro deixa margem para isso sem a folha virar uma textura enorme.
 */
const RESOLUCAO = 4

/**
 * Quanto a sombra responde ao curso da suspensão.
 *
 * O curso é pequeno — centésimos —, e a sombra precisa de um movimento que se
 * veja. Seis é o fator em que afundar na arrancada fecha a mancha o bastante
 * para se notar sem que o topo de uma lomba a faça sumir.
 */
const SOMBRA_POR_CURSO = 6

/**
 * Quanto a sombra escorrega para o lado quando a carroceria rola.
 *
 * A carroceria gira em torno da linha do chão, então o ponto de apoio não sai
 * do lugar — o que escorrega é o vulto projetado pelo sol, que vem de cima e
 * da esquerda. Daí o valor ser pequeno: é um vulto se deslocando, não o carro.
 */
const SOMBRA_POR_INCLINACAO = 16

/** Inclinação da carroceria no esterço máximo, em radianos. */
const INCLINACAO = 0.055
/** Quanto a roda dianteira deita no esterço máximo. */
const ESTERCO_DA_RODA = 0.3
/** Quanto o piloto se joga para dentro da curva, em unidades do desenho. */
const PILOTO_NA_CURVA = 1.4

type Afim = readonly [number, number, number, number, number, number]

const IDENTIDADE: Afim = [1, 0, 0, 1, 0, 0]

function aplicar(ctx: CanvasRenderingContext2D, t: Afim) {
  ctx.transform(t[0], t[1], t[2], t[3], t[4], t[5])
}

// ---------------------------------------------------------------------------
// A arte de cada carro
// ---------------------------------------------------------------------------

/**
 * Unidades do desenho por pixel da arte original.
 *
 * Sai da largura de pneu a pneu casada com `CAR_SPRITE_HALF_WIDTH`, a mesma
 * medida de onde vêm o limite de saída de pista e a posição da poeira: a arte
 * ocupa na tela exatamente a largura que a regra cobra, como o molde.
 */
const UNIDADE_DA_ARTE = (CAR_SPRITE_HALF_WIDTH * 2) / CAR_ART.tyreSpan

/** Um ponto da arte original em unidades do desenho: o chão dela cai na linha do chão do molde. */
function daArte(x: number, y: number): [number, number] {
  return [(x - CAR_ART.centerX) * UNIDADE_DA_ARTE, (y - CAR_ART.groundY) * UNIDADE_DA_ARTE + LINHA_DO_CHAO]
}

/**
 * Pneu traseiro esquerdo na arte original, em pixels dela.
 *
 * Não está em `CAR_ART` porque o recorte não precisa dele: a roda de trás não
 * esterça e fica na carroceria. A corrida precisa — é sob ele que fica a
 * sombra, é nele que rola a banda do pneu e é dele que sai o barro. Medido nas
 * dezesseis artes, que saem todas do mesmo molde e o têm no mesmo lugar.
 */
const PNEU_TRASEIRO_DA_ARTE = { x: 38, y: 923, width: 203, height: 365 }

type Caixa = { x: number; y: number; width: number; height: number }

/** Centro de um pneu da arte, espelhado para o lado pedido. */
function centroNaArte(caixa: Caixa, lado: -1 | 1): [number, number] {
  const [x, y] = daArte(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
  return [lado * Math.abs(x), y]
}

/** Centro de cada roda na arte. A via dianteira dela é mais fechada que a do molde. */
const RODAS_DA_ARTE: Record<Roda, readonly [number, number]> = {
  dianteiraEsquerda: centroNaArte(CAR_ART.frontWheel, -1),
  dianteiraDireita: centroNaArte(CAR_ART.frontWheel, 1),
  traseiraEsquerda: centroNaArte(PNEU_TRASEIRO_DA_ARTE, -1),
  traseiraDireita: centroNaArte(PNEU_TRASEIRO_DA_ARTE, 1),
}

const medidaNaArte = (caixa: Caixa) => ({
  meiaLargura: (caixa.width / 2) * UNIDADE_DA_ARTE,
  meiaAltura: (caixa.height / 2) * UNIDADE_DA_ARTE,
})
const PNEUS_DA_ARTE = { dianteira: medidaNaArte(CAR_ART.frontWheel), traseira: medidaNaArte(PNEU_TRASEIRO_DA_ARTE) }

const SOMBRA_DA_ARTE = sombraDeContato(RODAS_DA_ARTE, PNEUS_DA_ARTE)

/** Onde o barro pode grudar na arte. Cada carro fica só com as manchas que caem sobre ele. */
const MANCHAS_DA_ARTE = manchasDeTerra(RODAS_DA_ARTE)

/** A luz de chuva vem do molde das artes; o escapamento fica logo acima dela, no eixo. */
const LUZ_DA_ARTE = { x: 0, y: daArte(CAR_ART.rearLight.x, CAR_ART.rearLight.y)[1], raio: 2.2 }
const ESCAPAMENTO_DA_ARTE = { x: 0, y: LUZ_DA_ARTE.y - 4.2, raio: 1.5 }

/**
 * A guinada da carroceria da arte, como transformação afim.
 *
 * A arte não tem camadas: é uma imagem só, com as rodas da frente recortadas.
 * Mas numa câmera alta e distante girar o carro é, em boa aproximação,
 * deslizar cada linha do desenho de lado na proporção da profundidade dela — e
 * na arte a profundidade cresce com a altura na tela. Então a carroceria é
 * cisalhada de modo que as linhas dos dois eixos andem exatamente o que as
 * rodas do molde andam: as rodas da frente recortadas, a sombra e a banda do
 * pneu continuam coladas nela em qualquer quadro.
 */
function guinadaDaArte(guinada: number): Afim {
  if (guinada === 0) return IDENTIDADE
  const frente = yawTransform(RODA_ESQUERDA, guinada)[4]
  const tras = yawTransform('traseiraEsquerda', guinada)[4]
  const yFrente = RODAS_DA_ARTE.dianteiraEsquerda[1]
  const yTras = RODAS_DA_ARTE.traseiraEsquerda[1]
  const cisalhamento = (frente - tras) / (yFrente - yTras)
  return [Math.cos(guinada), 0, cisalhamento, 1, tras - cisalhamento * yTras, 0]
}

/**
 * A guinada de cada camada em cada quadro, e a da carroceria da arte,
 * calculadas uma vez. O carro é desenhado uma vez por carro na pista a cada
 * quadro de jogo, e o laço de quadro não aloca: a sombra de cada roda, as
 * marcas de rolamento, a terra e o brilho do boost leem daqui.
 */
const GUINADAS: readonly Record<Part, Afim>[] = POSES.map((pose) => {
  const guinada = guinadaDaPose(pose)
  const porParte = {} as Record<Part, Afim>
  for (const part of PARTS) porParte[part] = yawTransform(part, guinada)
  return porParte
})
const CORPO_DA_ARTE: readonly Afim[] = POSES.map((pose) => guinadaDaArte(guinadaDaPose(pose)))
const CORPO_DO_MOLDE: readonly Afim[] = GUINADAS.map((guinadas) => guinadas.lateral)
const TRASEIRA_DO_MOLDE: readonly Afim[] = GUINADAS.map((guinadas) => guinadas.traseira)

/** Onde um ponto do desenho cai no quadro de uma pose: a guinada da peça, depois a rolagem do quadro. */
function noQuadro(pose: number, t: Afim, x: number, y: number) {
  const gx = t[0] * x + t[2] * y + t[4]
  const acima = t[1] * x + t[3] * y + t[5] - LINHA_DO_CHAO
  const giro = rolagemDaPose(pose)
  return gx * Math.cos(giro) - acima * Math.sin(giro)
}

/**
 * Caixa de cada quadro da folha, mais larga que a do retrato.
 *
 * Atravessado, o carro sai da caixa parado: o bico vai para um lado e a
 * traseira para o outro, e a rolagem ainda leva o alto das rodas da frente
 * para fora. A folga é medida, e não chutada — são os cantos de fora dos
 * pneus, as peças mais largas do carro, em cada quadro, no molde e na arte.
 */
const MEIA_LARGURA_DA_FOLHA = (() => {
  let maior = -CAIXA_CARRO.x
  POSES.forEach((pose, indice) => {
    const deitada = estercoDaPose(pose) * ESTERCO_DA_RODA
    for (const roda of RODAS) {
      const frente = roda.startsWith('dianteira')
      const t = GUINADAS[indice][roda]
      const [x, y] = WHEEL_CENTERS[roda]
      for (const dy of [-9, 9]) maior = Math.max(maior, Math.abs(noQuadro(pose, t, x + Math.sign(x) * 7, y + dy)))
      // Na arte, a roda da frente é peça solta e deita com o esterço; a de
      // trás vai com a carroceria.
      const [ax, ay] = RODAS_DA_ARTE[roda]
      const { meiaLargura, meiaAltura } = frente ? PNEUS_DA_ARTE.dianteira : PNEUS_DA_ARTE.traseira
      for (const dy of [-meiaAltura, meiaAltura]) {
        const fora = ax + Math.sign(ax) * meiaLargura + (frente ? deitada * dy : 0)
        maior = Math.max(maior, Math.abs(noQuadro(pose, frente ? t : CORPO_DA_ARTE[indice], fora, ay + dy)))
      }
    }
  })
  return Math.ceil(maior + 2)
})()
const CAIXA_DA_FOLHA = { x: -MEIA_LARGURA_DA_FOLHA, y: CAIXA_CARRO.y, largura: MEIA_LARGURA_DA_FOLHA * 2, altura: CAIXA_CARRO.altura }

const LARGURA_QUADRO = Math.ceil(CAIXA_DA_FOLHA.largura * RESOLUCAO)
const ALTURA_QUADRO = Math.ceil(CAIXA_DA_FOLHA.altura * RESOLUCAO)

/**
 * Quadros por fileira da folha.
 *
 * Em fileira única, os quinze quadros davam uma tela de quase seis mil pixels
 * de largura — dentro do limite de área de qualquer celular, mas acima do de
 * largura de alguns navegadores antigos, que é de quatro mil e poucos. Em duas
 * fileiras de oito, ela fica com pouco mais de três mil.
 */
const COLUNAS = 8
const LINHAS = Math.ceil(QUADROS / COLUNAS)

/** Canto de cima à esquerda de um quadro dentro da folha, em pixels. */
function origemDoQuadro(indice: number): [number, number] {
  return [(indice % COLUNAS) * LARGURA_QUADRO, Math.floor(indice / COLUNAS) * ALTURA_QUADRO]
}

type Peca = {
  imagem: HTMLCanvasElement
  /** Centro e tamanho da peça, nas unidades do desenho. */
  x: number
  y: number
  largura: number
  altura: number
}

/** A arte pronta para compor os quadros: carroceria, rodas da frente e onde o barro gruda. */
type Arte = { corpo: Peca; rodaEsquerda: Peca; rodaDireita: Peca; manchas: readonly ManchaDeTerra[] }

function tela(largura: number, altura: number) {
  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  return canvas
}

/**
 * Separa a arte em carroceria e rodas dianteiras.
 *
 * As rodas saem da carroceria para deitar com o volante — e para o outro
 * lado, no contraesterço da derrapagem —, como no molde. O recorte é feito uma
 * vez, quando a imagem chega; a folha só compõe as três peças.
 */
function montarArte(imagem: HTMLImageElement): Arte {
  const escala = imagem.naturalWidth / CAR_ART.crop.width
  const { frontWheel } = CAR_ART
  // Bordas inteiras, para o vão deixado na carroceria e a roda recortada
  // coincidirem pixel a pixel, sem fresta nem sobra.
  const topo = Math.floor((frontWheel.y - CAR_ART.crop.y) * escala)
  const base = Math.ceil((frontWheel.y + frontWheel.height - CAR_ART.crop.y) * escala)
  const esquerdaIni = Math.floor((frontWheel.x - CAR_ART.crop.x) * escala)
  const esquerdaFim = Math.ceil((frontWheel.x + frontWheel.width - CAR_ART.crop.x) * escala)
  const espelho = 2 * CAR_ART.centerX - frontWheel.x - frontWheel.width
  const direitaIni = Math.floor((espelho - CAR_ART.crop.x) * escala)
  const direitaFim = Math.ceil((espelho + frontWheel.width - CAR_ART.crop.x) * escala)

  const largura = imagem.naturalWidth
  const altura = imagem.naturalHeight
  const corpo = tela(largura, altura)
  const ctxCorpo = corpo.getContext('2d')!
  ctxCorpo.drawImage(imagem, 0, 0)
  // Onde há carro, lido antes do recorte das rodas: é o que decide onde o
  // barro pode grudar. Uma mancha que caísse fora da arte apareceria como
  // barro flutuando ao lado do carro.
  const alfa = ctxCorpo.getImageData(0, 0, largura, altura).data
  ctxCorpo.clearRect(esquerdaIni, topo, esquerdaFim - esquerdaIni, base - topo)
  ctxCorpo.clearRect(direitaIni, topo, direitaFim - direitaIni, base - topo)

  /** Um retângulo em pixels da imagem, como centro e tamanho em unidades do desenho. */
  const emUnidades = (x: number, y: number, w: number, h: number) => {
    const [cx, cy] = daArte(CAR_ART.crop.x + (x + w / 2) / escala, CAR_ART.crop.y + (y + h / 2) / escala)
    return { x: cx, y: cy, largura: (w / escala) * UNIDADE_DA_ARTE, altura: (h / escala) * UNIDADE_DA_ARTE }
  }
  const roda = (inicio: number, fim: number): Peca => {
    const imagemDaRoda = tela(fim - inicio, base - topo)
    imagemDaRoda.getContext('2d')!.drawImage(imagem, inicio, topo, fim - inicio, base - topo, 0, 0, fim - inicio, base - topo)
    return { imagem: imagemDaRoda, ...emUnidades(inicio, topo, fim - inicio, base - topo) }
  }
  const opaco = (x: number, y: number) => {
    const px = Math.round((x / UNIDADE_DA_ARTE + CAR_ART.centerX - CAR_ART.crop.x) * escala)
    const py = Math.round(((y - LINHA_DO_CHAO) / UNIDADE_DA_ARTE + CAR_ART.groundY - CAR_ART.crop.y) * escala)
    return px >= 0 && py >= 0 && px < largura && py < altura && alfa[(py * largura + px) * 4 + 3] > 200
  }

  return {
    corpo: { imagem: corpo, ...emUnidades(0, 0, largura, altura) },
    rodaEsquerda: roda(esquerdaIni, esquerdaFim),
    rodaDireita: roda(direitaIni, direitaFim),
    // A mancha inteira sobre o carro, e não só o centro dela.
    manchas: MANCHAS_DA_ARTE.filter((m) =>
      opaco(m.x, m.y) && opaco(m.x - m.rx, m.y) && opaco(m.x + m.rx, m.y) && opaco(m.x, m.y - m.ry) && opaco(m.x, m.y + m.ry)),
  }
}

/** A arte de cada carro: nula enquanto a imagem não chega, e marcada quando ela falha. */
const artes = new Map<CarId, { arte: Arte | null; falhou: boolean }>()

/**
 * A arte do carro, se já chegou. Na primeira vez que é pedida, começa a baixar.
 *
 * Quando a imagem chega, as folhas que o molde assou no lugar dela são
 * descartadas, e o quadro seguinte já sai da arte. Uma imagem que falha não é
 * pedida de novo a cada quadro — só na próxima corrida, em `prepareCar`.
 */
/**
 * Começa a baixar a arte do carro antes da corrida — no menu, na garagem, no
 * lobby. Sem isso a arte só é pedida na montagem da corrida, e não chega a
 * tempo: a primeira folha sai do molde e é assada de novo quando a imagem
 * chega. São dois engasgos por carro, bem nas luzes da largada.
 */
export function precarregarCarro(id: CarId) {
  if (artes.get(id)?.falhou) artes.delete(id)
  arteDe(id)
}

function arteDe(id: CarId): Arte | null {
  const registro = artes.get(id)
  if (registro) return registro.arte
  // Fora do navegador — nos testes — não há imagem: vale o molde.
  if (typeof Image === 'undefined') return null
  const novo: { arte: Arte | null; falhou: boolean } = { arte: null, falhou: false }
  artes.set(id, novo)
  const imagem = new Image()
  imagem.decoding = 'async'
  imagem.onload = () => {
    novo.arte = montarArte(imagem)
    descartarFolhas(id)
  }
  imagem.onerror = () => {
    novo.falhou = true
  }
  imagem.src = carImageUrl(id)
  return null
}

// ---------------------------------------------------------------------------
// O molde, quando a arte falta
// ---------------------------------------------------------------------------

type Desenho = {
  faces: { caminho: Path2D; fill: string; opacity: number }[]
  labels: CarModel['labels']
}

const desenhos = new Map<CarId, Map<Part, Desenho>>()

/** As faces viram `Path2D` uma vez só: a folha as percorre quinze vezes. */
function desenhoDe(id: CarId) {
  const guardado = desenhos.get(id)
  if (guardado) return guardado

  const modelo = carModel(id)
  const porParte = new Map<Part, Desenho>()
  for (const part of PARTS) porParte.set(part, { faces: [], labels: [] })
  for (const face of modelo.faces) {
    porParte.get(face.part)!.faces.push({ caminho: new Path2D(face.d), fill: face.fill, opacity: face.opacity ?? 1 })
  }
  for (const label of modelo.labels) porParte.get(label.part)!.labels.push(label)
  desenhos.set(id, porParte)
  return porParte
}

function desenharParte(ctx: CanvasRenderingContext2D, desenho: Desenho) {
  for (const face of desenho.faces) {
    ctx.globalAlpha = face.opacity
    ctx.fillStyle = face.fill
    ctx.fill(face.caminho)
  }
  ctx.globalAlpha = 1
  for (const label of desenho.labels) {
    ctx.save()
    ctx.translate(label.x, label.y)
    if (label.rotate) ctx.rotate((label.rotate * Math.PI) / 180)
    ctx.font = `700 ${label.size}px ${FONTE}`
    ctx.fillStyle = label.fill
    ctx.fillText(label.text, 0, 0)
    ctx.restore()
  }
}

/**
 * Um quadro da folha, numa pose do eixo de curva.
 *
 * São quatro pistas de leitura, e nenhuma delas mexe na posição do carro na
 * pista: o carro gira no próprio eixo, a roda dianteira deita para o lado do
 * comando — ou para o lado contrário, na derrapagem —, a carroceria rola sobre
 * a suspensão e o piloto se joga para dentro da curva. Juntas, dão a impressão
 * de um carro que está virando mesmo parado no meio da tela.
 */
function desenharQuadro(ctx: CanvasRenderingContext2D, desenho: Map<Part, Desenho>, pose: number) {
  const guinada = guinadaDaPose(pose)
  const esterco = estercoDaPose(pose)
  const piloto = Math.max(-1, Math.min(1, pose))
  ctx.save()
  ctx.translate(0, LINHA_DO_CHAO)
  ctx.rotate(rolagemDaPose(pose))
  ctx.translate(0, -LINHA_DO_CHAO)
  for (const part of PARTS) {
    // A sombra fica de fora da folha: ela é desenhada ao vivo em `drawCar`,
    // no chão, enquanto o resto do carro rola e treme por cima.
    if (part === 'sombra') continue
    ctx.save()
    // A guinada vem antes de tudo: é ela que põe a peça no lugar em que o carro
    // girado a deixa, e o que vier depois — o centro da roda, o esterço, o
    // piloto se jogando — acontece dentro desse lugar.
    if (guinada !== 0) ctx.transform(...yawTransform(part, guinada))
    if (ehRoda(part)) {
      const [x, y] = WHEEL_CENTERS[part]
      ctx.translate(x, y)
      if (part === RODA_ESQUERDA || part === RODA_DIREITA) {
        ctx.transform(1, 0, esterco * ESTERCO_DA_RODA, 1, 0, 0)
      }
    } else if (part === 'piloto') {
      ctx.translate(-piloto * PILOTO_NA_CURVA, 0)
    }
    desenharParte(ctx, desenho.get(part)!)
    ctx.restore()
  }
  ctx.restore()
}

/**
 * Um quadro da folha a partir da arte.
 *
 * As mesmas pistas de leitura do molde, menos o piloto se jogando, que na arte
 * não é peça solta: a carroceria gira pelo cisalhamento de `guinadaDaArte`,
 * as rodas da frente deslizam com o eixo delas e deitam com o esterço, e o
 * quadro inteiro rola sobre a suspensão.
 */
function desenharQuadroDaArte(ctx: CanvasRenderingContext2D, arte: Arte, indice: number) {
  const pose = POSES[indice]
  const deitada = estercoDaPose(pose) * ESTERCO_DA_RODA
  ctx.save()
  ctx.translate(0, LINHA_DO_CHAO)
  ctx.rotate(rolagemDaPose(pose))
  ctx.translate(0, -LINHA_DO_CHAO)

  const corpo = arte.corpo
  ctx.save()
  aplicar(ctx, CORPO_DA_ARTE[indice])
  ctx.drawImage(corpo.imagem, corpo.x - corpo.largura / 2, corpo.y - corpo.altura / 2, corpo.largura, corpo.altura)
  ctx.restore()

  for (const [roda, peca] of [[RODA_ESQUERDA, arte.rodaEsquerda], [RODA_DIREITA, arte.rodaDireita]] as const) {
    ctx.save()
    aplicar(ctx, GUINADAS[indice][roda])
    ctx.translate(peca.x, peca.y)
    ctx.transform(1, 0, deitada, 1, 0, 0)
    ctx.drawImage(peca.imagem, -peca.largura / 2, -peca.altura / 2, peca.largura, peca.altura)
    ctx.restore()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// A folha
// ---------------------------------------------------------------------------

/**
 * Onde ficam as peças que a folha não assa.
 *
 * A sombra, a banda do pneu, a terra e o brilho do boost são desenhados ao
 * vivo, por cima do quadro, e têm de cair sobre o carro que está nele. A arte
 * e o molde não têm as rodas no mesmo lugar, então cada folha leva a dela.
 */
type Geometria = {
  /** Centro de cada roda, em unidades do desenho. */
  rodas: Record<Roda, readonly [number, number]>
  /** Meia-largura da banda que rola sobre o pneu traseiro. */
  meiaBanda: number
  sombra: readonly ManchaDeSombra[]
  manchas: readonly ManchaDeTerra[]
  luzDeChuva: { x: number; y: number; raio: number }
  escapamento: { x: number; y: number; raio: number }
  /** Guinada, em cada quadro, da peça onde a terra gruda. */
  corpo: readonly Afim[]
  /** Guinada, em cada quadro, da peça onde moram a luz de chuva e o escapamento. */
  traseira: readonly Afim[]
}

/** Uma redução da folha: a mesma grade de quadros, com cada quadro deste tamanho. */
type Nivel = { tela: HTMLCanvasElement; largura: number; altura: number }

/**
 * Os níveis vão da folha cheia (0) a um dezesseis avos dela. Sem a cheia, o
 * nível 0 é a metade — ver `precisaDaFolhaCheia`.
 */
type Folha = { niveis: readonly Nivel[]; geometria: Geometria; semCheia: boolean }

/**
 * Quantas reduções a folha guarda além da cheia: metade, um quarto, um oitavo
 * e um dezesseis avos.
 *
 * No fim da vista o fantasma sai dezenas de vezes menor que a folha cheia,
 * com poucos pixels de largura, e a menor redução ainda tem mais do que ele
 * na tela. Custa um terço a mais de textura, e é o que tira do quadro a
 * redução com qualidade alta — ver `reducoes.ts`.
 */
const REDUCOES_DA_FOLHA = 4

/**
 * A folha pela metade, quadro a quadro.
 *
 * Cada quadro é reduzido só com os próprios pixels: reduzida inteira, a borda
 * de um quadro levaria junto a coluna do vizinho, e a asa de um carro
 * apareceria como risco na beira do outro. Com qualidade alta, porque é uma
 * vez só, na hora de assar.
 */
function reduzirPelaMetade(nivel: Nivel): Nivel {
  const largura = Math.max(1, Math.ceil(nivel.largura / 2))
  const altura = Math.max(1, Math.ceil(nivel.altura / 2))
  const tela = document.createElement('canvas')
  tela.width = largura * COLUNAS
  tela.height = altura * LINHAS
  const ctx = tela.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  for (let indice = 0; indice < QUADROS; indice += 1) {
    const coluna = indice % COLUNAS
    const linha = Math.floor(indice / COLUNAS)
    ctx.drawImage(
      nivel.tela,
      coluna * nivel.largura, linha * nivel.altura, nivel.largura, nivel.altura,
      coluna * largura, linha * altura, largura, altura,
    )
  }
  return { tela, largura, altura }
}

/** A folha cheia e as reduções dela, da maior para a menor. */
function comReducoes(tela: HTMLCanvasElement): Nivel[] {
  const niveis: Nivel[] = [{ tela, largura: LARGURA_QUADRO, altura: ALTURA_QUADRO }]
  for (let i = 0; i < REDUCOES_DA_FOLHA; i += 1) niveis.push(reduzirPelaMetade(niveis[niveis.length - 1]))
  return niveis
}

/** Zerar o tamanho devolve a textura na hora, em vez de esperar o coletor. */
function liberar(folha: Folha) {
  for (const nivel of folha.niveis) nivel.tela.width = 0
}

/**
 * Se o carro, no maior tamanho em que aparece nesta tela, ainda escolhe a
 * folha cheia. `escalaEmPixels` é esse tamanho em pixels do aparelho por
 * unidade da folha: o do carro do jogador, que nenhum fantasma ultrapassa.
 */
export function precisaDaFolhaCheia(escalaEmPixels: number) {
  return nivelDaReducao(RESOLUCAO / escalaEmPixels, REDUCOES_DA_FOLHA + 1) === 0
}

let guardarCheia = true

/**
 * Diz o maior tamanho em que um carro aparece nesta tela.
 *
 * Num celular em pé ele sai reduzido mais de duas vezes, e a escolha nunca pega
 * a folha cheia — que é três quartos da textura de cada folha, uns 9 MB por
 * carro. Ali ela serve só de fonte para as reduções, e sai assim que elas
 * ficam prontas. Se a tela crescer a ponto de pedi-la — o celular girou —, as
 * folhas sem ela são descartadas e assadas de novo, inteiras.
 */
export function definirMaiorEscala(escalaEmPixels: number) {
  if (!(escalaEmPixels > 0)) return
  const precisa = precisaDaFolhaCheia(escalaEmPixels)
  if (precisa && !guardarCheia) {
    for (const [chave, folha] of folhas) {
      if (!folha.semCheia) continue
      liberar(folha)
      folhas.delete(chave)
    }
  }
  guardarCheia = precisa
}

/**
 * Folhas assadas, com teto.
 *
 * Cada folha são uns dez megabytes de textura, contando as reduções, e a
 * chave junta carro, ambiente e fantasma: dezesseis carros em quatro ambientes
 * dariam mais de cem folhas. Numa corrida solta isso nunca aparece — mas o
 * jogo é feito para um workshop, onde a mesma aba fica aberta a tarde inteira
 * trocando de carro e sorteando ambiente. Seis é o que uma sala cheia usa: a
 * folha do jogador e as dos cinco rivais, e mais um par de folga para a
 * revanche não reassar tudo.
 */
const MAX_FOLHAS = 8
const folhas = new Map<string, Folha>()

/**
 * Cobre a folha inteira com uma cor, só onde já há carro.
 *
 * É como entra a luz de ambiente da corrida — o mesmo tom da névoa do
 * horizonte, muito fraco, para o carro não parecer recortado de outra cena — e
 * como o rival ganha o azul que o distingue do carro do próprio jogador.
 */
function banhar(ctx: CanvasRenderingContext2D, cor: string, opacidade: number) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.globalAlpha = opacidade
  ctx.fillStyle = cor
  ctx.fillRect(0, 0, LARGURA_QUADRO * COLUNAS, ALTURA_QUADRO * LINHAS)
  ctx.restore()
}

function assar(id: CarId, ambiente: string, fantasma: boolean): Folha {
  const arte = arteDe(id)
  const desenho = arte ? null : desenhoDe(id)
  const tela = document.createElement('canvas')
  tela.width = LARGURA_QUADRO * COLUNAS
  tela.height = ALTURA_QUADRO * LINHAS
  const ctx = tela.getContext('2d')!
  ctx.textAlign = 'center'
  // A arte chega com o dobro da resolução da folha: reduzida no padrão, a
  // pintura sairia serrilhada.
  ctx.imageSmoothingQuality = 'high'

  for (let indice = 0; indice < QUADROS; indice += 1) {
    ctx.save()
    // Cada quadro é recortado no próprio retângulo: sem isso a asa de um
    // quadro vazaria para dentro do vizinho quando a inclinação a joga para
    // fora da caixa.
    ctx.beginPath()
    const [x, y] = origemDoQuadro(indice)
    ctx.rect(x, y, LARGURA_QUADRO, ALTURA_QUADRO)
    ctx.clip()
    ctx.translate(x, y)
    ctx.scale(RESOLUCAO, RESOLUCAO)
    ctx.translate(-CAIXA_DA_FOLHA.x, -CAIXA_DA_FOLHA.y)
    if (arte) desenharQuadroDaArte(ctx, arte, indice)
    else desenharQuadro(ctx, desenho!, POSES[indice])
    ctx.restore()
  }

  if (ambiente) banhar(ctx, `rgb(${ambiente})`, 0.1)
  if (fantasma) banhar(ctx, '#68cfda', 0.3)

  const niveis = comReducoes(tela)
  const semCheia = !guardarCheia
  if (semCheia) {
    // Com o mesmo destino no quadro, a metade no lugar da cheia só perderia
    // nitidez — e esta tela nunca a escolhe.
    niveis[0].tela.width = 0
    niveis[0] = niveis[1]
  }
  if (arte) {
    return {
      niveis,
      semCheia,
      geometria: {
        rodas: RODAS_DA_ARTE,
        meiaBanda: PNEUS_DA_ARTE.traseira.meiaLargura * 0.93,
        sombra: SOMBRA_DA_ARTE,
        manchas: arte.manchas,
        luzDeChuva: LUZ_DA_ARTE,
        escapamento: ESCAPAMENTO_DA_ARTE,
        corpo: CORPO_DA_ARTE,
        traseira: CORPO_DA_ARTE,
      },
    }
  }
  const modelo = carModel(id)
  return {
    niveis,
    semCheia,
    geometria: {
      rodas: WHEEL_CENTERS,
      meiaBanda: 5.2,
      sombra: SOMBRA_DE_CONTATO,
      manchas: MANCHAS_DE_TERRA,
      luzDeChuva: modelo.luzDeChuva,
      escapamento: modelo.escapamento,
      corpo: CORPO_DO_MOLDE,
      traseira: TRASEIRA_DO_MOLDE,
    },
  }
}

function folhaDe(id: CarId, ambiente: string, fantasma: boolean) {
  const chave = `${id}|${ambiente}|${fantasma ? 'f' : 'j'}`
  const guardada = folhas.get(chave)
  if (guardada) {
    // Reinserir põe a chave no fim da ordem de iteração do `Map`, que é a
    // ordem de inserção: é o que transforma o teto em "descarta a menos usada"
    // em vez de "descarta a mais antiga".
    folhas.delete(chave)
    folhas.set(chave, guardada)
    return guardada
  }
  const folha = assar(id, ambiente, fantasma)
  folhas.set(chave, folha)
  while (folhas.size > MAX_FOLHAS) {
    const maisVelha = folhas.keys().next()
    if (maisVelha.done) break
    const despejada = folhas.get(maisVelha.value)
    if (despejada) liberar(despejada)
    folhas.delete(maisVelha.value)
  }
  return folha
}

/**
 * Solta as folhas assadas para outro ambiente, antes de assar as desta corrida.
 *
 * A luz do ambiente entra na folha, e o ambiente muda a cada semente: numa
 * revanche noutro lugar, as folhas da anterior não servem para nada, mas
 * conviveriam com as novas até o teto despejá-las — dezenas de megabytes a
 * mais, justo no celular com menos memória.
 */
export function soltarFolhasDeOutroAmbiente(ambiente: string) {
  for (const [chave, folha] of folhas) {
    if (chave.split('|')[1] === ambiente) continue
    liberar(folha)
    folhas.delete(chave)
  }
}

/** Descarta as folhas de um carro, para a próxima sair de novo — da arte, que acabou de chegar. */
function descartarFolhas(id: CarId) {
  const prefixo = `${id}|`
  for (const [chave, folha] of folhas) {
    if (!chave.startsWith(prefixo)) continue
    liberar(folha)
    folhas.delete(chave)
  }
}

/**
 * Pede a arte e assa a folha antes da largada.
 *
 * Assar custa alguns milissegundos e uns dez megabytes de textura por carro.
 * Feito no primeiro quadro da corrida, engasgaria justamente na arrancada;
 * feito durante a contagem, não aparece. `fantasma` diz qual das duas folhas
 * aquele carro precisa: no modo treino não existe rival, e assar a azulada
 * seria dobrar a memória por nada.
 *
 * Com a arte ainda a caminho, a folha não é assada aqui: sairia do molde só
 * para ser jogada fora quando a imagem chegasse, o que costuma levar menos que
 * um quadro — o menu e o lobby já a deixaram no cache do navegador.
 */
export function prepareCar(id: CarId, ambiente: string, fantasma = false) {
  // Uma arte que falhou na corrida anterior ganha outra chance nesta.
  if (artes.get(id)?.falhou) artes.delete(id)
  if (arteDe(id)) folhaDe(id, ambiente, fantasma)
}

/**
 * Marcas de rolamento sobre os pneus traseiros.
 *
 * Não cabem na folha: a fase vem dos metros percorridos, e assar um quadro
 * para cada posição da banda custaria mais do que desenhar duas barras. Ligar
 * a fase à distância, e não ao número do quadro, é o que faz o pneu parar
 * quando o carro para e não acelerar quando a taxa de quadros muda.
 */
function desenharRolamento(ctx: CanvasRenderingContext2D, travel: number, guinadas: Record<Part, Afim>, geometria: Geometria) {
  ctx.fillStyle = 'rgba(190,206,198,.12)'
  const fase = ((travel * 0.9) % 4 + 4) % 4
  for (const roda of RODAS_TRASEIRAS) {
    // A roda de trás também escorrega quando o carro atravessa: a marca vai com ela.
    const t = guinadas[roda]
    const [cx, y] = geometria.rodas[roda]
    const x = t[0] * cx + t[2] * y + t[4]
    for (let passo = -9 + fase; passo < 9; passo += 4) {
      ctx.fillRect(x - geometria.meiaBanda, y + passo, geometria.meiaBanda * 2, 0.5)
    }
  }
}

/**
 * O carro na pista.
 *
 * `scale` é a escala da projeção naquela distância, e é ela que faz o rival
 * encolher quando abre vantagem. `ghostAlpha` abaixo de 1 escolhe a folha
 * azulada do rival — é por isso que os dois nunca se confundem, mesmo quando
 * os dois pilotos escolhem o mesmo carro.
 */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  id: CarId,
  pose: CarPose,
  ghostAlpha = 1,
  ambiente = '',
) {
  const { niveis, geometria } = folhaDe(id, ambiente, ghostAlpha < 1)
  // A redução mais perto do tamanho do carro na tela, em pixels do aparelho.
  const reducao = RESOLUCAO / (scale * densidadeDe(ctx))
  const nivel = niveis[nivelDaReducao(reducao, niveis.length)]
  // O esterço e a derrapagem se somam num eixo só: com o volante todo virado e
  // a traseira escapando, o carro está atravessado.
  const esterco = Math.max(-1, Math.min(1, pose.steer))
  const quadro = frameForPose(esterco + Math.max(-1, Math.min(1, pose.drift)))
  const poseDoQuadro = POSES[quadro]
  // Cada quadro da folha já traz o carro rolado e girado, assado. O que se
  // desenha por cima dele depois — terra, sombra dos pneus — precisa do mesmo
  // giro e do mesmo deslize para continuar no mesmo lugar do desenho.
  const giroDoQuadro = rolagemDaPose(poseDoQuadro)
  const guinadas = GUINADAS[quadro]
  const deslizeDoCorpo = geometria.corpo[quadro]

  ctx.save()
  ctx.globalAlpha *= ghostAlpha
  ctx.translate(x, y)
  ctx.scale(scale, scale)

  /**
   * A sombra, antes de tudo, e no chão.
   *
   * É a diferença entre uma peça apoiada no asfalto e um adesivo colado nele.
   * O carro afunda, estica e treme por cima dela; a sombra não. O que muda de
   * verdade a mancha no chão é a altura: afundando, ela fecha e escurece;
   * esticando — no topo de uma lomba, ou no quadro em que o carro bate —,
   * abre e clareia, e é ela que anuncia que o carro está leve antes de
   * qualquer outra coisa na tela.
   */
  const leveza = Math.max(-1, Math.min(1, -pose.suspension * SOMBRA_POR_CURSO))
  const abertura = 1 + leveza * 0.45
  const forca = Math.min(1, 1 - leveza * 0.45)
  const opacidadeBase = ctx.globalAlpha
  // A carroceria rola; o apoio dela escorrega de leve para o lado oposto. As
  // rodas rolam junto com o quadro, e a sombra de cada uma vai atrás do pneu:
  // o centro dela gira com ele, mas a elipse continua deitada no chão.
  const giro = pose.tilt + giroDoQuadro
  const cosseno = Math.cos(giro)
  const seno = Math.sin(giro)
  for (const m of geometria.sombra) {
    // A mancha vai para onde a guinada leva a peça dela: a de cada roda com a
    // roda, a do assoalho com o meio do carro.
    const t = m.roda ? guinadas[m.roda] : deslizeDoCorpo
    const gx = t[0] * m.x + t[2] * m.y + t[4]
    let cx = gx - pose.tilt * SOMBRA_POR_INCLINACAO
    let cy = m.y
    if (m.roda) {
      const acima = m.y - LINHA_DO_CHAO
      cx = gx * cosseno - acima * seno
      cy = gx * seno + acima * cosseno + LINHA_DO_CHAO
    }
    ctx.globalAlpha = opacidadeBase * m.alpha * forca
    ctx.fillStyle = m.cor
    ctx.beginPath()
    ctx.ellipse(cx, cy, m.rx * abertura, m.ry * abertura, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = opacidadeBase

  ctx.translate(pose.jitter, pose.suspension * 8)
  if (pose.tilt !== 0) {
    ctx.translate(0, LINHA_DO_CHAO)
    ctx.rotate(pose.tilt)
    ctx.translate(0, -LINHA_DO_CHAO)
  }
  // Reduzindo, a suavização comum: a redução pesada já foi feita ao assar.
  // Ampliando — o carro de perto numa tela grande —, a de sempre.
  ctx.imageSmoothingQuality = reducao > 1 ? 'low' : 'high'
  ctx.drawImage(
    nivel.tela,
    (quadro % COLUNAS) * nivel.largura, Math.floor(quadro / COLUNAS) * nivel.altura, nivel.largura, nivel.altura,
    CAIXA_DA_FOLHA.x, CAIXA_DA_FOLHA.y, CAIXA_DA_FOLHA.largura, CAIXA_DA_FOLHA.altura,
  )
  desenharRolamento(ctx, pose.travel, guinadas, geometria)

  /**
   * Terra da grama, por cima da pintura.
   *
   * Um punhado de manchas em vez de um banho na carroceria inteira, e por dois
   * motivos. O barato é que tingir a folha exigiria uma tela de apoio e uma
   * volta a mais por quadro, justamente no objeto maior da tela. O bom é que
   * fica melhor: barro atirado por pneu é respingo, e respingo tem borda — um
   * véu uniforme leria como o carro ter mudado de cor.
   */
  if (pose.dirt > 0.02) {
    ctx.save()
    // O giro do quadro, de novo: sem ele, no esterço máximo a terra do pontão
    // escorrega três unidades para o lado e sai da carroceria justamente no
    // meio da curva.
    ctx.translate(0, LINHA_DO_CHAO)
    ctx.rotate(giroDoQuadro)
    ctx.translate(0, -LINHA_DO_CHAO)
    // E a guinada: as manchas moram nos pontões, que deslizam com o meio do carro.
    aplicar(ctx, deslizeDoCorpo)
    ctx.globalAlpha = opacidadeBase * Math.min(1, pose.dirt) * 0.72
    ctx.fillStyle = COR_DA_TERRA
    for (const m of geometria.manchas) {
      ctx.beginPath()
      ctx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // Freando, só a luz de chuva: sem o fogo do escapamento, que é do boost.
  if ((pose.freio ?? 0) > 0.01 && pose.boost <= 0.01) {
    const { luzDeChuva } = geometria
    ctx.save()
    aplicar(ctx, geometria.traseira[quadro])
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#ff3a2a'
    ctx.globalAlpha *= Math.min(1, pose.freio ?? 0)
    ctx.beginPath()
    ctx.ellipse(luzDeChuva.x, luzDeChuva.y, luzDeChuva.raio * 1.6, luzDeChuva.raio * 1.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // No boost a luz de chuva acende e o escapamento transborda. Vai por cima da
  // folha e em modo aditivo: soma luz à pintura em vez de cobri-la.
  if (pose.boost > 0.01) {
    const { luzDeChuva, escapamento } = geometria
    // A traseira desliza com a guinada, e a luz e o fogo moram nela.
    aplicar(ctx, geometria.traseira[quadro])
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#ff3a2a'
    ctx.globalAlpha *= pose.boost
    ctx.beginPath()
    ctx.ellipse(luzDeChuva.x, luzDeChuva.y, luzDeChuva.raio * 1.6, luzDeChuva.raio * 1.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffc56a'
    ctx.beginPath()
    ctx.ellipse(escapamento.x, escapamento.y, escapamento.raio * (1.4 + pose.boost), escapamento.raio * (1 + pose.boost), 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
