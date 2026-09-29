import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CIRCUITO_OFICIAL, CONTAGEM_DO_CONTRARRELOGIO_MS, diaDe, DIFICULDADE_OFICIAL, sementeDoDia } from '../src/game/contrarrelogio.js'
import { correrSemTela } from '../src/game/corridaSimulada.js'
import { GravadorDeVolta } from '../src/game/gravador.js'
import { desviando } from '../src/game/piloto.js'
import { GravadorDeEntradas, quantizarPasso } from '../src/game/registroDeEntradas.js'
import type { RaceInput } from '../src/game/simulation.js'
import { createGameServer, type GameServer } from './app.js'
import { tokenDeTeste, verificadorDeTeste } from './contas.js'
import type { PerfilDoPiloto } from './estatisticas.js'
import type { PublicRoom } from './rooms.js'

/**
 * Integridade pelo socket: quem fala por quem, e o caminho da conta, do perfil
 * e do contrarrelógio de ponta a ponta.
 */

const COUNTDOWN_MS = 200
const AGORA_INICIAL = Date.parse('2026-09-23T18:00:00Z')

type Resposta = { ok: boolean; error?: string } & Record<string, unknown>

let server: GameServer
let port = 0
let agora = AGORA_INICIAL
const clients: Socket[] = []

function connect() {
  return new Promise<Socket>((resolve, reject) => {
    const client = connectClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true })
    clients.push(client)
    client.on('connect', () => resolve(client))
    client.on('connect_error', reject)
  })
}

function ask<T>(client: Socket, event: string, payload?: unknown) {
  return new Promise<T>((resolve) => client.emit(event, payload, resolve))
}

/** Um aparelho que entrou numa conta. */
async function comConta(apelido: string, id: string = crypto.randomUUID()) {
  const client = await connect()
  const entrou = await ask<Resposta>(client, 'conta:entrar', { token: tokenDeTeste(id, apelido) })
  expect(entrou.ok).toBe(true)
  return { client, id }
}

