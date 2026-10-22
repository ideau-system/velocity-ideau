/**
 * Folha de sprites do cenário.
 *
 * Todo objeto da beira da pista é assado uma vez, numa folha só, e desenhado
 * com um `drawImage`. É a mesma troca que resolveu o carro, e pelo mesmo
 * motivo — mas com uma correção que só apareceu ao medir.
 *
 * A intuição diz que assar serve para o que está longe, onde há muitos objetos
 * pequenos, e que o objeto colado na câmera deveria ser desenhado ao vivo para
 * não borrar. É o contrário. Um objeto pequeno custa **chamadas**; um objeto
 * grande custa **área escrita**. Uma árvore de setecentos pixels com trinta
 * faces e alguma sobreposição escreve um milhão e meio de pixels — mais do que
 * todas as faixas de grama da pista somadas. A mesma árvore esticada de uma
 * célula de 256 escreve meio milhão. **A folha é o caminho rápido justamente
 * para o que está perto.**
 *
 * E o borrão ali custa pouco: a sessenta metros por segundo, um objeto a cinco
 * metros da câmera atravessa a tela em seis quadros. O orçamento de nitidez
 * rende entre trinta e oitenta metros, onde o objeto fica mais de um segundo
 * em cena.
 *
 * Duas famílias não passam por aqui. A **cerca** precisa que as travessas de
 * vagas vizinhas se encontrem, e isso depende das projeções das duas vagas —
 * assada por vaga, ela viraria uma fila de portõezinhos soltos. O **pórtico**
 * atravessa a pista e chega a dois mil pixels de largura, e é barato de
 * desenhar. Os dois continuam procedurais.
 */
import type { Flora, Lugar } from './layout'
import { lateralOffset, type ObstacleKind } from './track'
import { LUZ, misturar, rampa, type Rampa } from './paleta'
import { LADOS } from './pincel'
import { densidadeDe, nivelDaReducao } from './reducoes'
import {
  MEIA_LARGURA,
  TONS,
  VARIANTES,
  objetoModelado,
  type Detalhe,
  type FamiliaModelada,
} from './cenarioModel'

/**
 * Altura da célula grande de cada família, em pixels.
 *
 * Não é um número só para todas: o capim aparece com quarenta e cinco pixels
 * na pior projeção e uma célula de duzentos ali seria memória jogada fora. A
 * régua é a pior altura que a família alcança na tela, dividida pela
 * ampliação que se aceita — duas vezes, fora a árvore, que é grande demais
 * para caber nessa conta sem inchar a folha.
 */
const ALTURA_CHEIA: Record<FamiliaModelada, number> = {
  tree: 256,
  bush: 128,
  grass: 48,
  sign: 128,
  marcador: 96,
  pneus: 80,
  poste: 224,
  arquibancada: 144,
  bandeira: 144,
  pedra: 96,
  cacto: 160,
  predio: 256,
  // Os dois obstáculos chegam maiores na tela do que qualquer objeto de beira
  // de pista: o jogador tem de enxergá-los a tempo de desviar, e por isso eles
  // crescem com a mesma régua do carro. Célula à altura disso.
  barreira: 144,
  cone: 176,
}

/**
 * Abaixo desta altura na tela o objeto sai da célula pequena.
 *
 * Metade dos objetos visíveis num quadro tem menos de sessenta pixels: é
 * metade do trabalho de assar e da banda de leitura, por um detalhe que não
 * chega a existir nesse tamanho.
 */
const LIMIAR_SIMPLES = 64

/**
 * Folga em volta de cada célula, em pixels.
 *
 * Sem ela as células ficam encostadas umas nas outras, e o `drawImage` de um
 * objeto de perto — que amplia — lê meio texel além do retângulo pedido e traz
 * junto a primeira coluna da vizinha. Aparecia como um risco de cor estranha
 * na borda de cada objeto, e não era do cone: era de todos, desde que a folha
 * existe. Dois pixels cobrem tanto a ampliação quanto o núcleo mais largo que
 * a suavização usa ao reduzir.
 */
const FOLGA = 2

/** A célula pequena é um quarto da grande, e leva um terço das faces. */
const REDUCAO_SIMPLES = 4

/**
 * Reduções pela metade que a célula grande guarda além dela mesma.
 *
 * A grande vale de sessenta e quatro pixels de tela para cima, e o pior caso é
 * a barreira — larga, então baixa — numa tela de densidade um: quase seis
 * vezes menor que a célula. Duas reduções levam isso para menos de duas
 * vezes. Ver `reducoes.ts`.
 */
const REDUCOES_DA_CHEIA = 2

/**
 * Menor célula que uma redução pode ter, em pixels.
 *
 * A pequena desce pela metade até aqui: é o que cobre o objeto no fim da
 * vista, que chega com três ou quatro pixels de altura.
 */
const MENOR_CELULA = 3

/**
 * Largura máxima da folha.
 *
 * Uma tira de uma linha só, como a do carro, daria vinte mil pixels de
 * largura — acima do limite de textura de quase todo aparelho móvel. A folha
 * é uma grade, e os dois eixos ficam abaixo de 4096.
 */
const LARGURA_MAXIMA = 2048

/**
 * Sombra que todo objeto deixa no chão.
 *
 * É o detalhe mais barato do cenário e o que mais rende: sem ela, tudo o que
 * fica na beira da pista paira alguns pixels acima da grama e a cena perde o
 * assentamento. Fica **fora** da célula, e não é preciosismo: ela é
 * translúcida, e uma face translúcida dentro do sprite daria uma cor quando
 * composta na folha e outra quando composta ao vivo — o objeto mudaria de cor
 * ao trocar de nível de detalhe. Deslocada para a direita, porque a luz vem
 * da esquerda em tudo no jogo.
 */
const SOMBRA_NO_CHAO = 'rgba(10,20,26,.3)'

/** Estrutura do pórtico e as faixas de patrocínio que ele carrega. */
const PORTICO = rampa('#98a2a8')
const FAIXAS_DO_PORTICO = ['#cf4436', '#2f6f8f', '#e6b325'].map(rampa)

