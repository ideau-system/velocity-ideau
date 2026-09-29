import type { Socket } from 'socket.io-client'
import type { Difficulty } from '../game/rules'
import { perguntar } from './perfil'

/**
 * A Copa do Dia: às 21h, dez minutos de classificação na Pista do Dia, depois
 * divisões de até seis pelo tempo, com o último de cada corrida eliminado.
 */
export type FaseDaCopa = 'inscricoes' | 'classificacao' | 'apuracao' | 'eliminatorias' | 'encerrada'

export type Trofeu = { perfilId: string; dia: string; divisao: number; posicao: number; participantes: number }

/** A copa de hoje, do ponto de vista deste piloto. */
export type SituacaoDaCopa = {
  dia: string
  fase: FaseDaCopa
  abertura: number
  fechamento: number
  eliminatorias: number
  seed: number
  dificuldade: Difficulty
  inscritos: number
  inscrito: boolean
  classificacao: Array<{ posicao: number; apelido: string; tempo: number; voce: boolean }>
  voce: { tempo: number | null; posicao: number | null } | null
  minhaDivisao: {
    numero: number
    participantes: number
    rodada: number
    restantes: number
    posicao: number | null
    campeao: boolean
  } | null
  podios: Array<{ divisao: number; participantes: number; pilotos: Array<{ apelido: string; posicao: number }> }>
  motivo: string | null
  trofeus: Trofeu[]
}

/** O que uma rodada decidiu: quem saiu, quem segue e, no fim, o campeão. */
export type RodadaDaCopa = {
  code: string | null
  divisao: number
  rodada: number
  eliminados: Array<{ playerId: string; nome: string; posicao: number; desistiu: boolean }>
  seguem: Array<{ playerId: string; nome: string }>
  campeao: { playerId: string; nome: string; posicao: number } | null
  /** Quando larga a próxima rodada, no relógio do servidor. */
  proximaEm: number | null
}

export async function buscarCopa(socket: Socket): Promise<SituacaoDaCopa | null> {
  if (!socket.connected) return null
  const resposta = await perguntar(socket, 'copa:painel')
  return resposta.ok ? (resposta.copa as SituacaoDaCopa) : null
}

/** Inscreve na copa com o carro escolhido. O nome é o da conta: o servidor já sabe. */
export async function inscreverNaCopa(socket: Socket, piloto: { playerId: string; carro: string }) {
  const resposta = await perguntar(socket, 'copa:inscrever', piloto)
  return resposta.ok ? { ok: true as const } : { ok: false as const, motivo: resposta.error ?? 'Não foi possível se inscrever.' }
}

export async function sairDaCopa(socket: Socket) {
  await perguntar(socket, 'copa:sair')
}

/** Ouro, prata e bronze da divisão. */
export const TACA: Record<number, string> = { 1: 'CAMPEÃO', 2: 'VICE', 3: 'TERCEIRO' }
