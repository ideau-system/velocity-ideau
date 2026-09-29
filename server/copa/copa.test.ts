import { describe, expect, it } from 'vitest'
import { DIFICULDADE_OFICIAL, diaDe, sementeDoDia } from '../../src/game/contrarrelogio.js'
import { RepositorioEmMemoria } from '../dados/memoria.js'
import type { RaceOutcome } from '../rooms.js'
import { aberturaAs, aberturaDoDia, Copa, eliminadosDaRodada, tamanhosDasDivisoes, type VoltaDaClassificacao } from './copa.js'

describe('horário da copa', () => {
  it('abre às 21h de Brasília, que é a meia-noite UTC do dia seguinte', () => {
    expect(new Date(aberturaDoDia('2026-09-23')).toISOString()).toBe('2026-09-24T00:00:00.000Z')
    // E a abertura cai no mesmo dia de Brasília que a nomeia.
    expect(diaDe(new Date(aberturaDoDia('2026-12-31')))).toBe('2026-12-31')
  })

  it('o horário se configura em Brasília, e um horário inválido volta às 21h', () => {
    expect(new Date(aberturaAs('19:30')('2026-09-23')).toISOString()).toBe('2026-09-23T22:30:00.000Z')
    expect(new Date(aberturaAs('23:15')('2026-09-23')).toISOString()).toBe('2026-09-24T02:15:00.000Z')
    expect(aberturaAs('25:00')('2026-09-23')).toBe(aberturaDoDia('2026-09-23'))
    expect(aberturaAs('noite')('2026-09-23')).toBe(aberturaDoDia('2026-09-23'))
  })
})

