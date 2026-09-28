import { describe, expect, it } from 'vitest'
import { MASTER_GAIN } from './audio'
import { CARS } from './cars'
import {
  CAMADAS,
  CAMADA_DO_ALIVIO,
  ESCAPAMENTO,
  GIRO_DEPOIS_DA_TROCA,
  HISTERESE,
  MOTOR_PADRAO,
  RPM_DA_LARGADA,
  RPM_DA_TROCA,
  VOZES,
  camadasDaVoz,
  marchasDoMotor,
  pesosDasCamadas,
  pisoDaVoz,
  profundidadeDaVoz,
  rotacaoF1,
  rpmDaVoz,
  taxaDaCamada,
  trocasDoMotor,
  volumeDoMotor,
  vozDoCarro,
  type EspecificacaoDoMotor,
} from './motorF1'
import { DIFFICULTIES, rulesFor } from './rules'
import { GIRO_DA_TROCA_AUTOMATICA, NUMERO_DE_MARCHAS, QUEDAS_DO_CAMBIO, velocidadeDaMarcha } from './simulation'

const TODAS = Object.values(VOZES)

/** Os laços que existem de fato em public/audio/motor, pelo endereço com que o jogo os pede. */
const LACOS_NO_DISCO = new Set(
  Object.keys(import.meta.glob('/public/audio/motor/*.wav')).map((caminho) => caminho.replace(/^\/public/, '')),
)

/** Sobe a velocidade de 0 a `ate` guardando a marcha, como a corrida faz quadro a quadro. */
function subida(voz: EspecificacaoDoMotor, ate = 1, passo = 0.001) {
  const estados = []
  let marcha = 0
  for (let v = 0; v <= ate + 1e-9; v += passo) {
    const estado = rotacaoF1(v, marcha, voz)
    marcha = estado.marcha
    estados.push({ v, ...estado })
  }
  return estados
}

describe.each(TODAS)('câmbio: $nome', (voz) => {
  const marchas = marchasDoMotor(voz)

  it('cada marcha é mais longa que a anterior, e há uma troca a menos que marchas', () => {
    expect(marchas).toHaveLength(voz.quedas.length + 1)
    for (let i = 1; i < marchas.length; i += 1) expect(marchas[i]).toBeLessThan(marchas[i - 1])
    expect(trocasDoMotor(voz)).toHaveLength(marchas.length - 1)
    expect(voz.largada).toBeLessThan(voz.troca)
    expect(voz.troca).toBeLessThan(voz.corte)
  })

  it('o cruzeiro de todos os níveis cai na penúltima marcha, perto do topo do giro', () => {
    // O cruzeiro é onde o piloto passa a maior parte da prova: é esta a nota
    // que define a voz do carro.
    for (const nivel of DIFFICULTIES) {
      const regras = rulesFor(nivel)
      const { marcha, rpm } = subida(voz, regras.cruiseSpeed / regras.boostSpeed).at(-1)!
      expect(marcha, nivel).toBe(marchas.length - 2)
      expect(rpm / voz.troca, nivel).toBeGreaterThan(0.85)
      expect(rpm / voz.troca, nivel).toBeLessThan(0.98)
    }
  })

  it('o topo do boost leva a última marcha à rotação da troca, sem passar do corte', () => {
    const { marcha, rpm } = subida(voz, 1).at(-1)!
    expect(marcha).toBe(marchas.length - 1)
    expect(rpm).toBeCloseTo(voz.troca, -1)
    expect(rotacaoF1(1.2, marchas.length - 1, voz).rpm).toBeLessThanOrEqual(voz.corte)
  })

  it('larga com a embreagem patinando e sobe todas as trocas, cada uma com a queda de corrida', () => {
    const estados = subida(voz)
    expect(estados[0]).toMatchObject({ marcha: 0, rpm: voz.largada })
    let trocas = 0
    for (let i = 1; i < estados.length; i += 1) {
      if (estados[i].marcha === estados[i - 1].marcha) continue
      trocas += 1
      expect(estados[i - 1].rpm).toBeGreaterThan(voz.troca * 0.99)
      const queda = estados[i].rpm / estados[i - 1].rpm
      expect(queda).toBeGreaterThan(0.66)
      expect(queda).toBeLessThan(0.92)
    }
    expect(trocas).toBe(marchas.length - 1)
  })

  it('a rotação fica sempre entre o giro da largada e o corte', () => {
    for (const { rpm } of subida(voz, 1.2)) {
      expect(rpm).toBeGreaterThanOrEqual(voz.largada - 1e-6)
      expect(rpm).toBeLessThanOrEqual(voz.corte)
    }
  })

  it('andando em cima de uma troca, não sobe e desce de marcha a cada quadro', () => {
    // Na grama ou encostado num obstáculo, a velocidade fica tremendo em volta
    // de um valor. Sem a folga, o motor gagueja.
    const troca = trocasDoMotor(voz)[1]
    let marcha = rotacaoF1(troca + 0.01, 0, voz).marcha
    let mudancas = 0
    for (let i = 0; i < 400; i += 1) {
      const estado = rotacaoF1(troca + Math.sin(i * 0.7) * (HISTERESE * 0.6), marcha, voz)
      if (estado.marcha !== marcha) mudancas += 1
      marcha = estado.marcha
    }
    expect(mudancas).toBeLessThanOrEqual(1)
  })
})

