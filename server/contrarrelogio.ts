import { randomUUID } from 'node:crypto'
import {
  CIRCUITO_OFICIAL,
  CONTAGEM_DO_CONTRARRELOGIO_MS,
  diaDe,
  DIFICULDADE_OFICIAL,
  limitesDasMedalhas,
  medalhaPara,
  sementeDoDia,
  tempoDoPiloto,
} from '../src/game/contrarrelogio.js'
import { desafioDaSemana, desafiosDaSemana, inicioDaSemana, MODIFICADORES, regrasDo, semanaDe, type Modificador } from '../src/game/desafios.js'
import { duracaoDaGravacao, gravacaoValida, type GravacaoDeVolta } from '../src/game/gravador.js'
import { progressoEm, refazerVolta, registroValido, type RegistroDeEntradas } from '../src/game/registroDeEntradas.js'
import type { Difficulty } from '../src/game/rules.js'
import { MAX_FRAME_SECONDS } from '../src/game/simulation.js'
import { TRACK_LENGTH } from '../src/game/track.js'
import type { Dispositivo, EstadoDoTempo, LinhaDoQuadro, Repositorio } from './dados/tipos.js'
import { minRaceSeconds, tetoDaTelemetria } from './rooms.js'

/**
 * A Pista do Dia no servidor: quem valida os tempos e monta o quadro.
 *
 * O cliente simula a própria física, então o tempo dele não é aceito de olhos
 * fechados. A validação é em camadas, da mais barata para a mais cara:
 *
 * 1. **O relógio do servidor.** Ele marca a largada quando a tentativa começa
 *    e a chegada quando o aviso chega. O tempo declarado precisa caber nessa
 *    janela: um cliente acelerado chega cedo demais, e um em câmera lenta —
 *    o que derrubou o topo do Trackmania — declara menos do que passou.
 * 2. **A volta gravada.** Tem de ser uma volta de verdade: duração igual ao
 *    tempo, progresso que nunca recua e nunca passa do teto do nível, até a
 *    linha de chegada.
 * 3. **Os comandos.** Com o registro de comandos, o servidor refaz a volta
 *    com a mesma física, quadro a quadro, e confere se ela chega à linha no
 *    mesmo tempo e pelo mesmo caminho da volta gravada. Um cliente com a física
 *    adulterada não consegue produzir comandos que, na física de verdade, deem
 *    a volta que ele gravou.
 * 4. **Suspeita.** Volante que troca de lado mais de oito vezes por segundo —
 *    a marca estatística das trapaças do Trackmania — deixa o tempo pendente,
 *    fora do quadro. Sem o registro de comandos, o tempo abaixo do piloto de
 *    referência também fica pendente; com ele, a volta refeita é a conferência.
 */

/** Quanto antes do tempo de parede a chegada pode ser declarada: a viagem da mensagem e a largada local. */
const FOLGA_ANTES_S = 3
/** Quanto além do tempo de parede: o relógio do aparelho contra o do servidor. */
const FOLGA_DEPOIS_S = 0.5
/** Diferença aceita entre o tempo declarado e a duração da volta gravada. */
const FOLGA_DA_GRAVACAO_S = 0.25
/** Trocas de lado do volante por segundo acima das quais a volta fica sob suspeita. */
const TROCAS_SUSPEITAS_POR_S = 8
/** Abaixo desta fração do tempo do piloto de referência, o tempo espera conferência. */
const ABAIXO_DA_REFERENCIA = 0.95
/** Diferença aceita entre a chegada da volta refeita e o tempo declarado. */
const FOLGA_DA_CHEGADA_REFEITA_S = 1
/** Erro mediano aceito entre a volta refeita e a gravada, em metros. */
const ERRO_MEDIANO_M = 5
/** Erro a partir do qual uma amostra conta como fora do caminho, e a fração tolerada delas. */
const ERRO_GRANDE_M = 25
const FRACAO_FORA_DO_CAMINHO = 0.1

/**
 * Refaz a volta pelos comandos e confere com a gravada.
 *
 * A tolerância existe porque o último bit de `Math.exp` e `Math.pow` muda de um
 * motor de JavaScript para outro, e uma batida por um fio pode sair diferente.
 * Um cliente com a física adulterada erra por centenas de metros, não por
 * alguns.
 */
