/**
 * Como o fantasma aparece na tela.
 *
 * Com cinco rivais na pista, um carro translúcido sozinho não diz quem é quem,
 * e de longe ele some na bruma do horizonte. Aqui moram as três coisas que o
 * tornam legível: a transparência, que sobe com a distância; a etiqueta com a
 * posição e o nome, na cor do carro; e o radar de quem vem colado atrás, que a
 * câmera não mostra.
 */
import { CAIXA_CARRO } from './carModel'
import { VIEW_DISTANCE } from './track'

/** Topo do desenho do carro, em unidades do sprite, acima do ponto em que ele toca o chão. */
const TOPO_DO_CARRO = -CAIXA_CARRO.y
/** Até onde, atrás do carro, o radar avisa de quem vem vindo. */
export const ALCANCE_DO_RADAR_M = 90

/**
 * Transparência do fantasma.
 *
 * Com seis na pista, nem todo fantasma importa igual: o recorde pessoal e o
 * rival mais próximo — o da disputa naquele trecho — ficam mais opacos; os
 * demais, a meia opacidade, presentes sem roubar a atenção. Todos ganham um
 * pouco de longe, onde o carro vira meia dúzia de pixels contra a bruma. Sem
 * sinal, apaga; quem já chegou fica discreto, parado na linha.
 */
export function opacidadeDoFantasma(profundidade: number, estado: { semSinal: boolean; chegou: boolean; destaque?: boolean }) {
  if (estado.semSinal) return 0.23
  if (estado.chegou) return 0.3
  const longe = Math.max(0, Math.min(1, (profundidade - 40) / 140))
  return estado.destaque ? 0.66 + 0.14 * longe : 0.46 + 0.08 * longe
}

/** Quantos fantasmas levam o nome na etiqueta; os outros levam só a posição. */
export const NOMES_NA_PISTA = 2

export type CandidatoAoDestaque = {
  id: string
  /** Metros até quem se está olhando, em valor absoluto: à frente ou atrás. */
  distancia: number
  /** O fantasma do recorde pessoal, que não disputa posição. */
  recorde: boolean
}

/**
 * A hierarquia dos fantasmas no quadro.
 *
 * Em destaque, mais opacos: o recorde pessoal e o rival mais próximo, à frente
 * ou atrás. Com nome na etiqueta: os dois mais próximos, e o recorde sempre —
 * cinco nomes na tela eram cinco coisas para ler numa curva; a posição basta
 * para os outros, e a classificação ao lado diz quem é quem.
 */
export function hierarquiaDosFantasmas(candidatos: readonly CandidatoAoDestaque[]) {
  const ordem = [...candidatos].sort((a, b) => a.distancia - b.distancia)
  const rivalMaisProximo = ordem.find((candidato) => !candidato.recorde)?.id ?? null
  return new Map(
    ordem.map((candidato, indice) => [
      candidato.id,
      {
        destaque: candidato.recorde || candidato.id === rivalMaisProximo,
        comNome: candidato.recorde || indice < NOMES_NA_PISTA,
      },
    ]),
  )
}