describe.each(TODAS)('camadas: $nome', (voz) => {
  it('as camadas cheias estão em ordem de rotação, e o alívio, se há, vem por último', () => {
    for (let i = 1; i < voz.camadas.length; i += 1) expect(voz.camadas[i].rpm).toBeGreaterThan(voz.camadas[i - 1].rpm)
    const todas = camadasDaVoz(voz)
    expect(todas).toHaveLength(voz.camadas.length + (voz.alivio ? 1 : 0))
    if (voz.alivio) expect(todas.at(-1)).toBe(voz.alivio)
  })

  it('todo laço da voz existe em public/audio/motor', () => {
    for (const camada of camadasDaVoz(voz)) expect(LACOS_NO_DISCO.has(camada.arquivo), camada.arquivo).toBe(true)
  })

  it('a mistura tem potência constante: a soma dos quadrados é sempre um', () => {
    for (let rpm = 6_000; rpm <= 20_000; rpm += 125) {
      for (const carga of [0, 0.3, 0.7, 1]) {
        const potencia = pesosDasCamadas(rpm, carga, voz).reduce((soma, p) => soma + p * p, 0)
        expect(potencia).toBeCloseTo(1, 6)
      }
    }
  })

  it('na rotação de uma camada, só ela toca', () => {
    for (const [i, camada] of voz.camadas.entries()) {
      const pesos = pesosDasCamadas(camada.rpm, 1, voz)
      expect(pesos[i]).toBeCloseTo(1, 6)
      expect(pesos.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 6)
    }
  })

  it('a camada que domina nunca é esticada mais de um quinto', () => {
    // A gravação esticada demais vira desenho animado. A que manda no som —
    // metade do peso ou mais — fica sempre a menos de um quinto da própria
    // rotação, e a que já está saindo, a menos de três décimos, do giro que o
    // piloto segura no grid até o corte.
    for (let rpm = Math.min(voz.largada, voz.segurando - 700); rpm <= voz.corte; rpm += 50) {
      const pesos = pesosDasCamadas(rpm, 1, voz)
      voz.camadas.forEach((camada, i) => {
        const esticada = Math.abs(taxaDaCamada(camada, rpm) - 1)
        if (pesos[i] >= 0.5) expect(esticada, `${camada.nome} a ${rpm} rpm`).toBeLessThan(0.2)
        if (pesos[i] >= 0.2) expect(esticada, `${camada.nome} a ${rpm} rpm`).toBeLessThan(0.3)
      })
    }
  })

  it('o volume sobe com o giro e com o boost, e nunca estoura', () => {
    const base = { speed: 0.5, boost: 0, offRoad: 0, running: true }
    expect(volumeDoMotor(base, voz.troca, voz)).toBeGreaterThan(volumeDoMotor(base, voz.largada, voz))
    expect(volumeDoMotor({ ...base, boost: 1 }, voz.largada, voz)).toBeGreaterThan(volumeDoMotor(base, voz.largada, voz))
    for (let rpm = 5_000; rpm <= 20_000; rpm += 500) {
      for (const boost of [0, 1, 5]) {
        const volume = volumeDoMotor({ ...base, boost }, rpm, voz)
        expect(volume).toBeGreaterThan(0)
        // O laço mais forte tem pico de 0,77: vezes o maior volume, com o
        // volume geral por cima, fica abaixo de oito décimos na saída.
        expect(volume * 0.77 * MASTER_GAIN).toBeLessThan(0.8)
      }
    }
  })
})

