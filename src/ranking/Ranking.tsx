import { CIRCUITO_OFICIAL, MEDALHAS, NOME_DA_MEDALHA } from '../game/contrarrelogio'
import { formatTime } from '../game/track'
import type { LinhaDoQuadro, QuadroDoDia } from '../multiplayer/pistaDoDia'
import type { LinhaDaEscada } from '../multiplayer/ranqueada'

export type AbaDoRanking = 'mundial' | 'dia' | 'ranqueada'

type Props = {
  aba: AbaDoRanking
  onAba: (aba: AbaDoRanking) => void
  mundial: QuadroDoDia | null
  dia: QuadroDoDia | null
  escada: { temporada: string; escada: LinhaDaEscada[] } | null
  carregando: boolean
  conectado: boolean
  /** O perfil de quem olha, para marcar a linha dele. Null para convidado. */
  meuPerfil: string | null
  onVerPiloto: (perfilId: string) => void
  onCorrerContra: (linha: LinhaDoQuadro, aba: 'mundial' | 'dia') => void
  onCorrerCircuito: () => void
  onCorrerPistaDoDia: () => void
  onEntrar?: () => void
  onVoltar: () => void
}

/** Só o top 10 de cada quadro tem o fantasma público. */
const FANTASMAS_PUBLICOS = 10

/**
 * O ranking mundial: o melhor tempo de cada piloto no Circuito Oficial, de
 * todos os tempos, e as abas do dia e da ranqueada.
 *
 * O tempo só se compara na mesma pista — cada corrida sorteia um traçado —, e
 * por isso o recorde mundial é de uma pista fixa, como a campanha do
 * Trackmania. O ▶ baixa o fantasma do recordista: é assim que se aprende a
 * linha de quem é mais rápido. O nome abre o perfil do piloto.
 */
