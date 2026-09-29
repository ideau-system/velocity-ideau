import type { CarId } from '../../src/game/cars.js'
import { DIFICULDADE_OFICIAL, diaDe, sementeDoDia } from '../../src/game/contrarrelogio.js'
import type { Difficulty } from '../../src/game/rules.js'
import type { Repositorio, Trofeu } from '../dados/tipos.js'
import type { FinishOutcome, RaceOutcome } from '../rooms.js'

/**
 * A Copa do Dia: o Cup of the Day do Trackmania e o Grand Prix do F-Zero 99,
 * no tamanho de uma sala de seis.
 *
 * Todo dia, às 21h de Brasília — dentro do horário ranqueado —, abre uma
 * classificação de dez minutos no contrarrelógio da Pista do Dia. O melhor
 * tempo de cada inscrito decide a divisão: os seis mais rápidos na primeira,
 * os seguintes na segunda, e assim por diante. Em cada divisão, uma corrida
 * atrás da outra na mesma pista, e o último de cada uma sai. Quem sobra é o
 * campeão da divisão.
 *
 * Não vale PL nem mexe no MMR: é um evento para juntar gente num horário
 * marcado, e o que fica dele é o troféu, só cosmético.
 */

/** Hora da abertura, em Brasília. */
export const HORA_DA_COPA = 21
/** Duração da classificação: dez minutos, como a do Cup of the Day. */
export const CLASSIFICACAO_MS = 10 * 60_000
/** A volta que largou antes do fim da classificação ainda tem tempo de chegar. */
export const FOLGA_DA_CLASSIFICACAO_MS = 2 * 60_000
/** Entre uma rodada e a próxima: o bastante para ver quem saiu. */
export const INTERVALO_ENTRE_RODADAS_MS = 10_000
export const PILOTOS_POR_DIVISAO = 6
/** Quantos da classificação a tela mostra. */
const CLASSIFICACAO_VISIVEL = 10

export type FaseDaCopa = 'inscricoes' | 'classificacao' | 'apuracao' | 'eliminatorias' | 'encerrada'

/**
 * A abertura da copa num horário de Brasília, "HH:MM": devolve, para cada dia,
 * o instante em milissegundos UTC. Sem um horário válido, as 21h.
 *
 * Brasília não tem horário de verão desde 2019: é sempre UTC−3, e as 21h de
 * lá são a meia-noite UTC do dia seguinte.
 */
export function aberturaAs(horario?: string) {
  const [, hora, minuto] = /^(\d{1,2}):(\d{2})$/.exec(horario?.trim() ?? '') ?? []
  const valido = hora !== undefined && Number(hora) <= 23 && Number(minuto) <= 59
  const [h, m] = valido ? [Number(hora), Number(minuto)] : [HORA_DA_COPA, 0]
  return (dia: string) => {
    const [ano, mes, diaDoMes] = dia.split('-').map(Number)
    return Date.UTC(ano, mes - 1, diaDoMes, h + 3, m)
  }
}

/** Quando abre a copa de um dia, no horário padrão. */
export const aberturaDoDia = aberturaAs()

/**
 * Os tamanhos das divisões para n classificados: o menor número de salas de
 * até seis, com os pilotos repartidos por igual. Sete viram 4 e 3, e não 6 e
 * 1 — ninguém é campeão de uma divisão sem correr. Com menos de dois, não há
 * copa.
 */
export function tamanhosDasDivisoes(n: number) {
  if (n < 2) return []
  const divisoes = Math.ceil(n / PILOTOS_POR_DIVISAO)
  const base = Math.floor(n / divisoes)
  const resto = n % divisoes
  return Array.from({ length: divisoes }, (_, i) => base + (i < resto ? 1 : 0))
}

const PESO_DO_DESFECHO: Record<FinishOutcome, number> = { finished: 0, unfinished: 1, abandoned: 2 }

