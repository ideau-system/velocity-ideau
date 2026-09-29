import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { apelidoComNumero } from '../../src/conta/apelido.js'
import { MEDALHAS, type Medalha } from '../../src/game/contrarrelogio.js'
import { gravacaoValida } from '../../src/game/gravador.js'
import { toDifficulty, type Difficulty } from '../../src/game/rules.js'
import type { Desfecho, EstadoRanqueado } from '../ranqueada/rating.js'
import {
  MODOS_DA_CORRIDA,
  type CorridaRanqueada,
  type Dispositivo,
  type EstadoDoTempo,
  type EstatisticasDoPerfil,
  type LinhaDaEscada,
  type LinhaDoQuadro,
  type ModoDaCorrida,
  type NovoTempo,
  type Participacao,
  type Perfil,
  type Repositorio,
  type ResumoDoModo,
  type TempoRegistrado,
  type Trofeu,
  type VoltaRanqueada,
} from './tipos.js'

const { Pool } = pg

/** Chave do bloqueio que impede duas subidas de migrar o banco ao mesmo tempo. */
const TRAVA_DAS_MIGRACOES = 727_272

/**
 * Aplica as migrações que faltam, em ordem, cada uma numa transação.
 *
 * São arquivos SQL puros em `migracoes/`, numerados: sem ORM e sem ferramenta
 * à parte, para quem mantém o projeto ler o esquema direto no arquivo.
 */
export async function migrar(pool: pg.Pool) {
  const cliente = await pool.connect()
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [TRAVA_DAS_MIGRACOES])
    await cliente.query(
      'CREATE TABLE IF NOT EXISTS migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())',
    )
    const pasta = fileURLToPath(new URL('./migracoes/', import.meta.url))
    const arquivos = (await readdir(pasta)).filter((arquivo) => arquivo.endsWith('.sql')).sort()
    const { rows } = await cliente.query<{ nome: string }>('SELECT nome FROM migracoes')
    const feitas = new Set(rows.map((linha) => linha.nome))
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue
      const sql = await readFile(join(pasta, arquivo), 'utf8')
      try {
        await cliente.query('BEGIN')
        await cliente.query(sql)
        await cliente.query('INSERT INTO migracoes (nome) VALUES ($1)', [arquivo])
        await cliente.query('COMMIT')
      } catch (erro) {
        await cliente.query('ROLLBACK')
        throw erro
      }
    }
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [TRAVA_DAS_MIGRACOES]).catch(() => undefined)
    cliente.release()
  }
}

type LinhaDeTempo = {
  id: string
  perfil_id: string
  apelido: string
  dia: string
  seed: string
  dificuldade: string
  tempo: number
  dispositivo: string
  estado: string
  criado_em: Date
  posicao?: string
}

/**
 * Colunas de um tempo. O dia sai como texto: o driver converte `date` para
 * meia-noite no fuso do servidor, e o dia da pista é o de Brasília, não o dele.
 */
const COLUNAS_DO_TEMPO = `t.id, t.perfil_id, p.apelido, to_char(t.dia, 'YYYY-MM-DD') AS dia, t.seed, t.dificuldade,
  t.tempo, t.dispositivo, t.estado, t.criado_em`

/** O melhor tempo válido de cada piloto numa semente e nível, com a posição. */
const MELHORES = `
  WITH melhores AS (
    SELECT DISTINCT ON (t.perfil_id) ${COLUNAS_DO_TEMPO}
    FROM tempos t JOIN perfis p ON p.id = t.perfil_id
    WHERE t.seed = $1 AND t.dificuldade = $2 AND t.estado = 'valido'
    ORDER BY t.perfil_id, t.tempo, t.criado_em
  )
  SELECT *, ROW_NUMBER() OVER (ORDER BY tempo, criado_em) AS posicao FROM melhores`

type LinhaDeRating = {
  mu: number
  sigma: number
  pl: number
  corridas: number
  colocacao: number
  escudo: number
  pico: number
  podios: number
  abandonos: number
  ultima_corrida: Date | null
}

