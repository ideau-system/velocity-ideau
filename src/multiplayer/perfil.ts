import type { Socket } from 'socket.io-client'
import type { Medalha } from '../game/contrarrelogio'
import type { PainelRanqueado, Tier } from './ranqueada'

/**
 * O perfil do piloto no servidor do jogo.
 *
 * Quem entra numa conta manda o token da sessão pelo socket, e o servidor liga
 * a conexão ao perfil — o mesmo em qualquer aparelho. Convidado não tem
 * perfil: corre online e treina, mas não aparece nos quadros nem na
 * ranqueada. O `playerId` da sala continua por aba, como sempre: é o que
 * deixa testar vários pilotos em várias abas.
 */

export type PerfilPublico = { id: string; apelido: string }

export type ModoDaCorrida = 'casual' | 'ranqueada' | 'copa'

/** O perfil com as estatísticas, como o servidor o monta. */
export type PerfilDoPiloto = {
  id: string
  apelido: string
  desde: number
  online: {
    corridas: number
    vitorias: number
    podios: number
    abandonos: number
    aproveitamento: number | null
    posicaoMedia: number | null
    velocidadeMaxima: number
    batidas: number
  }
  porModo: Record<ModoDaCorrida, { corridas: number; vitorias: number; podios: number }>
  kmRodados: number
  ranqueada: PainelRanqueado
  temporadas: Array<{ temporada: string; pl: number; divisao: string; tier: Tier; pico: number; corridas: number; podios: number }>
  mundial: { tempo: number; posicao: number; dispositivo: 'teclado' | 'toque' | 'desconhecido' } | null
  contrarrelogio: { voltas: number; pistas: number; medalhas: Record<Medalha, number>; lideradas: number }
  copa: { ouro: number; prata: number; bronze: number }
  carroFavorito: { carro: string; corridas: number } | null
  recentes: Array<{
    modo: ModoDaCorrida
    instante: number
    posicao: number
    pilotos: number
    desfecho: 'chegou' | 'naoTerminou' | 'abandonou'
    tempo: number | null
    carro: string
    deltaPl: number | null
  }>
}

/** Quanto esperar o servidor responder antes de seguir sem ele. */
const ESPERA_MS = 4_000

type Resposta = { ok: boolean; error?: string } & Record<string, unknown>

/** Emite e espera a resposta do servidor, com prazo. Sem resposta, `{ ok: false }`. */
export function perguntar(socket: Socket, evento: string, dados?: unknown, esperaMs = ESPERA_MS): Promise<Resposta> {
  return new Promise((resolve) => {
    const prazo = setTimeout(() => resolve({ ok: false, error: 'O servidor não respondeu.' }), esperaMs)
    socket.emit(evento, dados, (resposta: Resposta) => {
      clearTimeout(prazo)
      resolve(resposta ?? { ok: false })
    })
  })
}

/**
 * Liga a conexão à conta: o servidor confere o token e devolve o perfil.
 * `recusada` separa a sessão que não vale mais do servidor que não respondeu.
 */
export async function entrarNaConta(
  socket: Socket,
  token: string,
): Promise<{ perfil: PerfilPublico } | { erro: string; recusada: boolean }> {
  const resposta = await perguntar(socket, 'conta:entrar', { token }, 8_000)
  if (resposta.ok && resposta.perfil) return { perfil: resposta.perfil as PerfilPublico }
  return { erro: resposta.error ?? 'Não foi possível entrar na conta.', recusada: resposta.codigo === 'sessao-invalida' }
}

/** A conexão volta a ser de convidado. */
export async function sairDaConta(socket: Socket) {
  await perguntar(socket, 'conta:sair')
}

/** Se o nome de piloto está livre, e por que não, quando não está. Null sem servidor. */
export async function apelidoLivre(socket: Socket, apelido: string): Promise<{ livre: boolean; motivo?: string } | null> {
  const resposta = await perguntar(socket, 'conta:apelido-livre', { apelido })
  return resposta.ok ? { livre: Boolean(resposta.livre), motivo: resposta.motivo as string | undefined } : null
}

/** O perfil com as estatísticas: o próprio, sem id, ou o de outro piloto. */
export async function verPerfil(socket: Socket, id?: string): Promise<{ perfil: PerfilDoPiloto } | { erro: string }> {
  const resposta = await perguntar(socket, 'perfil:ver', id ? { id } : undefined, 8_000)
  if (resposta.ok && resposta.perfil) return { perfil: resposta.perfil as PerfilDoPiloto }
  return { erro: resposta.error ?? 'Não foi possível ler o perfil.' }
}