/**
 * Placas da IDEAU que o pórtico carrega, como os painéis de patrocínio sobre
 * a reta das corridas de verdade.
 *
 * São três, nas cores do brasão, e cada pórtico pega uma pela variante — a
 * reta alterna verde, branco e vermelho em vez de repetir a mesma placa.
 */
const IDEAU = { verde: '#11833f', amarelo: '#ffd400', vermelho: '#d8232a', branco: '#f6f6f0' }
const PLACAS_IDEAU = [
  { fundo: IDEAU.verde, nome: IDEAU.amarelo, linha: IDEAU.branco },
  { fundo: IDEAU.branco, nome: IDEAU.verde, linha: IDEAU.vermelho },
  { fundo: IDEAU.vermelho, nome: IDEAU.branco, linha: IDEAU.amarelo },
]

/**
 * Tamanho da placa assada. A proporção é a do painel no pórtico; a altura é a
 * do painel de um pórtico colado na câmera num celular deitado, para a marca
 * não borrar justo quando ela passa por cima do carro.
 */
const PLACA_LARGURA = 1536
const PLACA_ALTURA = 144
const MARCAS_POR_PLACA = 3

/** Placas prontas, ou `null` enquanto o brasão e a fonte não chegaram. */
let placas: HTMLCanvasElement[] | null = null
let placasPedidas = false

/**
 * Busca o brasão e assa as placas.
 *
 * A imagem chega depois da primeira chamada; até lá o pórtico mostra a faixa
 * lisa de antes, e na contagem de largada as placas já estão no lugar.
 */
function pedirPlacas() {
  if (placasPedidas) return
  placasPedidas = true
  const imagem = new Image()
  imagem.onload = () => {
    const fonte = document.fonts?.load("italic 900 96px 'Barlow Condensed'") ?? Promise.resolve()
    void fonte.catch(() => undefined).then(() => {
      const brasao = recortarBrasao(imagem)
      placas = PLACAS_IDEAU.map((cores) => assarPlaca(brasao, cores))
    })
  }
  imagem.src = '/iedau.jpeg'
}

/**
 * Tira o fundo branco do brasão.
 *
 * O arquivo é um JPEG sem transparência. Apagar todo pixel claro levaria
 * junto o livro e as letras da faixa, então o apagamento anda só a partir das
 * bordas, pelo branco que encosta nelas.
 */
function recortarBrasao(imagem: HTMLImageElement): HTMLCanvasElement {
  const tela = document.createElement('canvas')
  tela.width = imagem.naturalWidth
  tela.height = imagem.naturalHeight
  const ctx = tela.getContext('2d')!
  ctx.drawImage(imagem, 0, 0)
  const { width: w, height: h } = tela
  const dados = ctx.getImageData(0, 0, w, h)
  const px = dados.data
  const claro = (i: number) => Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) > 222
  const visto = new Uint8Array(w * h)
  const fila: number[] = []
  for (let x = 0; x < w; x += 1) fila.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y += 1) fila.push(y * w, y * w + w - 1)
  while (fila.length) {
    const i = fila.pop()!
    if (visto[i] || !claro(i)) continue
    visto[i] = 1
    px[i * 4 + 3] = 0
    const x = i % w
    if (x > 0) fila.push(i - 1)
    if (x < w - 1) fila.push(i + 1)
    if (i >= w) fila.push(i - w)
    if (i < w * (h - 1)) fila.push(i + w)
  }
  ctx.putImageData(dados, 0, 0)
  return tela
}

function assarPlaca(brasao: HTMLCanvasElement, cores: (typeof PLACAS_IDEAU)[number]): HTMLCanvasElement {
  const tela = document.createElement('canvas')
  tela.width = PLACA_LARGURA
  tela.height = PLACA_ALTURA
  const ctx = tela.getContext('2d')!
  const H = PLACA_ALTURA
  ctx.fillStyle = cores.fundo
  ctx.fillRect(0, 0, PLACA_LARGURA, H)
  // Frisos de cima e de baixo, na cor de destaque.
  ctx.fillStyle = cores.linha
  ctx.fillRect(0, 0, PLACA_LARGURA, H * 0.06)
  ctx.fillRect(0, H * 0.94, PLACA_LARGURA, H * 0.06)

  const vao = PLACA_LARGURA / MARCAS_POR_PLACA
  const alturaBrasao = H * 0.8
  const larguraBrasao = (alturaBrasao * brasao.width) / brasao.height
  ctx.font = `italic 900 ${Math.round(H * 0.7)}px 'Barlow Condensed', 'Arial Black', sans-serif`
  const larguraNome = ctx.measureText('IDEAU').width
  const espaco = H * 0.14
  const grupo = larguraBrasao + espaco + larguraNome
  for (let i = 0; i < MARCAS_POR_PLACA; i += 1) {
    const inicio = i * vao + (vao - grupo) / 2
    ctx.drawImage(brasao, inicio, (H - alturaBrasao) / 2, larguraBrasao, alturaBrasao)
    ctx.fillStyle = cores.nome
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('IDEAU', inicio + larguraBrasao + espaco, H * 0.73)
    ctx.font = `700 ${Math.round(H * 0.15)}px 'Barlow Condensed', 'Arial Narrow', sans-serif`
    ctx.fillStyle = cores.linha === IDEAU.branco ? IDEAU.branco : cores.nome
    ctx.fillText('F A C U L D A D E S', inicio + larguraBrasao + espaco + H * 0.02, H * 0.88)
    ctx.font = `italic 900 ${Math.round(H * 0.7)}px 'Barlow Condensed', 'Arial Black', sans-serif`
    // Divisória entre as marcas, como as emendas de lona de uma placa real.
    if (i > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.18)'
      ctx.fillRect(i * vao - 1, H * 0.06, 2, H * 0.88)
    }
  }
  return tela
}


type Celula = {
  x: number
  y: number
  largura: number
  altura: number
  /** Meia-largura do modelo, para converter altura pedida em largura na tela. */
  meiaLargura: number
}

/** As células de um objeto num nível de detalhe: a do tamanho medido, e as reduções dela. */
type Reducoes = Celula[]

