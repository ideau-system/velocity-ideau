import { describe, expect, it } from 'vitest'
import { CARS } from './cars'
import {
  corDoTexto,
  degrausDasEtiquetas,
  hierarquiaDosFantasmas,
  linhasDosRotulos,
  NOMES_NA_PISTA,
  opacidadeDaEtiqueta,
  opacidadeDoFantasma,
} from './fantasmaNaTela'
import { VIEW_DISTANCE } from './track'

describe('transparência do fantasma', () => {
  const normal = { semSinal: false, chegou: false }

  it('perto é translúcido como sempre foi', () => {
    expect(opacidadeDoFantasma(10, normal)).toBeCloseTo(0.46, 5)
  })

  it('longe ganha opacidade para não sumir na bruma, sem chegar a ser sólido', () => {
    const longe = opacidadeDoFantasma(VIEW_DISTANCE, normal)
    expect(longe).toBeGreaterThan(opacidadeDoFantasma(10, normal))
    expect(longe).toBeLessThan(0.75)
  })

  it('o recorde e o rival mais próximo ficam mais opacos; os demais, a meia opacidade', () => {
    const destaque = opacidadeDoFantasma(20, { ...normal, destaque: true })
    const comum = opacidadeDoFantasma(20, normal)
    expect(destaque).toBeGreaterThan(comum + 0.15)
    expect(comum).toBeCloseTo(0.5, 1)
    expect(opacidadeDoFantasma(VIEW_DISTANCE, normal)).toBeCloseTo(0.5, 1)
  })

  it('sem sinal apaga, e quem chegou fica discreto', () => {
    expect(opacidadeDoFantasma(100, { semSinal: true, chegou: false })).toBeLessThan(0.3)
    expect(opacidadeDoFantasma(100, { semSinal: false, chegou: true })).toBeLessThan(opacidadeDoFantasma(100, normal))
  })
})

describe('etiqueta do fantasma', () => {
  it('é inteira de perto e cede de longe, sem sumir', () => {
    expect(opacidadeDaEtiqueta(30)).toBe(1)
    expect(opacidadeDaEtiqueta(VIEW_DISTANCE)).toBeCloseTo(0.25, 5)
  })

  it('escolhe a cor da letra que se lê sobre a pintura', () => {
    expect(corDoTexto('#ffffff')).toBe('#0b0f14')
    expect(corDoTexto('#000000')).toBe('#ffffff')
    expect(corDoTexto('#ff0')).toBe('#0b0f14')
    expect(corDoTexto('não é cor')).toBe('#ffffff')
  })

  it('no radar, dois nomes na mesma coluna vão em linhas separadas', () => {
    expect(linhasDosRotulos([{ x: 100, largura: 60 }, { x: 110, largura: 60 }])).toEqual([0, 1])
  })

  it('no radar, nomes em colunas distantes dividem a mesma linha', () => {
    expect(linhasDosRotulos([{ x: 100, largura: 60 }, { x: 300, largura: 60 }])).toEqual([0, 0])
  })

  it('no radar, sem linha livre, fica só a seta', () => {
    const empilhados = Array.from({ length: 4 }, () => ({ x: 150, largura: 50 }))
    expect(linhasDosRotulos(empilhados)).toEqual([0, 1, 2, null])
  })

  it('a hierarquia destaca o rival mais próximo e o recorde, e dá nome só aos dois mais próximos', () => {
    const hierarquia = hierarquiaDosFantasmas([
      { id: 'longe', distancia: 150, recorde: false },
      { id: 'perto', distancia: 8, recorde: false },
      { id: 'meio', distancia: 40, recorde: false },
      { id: 'atras', distancia: 60, recorde: false },
    ])
    expect(hierarquia.get('perto')).toEqual({ destaque: true, comNome: true })
    expect(hierarquia.get('meio')).toEqual({ destaque: false, comNome: true })
    expect(hierarquia.get('atras')).toEqual({ destaque: false, comNome: false })
    expect(hierarquia.get('longe')).toEqual({ destaque: false, comNome: false })
    expect([...hierarquia.values()].filter((h) => h.comNome)).toHaveLength(NOMES_NA_PISTA)
  })

  it('o fantasma do recorde fica sempre em destaque e com nome, sem tirar o destaque do rival', () => {
    const hierarquia = hierarquiaDosFantasmas([
      { id: 'recorde', distancia: 300, recorde: true },
      { id: 'rival', distancia: 12, recorde: false },
    ])
    expect(hierarquia.get('recorde')).toEqual({ destaque: true, comNome: true })
    expect(hierarquia.get('rival')?.destaque).toBe(true)
  })

  it('etiquetas de um pelotão sobem em degraus em vez de se empilhar no mesmo ponto', () => {
    const pelotao = Array.from({ length: 5 }, (_, i) => ({ x: 100 + i * 3, y: 200, largura: 70, altura: 15 }))
    expect(degrausDasEtiquetas(pelotao)).toEqual([0, 1, 2, null, null])
  })

  it('etiquetas de carros separados ficam cada uma no seu lugar', () => {
    const espalhados = [
      { x: 100, y: 200, largura: 70, altura: 15 },
      { x: 300, y: 200, largura: 70, altura: 15 },
      { x: 150, y: 120, largura: 50, altura: 13 },
    ]
    expect(degrausDasEtiquetas(espalhados)).toEqual([0, 0, 0])
  })

  it('toda pintura da garagem tem uma cor de letra definida', () => {
    for (const car of CARS) expect(['#0b0f14', '#ffffff']).toContain(corDoTexto(car.accent))
  })
})
