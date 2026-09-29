/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endereço do servidor da partida, quando não é o mesmo do site. */
  readonly VITE_SERVER_URL?: string
  /** Projeto do Supabase das contas. Sem ele, vale o do jogo. */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
