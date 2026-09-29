import type { Medalha } from '../../src/game/contrarrelogio.js'
import type { GravacaoDeVolta } from '../../src/game/gravador.js'
import type { Difficulty } from '../../src/game/rules.js'
import type { Desfecho, EstadoRanqueado } from '../ranqueada/rating.js'

/**
 * O que o servidor guarda entre uma partida e outra.
 *
 * As salas continuam na memória, como sempre: vivem o tempo de uma corrida e
 * morrem com ela. O que precisa sobreviver — o perfil do piloto, os tempos do
 * contrarrelógio, a ranqueada, as estatísticas — passa por esta interface, que
 * tem duas implementações: o Postgres (o do Supabase, em produção) e a
 * memória, nos testes, no desenvolvimento sem banco e no workshop offline. Sem
 * `DATABASE_URL` o jogo casual funciona exatamente como antes.
 */

/**
 * O perfil de uma conta: o id é o do usuário no Supabase Auth, e o apelido é o
 * que ele escolheu no cadastro — único, sem diferenciar maiúsculas.
 */
export type Perfil = {
  id: string
  apelido: string
  criadoEm: number
}

/** Como o tempo foi feito: o controle entra no quadro, para a diferença ser visível. */
export type Dispositivo = 'teclado' | 'toque' | 'desconhecido'

/**
 * Situação de um tempo do contrarrelógio.
 *
 * Pendente é o tempo bom demais para ser aceito de olhos fechados — abaixo do
 * piloto de referência, ou com volante suspeito —, que só entra no quadro
 * depois de conferido.
 */
export type EstadoDoTempo = 'valido' | 'pendente' | 'recusado'

export type NovoTempo = {
  perfilId: string
  dia: string
  seed: number
  dificuldade: Difficulty
  tempo: number
  dispositivo: Dispositivo
  estado: EstadoDoTempo
  /** A medalha que o tempo alcança na pista dele, calculada quando é julgado. */
  medalha: Medalha | null
  gravacao: GravacaoDeVolta
}

export type TempoRegistrado = {
  id: string
  perfilId: string
  apelido: string
  dia: string
  seed: number
  dificuldade: Difficulty
  tempo: number
  dispositivo: Dispositivo
  estado: EstadoDoTempo
  criadoEm: number
}

/** Uma linha do quadro: o melhor tempo válido de cada piloto. */
export type LinhaDoQuadro = TempoRegistrado & { posicao: number }

export interface RepositorioDePerfis {
  /**
   * O perfil de uma conta, criado na primeira entrada com o apelido do
   * cadastro. Se outra conta chegou antes ao mesmo apelido, ele ganha um
   * número no fim — é o que resolve dois cadastros simultâneos.
   */
  perfilDaConta(contaId: string, apelido: string): Promise<Perfil>
  perfil(id: string): Promise<Perfil | null>
  /** Se nenhuma conta usa o apelido, sem diferenciar maiúsculas. */
  apelidoLivre(apelido: string): Promise<boolean>
}

export interface RepositorioDeTempos {
  registrarTempo(novo: NovoTempo): Promise<TempoRegistrado>
  /** O melhor tempo válido de cada piloto numa semente e nível, do mais rápido. */
  quadro(seed: number, dificuldade: Difficulty, limite: number): Promise<LinhaDoQuadro[]>
  /** A linha de um piloto no quadro, ou null se ele não tem tempo válido ali. */
  linhaDe(seed: number, dificuldade: Difficulty, perfilId: string): Promise<LinhaDoQuadro | null>
  /** A volta gravada de um tempo. */
  gravacao(tempoId: string): Promise<GravacaoDeVolta | null>
}

/** Uma corrida ranqueada, com o antes e o depois de cada piloto. */
export type CorridaRanqueada = {
  id: string
  temporada: string
  sala: string
  seed: number
  instante: number
  resultados: Array<{
    perfilId: string
    posto: number
    desfecho: Desfecho
    tempo: number | null
    antes: EstadoRanqueado
    depois: EstadoRanqueado
  }>
}

/** Uma volta ranqueada guardada, para virar fantasma de quem ficou sozinho na fila. */
export type VoltaRanqueada = {
  id: string
  perfilId: string
  apelido: string
  seed: number
  dificuldade: Difficulty
  tempo: number
  /** O MMR que o piloto tinha quando correu: é ele, congelado, que entra no rating. */
  mmr: { mu: number; sigma: number }
  carro: string
  gravacao: GravacaoDeVolta
  criadaEm: number
}

/** Um troféu da Copa do Dia: pódio de uma divisão. Só cosmético. */
export type Trofeu = { perfilId: string; dia: string; divisao: number; posicao: number; participantes: number }

/** Uma linha da escada da temporada: só quem já terminou a colocação. */
export type LinhaDaEscada = { perfilId: string; apelido: string; estado: EstadoRanqueado; posicao: number }

