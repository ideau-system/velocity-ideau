import { useState, type FormEvent } from 'react'
import { SENHA_MINIMA, trocarSenha } from '../conta/conta'
import { carById, toCarId } from '../game/cars'
import { carImageUrl } from '../game/carSprites'
import { MEDALHAS, NOME_DA_MEDALHA } from '../game/contrarrelogio'
import { formatTime } from '../game/track'
import type { ModoDaCorrida, PerfilDoPiloto } from '../multiplayer/perfil'
import { NOME_DO_TIER } from '../multiplayer/ranqueada'

type Props = {
  perfil: PerfilDoPiloto | null
  carregando: boolean
  erro: string
  /** O perfil é de quem está olhando: mostra a conta, a troca de senha e a saída. */
  proprio: boolean
  email?: string | null
  onVoltar: () => void
  onSair?: () => void
  onCorrerCircuito?: () => void
}

const NOME_DO_MODO: Record<ModoDaCorrida, string> = { casual: 'SALA', ranqueada: 'RANQUEADA', copa: 'COPA' }

const porcentagem = (fracao: number | null) => (fracao === null ? '—' : `${Math.round(fracao * 100)}%`)
const numero = (valor: number) => valor.toLocaleString('pt-BR')
const data = (instante: number) => new Date(instante).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const dataCurta = (instante: number) => new Date(instante).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

/**
 * O perfil do piloto: o próprio ou o de outro, aberto pelo nome num ranking.
 *
 * Primeiro o que diz quem ele é na pista — corridas, vitórias, aproveitamento
 * —, depois a ranqueada, os melhores tempos e o que ficou das Copas. As
 * corridas recentes fecham, com o que cada uma rendeu. A conta — e-mail,
 * senha, sair — só aparece para o dono.
 */
