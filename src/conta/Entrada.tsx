import { useEffect, useRef, useState, type FormEvent } from 'react'
import { APELIDO_MAXIMO, limparApelido, problemaNoApelido } from './apelido'
import { cadastrar, entrar, pedirNovaSenha, SENHA_MINIMA, trocarSenha } from './conta'

export type ModoDaEntrada = 'entrar' | 'cadastrar' | 'esqueci' | 'nova-senha'

type Props = {
  modoInicial?: ModoDaEntrada
  /** O servidor do jogo, que diz se o nome de piloto está livre. Null sem ele. */
  verificarApelido: (apelido: string) => Promise<{ livre: boolean; motivo?: string } | null>
  /** A conta abriu: a sessão já está no aparelho, e o jogo a liga ao servidor. */
  onEntrou: () => void
  onConvidado: () => void
  /** Aberta do menu, a tela volta para ele sem mudar nada. */
  onVoltar?: () => void
  /** Um recado de quem abriu a tela: a sessão venceu, a conta saiu. */
  aviso?: string
}

type Checagem = { estado: 'vazio' | 'conferindo' | 'livre' | 'ocupado' | 'sem-servidor'; motivo?: string }

/**
 * A porta do jogo: entrar na conta, criar uma ou correr como convidado.
 *
 * Quem cria a conta escolhe aqui o nome de piloto — o que aparece no grid, na
 * ranqueada e no ranking mundial —, único e para sempre. O convidado escolhe
 * o nome no menu, como sempre foi, e corre online e treina; o que pede conta é
 * o que precisa de nome único: ranqueada, Copa, quadros e ranking mundial.
 */