export function conferirComandos(
  registro: RegistroDeEntradas,
  gravacao: GravacaoDeVolta,
  tempo: number,
  seed: number,
  dificuldade: Difficulty,
  modificador: Modificador | null = null,
): { ok: true } | { ok: false; motivo: string } {
  const volta = refazerVolta(registro, seed, dificuldade, regrasDo(modificador))
  if (!volta.terminou || volta.chegada === null) return { ok: false, motivo: 'os comandos não levam à linha' }
  if (Math.abs(volta.chegada - tempo) > FOLGA_DA_CHEGADA_REFEITA_S) return { ok: false, motivo: 'o tempo não bate com os comandos' }
  const erros: number[] = []
  for (let i = 0; i < gravacao.progresso.length; i += 1) {
    const instante = (i * gravacao.intervaloMs) / 1000
    if (instante > tempo) break
    erros.push(Math.abs(progressoEm(volta, instante) - gravacao.progresso[i] / 10))
  }
  erros.sort((a, b) => a - b)
  const mediano = erros[Math.floor(erros.length / 2)] ?? 0
  const foraDoCaminho = erros.filter((erro) => erro > ERRO_GRANDE_M).length / Math.max(1, erros.length)
  if (mediano > ERRO_MEDIANO_M || foraDoCaminho > FRACAO_FORA_DO_CAMINHO) {
    return { ok: false, motivo: 'a volta refeita não bate com a gravada' }
  }
  return { ok: true }
}

export type Veredito = { estado: EstadoDoTempo; motivo?: string }

/** Trocas de direção do movimento lateral por segundo, ignorando tremidas menores que o ruído. */
export function trocasDeLadoPorSegundo(gravacao: GravacaoDeVolta) {
  let trocas = 0
  let sentido = 0
  for (let i = 1; i < gravacao.lateral.length; i += 1) {
    const passo = gravacao.lateral[i] - gravacao.lateral[i - 1]
    // Milésimos de faixa: abaixo de 4 é arredondamento, não volante.
    if (Math.abs(passo) < 4) continue
    const agora = Math.sign(passo)
    if (sentido !== 0 && agora !== sentido) trocas += 1
    sentido = agora
  }
  return trocas / Math.max(1, duracaoDaGravacao(gravacao))
}

/**
 * Julga uma volta do contrarrelógio.
 *
 * `decorrido` é o tempo que o servidor mediu entre a largada da tentativa e a
 * chegada do aviso, em segundos.
 */
