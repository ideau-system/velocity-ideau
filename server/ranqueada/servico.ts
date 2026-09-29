import { randomUUID } from 'node:crypto'
import type { Difficulty } from '../../src/game/rules.js'
import type { Repositorio, VoltaRanqueada } from '../dados/tipos.js'
import type { RaceOutcome } from '../rooms.js'
import { formarSalas, type EntradaDaFila } from './fila.js'
import {
  atualizarRatings,
  divisaoDe,
  estadoInicial,
  INDICADOR_DE_SUBIDA,
  multiplicadorDeConvergencia,
  nomeDaDivisao,
  PL_DO_MESTRE,
  plAlvo,
  temporadaDe,
  viradaDeTemporada,
  type Desfecho,
  type EstadoRanqueado,
  type Participante,
  type Tier,
} from './rating.js'

/** Esperas por desistência, crescentes dentro de 24 horas: 1, 5 e 30 minutos. */
const ESPERAS_POR_DESISTENCIA_MS = [60_000, 300_000, 1_800_000]
const JANELA_DAS_DESISTENCIAS_MS = 86_400_000
/** Mais que isto de corridas juntas na última hora, e os PL do grupo caem pela metade. */
const CORRIDAS_JUNTAS_TOLERADAS = 3
/** Quantos pilotos em comum fazem um "grupo" para o retorno decrescente. */
const PILOTOS_EM_COMUM = 3
/** Quantos do topo do Mestre recebem o selo de Lenda. */
export const LENDAS = 5
/** Dias sem correr até sair da escada visível do Mestre. */
const DIAS_ATE_SAIR_DA_ESCADA = 14
/** Quanto alguém espera sozinho na fila até correr contra fantasmas. */
export const ESPERA_COM_FANTASMAS_MS = 40_000
/** Até quantos fantasmas completam a sala de quem está sozinho. */
const FANTASMAS_POR_SALA = 5
/** Até que idade uma volta ranqueada serve de fantasma. */
const IDADE_DO_FANTASMA_MS = 14 * 86_400_000
/** Piso da incerteza do fantasma: a volta é uma só, e o MMR de quem a correu é uma estimativa. */
const SIGMA_DO_FANTASMA = 2

/** O estado ranqueado como a tela o mostra. */
export type PainelRanqueado = {
  temporada: string
  pl: number
  tier: Tier
  divisao: string
  colocacao: number
  /** Quantas corridas a colocação tem nesta temporada: 5 na primeira, 3 depois de um reset. */
  colocacaoTotal: number
  corridas: number
  pico: number
  podios: number
  abandonos: number
  escudo: number
  posicao: number | null
  /** O MMR está acima dos PL: a tela avisa que o piloto está subindo mais depressa. */
  subindo: boolean
}

/** O que cada piloto vê no fim de uma corrida ranqueada. */
export type ResultadoRanqueado = {
  playerId: string
  perfilId: string
  apelido: string
  posto: number
  deltaPl: number
  plAntes: number
  plDepois: number
  divisao: string
  colocacao: number
  colocacaoTotal: number
  mudouDeTier: 'subiu' | 'caiu' | null
  subindo: boolean
  /** Os PL foram reduzidos porque o mesmo grupo correu junto vezes demais. */
  reduzido: boolean
  rivais: Array<{ apelido: string; chance: number; ficouAFrente: boolean | null }>
}

type PilotoDaSala = { perfilId: string; apelido: string }

/** Um fantasma numa sala ranqueada: a volta de quem correu, com o MMR que tinha. */
export type FantasmaDaSala = { playerId: string; apelido: string; mmr: { mu: number; sigma: number } }

export type OpcoesDaRanqueada = {
  agora?: () => number
  esperaDaFila?: number
  /** Quanto alguém espera sozinho até correr contra fantasmas. */
  esperaComFantasmas?: number
}

/**
 * A ranqueada no servidor.
 *
 * Guarda a fila e, para cada sala ranqueada em andamento, quem é cada piloto no
 * perfil — a sala conhece o `playerId` da aba, e o rating é do perfil. Só a
 * fila pública conta: salas por código ou QR continuam casuais, para amigos não
 * combinarem resultado.
 */
