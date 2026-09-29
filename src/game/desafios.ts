// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { hash32 } from './layout.js'
import type { Difficulty, RaceRules } from './rules.js'

/**
 * Desafios da Semana.
 *
 * O Playground do Horizon Chase Turbo foi o que manteve o jogo competitivo:
 * a cada duas semanas, cinco pistas com as regras mexidas pelos
 * desenvolvedores e um quadro que zerava no fim. Aqui são cinco por semana,
 * virando na segunda-feira de Brasília. Cada um é uma semente com um
 * modificador de regra; o quadro de cada um é o da semente, então zera sozinho
 * quando a semana muda.
 *
 * Os modificadores mexem só em números que a física já tem. Nenhum deles
 * passa do teto do nível — é o que o servidor usa para o tempo mínimo.
 */

export type Modificador = 'classico' | 'nitroLivre' | 'soTangencia' | 'chuva' | 'profissional'

type DefinicaoDoModificador = {
  nome: string
  descricao: string
  dificuldade: Difficulty
  regras: (base: RaceRules) => RaceRules
}

export const MODIFICADORES: Record<Modificador, DefinicaoDoModificador> = {
  classico: {
    nome: 'Clássico',
    descricao: 'A pista pura, no nível oficial.',
    dificuldade: 'dificil',
    regras: (base) => base,
  },
  nitroLivre: {
    nome: 'Nitro sem fim',
    descricao: 'O boost não acaba. A curva continua cobrando de quem entra nela de boost.',
    dificuldade: 'dificil',
    regras: (base) => ({ ...base, boostDrain: 0 }),
  },
  soTangencia: {
    nome: 'Só tangência',
    descricao: 'O boost não recarrega sozinho: só a tangência e o raspão o devolvem.',
    dificuldade: 'dificil',
    regras: (base) => ({ ...base, boostRecharge: 0 }),
  },
  chuva: {
    nome: 'Pista molhada',
    descricao: 'O pneu segura um quarto a menos na curva, e a grama pesa mais.',
    dificuldade: 'dificil',
    regras: (base) => ({
      ...base,
      cornerGrip: base.cornerGrip * 0.75,
      maxGripLoss: base.maxGripLoss + 0.05,
      offRoadDepthLoss: base.offRoadDepthLoss + 0.1,
    }),
  },
  profissional: {
    nome: 'Profissional',
    descricao: 'O nível mais rápido, com mais obstáculos e menos aderência.',
    dificuldade: 'profissional',
    regras: (base) => base,
  },
}

/** A ordem dos cinco desafios de toda semana. */
export const ORDEM_DOS_DESAFIOS: readonly Modificador[] = ['classico', 'nitroLivre', 'soTangencia', 'chuva', 'profissional']

export type Desafio = {
  id: string
  semana: number
  seed: number
  modificador: Modificador
  dificuldade: Difficulty
}

const SEMANA_MS = 7 * 86_400_000
/** O relógio Unix começa numa quinta-feira; a semana vira na segunda, à meia-noite de Brasília. */
const INICIO_DA_SEMANA_MS = 4 * 86_400_000 + 3 * 3_600_000

/** O número da semana de um instante, virando na segunda-feira de Brasília. */
export function semanaDe(instante: number) {
  return Math.floor((instante - INICIO_DA_SEMANA_MS) / SEMANA_MS)
}

/** A segunda-feira que abre a semana, `AAAA-MM-DD`. */
export function inicioDaSemana(semana: number) {
  return new Date(semana * SEMANA_MS + INICIO_DA_SEMANA_MS).toISOString().slice(0, 10)
}

/** Os cinco desafios de uma semana. Mesma semana, mesmos desafios, em qualquer aparelho. */
export function desafiosDaSemana(semana: number): Desafio[] {
  return ORDEM_DOS_DESAFIOS.map((modificador, indice) => ({
    id: `${semana}-${indice}`,
    semana,
    seed: hash32(semana, 0xd35a + indice),
    modificador,
    dificuldade: MODIFICADORES[modificador].dificuldade,
  }))
}

/** O desafio de um identificador, se ele for desta semana. */
export function desafioDaSemana(id: unknown, instante: number) {
  return desafiosDaSemana(semanaDe(instante)).find((desafio) => desafio.id === id) ?? null
}

/** As regras de um modificador, ou as do nível sem ele. */
export function regrasDo(modificador: Modificador | null | undefined) {
  return modificador ? MODIFICADORES[modificador].regras : undefined
}
