import { randomUUID } from 'node:crypto'
import { apelidoComNumero, chaveDoApelido } from '../../src/conta/apelido.js'
import { MEDALHAS, type Medalha } from '../../src/game/contrarrelogio.js'
import type { GravacaoDeVolta } from '../../src/game/gravador.js'
import type { Difficulty } from '../../src/game/rules.js'
import type { EstadoRanqueado } from '../ranqueada/rating.js'
import {
  MODOS_DA_CORRIDA,
  type CorridaRanqueada,
  type EstatisticasDoPerfil,
  type LinhaDaEscada,
  type LinhaDoQuadro,
  type ModoDaCorrida,
  type NovoTempo,
  type Participacao,
  type Perfil,
  type Repositorio,
  type ResumoDoModo,
  type TempoRegistrado,
  type Trofeu,
  type VoltaRanqueada,
} from './tipos.js'

type TempoGuardado = TempoRegistrado & { gravacao: GravacaoDeVolta; medalha: Medalha | null }

/**
 * O repositório em memória: tudo some quando o servidor para.
 *
 * É o que roda sem `DATABASE_URL` — nos testes, no desenvolvimento e no
 * workshop sem internet — e é também a referência do contrato: a mesma bateria
 * de testes roda contra ele e contra o Postgres.
 */
export class RepositorioEmMemoria implements Repositorio {
  readonly descricao = 'memória (os dados somem quando o servidor para)'
  private readonly perfis = new Map<string, Perfil>()
  private readonly tempos: TempoGuardado[] = []
  /** Estado ranqueado por temporada e piloto. */
  private readonly ratings = new Map<string, { perfilId: string; temporada: string; estado: EstadoRanqueado }>()
  private readonly corridas: Array<{ id: string; instante: number; perfis: string[] }> = []
  private readonly voltas: VoltaRanqueada[] = []
  private readonly trofeus: Trofeu[] = []
  private readonly participacoes = new Map<string, Participacao>()

  constructor(private readonly agora: () => number = Date.now) {}

  async perfilDaConta(contaId: string, apelido: string): Promise<Perfil> {
    const existente = this.perfis.get(contaId)
    if (existente) return { ...existente }
    for (let tentativa = 1; ; tentativa += 1) {
      const nome = tentativa === 1 ? apelido : apelidoComNumero(apelido, tentativa)
      if (!(await this.apelidoLivre(nome))) continue
      const perfil: Perfil = { id: contaId, apelido: nome, criadoEm: this.agora() }
      this.perfis.set(contaId, perfil)
      return { ...perfil }
    }
  }

  async perfil(id: string) {
    const perfil = this.perfis.get(id)
    return perfil ? { ...perfil } : null
  }

  async apelidoLivre(apelido: string) {
    const chave = chaveDoApelido(apelido)
    return ![...this.perfis.values()].some((perfil) => chaveDoApelido(perfil.apelido) === chave)
  }

  async registrarTempo(novo: NovoTempo): Promise<TempoRegistrado> {
    const apelido = this.perfis.get(novo.perfilId)?.apelido ?? 'Piloto'
    const guardado: TempoGuardado = {
      id: randomUUID(),
      perfilId: novo.perfilId,
      apelido,
      dia: novo.dia,
      seed: novo.seed,
      dificuldade: novo.dificuldade,
      tempo: novo.tempo,
      dispositivo: novo.dispositivo,
      estado: novo.estado,
      criadoEm: this.agora(),
      medalha: novo.medalha,
      gravacao: novo.gravacao,
    }
    this.tempos.push(guardado)
    return semGravacao(guardado)
  }

  async quadro(seed: number, dificuldade: Difficulty, limite: number) {
    return this.melhores(seed, dificuldade).slice(0, Math.max(0, limite))
  }

  async linhaDe(seed: number, dificuldade: Difficulty, perfilId: string) {
    return this.melhores(seed, dificuldade).find((linha) => linha.perfilId === perfilId) ?? null
  }

  async gravacao(tempoId: string) {
    return this.tempos.find((tempo) => tempo.id === tempoId)?.gravacao ?? null
  }

  async estadoRanqueado(perfilId: string, temporada: string) {
    const guardado = this.ratings.get(chaveDoRating(perfilId, temporada))
    return guardado ? copiar(guardado.estado) : null
  }