export class Ranqueada {
  private fila: EntradaDaFila[] = []
  private readonly salas = new Map<string, { pilotos: Map<string, PilotoDaSala>; fantasmas: Map<string, FantasmaDaSala> }>()
  private readonly desistencias = new Map<string, number[]>()
  private readonly agora: () => number
  private readonly espera: number | undefined
  private readonly esperaComFantasmas: number

  constructor(
    private readonly repositorio: Repositorio,
    opcoes: OpcoesDaRanqueada = {},
  ) {
    this.agora = opcoes.agora ?? Date.now
    this.espera = opcoes.esperaDaFila
    this.esperaComFantasmas = opcoes.esperaComFantasmas ?? ESPERA_COM_FANTASMAS_MS
  }

  temporada() {
    return temporadaDe(this.agora())
  }

  /**
   * O estado do piloto nesta temporada. Quem ainda não correu nela começa do
   * reset suave da anterior, ou do zero.
   */
  async estadoDe(perfilId: string): Promise<EstadoRanqueado> {
    const temporada = this.temporada()
    const atual = await this.repositorio.estadoRanqueado(perfilId, temporada)
    if (atual) return atual
    return viradaDeTemporada(await this.repositorio.estadoAnterior(perfilId, temporada))
  }

  async painel(perfilId: string): Promise<PainelRanqueado> {
    const estado = await this.estadoDe(perfilId)
    return {
      temporada: this.temporada(),
      pl: estado.pl,
      tier: divisaoDe(estado.pl).tier,
      divisao: nomeDaDivisao(estado.pl),
      colocacao: estado.colocacao,
      // Na colocação, toda corrida da temporada foi de colocação.
      colocacaoTotal: estado.corridas + estado.colocacao,
      corridas: estado.corridas,
      pico: estado.pico,
      podios: estado.podios,
      abandonos: estado.abandonos,
      escudo: estado.escudo,
      posicao: await this.repositorio.posicaoNaEscada(perfilId, this.temporada()),
      subindo: estado.colocacao === 0 && multiplicadorDeConvergencia(estado) > INDICADOR_DE_SUBIDA,
    }
  }

  /**
   * A escada da temporada. No Mestre, quem sumiu há mais de duas semanas sai
   * da vista — sem perder nada —, e os cinco primeiros recebem o selo de Lenda.
   */
  async escada(limite = 20) {
    const agora = this.agora()
    const linhas = await this.repositorio.escada(this.temporada(), limite * 2)
    const visiveis = linhas.filter(
      (linha) =>
        linha.estado.pl < PL_DO_MESTRE ||
        linha.estado.ultimaCorrida === null ||
        agora - linha.estado.ultimaCorrida < DIAS_ATE_SAIR_DA_ESCADA * 86_400_000,
    )
    return visiveis.slice(0, limite).map((linha, indice) => ({
      posicao: indice + 1,
      perfilId: linha.perfilId,
      apelido: linha.apelido,
      pl: linha.estado.pl,
      divisao: nomeDaDivisao(linha.estado.pl),
      tier: divisaoDe(linha.estado.pl).tier,
      lenda: linha.estado.pl >= PL_DO_MESTRE && indice < LENDAS,
    }))
  }

  /** Até quando o piloto espera para voltar à fila, ou null se pode entrar. */
  esperaAte(perfilId: string) {
    const agora = this.agora()
    const recentes = (this.desistencias.get(perfilId) ?? []).filter((instante) => agora - instante < JANELA_DAS_DESISTENCIAS_MS)
    if (recentes.length === 0) return null
    const espera = ESPERAS_POR_DESISTENCIA_MS[Math.min(recentes.length, ESPERAS_POR_DESISTENCIA_MS.length) - 1]
    const ate = recentes[recentes.length - 1] + espera
    return ate > agora ? ate : null
  }

  async entrar(entrada: Omit<EntradaDaFila, 'mu' | 'desde'>): Promise<{ ok: true } | { ok: false; motivo: string; ate?: number }> {
    const ate = this.esperaAte(entrada.perfilId)
    if (ate) return { ok: false, motivo: 'Você desistiu de uma largada há pouco.', ate }
    if (this.fila.some((outra) => outra.perfilId === entrada.perfilId)) return { ok: false, motivo: 'Este perfil já está na fila.' }
    const estado = await this.estadoDe(entrada.perfilId)
    this.fila.push({ ...entrada, mu: estado.mmr.mu, desde: this.agora() })
    return { ok: true }
  }

