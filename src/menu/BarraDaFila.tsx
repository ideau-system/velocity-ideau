import { useEffect, useState, type CSSProperties } from 'react'
import { serverClock } from '../multiplayer/clock'
import { cronometro, leituraDaFila, type BuscaRanqueada } from './tempo'

type Props = BuscaRanqueada & {
  onCancelar: () => void
  /** Fora do paddock — no ranking, no perfil —, a barra flutua no topo da tela. */
  flutuante?: boolean
}

/**
 * A busca da ranqueada, sempre à vista.
 *
 * Como nos jogos de fila, procurar partida não prende o piloto numa tela: ele
 * anda pelo menu, olha o ranking, confere o perfil, e a barra continua
 * contando — quanto tempo já esperou, quantos estão com ele e quando a sala
 * fecha. Quando a partida sai, a largada chama de onde ele estiver.
 */
export default function BarraDaFila({ onCancelar, flutuante = false, ...busca }: Props) {
  const [agora, setAgora] = useState(serverClock.now)

  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(serverClock.now()), 250)
    return () => window.clearInterval(relogio)
  }, [])

  const { texto, progresso } = leituraDaFila(busca, agora)
  const esperando = busca.desde === null ? 0 : agora - busca.desde

  return (
    <section
      className={`fila-barra ${flutuante ? 'flutuante' : ''}`}
      aria-label="Busca de partida ranqueada"
      style={{ '--progresso': progresso } as CSSProperties}
    >
      <span className="fila-pulso" aria-hidden="true" />
      <div className="fila-texto">
        <strong>PROCURANDO PARTIDA<span className="fila-ranqueada"> RANQUEADA</span></strong>
        <small>{texto}</small>
      </div>
      <b className="fila-tempo" title="Tempo na fila">
        {cronometro(esperando)}
      </b>
      <button type="button" className="fila-cancelar" onClick={onCancelar}>
        CANCELAR
      </button>
      <i className="fila-progresso" aria-hidden="true" />
    </section>
  )
}
