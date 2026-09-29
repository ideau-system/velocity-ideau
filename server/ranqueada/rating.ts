import { predictWin, rate, rating as novoMmr, type Rating } from 'openskill'
import { bradleyTerryFull } from 'openskill/models'

/**
 * A ranqueada, no molde da Riot de 2025–2026 e do TFT, sobre um MMR de
 * OpenSkill.
 *
 * Dois números por piloto, como no LoL:
 *
 * - O **MMR**, oculto, é o OpenSkill com o modelo Bradley-Terry completo: cada
 *   corrida de seis vira quinze duelos. Foi o de menor erro em partidas de
 *   todos contra todos no artigo que o criou, tem forma fechada e licença MIT,
 *   e em salas de seis reduz a incerteza duas vezes mais depressa que o
 *   Plackett-Luce — o que decide se o rank significa alguma coisa em poucas
 *   corridas, com pouca gente jogando.
 * - Os **PL** (pontos de liga), visíveis, andam pela colocação — a metade de
 *   cima ganha, a de baixo perde, como no TFT — e convergem para o MMR com um
 *   multiplicador limitado, como o LP do LoL: nunca um +10/−30, que a Riot
 *   chamou de péssima experiência.
 *
 * Sem série de promoção, que a Riot tirou pelo estresse; colocação sem perda;
 * proteção só na queda de tier; nada de decay.
 */

export type Mmr = { mu: number; sigma: number }

export const TIERS = ['bronze', 'prata', 'ouro', 'platina', 'diamante', 'mestre'] as const
export type Tier = (typeof TIERS)[number]

export const NOME_DO_TIER: Record<Tier, string> = {
  bronze: 'Bronze',
  prata: 'Prata',
  ouro: 'Ouro',
  platina: 'Platina',
  diamante: 'Diamante',
  mestre: 'Mestre',
}

/** PL de uma divisão. Metas curtas: é o efeito de gradiente de meta. */
export const PL_POR_DIVISAO = 100
/** Divisões por tier, de III a I. Três, e não quatro: a população é pequena. */
export const DIVISOES_POR_TIER = 3
export const PL_POR_TIER = PL_POR_DIVISAO * DIVISOES_POR_TIER
/** Onde começa o Mestre, a escada aberta. */
export const PL_DO_MESTRE = PL_POR_TIER * (TIERS.length - 1)
/** Corridas de colocação da primeira temporada, sem perda de PL. */
export const CORRIDAS_DE_COLOCACAO = 5
/** Corridas de colocação depois de um reset de temporada. */
export const COLOCACAO_NA_VIRADA = 3
/** Teto da colocação: ninguém é colocado acima do Ouro I, como o LoL não coloca acima do Diamond III. */
export const TETO_DA_COLOCACAO = PL_POR_TIER * 3 - 1
/** Corridas de escudo depois de subir de tier. */
export const ESCUDO_DO_TIER = 3
/** PL com que se entra no tier de baixo ao cair: a divisão I dele, com 75. */
export const PL_AO_CAIR = 75
/** Tiers que não caem: Bronze e Prata, como o TFT não derruba do Iron ao Master. */
const TIERS_SEM_QUEDA = 2
/** Quanto vale cada degrau da tabela de colocação. */
const PL_POR_DEGRAU = 10
/** PL extra que o abandono custa. */
export const PL_DO_ABANDONO = 5
/** Limites do multiplicador de convergência, como o +35/−25 do LoL. */
const MULTIPLICADOR = { minimo: 0.75, maximo: 1.25, escala: 400 }
/** Acima disto o piloto está abaixo do próprio nível, e a tela avisa. */
export const INDICADOR_DE_SUBIDA = 1.1

/**
 * Crescimento da incerteza por dia sem correr.
 *
 * O MMR não cai com a ausência — decay é para proteger um topo concorrido, e
 * aqui ninguém disputa vaga —, mas a certeza sobre ele cai, e as primeiras
 * corridas da volta mexem mais. É o passo 6 do Glicko-2 e o τ²·Δt do TrueSkill 2.
 */
