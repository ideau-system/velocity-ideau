import { describe, expect, it } from 'vitest'
import {
  CORRECAO_MAXIMA_MPS,
  gapBetween,
  GhostTracker,
  INTERPOLATION_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  offScreenNotice,
  positionNotice,
  rivalSide,
  type GhostSnapshot,
} from './ghost'

const BASE = 1_000_000

function snapshot(t: number, progress: number, extra: Partial<GhostSnapshot> = {}): GhostSnapshot {
  return { t, progress, lateral: 0, speed: 252, state: 'racing', ...extra }
}

/** Preenche o buffer com medições regulares, como o rival enviaria. */
function comTelemetriaRegular(tracker: GhostTracker, quantidade = 6, intervalo = 100) {
  for (let index = 0; index < quantidade; index += 1) {
    tracker.push(snapshot(BASE + index * intervalo, index * 7))
  }
}

describe('interpolação do fantasma', () => {
  it('sem telemetria não há fantasma para desenhar', () => {
    expect(new GhostTracker().sample(BASE)).toBeNull()
  })

  it('interpola entre duas medições em vez de saltar', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100))
    tracker.push(snapshot(BASE + 200, 140))

    // Meio caminho entre as duas medições, já descontado o atraso de render.
    const amostra = tracker.sample(BASE + 100 + INTERPOLATION_DELAY_MS)
    expect(amostra?.progress).toBeCloseTo(120, 5)
    expect(amostra?.stale).toBe(false)
  })

  it('interpola a posição lateral junto com o progresso', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100, { lateral: -0.4 }))
    tracker.push(snapshot(BASE + 200, 140, { lateral: 0.4 }))
    expect(tracker.sample(BASE + 100 + INTERPOLATION_DELAY_MS)?.lateral).toBeCloseTo(0, 5)
  })

  it('desenha o fantasma no presente, projetado da última medição', () => {
    const tracker = new GhostTracker()
    comTelemetriaRegular(tracker)
    const ultima = tracker.latest!
    // A medição mais nova tem 60 ms: a 70 m/s, o carro já andou mais 4,2 m.
    const amostra = tracker.sample(ultima.t + 60)
    expect(amostra!.progress).toBeCloseTo(ultima.progress + 4.2, 1)
  })

  it('dois carros lado a lado se veem lado a lado, apesar do atraso da rede', () => {
    // O rival está exatamente na mesma posição do jogador, mas cada medição
    // chega com 80 ms de rede. Desenhado no passado, ele apareceria uns 11 m
    // atrás — e os dois se achariam em primeiro.
    const tracker = new GhostTracker()
    const verdade = (t: number) => ((t - BASE) / 1000) * 70
    let pior = 0
    for (let agora = BASE + 100; agora <= BASE + 3_000; agora += 16) {
      for (let t = BASE; t <= agora - 80; t += 100) tracker.push(snapshot(t, verdade(t)))
      const visto = tracker.sample(agora)!
      if (agora > BASE + 400) pior = Math.max(pior, Math.abs(visto.progress - verdade(agora)))
    }
    expect(pior).toBeLessThan(1)
  })
})