export function julgarVolta(entrada: {
  tempo: unknown
  gravacao: unknown
  decorrido: number
  seed: number
  dificuldade: Difficulty
  /** Os comandos da volta. Sem eles, o tempo bom demais fica pendente. */
  entradas?: unknown
  /** O modificador do desafio da semana, quando a volta é de um. */
  modificador?: Modificador | null
}): Veredito {
  const { decorrido, seed, dificuldade } = entrada
  const modificador = entrada.modificador ?? null
  const tempo = typeof entrada.tempo === 'number' ? entrada.tempo : Number.NaN
  if (!Number.isFinite(tempo)) return { estado: 'recusado', motivo: 'tempo inválido' }
  if (tempo < minRaceSeconds(dificuldade)) return { estado: 'recusado', motivo: 'mais rápido que o possível' }
  // O relógio do aparelho adiantado declara mais do que passou; o atrasado —
  // ou o jogo em câmera lenta —, menos.
  if (tempo > decorrido + FOLGA_DEPOIS_S) return { estado: 'recusado', motivo: 'tempo maior que o que passou no servidor' }
  if (tempo < decorrido - FOLGA_ANTES_S) return { estado: 'recusado', motivo: 'tempo menor que o que passou no servidor' }

  const gravacao = gravacaoValida(entrada.gravacao)
  if (!gravacao) return { estado: 'recusado', motivo: 'volta gravada inválida' }
  if (Math.abs(duracaoDaGravacao(gravacao) - tempo) > FOLGA_DA_GRAVACAO_S) {
    return { estado: 'recusado', motivo: 'a volta gravada não bate com o tempo' }
  }
  if (gravacao.progresso[gravacao.progresso.length - 1] < TRACK_LENGTH * 10) {
    return { estado: 'recusado', motivo: 'a volta gravada não chega à linha' }
  }
  // Nenhum trecho da volta anda mais que o teto do nível permite. As amostras
  // saem dos quadros desenhados, e não de um relógio exato: a de cada 100 ms é
  // a do primeiro quadro depois dele, então entre duas cabem um intervalo e até
  // um quadro a mais de física — que nunca passa de MAX_FRAME_SECONDS, o quadro
  // mais longo que o jogo recupera de uma vez. Sem essa folga, a volta legítima
  // de quem corre no boost num celular lento, ou que engasgou, era recusada.
  const teto = tetoDaTelemetria(dificuldade)
  const maiorPasso = teto * (gravacao.intervaloMs / 1000 + MAX_FRAME_SECONDS) + 1
  for (let i = 1; i < gravacao.progresso.length; i += 1) {
    if ((gravacao.progresso[i] - gravacao.progresso[i - 1]) / 10 > maiorPasso) {
      return { estado: 'recusado', motivo: 'um trecho mais rápido que o teto do nível' }
    }
    if (gravacao.velocidade[i] > teto * 3.6 + 5) return { estado: 'recusado', motivo: 'velocidade acima do teto' }
  }

  if (entrada.entradas !== undefined && entrada.entradas !== null) {
    const registro = registroValido(entrada.entradas)
    if (!registro) return { estado: 'recusado', motivo: 'registro de comandos inválido' }
    const conferencia = conferirComandos(registro, gravacao, tempo, seed, dificuldade, modificador)
    if (!conferencia.ok) return { estado: 'recusado', motivo: conferencia.motivo }
    if (trocasDeLadoPorSegundo(gravacao) > TROCAS_SUSPEITAS_POR_S) return { estado: 'pendente', motivo: 'volante suspeito' }
    // A volta refeita é a conferência: o piloto de referência não é o limite de ninguém.
    return { estado: 'valido' }
  }

  if (trocasDeLadoPorSegundo(gravacao) > TROCAS_SUSPEITAS_POR_S) return { estado: 'pendente', motivo: 'volante suspeito' }
  if (tempo < tempoDoPiloto(seed, dificuldade, modificador) * ABAIXO_DA_REFERENCIA) {
    return { estado: 'pendente', motivo: 'abaixo do piloto de referência' }
  }
  return { estado: 'valido' }
}

/**
 * Qual prova do contrarrelógio: sem nada, a Pista do Dia; com `desafio`, um
 * desafio desta semana; com `circuito: 'oficial'`, o Circuito Oficial do
 * ranking mundial.
 */
export type PedidoDeProva = { desafio?: unknown; circuito?: unknown }

/** A pista de uma prova: onde o tempo é guardado e com que regras ele é julgado. */
type Prova = {
  tipo: 'dia' | 'desafio' | 'oficial'
  /** O dia que o tempo leva: o da pista, o da semana do desafio ou o da volta, no circuito. */
  dia: string
  seed: number
  dificuldade: Difficulty
  modificador: Modificador | null
}

type Tentativa = Prova & {
  perfilId: string
  largada: number
}

/** Um desafio da semana, como o cliente o recebe: com o líder e a linha de quem pergunta. */
export type ResumoDoDesafio = {
  id: string
  modificador: Modificador
  nome: string
  descricao: string
  dificuldade: Difficulty
  seed: number
  limites: ReturnType<typeof limitesDasMedalhas>
  lider: LinhaDoQuadro | null
  voce: LinhaDoQuadro | null
}

/** O quadro da Pista do Dia como o cliente o recebe. */
export type QuadroDoDia = {
  dia: string
  seed: number
  dificuldade: Difficulty
  limites: ReturnType<typeof limitesDasMedalhas>
  linhas: LinhaDoQuadro[]
  voce: LinhaDoQuadro | null
}

