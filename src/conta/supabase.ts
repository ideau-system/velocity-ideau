import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * O projeto do Supabase das contas.
 *
 * O endereço e a chave publicável são públicos por natureza — o navegador de
 * todo jogador os usa —, e ficam aqui como padrão para a hospedagem não
 * precisar de variável nenhuma. Quem quiser outro projeto passa as suas no
 * `.env` do Vite.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://lpgjoggvndflebcicjjl.supabase.co'
export const SUPABASE_CHAVE = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_q0bCJ7MBApQvophml5xKYw_8Jg7wH1D'

/** Onde o Supabase guarda a sessão no aparelho: a chave padrão dele, `sb-<projeto>-auth-token`. */
export const CHAVE_DA_SESSAO = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`

let cliente: Promise<SupabaseClient> | null = null

/**
 * O cliente do Supabase, baixado só quando a conta entra em cena.
 *
 * É a maior dependência do jogo depois do próprio jogo, e o convidado não
 * precisa dela: quem escolheu jogar sem conta não a baixa.
 */
export function supabase(): Promise<SupabaseClient> {
  cliente ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_CHAVE, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: CHAVE_DA_SESSAO },
    }),
  )
  return cliente
}

/** Se o aparelho guarda uma sessão — sem baixar o cliente para saber. */
export function haSessaoGuardada() {
  try {
    return Boolean(localStorage.getItem(CHAVE_DA_SESSAO))
  } catch {
    return false
  }
}

/**
 * Se o endereço traz a volta de um link do Supabase — a confirmação do
 * cadastro ou a troca de senha —, que o cliente precisa ler ao abrir.
 */
export function voltaDeLinkDaConta(endereco: Pick<Location, 'hash' | 'search'> = location) {
  return /(^|[#&])(access_token|error_description)=/.test(endereco.hash) || /[?&]code=/.test(endereco.search)
}