/** Espera uma condição ficar verdadeira, conferindo a cada 20 ms. */
async function ate(condicao: () => Promise<boolean>, timeout = 5_000) {
  const limite = Date.now() + timeout
  while (!(await condicao())) {
    if (Date.now() > limite) throw new Error('a condição não aconteceu a tempo')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Uma volta inteira do contrarrelógio, com os comandos de cada quadro, como o jogo manda. */
function voltaNaPista(seed: number) {
  const passo = quantizarPasso(1 / 60)
  const gravador = new GravadorDeVolta()
  const entradas = new GravadorDeEntradas()
  let ultimo: RaceInput = { left: false, right: false, boost: false }
  const prova = correrSemTela(
    () => {
      const piloto = desviando(true)
      return (state) => (ultimo = piloto(state))
    },
    {
      seed,
      difficulty: DIFICULDADE_OFICIAL,
      quadro: passo,
      aCadaQuadro: (state, _eventos, tempo) => {
        entradas.registrar(passo, ultimo)
        gravador.gravar(tempo * 1000, state)
      },
    },
  )
  return {
    tempo: prova.tempo,
    gravacao: gravador.terminar(prova.tempo * 1000, prova.state),
    dispositivo: 'teclado',
    entradas: entradas.terminar(),
  }
}

beforeEach(async () => {
  agora = AGORA_INICIAL
  server = createGameServer({
    countdownMs: COUNTDOWN_MS,
    graceMs: 5_000,
    serveStatic: false,
    now: () => agora,
    contas: verificadorDeTeste(),
  })
  await new Promise<void>((resolve) => server.http.listen(0, resolve))
  port = (server.http.address() as AddressInfo).port
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server.close()
})

describe('quem fala por quem', () => {
  it('uma conexão não confirma, desiste nem troca o carro em nome de outro piloto', async () => {
    const ana = await connect()
    const beto = await connect()
    const criada = await ask<{ ok: boolean; room: PublicRoom }>(ana, 'room:create', { name: 'Ana', playerId: 'ana' })
    const code = criada.room.code
    await ask(beto, 'room:join', { code, name: 'Beto', playerId: 'beto' })

    const fingindo = await ask<Resposta>(beto, 'room:set-ready', { code, playerId: 'ana', ready: true })
    expect(fingindo.ok).toBe(false)
    expect(server.rooms.get(code)?.players.find((player) => player.id === 'ana')?.ready).toBe(false)

    const carro = await ask<Resposta>(beto, 'room:set-car', { code, playerId: 'ana', car: 'prost' })
    expect(carro.ok).toBe(false)

    // A própria confirmação continua funcionando.
    expect((await ask<Resposta>(beto, 'room:set-ready', { code, playerId: 'beto', ready: true })).ok).toBe(true)
  })

  it('durante a prova, telemetria e abandono em nome do rival são ignorados', async () => {
    const ana = await connect()
    const beto = await connect()
    const criada = await ask<{ ok: boolean; room: PublicRoom }>(ana, 'room:create', { name: 'Ana', playerId: 'ana' })
    const code = criada.room.code
    await ask(beto, 'room:join', { code, name: 'Beto', playerId: 'beto' })
    await ask(ana, 'room:set-ready', { code, playerId: 'ana', ready: true })
    await ask(beto, 'room:set-ready', { code, playerId: 'beto', ready: true })
    agora += COUNTDOWN_MS + 50
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_MS + 150))
    expect(server.rooms.get(code)?.status).toBe('racing')

    beto.emit('race:abandon', { code, playerId: 'ana' })
    beto.emit('race:telemetry', { code, playerId: 'ana', t: agora, progress: 999, lateral: 0, speed: 200, state: 'racing' })
    const chegadaFalsa = await ask<Resposta>(beto, 'race:finish', { code, playerId: 'ana', time: 60, topSpeed: 300, collisions: 0 })
    expect(chegadaFalsa.ok).toBe(false)
    expect(server.rooms.outcomeFor(code)).toBeNull()
    expect(server.rooms.rivalTelemetries(code, 'beto')).toEqual([])
  })

  it('a chegada cedo demais é recusada com aviso, em vez de sumir calada', async () => {
    const ana = await connect()
    const beto = await connect()
    const criada = await ask<{ ok: boolean; room: PublicRoom }>(ana, 'room:create', { name: 'Ana', playerId: 'ana' })
    const code = criada.room.code
    await ask(beto, 'room:join', { code, name: 'Beto', playerId: 'beto' })
    await ask(ana, 'room:set-ready', { code, playerId: 'ana', ready: true })
    await ask(beto, 'room:set-ready', { code, playerId: 'beto', ready: true })
    agora += COUNTDOWN_MS + 50
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_MS + 150))
    const cedo = await ask<Resposta>(ana, 'race:finish', { code, playerId: 'ana', time: 20, topSpeed: 300, collisions: 0 })
    expect(cedo.ok).toBe(false)
    expect(cedo.error).toContain('recusada')
  })
})

