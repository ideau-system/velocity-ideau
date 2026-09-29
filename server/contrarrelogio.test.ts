import { describe, expect, it } from 'vitest'
import { CONTAGEM_DO_CONTRARRELOGIO_MS, diaDe, DIFICULDADE_OFICIAL, sementeDoDia, tempoDoPiloto } from '../src/game/contrarrelogio.js'
import { correrSemTela } from '../src/game/corridaSimulada.js'
import { desafiosDaSemana, regrasDo, semanaDe } from '../src/game/desafios.js'
import { GravadorDeVolta, type GravacaoDeVolta } from '../src/game/gravador.js'
import { desviando, pilotoCompleto, type Piloto } from '../src/game/piloto.js'
import { GravadorDeEntradas, quantizarPasso } from '../src/game/registroDeEntradas.js'
import type { RaceInput } from '../src/game/simulation.js'
import { TRACK_LENGTH } from '../src/game/track.js'
import { julgarVolta, PistaDoDia, trocasDeLadoPorSegundo } from './contrarrelogio.js'
import { RepositorioEmMemoria } from './dados/memoria.js'

/** Meio da tarde de 23 de setembro de 2026, em Brasília. */
const AGORA = Date.parse('2026-09-23T18:00:00Z')
const SEMENTE = sementeDoDia(diaDe(new Date(AGORA)))

/** Uma volta de verdade, de quem desvia com boost, na pista do dia. */
function voltaDeVerdade() {
  const gravador = new GravadorDeVolta()
  const prova = correrSemTela(() => desviando(true), {
    seed: SEMENTE,
    difficulty: DIFICULDADE_OFICIAL,
    aCadaQuadro: (state, _eventos, tempo) => gravador.gravar(tempo * 1000, state),
  })
  return { tempo: prova.tempo, gravacao: gravador.terminar(prova.tempo * 1000, prova.state) }
}

const VOLTA = voltaDeVerdade()

const julgar = (tempo: number, gravacao: unknown, decorrido: number) =>
  julgarVolta({ tempo, gravacao, decorrido, seed: SEMENTE, dificuldade: DIFICULDADE_OFICIAL })