/** Índice do nível de detalhe nas células guardadas. */
const DETALHES = ['cheio', 'simples'] as const
const indiceDoDetalhe = (detalhe: Detalhe) => (detalhe === 'cheio' ? 0 : 1)

type Folha = {
  tela: HTMLCanvasElement
  /**
   * Por família: variante, tom e detalhe, e aí as reduções. Índices, e não uma
   * chave em texto: o quadro procura aqui dezenas de vezes, e montar a chave
   * era uma string nova a cada objeto desenhado.
   */
  celulas: Map<FamiliaModelada, Reducoes[][][]>
}

/** Alturas das células de um detalhe: a medida, e as metades dela. */
function alturasDoDetalhe(familia: FamiliaModelada, detalhe: Detalhe) {
  const alturas = [
    detalhe === 'cheio' ? ALTURA_CHEIA[familia] : Math.max(12, Math.round(ALTURA_CHEIA[familia] / REDUCAO_SIMPLES)),
  ]
  const quantas = detalhe === 'cheio' ? 1 + REDUCOES_DA_CHEIA : Infinity
  while (alturas.length < quantas) {
    const proxima = Math.round(alturas[alturas.length - 1] / 2)
    if (proxima < MENOR_CELULA) break
    alturas.push(proxima)
  }
  return alturas
}

/** Toda combinação que a folha precisa guardar, na ordem em que será empacotada. */
function combinacoes() {
  const lista: {
    familia: FamiliaModelada; variante: number; tom: number; detalhe: Detalhe; nivel: number; altura: number
  }[] = []
  for (const familia of Object.keys(VARIANTES) as FamiliaModelada[]) {
    for (let variante = 0; variante < VARIANTES[familia]; variante += 1) {
      for (let tom = 0; tom < TONS[familia]; tom += 1) {
        for (const detalhe of DETALHES) {
          alturasDoDetalhe(familia, detalhe).forEach((altura, nivel) => {
            lista.push({ familia, variante, tom, detalhe, nivel, altura })
          })
        }
      }
    }
  }
  // Da mais alta para a mais baixa: é o que faz o empacotamento por prateleiras
  // desperdiçar pouco, sem precisar de um empacotador de verdade.
  return lista.sort((a, b) => b.altura - a.altura)
}

/**
 * Banha a folha inteira na cor da névoa, só onde há desenho.
 *
 * É como a luz de ambiente entra no carro, em `carSprites.ts`, e é o que
 * mantém cenário e carro sob o mesmo sol — sem isso o objeto aparece recortado
 * de outra cena, por mais que a paleta coincida.
 */
function banhar(ctx: CanvasRenderingContext2D, largura: number, altura: number, nevoaRGB: string) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.globalAlpha = 0.1
  ctx.fillStyle = `rgb(${nevoaRGB})`
  ctx.fillRect(0, 0, largura, altura)
  ctx.restore()
}

function assar(flora: Flora, nevoaRGB: string): Folha {
  // O modelo e os caminhos dele saem uma vez por detalhe: as reduções são o
  // mesmo desenho, em outro tamanho.
  const modelos = new Map<string, { modelo: ReturnType<typeof objetoModelado>; caminhos: Path2D[] }>()
  const pedidos = combinacoes().map((pedido) => {
    const chave = `${pedido.familia}|${pedido.variante}|${pedido.tom}|${pedido.detalhe}`
    let guardado = modelos.get(chave)
    if (!guardado) {
      const modelo = objetoModelado(pedido.familia, flora, pedido.variante, pedido.tom, pedido.detalhe)
      guardado = { modelo, caminhos: modelo.faces.map((face) => new Path2D(face.d)) }
      modelos.set(chave, guardado)
    }
    return {
      ...pedido,
      ...guardado,
      largura: Math.ceil(pedido.altura * guardado.modelo.meiaLargura * 2),
    }
  })

  /**
   * Empacotamento por prateleiras, preenchendo a sobra de cada uma.
   *
   * A lista vem da mais alta para a mais baixa, e cada linha tem a altura da
   * primeira peça que entrou nela. A versão anterior só quebrava a linha
   * quando a próxima peça não cabia, e deixava a sobra vazia — com peças de
   * trezentos e poucos pixels numa linha de dois mil, sobrava meia peça por
   * linha. Varrer o que ainda não foi colocado atrás de qualquer uma que caiba
   * na sobra custa um laço de sessenta itens na hora de assar e devolve mais
   * de um megabyte de textura.
   */
  const celulas = new Map<FamiliaModelada, Reducoes[][][]>()
  const onde = new Map<(typeof pedidos)[number], Celula>()
  const restantes = [...pedidos]
  let x = 0
  let y = 0
  let larguraUsada = 0

  const colocar = (pedido: (typeof pedidos)[number]) => {
    // O que fica guardado é o retângulo do desenho, já para dentro da folga:
    // quem desenha não precisa saber que ela existe.
    const celula: Celula = {
      x: x + FOLGA,
      y: y + FOLGA,
      largura: pedido.largura,
      altura: pedido.altura,
      meiaLargura: pedido.modelo.meiaLargura,
    }
    onde.set(pedido, celula)
    let daFamilia = celulas.get(pedido.familia)
    if (!daFamilia) {
      daFamilia = []
      celulas.set(pedido.familia, daFamilia)
    }
    const doTom = ((daFamilia[pedido.variante] ??= [])[pedido.tom] ??= [])
    ;(doTom[indiceDoDetalhe(pedido.detalhe)] ??= [])[pedido.nivel] = celula
    x += pedido.largura + FOLGA * 2
    larguraUsada = Math.max(larguraUsada, x)
  }

  while (restantes.length > 0) {
    const primeiro = restantes.shift()!
    const alturaDaLinha = primeiro.altura + FOLGA * 2
    x = 0
    colocar(primeiro)
    for (let i = 0; i < restantes.length;) {
      if (x + restantes[i].largura + FOLGA * 2 <= LARGURA_MAXIMA) colocar(restantes.splice(i, 1)[0])
      else i += 1
    }
    y += alturaDaLinha
  }

  const tela = document.createElement('canvas')
  tela.width = Math.max(1, larguraUsada)
  tela.height = Math.max(1, y)
  const ctx = tela.getContext('2d')!

  for (const pedido of pedidos) {
    const celula = onde.get(pedido)!
    ctx.save()
    // O modelo mede em alturas do objeto, com o chão em zero e o topo em -1:
    // levar a origem para o pé da célula e escalar pela altura dela põe o
    // desenho inteiro dentro do retângulo, sem conta nenhuma no modelo. As
    // reduções saem do vetor, e não da célula grande encolhida: nítidas em
    // qualquer tamanho, e sem nada da vizinha vazando pela borda.
    ctx.translate(celula.x + celula.largura / 2, celula.y + celula.altura)
    ctx.scale(celula.altura, celula.altura)
    pedido.modelo.faces.forEach((face, i) => {
      ctx.fillStyle = face.fill
      ctx.fill(pedido.caminhos[i])
    })
    ctx.restore()
  }

  if (nevoaRGB) banhar(ctx, tela.width, tela.height, nevoaRGB)
  return { tela, celulas }
}