describe('projeção e correção', () => {
  it('a projeção leva em conta a aceleração das últimas medições', () => {
    const tracker = new GhostTracker()
    // Acelerando a 10 m/s²: de 50 para 55 m/s em meio segundo.
    for (let i = 0; i <= 5; i += 1) {
      const s = i / 10
      tracker.push(snapshot(BASE + i * 100, 50 * s + 5 * s * s, { speed: (50 + 10 * s) * 3.6 }))
    }
    const ultima = tracker.latest!
    const amostra = tracker.sample(ultima.t + 200)!
    // 0,2 s a 55 m/s com mais 10 m/s²: 11 m + 0,2 m.
    expect(amostra.progress).toBeCloseTo(ultima.progress + 11.2, 1)
  })

  it('freando até parar, a projeção não vira ré', () => {
    const tracker = new GhostTracker()
    for (let i = 0; i <= 3; i += 1) tracker.push(snapshot(BASE + i * 100, 1_000 + i * 2, { speed: Math.max(0, 60 - i * 20) }))
    const ultima = tracker.latest!
    let anterior = -Infinity
    for (let agora = ultima.t; agora < ultima.t + 800; agora += 16) {
      const amostra = tracker.sample(agora)!
      expect(amostra.progress).toBeGreaterThanOrEqual(anterior)
      expect(amostra.progress).toBeLessThan(ultima.progress + 2)
      anterior = amostra.progress
    }
  })

  it('uma correção pequena é absorvida sem salto, no teto de ritmo', () => {
    const tracker = new GhostTracker()
    comTelemetriaRegular(tracker, 6)
    let agora = BASE + 500
    let anterior = tracker.sample(agora)!.progress
    // A próxima medição mostra o rival 6 m além do que a projeção dizia.
    tracker.push(snapshot(BASE + 600, 5 * 7 + 7 + 6))
    let maiorPasso = 0
    for (agora += 16; agora <= BASE + 1_000; agora += 16) {
      const atual = tracker.sample(agora)!.progress
      maiorPasso = Math.max(maiorPasso, atual - anterior)
      anterior = atual
    }
    // 70 m/s do carro mais o teto da correção, em 16 ms.
    expect(maiorPasso).toBeLessThan(((70 + CORRECAO_MAXIMA_MPS) * 16) / 1000 + 0.01)
  })

  it('uma diferença grande demais reposiciona o carro de uma vez', () => {
    const tracker = new GhostTracker()
    comTelemetriaRegular(tracker, 6)
    tracker.sample(BASE + 500)
    // Voltou depois de uma queda: 200 m à frente do que se via.
    tracker.push(snapshot(BASE + 520, 35 + 200))
    expect(tracker.sample(BASE + 536)!.progress).toBeGreaterThan(35 + 200)
  })

  it('a posição lateral acompanha sem trancos', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 0, { lateral: -0.5 }))
    tracker.sample(BASE)
    tracker.push(snapshot(BASE + 100, 7, { lateral: 0.5 }))
    const logo = tracker.sample(BASE + 116)!.lateral
    // Um quadro depois, o carro começou a ir, mas ainda não chegou.
    expect(logo).toBeGreaterThan(-0.5)
    expect(logo).toBeLessThan(0.5)
    expect(tracker.sample(BASE + 700)!.lateral).toBeCloseTo(0.5, 1)
  })
})

describe('pacotes atrasados e fora de ordem', () => {
  it('aceita uma medição que chega fora de ordem', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100))
    tracker.push(snapshot(BASE + 200, 140))
    tracker.push(snapshot(BASE + 100, 120)) // chegou atrasada

    expect(tracker.sample(BASE + 100 + INTERPOLATION_DELAY_MS)?.progress).toBeCloseTo(120, 5)
    expect(tracker.latest?.t).toBe(BASE + 200)
  })

  it('ignora medições repetidas', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100))
    tracker.push(snapshot(BASE, 999))
    expect(tracker.sample(BASE)?.progress).toBe(100)
  })

  it('um pacote atrasado não faz o fantasma voltar', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100))
    tracker.push(snapshot(BASE + 400, 200))

    const antes = tracker.sample(BASE + 400 + INTERPOLATION_DELAY_MS)!.progress
    // Uma medição antiga só agora entregue pela rede.
    tracker.push(snapshot(BASE + 150, 120))
    const depois = tracker.sample(BASE + 410 + INTERPOLATION_DELAY_MS)!.progress

    expect(depois).toBeGreaterThanOrEqual(antes)
  })

  it('o fantasma nunca anda para trás em uma sequência embaralhada', () => {
    const tracker = new GhostTracker()
    const medicoes = Array.from({ length: 30 }, (_, index) => snapshot(BASE + index * 100, index * 7))
    const embaralhadas = [...medicoes].sort(() => Math.random() - 0.5)

    let anterior = -Infinity
    for (const medicao of embaralhadas) {
      tracker.push(medicao)
      const amostra = tracker.sample(medicao.t + INTERPOLATION_DELAY_MS)
      if (!amostra) continue
      expect(amostra.progress).toBeGreaterThanOrEqual(anterior)
      anterior = amostra.progress
    }
  })

  it('não dá saltos grandes entre quadros consecutivos', () => {
    const tracker = new GhostTracker()
    comTelemetriaRegular(tracker, 12)

    let anterior: number | null = null
    for (let agora = BASE; agora <= BASE + 1_100; agora += 16) {
      const amostra = tracker.sample(agora)
      if (!amostra) continue
      // Em 16 ms o carro mais rápido percorre menos de 1,5 m.
      if (anterior !== null) expect(amostra.progress - anterior).toBeLessThan(1.5)
      anterior = amostra.progress
    }
  })
})