describe('julgamento da volta', () => {
  it('uma volta de verdade, no tempo que passou no servidor, vale', () => {
    expect(julgar(VOLTA.tempo, VOLTA.gravacao, VOLTA.tempo + 0.3)).toEqual({ estado: 'valido' })
  })

  it('a volta de um aparelho lento também vale: a amostra sai do quadro, e pode atrasar um quadro inteiro', () => {
    // A 22 quadros por segundo, a amostra de cada 100 ms sai do primeiro quadro
    // depois dela — até 45 ms atrasada. No boost, dois trechos seguidos passam
    // do que 100 ms exatos permitiriam, sem nada de errado com a volta.
    for (const quadros of [22, 30]) {
      const gravador = new GravadorDeVolta()
      const prova = correrSemTela((layout) => pilotoCompleto(layout), {
        seed: SEMENTE,
        difficulty: DIFICULDADE_OFICIAL,
        quadro: quantizarPasso(1 / quadros),
        largada: { nivel: 3, queimou: false },
        aCadaQuadro: (state, _eventos, tempo) => gravador.gravar(tempo * 1000, state),
      })
      const veredito = julgar(prova.tempo, gravador.terminar(prova.tempo * 1000, prova.state), prova.tempo + 0.3)
      expect(veredito.estado, `${quadros} quadros por segundo: ${veredito.motivo}`).not.toBe('recusado')
    }
  })

  it('câmera lenta: o tempo declarado é bem menor do que passou no servidor', () => {
    expect(julgar(VOLTA.tempo, VOLTA.gravacao, VOLTA.tempo + 12).estado).toBe('recusado')
  })

  it('relógio adiantado: o tempo declarado é maior do que passou', () => {
    expect(julgar(VOLTA.tempo, VOLTA.gravacao, VOLTA.tempo - 2).estado).toBe('recusado')
  })

  it('a volta gravada precisa bater com o tempo e chegar à linha', () => {
    expect(julgar(VOLTA.tempo - 3, VOLTA.gravacao, VOLTA.tempo - 2.8).estado).toBe('recusado')
    const curta = {
      ...VOLTA.gravacao,
      progresso: VOLTA.gravacao.progresso.slice(0, -1),
      lateral: VOLTA.gravacao.lateral.slice(0, -1),
      velocidade: VOLTA.gravacao.velocidade.slice(0, -1),
    }
    expect(julgar(VOLTA.tempo - 0.1, curta, VOLTA.tempo).estado).toBe('recusado')
    expect(julgar(VOLTA.tempo, { lixo: true }, VOLTA.tempo).estado).toBe('recusado')
  })

  it('velocidade acima do teto do nível é recusada', () => {
    const voando = { ...VOLTA.gravacao, velocidade: [...VOLTA.gravacao.velocidade] }
    voando.velocidade[200] = 450
    expect(julgar(VOLTA.tempo, voando, VOLTA.tempo + 0.2).estado).toBe('recusado')
  })

  it('volante trocando de lado o tempo todo deixa a volta pendente', () => {
    const tremendo = {
      ...VOLTA.gravacao,
      lateral: VOLTA.gravacao.lateral.map((valor, i) => Math.max(-1000, Math.min(1000, valor + (i % 2 === 0 ? 60 : -60)))),
    }
    expect(trocasDeLadoPorSegundo(tremendo)).toBeGreaterThan(8)
    expect(trocasDeLadoPorSegundo(VOLTA.gravacao)).toBeLessThan(4)
    expect(julgar(VOLTA.tempo, tremendo, VOLTA.tempo + 0.2).estado).toBe('pendente')
  })

  it('abaixo do piloto de referência, a volta espera conferência', () => {
    // Uma volta sintética no teto do nível, sem curva nem batida: possível
    // pelas contas da telemetria, e rápida demais para ser aceita às cegas.
    const amostras = Math.ceil((TRACK_LENGTH * 10) / 95) + 1
    const rapida: GravacaoDeVolta = {
      intervaloMs: 100,
      progresso: Array.from({ length: amostras }, (_, i) => Math.min(TRACK_LENGTH * 10, i * 95)),
      lateral: Array.from({ length: amostras }, () => 0),
      velocidade: Array.from({ length: amostras }, () => 342),
    }
    const tempo = (amostras - 1) / 10
    expect(tempo).toBeLessThan(tempoDoPiloto(SEMENTE, DIFICULDADE_OFICIAL) * 0.95)
    expect(julgar(tempo, rapida, tempo + 0.2)).toEqual({ estado: 'pendente', motivo: 'abaixo do piloto de referência' })
  })
})

/** Uma volta com os comandos de cada quadro, como o jogo manda ao servidor. */
function voltaComComandos(piloto: (layout: Parameters<typeof pilotoCompleto>[0]) => Piloto) {
  const quadro = quantizarPasso(1 / 60)
  const entradas = new GravadorDeEntradas()
  const gravador = new GravadorDeVolta()
  const largada = { nivel: 3 as const, queimou: false }
  entradas.registrarLargada(largada)
  let ultimo: RaceInput = { left: false, right: false, boost: false }
  const prova = correrSemTela(
    (layout) => {
      const base = piloto(layout)
      return (state) => (ultimo = base(state))
    },
    {
      seed: SEMENTE,
      difficulty: DIFICULDADE_OFICIAL,
      quadro,
      largada,
      aCadaQuadro: (state, _eventos, tempo) => {
        entradas.registrar(quadro, ultimo)
        gravador.gravar(tempo * 1000, state)
      },
    },
  )
  return { tempo: prova.tempo, gravacao: gravador.terminar(prova.tempo * 1000, prova.state), entradas: entradas.terminar() }
}