/**
 * Quem sai numa rodada.
 *
 * A ordem da rodada é a do resultado oficial: quem chegou, pelo tempo; depois
 * quem não completou; depois quem abandonou. O empate entre quem não chegou
 * se desfaz pela classificação, que é a ordem de `vivos`.
 *
 * Quem abandonou sai sempre, todos de uma vez: a próxima rodada não espera
 * ninguém voltar. Sem abandono, sai só o último — a regra do F-Zero 99 e do
 * Cup of the Day, uma eliminação por corrida.
 */
export function eliminadosDaRodada(
  entradas: ReadonlyArray<{ playerId: string; outcome: FinishOutcome; time: number | null }>,
  vivos: ReadonlyArray<{ playerId: string }>,
) {
  const porPiloto = new Map(entradas.map((entrada) => [entrada.playerId, entrada]))
  const semente = new Map(vivos.map((piloto, i) => [piloto.playerId, i]))
  // Quem nem aparece no resultado deixou a sala: é abandono.
  const desfecho = (playerId: string) => porPiloto.get(playerId)?.outcome ?? 'abandoned'
  const ordem = vivos
    .map((piloto) => piloto.playerId)
    .sort((a, b) => {
      const peso = PESO_DO_DESFECHO[desfecho(a)] - PESO_DO_DESFECHO[desfecho(b)]
      if (peso !== 0) return peso
      if (desfecho(a) === 'finished') {
        const tempo = (porPiloto.get(a)!.time ?? Infinity) - (porPiloto.get(b)!.time ?? Infinity)
        if (tempo !== 0) return tempo
      }
      return semente.get(a)! - semente.get(b)!
    })
  const desistentes = new Set(ordem.filter((playerId) => desfecho(playerId) === 'abandoned'))
  const eliminados = desistentes.size > 0 ? ordem.filter((playerId) => desistentes.has(playerId)) : ordem.slice(-1)
  return { ordem, eliminados, desistentes }
}

export type InscricaoNaCopa = { perfilId: string; playerId: string; socketId: string; nome: string; carro: CarId }

type Inscrito = InscricaoNaCopa & {
  /** Melhor volta válida na classificação. */
  tempo: number | null
  inscritoEm: number
  /** Pediu para sair durante as eliminatórias: não larga a próxima rodada. */
  saiu: boolean
}

type Colocacao = { perfilId: string; playerId: string; nome: string; posicao: number; desistiu: boolean }

type Divisao = {
  numero: number
  participantes: number
  /** Quem segue na divisão, na ordem da classificação. */
  vivos: Inscrito[]
  colocacoes: Colocacao[]
  rodada: number
  sala: string | null
  campeao: Colocacao | null
  encerrada: boolean
}

type Edicao = {
  dia: string
  seed: number
  abertura: number
  fechamento: number
  eliminatorias: number
  inscritos: Map<string, Inscrito>
  divisoes: Divisao[] | null
  motivo: string | null
}

/** O que a rodada decidiu, para a sala inteira ver. */
export type ResultadoDaRodada = {
  code: string | null
  divisao: number
  rodada: number
  eliminados: Colocacao[]
  seguem: Array<{ playerId: string; nome: string }>
  campeao: Colocacao | null
  encerrada: boolean
}

/** A copa como a tela a mostra. */
export type SituacaoDaCopa = {
  dia: string
  fase: FaseDaCopa
  abertura: number
  fechamento: number
  eliminatorias: number
  seed: number
  dificuldade: Difficulty
  inscritos: number
  inscrito: boolean
  classificacao: Array<{ posicao: number; apelido: string; tempo: number; voce: boolean }>
  voce: { tempo: number | null; posicao: number | null } | null
  minhaDivisao: {
    numero: number
    participantes: number
    rodada: number
    restantes: number
    posicao: number | null
    campeao: boolean
  } | null
  podios: Array<{ divisao: number; participantes: number; pilotos: Array<{ apelido: string; posicao: number }> }>
  motivo: string | null
  trofeus: Trofeu[]
}