export default function Perfil({ perfil, carregando, erro, proprio, email, onVoltar, onSair, onCorrerCircuito }: Props) {
  const [novaSenha, setNovaSenha] = useState('')
  const [repetida, setRepetida] = useState('')
  const [trocando, setTrocando] = useState(false)
  const [recadoDaSenha, setRecadoDaSenha] = useState<{ ok: boolean; texto: string } | null>(null)
  const [mostrarSenha, setMostrarSenha] = useState(false)

  const salvarSenha = async (event: FormEvent) => {
    event.preventDefault()
    if (novaSenha.length < SENHA_MINIMA) return setRecadoDaSenha({ ok: false, texto: `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.` })
    if (novaSenha !== repetida) return setRecadoDaSenha({ ok: false, texto: 'As duas senhas não são iguais.' })
    setTrocando(true)
    const resultado = await trocarSenha(novaSenha)
    setTrocando(false)
    if (!resultado.ok) return setRecadoDaSenha({ ok: false, texto: resultado.erro })
    setNovaSenha('')
    setRepetida('')
    setMostrarSenha(false)
    setRecadoDaSenha({ ok: true, texto: 'Senha trocada.' })
  }

  const ranqueada = perfil?.ranqueada ?? null
  const emColocacao = ranqueada !== null && ranqueada.colocacao > 0
  const favorito = perfil?.carroFavorito ? carById(toCarId(perfil.carroFavorito.carro)) : null

  return (
    <main className="screen perfil-screen">
      <div className="ambient-grid" />
      <section className="perfil-card" aria-busy={carregando}>
        <header className="perfil-header">
          <div>
            <p className="eyebrow">{proprio ? 'SEU PERFIL' : 'PERFIL DO PILOTO'}</p>
            <h1>{perfil?.apelido ?? (carregando ? '…' : 'PILOTO')}</h1>
            {perfil && <p className="perfil-desde">NO GRID DESDE {data(perfil.desde)}</p>}
          </div>
          {ranqueada && (
            <div className={`tier-badge ${emColocacao ? 'colocacao' : ranqueada.tier}`}>
              <span>{emColocacao ? 'EM COLOCAÇÃO' : NOME_DO_TIER[ranqueada.tier]}</span>
              <strong>
                {emColocacao
                  ? `${ranqueada.colocacaoTotal - ranqueada.colocacao}/${ranqueada.colocacaoTotal}`
                  : ranqueada.divisao.replace(/ · .*/, '')}
              </strong>
            </div>
          )}
        </header>

        {carregando && !perfil && <p className="form-notice">CARREGANDO O PERFIL…</p>}
        {erro && <p className="form-error">{erro}</p>}

        {perfil && (
          <>
            <section className="perfil-bloco" aria-labelledby="perfil-online">
              <h2 id="perfil-online">CORRIDAS ONLINE</h2>
              <dl className="perfil-numeros">
                <div><dt>CORRIDAS</dt><dd>{numero(perfil.online.corridas)}</dd></div>
                <div><dt>VITÓRIAS</dt><dd>{numero(perfil.online.vitorias)}</dd></div>
                <div><dt>PÓDIOS</dt><dd>{numero(perfil.online.podios)}</dd></div>
                <div><dt>APROVEITAMENTO</dt><dd>{porcentagem(perfil.online.aproveitamento)}</dd></div>
                <div><dt>POSIÇÃO MÉDIA</dt><dd>{perfil.online.posicaoMedia === null ? '—' : perfil.online.posicaoMedia.toFixed(1).replace('.', ',')}</dd></div>
                <div><dt>ABANDONOS</dt><dd>{numero(perfil.online.abandonos)}</dd></div>
              </dl>
              <p className="perfil-modos">
                {(Object.keys(NOME_DO_MODO) as ModoDaCorrida[]).map((modo) => (
                  <span key={modo}>
                    {NOME_DO_MODO[modo]} <b>{perfil.porModo[modo].corridas}</b>
                    {perfil.porModo[modo].vitorias > 0 && <em> · {perfil.porModo[modo].vitorias} V</em>}
                  </span>
                ))}
              </p>
            </section>

            {ranqueada && (
              <section className="perfil-bloco" aria-labelledby="perfil-ranqueada">
                <h2 id="perfil-ranqueada">RANQUEADA · TEMPORADA {ranqueada.temporada}</h2>
                {ranqueada.corridas === 0 ? (
                  <p className="ranked-note">Ainda sem corrida ranqueada nesta temporada.</p>
                ) : (
                  <dl className="perfil-numeros">
                    <div><dt>{emColocacao ? 'COLOCAÇÃO' : 'DIVISÃO'}</dt><dd className={emColocacao ? '' : `tier-texto ${ranqueada.tier}`}>{emColocacao ? `${ranqueada.colocacaoTotal - ranqueada.colocacao}/${ranqueada.colocacaoTotal}` : ranqueada.divisao}</dd></div>
                    <div><dt>NA ESCADA</dt><dd>{ranqueada.posicao ? `#${ranqueada.posicao}` : '—'}</dd></div>
                    <div><dt>PICO</dt><dd>{ranqueada.pico} PL</dd></div>
                    <div><dt>CORRIDAS</dt><dd>{ranqueada.corridas}</dd></div>
                    <div><dt>PÓDIOS</dt><dd>{ranqueada.podios}</dd></div>
                    <div><dt>ABANDONOS</dt><dd>{ranqueada.abandonos}</dd></div>
                  </dl>
                )}
                {perfil.temporadas.length > 0 && (
                  <ol className="perfil-temporadas" aria-label="Temporadas anteriores">
                    {perfil.temporadas.map((temporada) => (
                      <li key={temporada.temporada} className={temporada.tier}>
                        <b>{temporada.temporada}</b>
                        <span>{temporada.divisao}</span>
                        <i>PICO {temporada.pico} PL · {temporada.corridas} CORRIDAS</i>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            <section className="perfil-bloco" aria-labelledby="perfil-tempos">
              <h2 id="perfil-tempos">MELHORES TEMPOS</h2>
              <div className="perfil-mundial">
                <div>
                  <span>RANKING MUNDIAL · CIRCUITO OFICIAL</span>
                  {perfil.mundial ? (
                    <strong>
                      {formatTime(perfil.mundial.tempo)} <em>#{perfil.mundial.posicao} NO MUNDO</em>
                    </strong>
                  ) : (
                    <strong className="sem-tempo">SEM TEMPO AINDA</strong>
                  )}
                </div>
                {proprio && onCorrerCircuito && (
                  <button type="button" className="solo-button" onClick={onCorrerCircuito}>
                    {perfil.mundial ? 'MELHORAR O TEMPO' : 'CORRER O CIRCUITO'} <span>↗</span>
                  </button>
                )}
              </div>
              <dl className="perfil-numeros">
                <div><dt>VOLTAS NO CONTRARRELÓGIO</dt><dd>{numero(perfil.contrarrelogio.voltas)}</dd></div>
                <div><dt>PISTAS COM TEMPO</dt><dd>{numero(perfil.contrarrelogio.pistas)}</dd></div>
                <div><dt>QUADROS LIDERADOS</dt><dd>{numero(perfil.contrarrelogio.lideradas)}</dd></div>
              </dl>
              <ol className="medal-ladder perfil-medalhas" aria-label="Medalhas por pista">
                {MEDALHAS.map((medalha) => (
                  <li key={medalha} className={`${medalha} ${perfil.contrarrelogio.medalhas[medalha] > 0 ? 'on' : ''}`}>
                    <span>{NOME_DA_MEDALHA[medalha]}</span>
                    <b>×{perfil.contrarrelogio.medalhas[medalha]}</b>
                  </li>
                ))}
              </ol>
            </section>

            <section className="perfil-bloco perfil-pista" aria-labelledby="perfil-pista">
              <h2 id="perfil-pista">NA PISTA</h2>
              {favorito && (
                <div className="perfil-favorito">
                  <img src={carImageUrl(favorito.id)} alt="" />
                  <div>
                    <span>CARRO FAVORITO</span>
                    <strong>{favorito.driver}</strong>
                    <em>{favorito.team} · {perfil.carroFavorito!.corridas} {perfil.carroFavorito!.corridas === 1 ? 'CORRIDA' : 'CORRIDAS'}</em>
                  </div>
                </div>
              )}
              <dl className="perfil-numeros">
                <div><dt>VELOCIDADE MÁX.</dt><dd>{perfil.online.velocidadeMaxima} <small>KM/H</small></dd></div>
                <div><dt>RODADOS</dt><dd>{perfil.kmRodados.toLocaleString('pt-BR')} <small>KM</small></dd></div>
                <div><dt>BATIDAS</dt><dd>{numero(perfil.online.batidas)}</dd></div>
              </dl>
              <p className="perfil-trofeus" aria-label="Troféus da Copa do Dia">
                COPA DO DIA
                {perfil.copa.ouro + perfil.copa.prata + perfil.copa.bronze === 0 ? (
                  <em>SEM TROFÉU AINDA</em>
                ) : (
                  <>
                    <b className="taca-1">1º ×{perfil.copa.ouro}</b>
                    <b className="taca-2">2º ×{perfil.copa.prata}</b>
                    <b className="taca-3">3º ×{perfil.copa.bronze}</b>
                  </>
                )}
              </p>
            </section>

            {perfil.recentes.length > 0 && (
              <section className="perfil-bloco" aria-labelledby="perfil-recentes">
                <h2 id="perfil-recentes">ÚLTIMAS CORRIDAS</h2>
                <ol className="perfil-recentes">
                  {perfil.recentes.map((corrida) => (
                    <li key={`${corrida.instante}-${corrida.modo}`} className={corrida.posicao === 1 && corrida.desfecho === 'chegou' && corrida.pilotos > 1 ? 'vitoria' : ''}>
                      <b>P{corrida.posicao}<small>/{corrida.pilotos}</small></b>
                      <span>
                        {NOME_DO_MODO[corrida.modo]} · {dataCurta(corrida.instante)}
                        <small>{carById(toCarId(corrida.carro)).driver}</small>
                      </span>
                      <i>
                        {corrida.desfecho === 'chegou' && corrida.tempo !== null
                          ? formatTime(corrida.tempo)
                          : corrida.desfecho === 'abandonou'
                            ? 'ABANDONOU'
                            : 'NÃO COMPLETOU'}
                        {corrida.deltaPl !== null && (
                          <em className={corrida.deltaPl >= 0 ? 'ganho' : 'perda'}>
                            {corrida.deltaPl >= 0 ? '+' : ''}{corrida.deltaPl} PL
                          </em>
                        )}
                      </i>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}

        {proprio && perfil && (
          <section className="perfil-bloco perfil-conta" aria-labelledby="perfil-conta">
            <h2 id="perfil-conta">CONTA</h2>
            {email && <p className="perfil-email">{email}</p>}
            {mostrarSenha ? (
              <form className="perfil-senha" onSubmit={(event) => void salvarSenha(event)} noValidate>
                <div className="identity-field">
                  <label htmlFor="perfil-nova-senha">NOVA SENHA</label>
                  <input id="perfil-nova-senha" type="password" autoComplete="new-password" value={novaSenha} onChange={(event) => setNovaSenha(event.target.value)} />
                </div>
                <div className="identity-field">
                  <label htmlFor="perfil-repetida">REPITA A SENHA</label>
                  <input id="perfil-repetida" type="password" autoComplete="new-password" value={repetida} onChange={(event) => setRepetida(event.target.value)} />
                </div>
                <button type="submit" className="solo-button" disabled={trocando}>
                  {trocando ? 'SALVANDO…' : 'SALVAR A SENHA'} <span>↗</span>
                </button>
              </form>
            ) : (
              <button type="button" className="text-button" onClick={() => { setMostrarSenha(true); setRecadoDaSenha(null) }}>
                TROCAR A SENHA
              </button>
            )}
            {recadoDaSenha && <p className={recadoDaSenha.ok ? 'form-notice' : 'form-error'}>{recadoDaSenha.texto}</p>}
            {onSair && (
              <button type="button" className="text-button perfil-sair" onClick={onSair}>
                SAIR DA CONTA
              </button>
            )}
          </section>
        )}

        <button type="button" className="text-button" onClick={onVoltar}>
          VOLTAR
        </button>
      </section>
    </main>
  )
}