  async estadoAnterior(perfilId: string, temporada: string) {
    let anterior: { temporada: string; estado: EstadoRanqueado } | null = null
    for (const guardado of this.ratings.values()) {
      if (guardado.perfilId !== perfilId || guardado.temporada >= temporada) continue
      if (!anterior || guardado.temporada > anterior.temporada) anterior = guardado
    }
    return anterior ? copiar(anterior.estado) : null
  }

  async registrarCorridaRanqueada(corrida: CorridaRanqueada) {
    if (this.corridas.some((registrada) => registrada.id === corrida.id)) return
    for (const resultado of corrida.resultados) {
      this.ratings.set(chaveDoRating(resultado.perfilId, corrida.temporada), {
        perfilId: resultado.perfilId,
        temporada: corrida.temporada,
        estado: copiar(resultado.depois),
      })
    }
    this.corridas.push({ id: corrida.id, instante: corrida.instante, perfis: corrida.resultados.map((r) => r.perfilId) })
  }

  async escada(temporada: string, limite: number): Promise<LinhaDaEscada[]> {
    return this.escadaCompleta(temporada).slice(0, Math.max(0, limite))
  }

  async posicaoNaEscada(perfilId: string, temporada: string) {
    return this.escadaCompleta(temporada).find((linha) => linha.perfilId === perfilId)?.posicao ?? null
  }

  async corridasJuntos(perfilIds: readonly string[], desde: number, emComum: number) {
    const procurados = new Set(perfilIds)
    return this.corridas.filter(
      (corrida) => corrida.instante >= desde && corrida.perfis.filter((perfil) => procurados.has(perfil)).length >= emComum,
    ).length
  }

  async registrarVoltaRanqueada(volta: Omit<VoltaRanqueada, 'id' | 'apelido' | 'criadaEm'>) {
    this.voltas.push({
      ...volta,
      id: randomUUID(),
      apelido: this.perfis.get(volta.perfilId)?.apelido ?? 'Piloto',
      criadaEm: this.agora(),
    })
  }

  async voltasRanqueadas(dificuldade: Difficulty, desde: number, excluirPerfil: string, limite: number) {
    const vistas = new Set<string>()
    const escolhidas: VoltaRanqueada[] = []
    for (const volta of [...this.voltas].sort((a, b) => b.criadaEm - a.criadaEm)) {
      if (volta.dificuldade !== dificuldade || volta.criadaEm < desde || volta.perfilId === excluirPerfil) continue
      const chave = `${volta.perfilId}|${volta.seed}`
      if (vistas.has(chave)) continue
      vistas.add(chave)
      escolhidas.push({ ...volta, apelido: this.perfis.get(volta.perfilId)?.apelido ?? volta.apelido })
      if (escolhidas.length >= limite) break
    }
    return escolhidas
  }

  async registrarTrofeu(trofeu: Trofeu) {
    this.trofeus.push({ ...trofeu })
  }