const INCERTEZA_POR_DIA = 0.3
const SIGMA_INICIAL = 25 / 3

/** O estado ranqueado de um piloto numa temporada. */
export type EstadoRanqueado = {
  mmr: Mmr
  pl: number
  corridas: number
  /** Corridas de colocação que ainda faltam. */
  colocacao: number
  /** Corridas de escudo contra a queda de tier. */
  escudo: number
  pico: number
  podios: number
  abandonos: number
  /** Instante da última corrida, para a incerteza crescer com a ausência. */
  ultimaCorrida: number | null
}

export function estadoInicial(): EstadoRanqueado {
  const { mu, sigma } = novoMmr()
  return {
    mmr: { mu, sigma },
    pl: 0,
    corridas: 0,
    colocacao: CORRIDAS_DE_COLOCACAO,
    escudo: 0,
    pico: 0,
    podios: 0,
    abandonos: 0,
    ultimaCorrida: null,
  }
}

/** Como o piloto terminou: pela linha, sem terminar, ou abandonando. */
export type Desfecho = 'chegou' | 'naoTerminou' | 'abandonou'

export type Participante = {
  perfilId: string
  desfecho: Desfecho
  /** Tempo de prova, para quem chegou. */
  tempo: number | null
  estado: EstadoRanqueado
}

/** A divisão de um total de PL, para a tela. */
export type Divisao = { tier: Tier; divisao: number | null; pl: number }

export function divisaoDe(pl: number): Divisao {
  const total = Math.max(0, Math.floor(pl))
  if (total >= PL_DO_MESTRE) return { tier: 'mestre', divisao: null, pl: total - PL_DO_MESTRE }
  const indice = Math.floor(total / PL_POR_TIER)
  const dentro = total % PL_POR_TIER
  return { tier: TIERS[indice], divisao: DIVISOES_POR_TIER - Math.floor(dentro / PL_POR_DIVISAO), pl: dentro % PL_POR_DIVISAO }
}

const ROMANOS = ['', 'I', 'II', 'III']

/** "Ouro II · 45 PL", "Mestre · 120 PL". */
export function nomeDaDivisao(pl: number) {
  const { tier, divisao, pl: resto } = divisaoDe(pl)
  return divisao === null ? `${NOME_DO_TIER[tier]} · ${resto} PL` : `${NOME_DO_TIER[tier]} ${ROMANOS[divisao]} · ${resto} PL`
}

/**
 * Onde os PL deveriam estar para um MMR.
 *
 * O μ médio de 25 cai no Ouro III; cada ponto de μ vale 50 PL. É um palpite
 * inicial, a recalibrar pelos percentis da população ao fim de cada temporada
 * — com gente de menos, tier demais fica vazio.
 */
export function plAlvo(mmr: Mmr) {
  return Math.max(0, Math.min(PL_DO_MESTRE * 2, (mmr.mu - 10) * 50))
}

/** O multiplicador que puxa os PL para o MMR: ganha mais e perde menos quem está abaixo do próprio nível. */
export function multiplicadorDeConvergencia(estado: EstadoRanqueado) {
  const bruto = 1 + (plAlvo(estado.mmr) - estado.pl) / MULTIPLICADOR.escala
  return Math.max(MULTIPLICADOR.minimo, Math.min(MULTIPLICADOR.maximo, bruto))
}

/**
 * PL da colocação numa sala de N pilotos, com MMR igual.
 *
 * Com seis: +30, +20, +10, −10, −20, −30. A metade de cima nunca perde e a de
 * baixo nunca ganha, como no TFT; com número ímpar, o do meio fica no zero.
 * Salas menores movem menos, porque dizem menos: o duelo vale ±10.
 */
export function plDaColocacao(posicao: number, pilotos: number) {
  const meio = (pilotos + 1) / 2
  if (posicao < meio) return PL_POR_DEGRAU * (meio - posicao + 0.5)
  if (posicao > meio) return -PL_POR_DEGRAU * (posicao - meio + 0.5)
  return 0
}