export type OpcoesDaCopa = {
  agora?: () => number
  /** Quando abre a copa de um dia. Os testes a trazem para agora. */
  abertura?: (dia: string) => number
  classificacaoMs?: number
  folgaMs?: number
}

/** Uma volta da Pista do Dia julgada pelo servidor, candidata à classificação. */
export type VoltaDaClassificacao = {
  largada: number
  tempo: number
  seed: number
  dificuldade: Difficulty
  modificador: string | null
  estado: 'valido' | 'pendente' | 'recusado'
}

export class Copa {
  private readonly agora: () => number
  private readonly abertura: (dia: string) => number
  private readonly classificacaoMs: number
  private readonly folgaMs: number
  private edicao: Edicao | null = null

  constructor(
    private readonly repositorio: Repositorio,
    opcoes: OpcoesDaCopa = {},
  ) {
    this.agora = opcoes.agora ?? Date.now
    this.abertura = opcoes.abertura ?? aberturaDoDia
    this.classificacaoMs = opcoes.classificacaoMs ?? CLASSIFICACAO_MS
    // Numa classificação curta, de evento, a folga encolhe junto: um quinto dela.
    this.folgaMs = opcoes.folgaMs ?? Math.min(FOLGA_DA_CLASSIFICACAO_MS, this.classificacaoMs / 5)
  }

  /**
   * A edição de agora. Troca à meia-noite de Brasília, a não ser que a copa de
   * ontem ainda esteja na classificação ou nas eliminatórias.
   */
  private atual() {
    const dia = diaDe(new Date(this.agora()))
    const emCurso = (edicao: Edicao) => this.agora() < edicao.eliminatorias || this.faseDe(edicao) === 'eliminatorias'
    if (this.edicao && (this.edicao.dia === dia || emCurso(this.edicao))) return this.edicao
    const abertura = this.abertura(dia)
    const fechamento = abertura + this.classificacaoMs
    this.edicao = {
      dia,
      seed: sementeDoDia(dia),
      abertura,
      fechamento,
      eliminatorias: fechamento + this.folgaMs,
      inscritos: new Map(),
      divisoes: null,
      motivo: null,
    }
    return this.edicao
  }

  /** O dia, a pista e o horário da copa de agora. */
  hoje() {
    const { dia, seed, abertura, fechamento, eliminatorias } = this.atual()
    return { dia, seed, abertura, fechamento, eliminatorias }
  }

  fase() {
    return this.faseDe(this.atual())
  }

  private faseDe(edicao: Edicao): FaseDaCopa {
    if (edicao.divisoes) return edicao.divisoes.every((divisao) => divisao.encerrada) ? 'encerrada' : 'eliminatorias'
    if (edicao.motivo) return 'encerrada'
    const agora = this.agora()
    if (agora < edicao.abertura) return 'inscricoes'
    if (agora < edicao.fechamento) return 'classificacao'
    return 'apuracao'
  }

  /** Inscreve o piloto, ou atualiza a conexão e o carro de quem já estava. */
  inscrever(entrada: InscricaoNaCopa): { ok: true } | { ok: false; motivo: string } {
    const edicao = this.atual()
    const fase = this.fase()
    const existente = edicao.inscritos.get(entrada.perfilId)
    if (existente && fase !== 'encerrada') {
      Object.assign(existente, { playerId: entrada.playerId, socketId: entrada.socketId, nome: entrada.nome, carro: entrada.carro })
      return { ok: true }
    }
    if (fase !== 'inscricoes' && fase !== 'classificacao') {
      return { ok: false, motivo: 'As inscrições da copa de hoje já fecharam.' }
    }
    edicao.inscritos.set(entrada.perfilId, { ...entrada, tempo: null, inscritoEm: this.agora(), saiu: false })
    return { ok: true }
  }

