import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { apelidoValidoDe } from '../src/conta/apelido.js'

/**
 * Contas: o login é do Supabase Auth, e o servidor do jogo só confere.
 *
 * O navegador entra com e-mail e senha direto no Supabase, que devolve um token
 * de acesso assinado (JWT). O aparelho manda esse token pelo socket, e o
 * servidor o confere com as chaves públicas do projeto: nenhuma senha passa por
 * aqui, e o Supabase não é consultado a cada conexão — as chaves ficam em
 * cache. O id do usuário lá é o id do perfil aqui.
 */

/** Quem é a conta, depois de conferido o token. */
export type ContaVerificada = {
  id: string
  email: string | null
  /** O apelido que o cadastro guardou nos metadados, já valendo. */
  apelido: string
}

/** Confere um token de acesso. Devolve null para o token que não vale. */
export type VerificadorDeContas = (token: string) => Promise<ContaVerificada | null>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** O projeto do Supabase deste jogo. O endereço é público: é o mesmo que o navegador usa. */
export const SUPABASE_URL_PADRAO = 'https://lpgjoggvndflebcicjjl.supabase.co'

/**
 * O verificador de produção: o token precisa ter sido assinado por uma das
 * chaves do projeto, ser de um usuário autenticado e não ter vencido.
 */
export function verificadorDoSupabase(url: string): VerificadorDeContas {
  const emissor = `${url.replace(/\/+$/, '')}/auth/v1`
  const chaves = createRemoteJWKSet(new URL(`${emissor}/.well-known/jwks.json`))
  return async (token) => {
    if (typeof token !== 'string' || token.length > 8_192) return null
    try {
      const { payload } = await jwtVerify(token, chaves, { issuer: emissor, audience: 'authenticated' })
      return contaDoToken(payload)
    } catch {
      return null
    }
  }
}

/** A conta que o conteúdo de um token conferido descreve. */
export function contaDoToken(payload: JWTPayload): ContaVerificada | null {
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) return null
  // Um usuário anônimo do Supabase não tem cadastro: para o jogo, é convidado.
  if (payload.role !== 'authenticated' || payload.is_anonymous === true) return null
  const email = typeof payload.email === 'string' ? payload.email : null
  const metadados = payload.user_metadata && typeof payload.user_metadata === 'object' ? (payload.user_metadata as Record<string, unknown>) : {}
  const apelido = typeof metadados.apelido === 'string' ? metadados.apelido : null
  return { id: payload.sub.toLowerCase(), email, apelido: apelidoValidoDe(apelido, email) }
}

const PREFIXO_DE_TESTE = 'teste:'

/** Um token de teste: `teste:<uuid>:<apelido>`. */
export function tokenDeTeste(id: string, apelido: string) {
  return `${PREFIXO_DE_TESTE}${id}:${apelido}`
}

/**
 * Aceita os tokens de teste, para os testes automáticos e para os pilotos
 * virtuais correrem a ranqueada sem conta de verdade. No servidor de produção
 * só existe com `CONTAS_DE_TESTE=1`, e ele avisa isso na subida.
 */
export function verificadorDeTeste(): VerificadorDeContas {
  return async (token) => {
    if (typeof token !== 'string' || !token.startsWith(PREFIXO_DE_TESTE)) return null
    const resto = token.slice(PREFIXO_DE_TESTE.length)
    const separador = resto.indexOf(':')
    const id = separador > 0 ? resto.slice(0, separador) : ''
    if (!UUID.test(id)) return null
    return { id: id.toLowerCase(), email: null, apelido: apelidoValidoDe(resto.slice(separador + 1), null) }
  }
}

/** Tenta os verificadores em ordem: vale o primeiro que reconhecer o token. */
export function verificadores(...lista: VerificadorDeContas[]): VerificadorDeContas {
  return async (token) => {
    for (const verificar of lista) {
      const conta = await verificar(token)
      if (conta) return conta
    }
    return null
  }
}