  async trofeusDe(perfilId: string) {
    return this.trofeus
      .filter((trofeu) => trofeu.perfilId === perfilId)
      .sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : a.posicao - b.posicao))
      .map((trofeu) => ({ ...trofeu }))
  }

  async registrarParticipacoes(participacoes: readonly Participacao[]) {
    for (const participacao of participacoes) {
      const chave = `${participacao.perfilId}|${participacao.sala}|${participacao.largada}`
      if (!this.participacoes.has(chave)) this.participacoes.set(chave, { ...participacao })
    }
  }

  async estatisticasDe(perfilId: string, recentes: number): Promise<EstatisticasDoPerfil> {
    const minhas = [...this.participacoes.values()].filter((participacao) => participacao.perfilId === perfilId)
    const porModo = Object.fromEntries(MODOS_DA_CORRIDA.map((modo) => [modo, resumoVazio()])) as Record<ModoDaCorrida, ResumoDoModo>
    const porCarro = new Map<string, { corridas: number; ultima: number }>()
    for (const corrida of minhas) {
      const resumo = porModo[corrida.modo]
      const chegou = corrida.desfecho === 'chegou'
      const comRival = corrida.pilotos > 1
      resumo.corridas += 1
      resumo.vitorias += chegou && comRival && corrida.posicao === 1 ? 1 : 0
      resumo.podios += chegou && comRival && corrida.posicao <= 3 ? 1 : 0
      resumo.chegadas += chegou ? 1 : 0
      resumo.abandonos += corrida.desfecho === 'abandonou' ? 1 : 0
      resumo.somaDasPosicoes += corrida.posicao
      const carro = porCarro.get(corrida.carro) ?? { corridas: 0, ultima: 0 }
      porCarro.set(corrida.carro, { corridas: carro.corridas + 1, ultima: Math.max(carro.ultima, corrida.largada) })
    }
    const favorito = [...porCarro.entries()].sort((a, b) => b[1].corridas - a[1].corridas || b[1].ultima - a[1].ultima)[0]

    const meusTempos = this.tempos.filter((tempo) => tempo.perfilId === perfilId)
    const validos = meusTempos.filter((tempo) => tempo.estado === 'valido')
    const pistas = new Map<string, TempoGuardado>()
    for (const tempo of validos) {
      const chave = `${tempo.seed}|${tempo.dificuldade}`
      const melhor = pistas.get(chave)
      if (!melhor || tempo.tempo < melhor.tempo) pistas.set(chave, tempo)
    }
    const medalhas = Object.fromEntries(MEDALHAS.map((medalha) => [medalha, 0])) as Record<Medalha, number>
    for (const melhor of pistas.values()) if (melhor.medalha) medalhas[melhor.medalha] += 1
    const lideradas = [...pistas.values()].filter(
      (melhor) => this.melhores(melhor.seed, melhor.dificuldade)[0]?.perfilId === perfilId,
    ).length

    return {
      porModo,
      velocidadeMaxima: minhas.reduce((maior, corrida) => Math.max(maior, corrida.velocidadeMaxima), 0),
      batidas: minhas.reduce((soma, corrida) => soma + corrida.batidas, 0),
      carroFavorito: favorito ? { carro: favorito[0], corridas: favorito[1].corridas } : null,
      recentes: [...minhas].sort((a, b) => b.largada - a.largada).slice(0, Math.max(0, recentes)).map((corrida) => ({ ...corrida })),
      contrarrelogio: {
        voltas: meusTempos.filter((tempo) => tempo.estado !== 'recusado').length,
        pistas: pistas.size,
        medalhas,
        lideradas,
      },
      temporadas: [...this.ratings.values()]
        .filter((guardado) => guardado.perfilId === perfilId)
        .sort((a, b) => (a.temporada < b.temporada ? 1 : -1))
        .map((guardado) => ({ temporada: guardado.temporada, estado: copiar(guardado.estado) })),
    }
  }

  async fechar() {}

  /** Quem já terminou a colocação, dos PL mais altos para os mais baixos; no empate, o MMR decide. */
  private escadaCompleta(temporada: string): LinhaDaEscada[] {
    return [...this.ratings.values()]
      .filter((guardado) => guardado.temporada === temporada && guardado.estado.colocacao === 0)
      .sort((a, b) => b.estado.pl - a.estado.pl || b.estado.mmr.mu - a.estado.mmr.mu)
      .map((guardado, indice) => ({
        perfilId: guardado.perfilId,
        apelido: this.perfis.get(guardado.perfilId)?.apelido ?? 'Piloto',
        estado: copiar(guardado.estado),
        posicao: indice + 1,
      }))
  }

  /** O melhor tempo válido de cada piloto, do mais rápido, com a posição. */
  private melhores(seed: number, dificuldade: Difficulty): LinhaDoQuadro[] {
    const porPiloto = new Map<string, TempoGuardado>()
    for (const tempo of this.tempos) {
      if (tempo.seed !== seed || tempo.dificuldade !== dificuldade || tempo.estado !== 'valido') continue
      const atual = porPiloto.get(tempo.perfilId)
      if (!atual || tempo.tempo < atual.tempo || (tempo.tempo === atual.tempo && tempo.criadoEm < atual.criadoEm)) {
        porPiloto.set(tempo.perfilId, tempo)
      }
    }
    return [...porPiloto.values()]
      .sort((a, b) => a.tempo - b.tempo || a.criadoEm - b.criadoEm)
      .map((tempo, indice) => ({
        ...semGravacao(tempo),
        apelido: this.perfis.get(tempo.perfilId)?.apelido ?? tempo.apelido,
        posicao: indice + 1,
      }))
  }
}

function resumoVazio(): ResumoDoModo {
  return { corridas: 0, vitorias: 0, podios: 0, chegadas: 0, abandonos: 0, somaDasPosicoes: 0 }
}

function chaveDoRating(perfilId: string, temporada: string) {
  return `${temporada}|${perfilId}`
}

function copiar(estado: EstadoRanqueado): EstadoRanqueado {
  return { ...estado, mmr: { ...estado.mmr } }
}

function semGravacao({ gravacao: _gravacao, medalha: _medalha, ...tempo }: TempoGuardado): TempoRegistrado {
  return tempo
}
