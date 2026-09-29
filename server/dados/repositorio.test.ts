import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GravacaoDeVolta } from '../../src/game/gravador.js'
import { estadoInicial, type EstadoRanqueado } from '../ranqueada/rating.js'
import { RepositorioEmMemoria } from './memoria.js'
import { RepositorioPostgres } from './postgres.js'
import type { CorridaRanqueada, NovoTempo, Participacao, Repositorio } from './tipos.js'

/**
 * O contrato do repositório.
 *
 * A mesma bateria roda contra a memória, sempre, e contra o Postgres quando
 * `TEST_DATABASE_URL` aponta para um banco de teste — que é apagado a cada
 * caso. Assim as duas implementações não divergem sem ninguém ver.
 */

const VOLTA: GravacaoDeVolta = { intervaloMs: 100, progresso: [0, 480, 48_000], lateral: [0, 10, 0], velocidade: [0, 200, 300] }

function tempo(perfilId: string, segundos: number, extra: Partial<NovoTempo> = {}): NovoTempo {
  return {
    perfilId,
    dia: '2026-09-23',
    seed: 123,
    dificuldade: 'dificil',
    tempo: segundos,
    dispositivo: 'teclado',
    estado: 'valido',
    medalha: null,
    gravacao: VOLTA,
    ...extra,
  }
}

function corrida(perfilId: string, extra: Partial<Participacao> = {}): Participacao {
  return {
    perfilId,
    sala: 'ABCDE',
    largada: INSTANTE,
    modo: 'casual',
    seed: 42,
    dificuldade: 'normal',
    pilotos: 4,
    posicao: 1,
    desfecho: 'chegou',
    tempo: 70,
    velocidadeMaxima: 300,
    batidas: 1,
    carro: 'senna',
    deltaPl: null,
    ...extra,
  }
}

const INSTANTE = Date.parse('2026-09-23T18:00:00Z')

function estado(pl: number, colocacao: number): EstadoRanqueado {
  return { ...estadoInicial(), mmr: { mu: 20 + pl / 100, sigma: 4 }, pl, colocacao, corridas: 7, ultimaCorrida: INSTANTE }
}

function ranqueada(perfis: string[], depois: EstadoRanqueado[]): CorridaRanqueada {
  return {
    id: crypto.randomUUID(),
    temporada: '2026.2',
    sala: 'ABCDE',
    seed: 42,
    instante: INSTANTE,
    resultados: perfis.map((perfilId, i) => ({
      perfilId,
      posto: i + 1,
      desfecho: 'chegou',
      tempo: 60 + i,
      antes: estadoInicial(),
      depois: depois[i],
    })),
  }
}

