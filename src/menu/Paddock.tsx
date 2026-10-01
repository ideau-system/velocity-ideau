import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { carById, type CarId } from '../game/cars'
import { carImageUrl } from '../game/carSprites'
import {
  DIFICULDADE_OFICIAL,
  MEDALHAS,
  medalhaPara,
  NOME_DA_MEDALHA,
  viradaDoDia,
  type Medalha,
  type Recorde,
} from '../game/contrarrelogio'
import { MODIFICADORES, semanaDe, viradaDaSemana, type Desafio } from '../game/desafios'
import { DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_NOTES, type Difficulty } from '../game/rules'
import { formatTime } from '../game/track'
import { serverClock } from '../multiplayer/clock'
import { faseNoRelogio, type FaseDaCopa, type SituacaoDaCopa } from '../multiplayer/copa'
import type { MovimentoDoJogo } from '../multiplayer/movimento'
import type { PerfilPublico } from '../multiplayer/perfil'
import type { LinhaDoQuadro, QuadroDoDia, ResumoDoDesafio } from '../multiplayer/pistaDoDia'
import { NOME_DO_TIER, type SituacaoDaRanqueada } from '../multiplayer/ranqueada'
import BarraDaFila from './BarraDaFila'
import Icone from './Icone'
import { MODOS_DO_MENU, modoPorId, NOME_DO_GRUPO, type DefinicaoDoModo, type GrupoDoMenu, type ModoDoMenu } from './modos'
import Opcoes from './Opcoes'
import { faltam, horaDe, HORARIO_NOBRE, noHorarioNobre, type BuscaRanqueada } from './tempo'
import './paddock.css'

/** Até esta largura o paddock é uma coluna só, e o painel do modo abre no lugar da lista. */
const TELA_ESTREITA = '(max-width: 860px)'

type Props = {
  conectado: boolean
  movimento: MovimentoDoJogo | null
  /** A ida e volta até o servidor, em ms, ou null antes da primeira medida. */
  latencia: number | null
  /** O último aviso do jogo — sala que sumiu, sessão que venceu —, até o piloto fechar. */
  erro: string
  onFecharErro: () => void

  conta: {
    perfil: PerfilPublico | null
    /** Há conta no aparelho, e o servidor ainda não a conferiu. */
    entrando: boolean
    /** A conta vale, mas o servidor não respondeu ao ligá-la. */
    semServidor: boolean
    onEntrar: () => void
    onReligar: () => void
    onPerfil: () => void
  }
  onRanking: () => void
  onGaragem: () => void
  car: CarId

  modo: ModoDoMenu
  /** Escolhe um modo. `abrir` leva ao painel dele quando a tela é estreita. */
  onModo: (modo: ModoDoMenu, abrir: boolean) => void
  detalheAberto: boolean
  onFecharDetalhe: () => void

  ranqueada: {
    situacao: SituacaoDaRanqueada | null
    naFila: boolean
    busca: BuscaRanqueada
    aviso: string
    onBuscar: () => void
    onCancelar: () => void
    onEscada: () => void
  }
  sala: {
    /** O nome digitado pelo convidado, e o que vale enquanto ele não digita. */
    rascunho: string
    nomeAtual: string
    onNome: (nome: string) => void
    codigo: string
    /** O código chegou pelo link de convite. */
    convidado: boolean
    onCodigo: (codigo: string) => void
    onCriar: () => void
    onEntrar: () => void
    onAssistir: () => void
  }
  treino: {
    dificuldade: Difficulty
    onDificuldade: (dificuldade: Difficulty) => void
    onIniciar: () => void
  }
  pistaDoDia: {
    dia: string
    limites: Record<Medalha, number>
    recorde: Recorde | null
    quadro: QuadroDoDia | null
    onCorrer: () => void
    onCorrerContra: (linha: LinhaDoQuadro) => void
  }
  desafios: {
    lista: readonly Desafio[]
    doServidor: ResumoDoDesafio[] | null
    recordes: ReadonlyMap<string, Recorde | null>
    onCorrer: (desafio: Desafio) => void
  }
  circuito: {
    quadro: QuadroDoDia | null
    recorde: Recorde | null
    onCorrer: () => void
    onCorrerContra: (linha: LinhaDoQuadro) => void
    onRanking: () => void
  }
  copa: {
    situacao: SituacaoDaCopa | null
    aviso: string
    onInscrever: () => void
    onSair: () => void
    onCorrer: () => void
  }
}

const cor = (valor: string) => ({ '--cor': valor }) as CSSProperties
const segundos = (valor: number) => `${valor.toFixed(3).replace('.', ',')} S`
const MEDALHA_ACIMA: Record<Medalha, Medalha | null> = { bronze: 'prata', prata: 'ouro', ouro: 'autor', autor: null }

/**
 * O selo à direita de um modo na lista: "ao vivo", o tier, a medalha. O tom
 * `tier` pinta com a cor do tier ou da medalha que vem em `tier`.
 */
type Selo = { texto: string; tom: 'vivo' | 'ok' | 'neutro' | 'tier'; tier?: string }
type EstadoDoModo = { linha: string; selo?: Selo }

/**
 * O paddock: o menu principal.
 *
 * Arrumado como os menus de jogo com muitos modos — a lista de modos à
 * esquerda, o painel do modo escolhido no meio, com o botão de jogar sempre no
 * mesmo lugar, e o carro e o movimento do jogo à direita. Cada modo mostra na
 * própria linha o que muda com o tempo: quantos estão na fila, quanto falta
 * para a copa, quando a pista do dia troca. No celular a lista vira a tela de
 * entrada, e o painel do modo abre por cima dela.
 */