export default function Ranking({
  aba,
  onAba,
  mundial,
  dia,
  escada,
  carregando,
  conectado,
  meuPerfil,
  onVerPiloto,
  onCorrerContra,
  onCorrerCircuito,
  onCorrerPistaDoDia,
  onEntrar,
  onVoltar,
}: Props) {
  const quadro = aba === 'mundial' ? mundial : aba === 'dia' ? dia : null
  const minhaLinhaFora = quadro?.voce && !quadro.linhas.some((linha) => linha.perfilId === quadro.voce!.perfilId) ? quadro.voce : null

  return (
    <main className="screen ranking-screen">
      <div className="ambient-grid" />
      <section className="ranking-card">
        <header className="ranking-header">
          <div>
            <p className="eyebrow">CORRIDA FANTASMA · TODOS OS PILOTOS</p>
            <h1>RANKING MUNDIAL</h1>
          </div>
          <button type="button" className="text-button" onClick={onVoltar}>
            VOLTAR
          </button>
        </header>

        <div className="entrada-abas ranking-abas" role="tablist" aria-label="Ranking">
          {(
            [
              ['mundial', 'MELHOR TEMPO'],
              ['dia', 'PISTA DO DIA'],
              ['ranqueada', 'RANQUEADA'],
            ] as const
          ).map(([id, nome]) => (
            <button key={id} type="button" role="tab" aria-selected={aba === id} className={aba === id ? 'on' : ''} onClick={() => onAba(id)}>
              {nome}
            </button>
          ))}
        </div>

        {!conectado && <p className="form-notice">PROCURANDO O SERVIDOR DA PARTIDA…</p>}
        {carregando && <p className="form-notice">CARREGANDO…</p>}

        {aba !== 'ranqueada' && quadro && (
          <>
            <p className="ranking-sobre">
              {aba === 'mundial'
                ? `${CIRCUITO_OFICIAL.nome.toUpperCase()} · A MESMA PISTA PARA SEMPRE · NÍVEL DIFÍCIL · O MELHOR TEMPO DE CADA PILOTO`
                : `PISTA DE ${quadro.dia.slice(8, 10)}/${quadro.dia.slice(5, 7)} · ZERA À MEIA-NOITE · NÍVEL DIFÍCIL`}
            </p>
            <ol className="medal-ladder ranking-medalhas" aria-label="Medalhas">
              {MEDALHAS.map((medalha) => (
                <li key={medalha} className={medalha}>
                  <span>{NOME_DA_MEDALHA[medalha]}</span>
                  <b>{formatTime(quadro.limites[medalha])}</b>
                </li>
              ))}
            </ol>
            {quadro.linhas.length === 0 ? (
              <p className="ranked-note ranking-vazio">
                {aba === 'mundial' ? 'Ninguém marcou tempo ainda. O primeiro recorde mundial pode ser seu.' : 'Ninguém correu a pista de hoje ainda.'}
              </p>
            ) : (
              <ol className="daily-board ranking-quadro" aria-label={aba === 'mundial' ? 'Ranking mundial' : 'Quadro da Pista do Dia'}>
                {quadro.linhas.map((linha) => (
                  <LinhaDeTempo
                    key={linha.id}
                    linha={linha}
                    minha={linha.perfilId === meuPerfil}
                    comFantasma={linha.posicao <= FANTASMAS_PUBLICOS}
                    onVerPiloto={onVerPiloto}
                    onCorrerContra={(escolhida) => onCorrerContra(escolhida, aba)}
                  />
                ))}
                {minhaLinhaFora && (
                  <LinhaDeTempo linha={minhaLinhaFora} minha comFantasma={false} onVerPiloto={onVerPiloto} onCorrerContra={() => undefined} />
                )}
              </ol>
            )}
            {!meuPerfil && (
              <p className="ranked-note">
                Convidado corre e guarda o recorde no aparelho, mas não entra no ranking.{' '}
                {onEntrar && (
                  <button type="button" className="text-button inline" onClick={onEntrar}>
                    ENTRAR NA CONTA
                  </button>
                )}
              </p>
            )}
            <button type="button" className="primary-button" onClick={aba === 'mundial' ? onCorrerCircuito : onCorrerPistaDoDia}>
              {aba === 'mundial' ? 'CORRER O CIRCUITO OFICIAL' : 'CORRER A PISTA DO DIA'} <span>↗</span>
            </button>
          </>
        )}

        {aba === 'ranqueada' && escada && (
          <>
            <p className="ranking-sobre">TEMPORADA {escada.temporada} · SÓ QUEM TERMINOU AS CORRIDAS DE COLOCAÇÃO</p>
            {escada.escada.length === 0 ? (
              <p className="ranked-note ranking-vazio">A escada desta temporada ainda está vazia.</p>
            ) : (
              <ol className="ranked-ladder ranking-escada" aria-label="Escada da temporada">
                {escada.escada.map((linha) => (
                  <li key={linha.perfilId} className={`${linha.tier} ${linha.perfilId === meuPerfil ? 'me' : ''}`}>
                    <b>{linha.posicao}</b>
                    <button type="button" className="ranking-nome" onClick={() => onVerPiloto(linha.perfilId)}>
                      {linha.apelido}
                      {linha.lenda && <em>LENDA</em>}
                    </button>
                    <i>{linha.divisao}</i>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>
    </main>
  )
}

function LinhaDeTempo({
  linha,
  minha,
  comFantasma,
  onVerPiloto,
  onCorrerContra,
}: {
  linha: LinhaDoQuadro
  minha: boolean
  comFantasma: boolean
  onVerPiloto: (perfilId: string) => void
  onCorrerContra: (linha: LinhaDoQuadro) => void
}) {
  return (
    <li className={minha ? 'me' : ''}>
      <b>{linha.posicao}</b>
      <button type="button" className="ranking-nome" onClick={() => onVerPiloto(linha.perfilId)}>
        {linha.apelido}
      </button>
      {linha.dispositivo === 'toque' ? <em title="Feito no toque">TOQUE</em> : <em />}
      <i>{formatTime(linha.tempo)}</i>
      {comFantasma && !minha ? (
        <button type="button" onClick={() => onCorrerContra(linha)} aria-label={`Correr contra o fantasma de ${linha.apelido}`}>
          ▶
        </button>
      ) : (
        <span />
      )}
    </li>
  )
}