export interface RepositorioRanqueado {
  /** O estado de um piloto numa temporada, ou null se ele ainda não correu nela. */
  estadoRanqueado(perfilId: string, temporada: string): Promise<EstadoRanqueado | null>
  /** O estado da temporada mais recente antes desta: é dele que sai o reset suave. */
  estadoAnterior(perfilId: string, temporada: string): Promise<EstadoRanqueado | null>
  /**
   * Guarda a corrida, os resultados e o estado novo de cada piloto, tudo ou
   * nada. Registrar a mesma corrida duas vezes não muda nada.
   */
  registrarCorridaRanqueada(corrida: CorridaRanqueada): Promise<void>
  /** A escada da temporada, dos PL mais altos para os mais baixos. */
  escada(temporada: string, limite: number): Promise<LinhaDaEscada[]>
  /** A posição de um piloto na escada, ou null se ele ainda está em colocação. */
  posicaoNaEscada(perfilId: string, temporada: string): Promise<number | null>
  /**
   * Quantas corridas desde um instante tiveram pelo menos `emComum` destes
   * pilotos juntos. É a conta do retorno decrescente contra quem combina
   * resultado.
   */
  corridasJuntos(perfilIds: readonly string[], desde: number, emComum: number): Promise<number>
  /** Guarda a volta de uma corrida ranqueada. */
  registrarVoltaRanqueada(volta: Omit<VoltaRanqueada, 'id' | 'apelido' | 'criadaEm'>): Promise<void>
  /**
   * As voltas mais recentes de um nível desde um instante, a mais nova de cada
   * piloto em cada semente, sem as de um piloto (o que procura fantasmas).
   */
  voltasRanqueadas(dificuldade: Difficulty, desde: number, excluirPerfil: string, limite: number): Promise<VoltaRanqueada[]>
  /** Guarda um troféu da Copa. */
  registrarTrofeu(trofeu: Trofeu): Promise<void>
  /** Os troféus de um piloto, do mais recente. */
  trofeusDe(perfilId: string): Promise<Trofeu[]>
}

/** Onde a corrida online aconteceu: é por modo que o perfil separa as contas. */
export type ModoDaCorrida = 'casual' | 'ranqueada' | 'copa'

export const MODOS_DA_CORRIDA: readonly ModoDaCorrida[] = ['casual', 'ranqueada', 'copa']

/** Uma corrida online de quem entrou com conta, como o perfil a lembra. */
export type Participacao = {
  perfilId: string
  sala: string
  /** A largada oficial: com a sala, identifica a corrida. */
  largada: number
  modo: ModoDaCorrida
  seed: number
  dificuldade: Difficulty
  /** Quantos largaram, fantasmas incluídos. */
  pilotos: number
  posicao: number
  desfecho: Desfecho
  tempo: number | null
  velocidadeMaxima: number
  batidas: number
  carro: string
  /** Os PL que a corrida rendeu, na ranqueada. */
  deltaPl: number | null
}

/** A soma das corridas de um modo. */
export type ResumoDoModo = {
  corridas: number
  /** Primeiro lugar numa corrida com rival. */
  vitorias: number
  podios: number
  chegadas: number
  abandonos: number
  /** Para a posição média. */
  somaDasPosicoes: number
}

/** O que o perfil mostra, já somado pelo banco. */
export type EstatisticasDoPerfil = {
  porModo: Record<ModoDaCorrida, ResumoDoModo>
  velocidadeMaxima: number
  batidas: number
  carroFavorito: { carro: string; corridas: number } | null
  /** As corridas mais recentes, da última para trás. */
  recentes: Participacao[]
  contrarrelogio: {
    /** Voltas aceitas ou em conferência, em todas as pistas. */
    voltas: number
    /** Pistas com tempo válido. */
    pistas: number
    /** A melhor medalha de cada pista, contada por tipo. */
    medalhas: Record<Medalha, number>
    /** Pistas em que o melhor tempo do quadro é deste piloto. */
    lideradas: number
  }
  /** O estado de cada temporada ranqueada que o piloto correu, da mais nova. */
  temporadas: Array<{ temporada: string; estado: EstadoRanqueado }>
}

export interface RepositorioDeEstatisticas {
  /** Guarda as corridas online de quem tinha conta. A mesma corrida não entra duas vezes. */
  registrarParticipacoes(participacoes: readonly Participacao[]): Promise<void>
  estatisticasDe(perfilId: string, recentes: number): Promise<EstatisticasDoPerfil>
}

export interface Repositorio extends RepositorioDePerfis, RepositorioDeTempos, RepositorioRanqueado, RepositorioDeEstatisticas {
  /** Onde os dados moram, para o registro da subida do servidor. */
  readonly descricao: string
  fechar(): Promise<void>
}
