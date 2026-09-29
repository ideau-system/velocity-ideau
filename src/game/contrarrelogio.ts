// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { correrSemTela } from './corridaSimulada.js'
import { regrasDo, type Modificador } from './desafios.js'
import { duracaoDaGravacao, gravacaoValida, type GravacaoDeVolta } from './gravador.js'
import { hash32 } from './layout.js'
import { pilotoCompleto } from './piloto.js'
import type { Difficulty } from './rules.js'

/**
 * Contrarrelógio e Pista do Dia.
 *
 * O traçado da corrida é sorteado a cada prova, e isso é justo dentro da sala —
 * todos correm a mesma pista —, mas impede comparar tempos entre provas. A
 * Pista do Dia resolve do jeito do Spelunky e da Track of the Day do
 * Trackmania: uma semente só por dia, a mesma para todo mundo, e um recorde
 * que dá para bater, comparar e usar de fantasma.
 */

/** O dia da pista vira à meia-noite de Brasília, para todos ao mesmo tempo. */
export const FUSO_DA_PISTA_DO_DIA = 'America/Sao_Paulo'

/**
 * Nível oficial da Pista do Dia e da ranqueada.
 *
 * Um nível só, para os tempos serem comparáveis e a população pequena não se
 * dividir em três quadros: o Hyper Roll do TFT morreu com 2% do tempo de jogo.
 * O difícil é o do meio — o normal é a porta de entrada, o profissional o
 * desafio.
 */
export const DIFICULDADE_OFICIAL: Difficulty = 'dificil'

/**
 * O Circuito Oficial: a pista fixa do ranking mundial de melhor tempo.
 *
 * Cada corrida sorteia um traçado, a Pista do Dia troca à meia-noite e os
 * desafios na segunda: um recorde mundial precisa de uma pista que não mude
 * nunca, como as da campanha do Trackmania. A semente foi escolhida entre as
 * que o pool da ranqueada aprovaria — o iniciante termina em 77 s, e o piloto
 * que usa tudo tira 15 s disso —, num fim de tarde no campo, com arquibancada.
 * Trocar a semente zera o ranking.
 */
export const CIRCUITO_OFICIAL = {
  seed: 3_729_030_975,
  dificuldade: DIFICULDADE_OFICIAL,
  nome: 'Circuito Oficial',
} as const

/** Contagem curta do contrarrelógio: recomeçar precisa ser quase instantâneo. */
export const CONTAGEM_DO_CONTRARRELOGIO_MS = 2_400

/** O dia, `AAAA-MM-DD`, no fuso da Pista do Dia. */
export function diaDe(data: Date, fuso = FUSO_DA_PISTA_DO_DIA) {
  // O formato canadense é o ISO, e é o único que o Intl entrega sem montar à mão.
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(data)
}

/** Semente da pista de um dia. Mesma data, mesma pista, em qualquer aparelho. */
export function sementeDoDia(dia: string) {
  const numero = Number(dia.replaceAll('-', ''))
  if (!Number.isInteger(numero) || numero <= 0) throw new Error(`dia inválido: ${dia}`)
  return hash32(numero, 0x7d1a)
}

export type Medalha = 'autor' | 'ouro' | 'prata' | 'bronze'

export const MEDALHAS: readonly Medalha[] = ['autor', 'ouro', 'prata', 'bronze']

export const NOME_DA_MEDALHA: Record<Medalha, string> = {
  autor: 'Piloto',
  ouro: 'Ouro',
  prata: 'Prata',
  bronze: 'Bronze',
}

/**
 * Quanto cada medalha dá de folga sobre o tempo de referência.
 *
 * Não há autor numa pista sorteada, então o "tempo do autor" é o do piloto de
 * teste que usa tudo — tangência, mini-turbo e largada perfeita. Os fatores são
 * um palpite inicial, a calibrar pela distribuição real, como o Trackmania fez.
 */