/** Quantas tentativas abertas cada piloto pode ter: a atual e o recomeço dela. */
const TENTATIVAS_POR_PILOTO = 3

/**
 * O serviço da Pista do Dia: abre tentativas, julga voltas e monta o quadro.
 *
 * As tentativas moram na memória — duram uma volta —, e só o tempo julgado
 * vai para o repositório.
 */
export class PistaDoDia {
  private readonly tentativas = new Map<string, Tentativa>()

  constructor(
    private readonly repositorio: Repositorio,
    private readonly agora: () => number = Date.now,
  ) {}

  /** O dia e a semente de agora, no fuso da Pista do Dia. */
  hoje() {
    const dia = diaDe(new Date(this.agora()))
    return { dia, seed: sementeDoDia(dia) }
  }

  /** A pista de um pedido, ou null para o desafio que não é desta semana. */
  private prova(pedido: PedidoDeProva | undefined): Prova | null {
    if (pedido?.circuito === 'oficial') {
      return {
        tipo: 'oficial',
        dia: this.hoje().dia,
        seed: CIRCUITO_OFICIAL.seed,
        dificuldade: CIRCUITO_OFICIAL.dificuldade,
        modificador: null,
      }
    }
    if (pedido?.desafio !== undefined && pedido.desafio !== null) {
      const desafio = desafioDaSemana(pedido.desafio, this.agora())
      if (!desafio) return null
      return {
        tipo: 'desafio',
        dia: inicioDaSemana(desafio.semana),
        seed: desafio.seed,
        dificuldade: desafio.dificuldade,
        modificador: desafio.modificador,
      }
    }
    return { tipo: 'dia', ...this.hoje(), dificuldade: DIFICULDADE_OFICIAL, modificador: null }
  }

  /**
   * Abre uma tentativa: o relógio do servidor passa a contar a partir do apagar
   * das luzes. Sem pedido é a Pista do Dia.
   */
  iniciar(perfilId: string, pedido?: PedidoDeProva) {
    const prova = this.prova(pedido)
    if (!prova) return null
    const { dia, seed, dificuldade, modificador } = prova
    // Recomeçar abre outra tentativa; as antigas do mesmo piloto saem.
    const doPiloto = [...this.tentativas.entries()].filter(([, tentativa]) => tentativa.perfilId === perfilId)
    for (const [id] of doPiloto.slice(0, Math.max(0, doPiloto.length - (TENTATIVAS_POR_PILOTO - 1)))) {
      this.tentativas.delete(id)
    }
    const id = randomUUID()
    const largada = this.agora() + CONTAGEM_DO_CONTRARRELOGIO_MS
    this.tentativas.set(id, { ...prova, perfilId, largada })
    return { tentativa: id, dia, seed, dificuldade, modificador, contagemMs: CONTAGEM_DO_CONTRARRELOGIO_MS }
  }

  /** Julga a volta de uma tentativa e, se não for recusada, guarda o tempo. */
  async terminar(
    perfilId: string,
    entrada: { tentativa: unknown; tempo: unknown; gravacao: unknown; dispositivo: unknown; entradas?: unknown },
  ) {
    const id = typeof entrada.tentativa === 'string' ? entrada.tentativa : ''
    const tentativa = this.tentativas.get(id)
    if (!tentativa || tentativa.perfilId !== perfilId) {
      return { estado: 'recusado' as const, motivo: 'tentativa desconhecida', linha: null, volta: null }
    }
    this.tentativas.delete(id)
    const decorrido = (this.agora() - tentativa.largada) / 1000
    const veredito = julgarVolta({
      tempo: entrada.tempo,
      gravacao: entrada.gravacao,
      decorrido,
      seed: tentativa.seed,
      dificuldade: tentativa.dificuldade,
      modificador: tentativa.modificador,
      entradas: entrada.entradas,
    })
    if (veredito.estado === 'recusado') return { ...veredito, linha: null, volta: null }
    const tempo = entrada.tempo as number
    // O dia do tempo no circuito é o da volta; na Pista do Dia e nos desafios,
    // o da pista — mesmo que a volta tenha acabado depois da meia-noite.
    const dia = tentativa.tipo === 'oficial' ? this.hoje().dia : tentativa.dia
    await this.repositorio.registrarTempo({
      perfilId,
      dia,
      seed: tentativa.seed,
      dificuldade: tentativa.dificuldade,
      tempo,
      dispositivo: dispositivoDe(entrada.dispositivo),
      estado: veredito.estado,
      medalha: medalhaPara(tempo, limitesDasMedalhas(tempoDoPiloto(tentativa.seed, tentativa.dificuldade, tentativa.modificador))),
      gravacao: gravacaoValida(entrada.gravacao)!,
    })
    const linha = await this.repositorio.linhaDe(tentativa.seed, tentativa.dificuldade, perfilId)
    // A volta julgada, com a largada que o servidor marcou: é o que a Copa do
    // Dia precisa para saber se ela vale na classificação.
    const volta = {
      largada: tentativa.largada,
      tempo,
      seed: tentativa.seed,
      dificuldade: tentativa.dificuldade,
      modificador: tentativa.modificador,
      estado: veredito.estado,
    }
    return { ...veredito, linha, volta }
  }

