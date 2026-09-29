import { useEffect, useState } from 'react'
import type { PerfilPublico } from '../multiplayer/perfil'
import { HORARIO_RANQUEADO, NOME_DO_TIER, type SituacaoDaRanqueada } from '../multiplayer/ranqueada'

type Props = {
  perfil: PerfilPublico | null
  situacao: SituacaoDaRanqueada | null
  conectado: boolean
  naFila: boolean
  /** Quantos estão na fila, contando este piloto. */
  tamanhoDaFila: number
  /** Desde quando este piloto está na fila. */
  naFilaDesde: number | null
  aviso: string
  /** A sessão da conta existe, mas o servidor ainda não a conferiu. */
  entrandoNaConta: boolean
  onEntrar: () => void
  onSair: () => void
  onVoltar: () => void
  onVerPerfil: () => void
  onVerRanking: () => void
  /** Para o convidado: abre a tela de entrar na conta. */
  onEntrarNaConta: () => void
}

/** PL da divisão atual, de 0 a 100, a partir do nome "Ouro II · 45 PL". */
function plNaDivisao(divisao: string) {
  const achado = /(\d+) PL$/.exec(divisao)
  return achado ? Number(achado[1]) : 0
}

/**
 * A tela da ranqueada.
 *
 * O tier, a barra de PL da divisão, a colocação, a escada da temporada e a
 * fila. Tudo que a pesquisa pediu para ficar à vista: o delta de cada corrida,
 * o aviso de que o piloto está subindo mais depressa que os PL, e o horário
 * que junta gente com pouca gente jogando.
 */