export const FATOR_DA_MEDALHA: Record<Medalha, number> = {
  autor: 1,
  ouro: 1.03,
  prata: 1.07,
  bronze: 1.12,
}

const referencias = new Map<string, number>()

/**
 * Tempo de referência de uma semente: o piloto que usa tudo, largando perfeito.
 *
 * Roda a prova inteira fora da tela, uma vez por semente e nível.
 */
export function tempoDoPiloto(seed: number, difficulty: Difficulty, modificador: Modificador | null = null) {
  const chave = `${seed}:${difficulty}:${modificador ?? ''}`
  const guardado = referencias.get(chave)
  if (guardado !== undefined) return guardado
  const { tempo } = correrSemTela((layout) => pilotoCompleto(layout), {
    seed,
    difficulty,
    largada: { nivel: 3, queimou: false },
    regras: regrasDo(modificador),
  })
  referencias.set(chave, tempo)
  return tempo
}

/** O tempo de cada medalha, a partir da referência. */
export function limitesDasMedalhas(referencia: number): Record<Medalha, number> {
  return {
    autor: referencia * FATOR_DA_MEDALHA.autor,
    ouro: referencia * FATOR_DA_MEDALHA.ouro,
    prata: referencia * FATOR_DA_MEDALHA.prata,
    bronze: referencia * FATOR_DA_MEDALHA.bronze,
  }
}

/** A melhor medalha que um tempo alcança, ou null. */
export function medalhaPara(tempo: number, limites: Record<Medalha, number>): Medalha | null {
  if (!Number.isFinite(tempo)) return null
  return MEDALHAS.find((medalha) => tempo <= limites[medalha]) ?? null
}

/** O recorde pessoal numa semente e nível, com o fantasma dele. */
export type Recorde = {
  tempo: number
  gravacao: GravacaoDeVolta
  /** Quando foi feito, em ISO. */
  em: string
}

/** O pedaço do `Storage` que o recorde usa: o que os testes substituem. */
export type Armazenamento = Pick<Storage, 'getItem' | 'setItem'>

export function chaveDoRecorde(seed: number, difficulty: Difficulty) {
  return `corrida-recorde:${seed >>> 0}:${difficulty}`
}

/** O recorde guardado, se houver e se for válido. */
export function lerRecorde(armazenamento: Armazenamento | null, seed: number, difficulty: Difficulty): Recorde | null {
  if (!armazenamento) return null
  try {
    const bruto = armazenamento.getItem(chaveDoRecorde(seed, difficulty))
    if (!bruto) return null
    const dados = JSON.parse(bruto) as Partial<Recorde>
    const gravacao = gravacaoValida(dados.gravacao)
    if (!gravacao || typeof dados.tempo !== 'number' || !Number.isFinite(dados.tempo)) return null
    // O tempo precisa bater com a gravação: é ela que corre na pista.
    if (Math.abs(duracaoDaGravacao(gravacao) - dados.tempo) > 0.25) return null
    return { tempo: dados.tempo, gravacao, em: typeof dados.em === 'string' ? dados.em : '' }
  } catch {
    // Armazenamento bloqueado ou corrompido: é como não haver recorde.
    return null
  }
}

/**
 * Guarda o tempo se ele bate o recorde. Devolve verdadeiro quando guardou.
 *
 * Um armazenamento cheio ou bloqueado não derruba a corrida: o recorde só não
 * fica guardado.
 */
export function guardarSeRecorde(
  armazenamento: Armazenamento | null,
  seed: number,
  difficulty: Difficulty,
  novo: Recorde,
): boolean {
  const atual = lerRecorde(armazenamento, seed, difficulty)
  if (atual && atual.tempo <= novo.tempo) return false
  try {
    armazenamento?.setItem(chaveDoRecorde(seed, difficulty), JSON.stringify(novo))
    return Boolean(armazenamento)
  } catch {
    return false
  }
}