const COLUNAS_DO_RATING = 'r.mu, r.sigma, r.pl, r.corridas, r.colocacao, r.escudo, r.pico, r.podios, r.abandonos, r.ultima_corrida'

/** A escada da temporada: só quem terminou a colocação, dos PL mais altos para os mais baixos. */
const ESCADA = `
  SELECT r.perfil_id, p.apelido, ${COLUNAS_DO_RATING},
    ROW_NUMBER() OVER (ORDER BY r.pl DESC, r.mu DESC) AS posicao
  FROM ratings r JOIN perfis p ON p.id = r.perfil_id
  WHERE r.temporada = $1 AND r.colocacao = 0`

function paraEstado(linha: LinhaDeRating): EstadoRanqueado {
  return {
    mmr: { mu: Number(linha.mu), sigma: Number(linha.sigma) },
    pl: linha.pl,
    corridas: linha.corridas,
    colocacao: linha.colocacao,
    escudo: linha.escudo,
    pico: linha.pico,
    podios: linha.podios,
    abandonos: linha.abandonos,
    ultimaCorrida: linha.ultima_corrida ? linha.ultima_corrida.getTime() : null,
  }
}

/**
 * A conexão, com o certificado do Supabase quando o banco é dele.
 *
 * O Supabase assina o certificado do banco com uma autoridade própria, que não
 * está na lista do Node: sem ela, ou a conexão falha, ou a verificação é
 * desligada — e aí qualquer um no caminho poderia se passar pelo banco. Com o
 * certificado raiz dele no projeto, a conexão é cifrada e conferida, sem
 * depender do `sslmode` que vier no endereço.
 */
export function configuracaoDaConexao(url: string): pg.PoolConfig {
  const endereco = new URL(url)
  if (!/\.supabase\.(com|co)$/i.test(endereco.hostname)) return { connectionString: url }
  endereco.searchParams.delete('sslmode')
  const ca = readFileSync(new URL('./supabase-ca-2021.crt', import.meta.url), 'utf8')
  return { connectionString: endereco.toString(), ssl: { ca } }
}

export class RepositorioPostgres implements Repositorio {
  readonly descricao: string

  private constructor(private readonly pool: pg.Pool, descricao: string) {
    this.descricao = descricao
  }

  /** Conecta, aplica as migrações e devolve o repositório pronto. */
  static async conectar(url: string) {
    const pool = new Pool({ ...configuracaoDaConexao(url), max: 8 })
    // Um erro num cliente ocioso — o banco reiniciou — não pode derrubar o servidor da corrida.
    pool.on('error', (erro) => console.error('Postgres:', erro.message))
    await migrar(pool)
    const endereco = new URL(url)
    return new RepositorioPostgres(pool, `Postgres em ${endereco.hostname}${endereco.pathname}`)
  }

  async perfilDaConta(contaId: string, apelido: string): Promise<Perfil> {
    if (!pareceUuid(contaId)) throw new Error('conta inválida')
    const existente = await this.perfil(contaId)
    if (existente) return existente
    // Dois cadastros com o mesmo apelido ao mesmo tempo: o segundo ganha um
    // número. Quem decide é o índice único, e não uma leitura antes.
    for (let tentativa = 1; tentativa <= 50; tentativa += 1) {
      const nome = tentativa === 1 ? apelido : apelidoComNumero(apelido, tentativa)
      try {
        const { rows } = await this.pool.query<{ criado_em: Date }>(
          'INSERT INTO perfis (id, apelido) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING criado_em',
          [contaId, nome],
        )
        if (rows[0]) return { id: contaId, apelido: nome, criadoEm: rows[0].criado_em.getTime() }
        // A mesma conta entrou por outra conexão no mesmo instante.
        const criado = await this.perfil(contaId)
        if (criado) return criado
      } catch (erro) {
        if ((erro as { code?: string }).code !== VIOLACAO_DE_UNICIDADE) throw erro
      }
    }
    throw new Error('sem apelido livre para a conta')
  }