export default function Ranqueada({
  perfil,
  situacao,
  conectado,
  naFila,
  tamanhoDaFila,
  naFilaDesde,
  aviso,
  entrandoNaConta,
  onEntrar,
  onSair,
  onVoltar,
  onVerPerfil,
  onVerRanking,
  onEntrarNaConta,
}: Props) {
  const [agora, setAgora] = useState(Date.now)

  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(Date.now()), 1_000)
    return () => window.clearInterval(relogio)
  }, [])

  const painel = situacao?.painel ?? null
  const esperaAte = situacao?.esperaAte ?? null
  const bloqueado = esperaAte !== null && esperaAte > agora
  const emColocacao = painel !== null && painel.colocacao > 0

  return (
    <main className="screen ranked-screen">
      <div className="ambient-grid" />
      <section className="ranked-card">
        <header className="ranked-header">
          <div>
            <p className="eyebrow">FILA PÚBLICA · TEMPORADA {painel?.temporada ?? '—'}</p>
            <h1>RANQUEADA</h1>
            <p className="ranked-pilot">{perfil?.apelido ?? (entrandoNaConta ? 'ENTRANDO NA CONTA…' : 'CONVIDADO')}</p>
          </div>
          {painel && (
            <div className={`tier-badge ${emColocacao ? 'colocacao' : painel.tier}`}>
              <span>{emColocacao ? 'EM COLOCAÇÃO' : NOME_DO_TIER[painel.tier]}</span>
              <strong>{emColocacao ? `${painel.colocacaoTotal - painel.colocacao}/${painel.colocacaoTotal}` : painel.divisao.replace(/ · .*/, '')}</strong>
            </div>
          )}
        </header>

        {!conectado && <p className="form-notice">PROCURANDO O SERVIDOR DA PARTIDA…</p>}
        {conectado && !perfil && entrandoNaConta && <p className="form-notice">ENTRANDO NA SUA CONTA…</p>}
        {!perfil && !entrandoNaConta && (
          <div className="ranked-convidado">
            <p className="ranked-note">
              A ranqueada é de quem tem conta: o nome é único, e os pontos de liga, o tier e o histórico ficam com você em qualquer
              aparelho.
            </p>
            <button className="primary-button" onClick={onEntrarNaConta}>
              ENTRAR OU CRIAR CONTA <span>↗</span>
            </button>
          </div>
        )}

        {painel && (
          <>
            {emColocacao ? (
              <p className="ranked-note">
                Mais {painel.colocacao} {painel.colocacao === 1 ? 'corrida' : 'corridas'} de colocação. Nelas você não perde PL,
                e o seu tier sai de onde o seu desempenho aponta.
              </p>
            ) : (
              <div className={`pl-meter ${painel.tier}`} aria-label={painel.divisao}>
                <div className="boost-copy">
                  <span>{painel.divisao}</span>
                  <b>{painel.posicao ? `#${painel.posicao} NA ESCADA` : ''}</b>
                </div>
                <div className="boost-track"><i style={{ width: `${plNaDivisao(painel.divisao)}%` }} /></div>
              </div>
            )}
            {painel.subindo && <p className="ranked-note subindo">▲ VOCÊ ESTÁ ACIMA DOS SEUS PL: GANHA MAIS E PERDE MENOS ATÉ ALCANÇÁ-LOS</p>}
            {painel.escudo > 0 && <p className="ranked-note">ESCUDO DE TIER: {painel.escudo} {painel.escudo === 1 ? 'CORRIDA' : 'CORRIDAS'}</p>}
            <dl className="ranked-stats">
              <div><dt>CORRIDAS</dt><dd>{painel.corridas}</dd></div>
              <div><dt>PÓDIOS</dt><dd>{painel.podios}</dd></div>
              <div><dt>PICO</dt><dd>{painel.pico} PL</dd></div>
              <div><dt>ABANDONOS</dt><dd>{painel.abandonos}</dd></div>
            </dl>
          </>
        )}

        <div className="ranked-queue">
          {naFila ? (
            <>
              <p className="ranked-searching">
                <i aria-hidden="true" /> PROCURANDO PILOTOS · {naFilaDesde ? Math.max(0, Math.floor((agora - naFilaDesde) / 1000)) : 0} S
                <small>{tamanhoDaFila <= 1 ? 'SÓ VOCÊ NA FILA — AOS 40 S, VOCÊ CORRE CONTRA FANTASMAS DE VOLTAS RANQUEADAS DE PILOTOS DO SEU NÍVEL' : `${tamanhoDaFila} NA FILA`}</small>
              </p>
              <button className="text-button" onClick={onSair}>SAIR DA FILA</button>
            </>
          ) : (
            perfil && (
              <button className="primary-button" disabled={!conectado || bloqueado} onClick={onEntrar}>
                {bloqueado ? `VOLTA EM ${Math.ceil((esperaAte! - agora) / 1000)} S` : 'ENTRAR NA FILA'} <span>↗</span>
              </button>
            )
          )}
          {aviso && <p className="form-error">{aviso}</p>}
          <p className="ranked-note">
            HORÁRIO RANQUEADO: {HORARIO_RANQUEADO}. A fila espera até 20 s para juntar até seis pilotos de nível parecido;
            a largada é automática, no nível difícil, numa das pistas da semana.
            {situacao && situacao.online > 0 && (
              <b className="ranked-online"> {situacao.online} {situacao.online === 1 ? 'APARELHO CONECTADO' : 'APARELHOS CONECTADOS'} AGORA.</b>
            )}
          </p>
        </div>

        {situacao && situacao.escada.length > 0 && (
          <section className="ranked-ladder" aria-label="Escada da temporada">
            <h2>ESCADA DA TEMPORADA</h2>
            <ol>
              {situacao.escada.map((linha) => (
                <li key={linha.perfilId} className={`${linha.tier} ${linha.perfilId === perfil?.id ? 'me' : ''}`}>
                  <b>{linha.posicao}</b>
                  <span>{linha.apelido}{linha.lenda && <em>LENDA</em>}</span>
                  <i>{linha.divisao}</i>
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="ranked-links">
          {perfil && (
            <button className="text-button" onClick={onVerPerfil}>
              SEU PERFIL E ESTATÍSTICAS
            </button>
          )}
          <button className="text-button" onClick={onVerRanking}>
            ESCADA COMPLETA NO RANKING MUNDIAL
          </button>
        </div>

        <button className="text-button" onClick={onVoltar}>VOLTAR AO PADDOCK</button>
      </section>
    </main>
  )
}