function contrato(nome: string, criar: () => Promise<Repositorio>) {
  describe(`repositório: ${nome}`, () => {
    let repo: Repositorio
    beforeEach(async () => {
      repo = await criar()
    })
    // Cada caso fecha o que abriu: o banco de teste não acumula conexões.
    afterEach(async () => {
      await repo.fechar()
    })

    it('o perfil da conta nasce na primeira entrada, com o apelido do cadastro', async () => {
      const conta = crypto.randomUUID()
      expect(await repo.apelidoLivre('Ana')).toBe(true)
      const perfil = await repo.perfilDaConta(conta, 'Ana')
      expect(perfil).toMatchObject({ id: conta, apelido: 'Ana' })
      // A segunda entrada acha o mesmo perfil, mesmo com outro apelido no token.
      expect(await repo.perfilDaConta(conta, 'Outro Nome')).toEqual(perfil)
      expect(await repo.perfil(conta)).toEqual(perfil)
      expect(await repo.perfil('nao-e-uuid')).toBeNull()
    })

    it('o apelido é único sem diferenciar maiúsculas, e quem chega depois ganha um número', async () => {
      await repo.perfilDaConta(crypto.randomUUID(), 'Rafa')
      expect(await repo.apelidoLivre('rafa')).toBe(false)
      expect(await repo.apelidoLivre('  RAFA ')).toBe(false)
      expect(await repo.apelidoLivre('Rafael')).toBe(true)
      const outro = await repo.perfilDaConta(crypto.randomUUID(), 'RAFA')
      expect(outro.apelido).toBe('RAFA2')
      const longo = await repo.perfilDaConta(crypto.randomUUID(), 'Dezesseis Letras')
      const mesmoLongo = await repo.perfilDaConta(crypto.randomUUID(), 'dezesseis letras')
      expect(longo.apelido).toBe('Dezesseis Letras')
      expect(mesmoLongo.apelido).toBe('dezesseis letra2')
    })

    it('o quadro traz o melhor tempo válido de cada piloto, do mais rápido', async () => {
      const ana = await repo.perfilDaConta(crypto.randomUUID(), 'Ana')
      const beto = await repo.perfilDaConta(crypto.randomUUID(), 'Beto')
      await repo.registrarTempo(tempo(ana.id, 64))
      await repo.registrarTempo(tempo(ana.id, 62.5))
      await repo.registrarTempo(tempo(beto.id, 63))
      // Pendente não entra; outra semente e outro nível também não.
      await repo.registrarTempo(tempo(beto.id, 50, { estado: 'pendente' }))
      await repo.registrarTempo(tempo(beto.id, 40, { seed: 999 }))
      await repo.registrarTempo(tempo(beto.id, 41, { dificuldade: 'normal' }))

      const quadro = await repo.quadro(123, 'dificil', 10)
      expect(quadro.map((linha) => [linha.posicao, linha.apelido, linha.tempo])).toEqual([
        [1, 'Ana', 62.5],
        [2, 'Beto', 63],
      ])
      expect(quadro[0].dia).toBe('2026-09-23')
      expect((await repo.linhaDe(123, 'dificil', beto.id))?.posicao).toBe(2)
      expect(await repo.linhaDe(123, 'dificil', 'ninguem')).toBeNull()
      expect(await repo.quadro(123, 'dificil', 1)).toHaveLength(1)
    })

    it('guarda a volta de cada tempo, para virar fantasma', async () => {
      const ana = await repo.perfilDaConta(crypto.randomUUID(), 'Ana')
      const registrado = await repo.registrarTempo(tempo(ana.id, 61))
      expect(registrado.estado).toBe('valido')
      expect(await repo.gravacao(registrado.id)).toEqual(VOLTA)
      expect(await repo.gravacao('nao-existe')).toBeNull()
    })

    it('a corrida ranqueada guarda o estado novo de cada piloto, uma vez só', async () => {
      const ana = await repo.perfilDaConta(crypto.randomUUID(), 'Ana')
      const beto = await repo.perfilDaConta(crypto.randomUUID(), 'Beto')
      const corrida = ranqueada([ana.id, beto.id], [estado(820, 0), estado(610, 0)])
      await repo.registrarCorridaRanqueada(corrida)
      await repo.registrarCorridaRanqueada({ ...corrida, resultados: corrida.resultados.map((r) => ({ ...r, depois: estado(5, 0) })) })
      const deAna = await repo.estadoRanqueado(ana.id, '2026.2')
      expect(deAna?.pl).toBe(820)
      expect(deAna?.mmr.mu).toBeCloseTo(28.2, 9)
      expect(deAna?.ultimaCorrida).toBe(corrida.instante)
      expect(await repo.estadoRanqueado(ana.id, '2026.1')).toBeNull()
    })

    it('a escada só tem quem terminou a colocação, dos PL mais altos para os mais baixos', async () => {
      const ana = await repo.perfilDaConta(crypto.randomUUID(), 'Ana')
      const beto = await repo.perfilDaConta(crypto.randomUUID(), 'Beto')
      const caio = await repo.perfilDaConta(crypto.randomUUID(), 'Caio')
      await repo.registrarCorridaRanqueada(
        ranqueada([ana.id, beto.id, caio.id], [estado(610, 0), estado(820, 0), estado(0, 2)]),
      )
      const escada = await repo.escada('2026.2', 10)
      expect(escada.map((linha) => [linha.posicao, linha.apelido, linha.estado.pl])).toEqual([
        [1, 'Beto', 820],
        [2, 'Ana', 610],
      ])
      expect(await repo.posicaoNaEscada(ana.id, '2026.2')).toBe(2)
      expect(await repo.posicaoNaEscada(caio.id, '2026.2')).toBeNull()
    })

    it('a temporada anterior mais recente é a base do reset suave', async () => {
      const ana = await repo.perfilDaConta(crypto.randomUUID(), 'Ana')
      const beto = await repo.perfilDaConta(crypto.randomUUID(), 'Beto')
      await repo.registrarCorridaRanqueada({ ...ranqueada([ana.id, beto.id], [estado(300, 0), estado(0, 0)]), temporada: '2025.2' })
      await repo.registrarCorridaRanqueada({ ...ranqueada([ana.id, beto.id], [estado(900, 0), estado(0, 0)]), temporada: '2026.1' })
      expect((await repo.estadoAnterior(ana.id, '2026.2'))?.pl).toBe(900)
      expect((await repo.estadoAnterior(ana.id, '2026.1'))?.pl).toBe(300)
      expect(await repo.estadoAnterior(ana.id, '2025.2')).toBeNull()
    })

    it('conta as corridas em que o mesmo grupo correu junto', async () => {
      const [ana, beto, caio, duda] = await Promise.all(['Ana', 'Beto', 'Caio', 'Duda'].map((nome) => repo.perfilDaConta(crypto.randomUUID(), nome)))
      const tres = [ana.id, beto.id, caio.id]
      await repo.registrarCorridaRanqueada(ranqueada(tres, tres.map(() => estado(700, 0))))
      await repo.registrarCorridaRanqueada(ranqueada(tres, tres.map(() => estado(700, 0))))
      await repo.registrarCorridaRanqueada(ranqueada([ana.id, duda.id], [estado(700, 0), estado(700, 0)]))
      expect(await repo.corridasJuntos(tres, INSTANTE - 60_000, 3)).toBe(2)
      expect(await repo.corridasJuntos([...tres, duda.id], INSTANTE - 60_000, 2)).toBe(3)
      expect(await repo.corridasJuntos(tres, INSTANTE + 60_000, 3)).toBe(0)
    })

    it('guarda voltas ranqueadas e devolve a mais nova de cada piloto em cada pista, sem as de quem procura', async () => {
      const [ana, beto, caio] = await Promise.all(['Ana', 'Beto', 'Caio'].map((nome) => repo.perfilDaConta(crypto.randomUUID(), nome)))
      const volta = (perfilId: string, seed: number, tempo: number) => ({
        perfilId,
        seed,
        dificuldade: 'dificil' as const,
        tempo,
        mmr: { mu: 27, sigma: 3 },
        carro: 'senna',
        gravacao: VOLTA,
      })
      await repo.registrarVoltaRanqueada(volta(beto.id, 42, 70))
      await repo.registrarVoltaRanqueada(volta(beto.id, 42, 65))
      await repo.registrarVoltaRanqueada(volta(caio.id, 42, 68))
      await repo.registrarVoltaRanqueada(volta(ana.id, 42, 60))
      await repo.registrarVoltaRanqueada({ ...volta(caio.id, 42, 50), dificuldade: 'normal' })
      const achadas = await repo.voltasRanqueadas('dificil', 0, ana.id, 10)
      expect(achadas.map((achada) => achada.apelido).sort()).toEqual(['Beto', 'Caio'])
      expect(achadas.every((achada) => achada.seed === 42 && achada.gravacao.progresso.length === 3)).toBe(true)
      expect(achadas.find((achada) => achada.apelido === 'Beto')?.mmr).toEqual({ mu: 27, sigma: 3 })
      expect(await repo.voltasRanqueadas('dificil', Date.now() + 86_400_000, ana.id, 10)).toEqual([])
    })

    it('guarda os troféus da copa, do dia mais recente, e só os do piloto', async () => {
      const [ana, beto] = await Promise.all(['Ana', 'Beto'].map((nome) => repo.perfilDaConta(crypto.randomUUID(), nome)))
      await repo.registrarTrofeu({ perfilId: ana.id, dia: '2026-09-22', divisao: 2, posicao: 3, participantes: 5 })
      await repo.registrarTrofeu({ perfilId: ana.id, dia: '2026-09-23', divisao: 1, posicao: 1, participantes: 6 })
      await repo.registrarTrofeu({ perfilId: beto.id, dia: '2026-09-23', divisao: 1, posicao: 2, participantes: 6 })
      expect(await repo.trofeusDe(ana.id)).toEqual([
        { perfilId: ana.id, dia: '2026-09-23', divisao: 1, posicao: 1, participantes: 6 },
        { perfilId: ana.id, dia: '2026-09-22', divisao: 2, posicao: 3, participantes: 5 },
      ])
      expect(await repo.trofeusDe('nao-e-um-perfil')).toEqual([])
    })

    it('guarda cada corrida uma vez só, e soma as estatísticas por modo', async () => {
      const [ana, beto] = await Promise.all(['Ana', 'Beto'].map((nome) => repo.perfilDaConta(crypto.randomUUID(), nome)))
      await repo.registrarParticipacoes([
        corrida(ana.id),
        corrida(beto.id, { posicao: 2, tempo: 71 }),
      ])
      // A mesma corrida chega de novo: não conta duas vezes.
      await repo.registrarParticipacoes([corrida(ana.id)])
      await repo.registrarParticipacoes([
        corrida(ana.id, { sala: 'FGHIJ', largada: INSTANTE + 60_000, posicao: 3, carro: 'hamilton-mercedes', velocidadeMaxima: 331 }),
        corrida(ana.id, { sala: 'KLMNO', largada: INSTANTE + 120_000, modo: 'ranqueada', posicao: 5, pilotos: 6, deltaPl: -20, carro: 'hamilton-mercedes' }),
        corrida(ana.id, { sala: 'PQRST', largada: INSTANTE + 180_000, modo: 'copa', desfecho: 'abandonou', posicao: 6, pilotos: 6, tempo: null, batidas: 4 }),
        // Sozinha na sala não é vitória: não havia rival.
        corrida(ana.id, { sala: 'UVWXY', largada: INSTANTE + 240_000, pilotos: 1 }),
      ])
      const estatisticas = await repo.estatisticasDe(ana.id, 3)
      expect(estatisticas.porModo.casual).toEqual({ corridas: 3, vitorias: 1, podios: 2, chegadas: 3, abandonos: 0, somaDasPosicoes: 5 })
      expect(estatisticas.porModo.ranqueada).toMatchObject({ corridas: 1, vitorias: 0, podios: 0, chegadas: 1 })
      expect(estatisticas.porModo.copa).toMatchObject({ corridas: 1, abandonos: 1, chegadas: 0 })
      expect(estatisticas.velocidadeMaxima).toBe(331)
      expect(estatisticas.batidas).toBe(1 + 1 + 1 + 4 + 1)
      // O carro favorito é o de mais corridas: três de Senna contra duas de Hamilton.
      expect(estatisticas.carroFavorito).toEqual({ carro: 'senna', corridas: 3 })
      expect(estatisticas.recentes.map((r) => r.sala)).toEqual(['UVWXY', 'PQRST', 'KLMNO'])
      expect(estatisticas.recentes[2]).toMatchObject({ modo: 'ranqueada', deltaPl: -20, pilotos: 6, largada: INSTANTE + 120_000 })
      expect(estatisticas.recentes[1].tempo).toBeNull()
      expect((await repo.estatisticasDe(beto.id, 10)).porModo.casual.corridas).toBe(1)
    })

    it('conta as voltas, as pistas, a melhor medalha de cada uma e as pistas que o piloto lidera', async () => {
      const [ana, beto] = await Promise.all(['Ana', 'Beto'].map((nome) => repo.perfilDaConta(crypto.randomUUID(), nome)))
      await repo.registrarTempo(tempo(ana.id, 64, { medalha: 'prata' }))
      await repo.registrarTempo(tempo(ana.id, 62, { medalha: 'ouro' }))
      await repo.registrarTempo(tempo(ana.id, 70, { seed: 7, medalha: 'bronze' }))
      await repo.registrarTempo(tempo(ana.id, 50, { seed: 8, estado: 'pendente', medalha: 'autor' }))
      await repo.registrarTempo(tempo(ana.id, 99, { seed: 9, estado: 'recusado' }))
      await repo.registrarTempo(tempo(beto.id, 60, { medalha: 'ouro' }))
      await repo.registrarTempo(tempo(beto.id, 75, { seed: 7 }))
      const { contrarrelogio } = await repo.estatisticasDe(ana.id, 10)
      expect(contrarrelogio.voltas).toBe(4)
      expect(contrarrelogio.pistas).toBe(2)
      expect(contrarrelogio.medalhas).toEqual({ autor: 0, ouro: 1, prata: 0, bronze: 1 })
      // Na semente 123 o Beto é mais rápido; na 7, a Ana.
      expect(contrarrelogio.lideradas).toBe(1)
    })

    it('as estatísticas trazem cada temporada ranqueada, da mais nova', async () => {
      const [ana, beto] = await Promise.all(['Ana', 'Beto'].map((nome) => repo.perfilDaConta(crypto.randomUUID(), nome)))
      await repo.registrarCorridaRanqueada({ ...ranqueada([ana.id, beto.id], [estado(300, 0), estado(0, 0)]), temporada: '2026.1' })
      await repo.registrarCorridaRanqueada(ranqueada([ana.id, beto.id], [estado(900, 0), estado(0, 0)]))
      const { temporadas } = await repo.estatisticasDe(ana.id, 10)
      expect(temporadas.map((t) => [t.temporada, t.estado.pl])).toEqual([
        ['2026.2', 900],
        ['2026.1', 300],
      ])
      const vazias = await repo.estatisticasDe(crypto.randomUUID(), 10)
      expect(vazias.temporadas).toEqual([])
      expect(vazias.carroFavorito).toBeNull()
      expect(vazias.porModo.casual.corridas).toBe(0)
    })
  })
}

contrato('memória', async () => new RepositorioEmMemoria())

const urlDeTeste = process.env.TEST_DATABASE_URL
if (urlDeTeste) {
  contrato('Postgres', async () => {
    const repo = await RepositorioPostgres.conectar(urlDeTeste)
    // Cada caso começa com o banco vazio. As migrações ficam.
    const pg = await import('pg')
    const cliente = new pg.default.Client({ connectionString: urlDeTeste })
    await cliente.connect()
    await cliente.query('TRUNCATE perfis CASCADE')
    await cliente.end()
    return repo
  })
} else {
  describe.skip('repositório: Postgres (defina TEST_DATABASE_URL para rodar)', () => {
    it('contrato', () => {})
  })
}
