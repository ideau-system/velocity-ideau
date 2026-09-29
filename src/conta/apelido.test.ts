import { describe, expect, it } from 'vitest'
import { apelidoComNumero, apelidoValidoDe, chaveDoApelido, limparApelido, problemaNoApelido } from './apelido'

describe('nome de piloto', () => {
  it('vale de 3 a 16 caracteres, com letras, números e alguns sinais', () => {
    expect(problemaNoApelido('Rafa')).toBeNull()
    expect(problemaNoApelido('João_Pé-de.Chumbo'.slice(0, 16))).toBeNull()
    expect(problemaNoApelido('Ná 7')).toBeNull()
    expect(problemaNoApelido('ab')).toContain('pelo menos 3')
    expect(problemaNoApelido('   ab   ')).toContain('pelo menos 3')
    expect(problemaNoApelido('Um nome grande demais')).toContain('no máximo 16')
    expect(problemaNoApelido('<script>')).toContain('Use letras')
    expect(problemaNoApelido('_rafa')).toContain('Use letras')
    expect(problemaNoApelido(42)).toContain('pelo menos 3')
  })

  it('espaços repetidos viram um, e a unicidade não vê maiúsculas', () => {
    expect(limparApelido('  Ana   Paula ')).toBe('Ana Paula')
    expect(chaveDoApelido('ANA  Paula')).toBe(chaveDoApelido('ana paula'))
    expect(chaveDoApelido('ÁGATA')).toBe('ágata')
  })

  it('o número no fim não passa do tamanho máximo', () => {
    expect(apelidoComNumero('Rafa', 2)).toBe('Rafa2')
    expect(apelidoComNumero('Dezesseis Letras', 12)).toBe('Dezesseis Letr12')
    expect(apelidoComNumero('Quinze letras x', 3)).toBe('Quinze letras x3')
    // O corte não deixa espaço antes do número.
    expect(apelidoComNumero('Quinze letras x', 12)).toBe('Quinze letras12')
  })

  it('sem apelido que valha, sai do e-mail, e em último caso é Piloto', () => {
    expect(apelidoValidoDe('Rafa', 'outro@x.com')).toBe('Rafa')
    expect(apelidoValidoDe(null, 'rafa.severo@gmail.com')).toBe('rafa.severo')
    expect(apelidoValidoDe('x', '__rafa+jogo@gmail.com')).toBe('rafajogo')
    expect(apelidoValidoDe(null, 'um.email.muito.comprido@x.com')).toBe('um.email.muito.c')
    expect(apelidoValidoDe(null, 'ab@x.com')).toBe('Piloto')
    expect(apelidoValidoDe(null, null)).toBe('Piloto')
  })
})
