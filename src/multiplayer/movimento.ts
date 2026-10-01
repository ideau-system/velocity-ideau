import type { Socket } from 'socket.io-client'
import { perguntar } from './perfil'

/** O movimento do jogo agora, como o servidor o conta. */
export type MovimentoDoJogo = {
  /** Aparelhos conectados ao jogo. */
  online: number
  /** Pilotos na fila da ranqueada. */
  naFila: number
  /** Pilotos numa largada ou correndo. */
  correndo: number
  /** Quem assiste das arquibancadas. */
  assistindo: number
  /** A ida e volta da pergunta, em ms: é o ping que o menu mostra. */
  latencia: number
}

/**
 * Pergunta ao servidor quantos estão no jogo, na fila e na pista. Aberto a
 * convidados: é o que diz se vale esperar na fila ou chamar os amigos.
 */
export async function buscarMovimento(socket: Socket): Promise<MovimentoDoJogo | null> {
  if (!socket.connected) return null
  const inicio = performance.now()
  const resposta = await perguntar(socket, 'jogo:movimento')
  if (!resposta.ok) return null
  return {
    online: Number(resposta.online) || 0,
    naFila: Number(resposta.naFila) || 0,
    correndo: Number(resposta.correndo) || 0,
    assistindo: Number(resposta.assistindo) || 0,
    latencia: Math.round(performance.now() - inicio),
  }
}