/** Texto escuro sobre cor clara, claro sobre cor escura: a luminância relativa decide. */
export function corDoTexto(hex: string) {
  const limpo = hex.replace('#', '')
  const cheio = limpo.length === 3 ? limpo.split('').map((c) => c + c).join('') : limpo
  const canal = (i: number) => {
    const v = parseInt(cheio.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  if (!/^[0-9a-f]{6}$/i.test(cheio)) return '#ffffff'
  const luminancia = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4)
  return luminancia > 0.4 ? '#0b0f14' : '#ffffff'
}

/** Opacidade da etiqueta: inteira até 70 m, e cedendo até um quarto no fim da vista. */
export function opacidadeDaEtiqueta(profundidade: number) {
  if (profundidade <= 70) return 1
  return Math.max(0.25, 1 - ((profundidade - 70) / (VIEW_DISTANCE - 70)) * 0.75)
}

export type EtiquetaDoFantasma = {
  x: number
  /** Onde o carro toca a pista, na tela. */
  chao: number
  /** Escala do desenho do carro. */
  escala: number
  texto: string
  cor: string
  profundidade: number
  /** De boost agora: a etiqueta ganha o contorno ciano do medidor de boost. */
  boost?: boolean
}

/** A cor do boost ativo: a do medidor aceso, e a do contorno da etiqueta. */
export const COR_DO_BOOST = '#43e7ff'

/** O fundo dos painéis do HUD, no halo que separa o anel de boost da etiqueta. */
const COR_DO_HALO = '#04070b'

/** Degraus que uma etiqueta sobe para não encostar na de outro carro, antes de sumir. */
export const DEGRAUS_DAS_ETIQUETAS = 3

/** Tamanho da letra da etiqueta: acompanha o carro, com piso para ler de longe e teto para não tapar de perto. */
const tamanhoDaEtiqueta = (escala: number) => Math.round(Math.max(10, Math.min(16, 14 * escala)))

type Caixa = { x: number; y: number; largura: number; altura: number }

/**
 * Em que degrau vai cada etiqueta.
 *
 * Um pelotão lá na frente punha cinco etiquetas no mesmo ponto, uma em cima da
 * outra. Na ordem recebida — a do carro mais perto primeiro, que é o que mais
 * importa —, cada etiqueta fica no lugar dela se couber; senão sobe um degrau,
 * e mais outro, formando uma torre de nomes sobre o pelotão. Sem degrau livre,
 * some: o carro continua lá, e a classificação diz quem é.
 */
export function degrausDasEtiquetas(caixas: readonly Caixa[], degraus = DEGRAUS_DAS_ETIQUETAS) {
  const ocupadas: Caixa[] = []
  const encosta = (a: Caixa, b: Caixa) =>
    a.x < b.x + b.largura && b.x < a.x + a.largura && a.y < b.y + b.altura && b.y < a.y + a.altura
  return caixas.map((caixa) => {
    for (let degrau = 0; degrau < degraus; degrau += 1) {
      const tentativa = { ...caixa, y: caixa.y - degrau * (caixa.altura + 2) }
      if (ocupadas.some((outra) => encosta(tentativa, outra))) continue
      ocupadas.push(tentativa)
      return degrau
    }
    return null
  })
}

/**
 * As etiquetas acima dos fantasmas: "P2 SCHUMI", numa pílula da cor do carro,
 * com o bico apontando para ele. Quem subiu de degrau ganha uma haste até o
 * próprio carro, para a torre continuar dizendo de quem é cada nome.
 */
export function desenharEtiquetasDosFantasmas(ctx: CanvasRenderingContext2D, etiquetas: readonly EtiquetaDoFantasma[]) {
  if (etiquetas.length === 0) return
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const medidas = [...etiquetas]
    .sort((a, b) => a.profundidade - b.profundidade)
    .map((etiqueta) => {
      const tamanho = tamanhoDaEtiqueta(etiqueta.escala)
      ctx.font = `800 ${tamanho}px 'Barlow Condensed', sans-serif`
      const largura = ctx.measureText(etiqueta.texto).width + tamanho
      const altura = tamanho + 5
      const topo = etiqueta.chao - TOPO_DO_CARRO * etiqueta.escala - 6 - altura
      return { etiqueta, tamanho, caixa: { x: etiqueta.x - largura / 2, y: topo, largura, altura } }
    })
  const degraus = degrausDasEtiquetas(medidas.map(({ caixa }) => caixa))
  // Desenha do mais longe para o mais perto: o mais perto fica por cima.
  for (let i = medidas.length - 1; i >= 0; i -= 1) {
    const degrau = degraus[i]
    if (degrau === null) continue
    const { etiqueta, tamanho, caixa } = medidas[i]
    const topo = caixa.y - degrau * (caixa.altura + 2)
    ctx.globalAlpha = opacidadeDaEtiqueta(etiqueta.profundidade)
    ctx.font = `800 ${tamanho}px 'Barlow Condensed', sans-serif`
    if (degrau > 0) {
      ctx.strokeStyle = etiqueta.cor
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(etiqueta.x, topo + caixa.altura)
      ctx.lineTo(etiqueta.x, caixa.y + caixa.altura + 4)
      ctx.stroke()
    }
    ctx.fillStyle = etiqueta.cor
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(caixa.x, topo, caixa.largura, caixa.altura, caixa.altura / 2)
    else ctx.rect(caixa.x, topo, caixa.largura, caixa.altura)
    if (degrau === 0) {
      ctx.moveTo(etiqueta.x - 4, topo + caixa.altura)
      ctx.lineTo(etiqueta.x, topo + caixa.altura + 4)
      ctx.lineTo(etiqueta.x + 4, topo + caixa.altura)
    }
    ctx.fill()
    // Rival de boost: o contorno ciano diz, sem texto a mais, que ele está
    // mandando a força toda agora — é a hora de ele abrir ou de fechar a porta.
    // Um halo escuro por baixo separa o anel da etiqueta e do fundo: sem ele, o
    // ciano sumia na etiqueta das Mercedes, que já é quase ciano.
    if (etiqueta.boost) {
      ctx.strokeStyle = COR_DO_HALO
      ctx.lineWidth = 5
      ctx.stroke()
      ctx.strokeStyle = COR_DO_BOOST
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.fillStyle = corDoTexto(etiqueta.cor)
    ctx.fillText(etiqueta.texto, etiqueta.x, topo + caixa.altura / 2 + 0.5)
  }
  ctx.restore()
}

export type RivalAtras = {
  /** Coluna da tela em que ele vem, já projetada na profundidade do carro. */
  x: number
  /** Metros atrás do carro. */
  distancia: number
  nome: string
  cor: string
}

/** Linhas de rótulo que o radar empilha antes de deixar só a seta. */
export const LINHAS_DO_RADAR = 3

/**
 * Em que linha vai o rótulo de cada rival do radar.
 *
 * Dois carros atrás na mesma coluna escreviam o nome um em cima do outro. Na
 * ordem recebida — a do mais perto primeiro —, cada rótulo fica na primeira
 * linha em que não encosta em nenhum outro; sem linha livre, fica só a seta.
 */
export function linhasDosRotulos(itens: ReadonlyArray<{ x: number; largura: number }>, maxLinhas = LINHAS_DO_RADAR) {
  const ocupadas: Array<Array<[number, number]>> = Array.from({ length: maxLinhas }, () => [])
  return itens.map(({ x, largura }) => {
    const inicio = x - largura / 2 - 4
    const fim = x + largura / 2 + 4
    const linha = ocupadas.findIndex((trechos) => trechos.every(([a, b]) => fim <= a || inicio >= b))
    if (linha < 0) return null
    ocupadas[linha].push([inicio, fim])
    return linha
  })
}

/**
 * Radar de quem vem colado atrás: uma seta na cor do carro, logo abaixo das
 * rodas do próprio carro — `base` —, na coluna em que o rival vem. Quanto mais
 * perto, maior e mais forte. É a informação que o retrovisor daria — e que a
 * câmera, olhando para a frente, não tem como mostrar.
 */
export function desenharRadarTraseiro(ctx: CanvasRenderingContext2D, rivais: readonly RivalAtras[], largura: number, base: number) {
  if (rivais.length === 0) return
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = `700 10px 'Barlow Condensed', sans-serif`
  // O mais perto primeiro: é dele a primeira linha, e é ele quem ameaça.
  const ordenados = [...rivais]
    .sort((a, b) => a.distancia - b.distancia)
    .map((rival) => {
      const x = Math.max(18, Math.min(largura - 18, rival.x))
      const texto = `${rival.nome} ${Math.max(1, Math.round(rival.distancia))} m`
      return { rival, x, texto, largura: ctx.measureText(texto).width }
    })
  const linhas = linhasDosRotulos(ordenados)
  ordenados.forEach(({ rival, x, texto }, indice) => {
    const perto = 1 - Math.min(1, rival.distancia / ALCANCE_DO_RADAR_M)
    const tamanho = 6 + 6 * perto
    ctx.globalAlpha = 0.35 + 0.65 * perto
    ctx.fillStyle = rival.cor
    ctx.beginPath()
    ctx.moveTo(x, base - tamanho)
    ctx.lineTo(x + tamanho, base)
    ctx.lineTo(x - tamanho, base)
    ctx.closePath()
    ctx.fill()
    const linha = linhas[indice]
    if (linha === null) return
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = 'rgba(0,0,0,.7)'
    ctx.shadowBlur = 3
    ctx.fillText(texto, x, base + 3 + linha * 12)
    ctx.shadowBlur = 0
  })
  ctx.restore()
}
