import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tokenDeTeste, verificadorDeTeste, verificadorDoSupabase, verificadores, type VerificadorDeContas } from './contas.js'

/**
 * O servidor confere o token do Supabase Auth como o Supabase o emite: JWT
 * assinado com ES256, a chave pública publicada no JWKS do projeto. Aqui um
 * projeto de mentira publica a chave de um par gerado no teste.
 */

let projeto: Server
let url = ''
let chave: CryptoKey
let outraChave: CryptoKey
let verificar: VerificadorDeContas
const ID = '3f1f5c1e-8a4b-4c7d-9e2f-0a1b2c3d4e5f'

beforeAll(async () => {
  const par = await generateKeyPair('ES256')
  chave = par.privateKey
  outraChave = (await generateKeyPair('ES256')).privateKey
  const publica: JWK = { ...(await exportJWK(par.publicKey)), kid: 'chave-1', alg: 'ES256', use: 'sig' }
  projeto = createServer((pedido, resposta) => {
    if (pedido.url === '/auth/v1/.well-known/jwks.json') {
      resposta.setHeader('content-type', 'application/json')
      resposta.end(JSON.stringify({ keys: [publica] }))
      return
    }
    resposta.statusCode = 404
    resposta.end()
  })
  await new Promise<void>((resolve) => projeto.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(projeto.address() as AddressInfo).port}`
  verificar = verificadorDoSupabase(url)
})

afterAll(async () => {
  await new Promise((resolve) => projeto.close(resolve))
})

/** Um token como o do Supabase, com o que o teste quiser mudar. */
function token(conteudo: Record<string, unknown> = {}, opcoes: { assinar?: CryptoKey; emissor?: string; publico?: string; vence?: number } = {}) {
  return new SignJWT({ role: 'authenticated', email: 'ana@exemplo.com', user_metadata: { apelido: 'Ana Paula' }, ...conteudo })
    .setProtectedHeader({ alg: 'ES256', kid: 'chave-1' })
    .setSubject(ID)
    .setIssuer(opcoes.emissor ?? `${url}/auth/v1`)
    .setAudience(opcoes.publico ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opcoes.vence ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(opcoes.assinar ?? chave)
}

describe('token do Supabase Auth', () => {
  it('aceita o token assinado pelo projeto, e o apelido vem do cadastro', async () => {
    expect(await verificar(await token())).toEqual({ id: ID, email: 'ana@exemplo.com', apelido: 'Ana Paula' })
  })

  it('recusa assinatura de outra chave, outro emissor, outro público e token vencido', async () => {
    expect(await verificar(await token({}, { assinar: outraChave }))).toBeNull()
    expect(await verificar(await token({}, { emissor: 'https://outro.supabase.co/auth/v1' }))).toBeNull()
    expect(await verificar(await token({}, { publico: 'anon' }))).toBeNull()
    expect(await verificar(await token({}, { vence: Math.floor(Date.now() / 1000) - 60 }))).toBeNull()
    expect(await verificar('isto não é um token')).toBeNull()
  })

  it('usuário anônimo ou sem papel de autenticado é convidado', async () => {
    expect(await verificar(await token({ role: 'anon' }))).toBeNull()
    expect(await verificar(await token({ is_anonymous: true }))).toBeNull()
  })

  it('sem apelido que valha, usa o começo do e-mail', async () => {
    expect((await verificar(await token({ user_metadata: {} })))?.apelido).toBe('ana')
    expect((await verificar(await token({ user_metadata: { apelido: 'x' }, email: 'rafa.severo@exemplo.com' })))?.apelido).toBe('rafa.severo')
    expect((await verificar(await token({ user_metadata: null, email: null })))?.apelido).toBe('Piloto')
  })
})

describe('token de teste', () => {
  it('só vale com o prefixo e um UUID', async () => {
    const teste = verificadorDeTeste()
    expect(await teste(tokenDeTeste(ID, 'Beto'))).toEqual({ id: ID, email: null, apelido: 'Beto' })
    expect(await teste(tokenDeTeste('nao-e-uuid', 'Beto'))).toBeNull()
    expect(await teste(await token())).toBeNull()
  })

  it('juntos, vale o primeiro que reconhecer o token', async () => {
    const os = verificadores(verificadorDeTeste(), verificar)
    expect((await os(tokenDeTeste(ID, 'Beto')))?.apelido).toBe('Beto')
    expect((await os(await token()))?.apelido).toBe('Ana Paula')
    expect(await os('chute')).toBeNull()
  })
})