export default function Paddock(props: Props) {
  const { conectado, movimento, latencia, erro, onFecharErro, conta, onRanking, onGaragem, car, modo, onModo, detalheAberto, onFecharDetalhe } = props
  const { ranqueada, sala, treino, pistaDoDia, desafios, circuito, copa } = props
  const [agora, setAgora] = useState(serverClock.now)
  const [opcoesAbertas, setOpcoesAbertas] = useState(false)
  const abas = useRef(new Map<ModoDoMenu, HTMLButtonElement>())
  const tituloDoPainel = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(serverClock.now()), 1_000)
    return () => window.clearInterval(relogio)
  }, [])

  // Na tela estreita o painel abre no lugar da lista: o foco vai para o título
  // dele, e volta para o modo quando o piloto retorna à lista.
  const primeiraMontagem = useRef(true)
  useEffect(() => {
    if (primeiraMontagem.current) {
      primeiraMontagem.current = false
      return
    }
    if (!matchMedia(TELA_ESTREITA).matches) return
    window.scrollTo(0, 0)
    if (detalheAberto) tituloDoPainel.current?.focus()
    else abas.current.get(modo)?.focus()
    // O modo não entra: o efeito é da ida e da volta, não da troca de modo.
  }, [detalheAberto])

  const perfil = conta.perfil
  const naFila = ranqueada.naFila
  const painelRanqueado = ranqueada.situacao?.painel ?? null
  const copaAgora = copa.situacao ? { ...copa.situacao, fase: faseNoRelogio(copa.situacao, agora) } : null
  const definicao = modoPorId(modo)

  /** Setas, Home e End andam pela lista de modos, como num grupo de abas. */
  const andarNaLista = (event: KeyboardEvent<HTMLDivElement>) => {
    const total = MODOS_DO_MENU.length
    const indice = MODOS_DO_MENU.findIndex((item) => item.id === modo)
    const destino =
      event.key === 'ArrowDown' ? (indice + 1) % total
      : event.key === 'ArrowUp' ? (indice - 1 + total) % total
      : event.key === 'Home' ? 0
      : event.key === 'End' ? total - 1
      : null
    if (destino === null) return
    event.preventDefault()
    const alvo = MODOS_DO_MENU[destino].id
    onModo(alvo, false)
    abas.current.get(alvo)?.focus()
  }

  /** O que cada modo diz na própria linha da lista, ao vivo. */
  const estadoDo = (id: ModoDoMenu): EstadoDoModo => {
    switch (id) {
      case 'sala':
        return sala.convidado && sala.codigo
          ? { linha: `CONVITE PARA A SALA ${sala.codigo}`, selo: { texto: 'CONVITE', tom: 'vivo' } }
          : { linha: 'CRIE OU ENTRE COM CÓDIGO' }
      case 'ranqueada': {
        if (naFila) return { linha: 'PROCURANDO PARTIDA…', selo: { texto: 'NA FILA', tom: 'vivo' } }
        const fila = movimento ? `${movimento.naFila} NA FILA AGORA` : 'FILA PÚBLICA'
        const linha = noHorarioNobre(agora) ? `HORÁRIO NOBRE · ${fila}` : fila
        if (!perfil) return { linha, selo: { texto: 'CONTA', tom: 'neutro' } }
        if (!painelRanqueado) return { linha }
        return {
          linha,
          selo: painelRanqueado.colocacao > 0
            ? { texto: 'COLOCAÇÃO', tom: 'neutro' }
            : { texto: painelRanqueado.divisao.replace(/ · .*/, ''), tom: 'tier', tier: painelRanqueado.tier },
        }
      }
      case 'copa': {
        if (!copaAgora) return { linha: 'TODO DIA À NOITE' }
        const inscrito = copaAgora.inscrito ? { texto: 'INSCRITO', tom: 'ok' as const } : undefined
        switch (copaAgora.fase) {
          case 'inscricoes': {
            // Inscrito, o selo já diz: a linha fica só com o relógio, e não corta.
            const abre = `ABRE EM ${faltam(copaAgora.abertura - agora)}`
            const quantos = `${copaAgora.inscritos} ${copaAgora.inscritos === 1 ? 'INSCRITO' : 'INSCRITOS'}`
            return { linha: inscrito ? abre : `${abre} · ${quantos}`, selo: inscrito }
          }
          case 'classificacao':
            return { linha: `CLASSIFICAÇÃO · ${faltam(copaAgora.fechamento - agora)}`, selo: { texto: 'AO VIVO', tom: 'vivo' } }
          case 'apuracao':
            return { linha: `DIVISÕES EM ${faltam(copaAgora.eliminatorias - agora)}`, selo: { texto: 'AO VIVO', tom: 'vivo' } }
          case 'eliminatorias':
            return { linha: 'ELIMINATÓRIAS EM ANDAMENTO', selo: { texto: 'AO VIVO', tom: 'vivo' } }
          case 'encerrada':
            return { linha: `A PRÓXIMA É AMANHÃ ÀS ${horaDe(copaAgora.abertura)}` }
        }
        return { linha: 'TODO DIA À NOITE' }
      }
      case 'treino':
        return { linha: `SEM ESPERA · NÍVEL ${DIFFICULTY_LABELS[treino.dificuldade]}` }
      case 'pistaDoDia': {
        const medalha = pistaDoDia.recorde ? medalhaPara(pistaDoDia.recorde.tempo, pistaDoDia.limites) : null
        return {
          linha: `TROCA EM ${faltam(viradaDoDia(agora) - agora)}`,
          selo: medalha ? { texto: NOME_DA_MEDALHA[medalha].toUpperCase(), tom: 'tier', tier: medalha } : undefined,
        }
      }
      case 'desafios': {
        const comTempo = desafios.lista.filter((desafio) => desafios.recordes.get(desafio.id)).length
        return {
          linha: `ZERA EM ${faltam(viradaDaSemana(semanaDe(agora)) - agora)}`,
          selo: { texto: `${comTempo}/${desafios.lista.length}`, tom: comTempo === desafios.lista.length ? 'ok' : 'neutro' },
        }
      }
      case 'circuito': {
        const voce = circuito.quadro?.voce
        const lider = circuito.quadro?.linhas[0]
        if (voce) return { linha: `VOCÊ É O #${voce.posicao} DO MUNDO`, selo: { texto: `#${voce.posicao}`, tom: 'ok' } }
        return { linha: lider ? `RECORDE MUNDIAL ${formatTime(lider.tempo)}` : 'RANKING MUNDIAL' }
      }
    }
  }

  const grupos: GrupoDoMenu[] = ['online', 'solo']

  return (
    <main className="screen paddock" data-detalhe={detalheAberto ? 'aberto' : 'fechado'}>
      <div className="ambient-grid" />

      <header className="paddock-topo">
        <div className="logo"><i /><span>CORRIDA<br /><b>FANTASMA</b></span></div>
        <nav className="paddock-nav" aria-label="Menu principal">
          {/* Já é a tela de jogar: no celular, volta do painel do modo para a lista. */}
          <button type="button" className="on" aria-current="page" onClick={onFecharDetalhe}>
            <Icone nome="jogar" /><span>JOGAR</span>
          </button>
          <button type="button" onClick={onRanking}>
            <Icone nome="ranking" /><span>RANKING</span>
          </button>
          <button type="button" onClick={onGaragem} disabled={naFila} title={naFila ? 'Cancele a busca da ranqueada para trocar de carro.' : undefined}>
            <Icone nome="garagem" /><span>GARAGEM</span>
          </button>
          <button type="button" onClick={perfil ? conta.onPerfil : conta.onEntrar}>
            <Icone nome="perfil" /><span>PERFIL</span>
          </button>
          <button type="button" onClick={() => setOpcoesAbertas(true)} aria-haspopup="dialog">
            <Icone nome="opcoes" /><span>OPÇÕES</span>
          </button>
        </nav>
        <Status conectado={conectado} latencia={latencia} movimento={movimento} />
        <ChipDaConta conta={conta} situacao={ranqueada.situacao} />
      </header>

      {naFila && <BarraDaFila {...ranqueada.busca} onCancelar={ranqueada.onCancelar} />}

      {erro && (
        <p className="paddock-aviso" role="alert">
          <span>{erro}</span>
          <button type="button" onClick={onFecharErro} aria-label="Fechar o aviso">
            <Icone nome="fechar" />
          </button>
        </p>
      )}

      <div className="paddock-corpo">
        <section className="paddock-modos" aria-label="Modos de jogo">
          <div role="tablist" aria-orientation="vertical" aria-label="Modos de jogo" onKeyDown={andarNaLista}>
            {grupos.map((grupo) => (
              <div key={grupo} className="modos-grupo" role="none">
                <p className="modos-titulo" aria-hidden="true">{NOME_DO_GRUPO[grupo]}</p>
                {MODOS_DO_MENU.filter((item) => item.grupo === grupo).map((item) => {
                  const estado = estadoDo(item.id)
                  const escolhido = item.id === modo
                  return (
                    <button
                      key={item.id}
                      ref={(elemento) => {
                        if (elemento) abas.current.set(item.id, elemento)
                        else abas.current.delete(item.id)
                      }}
                      id={`aba-${item.id}`}
                      type="button"
                      role="tab"
                      aria-selected={escolhido}
                      aria-controls="paddock-painel"
                      tabIndex={escolhido ? 0 : -1}
                      className={`paddock-modo ${escolhido ? 'on' : ''}`}
                      style={cor(item.cor)}
                      onClick={() => onModo(item.id, true)}
                    >
                      <span className="modo-icone"><Icone nome={item.id} /></span>
                      <span className="modo-texto">
                        <strong>{item.nome}</strong>
                        <small>{estado.linha}</small>
                      </span>
                      {estado.selo && <span className={`modo-selo ${estado.selo.tom} ${estado.selo.tier ?? ''}`}>{estado.selo.texto}</span>}
                      <span className="modo-seta" aria-hidden="true">›</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </section>

        <Painel definicao={definicao} titulo={tituloDoPainel} onVoltar={onFecharDetalhe} {...conteudoDoPainel()} />

        <aside className="paddock-lado">
          <CartaoDoCarro car={car} naFila={naFila} onGaragem={onGaragem} />
          <Movimento movimento={movimento} agora={agora} />
        </aside>
      </div>

      <footer className="paddock-rodape">
        <div className="rodape-marca">
          <img src="/iedau.jpeg" alt="Faculdades IDEAU" />
          <span>PROJETO ACADÊMICO · PROTÓTIPO // 002</span>
        </div>
        <span className="rodape-dica" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> TROCA DE MODO</span>
        <span className="developer-credit">Desenvolvido por: <strong>Richarlison Ávila e Rafael Severo</strong></span>
      </footer>

      <Opcoes aberto={opcoesAbertas} onFechar={() => setOpcoesAbertas(false)} />
    </main>
  )

  /** O miolo do painel do modo escolhido: fatos, conteúdo e o botão de jogar. */
  function conteudoDoPainel(): ConteudoDoPainel {
    /** Outro modo não larga com a busca da ranqueada em andamento. */
    const presoNaFila = naFila ? <p className="acao-nota">Cancele a busca da ranqueada para jogar este modo.</p> : null
    switch (modo) {
      case 'sala':
        return painelDaSala()
      case 'ranqueada':
        return painelDaRanqueada()
      case 'copa':
        return painelDaCopa()
      case 'treino':
        return {
          fatos: ['SEM FILA', 'PISTA NOVA A CADA VOLTA', 'NÃO VALE RANKING'],
          conteudo: (
            <fieldset className="niveis">
              <legend className="bloco-titulo">NÍVEL DO TREINO</legend>
              <div className="niveis-opcoes">
                {DIFFICULTIES.map((nivel) => (
                  <button
                    key={nivel}
                    type="button"
                    className={treino.dificuldade === nivel ? 'on' : ''}
                    aria-pressed={treino.dificuldade === nivel}
                    onClick={() => treino.onDificuldade(nivel)}
                  >
                    <strong>{DIFFICULTY_LABELS[nivel]}</strong>
                    <small>{DIFFICULTY_NOTES[nivel]}</small>
                  </button>
                ))}
              </div>
            </fieldset>
          ),
          acao: (
            <>
              {presoNaFila}
              <BotaoDeJogar onClick={treino.onIniciar} disabled={naFila}>INICIAR TREINO</BotaoDeJogar>
            </>
          ),
        }
      case 'pistaDoDia':
        return painelDaPistaDoDia(presoNaFila)
      case 'desafios':
        return painelDosDesafios()
      case 'circuito':
        return painelDoCircuito(presoNaFila)
    }
  }

  function painelDaSala(): ConteudoDoPainel {
    const enviar = (event: FormEvent) => {
      event.preventDefault()
      sala.onEntrar()
    }
    return {
      fatos: ['1 VOLTA', '2 A 6 PILOTOS', 'CÂMBIO LIVRE', 'LARGADA QUANDO TODOS CONFIRMAM', 'ARQUIBANCADA ABERTA'],
      conteudo: (
        <>
          {perfil ? (
            <p className="bloco-nota">Você entra nas salas como <b>{perfil.apelido}</b>, o nome da sua conta.</p>
          ) : (
            <label className="campo">
              <span className="bloco-titulo">SEU NOME NA SALA</span>
              <input
                value={sala.rascunho}
                maxLength={16}
                onChange={(event) => sala.onNome(event.target.value)}
                placeholder={sala.nomeAtual}
                autoComplete="nickname"
              />
            </label>
          )}
          <div className={`sala-entrar ${sala.convidado && sala.codigo ? 'convite' : ''}`}>
            <p className="bloco-titulo">{sala.convidado && sala.codigo ? 'VOCÊ FOI CONVIDADO PARA ESTA SALA' : 'TEM UM CÓDIGO? ENTRE NA SALA DE UM AMIGO'}</p>
            <form className="sala-codigo" onSubmit={enviar}>
              <input
                value={sala.codigo}
                maxLength={5}
                onChange={(event) => sala.onCodigo(event.target.value.toUpperCase())}
                placeholder="ABCDE"
                aria-label="Código da sala"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
              <button type="submit" disabled={!conectado || naFila}>
                ENTRAR <Icone nome="play" />
              </button>
            </form>
            {/* Sala cheia ou prova em andamento não barram quem só quer ver. */}
            <button type="button" className="sala-assistir" onClick={sala.onAssistir} disabled={!conectado || naFila}>
              <Icone nome="olho" /> SÓ ASSISTIR, SEM OCUPAR VAGA
            </button>
          </div>
          <div className="bloco-nota">
            <b>Criar uma sala:</b> você vira o anfitrião — escolhe o nível, manda o link ou o QR e a largada sai quando todos confirmarem.
            O câmbio é livre: cada piloto escolhe manual ou automático no lobby.
          </div>
        </>
      ),
      // Quem chegou pelo convite quer entrar na sala do amigo: é esse o botão grande.
      acao: sala.convidado && sala.codigo ? (
        <>
          <button type="button" className="botao-secundario" onClick={sala.onCriar} disabled={!conectado || naFila}>CRIAR OUTRA SALA</button>
          <BotaoDeJogar onClick={sala.onEntrar} disabled={!conectado || naFila}>{conectado ? `ENTRAR NA SALA ${sala.codigo}` : 'CONECTANDO…'}</BotaoDeJogar>
        </>
      ) : (
        <>
          {naFila && <p className="acao-nota">Cancele a busca da ranqueada para abrir uma sala.</p>}
          <BotaoDeJogar onClick={sala.onCriar} disabled={!conectado || naFila}>{conectado ? 'CRIAR SALA' : 'CONECTANDO…'}</BotaoDeJogar>
        </>
      ),
    }
  }

  function painelDaRanqueada(): ConteudoDoPainel {
    const situacao = ranqueada.situacao
    const painel = painelRanqueado
    const emColocacao = painel !== null && painel.colocacao > 0
    const bloqueadoAte = situacao?.esperaAte && situacao.esperaAte > agora ? situacao.esperaAte : null
    const nobre = noHorarioNobre(agora)
    const escada = situacao?.escada.slice(0, 5) ?? []
    const plDaDivisao = painel ? Number(/(\d+) PL$/.exec(painel.divisao)?.[1] ?? 0) : 0

    const acao = !perfil && !conta.entrando ? (
      <BotaoDeJogar onClick={conta.onEntrar} icone="perfil">ENTRAR OU CRIAR CONTA</BotaoDeJogar>
    ) : naFila ? (
      <button type="button" className="botao-secundario" onClick={ranqueada.onCancelar}>CANCELAR A BUSCA</button>
    ) : (
      <BotaoDeJogar onClick={ranqueada.onBuscar} disabled={!conectado || !perfil || bloqueadoAte !== null}>
        {!perfil ? 'ENTRANDO NA CONTA…' : !conectado ? 'CONECTANDO…' : bloqueadoAte ? `LIBERADA EM ${faltam(bloqueadoAte - agora)}` : 'BUSCAR PARTIDA'}
      </BotaoDeJogar>
    )

    return {
      fatos: [
        'FILA PÚBLICA',
        `NÍVEL ${DIFFICULTY_LABELS[DIFICULDADE_OFICIAL]}`,
        'CÂMBIO MANUAL OBRIGATÓRIO',
        'VALE PONTOS DE LIGA',
        ...(painel ? [`TEMPORADA ${painel.temporada}`] : []),
      ],
      conteudo: (
        <>
          {!perfil && !conta.entrando && (
            <div className="bloco-destaque">
              <p>A ranqueada é de quem tem conta: o nome é único, e os pontos de liga (PL), o tier e o histórico ficam com você em qualquer aparelho.</p>
            </div>
          )}
          {perfil && !painel && <p className="bloco-nota">{conectado ? 'CARREGANDO O SEU TIER…' : 'CONECTE-SE PARA VER O SEU TIER.'}</p>}
          {painel && (
            <div className="rank-resumo">
              <div className={`rank-selo ${emColocacao ? 'colocacao' : painel.tier}`}>
                <small>{emColocacao ? 'EM COLOCAÇÃO' : NOME_DO_TIER[painel.tier]}</small>
                <strong>{emColocacao ? `${painel.colocacaoTotal - painel.colocacao}/${painel.colocacaoTotal}` : painel.divisao.replace(/ · .*/, '')}</strong>
              </div>
              <div className="rank-progresso">
                {emColocacao ? (
                  <p>
                    Mais <b>{painel.colocacao}</b> {painel.colocacao === 1 ? 'corrida' : 'corridas'} de colocação. Nelas você não perde PL, e o seu tier sai do seu desempenho.
                  </p>
                ) : (
                  <>
                    <p className="rank-progresso-topo">
                      <span>{painel.divisao}</span>
                      {painel.posicao && <b>#{painel.posicao} NA ESCADA</b>}
                    </p>
                    <div className={`barra ${painel.tier}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={plDaDivisao} aria-label="PL na divisão">
                      <i style={{ width: `${plDaDivisao}%` }} />
                    </div>
                  </>
                )}
                {painel.subindo && <p className="rank-subindo">▲ ACIMA DOS SEUS PL: GANHA MAIS E PERDE MENOS ATÉ ALCANÇÁ-LOS</p>}
                {painel.escudo > 0 && <p className="rank-escudo">ESCUDO DE TIER: {painel.escudo} {painel.escudo === 1 ? 'CORRIDA' : 'CORRIDAS'}</p>}
              </div>
            </div>
          )}
          {painel && (
            <dl className="numeros">
              <div><dt>CORRIDAS</dt><dd>{painel.corridas}</dd></div>
              <div><dt>PÓDIOS</dt><dd>{painel.podios}</dd></div>
              <div><dt>PICO</dt><dd>{painel.pico} <small>PL</small></dd></div>
              <div><dt>ABANDONOS</dt><dd>{painel.abandonos}</dd></div>
            </dl>
          )}
          {ranqueada.aviso && <p className="bloco-erro" role="alert">{ranqueada.aviso}</p>}
          <section className="bloco">
            <h2 className="bloco-titulo">COMO A FILA ANDA</h2>
            <ol className="passos">
              <li><b>Com 2 a 6 pilotos</b> do seu nível, a sala fecha na hora se encher, ou em até 20 s.</li>
              <li><b>Sozinho por 40 s?</b> Você corre contra fantasmas de voltas ranqueadas do seu nível.</li>
              <li>
                <b>A largada é automática</b>, no nível {DIFFICULTY_LABELS[DIFICULDADE_OFICIAL].toLowerCase()} e com câmbio manual para
                todos — E sobe, Q reduz —, numa das pistas da semana.
              </li>
            </ol>
            <p className={`nobre ${nobre ? 'on' : ''}`}>
              <Icone nome="relogio" />
              {nobre
                ? `HORÁRIO NOBRE AGORA, ATÉ AS ${HORARIO_NOBRE.ate}H: A FILA ENCHE MAIS`
                : `HORÁRIO NOBRE: TODO DIA, DAS ${HORARIO_NOBRE.de}H ÀS ${HORARIO_NOBRE.ate}H`}
              {movimento && ` · ${movimento.naFila} NA FILA AGORA`}
            </p>
          </section>
          {escada.length > 0 && (
            <section className="bloco">
              <h2 className="bloco-titulo">ESCADA DA TEMPORADA</h2>
              <ol className="escada">
                {escada.map((linha) => (
                  <li key={linha.perfilId} className={`${linha.tier} ${linha.perfilId === perfil?.id ? 'eu' : ''}`}>
                    <b>{linha.posicao}</b>
                    <span>{linha.apelido}{linha.lenda && <em>LENDA</em>}</span>
                    <i>{linha.divisao}</i>
                  </li>
                ))}
              </ol>
              <button type="button" className="botao-link" onClick={ranqueada.onEscada}>VER A ESCADA COMPLETA ›</button>
            </section>
          )}
        </>
      ),
      acao,
    }
  }

  function painelDaCopa(): ConteudoDoPainel {
    const situacao = copaAgora
    if (!situacao) {
      return {
        fatos: ['TODO DIA À NOITE', 'CLASSIFICAÇÃO + ELIMINATÓRIAS', 'VALE TROFÉU'],
        conteudo: <p className="bloco-nota">{conectado ? 'CARREGANDO A COPA DE HOJE…' : 'CONECTE-SE PARA VER A COPA DE HOJE.'}</p>,
        acao: <BotaoDeJogar disabled>{conectado ? 'CARREGANDO…' : 'CONECTANDO…'}</BotaoDeJogar>,
      }
    }
    const minutos = Math.round((situacao.fechamento - situacao.abertura) / 60_000)
    // Em que etapa a copa está: inscrições, classificação, eliminatórias — ou depois de todas.
    const ETAPA_DA_FASE: Record<FaseDaCopa, number> = { inscricoes: 0, classificacao: 1, apuracao: 2, eliminatorias: 2, encerrada: 3 }
    const etapa = (indice: number) => {
      const atual = ETAPA_DA_FASE[situacao.fase]
      return indice < atual ? 'feita' : indice === atual ? 'agora' : ''
    }
    const relogio: { rotulo: string; valor: string } =
      situacao.fase === 'inscricoes' ? { rotulo: 'A CLASSIFICAÇÃO ABRE EM', valor: faltam(situacao.abertura - agora) }
      : situacao.fase === 'classificacao' ? { rotulo: 'A CLASSIFICAÇÃO FECHA EM', valor: faltam(situacao.fechamento - agora) }
      : situacao.fase === 'apuracao' ? { rotulo: 'AS DIVISÕES LARGAM EM', valor: faltam(situacao.eliminatorias - agora) }
      : situacao.fase === 'eliminatorias' ? { rotulo: 'ELIMINATÓRIAS', valor: 'AO VIVO' }
      : { rotulo: 'A PRÓXIMA COPA', valor: `AMANHÃ ${horaDe(situacao.abertura)}` }
    const aberta = situacao.fase === 'inscricoes' || situacao.fase === 'classificacao'

    const acao = aberta && !situacao.inscrito ? (
      perfil || conta.entrando ? (
        <BotaoDeJogar onClick={copa.onInscrever} disabled={!conectado || !perfil}>INSCREVER-SE NA COPA</BotaoDeJogar>
      ) : (
        <BotaoDeJogar onClick={conta.onEntrar} icone="perfil">ENTRAR PARA SE INSCREVER</BotaoDeJogar>
      )
    ) : situacao.inscrito && situacao.fase === 'classificacao' ? (
      <>
        <button type="button" className="botao-secundario" onClick={copa.onSair}>CANCELAR INSCRIÇÃO</button>
        {naFila && <p className="acao-nota">Cancele a busca da ranqueada para correr a classificação.</p>}
        <BotaoDeJogar onClick={copa.onCorrer} disabled={naFila}>CORRER A CLASSIFICAÇÃO</BotaoDeJogar>
      </>
    ) : situacao.inscrito && situacao.fase === 'inscricoes' ? (
      <>
        <button type="button" className="botao-secundario" onClick={copa.onSair}>CANCELAR INSCRIÇÃO</button>
        <BotaoDeJogar disabled>INSCRITO · ABRE EM {faltam(situacao.abertura - agora)}</BotaoDeJogar>
      </>
    ) : (
      <BotaoDeJogar disabled>{relogio.rotulo} {relogio.valor}</BotaoDeJogar>
    )

    return {
      fatos: [
        `TODO DIA ÀS ${horaDe(situacao.abertura)}`,
        `NÍVEL ${DIFFICULTY_LABELS[DIFICULDADE_OFICIAL]}`,
        `${minutos} MIN DE CLASSIFICAÇÃO`,
        'UM SAI POR CORRIDA',
        'VALE TROFÉU, NÃO PL',
      ],
      conteudo: (
        <>
          <ol className="copa-etapas" aria-label="Etapas da copa de hoje">
            <li className={etapa(0)}>
              <b>INSCRIÇÕES</b>
              <small>ABERTAS ATÉ {horaDe(situacao.fechamento)}</small>
            </li>
            <li className={etapa(1)}>
              <b>CLASSIFICAÇÃO</b>
              <small>{horaDe(situacao.abertura)} — {horaDe(situacao.fechamento)}</small>
            </li>
            <li className={etapa(2)}>
              <b>ELIMINATÓRIAS</b>
              <small>A PARTIR DE {horaDe(situacao.eliminatorias)}</small>
            </li>
          </ol>
          <div className="relogios">
            <div className="grande">
              <small>{relogio.rotulo}</small>
              <strong>{relogio.valor}</strong>
            </div>
            <div>
              <small>INSCRITOS</small>
              <strong>{situacao.inscritos}</strong>
            </div>
            <div>
              <small>VOCÊ</small>
              <strong className={situacao.inscrito ? 'ok' : ''}>{situacao.inscrito ? 'DENTRO' : 'FORA'}</strong>
            </div>
            {situacao.voce?.tempo != null && (
              <div>
                <small>SEU TEMPO</small>
                <strong>{formatTime(situacao.voce.tempo)}{situacao.voce.posicao ? <em> #{situacao.voce.posicao}</em> : null}</strong>
              </div>
            )}
          </div>
          {situacao.minhaDivisao && (
            <p className="bloco-destaque">
              {situacao.minhaDivisao.posicao
                ? `VOCÊ FICOU EM ${situacao.minhaDivisao.posicao}º NA DIVISÃO ${situacao.minhaDivisao.numero}.`
                : `DIVISÃO ${situacao.minhaDivisao.numero} · RODADA ${situacao.minhaDivisao.rodada} · ${situacao.minhaDivisao.restantes} NA DISPUTA`}
            </p>
          )}
          {situacao.motivo && <p className="bloco-nota">{situacao.motivo}</p>}
          {copa.aviso && <p className="bloco-erro" role="alert">{copa.aviso}</p>}
          <section className="bloco">
            <h2 className="bloco-titulo">COMO FUNCIONA</h2>
            <ol className="passos">
              <li><b>Inscreva-se</b> e corra a Pista do Dia durante a classificação: vale o seu melhor tempo.</li>
              <li><b>Divisões de até seis</b> são montadas pelos tempos, e largam sozinhas.</li>
              <li><b>A cada corrida o último sai</b>, até sobrar o campeão da divisão.</li>
            </ol>
          </section>
          {situacao.classificacao.length > 0 && (situacao.fase === 'classificacao' || situacao.fase === 'apuracao') && (
            <section className="bloco">
              <h2 className="bloco-titulo">CLASSIFICAÇÃO</h2>
              <ol className="quadro simples">
                {situacao.classificacao.slice(0, 6).map((linha) => (
                  <li key={linha.posicao} className={linha.voce ? 'eu' : ''}>
                    <b>{linha.posicao}</b>
                    <span>{linha.apelido}</span>
                    <i>{formatTime(linha.tempo)}</i>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {situacao.podios.length > 0 && (
            <section className="bloco">
              <h2 className="bloco-titulo">PÓDIOS DE HOJE</h2>
              <ol className="podios">
                {situacao.podios.slice(0, 4).map((podio) => (
                  <li key={podio.divisao}>
                    <b>DIV. {podio.divisao}</b>
                    {podio.pilotos.map((piloto) => (
                      <span key={piloto.posicao} className={`taca-${piloto.posicao}`}>{piloto.posicao}º {piloto.apelido}</span>
                    ))}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {situacao.trofeus.length > 0 && (
            <p className="trofeus" aria-label="Seus troféus">
              SEUS TROFÉUS
              {[1, 2, 3].map((posicao) => {
                const quantos = situacao.trofeus.filter((trofeu) => trofeu.posicao === posicao).length
                return quantos > 0 ? <b key={posicao} className={`taca-${posicao}`}>{posicao}º ×{quantos}</b> : null
              })}
            </p>
          )}
        </>
      ),
      acao,
    }
  }

  function painelDaPistaDoDia(presoNaFila: ReactNode): ConteudoDoPainel {
    const { recorde, limites, quadro } = pistaDoDia
    const medalha = recorde ? medalhaPara(recorde.tempo, limites) : null
    const proxima = recorde ? (medalha ? MEDALHA_ACIMA[medalha] : 'bronze') : null
    const dia = `${pistaDoDia.dia.slice(8, 10)}/${pistaDoDia.dia.slice(5, 7)}`
    return {
      fatos: [`PISTA DE ${dia}`, `NÍVEL ${DIFFICULTY_LABELS[DIFICULDADE_OFICIAL]}`, 'A MESMA PARA TODOS', '⌫ RECOMEÇA NA HORA'],
      conteudo: (
        <>
          <div className="relogios">
            <div>
              <small>TROCA EM</small>
              <strong>{faltam(viradaDoDia(agora) - agora)}</strong>
            </div>
            <div>
              <small>SEU RECORDE</small>
              <strong>{recorde ? formatTime(recorde.tempo) : '—'}</strong>
            </div>
            <div>
              <small>NO QUADRO</small>
              <strong>{quadro?.voce ? `#${quadro.voce.posicao}` : '—'}</strong>
            </div>
          </div>
          <section className="bloco">
            <h2 className="bloco-titulo">MEDALHAS</h2>
            <ol className="medalhas">
              {MEDALHAS.map((item) => (
                <li key={item} className={`${item} ${recorde && recorde.tempo <= limites[item] ? 'on' : ''}`}>
                  <span>{NOME_DA_MEDALHA[item]}</span>
                  <b>{formatTime(limites[item])}</b>
                </li>
              ))}
            </ol>
            {recorde && proxima && (
              <p className="proxima-medalha">
                FALTAM <b>{segundos(recorde.tempo - limites[proxima])}</b> PARA A MEDALHA {proxima === 'autor' ? 'DE PILOTO' : `DE ${NOME_DA_MEDALHA[proxima].toUpperCase()}`}
              </p>
            )}
            {recorde && !proxima && <p className="proxima-medalha ok">VOCÊ TEM A MEDALHA DE PILOTO: A MAIS DIFÍCIL DO DIA.</p>}
          </section>
          {quadro && quadro.linhas.length > 0 && (
            <section className="bloco">
              <h2 className="bloco-titulo">QUADRO DE HOJE · ▶ CORRE CONTRA O FANTASMA</h2>
              <Quadro quadro={quadro} limite={5} meuPerfil={perfil?.id ?? null} onCorrerContra={naFila ? undefined : pistaDoDia.onCorrerContra} />
            </section>
          )}
          {!perfil && !conta.entrando && <p className="bloco-nota">Como convidado, o recorde fica neste aparelho. Com conta, ele entra no quadro do dia.</p>}
        </>
      ),
      acao: (
        <>
          {presoNaFila}
          <BotaoDeJogar onClick={pistaDoDia.onCorrer} disabled={naFila}>{recorde ? 'BATER MEU RECORDE' : 'CORRER A PISTA DO DIA'}</BotaoDeJogar>
        </>
      ),
    }
  }

  function painelDosDesafios(): ConteudoDoPainel {
    const comTempo = desafios.lista.filter((desafio) => desafios.recordes.get(desafio.id)).length
    return {
      fatos: [`${desafios.lista.length} PISTAS`, 'REGRAS MEXIDAS', 'ZERA NA SEGUNDA'],
      conteudo: (
        <>
          <div className="relogios">
            <div>
              <small>ZERA EM</small>
              <strong>{faltam(viradaDaSemana(semanaDe(agora)) - agora)}</strong>
            </div>
            <div>
              <small>COM TEMPO SEU</small>
              <strong>{comTempo}/{desafios.lista.length}</strong>
            </div>
          </div>
          {naFila && <p className="bloco-nota">Cancele a busca da ranqueada para correr um desafio.</p>}
          <ol className="desafios">
            {desafios.lista.map((desafio) => {
              const regra = MODIFICADORES[desafio.modificador]
              const doServidor = desafios.doServidor?.find((resumo) => resumo.id === desafio.id)
              const meu = desafios.recordes.get(desafio.id)
              return (
                <li key={desafio.id}>
                  <div className="desafio-nome">
                    <strong>{regra.nome}</strong>
                    <small>{regra.descricao}</small>
                  </div>
                  <dl className="desafio-tempos">
                    <div><dt>VOCÊ</dt><dd>{meu ? formatTime(meu.tempo) : '—'}</dd></div>
                    <div><dt>LÍDER</dt><dd>{doServidor?.lider ? `${formatTime(doServidor.lider.tempo)} · ${doServidor.lider.apelido}` : '—'}</dd></div>
                  </dl>
                  <button type="button" onClick={() => desafios.onCorrer(desafio)} disabled={naFila} aria-label={`Correr o desafio ${regra.nome}`}>
                    <Icone nome="play" /> CORRER
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      ),
      acao: null,
    }
  }

  function painelDoCircuito(presoNaFila: ReactNode): ConteudoDoPainel {
    const { quadro, recorde } = circuito
    const lider = quadro?.linhas[0] ?? null
    return {
      fatos: ['PISTA FIXA', `NÍVEL ${DIFFICULTY_LABELS[DIFICULDADE_OFICIAL]}`, 'TODOS OS TEMPOS', 'VALE NO RANKING MUNDIAL'],
      conteudo: (
        <>
          <div className="relogios">
            <div>
              <small>RECORDE MUNDIAL</small>
              <strong>{lider ? formatTime(lider.tempo) : '—'}</strong>
              {lider && <em>{lider.apelido}</em>}
            </div>
            <div>
              <small>SEU RECORDE</small>
              <strong>{recorde ? formatTime(recorde.tempo) : '—'}</strong>
            </div>
            <div>
              <small>NO MUNDO</small>
              <strong>{quadro?.voce ? `#${quadro.voce.posicao}` : '—'}</strong>
            </div>
          </div>
          {recorde && lider && recorde.tempo > lider.tempo && (
            <p className="proxima-medalha">VOCÊ ESTÁ A <b>{segundos(recorde.tempo - lider.tempo)}</b> DO RECORDE MUNDIAL</p>
          )}
          {quadro && quadro.linhas.length > 0 ? (
            <section className="bloco">
              <h2 className="bloco-titulo">TOPO DO MUNDO · ▶ CORRE CONTRA O FANTASMA</h2>
              <Quadro quadro={quadro} limite={5} meuPerfil={perfil?.id ?? null} onCorrerContra={naFila ? undefined : circuito.onCorrerContra} />
              <button type="button" className="botao-link" onClick={circuito.onRanking} disabled={!conectado}>VER O RANKING COMPLETO ›</button>
            </section>
          ) : (
            <p className="bloco-nota">{quadro ? 'Ninguém marcou tempo ainda: o primeiro recorde mundial pode ser seu.' : 'Conecte-se para ver o ranking mundial.'}</p>
          )}
          {!perfil && !conta.entrando && <p className="bloco-nota">Como convidado, o tempo fica neste aparelho. Com conta, ele entra no ranking mundial.</p>}
        </>
      ),
      acao: (
        <>
          {presoNaFila}
          <BotaoDeJogar onClick={circuito.onCorrer} disabled={naFila}>CORRER O CIRCUITO OFICIAL</BotaoDeJogar>
        </>
      ),
    }
  }
}

type ConteudoDoPainel = {
  /** Os fatos do modo em etiquetas curtas, logo abaixo do título. */
  fatos: string[]
  conteudo: ReactNode
  /** O botão de jogar, e o que mais estiver junto dele. Null para o modo que se joga pelas linhas. */
  acao: ReactNode
}

/** O painel do modo escolhido: título, fatos, conteúdo e, embaixo, o botão de jogar. */
function Painel({
  definicao,
  titulo,
  onVoltar,
  fatos,
  conteudo,
  acao,
}: ConteudoDoPainel & { definicao: DefinicaoDoModo; titulo: RefObject<HTMLHeadingElement | null>; onVoltar: () => void }) {
  return (
    <section id="paddock-painel" role="tabpanel" aria-labelledby={`aba-${definicao.id}`} className="paddock-painel" style={cor(definicao.cor)}>
      <button type="button" className="painel-voltar" onClick={onVoltar}>
        <Icone nome="voltar" /> TODOS OS MODOS
      </button>
      <header className="painel-topo">
        <span className="modo-icone grande"><Icone nome={definicao.id} /></span>
        <div>
          <p className="painel-grupo">{NOME_DO_GRUPO[definicao.grupo]}</p>
          <h1 ref={titulo} tabIndex={-1}>{definicao.nome}</h1>
          <p className="painel-resumo">{definicao.resumo}</p>
        </div>
      </header>
      <ul className="painel-fatos" aria-label="Sobre o modo">
        {fatos.map((fato) => <li key={fato}>{fato}</li>)}
      </ul>
      <div className="painel-conteudo">{conteudo}</div>
      {acao && <footer className="painel-acao">{acao}</footer>}
    </section>
  )
}

function BotaoDeJogar({
  children,
  onClick,
  disabled = false,
  icone = 'play',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  icone?: 'play' | 'perfil'
}) {
  return (
    <button type="button" className="botao-jogar" onClick={onClick} disabled={disabled}>
      <span>{children}</span>
      <Icone nome={icone} />
    </button>
  )
}

/** Um quadro de tempos, com a linha do piloto mesmo quando ele está fora do topo. */
function Quadro({
  quadro,
  limite,
  meuPerfil,
  onCorrerContra,
}: {
  quadro: QuadroDoDia
  limite: number
  meuPerfil: string | null
  onCorrerContra?: (linha: LinhaDoQuadro) => void
}) {
  const linhas = quadro.linhas.slice(0, limite)
  const minhaFora = quadro.voce && !linhas.some((linha) => linha.id === quadro.voce!.id) ? quadro.voce : null
  const linha = (item: LinhaDoQuadro, fora = false) => (
    <li key={item.id} className={`${item.perfilId === meuPerfil ? 'eu' : ''} ${fora ? 'fora' : ''}`}>
      <b>{item.posicao}</b>
      <span>{item.apelido}</span>
      {item.dispositivo === 'toque' ? <em title="Feito no toque">TOQUE</em> : <em />}
      <i>{formatTime(item.tempo)}</i>
      {onCorrerContra ? (
        <button type="button" onClick={() => onCorrerContra(item)} aria-label={`Correr contra o fantasma de ${item.apelido}`}>
          <Icone nome="play" />
        </button>
      ) : (
        <span />
      )}
    </li>
  )
  return (
    <ol className="quadro">
      {linhas.map((item) => linha(item))}
      {minhaFora && linha(minhaFora, true)}
    </ol>
  )
}

/** A qualidade da conexão, em barras: é o que o piloto precisa saber antes de largar online. */
function Status({ conectado, latencia, movimento }: { conectado: boolean; latencia: number | null; movimento: MovimentoDoJogo | null }) {
  const qualidade = !conectado ? 'off' : latencia === null ? 'medindo' : latencia <= 80 ? 'boa' : latencia <= 160 ? 'media' : 'ruim'
  const rotulo = !conectado ? 'SEM CONEXÃO' : latencia === null ? 'MEDINDO' : `${latencia} MS`
  const descricao = !conectado
    ? 'Procurando o servidor da partida'
    : latencia === null
      ? 'Medindo a conexão'
      : `Conexão ${qualidade === 'boa' ? 'ótima' : qualidade === 'media' ? 'boa' : 'instável'}: ${latencia} ms até o servidor`
  return (
    <div className="paddock-status">
      <span className={`sinal ${qualidade}`} title={descricao} aria-label={descricao} role="img">
        <i /><i /><i />
        <b>{rotulo}</b>
      </span>
      {movimento && (
        <span className="online" title="Aparelhos conectados ao jogo agora">
          <b>{movimento.online}</b> ONLINE
        </span>
      )}
    </div>
  )
}

function ChipDaConta({ conta, situacao }: { conta: Props['conta']; situacao: SituacaoDaRanqueada | null }) {
  if (conta.perfil) {
    const painel = situacao?.painel
    const tier = painel ? (painel.colocacao > 0 ? 'EM COLOCAÇÃO' : painel.divisao.replace(/ · .*/, '')) : 'SEU PERFIL'
    return (
      <button type="button" className={`conta-chip on ${painel && painel.colocacao === 0 ? painel.tier : ''}`} onClick={conta.onPerfil}>
        <span className="conta-avatar" aria-hidden="true">{conta.perfil.apelido.slice(0, 1).toUpperCase()}</span>
        <span className="conta-nome">{conta.perfil.apelido}<small>{tier}</small></span>
      </button>
    )
  }
  if (conta.semServidor) {
    return (
      <button type="button" className="conta-chip" onClick={conta.onReligar}>
        <span className="conta-nome">SUA CONTA<small>SEM RESPOSTA · TENTAR DE NOVO</small></span>
      </button>
    )
  }
  if (conta.entrando) {
    return (
      <span className="conta-chip">
        <span className="conta-nome">ENTRANDO…<small>NA SUA CONTA</small></span>
      </span>
    )
  }
  return (
    <button type="button" className="conta-chip convidado" onClick={conta.onEntrar}>
      <span className="conta-avatar" aria-hidden="true"><Icone nome="perfil" /></span>
      <span className="conta-nome">CONVIDADO<small>ENTRAR OU CRIAR CONTA</small></span>
    </button>
  )
}

/** O carro escolhido, com o atalho para a garagem. */
function CartaoDoCarro({ car, naFila, onGaragem }: { car: CarId; naFila: boolean; onGaragem: () => void }) {
  const carro = carById(car)
  return (
    <section className="carro-cartao" style={{ '--accent': carro.accent } as CSSProperties} aria-label="Seu carro">
      <span className="carro-numero" aria-hidden="true">{carro.number}</span>
      <img src={carImageUrl(car)} alt={`Carro de ${carro.driver}`} />
      <div className="carro-info">
        <small>SEU CARRO</small>
        <strong>{carro.driver}</strong>
        <em>{carro.team} · #{carro.number}</em>
      </div>
      <button type="button" onClick={onGaragem} disabled={naFila} title={naFila ? 'Cancele a busca da ranqueada para trocar de carro.' : undefined}>
        <Icone nome="garagem" /> TROCAR
      </button>
    </section>
  )
}

/** Quantos estão no jogo, na fila e na pista agora — e se é o horário em que a fila enche. */
function Movimento({ movimento, agora }: { movimento: MovimentoDoJogo | null; agora: number }) {
  const nobre = noHorarioNobre(agora)
  return (
    <section className="movimento-cartao" aria-label="Agora no jogo">
      <p className="bloco-titulo">AGORA NO JOGO</p>
      <dl>
        <div><dt>ONLINE</dt><dd>{movimento?.online ?? '—'}</dd></div>
        <div><dt>NA FILA</dt><dd>{movimento?.naFila ?? '—'}</dd></div>
        <div><dt>CORRENDO</dt><dd>{movimento?.correndo ?? '—'}</dd></div>
        <div><dt>ASSISTINDO</dt><dd>{movimento?.assistindo ?? '—'}</dd></div>
      </dl>
      <p className={`nobre ${nobre ? 'on' : ''}`}>
        <Icone nome="relogio" />
        {nobre ? 'HORÁRIO NOBRE DA RANQUEADA AGORA' : `HORÁRIO NOBRE DA RANQUEADA: ${HORARIO_NOBRE.de}H ÀS ${HORARIO_NOBRE.ate}H`}
      </p>
    </section>
  )
}