export default function Entrada({ modoInicial = 'entrar', verificarApelido, onEntrou, onConvidado, onVoltar, aviso }: Props) {
  const [modo, setModo] = useState<ModoDaEntrada>(modoInicial)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [repetida, setRepetida] = useState('')
  const [apelido, setApelido] = useState('')
  const [checagem, setChecagem] = useState<Checagem>({ estado: 'vazio' })
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [recado, setRecado] = useState(aviso ?? '')
  /** O cadastro pediu confirmação: o link foi para este e-mail. */
  const [confirmarEm, setConfirmarEm] = useState<string | null>(null)
  const verificarRef = useRef(verificarApelido)
  verificarRef.current = verificarApelido

  useEffect(() => setModo(modoInicial), [modoInicial])

  // O nome de piloto é conferido enquanto se digita, com uma pausa: é único,
  // e descobrir isso só no fim do cadastro seria perder o formulário.
  useEffect(() => {
    if (modo !== 'cadastrar') return
    const limpo = limparApelido(apelido)
    if (!limpo) return setChecagem({ estado: 'vazio' })
    const problema = problemaNoApelido(limpo)
    if (problema) return setChecagem({ estado: 'ocupado', motivo: problema })
    setChecagem({ estado: 'conferindo' })
    let valendo = true
    const timer = window.setTimeout(() => {
      void verificarRef.current(limpo).then((resposta) => {
        if (!valendo) return
        if (!resposta) setChecagem({ estado: 'sem-servidor' })
        else setChecagem(resposta.livre ? { estado: 'livre' } : { estado: 'ocupado', motivo: resposta.motivo })
      })
    }, 400)
    return () => {
      valendo = false
      window.clearTimeout(timer)
    }
  }, [apelido, modo])

  const trocarModo = (proximo: ModoDaEntrada) => {
    setModo(proximo)
    setErro('')
    setRecado('')
    setSenha('')
    setRepetida('')
  }

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enviando) return
    setErro('')
    setRecado('')

    if (modo === 'entrar') {
      if (!email.trim() || !senha) return setErro('Preencha o e-mail e a senha.')
      setEnviando(true)
      const resultado = await entrar(email, senha)
      setEnviando(false)
      if (resultado.ok) onEntrou()
      else setErro(resultado.erro)
      return
    }

    if (modo === 'esqueci') {
      if (!email.trim()) return setErro('Informe o e-mail da conta.')
      setEnviando(true)
      const resultado = await pedirNovaSenha(email)
      setEnviando(false)
      if (resultado.ok) setRecado('Se houver conta com este e-mail, o link para trocar a senha chega em alguns minutos.')
      else setErro(resultado.erro)
      return
    }

    if (senha.length < SENHA_MINIMA) return setErro(`A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`)
    if (senha !== repetida) return setErro('As duas senhas não são iguais.')

    if (modo === 'nova-senha') {
      setEnviando(true)
      const resultado = await trocarSenha(senha)
      setEnviando(false)
      if (resultado.ok) onEntrou()
      else setErro(resultado.erro)
      return
    }

    const problema = problemaNoApelido(apelido)
    if (problema) return setErro(problema)
    if (!email.trim()) return setErro('Informe o e-mail.')
    setEnviando(true)
    // A última palavra sobre o nome é do servidor: alguém pode tê-lo pegado agora.
    const livre = await verificarApelido(limparApelido(apelido))
    if (livre && !livre.livre) {
      setEnviando(false)
      setChecagem({ estado: 'ocupado', motivo: livre.motivo })
      return setErro(livre.motivo ?? 'Esse nome de piloto já tem dono.')
    }
    const resultado = await cadastrar({ email, senha, apelido })
    setEnviando(false)
    if (!resultado.ok) return setErro(resultado.erro)
    if (resultado.confirmar) setConfirmarEm(email.trim())
    else onEntrou()
  }

  const titulo = { entrar: 'ENTRAR', cadastrar: 'CRIAR CONTA', esqueci: 'NOVA SENHA', 'nova-senha': 'NOVA SENHA' }[modo]

  return (
    <main className="screen entrada-screen">
      <div className="ambient-grid" />
      <section className="entrada-card" aria-labelledby="entrada-titulo">
        <header className="entrada-header">
          <div className="logo"><i /><span>CORRIDA<br /><b>FANTASMA</b></span></div>
          {onVoltar && (
            <button type="button" className="text-button" onClick={onVoltar}>
              VOLTAR
            </button>
          )}
        </header>

        {confirmarEm ? (
          <div className="entrada-confirmar">
            <p className="eyebrow">QUASE LÁ</p>
            <h1 id="entrada-titulo">CONFIRME O E-MAIL</h1>
            <p className="entrada-nota">
              Enviamos um link para <b>{confirmarEm}</b>. Abra-o neste aparelho e a conta entra sozinha. Não chegou? Veja o spam, ou
              jogue como convidado enquanto isso.
            </p>
            <button type="button" className="primary-button" onClick={() => { setConfirmarEm(null); trocarModo('entrar') }}>
              JÁ CONFIRMEI, ENTRAR <span>↗</span>
            </button>
          </div>
        ) : (
          <>
            {(modo === 'entrar' || modo === 'cadastrar') && (
              <div className="entrada-abas" role="tablist" aria-label="Conta">
                <button type="button" role="tab" aria-selected={modo === 'entrar'} className={modo === 'entrar' ? 'on' : ''} onClick={() => trocarModo('entrar')}>
                  ENTRAR
                </button>
                <button type="button" role="tab" aria-selected={modo === 'cadastrar'} className={modo === 'cadastrar' ? 'on' : ''} onClick={() => trocarModo('cadastrar')}>
                  CRIAR CONTA
                </button>
              </div>
            )}

            <form className="entrada-form" onSubmit={(event) => void enviar(event)} noValidate>
              <p className="eyebrow" id="entrada-titulo">{titulo}</p>

              {modo === 'cadastrar' && (
                <div className="identity-field">
                  <label htmlFor="entrada-apelido">NOME DE PILOTO</label>
                  <input
                    id="entrada-apelido"
                    value={apelido}
                    maxLength={APELIDO_MAXIMO}
                    onChange={(event) => setApelido(event.target.value)}
                    autoComplete="nickname"
                    placeholder="Como o grid vai te chamar"
                  />
                  <small className={`entrada-checagem ${checagem.estado}`} aria-live="polite">
                    {checagem.estado === 'conferindo' && 'CONFERINDO…'}
                    {checagem.estado === 'livre' && '✓ NOME LIVRE'}
                    {checagem.estado === 'ocupado' && (checagem.motivo ?? 'ESSE NOME JÁ TEM DONO')}
                    {checagem.estado === 'sem-servidor' && 'SEM SERVIDOR PARA CONFERIR O NOME AGORA'}
                    {checagem.estado === 'vazio' && 'É ÚNICO, APARECE NOS RANKINGS E NÃO MUDA DEPOIS'}
                  </small>
                </div>
              )}

              {modo !== 'nova-senha' && (
                <div className="identity-field">
                  <label htmlFor="entrada-email">E-MAIL</label>
                  <input
                    id="entrada-email"
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="voce@exemplo.com"
                  />
                </div>
              )}

              {modo !== 'esqueci' && (
                <div className="identity-field">
                  <label htmlFor="entrada-senha">{modo === 'nova-senha' ? 'NOVA SENHA' : 'SENHA'}</label>
                  <input
                    id="entrada-senha"
                    type="password"
                    value={senha}
                    onChange={(event) => setSenha(event.target.value)}
                    autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
                    placeholder={modo === 'entrar' ? '' : `Pelo menos ${SENHA_MINIMA} caracteres`}
                  />
                </div>
              )}

              {(modo === 'cadastrar' || modo === 'nova-senha') && (
                <div className="identity-field">
                  <label htmlFor="entrada-repetida">REPITA A SENHA</label>
                  <input
                    id="entrada-repetida"
                    type="password"
                    value={repetida}
                    onChange={(event) => setRepetida(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              )}

              {erro && <p className="form-error" role="alert">{erro}</p>}
              {recado && <p className="form-notice entrada-recado" role="status">{recado}</p>}

              <button type="submit" className="primary-button" disabled={enviando}>
                {enviando
                  ? 'UM INSTANTE…'
                  : modo === 'entrar'
                    ? 'ENTRAR'
                    : modo === 'cadastrar'
                      ? 'CRIAR CONTA'
                      : modo === 'esqueci'
                        ? 'ENVIAR O LINK'
                        : 'SALVAR A SENHA'}{' '}
                <span>↗</span>
              </button>

              {modo === 'entrar' && (
                <button type="button" className="text-button" onClick={() => trocarModo('esqueci')}>
                  ESQUECI A SENHA
                </button>
              )}
              {modo === 'esqueci' && (
                <button type="button" className="text-button" onClick={() => trocarModo('entrar')}>
                  VOLTAR PARA ENTRAR
                </button>
              )}
            </form>
          </>
        )}

        {modo !== 'nova-senha' && (
          <div className="entrada-convidado">
            <div className="join-divider"><span>OU</span></div>
            <button type="button" className="solo-button" onClick={onConvidado}>
              JOGAR COMO CONVIDADO <span>↗</span>
            </button>
            <p className="entrada-nota">
              O convidado corre online e treina com o nome que quiser. Ranqueada, Copa, quadros e o ranking mundial pedem conta.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