/**
 * Folhas assadas, com teto.
 *
 * Uma basta: a revanche no mesmo lugar reaproveita, e a de outro lugar assa a
 * dela em uns dez milissegundos, durante a contagem. Mais do que isso é
 * memória parada — e o jogo é feito para um workshop, onde a mesma aba fica
 * aberta a tarde inteira sorteando ambiente.
 */
const MAX_FOLHAS = 1
const folhas = new Map<string, Folha>()

function folhaDe(flora: Flora, nevoaRGB: string) {
  const chave = `${flora}|${nevoaRGB}`
  const guardada = folhas.get(chave)
  if (guardada) {
    folhas.delete(chave)
    folhas.set(chave, guardada)
    return guardada
  }
  // A velha sai antes de a nova ser assada: as duas juntas seriam o pico.
  while (folhas.size >= MAX_FOLHAS) {
    const maisVelha = folhas.keys().next()
    if (maisVelha.done) break
    folhas.get(maisVelha.value)!.tela.width = 0
    folhas.delete(maisVelha.value)
  }
  const folha = assar(flora, nevoaRGB)
  folhas.set(chave, folha)
  return folha
}

/** Folha da corrida em curso, escolhida uma vez e usada por todo o laço. */
let atual: Folha | null = null

/**
 * Assa a folha antes da largada.
 *
 * Feito no primeiro quadro da corrida, engasgaria na arrancada; feito durante
 * a contagem, não aparece.
 */
export function prepararCenario(flora: Flora, nevoaRGB: string) {
  atual = folhaDe(flora, nevoaRGB)
  pedirPlacas()
}

/** Quanto de memória a folha da corrida ocupa, para medir sem adivinhar. */
export function memoriaDaFolha() {
  if (!atual) return 0
  return atual.tela.width * atual.tela.height * 4
}

/**
 * Um objeto do cenário na pista.
 *
 * `chao` é a linha em que o objeto toca o chão e `altura` é quanto ele mede na
 * tela naquela distância. O arredondamento é só no eixo vertical: no
 * horizontal, o escorrimento lateral é a principal pista de velocidade do
 * jogo, e um passo de um pixel ali se nota mais do que a reamostragem.
 */
export function desenharObjeto(
  ctx: CanvasRenderingContext2D,
  familia: FamiliaModelada,
  variante: number,
  tom: number,
  x: number,
  chao: number,
  altura: number,
) {
  if (!atual || altura < 2) return
  // O limiar vale para o maior lado, não para a altura. A barreira é duas
  // vezes e meia mais larga que alta: medida só pela altura, ela nunca
  // alcançaria a célula cheia, e os galões dela ficariam para sempre na versão
  // de duas faixas mesmo ocupando cento e quarenta pixels de tela. A
  // arquibancada tinha o mesmo problema, em menor grau.
  const lado = altura * Math.max(1, MEIA_LARGURA[familia] * 2)
  const detalhe: Detalhe = lado >= LIMIAR_SIMPLES ? 'cheio' : 'simples'
  const reducoes =
    atual.celulas.get(familia)?.[variante % VARIANTES[familia]]?.[tom % TONS[familia]]?.[indiceDoDetalhe(detalhe)]
  if (!reducoes) return
  // A redução mais perto do tamanho na tela, em pixels do aparelho.
  const reducao = reducoes[0].altura / (altura * densidadeDe(ctx))
  const celula = reducoes[nivelDaReducao(reducao, reducoes.length)]

  const largura = altura * celula.meiaLargura * 2
  const base = Math.round(chao)
  const topo = Math.round(chao - altura)

  ctx.fillStyle = SOMBRA_NO_CHAO
  ctx.beginPath()
  ctx.ellipse(x + altura * 0.06, base, largura * 0.42, Math.max(0.7, altura * 0.05), 0, 0, Math.PI * 2)
  ctx.fill()

  // Reduzindo, a suavização comum: a redução pesada já foi feita ao assar.
  // Ampliando — a célula é metade da maior altura na tela —, a de sempre.
  const qualidade = ctx.imageSmoothingQuality
  ctx.imageSmoothingQuality = reducao > 1 ? 'low' : 'high'
  ctx.drawImage(
    atual.tela,
    celula.x, celula.y, celula.largura, celula.altura,
    x - largura / 2, topo, largura, base - topo,
  )
  ctx.imageSmoothingQuality = qualidade
}

/** Preto do fundo do buraco: mais fechado que qualquer tom de asfalto. */
const FUNDO_DO_BURACO = '#15171b'

/**
 * Brita solta em volta do buraco, em frações do raio dele.
 *
 * A lista é constante de propósito. Sorteada a cada quadro, a brita ferveria
 * em volta do buraco enquanto ele se aproxima — e o buraco é justamente a
 * peça que o jogador fica olhando enquanto decide de que lado passa.
 */
const CASCALHO: readonly (readonly [number, number, number])[] = [
  [-1.08, 0.1, 0.16], [-0.86, -0.46, 0.1], [0.12, -0.62, 0.12],
  [0.98, -0.3, 0.14], [1.12, 0.22, 0.09], [0.44, 0.52, 0.11],
  [-0.5, 0.6, 0.08],
]