describe('conta pelo socket', () => {
  it('entra com o token da conta, recusa o token que não vale, e a conta é a mesma em outro aparelho', async () => {
    const aparelho = await connect()
    // A sessão que não vale volta com o código que o aparelho usa para sair dela.
    expect(await ask<Resposta>(aparelho, 'conta:entrar', { token: 'chute' })).toMatchObject({ ok: false, codigo: 'sessao-invalida' })
    expect((await ask<Resposta>(aparelho, 'conta:entrar', {})).ok).toBe(false)
    const id = crypto.randomUUID()
    const entrou = await ask<Resposta>(aparelho, 'conta:entrar', { token: tokenDeTeste(id, 'Ana Paula') })
    expect(entrou.ok).toBe(true)
    expect(entrou.perfil).toMatchObject({ id, apelido: 'Ana Paula' })

    const outroAparelho = await connect()
    const deNovo = await ask<Resposta>(outroAparelho, 'conta:entrar', { token: tokenDeTeste(id, 'Outro Nome') })
    expect(deNovo.perfil).toMatchObject({ id, apelido: 'Ana Paula' })
  })

  it('o nome de piloto é único, e o da conta vale no grid no lugar do que o aparelho mandar', async () => {
    const { client: ana } = await comConta('Ana')
    const visitante = await connect()
    expect(await ask<Resposta>(visitante, 'conta:apelido-livre', { apelido: ' ana ' })).toMatchObject({ ok: true, livre: false })
    expect(await ask<Resposta>(visitante, 'conta:apelido-livre', { apelido: 'Bia' })).toMatchObject({ ok: true, livre: true })
    const curto = await ask<Resposta>(visitante, 'conta:apelido-livre', { apelido: 'x' })
    expect(curto).toMatchObject({ ok: true, livre: false })
    expect(curto.motivo).toContain('3')

    const criada = await ask<{ ok: boolean; room: PublicRoom }>(ana, 'room:create', { name: 'Impostor', playerId: 'aba-ana' })
    expect(criada.room.players[0].name).toBe('Ana')
    // O convidado escolhe o nome que quiser, como sempre.
    const entrou = await ask<{ ok: boolean; room: PublicRoom }>(visitante, 'room:join', {
      code: criada.room.code,
      name: 'Visitante',
      playerId: 'aba-visitante',
    })
    expect(entrou.room.players.map((player) => player.name)).toEqual(['Ana', 'Visitante'])
  })

  it('sair da conta volta a ser convidado', async () => {
    const { client } = await comConta('Ana')
    expect((await ask<Resposta>(client, 'tt:iniciar')).ok).toBe(true)
    expect((await ask<Resposta>(client, 'conta:sair')).ok).toBe(true)
    expect((await ask<Resposta>(client, 'tt:iniciar')).ok).toBe(false)
    expect((await ask<Resposta>(client, 'perfil:ver')).ok).toBe(false)
  })

  it('a corrida online de quem tem conta entra no perfil; a do convidado, não', async () => {
    const { client: ana, id } = await comConta('Ana')
    const beto = await connect()
    const criada = await ask<{ ok: boolean; room: PublicRoom }>(ana, 'room:create', { name: 'Ana', playerId: 'ana', car: 'senna' })
    const code = criada.room.code
    await ask(beto, 'room:join', { code, name: 'Beto', playerId: 'beto' })
    const resultado = new Promise((resolve) => ana.once('race:result', resolve))
    await ask(ana, 'room:set-ready', { code, playerId: 'ana', ready: true })
    await ask(beto, 'room:set-ready', { code, playerId: 'beto', ready: true })
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_MS + 150))
    // Num duelo, o abandono decide a prova na hora.
    ana.emit('race:abandon', { code, playerId: 'ana' })
    await resultado

    let perfil: PerfilDoPiloto | null = null
    await ate(async () => {
      const visto = await ask<Resposta>(ana, 'perfil:ver')
      perfil = (visto.perfil as PerfilDoPiloto) ?? null
      return (perfil?.online.corridas ?? 0) > 0
    })
    expect(perfil!).toMatchObject({ id, apelido: 'Ana', online: { corridas: 1, vitorias: 0, abandonos: 1 } })
    expect(perfil!.porModo.casual.corridas).toBe(1)
    expect(perfil!.carroFavorito).toEqual({ carro: 'senna', corridas: 1 })
    expect(perfil!.recentes[0]).toMatchObject({ modo: 'casual', posicao: 2, pilotos: 2, desfecho: 'abandonou' })

    // O perfil de outro piloto se vê pelo id; o convidado não tem perfil próprio.
    expect((await ask<Resposta>(beto, 'perfil:ver', { id })).perfil).toMatchObject({ apelido: 'Ana' })
    expect((await ask<Resposta>(beto, 'perfil:ver')).ok).toBe(false)
    expect((await ask<Resposta>(beto, 'perfil:ver', { id: crypto.randomUUID() })).ok).toBe(false)
  })
})