/**
 * A ordem da corrida para o rating: quem chegou, pelo tempo; depois quem não
 * terminou, empatados; por fim quem abandonou, empatados. Devolve o posto de
 * cada um (1 é o primeiro), com empate repetindo o posto.
 */
export function ordemDaCorrida(participantes: readonly Pick<Participante, 'desfecho' | 'tempo'>[]) {
  const grupo = (p: Pick<Participante, 'desfecho'>) => (p.desfecho === 'chegou' ? 0 : p.desfecho === 'naoTerminou' ? 1 : 2)
  return participantes.map((p) => {
    let acima = 0
    for (const outro of participantes) {
      if (grupo(outro) < grupo(p)) acima += 1
      else if (grupo(outro) === 0 && grupo(p) === 0 && (outro.tempo ?? Infinity) < (p.tempo ?? Infinity)) acima += 1
    }
    return acima + 1
  })
}

/** Posição média de quem divide um posto: dois empatados em 5º contam como 5,5. */
function posicaoMedia(posto: number, postos: readonly number[]) {
  const empatados = postos.filter((outro) => outro === posto).length
  return posto + (empatados - 1) / 2
}

/** A incerteza depois de dias sem correr. */
export function comAusencia(mmr: Mmr, ultimaCorrida: number | null, agora: number): Mmr {
  if (ultimaCorrida === null) return mmr
  const dias = Math.max(0, (agora - ultimaCorrida) / 86_400_000)
  const sigma = Math.min(SIGMA_INICIAL, Math.sqrt(mmr.sigma ** 2 + INCERTEZA_POR_DIA ** 2 * dias))
  return { mu: mmr.mu, sigma }
}

/** Chance de um piloto ficar à frente do outro, pelo MMR de antes da corrida. */
export function chanceDeFicarAFrente(a: Mmr, b: Mmr) {
  return predictWin([[a], [b]], { model: bradleyTerryFull })[0]
}

export type Atualizacao = {
  perfilId: string
  posto: number
  antes: EstadoRanqueado
  depois: EstadoRanqueado
  deltaPl: number
  /** O multiplicador de convergência aplicado: acima de 1,1, a tela avisa que o piloto está subindo. */
  multiplicador: number
  /** Subiu ou caiu de tier nesta corrida. */
  mudouDeTier: 'subiu' | 'caiu' | null
  /** Contra cada rival: a chance que o MMR dava de ficar à frente dele, e se ficou. */
  rivais: Array<{ perfilId: string; chance: number; ficouAFrente: boolean | null }>
}

/**
 * Atualiza MMR e PL de todos os pilotos de uma corrida ranqueada.
 *
 * `fatorDePl` reduz os PL — não o MMR — quando o mesmo grupo corre junto vezes
 * demais: é o retorno decrescente contra quem combina resultado.
 */
