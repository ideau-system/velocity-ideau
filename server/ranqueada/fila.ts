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