describe('contrarrelógio pelo socket', () => {
  it('sem conta não há tentativa; com conta, a volta entra no quadro de hoje', async () => {
    const aparelho = await connect()
    expect((await ask<Resposta>(aparelho, 'tt:iniciar')).ok).toBe(false)
    await ask<Resposta>(aparelho, 'conta:entrar', { token: tokenDeTeste(crypto.randomUUID(), 'Ana') })

    const aberta = await ask<Resposta>(aparelho, 'tt:iniciar')
    expect(aberta.ok).toBe(true)
    expect(aberta.seed).toBe(sementeDoDia(diaDe(new Date(agora))))

    // A volta vai com os comandos de cada quadro: o servidor a refaz com a
    // mesma física antes de pôr no quadro.
    const volta = voltaNaPista(aberta.seed as number)
    agora += CONTAGEM_DO_CONTRARRELOGIO_MS + volta.tempo * 1000 + 200
    const veredito = await ask<Resposta>(aparelho, 'tt:terminar', { tentativa: aberta.tentativa, ...volta })
    expect(veredito.ok).toBe(true)
    expect(veredito.estado).toBe('valido')

    const quadro = await ask<Resposta>(aparelho, 'tt:quadro')
    const conteudo = quadro.quadro as { linhas: Array<{ apelido: string }>; voce: { posicao: number } | null }
    expect(conteudo.linhas.map((linha) => linha.apelido)).toEqual(['Ana'])
    expect(conteudo.voce?.posicao).toBe(1)
  })

  it('o ranking mundial é o quadro de todos os tempos do Circuito Oficial, e aparece no perfil', async () => {
    const { client: ana, id } = await comConta('Ana')
    const aberta = await ask<Resposta>(ana, 'tt:iniciar', { circuito: 'oficial' })
    expect(aberta.seed).toBe(CIRCUITO_OFICIAL.seed)
    expect(aberta.dificuldade).toBe(CIRCUITO_OFICIAL.dificuldade)

    const volta = voltaNaPista(CIRCUITO_OFICIAL.seed)
    agora += CONTAGEM_DO_CONTRARRELOGIO_MS + volta.tempo * 1000 + 200
    const veredito = await ask<Resposta>(ana, 'tt:terminar', { tentativa: aberta.tentativa, ...volta })
    expect(veredito.estado).toBe('valido')

    // No dia seguinte o ranking continua lá: não zera à meia-noite.
    agora += 86_400_000
    const visitante = await connect()
    const mundial = await ask<Resposta>(visitante, 'tt:quadro', { circuito: 'oficial', limite: 50 })
    const quadro = mundial.quadro as { seed: number; linhas: Array<{ apelido: string; perfilId: string }>; voce: unknown }
    expect(quadro.seed).toBe(CIRCUITO_OFICIAL.seed)
    expect(quadro.linhas.map((linha) => linha.apelido)).toEqual(['Ana'])
    expect(quadro.voce).toBeNull()
    // A Pista do Dia de amanhã é outra, e está vazia.
    expect(((await ask<Resposta>(visitante, 'tt:quadro')).quadro as { linhas: unknown[] }).linhas).toEqual([])

    const perfil = (await ask<Resposta>(visitante, 'perfil:ver', { id })).perfil as PerfilDoPiloto
    expect(perfil.mundial).toMatchObject({ posicao: 1, tempo: volta.tempo, dispositivo: 'teclado' })
    expect(perfil.contrarrelogio).toMatchObject({ voltas: 1, pistas: 1, lideradas: 1 })
    expect(perfil.kmRodados).toBe(4.8)
  })
})
