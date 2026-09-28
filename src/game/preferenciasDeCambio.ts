/**
 * O câmbio escolhido, guardado entre corridas e entre recargas da página, do
 * mesmo jeito que as preferências de som.
 *
 * Quem ainda não escolheu ganha o do aparelho: no teclado, o manual — as
 * borboletas estão à mão, em E e Q, e é nele que a troca perfeita rende
 * turbo —; no toque, o automático, porque os dois polegares já estão ocupados
 * com a direção, o boost e o freio.
 */
const CAMBIO_KEY = 'ghost-racer-cambio'

export type Cambio = 'manual' | 'automatico'

/** O aparelho é de toque: o dedo é o ponteiro principal. */
export function aparelhoDeToque() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function ler(): Cambio | null {
  try {
    const guardado = sessionStorage.getItem(CAMBIO_KEY)
    return guardado === 'manual' || guardado === 'automatico' ? guardado : null
  } catch {
    // Navegação privada pode recusar o armazenamento; vale o do aparelho.
    return null
  }
}

let escolhido = ler()

export function lerCambio(): Cambio {
  return escolhido ?? (aparelhoDeToque() ? 'automatico' : 'manual')
}

export function definirCambio(cambio: Cambio) {
  escolhido = cambio
  try {
    sessionStorage.setItem(CAMBIO_KEY, cambio)
  } catch {
    // Sem armazenamento só se perde a lembrança entre recargas.
  }
}