describe('perda de sinal', () => {
  it('projeta o movimento por um instante quando a telemetria falha', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100, { speed: 360 })) // 100 m/s

    const amostra = tracker.sample(BASE + INTERPOLATION_DELAY_MS + 300)
    expect(amostra?.progress).toBeCloseTo(130, 5)
    expect(amostra?.stale).toBe(false)
  })

  it('marca o fantasma como sem sinal e para de avançar', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100, { speed: 360 }))

    const limite = tracker.sample(BASE + INTERPOLATION_DELAY_MS + MAX_EXTRAPOLATION_MS + 400)
    expect(limite?.stale).toBe(true)
    expect(limite?.progress).toBeCloseTo(100 + MAX_EXTRAPOLATION_MS / 10, 5)
  })

  it('sem sinal, o fantasma para de verdade: velocidade zero', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100, { speed: 252 }))
    expect(tracker.sample(BASE + MAX_EXTRAPOLATION_MS + 100)?.speed).toBe(0)
  })

  it('quem já chegou não continua andando', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 4_800, { state: 'finished', speed: 252 }))
    const amostra = tracker.sample(BASE + INTERPOLATION_DELAY_MS + 400)
    expect(amostra?.progress).toBe(4_800)
    expect(amostra?.state).toBe('finished')
    expect(amostra?.finishedAt).toBe(BASE)
  })

  it('a chegada no mesmo milissegundo da última medição vale mais do que ela', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 4_800))
    tracker.push(snapshot(BASE, 4_800, { state: 'finished', speed: 0 }))
    expect(tracker.sample(BASE + 50)?.state).toBe('finished')
  })

  it('diz quando o rival está de boost, e só enquanto a medição sustenta', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100, { boosting: true }))
    expect(tracker.sample(BASE + 50)?.boosting).toBe(true)
    // Sem sinal, não se afirma que ele segue de boost.
    expect(tracker.sample(BASE + MAX_EXTRAPOLATION_MS + 100)?.boosting).toBe(false)
    tracker.push(snapshot(BASE + 1_100, 170, { boosting: false }))
    expect(tracker.sample(BASE + 1_150)?.boosting).toBe(false)
  })

  it('quem chegou não está de boost, e o cliente que não manda o campo também não', () => {
    const chegou = new GhostTracker()
    chegou.push(snapshot(BASE, 4_800, { state: 'finished', boosting: true }))
    expect(chegou.sample(BASE + 10)?.boosting).toBe(false)
    const antigo = new GhostTracker()
    antigo.push(snapshot(BASE, 100))
    expect(antigo.sample(BASE + 10)?.boosting).toBe(false)
  })

  it('medições com números estragados não quebram o fantasma', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100, { lateral: Number.NaN, speed: Number.POSITIVE_INFINITY }))
    const amostra = tracker.sample(BASE + 100)!
    expect(Number.isFinite(amostra.progress)).toBe(true)
    expect(amostra.lateral).toBe(0)
  })

  it('reiniciar limpa o histórico para a próxima corrida', () => {
    const tracker = new GhostTracker()
    comTelemetriaRegular(tracker)
    tracker.reset()
    expect(tracker.sample(BASE + 1_000)).toBeNull()
    expect(tracker.latest).toBeNull()
  })
})

describe('posição relativa', () => {
  it('coloca o jogador em P2 quando o rival está à frente', () => {
    const gap = gapBetween(300, 320, 252, 252)
    expect(gap.meters).toBe(20)
    expect(gap.ahead).toBe(true)
    expect(gap.position).toBe('P2')
  })

  it('coloca o jogador em P1 quando lidera', () => {
    const gap = gapBetween(320, 300, 252, 252)
    expect(gap.meters).toBe(-20)
    expect(gap.ahead).toBe(false)
    expect(gap.position).toBe('P1')
  })

  it('converte a distância em segundos pelo ritmo da dupla', () => {
    // 70 m/s de ritmo médio: 70 metros equivalem a 1 segundo.
    const gap = gapBetween(0, 70, 252, 252)
    expect(gap.seconds).toBeCloseTo(1, 2)
  })

  it('não explode os segundos com os carros quase parados', () => {
    const gap = gapBetween(0, 20, 0, 0)
    expect(Number.isFinite(gap.seconds)).toBe(true)
    expect(gap.seconds).toBeLessThan(2)
  })

  it('identifica o lado do rival', () => {
    expect(rivalSide(0.3, -0.4)).toBe('esquerda')
    expect(rivalSide(-0.4, 0.3)).toBe('direita')
    expect(rivalSide(0.2, 0.25)).toBe('mesma faixa')
  })

  it('escreve os avisos no formato do plano', () => {
    expect(positionNotice(gapBetween(300, 398, 252, 252))).toBe('P2 — Rival 1,4 s à frente')
    expect(offScreenNotice(gapBetween(300, 220, 252, 252), 'esquerda')).toBe(
      'Adversário atrás — lado esquerda — 80 m',
    )
  })
})