  async perfil(id: string) {
    if (!pareceUuid(id)) return null
    const { rows } = await this.pool.query<{ id: string; apelido: string; criado_em: Date }>(
      'SELECT id, apelido, criado_em FROM perfis WHERE id = $1',
      [id],
    )
    return rows[0] ? { id: rows[0].id, apelido: rows[0].apelido, criadoEm: rows[0].criado_em.getTime() } : null
  }

  async apelidoLivre(apelido: string) {
    const { rows } = await this.pool.query('SELECT 1 FROM perfis WHERE lower(apelido) = lower($1) AND token_hash IS NULL LIMIT 1', [
      apelido.replace(/\s+/g, ' ').trim(),
    ])
    return rows.length === 0
  }

  async registrarTempo(novo: NovoTempo): Promise<TempoRegistrado> {
    const id = randomUUID()
    await this.pool.query(
      `INSERT INTO tempos (id, perfil_id, dia, seed, dificuldade, tempo, dispositivo, estado, medalha, gravacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        novo.perfilId,
        novo.dia,
        novo.seed,
        novo.dificuldade,
        novo.tempo,
        novo.dispositivo,
        novo.estado,
        novo.medalha,
        JSON.stringify(novo.gravacao),
      ],
    )
    const { rows } = await this.pool.query<LinhaDeTempo>(
      `SELECT ${COLUNAS_DO_TEMPO} FROM tempos t JOIN perfis p ON p.id = t.perfil_id WHERE t.id = $1`,
      [id],
    )
    return paraTempo(rows[0])
  }

  async quadro(seed: number, dificuldade: Difficulty, limite: number): Promise<LinhaDoQuadro[]> {
    const { rows } = await this.pool.query<LinhaDeTempo>(`${MELHORES} ORDER BY posicao LIMIT $3`, [
      seed,
      dificuldade,
      Math.max(0, Math.floor(limite)),
    ])
    return rows.map(paraLinha)
  }

  async linhaDe(seed: number, dificuldade: Difficulty, perfilId: string) {
    if (!pareceUuid(perfilId)) return null
    const { rows } = await this.pool.query<LinhaDeTempo>(
      `SELECT * FROM (${MELHORES}) quadro WHERE perfil_id = $3`,
      [seed, dificuldade, perfilId],
    )
    return rows[0] ? paraLinha(rows[0]) : null
  }

  async gravacao(tempoId: string) {
    if (!pareceUuid(tempoId)) return null
    const { rows } = await this.pool.query<{ gravacao: unknown }>('SELECT gravacao FROM tempos WHERE id = $1', [tempoId])
    return rows[0] ? gravacaoValida(rows[0].gravacao) : null
  }

  async estadoRanqueado(perfilId: string, temporada: string) {
    if (!pareceUuid(perfilId)) return null
    const { rows } = await this.pool.query<LinhaDeRating>(
      `SELECT ${COLUNAS_DO_RATING} FROM ratings r WHERE r.perfil_id = $1 AND r.temporada = $2`,
      [perfilId, temporada],
    )
    return rows[0] ? paraEstado(rows[0]) : null
  }

  async estadoAnterior(perfilId: string, temporada: string) {
    if (!pareceUuid(perfilId)) return null
    const { rows } = await this.pool.query<LinhaDeRating>(
      `SELECT ${COLUNAS_DO_RATING} FROM ratings r WHERE r.perfil_id = $1 AND r.temporada < $2 ORDER BY r.temporada DESC LIMIT 1`,
      [perfilId, temporada],
    )
    return rows[0] ? paraEstado(rows[0]) : null
  }

  async registrarCorridaRanqueada(corrida: CorridaRanqueada) {
    const cliente = await this.pool.connect()
    try {
      await cliente.query('BEGIN')
      const inserida = await cliente.query(
        `INSERT INTO corridas_ranqueadas (id, temporada, sala, seed, criada_em)
         VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0)) ON CONFLICT (id) DO NOTHING`,
        [corrida.id, corrida.temporada, corrida.sala, corrida.seed, corrida.instante],
      )
      // Já registrada: a mesma corrida não conta duas vezes.
      if (inserida.rowCount === 0) {
        await cliente.query('ROLLBACK')
        return
      }
      for (const resultado of corrida.resultados) {
        const depois = resultado.depois
        await cliente.query(
          `INSERT INTO ratings (perfil_id, temporada, mu, sigma, pl, corridas, colocacao, escudo, pico, podios, abandonos, ultima_corrida)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12 / 1000.0))
           ON CONFLICT (perfil_id, temporada) DO UPDATE SET
             mu = EXCLUDED.mu, sigma = EXCLUDED.sigma, pl = EXCLUDED.pl, corridas = EXCLUDED.corridas,
             colocacao = EXCLUDED.colocacao, escudo = EXCLUDED.escudo, pico = EXCLUDED.pico,
             podios = EXCLUDED.podios, abandonos = EXCLUDED.abandonos, ultima_corrida = EXCLUDED.ultima_corrida`,
          [
            resultado.perfilId,
            corrida.temporada,
            depois.mmr.mu,
            depois.mmr.sigma,
            depois.pl,
            depois.corridas,
            depois.colocacao,
            depois.escudo,
            depois.pico,
            depois.podios,
            depois.abandonos,
            depois.ultimaCorrida ?? corrida.instante,
          ],
        )
        await cliente.query(
          `INSERT INTO resultados_ranqueados
             (corrida_id, perfil_id, posto, desfecho, tempo, pl_antes, pl_depois, mu_antes, mu_depois, sigma_antes, sigma_depois)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            corrida.id,
            resultado.perfilId,
            resultado.posto,
            resultado.desfecho,
            resultado.tempo,
            resultado.antes.pl,
            depois.pl,
            resultado.antes.mmr.mu,
            depois.mmr.mu,
            resultado.antes.mmr.sigma,
            depois.mmr.sigma,
          ],
        )
      }
      await cliente.query('COMMIT')
    } catch (erro) {
      await cliente.query('ROLLBACK')
      throw erro
    } finally {
      cliente.release()
    }
  }

  async escada(temporada: string, limite: number): Promise<LinhaDaEscada[]> {
    const { rows } = await this.pool.query<LinhaDeRating & { perfil_id: string; apelido: string; posicao: string }>(
      `${ESCADA} ORDER BY posicao LIMIT $2`,
      [temporada, Math.max(0, Math.floor(limite))],
    )
    return rows.map((linha) => ({ perfilId: linha.perfil_id, apelido: linha.apelido, estado: paraEstado(linha), posicao: Number(linha.posicao) }))
  }

  async posicaoNaEscada(perfilId: string, temporada: string) {
    if (!pareceUuid(perfilId)) return null
    const { rows } = await this.pool.query<{ posicao: string }>(
      `SELECT posicao FROM (${ESCADA}) escada WHERE perfil_id = $2`,
      [temporada, perfilId],
    )
    return rows[0] ? Number(rows[0].posicao) : null
  }

  async corridasJuntos(perfilIds: readonly string[], desde: number, emComum: number) {
    const ids = perfilIds.filter(pareceUuid)
    if (ids.length < emComum) return 0
    const { rows } = await this.pool.query<{ quantas: string }>(
      `SELECT count(*) AS quantas FROM (
         SELECT r.corrida_id FROM resultados_ranqueados r
         JOIN corridas_ranqueadas c ON c.id = r.corrida_id
         WHERE c.criada_em >= to_timestamp($1 / 1000.0) AND r.perfil_id = ANY($2::uuid[])
         GROUP BY r.corrida_id HAVING count(*) >= $3
       ) juntos`,
      [desde, ids, emComum],
    )
    return Number(rows[0]?.quantas ?? 0)
  }

  async registrarVoltaRanqueada(volta: Omit<VoltaRanqueada, 'id' | 'apelido' | 'criadaEm'>) {
    await this.pool.query(
      `INSERT INTO voltas_ranqueadas (id, perfil_id, seed, dificuldade, tempo, mu, sigma, carro, gravacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        volta.perfilId,
        volta.seed,
        volta.dificuldade,
        volta.tempo,
        volta.mmr.mu,
        volta.mmr.sigma,
        volta.carro,
        JSON.stringify(volta.gravacao),
      ],
    )
  }

  async voltasRanqueadas(dificuldade: Difficulty, desde: number, excluirPerfil: string, limite: number) {
    const { rows } = await this.pool.query<{
      id: string
      perfil_id: string
      apelido: string
      seed: string
      dificuldade: string
      tempo: number
      mu: number
      sigma: number
      carro: string
      gravacao: unknown
      criada_em: Date
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (v.perfil_id, v.seed) v.id, v.perfil_id, p.apelido, v.seed, v.dificuldade, v.tempo,
           v.mu, v.sigma, v.carro, v.gravacao, v.criada_em
         FROM voltas_ranqueadas v JOIN perfis p ON p.id = v.perfil_id
         WHERE v.dificuldade = $1 AND v.criada_em >= to_timestamp($2 / 1000.0) AND v.perfil_id::text <> $3
         ORDER BY v.perfil_id, v.seed, v.criada_em DESC
       ) recentes ORDER BY criada_em DESC LIMIT $4`,
      [dificuldade, desde, excluirPerfil, Math.max(0, Math.floor(limite))],
    )
    return rows.flatMap((linha) => {
      const gravacao = gravacaoValida(linha.gravacao)
      if (!gravacao) return []
      return [
        {
          id: linha.id,
          perfilId: linha.perfil_id,
          apelido: linha.apelido,
          seed: Number(linha.seed),
          dificuldade: toDifficulty(linha.dificuldade),
          tempo: Number(linha.tempo),
          mmr: { mu: Number(linha.mu), sigma: Number(linha.sigma) },
          carro: linha.carro,
          gravacao,
          criadaEm: linha.criada_em.getTime(),
        },
      ]
    })
  }

  async registrarTrofeu(trofeu: Trofeu) {
    await this.pool.query(
      'INSERT INTO trofeus (id, perfil_id, dia, divisao, posicao, participantes) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), trofeu.perfilId, trofeu.dia, trofeu.divisao, trofeu.posicao, trofeu.participantes],
    )
  }

  async trofeusDe(perfilId: string) {
    if (!pareceUuid(perfilId)) return []
    const { rows } = await this.pool.query<{ perfil_id: string; dia: string; divisao: number; posicao: number; participantes: number }>(
      `SELECT perfil_id, to_char(dia, 'YYYY-MM-DD') AS dia, divisao, posicao, participantes
       FROM trofeus WHERE perfil_id = $1 ORDER BY dia DESC, posicao`,
      [perfilId],
    )
    return rows.map((linha) => ({
      perfilId: linha.perfil_id,
      dia: linha.dia,
      divisao: linha.divisao,
      posicao: linha.posicao,
      participantes: linha.participantes,
    }))
  }

  async registrarParticipacoes(participacoes: readonly Participacao[]) {
    const validas = participacoes.filter((participacao) => pareceUuid(participacao.perfilId))
    if (validas.length === 0) return
    const COLUNAS = 14
    const valores: unknown[] = []
    const linhas = validas.map((participacao, i) => {
      valores.push(
        participacao.perfilId,
        participacao.sala,
        participacao.largada,
        participacao.modo,
        participacao.seed,
        participacao.dificuldade,
        participacao.pilotos,
        participacao.posicao,
        participacao.desfecho,
        participacao.tempo,
        participacao.velocidadeMaxima,
        participacao.batidas,
        participacao.carro,
        participacao.deltaPl,
      )
      const n = (k: number) => `$${i * COLUNAS + k}`
      return `(${n(1)}, ${n(2)}, to_timestamp(${n(3)} / 1000.0), ${n(4)}, ${n(5)}, ${n(6)}, ${n(7)}, ${n(8)}, ${n(9)}, ${n(10)}, ${n(11)}, ${n(12)}, ${n(13)}, ${n(14)})`
    })
    await this.pool.query(
      `INSERT INTO participacoes
         (perfil_id, sala, largada, modo, seed, dificuldade, pilotos, posicao, desfecho, tempo, velocidade_maxima, batidas, carro, delta_pl)
       VALUES ${linhas.join(', ')}
       ON CONFLICT (perfil_id, sala, largada) DO NOTHING`,
      valores,
    )
  }

  async estatisticasDe(perfilId: string, recentes: number): Promise<EstatisticasDoPerfil> {
    const porModo = Object.fromEntries(MODOS_DA_CORRIDA.map((modo) => [modo, resumoVazio()])) as Record<ModoDaCorrida, ResumoDoModo>
    const medalhas = medalhasVazias()
    if (!pareceUuid(perfilId)) {
      return {
        porModo,
        velocidadeMaxima: 0,
        batidas: 0,
        carroFavorito: null,
        recentes: [],
        contrarrelogio: { voltas: 0, pistas: 0, medalhas, lideradas: 0 },
        temporadas: [],
      }
    }
    const [somas, favorito, ultimas, voltas, porMedalha, lideradas, temporadas] = await Promise.all([
      this.pool.query<{
        modo: ModoDaCorrida
        corridas: string
        vitorias: string
        podios: string
        chegadas: string
        abandonos: string
        soma_das_posicoes: string
        velocidade_maxima: number
        batidas: string
      }>(
        `SELECT modo, count(*) AS corridas,
           count(*) FILTER (WHERE desfecho = 'chegou' AND pilotos > 1 AND posicao = 1) AS vitorias,
           count(*) FILTER (WHERE desfecho = 'chegou' AND pilotos > 1 AND posicao <= 3) AS podios,
           count(*) FILTER (WHERE desfecho = 'chegou') AS chegadas,
           count(*) FILTER (WHERE desfecho = 'abandonou') AS abandonos,
           coalesce(sum(posicao), 0) AS soma_das_posicoes,
           coalesce(max(velocidade_maxima), 0) AS velocidade_maxima,
           coalesce(sum(batidas), 0) AS batidas
         FROM participacoes WHERE perfil_id = $1 GROUP BY modo`,
        [perfilId],
      ),
      this.pool.query<{ carro: string; corridas: string }>(
        `SELECT carro, count(*) AS corridas FROM participacoes WHERE perfil_id = $1
         GROUP BY carro ORDER BY count(*) DESC, max(largada) DESC LIMIT 1`,
        [perfilId],
      ),
      this.pool.query<LinhaDeParticipacao>(
        `SELECT perfil_id, sala, largada, modo, seed, dificuldade, pilotos, posicao, desfecho, tempo, velocidade_maxima, batidas, carro, delta_pl
         FROM participacoes WHERE perfil_id = $1 ORDER BY largada DESC LIMIT $2`,
        [perfilId, Math.max(0, Math.floor(recentes))],
      ),
      this.pool.query<{ voltas: string; pistas: string }>(
        `SELECT count(*) FILTER (WHERE estado <> 'recusado') AS voltas,
           count(DISTINCT (seed, dificuldade)) FILTER (WHERE estado = 'valido') AS pistas
         FROM tempos WHERE perfil_id = $1`,
        [perfilId],
      ),
      // A melhor volta de cada pista diz a melhor medalha dela.
      this.pool.query<{ medalha: Medalha; quantas: string }>(
        `SELECT medalha, count(*) AS quantas FROM (
           SELECT DISTINCT ON (seed, dificuldade) medalha FROM tempos
           WHERE perfil_id = $1 AND estado = 'valido' ORDER BY seed, dificuldade, tempo
         ) melhores WHERE medalha IS NOT NULL GROUP BY medalha`,
        [perfilId],
      ),
      // As pistas em que o primeiro do quadro é este piloto.
      this.pool.query<{ quantas: string }>(
        `SELECT count(*) AS quantas FROM (
           SELECT DISTINCT ON (t.seed, t.dificuldade) t.perfil_id FROM tempos t
           WHERE t.estado = 'valido' AND (t.seed, t.dificuldade) IN (
             SELECT seed, dificuldade FROM tempos WHERE perfil_id = $1 AND estado = 'valido'
           )
           ORDER BY t.seed, t.dificuldade, t.tempo, t.criado_em
         ) lideres WHERE perfil_id = $1`,
        [perfilId],
      ),
      this.pool.query<LinhaDeRating & { temporada: string }>(
        `SELECT r.temporada, ${COLUNAS_DO_RATING} FROM ratings r WHERE r.perfil_id = $1 ORDER BY r.temporada DESC`,
        [perfilId],
      ),
    ])
    let velocidadeMaxima = 0
    let batidas = 0
    for (const linha of somas.rows) {
      porModo[linha.modo] = {
        corridas: Number(linha.corridas),
        vitorias: Number(linha.vitorias),
        podios: Number(linha.podios),
        chegadas: Number(linha.chegadas),
        abandonos: Number(linha.abandonos),
        somaDasPosicoes: Number(linha.soma_das_posicoes),
      }
      velocidadeMaxima = Math.max(velocidadeMaxima, Number(linha.velocidade_maxima))
      batidas += Number(linha.batidas)
    }
    for (const linha of porMedalha.rows) medalhas[linha.medalha] = Number(linha.quantas)
    return {
      porModo,
      velocidadeMaxima,
      batidas,
      carroFavorito: favorito.rows[0] ? { carro: favorito.rows[0].carro, corridas: Number(favorito.rows[0].corridas) } : null,
      recentes: ultimas.rows.map(paraParticipacao),
      contrarrelogio: {
        voltas: Number(voltas.rows[0]?.voltas ?? 0),
        pistas: Number(voltas.rows[0]?.pistas ?? 0),
        medalhas,
        lideradas: Number(lideradas.rows[0]?.quantas ?? 0),
      },
      temporadas: temporadas.rows.map((linha) => ({ temporada: linha.temporada, estado: paraEstado(linha) })),
    }
  }

  async fechar() {
    await this.pool.end()
  }
}