describe('conferência pelos comandos', () => {
  const julgarComComandos = (tempo: number, gravacao: unknown, entradas: unknown) =>
    julgarVolta({ tempo, gravacao, decorrido: tempo + 0.3, seed: SEMENTE, dificuldade: DIFICULDADE_OFICIAL, entradas })

  it('a volta que os comandos refazem vale', () => {
    const volta = voltaComComandos((layout) => pilotoCompleto(layout))
    expect(julgarComComandos(volta.tempo, volta.gravacao, volta.entradas)).toEqual({ estado: 'valido' })
  })

  it('comandos de uma volta lenta não sustentam uma gravação rápida', () => {
    const rapida = voltaComComandos((layout) => pilotoCompleto(layout))
    const lenta = voltaComComandos(() => desviando(true))
    expect(julgarComComandos(rapida.tempo, rapida.gravacao, lenta.entradas).estado).toBe('recusado')
  })

  it('física adulterada: a volta sintética no teto não sai de comando nenhum', () => {
    const amostras = Math.ceil((TRACK_LENGTH * 10) / 95) + 1
    const rapida: GravacaoDeVolta = {
      intervaloMs: 100,
      progresso: Array.from({ length: amostras }, (_, i) => Math.min(TRACK_LENGTH * 10, i * 95)),
      lateral: Array.from({ length: amostras }, () => 0),
      velocidade: Array.from({ length: amostras }, () => 342),
    }
    const tempo = (amostras - 1) / 10
    const quadros = Math.round(tempo * 60)
    // Boost do começo ao fim, que é o que um cliente adulterado diria ter feito.
    const soBoost = { quadrosUs: Array.from({ length: quadros }, () => 16_667), comandos: [4, quadros], largada: null, saltos: [] }
    expect(julgarComComandos(tempo, rapida, soBoost).estado).toBe('recusado')
  })

  it('registro de comandos malformado é recusado', () => {
    const volta = voltaComComandos((layout) => pilotoCompleto(layout))
    expect(julgarComComandos(volta.tempo, volta.gravacao, { lixo: true }).estado).toBe('recusado')
  })
})

