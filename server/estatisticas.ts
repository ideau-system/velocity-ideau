import { TRACK_LENGTH } from '../src/game/track.js'
import {
  MODOS_DA_CORRIDA,
  type Dispositivo,
  type EstatisticasDoPerfil,
  type LinhaDoQuadro,
  type ModoDaCorrida,
  type Perfil,
  type Trofeu,
} from './dados/tipos.js'
import { divisaoDe, nomeDaDivisao, type Desfecho, type Tier } from './ranqueada/rating.js'
import type { PainelRanqueado } from './ranqueada/servico.js'

/** Quantas corridas recentes o perfil mostra. */
export const CORRIDAS_RECENTES = 10

/**
 * O perfil de um piloto como a tela o mostra — o próprio ou o de outro.
 *
 * Só números do jogo: nada de e-mail, que é da conta e fica no aparelho de
 * quem é dono dela.
 */
export type PerfilDoPiloto = {
  id: string
  apelido: string
  /** Quando a conta entrou no jogo pela primeira vez. */
  desde: number
  /** As corridas online, de todos os modos somados. */
  online: {
    corridas: number
    vitorias: number
    podios: number
    abandonos: number
    /** Vitórias sobre corridas, de 0 a 1; null sem corrida. */
    aproveitamento: number | null
    posicaoMedia: number | null
    velocidadeMaxima: number
    batidas: number
  }
  porModo: Record<ModoDaCorrida, { corridas: number; vitorias: number; podios: number }>
  /** Voltas completas, online e no contrarrelógio, em quilômetros. */
  kmRodados: number
  ranqueada: PainelRanqueado
  /** As temporadas anteriores, da mais nova: onde o piloto terminou e até onde chegou. */
  temporadas: Array<{ temporada: string; pl: number; divisao: string; tier: Tier; pico: number; corridas: number; podios: number }>
  /** A linha do piloto no ranking mundial do Circuito Oficial. */
  mundial: { tempo: number; posicao: number; dispositivo: Dispositivo } | null
  contrarrelogio: EstatisticasDoPerfil['contrarrelogio']
  copa: { ouro: number; prata: number; bronze: number }
  carroFavorito: { carro: string; corridas: number } | null
  recentes: Array<{
    modo: ModoDaCorrida
    instante: number
    posicao: number
    pilotos: number
    desfecho: Desfecho
    tempo: number | null
    carro: string
    deltaPl: number | null
  }>
}

/** Junta o que o banco somou com a ranqueada, o ranking mundial e os troféus. */
export function montarPerfil(entrada: {
  perfil: Perfil
  estatisticas: EstatisticasDoPerfil
  ranqueada: PainelRanqueado
  mundial: LinhaDoQuadro | null
  trofeus: readonly Trofeu[]
}): PerfilDoPiloto {
  const { perfil, estatisticas, ranqueada, mundial, trofeus } = entrada
  const modos = MODOS_DA_CORRIDA.map((modo) => estatisticas.porModo[modo])
  const soma = (campo: keyof (typeof modos)[number]) => modos.reduce((total, resumo) => total + resumo[campo], 0)
  const corridas = soma('corridas')
  const chegadas = soma('chegadas')
  const voltasCompletas = chegadas + estatisticas.contrarrelogio.voltas
  return {
    id: perfil.id,
    apelido: perfil.apelido,
    desde: perfil.criadoEm,
    online: {
      corridas,
      vitorias: soma('vitorias'),
      podios: soma('podios'),
      abandonos: soma('abandonos'),
      aproveitamento: corridas > 0 ? soma('vitorias') / corridas : null,
      posicaoMedia: corridas > 0 ? soma('somaDasPosicoes') / corridas : null,
      velocidadeMaxima: Math.round(estatisticas.velocidadeMaxima),
      batidas: estatisticas.batidas,
    },
    porModo: Object.fromEntries(
      MODOS_DA_CORRIDA.map((modo) => {
        const { corridas: n, vitorias, podios } = estatisticas.porModo[modo]
        return [modo, { corridas: n, vitorias, podios }]
      }),
    ) as PerfilDoPiloto['porModo'],
    kmRodados: Math.round((voltasCompletas * TRACK_LENGTH) / 100) / 10,
    ranqueada,
    temporadas: estatisticas.temporadas
      .filter(({ temporada }) => temporada !== ranqueada.temporada)
      .map(({ temporada, estado }) => ({
        temporada,
        pl: estado.pl,
        divisao: estado.colocacao > 0 ? 'Sem colocação' : nomeDaDivisao(estado.pl),
        tier: divisaoDe(estado.pico).tier,
        pico: estado.pico,
        corridas: estado.corridas,
        podios: estado.podios,
      })),
    mundial: mundial ? { tempo: mundial.tempo, posicao: mundial.posicao, dispositivo: mundial.dispositivo } : null,
    contrarrelogio: estatisticas.contrarrelogio,
    copa: {
      ouro: trofeus.filter((trofeu) => trofeu.posicao === 1).length,
      prata: trofeus.filter((trofeu) => trofeu.posicao === 2).length,
      bronze: trofeus.filter((trofeu) => trofeu.posicao === 3).length,
    },
    carroFavorito: estatisticas.carroFavorito,
    recentes: estatisticas.recentes.map((corrida) => ({
      modo: corrida.modo,
      instante: corrida.largada,
      posicao: corrida.posicao,
      pilotos: corrida.pilotos,
      desfecho: corrida.desfecho,
      tempo: corrida.tempo,
      carro: corrida.carro,
      deltaPl: corrida.deltaPl,
    })),
  }
}