  sair(perfilId: string) {
    this.fila = this.fila.filter((entrada) => entrada.perfilId !== perfilId)
  }

  /** Quem saiu da conexão sai da fila. */
  sairPorSocket(socketId: string) {
    this.fila = this.fila.filter((entrada) => entrada.socketId !== socketId)
  }

  naFila() {
    return this.fila.map((entrada) => ({ ...entrada }))
  }

  /** As salas que já podem largar; quem entra numa sai da fila. */
  formarSalas() {
    const { salas, restantes } = formarSalas(this.fila, this.agora(), this.espera)
    this.fila = restantes
    return salas
  }

  /** Registra quem é quem numa sala ranqueada recém-criada, fantasmas incluídos. */
  registrarSala(code: string, pilotos: readonly EntradaDaFila[], fantasmas: readonly FantasmaDaSala[] = []) {
    this.salas.set(code, {
      pilotos: new Map(pilotos.map((piloto) => [piloto.playerId, { perfilId: piloto.perfilId, apelido: piloto.nome }])),
      fantasmas: new Map(fantasmas.map((fantasma) => [fantasma.playerId, fantasma])),
    })
  }

  /** Quem está sozinho na fila há tempo bastante para correr contra fantasmas. */
  solitarios() {
    const agora = this.agora()
    if (this.fila.length !== 1) return []
    return this.fila.filter((entrada) => agora - entrada.desde >= this.esperaComFantasmas).map((entrada) => ({ ...entrada }))
  }

  /**
   * Os fantasmas para quem ficou sozinho: voltas ranqueadas recentes de outros
   * pilotos, todas na mesma pista — a que tiver mais delas —, as de MMR mais
   * perto do dele. Uma volta típica, e não um recorde pessoal: vencer o recorde
   * de alguém é mais difícil que vencer o próprio piloto.
   */
  async fantasmasPara(perfilId: string, mu: number, dificuldade: Difficulty) {
    const voltas = await this.repositorio.voltasRanqueadas(dificuldade, this.agora() - IDADE_DO_FANTASMA_MS, perfilId, 200)
    const porPista = new Map<number, VoltaRanqueada[]>()
    for (const volta of voltas) porPista.set(volta.seed, [...(porPista.get(volta.seed) ?? []), volta])
    let melhor: { seed: number; voltas: VoltaRanqueada[] } | null = null
    for (const [seed, daPista] of porPista) {
      const escolhidas = [...daPista].sort((a, b) => Math.abs(a.mmr.mu - mu) - Math.abs(b.mmr.mu - mu)).slice(0, FANTASMAS_POR_SALA)
      if (!melhor || escolhidas.length > melhor.voltas.length) melhor = { seed, voltas: escolhidas }
    }
    return melhor
  }

  eRanqueada(code: string) {
    return this.salas.has(code)
  }

  /** O perfil de um piloto numa sala ranqueada. */
  perfilNaSala(code: string, playerId: string) {
    return this.salas.get(code)?.pilotos.get(playerId)?.perfilId ?? null
  }

  /**
   * Quem desistiu da largada — saiu da sala na contagem ou caiu e não voltou —
   * espera para entrar de novo, e a espera cresce com a repetição. Sem perder
   * PL: a população é pequena demais para punir pesado.
   */
  desistiu(code: string, playerId: string) {
    const perfilId = this.perfilNaSala(code, playerId)
    if (!perfilId) return
    const lista = this.desistencias.get(perfilId) ?? []
    lista.push(this.agora())
    this.desistencias.set(perfilId, lista)
    this.salas.get(code)?.pilotos.delete(playerId)
  }

  /** A sala acabou sem corrida — ficou gente de menos. Ninguém ganha nem perde. */
  dissolver(code: string) {
    this.salas.delete(code)
  }