  /**
   * Sai da copa. Antes das eliminatórias, a inscrição some; durante elas, o
   * piloto não larga a próxima rodada e sai como quem abandona.
   */
  sair(perfilId: string) {
    const edicao = this.atual()
    const fase = this.fase()
    if (fase === 'inscricoes' || fase === 'classificacao') return edicao.inscritos.delete(perfilId)
    const inscrito = edicao.inscritos.get(perfilId)
    if (!inscrito) return false
    inscrito.saiu = true
    return true
  }

  /** A conexão pela qual um inscrito é chamado. */
  conexaoDe(perfilId: string) {
    return this.edicao?.inscritos.get(perfilId)?.socketId ?? null
  }

  /** O piloto voltou por outra conexão: a próxima rodada o chama por ela. */
  reconectar(perfilId: string, socketId: string) {
    const inscrito = this.edicao?.inscritos.get(perfilId)
    if (inscrito) inscrito.socketId = socketId
  }

  /**
   * Uma volta da Pista do Dia que pode valer na classificação: de um inscrito,
   * na pista e no nível oficiais de hoje, largada dentro da janela e aceita
   * pelo servidor. Uma volta pendente não entra — a copa não espera
   * conferência. Devolve a posição do piloto, se a volta contou.
   */
  registrarVolta(perfilId: string, volta: VoltaDaClassificacao) {
    const edicao = this.atual()
    const inscrito = edicao.inscritos.get(perfilId)
    if (!inscrito || edicao.divisoes || edicao.motivo) return null
    if (volta.estado !== 'valido' || volta.modificador !== null) return null
    if (volta.seed !== edicao.seed || volta.dificuldade !== DIFICULDADE_OFICIAL) return null
    if (volta.largada < edicao.abertura || volta.largada >= edicao.fechamento) return null
    if (this.agora() >= edicao.eliminatorias) return null
    if (inscrito.tempo === null || volta.tempo < inscrito.tempo) inscrito.tempo = volta.tempo
    return { posicao: this.classificados(edicao).findIndex((candidato) => candidato.perfilId === perfilId) + 1 }
  }

  private classificados(edicao: Edicao) {
    return [...edicao.inscritos.values()]
      .filter((inscrito) => inscrito.tempo !== null)
      .sort((a, b) => a.tempo! - b.tempo! || a.inscritoEm - b.inscritoEm)
  }

  /** Chegou a hora de fechar a classificação e montar as divisões. */
  prontaParaApurar() {
    return this.fase() === 'apuracao' && this.agora() >= this.atual().eliminatorias
  }

  /**
   * Fecha a classificação e monta as divisões, só com quem tem tempo e ainda
   * está conectado. Devolve as divisões que vão largar.
   */
  apurar(conectado: (socketId: string) => boolean) {
    const edicao = this.atual()
    if (edicao.divisoes || edicao.motivo) return []
    const presentes = this.classificados(edicao).filter((inscrito) => !inscrito.saiu && conectado(inscrito.socketId))
    const tamanhos = tamanhosDasDivisoes(presentes.length)
    if (tamanhos.length === 0) {
      edicao.motivo = 'Poucos pilotos classificados: a copa de hoje não teve eliminatórias.'
      return []
    }
    let inicio = 0
    edicao.divisoes = tamanhos.map((tamanho, i) => {
      const vivos = presentes.slice(inicio, inicio + tamanho)
      inicio += tamanho
      return { numero: i + 1, participantes: tamanho, vivos, colocacoes: [], rodada: 0, sala: null, campeao: null, encerrada: false }
    })
    return edicao.divisoes.map((divisao) => divisao.numero)
  }

  private divisao(numero: number) {
    return this.edicao?.divisoes?.find((divisao) => divisao.numero === numero) ?? null
  }

  /** Quem segue na divisão, na ordem da classificação. */
  vivosDa(numero: number): readonly InscricaoNaCopa[] {
    return this.divisao(numero)?.vivos ?? []
  }

