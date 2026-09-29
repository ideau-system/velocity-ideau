import { describe, expect, it } from 'vitest'
import { Comandos, ladoDoDedo } from './toque'

describe('comandos da corrida', () => {
  it('um toque que começa e acaba entre dois quadros vale por um quadro', () => {
    const comandos = new Comandos()
    comandos.dedoDesceu(1, 'left')
    comandos.dedoSubiu(1)
    expect(comandos.consumir()).toMatchObject({ left: true, right: false, boost: false })
    expect(comandos.consumir()).toMatchObject({ left: false, right: false, boost: false })
  })

  it('o comando segurado continua ligado em todos os quadros', () => {
    const comandos = new Comandos()
    comandos.dedoDesceu(1, 'boost')
    expect(comandos.consumir().boost).toBe(true)
    expect(comandos.consumir().boost).toBe(true)
    comandos.dedoSubiu(1)
    expect(comandos.consumir().boost).toBe(false)
  })

  it('um toque na contagem não vaza para a largada', () => {
    const comandos = new Comandos()
    comandos.dedoDesceu(1, 'right')
    comandos.dedoSubiu(1)
    // Quadro da contagem: consumido e descartado.
    comandos.consumir()
    expect(comandos.consumir().right).toBe(false)
  })

  it('dois dedos no mesmo botão: soltar um mantém o comando', () => {
    const comandos = new Comandos()
    comandos.dedoDesceu(1, 'left')
    comandos.dedoDesceu(2, 'left')
    comandos.dedoSubiu(1)
    comandos.consumir()
    expect(comandos.consumir().left).toBe(true)
    comandos.dedoSubiu(2)
    expect(comandos.consumir().left).toBe(false)
  })

  it('o dedo que desliza leva o comando para o outro lado', () => {
    const comandos = new Comandos()
    comandos.dedoDesceu(7, 'left')
    comandos.consumir()
    comandos.dedoMudou(7, 'right')
    expect(comandos.consumir()).toMatchObject({ left: false, right: true, boost: false })
    expect(comandos.dedoSubiu(7)).toBe('right')
  })

  it('deslizar um dedo que já subiu não liga nada', () => {
    const comandos = new Comandos()
    comandos.dedoMudou(3, 'right')
    expect(comandos.consumir().right).toBe(false)
  })

  it('teclado e dedo no mesmo comando: soltar um não solta o outro', () => {
    const comandos = new Comandos()
    comandos.tecla('boost', true)
    comandos.dedoDesceu(1, 'boost')
    comandos.dedoSubiu(1)
    comandos.consumir()
    expect(comandos.consumir().boost).toBe(true)
    comandos.tecla('boost', false)
    expect(comandos.consumir().boost).toBe(false)
  })

  it('a tecla que repete não cria toque novo', () => {
    const comandos = new Comandos()
    comandos.tecla('left', true)
    comandos.consumir()
    comandos.tecla('left', true)
    comandos.tecla('left', false)
    expect(comandos.consumir().left).toBe(false)
  })

  it('soltar tudo apaga dedos, teclas e toques pendentes', () => {
    const comandos = new Comandos()
    comandos.tecla('right', true)
    comandos.dedoDesceu(1, 'left')
    comandos.dedoDesceu(2, 'boost')
    comandos.soltarTudo()
    expect(comandos.consumir()).toMatchObject({ left: false, right: false, boost: false })
    expect(comandos.dedoEm('left')).toBe(false)
  })
})

describe('pedais e borboletas', () => {
  it('sem o acelerador automático, o pé só vai ao fundo com a tecla', () => {
    const comandos = new Comandos()
    expect(comandos.consumir().throttle).toBe(false)
    comandos.tecla('throttle', true)
    expect(comandos.consumir().throttle).toBe(true)
    comandos.tecla('throttle', false)
    expect(comandos.consumir().throttle).toBe(false)
  })

  it('no toque o pé fica no fundo sozinho, e o freio vai junto quando o dedo aperta', () => {
    const comandos = new Comandos()
    comandos.aceleradorAutomatico = true
    expect(comandos.consumir()).toMatchObject({ throttle: true, brake: false })
    comandos.dedoDesceu(4, 'brake')
    expect(comandos.consumir()).toMatchObject({ throttle: true, brake: true })
    comandos.dedoSubiu(4)
    expect(comandos.consumir().brake).toBe(false)
  })

  it('um toque rápido no freio, entre dois quadros, freia por um quadro', () => {
    const comandos = new Comandos()
    comandos.dedoDesceu(2, 'brake')
    comandos.dedoSubiu(2)
    expect(comandos.consumir().brake).toBe(true)
    expect(comandos.consumir().brake).toBe(false)
  })

  it('cada toque na borboleta troca uma marcha, um por quadro, e segurar não troca outra', () => {
    const comandos = new Comandos()
    comandos.manual = true
    comandos.borboleta('shiftUp')
    comandos.borboleta('shiftUp')
    expect(comandos.consumir()).toMatchObject({ shiftUp: true, shiftDown: false, manual: true })
    expect(comandos.consumir().shiftUp).toBe(true)
    expect(comandos.consumir().shiftUp).toBe(false)
    comandos.borboleta('shiftDown')
    expect(comandos.consumir()).toMatchObject({ shiftUp: false, shiftDown: true })
    expect(comandos.consumir().shiftDown).toBe(false)
  })

  it('o câmbio vai em todo quadro, para o registro saber quando mudou', () => {
    const comandos = new Comandos()
    expect(comandos.consumir().manual).toBe(false)
    comandos.manual = true
    expect(comandos.consumir().manual).toBe(true)
  })

  it('soltar tudo esquece as borboletas tocadas e ainda não trocadas', () => {
    const comandos = new Comandos()
    comandos.borboleta('shiftUp')
    comandos.tecla('brake', true)
    comandos.soltarTudo()
    expect(comandos.consumir()).toMatchObject({ shiftUp: false, brake: false })
  })
})

describe('dedo que desliza entre as setas', () => {
  // ‹ vai até x = 71; › começa em x = 78: o vão de 7 px é neutro.
  const FIM_DA_ESQUERDA = 71
  const INICIO_DA_DIREITA = 78

  it('só troca de lado quando entra no outro botão', () => {
    expect(ladoDoDedo(74, 'left', FIM_DA_ESQUERDA, INICIO_DA_DIREITA)).toBe('left')
    expect(ladoDoDedo(78, 'left', FIM_DA_ESQUERDA, INICIO_DA_DIREITA)).toBe('right')
    expect(ladoDoDedo(74, 'right', FIM_DA_ESQUERDA, INICIO_DA_DIREITA)).toBe('right')
    expect(ladoDoDedo(71, 'right', FIM_DA_ESQUERDA, INICIO_DA_DIREITA)).toBe('left')
  })

  it('tremer no vão não troca de lado', () => {
    let lado: 'left' | 'right' = 'left'
    for (const x of [70, 73, 76, 72, 77, 74]) lado = ladoDoDedo(x, lado, FIM_DA_ESQUERDA, INICIO_DA_DIREITA)
    expect(lado).toBe('left')
  })
})