describe('serviço da Pista do Dia', () => {
  function servico() {
    let agora = AGORA
    const repo = new RepositorioEmMemoria(() => agora)
    const pista = new PistaDoDia(repo, () => agora)
    return { repo, pista, avancar: (segundos: number) => (agora += segundos * 1000) }
  }

  it('abre a tentativa, julga a volta pelo relógio dele e põe no quadro', async () => {
    const { repo, pista, avancar } = servico()
    const ana = await repo.perfilDaConta(crypto.randomUUID(), 'Ana')
    const aberta = pista.iniciar(ana.id)!
    expect(aberta.seed).toBe(SEMENTE)
    expect(aberta.dificuldade).toBe(DIFICULDADE_OFICIAL)
    avancar(CONTAGEM_DO_CONTRARRELOGIO_MS / 1000 + VOLTA.tempo + 0.2)
    const veredito = await pista.terminar(ana.id, { tentativa: aberta.tentativa, tempo: VOLTA.tempo, gravacao: VOLTA.gravacao, dispositivo: 'toque' })
    expect(veredito.estado).toBe('valido')
    expect(veredito.linha?.posicao).toBe(1)
    expect(veredito.linha?.dispositivo).toBe('toque')

    const quadro = (await pista.quadro(ana.id))!
    expect(quadro.linhas).toHaveLength(1)
    expect(quadro.voce?.apelido).toBe('Ana')
    expect(quadro.limites.ouro).toBeGreaterThan(quadro.limites.autor)

    // O fantasma do top é público; o de quem não está nele, não.
    expect(await pista.fantasma(quadro.linhas[0].id)).toEqual(VOLTA.gravacao)
    expect(await pista.fantasma('outro')).toBeNull()
  })

  it('a tentativa é de quem a abriu, e vale uma vez só', async () => {
    const { repo, pista, avancar } = servico()
    const ana = await repo.perfilDaConta(crypto.randomUUID(), 'Ana')
    const beto = await repo.perfilDaConta(crypto.randomUUID(), 'Beto')
    const aberta = pista.iniciar(ana.id)!
    avancar(CONTAGEM_DO_CONTRARRELOGIO_MS / 1000 + VOLTA.tempo + 0.2)
    const entrada = { tentativa: aberta.tentativa, tempo: VOLTA.tempo, gravacao: VOLTA.gravacao, dispositivo: 'teclado' }
    expect((await pista.terminar(beto.id, entrada)).estado).toBe('recusado')
    expect((await pista.terminar(ana.id, entrada)).estado).toBe('valido')
    expect((await pista.terminar(ana.id, entrada)).estado).toBe('recusado')
  })

  it('um desafio da semana tem tentativa, julgamento e quadro próprios, com o modificador dele', async () => {
    const { repo, pista, avancar } = servico()
    const ana = await repo.perfilDaConta(crypto.randomUUID(), 'Ana')
    const desafio = desafiosDaSemana(semanaDe(AGORA))[1]
    expect(desafio.modificador).toBe('nitroLivre')
    const aberta = pista.iniciar(ana.id, { desafio: desafio.id })!
    expect(aberta.seed).toBe(desafio.seed)
    expect(aberta.modificador).toBe('nitroLivre')

    // A volta corre com as regras do desafio, e os comandos vão junto.
    const passo = quantizarPasso(1 / 60)
    const entradas = new GravadorDeEntradas()
    const gravador = new GravadorDeVolta()
    let ultimo: RaceInput = { left: false, right: false, boost: false }
    const prova = correrSemTela(
      () => {
        const piloto = desviando(true)
        return (state) => (ultimo = piloto(state))
      },
      {
        seed: desafio.seed,
        difficulty: desafio.dificuldade,
        quadro: passo,
        regras: regrasDo(desafio.modificador),
        aCadaQuadro: (state, _eventos, tempo) => {
          entradas.registrar(passo, ultimo)
          gravador.gravar(tempo * 1000, state)
        },
      },
    )
    avancar(CONTAGEM_DO_CONTRARRELOGIO_MS / 1000 + prova.tempo + 0.2)
    const veredito = await pista.terminar(ana.id, {
      tentativa: aberta.tentativa,
      tempo: prova.tempo,
      gravacao: gravador.terminar(prova.tempo * 1000, prova.state),
      dispositivo: 'teclado',
      entradas: entradas.terminar(),
    })
    expect(veredito.estado).toBe('valido')

    const quadro = (await pista.quadro(ana.id, 10, { desafio: desafio.id }))!
    expect(quadro.linhas).toHaveLength(1)
    // O quadro da Pista do Dia não mistura com o do desafio.
    expect((await pista.quadro(ana.id))!.linhas).toHaveLength(0)
    const desafios = await pista.desafios(ana.id)
    expect(desafios).toHaveLength(5)
    expect(desafios[1].lider?.apelido).toBe('Ana')
    expect(desafios[1].voce?.posicao).toBe(1)
    expect(desafios[0].lider).toBeNull()

    // Um desafio que não é desta semana não abre tentativa.
    expect(pista.iniciar(ana.id, { desafio: 'inventado' })).toBeNull()
  })

  it('chegar antes do tempo que a volta leva é recusado, e nada entra no quadro', async () => {
    const { repo, pista, avancar } = servico()
    const ana = await repo.perfilDaConta(crypto.randomUUID(), 'Ana')
    const aberta = pista.iniciar(ana.id)!
    avancar(20)
    const veredito = await pista.terminar(ana.id, { tentativa: aberta.tentativa, tempo: VOLTA.tempo, gravacao: VOLTA.gravacao, dispositivo: 'teclado' })
    expect(veredito.estado).toBe('recusado')
    expect((await pista.quadro(null))!.linhas).toHaveLength(0)
  })
})
