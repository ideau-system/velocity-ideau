import { medalhasLimpas, ondePerdeuTempo, type AnaliseDaCorrida } from './game/analise'
import { rulesFor, type Difficulty } from './game/rules'

type Props = {
  analise: AnaliseDaCorrida
  difficulty: Difficulty
}

/**
 * O que a prova mostrou, na tela de resultado.
 *
 * Onde o piloto perdeu tempo — com a estimativa em segundos, que é o que diz o
 * que treinar —, as metas de corrida limpa e o que ele usou da pista. Nada
 * disso entra na classificação: é para quem quer melhorar, e é por isso que
 * aparece para quem venceu e para quem não venceu.
 */
export default function ResumoDaProva({ analise, difficulty }: Props) {
  const perdas = ondePerdeuTempo(analise, rulesFor(difficulty)).slice(0, 3)
  const medalhas = medalhasLimpas(analise)
  const [, nivel1, nivel2, nivel3] = analise.miniTurbos

  return (
    <section className="resumo-da-prova" aria-label="Resumo da prova">
      <div className="resumo-bloco">
        <h2>ONDE VOCÊ PERDEU TEMPO</h2>
        {perdas.length === 0 ? (
          <p className="resumo-limpo">Prova limpa: nada a apontar nas contas.</p>
        ) : (
          <ol className="resumo-perdas">
            {perdas.map((perda) => (
              <li key={perda.motivo}>
                <span>{perda.motivo}</span>
                <b>≈ {perda.segundos.toFixed(1).replace('.', ',')} s</b>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="resumo-bloco">
        <h2>O QUE VOCÊ USOU DA PISTA</h2>
        <dl className="resumo-uso">
          <div><dt>TANGÊNCIAS</dt><dd>{analise.tangencias}/{analise.tangenciasPossiveis}</dd></div>
          <div><dt>MELHOR SEQUÊNCIA</dt><dd>×{analise.maiorSequencia}</dd></div>
          <div>
            <dt>MINI-TURBOS</dt>
            <dd className="resumo-turbos">
              <i className="nivel-1">I×{nivel1}</i> <i className="nivel-2">II×{nivel2}</i> <i className="nivel-3">III×{nivel3}</i>
            </dd>
          </div>
          <div><dt>RASPÕES</dt><dd>{analise.raspoes}</dd></div>
          {/* Só para quem trocou na mão: no automático não há troca a julgar. */}
          {analise.subidasNaMao > 0 && (
            <div><dt>TROCAS PERFEITAS</dt><dd>{analise.trocasPerfeitas}/{analise.subidasNaMao}</dd></div>
          )}
        </dl>
      </div>

      <ul className="resumo-medalhas" aria-label="Metas de corrida limpa">
        {medalhas.map((medalha) => (
          <li key={medalha.id} className={medalha.conquistada ? 'on' : ''}>
            <i aria-hidden="true">{medalha.conquistada ? '✓' : '·'}</i>
            {medalha.nome}
            <span className="sr-only">{medalha.conquistada ? ' — conquistada' : ' — não conquistada'}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