  /** Os cinco desafios desta semana, cada um com o líder e a linha de quem pergunta. */
  async desafios(perfilId: string | null): Promise<ResumoDoDesafio[]> {
    const semana = semanaDe(this.agora())
    return Promise.all(
      desafiosDaSemana(semana).map(async (desafio) => {
        const [topo, voce] = await Promise.all([
          this.repositorio.quadro(desafio.seed, desafio.dificuldade, 1),
          perfilId ? this.repositorio.linhaDe(desafio.seed, desafio.dificuldade, perfilId) : Promise.resolve(null),
        ])
        const definicao = MODIFICADORES[desafio.modificador]
        return {
          id: desafio.id,
          modificador: desafio.modificador,
          nome: definicao.nome,
          descricao: definicao.descricao,
          dificuldade: desafio.dificuldade,
          seed: desafio.seed,
          limites: limitesDasMedalhas(tempoDoPiloto(desafio.seed, desafio.dificuldade, desafio.modificador)),
          lider: topo[0] ?? null,
          voce,
        }
      }),
    )
  }

  /**
   * O quadro de uma prova — o de hoje, sem pedido —: o top, as medalhas e a
   * linha de quem pergunta. No Circuito Oficial é o ranking mundial, de todos
   * os tempos.
   */
  async quadro(perfilId: string | null, limite = 10, pedido?: PedidoDeProva): Promise<QuadroDoDia | null> {
    const prova = this.prova(pedido)
    if (!prova) return null
    const { dia, seed, dificuldade, modificador } = prova
    const [linhas, voce] = await Promise.all([
      this.repositorio.quadro(seed, dificuldade, limite),
      perfilId ? this.repositorio.linhaDe(seed, dificuldade, perfilId) : Promise.resolve(null),
    ])
    return {
      dia,
      seed,
      dificuldade,
      limites: limitesDasMedalhas(tempoDoPiloto(seed, dificuldade, modificador)),
      linhas,
      voce,
    }
  }

  /**
   * A volta de um tempo do quadro de hoje, de um desafio desta semana ou do
   * ranking mundial, para correr contra ela. Só o top 10 de cada quadro é
   * público.
   */
  async fantasma(tempoId: string) {
    const { seed } = this.hoje()
    const quadros = [
      { seed, dificuldade: DIFICULDADE_OFICIAL },
      { seed: CIRCUITO_OFICIAL.seed, dificuldade: CIRCUITO_OFICIAL.dificuldade },
      ...desafiosDaSemana(semanaDe(this.agora())).map((desafio) => ({ seed: desafio.seed, dificuldade: desafio.dificuldade })),
    ]
    for (const quadro of quadros) {
      const top = await this.repositorio.quadro(quadro.seed, quadro.dificuldade, 10)
      if (top.some((linha) => linha.id === tempoId)) return this.repositorio.gravacao(tempoId)
    }
    return null
  }
}

function dispositivoDe(bruto: unknown): Dispositivo {
  return bruto === 'teclado' || bruto === 'toque' ? bruto : 'desconhecido'
}