describe('voz de cada carro', () => {
  it('todo carro da garagem tem uma voz, e o desconhecido anda com a padrão', () => {
    for (const car of CARS) expect(TODAS, car.id).toContain(vozDoCarro(car.id))
    expect(vozDoCarro(null)).toBe(MOTOR_PADRAO)
    expect(vozDoCarro('ferrari-f40' as never)).toBe(MOTOR_PADRAO)
  })

  it('cada época ganha o motor dela', () => {
    expect(vozDoCarro('senna').id).toBe('honda-v6-turbo')
    expect(vozDoCarro('senna-lotus').id).toBe('tag-v6-turbo')
    expect(vozDoCarro('alonso-renault').id).toBe('renault-v10')
    expect(vozDoCarro('barrichello-brawn').id).toBe('mercedes-v8')
    expect(vozDoCarro('vettel').id).toBe('renault-v8')
    expect(vozDoCarro('verstappen').id).toBe('hibrido-v6')
    // As duas Ferrari de V10 não soam iguais.
    expect(vozDoCarro('schumacher').id).not.toBe(vozDoCarro('barrichello-ferrari').id)
  })

  it('todas as vozes são usadas por algum carro', () => {
    const usadas = new Set(CARS.map((car) => vozDoCarro(car.id).id))
    for (const voz of TODAS) expect(usadas.has(voz.id), voz.id).toBe(true)
  })
})

describe('voz padrão: o V10 da MP4-16', () => {
  it('o cruzeiro cai na sexta, no grito de uns dezessete mil', () => {
    for (const nivel of DIFFICULTIES) {
      const regras = rulesFor(nivel)
      const { marcha, rpm } = subida(MOTOR_PADRAO, regras.cruiseSpeed / regras.boostSpeed).at(-1)!
      expect(marcha, nivel).toBe(5)
      expect(rpm, nivel).toBeGreaterThan(16_500)
      expect(rpm, nivel).toBeLessThan(17_800)
    }
  })

  it('sem carga, só o alívio toca', () => {
    const pesos = pesosDasCamadas(15_000, 0)
    expect(pesos.at(-1)).toBeCloseTo(1, 6)
    for (const peso of pesos.slice(0, -1)) expect(peso).toBeCloseTo(0, 6)
    expect(CAMADAS.at(-1)).toBe(CAMADA_DO_ALIVIO)
  })

  it('perdendo velocidade, reduz de marcha', () => {
    const trocas = trocasDoMotor()
    expect(rotacaoF1(0.7, 4).marcha).toBe(4)
    expect(rotacaoF1(trocas[3] - HISTERESE - 0.01, 4).marcha).toBe(3)
  })

  it('aguenta valores estranhos sem enlouquecer', () => {
    expect(rotacaoF1(Number.NaN, 3)).toEqual(rotacaoF1(0, 3))
    expect(rotacaoF1(-5, 0).rpm).toBe(RPM_DA_LARGADA)
    expect(rotacaoF1(0.5, 99).marcha).toBeLessThanOrEqual(6)
    expect(RPM_DA_TROCA).toBe(MOTOR_PADRAO.troca)
  })
})

