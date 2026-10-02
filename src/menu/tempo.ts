import { FUSO_DA_PISTA_DO_DIA } from '../game/contrarrelogio'

/**
 * Os relógios do paddock: quanto falta para um evento e quanto tempo já se
 * passou na fila, do jeito que os menus de jogo mostram — curto, e sempre do
 * mesmo tamanho, para o número não pular enquanto conta.
 */

const SEGUNDO = 1_000
const MINUTO = 60 * SEGUNDO
const HORA = 60 * MINUTO
const DIA = 24 * HORA

/** Tempo corrido: "0:07", "12:40". É o relógio da fila. */
export function cronometro(ms: number) {
  const total = Math.max(0, Math.floor(ms / SEGUNDO))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Quanto falta: "3D 04H", "2H 05MIN" ou "12:05". O segundo arredonda para
 * cima — o relógio mostra "0:01" até o instante chegar —, e nunca fica negativo.
 */
export function faltam(ms: number) {
  const restante = Math.max(0, Math.ceil(ms / SEGUNDO) * SEGUNDO)
  if (restante >= DIA) {
    return `${Math.floor(restante / DIA)}D ${String(Math.floor((restante % DIA) / HORA)).padStart(2, '0')}H`
  }
  if (restante >= HORA) {
    return `${Math.floor(restante / HORA)}H ${String(Math.floor((restante % HORA) / MINUTO)).padStart(2, '0')}MIN`
  }
  return cronometro(restante)
}

/** A hora de um instante no relógio do aparelho: "21:00". */
export function horaDe(instante: number) {
  return new Date(instante).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** O horário ranqueado, em horas de Brasília: é quando a fila junta mais gente. */
export const HORARIO_NOBRE = { de: 20, ate: 22 } as const

/** Se um instante cai no horário nobre da ranqueada. */
export function noHorarioNobre(instante: number) {
  const hora = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: FUSO_DA_PISTA_DO_DIA, hour: '2-digit', hourCycle: 'h23' }).format(instante),
  )
  return hora >= HORARIO_NOBRE.de && hora < HORARIO_NOBRE.ate
}

/** Quem está na fila, e o que o servidor promete dela — tudo no relógio do servidor. */
export type BuscaRanqueada = {
  tamanho: number
  desde: number | null
  salaEm: number | null
  fantasmasEm: number | null
}

/** Depois de quanto atraso a promessa dos fantasmas vira espera por outro piloto. */
const FOLGA_DOS_FANTASMAS_MS = 5_000

/**
 * O que a barra da fila diz, e quanto da espera já andou (de 0 a 1).
 *
 * É a previsão do servidor lida no relógio dele: com gente para uma sala,
 * quando ela fecha; sozinho, quando os fantasmas entram. Os fantasmas podem
 * faltar — não há voltas do nível do piloto —, e aí o texto admite a espera.
 */
export function leituraDaFila(busca: BuscaRanqueada, agora: number): { texto: string; progresso: number } {
  const inicio = busca.desde ?? agora
  const andou = (alvo: number) => (alvo <= inicio ? 1 : Math.min(1, Math.max(0, (agora - inicio) / (alvo - inicio))))
  if (busca.salaEm !== null) {
    const falta = busca.salaEm - agora
    const quantos = `${busca.tamanho} NA FILA`
    return falta > 0
      ? { texto: `${quantos} · A SALA FECHA EM ${faltam(falta)}`, progresso: andou(busca.salaEm) }
      : { texto: `${quantos} · MONTANDO A SALA…`, progresso: 1 }
  }
  if (busca.fantasmasEm !== null) {
    const falta = busca.fantasmasEm - agora
    if (falta > 0) return { texto: `SÓ VOCÊ NA FILA · FANTASMAS DO SEU NÍVEL EM ${faltam(falta)}`, progresso: andou(busca.fantasmasEm) }
    return falta > -FOLGA_DOS_FANTASMAS_MS
      ? { texto: 'SÓ VOCÊ NA FILA · CHAMANDO FANTASMAS DO SEU NÍVEL…', progresso: 1 }
      : { texto: 'SÓ VOCÊ NA FILA · ESPERANDO OUTRO PILOTO', progresso: 1 }
  }
  return { texto: 'ENTRANDO NA FILA…', progresso: 0 }
}
