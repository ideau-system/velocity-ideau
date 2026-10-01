/**
 * A fila da ranqueada, para uma população pequena.
 *
 * Josh Menke, que fez o matchmaking de Halo e da Riot, aponta o erro mais
 * comum: começar exigente e ir afrouxando com o tempo. Aqui a regra é fixa e
 * sai da população ao vivo: quem está na fila é agrupado pela ordem do MMR,
 * em salas de até seis, do tamanho mais equilibrado possível. A fila espera
 * encher uma sala, ou que alguém espere o bastante — e então forma as salas
 * com todo mundo que está nela. Com pouca gente, esperar por uma sala perfeita
 * é não correr nunca.
 */

export type EntradaDaFila = {
  perfilId: string
  playerId: string
  socketId: string
  nome: string
  carro: string
  /** μ do piloto, para agrupar os de nível parecido. */
  mu: number
  /** Quando entrou na fila. */
  desde: number
}

/** Pilotos por sala, como no jogo casual. */
export const PILOTOS_POR_SALA = 6
/** Mínimo de humanos para largar: a ranqueada não é contra ninguém. */
export const MINIMO_POR_SALA = 2
/** Quanto a fila espera encher uma sala antes de largar com quem tem. */
export const ESPERA_DA_FILA_MS = 20_000

/**
 * Forma as salas que já podem largar, e devolve também quem fica na fila.
 *
 * Sai sala quando a fila tem gente para uma sala cheia, ou quando alguém já
 * esperou `espera`. Aí todo mundo é dividido pela ordem do MMR em salas de
 * tamanho parecido — sete viram quatro e três, e não seis e um.
 */
export function formarSalas(fila: readonly EntradaDaFila[], agora: number, espera = ESPERA_DA_FILA_MS) {
  const pronta = fila.length >= PILOTOS_POR_SALA || fila.some((entrada) => agora - entrada.desde >= espera)
  if (fila.length < MINIMO_POR_SALA || !pronta) return { salas: [] as EntradaDaFila[][], restantes: [...fila] }
  const ordenada = [...fila].sort((a, b) => a.mu - b.mu || a.desde - b.desde)
  const quantas = Math.ceil(ordenada.length / PILOTOS_POR_SALA)
  const tamanho = Math.ceil(ordenada.length / quantas)
  const salas: EntradaDaFila[][] = []
  for (let inicio = 0; inicio < ordenada.length; inicio += tamanho) salas.push(ordenada.slice(inicio, inicio + tamanho))
  // Uma sala de um só não corre: volta para a fila.
  const restantes = salas.length > 1 && salas[salas.length - 1].length < MINIMO_POR_SALA ? salas.pop()! : []
  return { salas, restantes }
}

/** O que a fila promete a quem espera nela, no relógio do servidor. */
export type PrevisaoDaFila = {
  /** Quando a próxima sala fecha, se já há gente para ela. */
  salaEm: number | null
  /** Quando quem está sozinho passa a correr contra fantasmas. */
  fantasmasEm: number | null
}

/**
 * Quando a fila vai andar: com gente para uma sala, ela fecha na hora com seis,
 * ou quando o primeiro da fila completar a espera; sozinho, é a hora dos
 * fantasmas. A mesma conta de `formarSalas`, para a tela não prometer o que a
 * fila não cumpre.
 */
export function previsaoDaFila(
  fila: readonly EntradaDaFila[],
  agora: number,
  espera = ESPERA_DA_FILA_MS,
  esperaComFantasmas: number,
): PrevisaoDaFila {
  if (fila.length === 0) return { salaEm: null, fantasmasEm: null }
  const primeiro = Math.min(...fila.map((entrada) => entrada.desde))
  if (fila.length < MINIMO_POR_SALA) return { salaEm: null, fantasmasEm: primeiro + esperaComFantasmas }
  return { salaEm: fila.length >= PILOTOS_POR_SALA ? agora : primeiro + espera, fantasmasEm: null }
}