describe.each(TODAS)('o motor segue o câmbio da física: $nome', (voz) => {
  it('o corte da física é o corte da voz, e o giro sobe com o giro da física', () => {
    expect(rpmDaVoz(voz, 3, 1)).toBeCloseTo(voz.corte, 6)
    let anterior = 0
    for (let giro = 0; giro <= 1; giro += 0.01) {
      const rpm = rpmDaVoz(voz, 3, giro)
      expect(rpm).toBeGreaterThanOrEqual(anterior)
      expect(rpm).toBeLessThanOrEqual(voz.corte)
      anterior = rpm
    }
  })

  it('na primeira a embreagem patina: o motor não cai abaixo do giro da largada', () => {
    for (let giro = 0; giro <= 1; giro += 0.05) expect(rpmDaVoz(voz, 0, giro)).toBeGreaterThanOrEqual(voz.largada)
  })

  it('cada troca feita no ponto cai dentro da faixa em que a gravação soa natural', () => {
    // Da janela ao corte, em toda marcha: o giro que sobra depois da troca
    // nunca passa abaixo do piso da voz, onde a camada que domina já estaria
    // esticada mais de um quinto.
    for (let marcha = 0; marcha < NUMERO_DE_MARCHAS - 1; marcha += 1) {
      for (const antes of [0.8, 0.9, GIRO_DA_TROCA_AUTOMATICA, 1]) {
        const depois = antes * QUEDAS_DO_CAMBIO[marcha]
        const rpm = rpmDaVoz(voz, marcha + 1, depois)
        expect(rpm, `${marcha + 1}ª para ${marcha + 2}ª a ${antes}`).toBeGreaterThanOrEqual(pisoDaVoz(voz) - 1e-6)
        const pesos = pesosDasCamadas(rpm, 1, voz)
        voz.camadas.forEach((camada, i) => {
          if (pesos[i] >= 0.5) expect(Math.abs(taxaDaCamada(camada, rpm) - 1)).toBeLessThan(0.2)
        })
      }
    }
  })

  it('a queda na troca é a da física, ou o máximo dela que a gravação aguenta', () => {
    const profundidade = profundidadeDaVoz(voz)
    expect(profundidade).toBeGreaterThan(0.5)
    expect(profundidade).toBeLessThanOrEqual(1)
    // Na voz que aguenta, o motor cai exatamente o que a marcha cai.
    if (profundidade === 1) expect(rpmDaVoz(voz, 2, 0.8) / rpmDaVoz(voz, 1, 1)).toBeCloseTo(0.8, 6)
    expect(rpmDaVoz(voz, 1, GIRO_DEPOIS_DA_TROCA)).toBeGreaterThanOrEqual(pisoDaVoz(voz) - 1e-6)
  })

  it('numa marcha longa demais o motor se arrasta abaixo do piso, mas não some', () => {
    expect(rpmDaVoz(voz, 6, 0.1)).toBeLessThan(pisoDaVoz(voz))
    expect(rpmDaVoz(voz, 6, 0)).toBeGreaterThanOrEqual(pisoDaVoz(voz) * 0.8 - 1e-6)
  })

  it('o escapamento de cada voz estala sem estourar', () => {
    const { tom, forca } = ESCAPAMENTO[voz.id]
    expect(tom).toBeGreaterThan(500)
    expect(tom).toBeLessThan(4_000)
    // O estalo mais forte, somado ao baque, pelo volume geral, fica longe do teto da saída.
    expect(forca * 1.7 * MASTER_GAIN).toBeLessThan(0.5)
  })

  it('aguenta valores estranhos', () => {
    expect(rpmDaVoz(voz, 3, Number.NaN)).toBeGreaterThan(0)
    expect(rpmDaVoz(voz, Number.NaN, 0.5)).toBeGreaterThanOrEqual(voz.largada)
    expect(rpmDaVoz(voz, 3, 5)).toBeCloseTo(voz.corte, 6)
  })
})

describe('câmbio da física e voz padrão', () => {
  it('o cruzeiro de todos os níveis cai na quinta, no grito de uns dezessete mil', () => {
    for (const nivel of DIFFICULTIES) {
      const regras = rulesFor(nivel)
      const giro = regras.cruiseSpeed / velocidadeDaMarcha(regras, 4)
      const rpm = rpmDaVoz(MOTOR_PADRAO, 4, giro)
      expect(rpm, nivel).toBeGreaterThan(16_800)
      expect(rpm, nivel).toBeLessThan(18_000)
    }
  })
})