  /** Quem vai largar a próxima rodada: quem segue e não pediu para sair. */
  quemLarga(numero: number, conectado: (socketId: string) => boolean) {
    const divisao = this.divisao(numero)
    if (!divisao || divisao.encerrada) return { largam: [], saem: [] }
    const saem = divisao.vivos.filter((piloto) => piloto.saiu || !conectado(piloto.socketId))
    return { largam: divisao.vivos.filter((piloto) => !saem.includes(piloto)), saem }
  }

  /** Quantas rodadas a divisão já largou. */
  rodadaDa(numero: number) {
    return this.divisao(numero)?.rodada ?? 0
  }

  /** A sala da próxima rodada da divisão. Devolve o número da rodada. */
  registrarSala(numero: number, code: string) {
    const divisao = this.divisao(numero)
    if (!divisao) return 0
    divisao.rodada += 1
    divisao.sala = code
    return divisao.rodada
  }

  /** A divisão que corre nesta sala, se ela é da copa. */
  divisaoDaSala(code: string) {
    return this.edicao?.divisoes?.find((divisao) => divisao.sala === code)?.numero ?? null
  }

  eDaCopa(code: string) {
    return this.divisaoDaSala(code) !== null
  }

  /** O perfil de um piloto numa sala da copa. */
  perfilNaSala(code: string, playerId: string) {
    const numero = this.divisaoDaSala(code)
    return numero === null ? null : (this.divisao(numero)!.vivos.find((piloto) => piloto.playerId === playerId)?.perfilId ?? null)
  }

  /** Fecha a rodada com o resultado oficial da sala. */
  async resolverRodada(code: string, outcome: RaceOutcome) {
    const numero = this.divisaoDaSala(code)
    if (numero === null) return null
    const divisao = this.divisao(numero)!
    divisao.sala = null
    const { eliminados, desistentes } = eliminadosDaRodada(outcome.entries, divisao.vivos)
    return this.eliminar(divisao, eliminados, desistentes, code)
  }

  /**
   * Tira da divisão quem não pode largar a próxima rodada — caiu, ou pediu
   * para sair — como quem abandona.
   */
  async desistiram(numero: number, playerIds: readonly string[]) {
    const divisao = this.divisao(numero)
    if (!divisao || divisao.encerrada || playerIds.length === 0) return null
    const ordem = divisao.vivos.map((piloto) => piloto.playerId).filter((playerId) => playerIds.includes(playerId))
    return this.eliminar(divisao, ordem, new Set(ordem), divisao.sala)
  }

  /** Uma largada da divisão caiu antes de sair: a sala deixa de ser da copa. */
  soltarSala(code: string) {
    const numero = this.divisaoDaSala(code)
    if (numero === null) return null
    const divisao = this.divisao(numero)!
    divisao.sala = null
    // A rodada que não largou não conta: a próxima sala a corre de novo.
    divisao.rodada -= 1
    return numero
  }

  /**
   * Quem sai numa rodada ocupa as últimas posições ainda livres da divisão,
   * na ordem da rodada. Quando sobra um só, ele é o campeão, e a divisão
   * entrega os troféus. Quem abandona não leva troféu.
   */
  private async eliminar(divisao: Divisao, ordem: readonly string[], desistentes: ReadonlySet<string>, code: string | null) {
    const restantes = divisao.vivos.length
    const eliminados = ordem.map((playerId, i) => {
      const piloto = divisao.vivos.find((candidato) => candidato.playerId === playerId)!
      return {
        perfilId: piloto.perfilId,
        playerId,
        nome: piloto.nome,
        posicao: restantes - ordem.length + 1 + i,
        desistiu: desistentes.has(playerId),
      }
    })
    divisao.vivos = divisao.vivos.filter((piloto) => !ordem.includes(piloto.playerId))
    divisao.colocacoes.push(...eliminados)
    if (divisao.vivos.length === 1) {
      const [ultimo] = divisao.vivos
      divisao.campeao = { perfilId: ultimo.perfilId, playerId: ultimo.playerId, nome: ultimo.nome, posicao: 1, desistiu: false }
      divisao.colocacoes.push(divisao.campeao)
      divisao.vivos = []
    }
    if (divisao.vivos.length === 0) {
      divisao.encerrada = true
      await this.entregarTrofeus(divisao)
    }
    return {
      code,
      divisao: divisao.numero,
      rodada: divisao.rodada,
      eliminados,
      seguem: divisao.vivos.map((piloto) => ({ playerId: piloto.playerId, nome: piloto.nome })),
      campeao: divisao.campeao,
      encerrada: divisao.encerrada,
    } satisfies ResultadoDaRodada
  }