/**
 * Um buraco no asfalto.
 *
 * É o único dos três obstáculos que não passa pela folha, e não por descuido:
 * fica deitado no chão, sem altura, e a convenção de caixa da folha — chão em
 * zero, topo em menos um — não descreve uma peça que não se levanta. Sai
 * barato assim mesmo, porque são no máximo dois na tela.
 *
 * O que o faz ler como afundamento, e não como mancha de óleo, são três
 * camadas na ordem em que são desenhadas: a brita solta em volta, a borda de
 * agregado exposto, e o miolo rebaixado dentro dela. `tons` é a rampa do
 * asfalto da corrida: asfalto quebrado é asfalto, e uma borda de cinza fixo
 * apareceria clara demais ao entardecer e escura demais ao meio-dia.
 */
export function desenharBuraco(
  ctx: CanvasRenderingContext2D,
  x: number,
  chao: number,
  rx: number,
  ry: number,
  tons: Rampa,
) {
  const elipse = (cx: number, cy: number, ex: number, ey: number) => {
    ctx.beginPath()
    ctx.ellipse(x + cx, chao + cy, Math.max(0.5, ex), Math.max(0.5, ey), 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Brita antes da borda: é o que tira do buraco o contorno de elipse perfeita
  // demais, que o fazia ler como mancha pintada. Sai no tom claro porque é
  // pedra solta recém-descoberta, e no tom escuro sumia dentro da pista.
  ctx.fillStyle = tons[3]
  for (const [bx, by, br] of CASCALHO) {
    elipse(bx * rx, by * ry, br * rx, br * ry * 1.18)
  }
  // Borda: agregado exposto, mais claro que a pista. Dois anéis dão a
  // espessura da capa asfáltica.
  ctx.fillStyle = tons[3]
  elipse(0, -ry * 0.12, rx, ry * 1.12)
  ctx.fillStyle = tons[1]
  elipse(0, -ry * 0.06, rx * 0.92, ry * 0.97)
  // Miolo. O anel escuro que sobra do lado de cá é a parede de dentro virada
  // para a câmera: sem ele o buraco fica chapado e vira adesivo.
  ctx.fillStyle = tons[0]
  elipse(0, -ry * 0.24, rx * 0.86, ry * 0.88)
  ctx.fillStyle = FUNDO_DO_BURACO
  elipse(0, -ry * 0.09, rx * 0.82, ry * 0.79)
}

/**
 * Lóbulos de uma mancha, em frações do raio dela: centro, centro, raio.
 *
 * Uma elipse só lê como adesivo colado na pista — é o defeito que o buraco
 * tinha antes da brita. Cinco círculos que se cobrem dão um contorno que
 * ninguém desenharia de propósito, que é exatamente o que uma poça é.
 */
const LOBULOS: readonly (readonly [number, number, number])[] = [
  [0, 0, 1], [-0.62, -0.16, 0.56], [0.58, 0.12, 0.62],
  [0.22, -0.38, 0.5], [-0.28, 0.34, 0.46],
]

/** Desenha o contorno lobado, encolhido por `fator`. */
function mancha(ctx: CanvasRenderingContext2D, x: number, chao: number, rx: number, ry: number, fator: number) {
  for (const [cx, cy, cr] of LOBULOS) {
    ctx.beginPath()
    ctx.ellipse(
      x + cx * rx * fator, chao + cy * ry * fator,
      Math.max(0.5, cr * rx * fator), Math.max(0.5, cr * ry * fator),
      0, 0, Math.PI * 2,
    )
    ctx.fill()
  }
}

/** Cores do óleo: quase preto, e o arco-íris fino que só ele tem. */
const OLEO = ['#1b1f26', '#0e1015'] as const
const IRISADO = ['#4b3a72', '#2c5f63'] as const

/**
 * Uma mancha de óleo.
 *
 * É o obstáculo mais largo do jogo e o mais barato de acertar, e as duas
 * coisas juntas são o ponto dele: dá para atravessar de propósito em vez de
 * jogar o carro na grama para desviar — decisão que a barreira nunca oferece.
 * Por isso ele precisa parecer atravessável, e não um buraco: nada de borda
 * clara em volta, nada de brita. O que o marca é o irisado, que nenhuma outra
 * peça do jogo tem, e que o distingue do buraco no meio segundo em que o
 * piloto decide.
 *
 * As cores são fixas, e não tiradas do asfalto como as do buraco: óleo é
 * preto em qualquer hora do dia.
 */
export function desenharOleo(ctx: CanvasRenderingContext2D, x: number, chao: number, rx: number, ry: number) {
  ctx.fillStyle = OLEO[0]
  mancha(ctx, x, chao, rx, ry, 1)
  ctx.fillStyle = OLEO[1]
  mancha(ctx, x, chao, rx, ry, 0.72)
  // Irisado, na beira de cima e à esquerda, que é de onde vem a luz. Duas
  // lambidas bastam: mais do que isso vira poça de gasolina de desenho.
  ctx.fillStyle = IRISADO[0]
  ctx.beginPath()
  ctx.ellipse(x - rx * 0.34, chao - ry * 0.44, rx * 0.3, Math.max(0.5, ry * 0.21), 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = IRISADO[1]
  ctx.beginPath()
  ctx.ellipse(x + rx * 0.24, chao - ry * 0.59, rx * 0.2, Math.max(0.5, ry * 0.15), 0, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Uma poça de água.
 *
 * O que a faz ler como água é o céu dentro dela: a cor vem de `ceu`, o mesmo
 * tom que o fundo da corrida usa no horizonte, então a poça muda com a hora
 * do dia sem que nada aqui saiba que horas são. Em volta, o asfalto molhado
 * no tom mais fundo da rampa da pista — é a orla escura que diz que ali tem
 * profundidade, e que a separa de uma mancha de óleo.
 */
export function desenharPoca(
  ctx: CanvasRenderingContext2D,
  x: number,
  chao: number,
  rx: number,
  ry: number,
  tons: Rampa,
  ceu: string,
) {
  ctx.fillStyle = tons[0]
  mancha(ctx, x, chao, rx, ry, 1)
  ctx.fillStyle = ceu
  mancha(ctx, x, chao, rx, ry, 0.76)
  // Brilho: dois riscos claros, deitados, onde a superfície devolve o sol.
  ctx.fillStyle = misturar(ceu, LUZ, 0.55)
  for (const [cx, cw] of [[-0.3, 0.26], [0.26, 0.17]] as const) {
    ctx.beginPath()
    ctx.ellipse(x + cx * rx, chao - ry * 0.35, cw * rx, Math.max(0.5, ry * 0.1), 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

// ---------------------------------------------------------------------------
// Obstáculos na pista
// ---------------------------------------------------------------------------

/** Um ponto da pista na tela, como a corrida o projeta — curva e relevo inclusos. */
export type PontoDaPista = { center: number; y: number; roadWidth: number }

/**
 * Tamanho de referência de um obstáculo, em larguras de pista.
 *
 * Tudo o que um obstáculo mede é isto vezes a largura da pista **naquela
 * distância**: a mesma régua de perspectiva da pista, do cenário e do
 * fantasma. Antes ele tinha régua própria, uma curva quase linear na
 * distância. A pista encolhe com `1/z` e o obstáculo encolhia bem menos, e a
 * cem metros uma barreira cobria dois terços do asfalto que, na altura do
 * carro, ela cobre um quinto. Chegava enorme e ia "diminuindo para dentro" da
 * pista conforme se aproximava — o contrário de uma coisa apoiada nela.
 *
 * O valor é o que aquela curva dava na distância do carro. É ali que a colisão
 * foi calibrada contra o desenho, e ali nada muda: a meia-largura desenhada de
 * cada peça continua do tamanho do alcance da colisão dela.
 */
export const TAMANHO_DO_OBSTACULO = 0.143

/** Altura das peças de pé, em tamanhos de referência. */
const ALTURA_DE_PE = { barrier: 0.52, debris: 1.08 } as const

/**
 * As peças deitadas: meia-largura, em tamanhos de referência, e comprimento
 * ao longo da pista, em metros.
 *
 * O comprimento é medida de verdade porque é projetado de verdade: a borda de
 * cá e a de lá passam pela mesma conta que desenha as faixas do asfalto, que
 * se alternam a cada doze metros. É o que as deita na pista. Antes elas tinham
 * uma proporção fixa entre altura e largura e, ao longe, ficavam de pé como
 * discos. Os comprimentos reproduzem, na altura do carro e numa tela 16:9, a
 * proporção que elas tinham.
 */
const DEITADAS = {
  pothole: { meiaLargura: 0.5, comprimento: 1.4 },
  oleo: { meiaLargura: 0.9, comprimento: 2.5 },
  poca: { meiaLargura: 0.78, comprimento: 2.1 },
} as const

/**
 * Achatamento mínimo de uma peça deitada, altura sobre largura.
 *
 * A perspectiva de verdade achata um buraco a cinquenta metros até um pixel
 * e meio de altura, e encostado na zebra ele some — medido na corrida, não
 * suposto. Só que o buraco existe para fechar a beirada da pista, e o desvio
 * mais apertado do profissional tem 0,63 s de folga: o piloto precisa vê-lo a
 * tempo de escolher o lado. Então, até uns vinte e poucos metros, ele achata
 * exatamente como as faixas em volta; dali para o fundo para de achatar e
 * fica um traço deitado, com o dobro da altura que a projeção daria, que
 * ainda se lê.
 */
export const ACHATAMENTO_MINIMO = 0.14

export type MedidasDoObstaculo =
  | { kind: 'barrier' | 'debris'; x: number; chao: number; altura: number }
  | { kind: 'pothole' | 'oleo' | 'poca'; x: number; chao: number; rx: number; ry: number }

/**
 * Onde e de que tamanho um obstáculo aparece.
 *
 * `pistaEm` é a projeção da corrida — na corrida, a mesma `roadGeometry` que
 * desenha o asfalto —, e é por ela que curva e relevo entram de graça: numa
 * subida a mancha aparece mais alta, na crista mais achatada, exatamente como
 * as faixas da pista em volta dela.
 */
export function medidasDoObstaculo(
  kind: ObstacleKind,
  lane: number,
  distancia: number,
  pistaEm: (distancia: number) => PontoDaPista,
): MedidasDoObstaculo {
  const aqui = pistaEm(distancia)
  const tamanho = aqui.roadWidth * TAMANHO_DO_OBSTACULO
  const x = aqui.center + lateralOffset(lane, aqui.roadWidth)
  if (kind === 'barrier' || kind === 'debris') {
    return { kind, x, chao: aqui.y, altura: tamanho * ALTURA_DE_PE[kind] }
  }
  const { meiaLargura, comprimento } = DEITADAS[kind]
  const rx = tamanho * meiaLargura
  const perto = pistaEm(Math.max(0, distancia - comprimento / 2)).y
  const longe = pistaEm(distancia + comprimento / 2).y
  return {
    kind,
    x,
    chao: (perto + longe) / 2,
    rx,
    ry: Math.max(rx * ACHATAMENTO_MINIMO, (perto - longe) / 2),
  }
}

/**
 * Um obstáculo, já medido.
 *
 * Um caso por tipo e nenhuma saída padrão. As duas peças de pé saem da folha,
 * com o banho de névoa dela; as três deitadas são procedurais, porque a caixa
 * da folha — chão em zero, topo em menos um — não descreve peça sem altura.
 * A variante da barreira sai do identificador do obstáculo, que é literal em
 * `track.ts`: os dois pilotos veem a mesma no mesmo lugar.
 */
export function desenharObstaculo(
  ctx: CanvasRenderingContext2D,
  medidas: MedidasDoObstaculo,
  id: number,
  asfalto: Rampa,
  ceu: string,
) {
  const m = medidas
  switch (m.kind) {
    case 'barrier':
      desenharObjeto(ctx, 'barreira', id, 0, m.x, m.chao, m.altura)
      break
    case 'debris':
      desenharObjeto(ctx, 'cone', 0, 0, m.x, m.chao, m.altura)
      break
    case 'pothole':
      desenharBuraco(ctx, m.x, m.chao, m.rx, m.ry, asfalto)
      break
    case 'oleo':
      desenharOleo(ctx, m.x, m.chao, m.rx, m.ry)
      break
    case 'poca':
      desenharPoca(ctx, m.x, m.chao, m.rx, m.ry, asfalto, ceu)
      break
    default:
      m satisfies never
  }
}

/**
 * Um pórtico sobre a pista.
 *
 * Continua procedural, e de propósito: ele acompanha a largura do asfalto,
 * chega a dois mil pixels de dispositivo e não caberia em célula de folha
 * nenhuma. Em compensação é barato — uma dúzia de preenchimentos.
 *
 * Ele vive e morre com a vaga em que está, como qualquer outro objeto da
 * beira da pista: nada de subir nem de se apagar ao chegar perto. Houve uma
 * versão que fazia as duas coisas, para o arco não sumir de um quadro para o
 * outro quando a câmera o alcança — mas o remédio se via mais que a doença.
 */
export function desenharPortico(
  ctx: CanvasRenderingContext2D,
  projetado: { center: number; y: number; roadWidth: number },
  variante: number,
  nitidez: number,
  chegada = false,
) {
  const largura = projetado.roadWidth
  const base = projetado.y
  const arco = largura * 0.44
  const perna = Math.max(1, largura * 0.032)
  const viga = Math.max(2, largura * 0.13)
  const meiaViga = largura * 0.63

  ctx.globalAlpha = nitidez
  // Pernas, apoiadas fora do asfalto.
  for (const lado of LADOS) {
    const x = projetado.center + lado * largura * 0.58
    ctx.fillStyle = PORTICO[1]
    ctx.fillRect(x - perna / 2, base - arco, perna, arco)
    ctx.fillStyle = PORTICO[3]
    ctx.fillRect(x - perna / 2, base - arco, Math.max(1, perna * 0.36), arco)
    // Sapata: sem ela a perna parece enfiada na grama.
    ctx.fillStyle = PORTICO[0]
    ctx.fillRect(x - perna, base - Math.max(1, perna * 0.9), perna * 2, Math.max(1, perna * 0.9))
  }
  // Viga, com a aresta de cima acesa e a de baixo na sombra.
  ctx.fillStyle = PORTICO[2]
  ctx.fillRect(projetado.center - meiaViga, base - arco - viga, meiaViga * 2, viga)
  ctx.fillStyle = PORTICO[4]
  ctx.fillRect(projetado.center - meiaViga, base - arco - viga, meiaViga * 2, Math.max(1, viga * 0.16))
  ctx.fillStyle = PORTICO[0]
  ctx.fillRect(projetado.center - meiaViga, base - arco - Math.max(1, viga * 0.18), meiaViga * 2, Math.max(1, viga * 0.18))

  // Painel: placa da IDEAU, ou o quadriculado da chegada.
  const painelTopo = base - arco - viga * 0.91
  const painelAltura = Math.max(1, viga * 0.82)
  if (chegada) {
    // Duas fileiras defasadas, com casas quase quadradas no painel mais alto.
    const casas = 22
    const passo = (meiaViga * 2) / casas
    const meiaAltura = painelAltura / 2
    for (let fileira = 0; fileira < 2; fileira += 1) {
      for (let i = 0; i < casas; i += 1) {
        ctx.fillStyle = (i + fileira) % 2 === 0 ? '#f3f3ed' : '#11151a'
        ctx.fillRect(projetado.center - meiaViga + i * passo, painelTopo + fileira * meiaAltura, passo + 1, meiaAltura + 1)
      }
    }
  } else if (placas) {
    const placa = placas[variante % placas.length]
    const esquerda = projetado.center - meiaViga * 0.92
    const larguraPainel = meiaViga * 1.84
    ctx.drawImage(placa, esquerda, painelTopo, larguraPainel, painelAltura)
    // Moldura escura: sem ela a placa clara se mistura com o céu.
    ctx.fillStyle = PORTICO[0]
    const borda = Math.max(1, painelAltura * 0.05)
    ctx.fillRect(esquerda - borda, painelTopo - borda, borda, painelAltura + borda * 2)
    ctx.fillRect(esquerda + larguraPainel, painelTopo - borda, borda, painelAltura + borda * 2)
  } else {
    const tinta = FAIXAS_DO_PORTICO[variante % FAIXAS_DO_PORTICO.length]
    ctx.fillStyle = tinta[2]
    ctx.fillRect(projetado.center - meiaViga * 0.92, painelTopo, meiaViga * 1.84, painelAltura)
    ctx.fillStyle = tinta[4]
    ctx.fillRect(projetado.center - meiaViga * 0.92, painelTopo, meiaViga * 1.84, Math.max(1, painelAltura * 0.22))
  }
  ctx.globalAlpha = nitidez
}

// ---------------------------------------------------------------------------
// Faixa de meio-campo
// ---------------------------------------------------------------------------

/**
 * Largura e altura da tira assada, em pixels.
 *
 * Ela é desenhada como padrão que se repete, então a largura só precisa ser
 * grande o bastante para o olho não pegar a repetição — não tem relação com o
 * tamanho da tela. Na hora do desenho ela é esticada para a altura pedida.
 */
const FAIXA_LARGURA = 960
const FAIXA_ALTURA = 120

/**
 * Sorteio determinístico da tira.
 *
 * Não usa `Math.random` e não usa a semente da corrida: a tira é decoração de
 * horizonte, igual para todo mundo que correr naquele lugar. Um gerador
 * próprio de quatro linhas evita arrastar o traçado para dentro do assador.
 */
function sorteio(semente: number) {
  let estado = semente >>> 0
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0
    return estado / 0x100000000
  }
}

/**
 * Desenha uma silhueta e repete a que cruza a borda direita do outro lado.
 *
 * É o que faz a tira emendar consigo mesma: sem isso, a repetição do padrão
 * mostra uma costura vertical atravessando o horizonte a cada volta.
 */
function naTira(ctx: CanvasRenderingContext2D, x: number, desenhar: (x: number) => void) {
  desenhar(x)
  if (x > FAIXA_LARGURA - 200) desenhar(x - FAIXA_LARGURA)
  if (x < 200) desenhar(x + FAIXA_LARGURA)
}

function assarFaixa(lugar: Lugar, tons: Rampa): HTMLCanvasElement {
  const tela = document.createElement('canvas')
  tela.width = FAIXA_LARGURA
  tela.height = FAIXA_ALTURA
  const ctx = tela.getContext('2d')!
  const proximo = sorteio(lugar.length * 7919 + 13)
  const base = FAIXA_ALTURA

  if (lugar === 'cidade') {
    // Silhueta de cidade: blocos de altura variada, com a laje acesa e umas
    // poucas janelas. É o que Top Gear punha atrás da pista nas etapas urbanas.
    for (let i = 0; i < 46; i += 1) {
      const x = proximo() * FAIXA_LARGURA
      const largura = 26 + proximo() * 46
      const altura = 30 + proximo() * 78
      const acesas = proximo() < 0.5
      naTira(ctx, x, (px) => {
        ctx.fillStyle = tons[1]
        ctx.fillRect(px, base - altura, largura, altura)
        ctx.fillStyle = tons[3]
        ctx.fillRect(px, base - altura, largura, 4)
        if (!acesas) return
        ctx.fillStyle = tons[4]
        for (let j = 0; j < 3; j += 1) {
          ctx.fillRect(px + 6 + j * 12, base - altura + 12, 5, 6)
        }
      })
    }
    return tela
  }

  if (lugar === 'deserto') {
    // Dunas: cristas largas e rasas que se sobrepõem, sem nada vertical.
    for (let i = 0; i < 16; i += 1) {
      const x = proximo() * FAIXA_LARGURA
      const largura = 190 + proximo() * 220
      const altura = 26 + proximo() * 34
      naTira(ctx, x, (px) => {
        ctx.fillStyle = tons[i % 2 === 0 ? 1 : 2]
        ctx.beginPath()
        ctx.moveTo(px - largura / 2, base)
        ctx.quadraticCurveTo(px - largura * 0.18, base - altura * 1.5, px + largura * 0.2, base - altura * 0.7)
        ctx.quadraticCurveTo(px + largura * 0.42, base - altura * 0.2, px + largura / 2, base)
        ctx.closePath()
        ctx.fill()
      })
    }
    return tela
  }

  if (lugar === 'montanha') {
    // Cumeada de rocha: uma linha quebrada só, com a face do sol acesa.
    const passo = 34
    const alturas: number[] = []
    for (let x = 0; x <= FAIXA_LARGURA + passo; x += passo) {
      alturas.push(34 + proximo() * 62)
    }
    // A última amostra volta a ser a primeira, senão a tira não emenda.
    alturas[alturas.length - 1] = alturas[0]
    ctx.fillStyle = tons[1]
    ctx.beginPath()
    ctx.moveTo(0, base)
    alturas.forEach((altura, i) => ctx.lineTo(i * passo, base - altura))
    ctx.lineTo(FAIXA_LARGURA, base)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = tons[3]
    ctx.beginPath()
    alturas.forEach((altura, i) => {
      const x = i * passo
      if (i === 0) ctx.moveTo(x, base - altura)
      else ctx.lineTo(x, base - altura)
    })
    for (let i = alturas.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(i * passo + passo * 0.32, base - alturas[i] + 9)
    }
    ctx.closePath()
    ctx.fill()
    return tela
  }

  // Campo: linha de mata, alternando copa redonda e conífera.
  for (let i = 0; i < 64; i += 1) {
    const x = proximo() * FAIXA_LARGURA
    const altura = 42 + proximo() * 46
    const meia = altura * (0.3 + proximo() * 0.16)
    const conifera = proximo() < 0.42
    naTira(ctx, x, (px) => {
      ctx.fillStyle = tons[1]
      if (conifera) {
        ctx.beginPath()
        ctx.moveTo(px, base - altura)
        ctx.lineTo(px + meia, base)
        ctx.lineTo(px - meia, base)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.ellipse(px, base - altura * 0.58, meia, altura * 0.58, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      // Realce discreto no alto e à esquerda. Com o tom mais claro da rampa
      // ele virava uma bolinha, e a mata inteira lia como pontilhado.
      ctx.fillStyle = tons[2]
      ctx.beginPath()
      ctx.ellipse(px - meia * 0.4, base - altura * 0.78, meia * 0.42, altura * 0.16, 0, 0, Math.PI * 2)
      ctx.fill()
    })
  }
  return tela
}

const faixas = new Map<string, HTMLCanvasElement>()

/**
 * A faixa que fecha o fundo, entre a serra e a grama.
 *
 * É o degrau que faltava no horizonte: sem ela, a montanha encosta direto na
 * grama e a distância entre as duas vira um salto. Custa um preenchimento por
 * quadro, porque a tira é um padrão que se repete — o deslocamento a faz
 * correr com a curva, mais depressa que a serra e mais devagar que as árvores
 * da beira da pista, que é o que dá a leitura de camadas.
 */
export function desenharFaixaDeFundo(
  ctx: CanvasRenderingContext2D,
  lugar: Lugar,
  corBase: string,
  largura: number,
  base: number,
  altura: number,
  deslocamento: number,
) {
  const chave = `${lugar}|${corBase}`
  let tira = faixas.get(chave)
  if (!tira) {
    tira = assarFaixa(lugar, rampa(corBase))
    faixas.set(chave, tira)
    // Uma por corrida basta; a anterior some junto com o ambiente.
    if (faixas.size > 2) {
      const maisVelha = faixas.keys().next()
      if (!maisVelha.done) faixas.delete(maisVelha.value)
    }
  }

  const escala = altura / FAIXA_ALTURA
  const passo = FAIXA_LARGURA * escala
  const inicio = -(((deslocamento % passo) + passo) % passo)
  ctx.save()
  ctx.translate(inicio, base - altura)
  ctx.scale(escala, escala)
  for (let x = 0; x < (largura - inicio) / escala; x += FAIXA_LARGURA) {
    ctx.drawImage(tira, x, 0)
  }
  ctx.restore()
}