describe('divisões', () => {
  it('reparte por igual em salas de até seis, e ninguém corre sozinho', () => {
    expect(tamanhosDasDivisoes(0)).toEqual([])
    expect(tamanhosDasDivisoes(1)).toEqual([])
    expect(tamanhosDasDivisoes(2)).toEqual([2])
    expect(tamanhosDasDivisoes(6)).toEqual([6])
    expect(tamanhosDasDivisoes(7)).toEqual([4, 3])
    expect(tamanhosDasDivisoes(13)).toEqual([5, 4, 4])
    for (let n = 2; n <= 60; n += 1) {
      const tamanhos = tamanhosDasDivisoes(n)
      expect(tamanhos.reduce((soma, t) => soma + t, 0)).toBe(n)
      expect(Math.max(...tamanhos)).toBeLessThanOrEqual(6)
      expect(Math.min(...tamanhos)).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('eliminação', () => {
  const vivos = ['a', 'b', 'c', 'd'].map((playerId) => ({ playerId }))
  const entrada = (playerId: string, outcome: 'finished' | 'unfinished' | 'abandoned', time: number | null = null) => ({
    playerId,
    outcome,
    time,
  })

  it('sem abandono, sai só o último a chegar', () => {
    const { eliminados, ordem } = eliminadosDaRodada(
      [entrada('a', 'finished', 71), entrada('b', 'finished', 70), entrada('c', 'finished', 73), entrada('d', 'finished', 72)],
      vivos,
    )
    expect(ordem).toEqual(['b', 'a', 'd', 'c'])
    expect(eliminados).toEqual(['c'])
  })

  it('quem não completou fica atrás de quem chegou, e o empate sai pela classificação', () => {
    const { eliminados, ordem } = eliminadosDaRodada(
      [entrada('a', 'unfinished'), entrada('b', 'finished', 70), entrada('c', 'unfinished'), entrada('d', 'finished', 75)],
      vivos,
    )
    expect(ordem).toEqual(['b', 'd', 'a', 'c'])
    expect(eliminados).toEqual(['c'])
  })

  it('quem abandona sai de uma vez, todos juntos — e quem sumiu da sala também abandonou', () => {
    const { eliminados, desistentes } = eliminadosDaRodada(
      [entrada('a', 'finished', 80), entrada('b', 'abandoned'), entrada('c', 'finished', 70)],
      vivos,
    )
    expect(eliminados).toEqual(['b', 'd'])
    expect([...desistentes].sort()).toEqual(['b', 'd'])
  })
})

/** Um relógio de mentira, para a copa andar sem esperar dez minutos. */
function relogio(inicio: number) {
  let agora = inicio
  return { agora: () => agora, avancar: (ms: number) => (agora += ms), em: (instante: number) => (agora = instante) }
}

const HOJE = diaDe(new Date(aberturaDoDia('2026-09-23') - 3_600_000))
const SEED = sementeDoDia(HOJE)
const ABERTURA = aberturaDoDia(HOJE)

function volta(tempo: number, extra: Partial<VoltaDaClassificacao> = {}): VoltaDaClassificacao {
  return { largada: ABERTURA + 60_000, tempo, seed: SEED, dificuldade: DIFICULDADE_OFICIAL, modificador: null, estado: 'valido', ...extra }
}

function resultado(code: string, entradas: Array<[string, 'finished' | 'unfinished' | 'abandoned', number | null]>): RaceOutcome {
  return {
    code,
    winnerId: null,
    reason: 'time',
    gap: null,
    entries: entradas.map(([playerId, outcome, time]) => ({ playerId, name: playerId, time, topSpeed: 0, collisions: 0, outcome })),
  }
}

async function copaComInscritos(nomes: string[]) {
  const repositorio = new RepositorioEmMemoria()
  const tempo = relogio(ABERTURA - 3_600_000)
  const copa = new Copa(repositorio, { agora: tempo.agora })
  const perfis = await Promise.all(nomes.map((nome) => repositorio.perfilDaConta(crypto.randomUUID(), nome)))
  for (const perfil of perfis) {
    expect(copa.inscrever({ perfilId: perfil.id, playerId: `aba-${perfil.apelido}`, socketId: `s-${perfil.apelido}`, nome: perfil.apelido, carro: 'senna' }).ok).toBe(true)
  }
  return { repositorio, tempo, copa, perfis }
}

describe('a copa do dia', () => {
  it('só vale a volta da classificação: inscrito, pista e nível do dia, largada na janela, aceita pelo servidor', async () => {
    const { copa, tempo, perfis } = await copaComInscritos(['Ana'])
    const [ana] = perfis
    expect(copa.fase()).toBe('inscricoes')
    expect(copa.registrarVolta(ana.id, volta(70, { largada: ABERTURA - 1 }))).toBeNull()

    tempo.em(ABERTURA + 120_000)
    expect(copa.fase()).toBe('classificacao')
    expect(copa.registrarVolta(ana.id, volta(70, { seed: SEED + 1 }))).toBeNull()
    expect(copa.registrarVolta(ana.id, volta(70, { dificuldade: 'normal' }))).toBeNull()
    expect(copa.registrarVolta(ana.id, volta(70, { modificador: 'chuva' }))).toBeNull()
    expect(copa.registrarVolta(ana.id, volta(70, { estado: 'pendente' }))).toBeNull()
    expect(copa.registrarVolta('ninguem', volta(70))).toBeNull()
    expect(copa.registrarVolta(ana.id, volta(72))).toEqual({ posicao: 1 })
    // Fica a melhor.
    copa.registrarVolta(ana.id, volta(71))
    copa.registrarVolta(ana.id, volta(74))
    expect((await copa.situacao(ana.id)).voce).toEqual({ tempo: 71, posicao: 1 })

    // A volta que largou antes do fim ainda chega na folga; a que largou depois, não.
    tempo.em(ABERTURA + 10 * 60_000 + 30_000)
    expect(copa.fase()).toBe('apuracao')
    expect(copa.registrarVolta(ana.id, volta(69, { largada: ABERTURA + 10 * 60_000 - 1 }))).toEqual({ posicao: 1 })
    expect(copa.registrarVolta(ana.id, volta(60, { largada: ABERTURA + 10 * 60_000 }))).toBeNull()
    expect(copa.inscrever({ perfilId: 'novo', playerId: 'x', socketId: 'x', nome: 'X', carro: 'senna' }).ok).toBe(false)
  })

  it('monta as divisões pela classificação, sem quem caiu, elimina um por rodada e entrega os troféus', async () => {
    const nomes = ['Ana', 'Beto', 'Caio', 'Duda', 'Eva', 'Fabi', 'Gil', 'Hugo', 'Iara']
    const { copa, tempo, perfis, repositorio } = await copaComInscritos(nomes)
    const [ana, beto, caio, duda, , fabi, , hugo, iara] = perfis
    tempo.em(ABERTURA + 60_000)
    // Ana é a mais rápida, Iara a mais lenta; Gil não marcou tempo.
    perfis.forEach((perfil, i) => perfil.apelido !== 'Gil' && copa.registrarVolta(perfil.id, volta(70 + i)))
    expect(copa.prontaParaApurar()).toBe(false)

    tempo.em(ABERTURA + 12 * 60_000)
    expect(copa.prontaParaApurar()).toBe(true)
    // Eva caiu antes das eliminatórias: sobram sete, que viram 4 e 3.
    const divisoes = copa.apurar((socketId) => socketId !== 's-Eva')
    expect(divisoes).toEqual([1, 2])
    expect(copa.vivosDa(1).map((piloto) => piloto.nome)).toEqual(['Ana', 'Beto', 'Caio', 'Duda'])
    expect(copa.vivosDa(2).map((piloto) => piloto.nome)).toEqual(['Fabi', 'Hugo', 'Iara'])
    expect(copa.fase()).toBe('eliminatorias')

    // Rodada 1 da divisão 1: Duda abandona e sai, mesmo com Caio chegando por último.
    expect(copa.registrarSala(1, 'SALA1')).toBe(1)
    expect(copa.divisaoDaSala('SALA1')).toBe(1)
    const primeira = await copa.resolverRodada(
      'SALA1',
      resultado('SALA1', [['aba-Ana', 'finished', 71], ['aba-Beto', 'finished', 70], ['aba-Caio', 'finished', 75], ['aba-Duda', 'abandoned', null]]),
    )
    expect(primeira!.eliminados.map(({ nome, posicao, desistiu }) => [nome, posicao, desistiu])).toEqual([['Duda', 4, true]])
    expect(primeira!.seguem.map((piloto) => piloto.nome)).toEqual(['Ana', 'Beto', 'Caio'])
    expect(copa.eDaCopa('SALA1')).toBe(false)

    // Rodada 2: agora Caio, o último, sai.
    copa.registrarSala(1, 'SALA2')
    const segunda = await copa.resolverRodada('SALA2', resultado('SALA2', [['aba-Ana', 'finished', 71], ['aba-Beto', 'finished', 70], ['aba-Caio', 'finished', 75]]))
    expect(segunda!.eliminados.map(({ nome, posicao }) => [nome, posicao])).toEqual([['Caio', 3]])
    expect(segunda!.encerrada).toBe(false)

    // A final: Beto chega na frente e é o campeão.
    expect(copa.registrarSala(1, 'SALA3')).toBe(3)
    const final = await copa.resolverRodada('SALA3', resultado('SALA3', [['aba-Beto', 'finished', 70], ['aba-Ana', 'finished', 70.5]]))
    expect(final!.campeao?.nome).toBe('Beto')
    expect(final!.eliminados.map(({ nome, posicao }) => [nome, posicao])).toEqual([['Ana', 2]])
    expect(final!.encerrada).toBe(true)

    const trofeu = async (perfilId: string) =>
      (await repositorio.trofeusDe(perfilId)).map(({ posicao, divisao, participantes }) => ({ posicao, divisao, participantes }))
    expect(await trofeu(beto.id)).toEqual([{ posicao: 1, divisao: 1, participantes: 4 }])
    expect(await trofeu(ana.id)).toEqual([{ posicao: 2, divisao: 1, participantes: 4 }])
    expect(await trofeu(caio.id)).toEqual([{ posicao: 3, divisao: 1, participantes: 4 }])
    // Quem abandona não leva troféu.
    expect(await trofeu(duda.id)).toEqual([])

    // Na divisão 2, Hugo pede para sair e Iara cai entre as rodadas: Fabi ganha sem correr.
    copa.sair(hugo.id)
    const { largam, saem } = copa.quemLarga(2, (socketId) => socketId !== 's-Iara')
    expect(largam.map((piloto) => piloto.nome)).toEqual(['Fabi'])
    expect(saem.map((piloto) => piloto.nome)).toEqual(['Hugo', 'Iara'])
    const desistencia = await copa.desistiram(2, saem.map((piloto) => piloto.playerId))
    expect(desistencia!.campeao?.nome).toBe('Fabi')
    expect(desistencia!.eliminados.map(({ nome, posicao }) => [nome, posicao])).toEqual([['Hugo', 2], ['Iara', 3]])
    expect(await trofeu(fabi.id)).toEqual([{ posicao: 1, divisao: 2, participantes: 3 }])
    expect(await trofeu(iara.id)).toEqual([])
    expect(copa.fase()).toBe('encerrada')

    const situacao = await copa.situacao(beto.id)
    expect(situacao.minhaDivisao).toMatchObject({ numero: 1, participantes: 4, posicao: 1, campeao: true })
    expect(situacao.podios.map((podio) => podio.pilotos.map((piloto) => piloto.apelido))).toEqual([
      ['Beto', 'Ana', 'Caio'],
      ['Fabi', 'Hugo', 'Iara'],
    ])
    expect(situacao.trofeus).toHaveLength(1)
  })

  it('com menos de dois classificados, encerra sem eliminatórias', async () => {
    const { copa, tempo, perfis } = await copaComInscritos(['Ana', 'Beto'])
    tempo.em(ABERTURA + 60_000)
    copa.registrarVolta(perfis[0].id, volta(70))
    tempo.em(ABERTURA + 12 * 60_000)
    expect(copa.apurar(() => true)).toEqual([])
    expect(copa.fase()).toBe('encerrada')
    expect((await copa.situacao(perfis[0].id)).motivo).toMatch(/Poucos pilotos/)
  })

  it('troca de edição à meia-noite de Brasília, com inscrições zeradas', async () => {
    const { copa, tempo, perfis } = await copaComInscritos(['Ana'])
    expect((await copa.situacao(perfis[0].id)).inscrito).toBe(true)
    tempo.em(ABERTURA + 4 * 3_600_000)
    const amanha = await copa.situacao(perfis[0].id)
    expect(amanha.dia).not.toBe(HOJE)
    expect(amanha.inscrito).toBe(false)
    expect(amanha.fase).toBe('inscricoes')
  })
})