/** O código do Postgres para a violação de um índice único. */
const VIOLACAO_DE_UNICIDADE = '23505'

type LinhaDeParticipacao = {
  perfil_id: string
  sala: string
  largada: Date
  modo: ModoDaCorrida
  seed: string
  dificuldade: string
  pilotos: number
  posicao: number
  desfecho: Desfecho
  tempo: number | null
  velocidade_maxima: number
  batidas: number
  carro: string
  delta_pl: number | null
}

function paraParticipacao(linha: LinhaDeParticipacao): Participacao {
  return {
    perfilId: linha.perfil_id,
    sala: linha.sala,
    largada: linha.largada.getTime(),
    modo: linha.modo,
    seed: Number(linha.seed),
    dificuldade: toDifficulty(linha.dificuldade),
    pilotos: linha.pilotos,
    posicao: linha.posicao,
    desfecho: linha.desfecho,
    tempo: linha.tempo === null ? null : Number(linha.tempo),
    velocidadeMaxima: Number(linha.velocidade_maxima),
    batidas: linha.batidas,
    carro: linha.carro,
    deltaPl: linha.delta_pl,
  }
}

function resumoVazio(): ResumoDoModo {
  return { corridas: 0, vitorias: 0, podios: 0, chegadas: 0, abandonos: 0, somaDasPosicoes: 0 }
}

function medalhasVazias() {
  return Object.fromEntries(MEDALHAS.map((medalha) => [medalha, 0])) as Record<Medalha, number>
}

/** Um identificador que não é UUID nem chega ao banco: o Postgres recusaria com erro. */
function pareceUuid(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

function paraTempo(linha: LinhaDeTempo): TempoRegistrado {
  return {
    id: linha.id,
    perfilId: linha.perfil_id,
    apelido: linha.apelido,
    dia: linha.dia,
    seed: Number(linha.seed),
    dificuldade: toDifficulty(linha.dificuldade),
    tempo: Number(linha.tempo),
    dispositivo: linha.dispositivo as Dispositivo,
    estado: linha.estado as EstadoDoTempo,
    criadoEm: linha.criado_em.getTime(),
  }
}

function paraLinha(linha: LinhaDeTempo): LinhaDoQuadro {
  return { ...paraTempo(linha), posicao: Number(linha.posicao) }
}