export function atualizarRatings(participantes: readonly Participante[], agora: number, fatorDePl = 1): Atualizacao[] {
  if (participantes.length < 2) return []
  const postos = ordemDaCorrida(participantes)
  const antes = participantes.map((p) => comAusencia(p.estado.mmr, p.estado.ultimaCorrida, agora))
  const novos = rate(
    antes.map((mmr) => [{ mu: mmr.mu, sigma: mmr.sigma } as Rating]),
    { rank: postos, model: bradleyTerryFull },
  ).map(([mmr]) => ({ mu: mmr.mu, sigma: mmr.sigma }))

  const n = participantes.length
  return participantes.map((participante, i) => {
    const estado = participante.estado
    const mmr = novos[i]
    const posto = postos[i]
    const base = plDaColocacao(posicaoMedia(posto, postos), n) - (participante.desfecho === 'abandonou' ? PL_DO_ABANDONO : 0)
    const multiplicador = multiplicadorDeConvergencia({ ...estado, mmr })
    const depois: EstadoRanqueado = {
      ...estado,
      mmr,
      corridas: estado.corridas + 1,
      podios: estado.podios + (posto <= 3 && participante.desfecho === 'chegou' ? 1 : 0),
      abandonos: estado.abandonos + (participante.desfecho === 'abandonou' ? 1 : 0),
      ultimaCorrida: agora,
    }

    let deltaPl = 0
    let mudouDeTier: Atualizacao['mudouDeTier'] = null
    if (estado.colocacao > 0) {
      // Colocação: sem perda; na última, os PL vão para onde o MMR aponta,
      // com teto no Ouro I.
      depois.colocacao = estado.colocacao - 1
      if (depois.colocacao === 0) depois.pl = Math.min(TETO_DA_COLOCACAO, Math.round(plAlvo(mmr)))
      deltaPl = depois.pl - estado.pl
    } else {
      const bruto = base >= 0 ? base * multiplicador : base * (2 - multiplicador)
      // Bronze e Prata perdem pela metade: o topo é de quem já sabe.
      const leniente = bruto < 0 && estado.pl < PL_POR_TIER * TIERS_SEM_QUEDA ? bruto / 2 : bruto
      let pl = Math.max(0, estado.pl + Math.round(leniente * fatorDePl))
      const tierAntes = Math.min(TIERS.length - 1, Math.floor(estado.pl / PL_POR_TIER))
      const pisoDoTier = tierAntes * PL_POR_TIER
      if (pl < pisoDoTier) {
        if (tierAntes < TIERS_SEM_QUEDA || estado.escudo > 0) {
          // Bronze e Prata não caem de tier, e o escudo segura quem acabou de subir.
          pl = pisoDoTier
        } else {
          // Cai para a divisão I do tier de baixo, com 75 PL.
          pl = pisoDoTier - PL_POR_DIVISAO + PL_AO_CAIR
          mudouDeTier = 'caiu'
        }
      }
      const tierDepois = Math.min(TIERS.length - 1, Math.floor(pl / PL_POR_TIER))
      if (tierDepois > tierAntes) mudouDeTier = 'subiu'
      depois.pl = pl
      depois.escudo = mudouDeTier === 'subiu' ? ESCUDO_DO_TIER : Math.max(0, estado.escudo - 1)
      deltaPl = pl - estado.pl
    }
    depois.pico = Math.max(estado.pico, depois.pl)

    const rivais = participantes.flatMap((rival, j) =>
      j === i
        ? []
        : [
            {
              perfilId: rival.perfilId,
              chance: chanceDeFicarAFrente(antes[i], antes[j]),
              ficouAFrente: postos[i] === postos[j] ? null : postos[i] < postos[j],
            },
          ],
    )

    return { perfilId: participante.perfilId, posto, antes: estado, depois, deltaPl, multiplicador, mudouDeTier, rivais }
  })
}

/**
 * Temporada de um instante: uma por semestre, no fuso de Brasília — `2026.2`
 * vai de julho a dezembro. Um reset por semestre acompanha o calendário
 * acadêmico, e fica longe dos três resets por ano que cansaram o LoL em 2024.
 */
export function temporadaDe(instante: number) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: 'numeric' })
    .formatToParts(new Date(instante))
  const ano = Number(partes.find((parte) => parte.type === 'year')?.value)
  const mes = Number(partes.find((parte) => parte.type === 'month')?.value)
  return `${ano}.${mes <= 6 ? 1 : 2}`
}

/**
 * O estado de um piloto na temporada nova, a partir do da anterior.
 *
 * Reset suave: o μ volta 30% do caminho até a média, a incerteza cresce um
 * pouco, e três corridas de colocação recolocam os PL.
 */
export function viradaDeTemporada(anterior: EstadoRanqueado | null): EstadoRanqueado {
  if (!anterior) return estadoInicial()
  const inicial = estadoInicial()
  return {
    ...inicial,
    mmr: {
      mu: inicial.mmr.mu + (anterior.mmr.mu - inicial.mmr.mu) * 0.7,
      sigma: Math.min(SIGMA_INICIAL, Math.max(anterior.mmr.sigma, SIGMA_INICIAL * 0.6)),
    },
    colocacao: COLOCACAO_NA_VIRADA,
  }
}