  private async entregarTrofeus(divisao: Divisao) {
    const dia = this.edicao!.dia
    for (const colocacao of divisao.colocacoes) {
      if (colocacao.posicao > 3 || colocacao.desistiu) continue
      // Um troféu que o banco recusou não para a copa das outras divisões.
      await this.repositorio
        .registrarTrofeu({
          perfilId: colocacao.perfilId,
          dia,
          divisao: divisao.numero,
          posicao: colocacao.posicao,
          participantes: divisao.participantes,
        })
        .catch((erro: unknown) => console.error('Troféu:', erro instanceof Error ? erro.message : erro))
    }
  }

  /** A copa de agora, do ponto de vista de um piloto. */
  async situacao(perfilId: string | null): Promise<SituacaoDaCopa> {
    const edicao = this.atual()
    const fase = this.fase()
    const classificados = this.classificados(edicao)
    const inscrito = perfilId ? (edicao.inscritos.get(perfilId) ?? null) : null
    const posicao = inscrito ? classificados.indexOf(inscrito) + 1 : 0
    const minha = perfilId
      ? (edicao.divisoes?.find(
          (divisao) =>
            divisao.vivos.some((piloto) => piloto.perfilId === perfilId) ||
            divisao.colocacoes.some((colocacao) => colocacao.perfilId === perfilId),
        ) ?? null)
      : null
    const minhaColocacao = minha?.colocacoes.find((colocacao) => colocacao.perfilId === perfilId) ?? null
    return {
      dia: edicao.dia,
      fase,
      abertura: edicao.abertura,
      fechamento: edicao.fechamento,
      eliminatorias: edicao.eliminatorias,
      seed: edicao.seed,
      dificuldade: DIFICULDADE_OFICIAL,
      inscritos: edicao.inscritos.size,
      inscrito: inscrito !== null,
      classificacao: classificados.slice(0, CLASSIFICACAO_VISIVEL).map((piloto, i) => ({
        posicao: i + 1,
        apelido: piloto.nome,
        tempo: piloto.tempo!,
        voce: piloto.perfilId === perfilId,
      })),
      voce: inscrito ? { tempo: inscrito.tempo, posicao: posicao > 0 ? posicao : null } : null,
      minhaDivisao: minha
        ? {
            numero: minha.numero,
            participantes: minha.participantes,
            rodada: minha.rodada,
            restantes: minha.vivos.length,
            posicao: minhaColocacao?.posicao ?? null,
            campeao: minha.campeao?.perfilId === perfilId,
          }
        : null,
      podios: (edicao.divisoes ?? [])
        .filter((divisao) => divisao.encerrada)
        .map((divisao) => ({
          divisao: divisao.numero,
          participantes: divisao.participantes,
          pilotos: divisao.colocacoes
            .filter((colocacao) => colocacao.posicao <= 3)
            .sort((a, b) => a.posicao - b.posicao)
            .map((colocacao) => ({ apelido: colocacao.nome, posicao: colocacao.posicao })),
        })),
      motivo: edicao.motivo,
      trofeus: perfilId ? await this.repositorio.trofeusDe(perfilId) : [],
    }
  }
}
