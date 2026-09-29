import { RepositorioEmMemoria } from './memoria.js'
import { RepositorioPostgres } from './postgres.js'
import type { Repositorio } from './tipos.js'

export type { Repositorio } from './tipos.js'
export { RepositorioEmMemoria } from './memoria.js'

/**
 * O repositório do servidor: Postgres com `DATABASE_URL`, memória sem ela.
 *
 * Sem banco o jogo casual funciona igual — as salas sempre viveram na memória —,
 * e a Pista do Dia e a ranqueada funcionam também, só que esquecem tudo quando
 * o servidor para. É o modo do workshop sem internet.
 */
export async function criarRepositorio(url = process.env.DATABASE_URL): Promise<Repositorio> {
  if (!url) return new RepositorioEmMemoria()
  return RepositorioPostgres.conectar(url)
}
