/**
 * O apelido de uma conta: o nome que aparece no grid, nos quadros e no ranking
 * mundial. É escolhido no cadastro e é único entre as contas, sem diferenciar
 * maiúsculas — no ranking, dois "Rafa" seriam um problema.
 *
 * Mora no jogo, e não no servidor, porque a tela de cadastro avisa na hora o
 * que está errado, com as mesmas regras que o servidor aplica depois.
 */

export const APELIDO_MINIMO = 3
export const APELIDO_MAXIMO = 16

/** Letras (com acento), números, espaço, ponto, hífen e sublinhado; começa por letra ou número. */
const PERMITIDO = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u

/** O apelido como é guardado: espaços repetidos viram um, e as pontas somem. */
export function limparApelido(bruto: unknown) {
  return typeof bruto === 'string' ? bruto.replace(/\s+/g, ' ').trim() : ''
}

/** O que impede o apelido de valer, em português, ou null se ele vale. */
export function problemaNoApelido(bruto: unknown): string | null {
  const apelido = limparApelido(bruto)
  if (apelido.length < APELIDO_MINIMO) return `O nome de piloto precisa de pelo menos ${APELIDO_MINIMO} caracteres.`
  if (apelido.length > APELIDO_MAXIMO) return `O nome de piloto tem no máximo ${APELIDO_MAXIMO} caracteres.`
  if (!PERMITIDO.test(apelido)) return 'Use letras, números, espaço, ponto, hífen ou sublinhado.'
  return null
}

/** A chave de unicidade: o apelido sem diferença de maiúsculas. */
export function chaveDoApelido(apelido: string) {
  return limparApelido(apelido).toLocaleLowerCase('pt-BR')
}

/** O apelido com um número no fim, sem passar do tamanho máximo: "Rafa" vira "Rafa2". */
export function apelidoComNumero(apelido: string, numero: number) {
  const sufixo = String(numero)
  return `${limparApelido(apelido).slice(0, APELIDO_MAXIMO - sufixo.length).trimEnd()}${sufixo}`
}

/**
 * Um apelido que vale, a partir do que houver: o do cadastro, ou a parte do
 * e-mail antes da arroba, para contas criadas fora do jogo (pelo painel do
 * Supabase, por exemplo).
 */
export function apelidoValidoDe(apelido: string | null, email: string | null) {
  const limpo = limparApelido(apelido)
  if (limpo && !problemaNoApelido(limpo)) return limpo
  const doEmail = limparApelido((email ?? '').split('@')[0].replace(/[^\p{L}\p{N} ._-]/gu, '')).replace(/^[ ._-]+/, '')
  const cortado = doEmail.slice(0, APELIDO_MAXIMO).trim()
  return cortado.length >= APELIDO_MINIMO && !problemaNoApelido(cortado) ? cortado : 'Piloto'
}