  /**
   * Resolve a corrida ranqueada: atualiza MMR e PL de todos, guarda tudo e
   * devolve o que cada piloto vê. Uma sala só se resolve uma vez.
   */
  async resolver(code: string, outcome: RaceOutcome, seed: number): Promise<ResultadoRanqueado[]> {
    const sala = this.salas.get(code)
    if (!sala) return []
    this.salas.delete(code)
    const agora = this.agora()
    const temporada = this.temporada()

    const entradas = outcome.entries.filter((entrada) => sala.pilotos.has(entrada.playerId) || sala.fantasmas.has(entrada.playerId))
    if (entradas.length < 2 || !entradas.some((entrada) => sala.pilotos.has(entrada.playerId))) return []
    const participantes: Array<Participante & { playerId: string; apelido: string; fantasma: boolean }> = []
    for (const entrada of entradas) {
      const desfecho: Desfecho = entrada.outcome === 'finished' ? 'chegou' : entrada.outcome === 'abandoned' ? 'abandonou' : 'naoTerminou'
      const fantasma = sala.fantasmas.get(entrada.playerId)
      if (fantasma) {
        // O fantasma entra com o MMR congelado, e nada dele muda: é a régua
        // fixa contra a qual o piloto sozinho é medido.
        const mmr = { mu: fantasma.mmr.mu, sigma: Math.max(SIGMA_DO_FANTASMA, fantasma.mmr.sigma) }
        participantes.push({
          playerId: entrada.playerId,
          apelido: fantasma.apelido,
          perfilId: `fantasma:${entrada.playerId}`,
          desfecho,
          tempo: entrada.time,
          estado: { ...estadoInicial(), mmr, colocacao: 0, pl: Math.round(plAlvo(mmr)) },
          fantasma: true,
        })
        continue
      }
      const piloto = sala.pilotos.get(entrada.playerId)!
      participantes.push({
        playerId: entrada.playerId,
        apelido: piloto.apelido,
        perfilId: piloto.perfilId,
        desfecho,
        tempo: entrada.time,
        estado: await this.estadoDe(piloto.perfilId),
        fantasma: false,
      })
    }
    const humanos = participantes.filter((participante) => !participante.fantasma)

    // Retorno decrescente: o mesmo grupo correndo junto vezes demais na
    // última hora ganha e perde metade dos PL.
    const juntas =
      humanos.length >= 2
        ? await this.repositorio.corridasJuntos(
            humanos.map((p) => p.perfilId),
            agora - 3_600_000,
            Math.min(PILOTOS_EM_COMUM, humanos.length),
          )
        : 0
    const reduzido = juntas >= CORRIDAS_JUNTAS_TOLERADAS
    const todas = atualizarRatings(participantes, agora, reduzido ? 0.5 : 1)
    // Só os humanos são atualizados; os fantasmas ficam onde estavam.
    const atualizacoes = todas.filter((_, i) => !participantes[i].fantasma)
    const deHumanos = participantes.filter((participante) => !participante.fantasma)

    await this.repositorio.registrarCorridaRanqueada({
      id: randomUUID(),
      temporada,
      sala: code,
      seed,
      instante: agora,
      resultados: atualizacoes.map((atualizacao, i) => ({
        perfilId: atualizacao.perfilId,
        posto: atualizacao.posto,
        desfecho: deHumanos[i].desfecho,
        tempo: deHumanos[i].tempo,
        antes: atualizacao.antes,
        depois: atualizacao.depois,
      })),
    })

    const apelidoDe = new Map(participantes.map((p) => [p.perfilId, p.fantasma ? `${p.apelido} (fantasma)` : p.apelido]))
    return atualizacoes.map((atualizacao, i) => ({
      playerId: deHumanos[i].playerId,
      perfilId: atualizacao.perfilId,
      apelido: deHumanos[i].apelido,
      posto: atualizacao.posto,
      deltaPl: atualizacao.deltaPl,
      plAntes: atualizacao.antes.pl,
      plDepois: atualizacao.depois.pl,
      divisao: nomeDaDivisao(atualizacao.depois.pl),
      colocacao: atualizacao.depois.colocacao,
      colocacaoTotal: atualizacao.antes.corridas + atualizacao.antes.colocacao,
      mudouDeTier: atualizacao.mudouDeTier,
      subindo: atualizacao.depois.colocacao === 0 && atualizacao.multiplicador > INDICADOR_DE_SUBIDA,
      reduzido,
      rivais: atualizacao.rivais.map((rival) => ({
        apelido: apelidoDe.get(rival.perfilId) ?? 'Piloto',
        chance: rival.chance,
        ficouAFrente: rival.ficouAFrente,
      })),
    }))
  }
}
