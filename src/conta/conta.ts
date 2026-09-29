import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { limparApelido } from './apelido'
import { supabase } from './supabase'

/**
 * A conta do piloto, no Supabase Auth: e-mail e senha.
 *
 * O login é todo do Supabase — a senha vai direto do aparelho para ele, por
 * HTTPS, e nunca passa pelo servidor do jogo. O que o servidor recebe é o
 * token de acesso da sessão, que ele confere com as chaves públicas do
 * projeto. O nome de piloto vai nos metadados do cadastro, e é dali que o
 * servidor cria o perfil na primeira entrada.
 */

/** A sessão, como o jogo a usa. */
export type SessaoDaConta = {
  email: string | null
  /** O token de acesso, que vai para o servidor do jogo. */
  token: string
}

export type ResultadoDaConta = { ok: true } | { ok: false; erro: string }

/** Senha mínima: a do Supabase é 6, e o jogo pede um pouco mais. */
export const SENHA_MINIMA = 8

function sessaoDe(session: Session | null): SessaoDaConta | null {
  return session ? { email: session.user.email ?? null, token: session.access_token } : null
}

/** A sessão guardada no aparelho, renovada se o token venceu; null sem conta. */
export async function sessaoAtual(): Promise<SessaoDaConta | null> {
  try {
    const { data } = await (await supabase()).auth.getSession()
    return sessaoDe(data.session)
  } catch {
    return null
  }
}

/**
 * Avisa a cada mudança de sessão — entrou, renovou o token, saiu — e quando
 * o piloto volta pelo link de trocar a senha.
 */
export async function aoMudarASessao(aviso: (sessao: SessaoDaConta | null, evento: AuthChangeEvent) => void) {
  const { data } = (await supabase()).auth.onAuthStateChange((evento, session) => aviso(sessaoDe(session), evento))
  return () => data.subscription.unsubscribe()
}

/**
 * Cria a conta. Quando o projeto pede confirmação de e-mail, a sessão só
 * existe depois do link: `confirmar` diz à tela para pedir isso.
 */
export async function cadastrar(dados: { email: string; senha: string; apelido: string }): Promise<
  { ok: true; confirmar: boolean } | { ok: false; erro: string }
> {
  try {
    const { data, error } = await (await supabase()).auth.signUp({
      email: dados.email.trim(),
      password: dados.senha,
      options: { data: { apelido: limparApelido(dados.apelido) }, emailRedirectTo: enderecoDeVolta() },
    })
    if (error) return { ok: false, erro: traduzirErro(error) }
    // Com a confirmação ligada, um e-mail já cadastrado volta sem erro e sem
    // identidade — é assim que o Supabase evita revelar quem tem conta.
    if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
      return { ok: false, erro: 'Este e-mail já tem conta. Entre com ele.' }
    }
    return { ok: true, confirmar: !data.session }
  } catch (erro) {
    return { ok: false, erro: traduzirErro(erro) }
  }
}

export async function entrar(email: string, senha: string): Promise<ResultadoDaConta> {
  try {
    const { error } = await (await supabase()).auth.signInWithPassword({ email: email.trim(), password: senha })
    return error ? { ok: false, erro: traduzirErro(error) } : { ok: true }
  } catch (erro) {
    return { ok: false, erro: traduzirErro(erro) }
  }
}

export async function sair() {
  try {
    await (await supabase()).auth.signOut()
  } catch {
    // Sem rede, a sessão local sai mesmo assim na próxima abertura.
  }
}

/** Troca a senha de quem está na conta — também a do link de recuperação. */
export async function trocarSenha(nova: string): Promise<ResultadoDaConta> {
  try {
    const { error } = await (await supabase()).auth.updateUser({ password: nova })
    return error ? { ok: false, erro: traduzirErro(error) } : { ok: true }
  } catch (erro) {
    return { ok: false, erro: traduzirErro(erro) }
  }
}

/** Manda o link de trocar a senha. Só funciona com o envio de e-mail do projeto configurado. */
export async function pedirNovaSenha(email: string): Promise<ResultadoDaConta> {
  try {
    const { error } = await (await supabase()).auth.resetPasswordForEmail(email.trim(), { redirectTo: enderecoDeVolta() })
    return error ? { ok: false, erro: traduzirErro(error) } : { ok: true }
  } catch (erro) {
    return { ok: false, erro: traduzirErro(erro) }
  }
}

/** Para onde os links do e-mail trazem o piloto: a página do jogo, sem sala nem parâmetro. */
function enderecoDeVolta() {
  return `${location.origin}${location.pathname}`
}

/** O que o Supabase respondeu, em português e dito para quem joga. */
export function traduzirErro(erro: unknown): string {
  const { code, message, name, status } = (erro ?? {}) as { code?: string; message?: string; name?: string; status?: number }
  const texto = (message ?? '').toLowerCase()
  if (name === 'AuthRetryableFetchError' || status === 0 || texto.includes('failed to fetch') || texto.includes('network')) {
    return 'Sem conexão com o serviço de contas. Confira a internet ou jogue como convidado.'
  }
  switch (code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.'
    case 'email_not_confirmed':
      return 'Confirme o e-mail antes de entrar: o link está na sua caixa de entrada.'
    case 'user_already_exists':
    case 'email_exists':
      return 'Este e-mail já tem conta. Entre com ele.'
    case 'weak_password':
      return 'Senha fraca demais. Use pelo menos 8 caracteres, misturando letras e números.'
    case 'same_password':
      return 'A senha nova precisa ser diferente da atual.'
    case 'email_address_invalid':
    case 'validation_failed':
      return 'Confira o e-mail: ele não parece válido.'
    case 'email_address_not_authorized':
      return 'O envio de e-mail deste jogo ainda não está configurado. Peça ao organizador para liberar o cadastro.'
    case 'over_email_send_rate_limit':
      return 'O jogo enviou e-mails demais agora. Tente de novo em alguns minutos.'
    case 'over_request_rate_limit':
      return 'Muitas tentativas agora. Espere alguns minutos e tente de novo.'
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'O cadastro está fechado no momento.'
    case 'user_banned':
      return 'Esta conta está suspensa.'
    case 'reauthentication_needed':
      return 'Por segurança, saia e entre de novo antes de trocar a senha.'
  }
  if (texto.includes('invalid login')) return 'E-mail ou senha incorretos.'
  if (texto.includes('already registered')) return 'Este e-mail já tem conta. Entre com ele.'
  if (texto.includes('not authorized')) return 'O envio de e-mail deste jogo ainda não está configurado. Peça ao organizador para liberar o cadastro.'
  if (texto.includes('rate limit')) return 'Muitas tentativas agora. Espere alguns minutos e tente de novo.'
  return 'Não foi possível falar com o serviço de contas. Tente de novo.'
}
