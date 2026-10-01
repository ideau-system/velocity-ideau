import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { definirCambio, lerCambio, type Cambio } from '../game/preferenciasDeCambio'
import { definirMusicaDesligada, definirSomDesligado, lerMusicaDesligada, lerSomDesligado } from '../game/preferenciasDeSom'
import Icone from './Icone'

type Props = {
  aberto: boolean
  onFechar: () => void
}

/** Um interruptor de liga e desliga, com o nome e o que ele faz. */
function Interruptor({ rotulo, nota, ligado, onMudar }: { rotulo: string; nota: string; ligado: boolean; onMudar: (ligado: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} className={`opcao-interruptor ${ligado ? 'on' : ''}`} onClick={() => onMudar(!ligado)}>
      <span>
        <strong>{rotulo}</strong>
        <small>{nota}</small>
      </span>
      <i aria-hidden="true">{ligado ? 'LIGADO' : 'DESLIGADO'}</i>
    </button>
  )
}

/**
 * As opções do jogo, num painel por cima do paddock: som, música, câmbio e a
 * lista de comandos. São as mesmas preferências que a corrida e o lobby já
 * guardam — mudar aqui vale na próxima largada, e mudar lá aparece aqui.
 */
export default function Opcoes({ aberto, onFechar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null)
  const [som, setSom] = useState(() => !lerSomDesligado())
  const [musica, setMusica] = useState(() => !lerMusicaDesligada())
  const [cambio, setCambio] = useState<Cambio>(lerCambio)

  useEffect(() => {
    const elemento = dialogo.current
    if (!elemento) return
    if (aberto && !elemento.open) {
      // A corrida e o lobby também mexem nelas: o painel abre com o que vale agora.
      setSom(!lerSomDesligado())
      setMusica(!lerMusicaDesligada())
      setCambio(lerCambio())
      elemento.showModal()
    }
    if (!aberto && elemento.open) elemento.close()
  }, [aberto])

  // O clique fora do painel, no fundo escurecido, fecha como o Esc.
  const cliqueNoFundo = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onFechar()
  }

  return (
    <dialog ref={dialogo} className="opcoes" aria-labelledby="opcoes-titulo" onClose={onFechar} onClick={cliqueNoFundo}>
      <div className="opcoes-corpo">
        <header className="opcoes-topo">
          <h2 id="opcoes-titulo">OPÇÕES</h2>
          <button type="button" className="opcoes-fechar" onClick={onFechar} aria-label="Fechar as opções">
            <Icone nome="fechar" />
          </button>
        </header>

        <section className="opcoes-grupo" aria-labelledby="opcoes-audio">
          <h3 id="opcoes-audio">ÁUDIO</h3>
          <Interruptor
            rotulo="Som do jogo"
            nota="Motor, trocas de marcha, largada e avisos."
            ligado={som}
            onMudar={(ligado) => {
              definirSomDesligado(!ligado)
              setSom(ligado)
            }}
          />
          <Interruptor
            rotulo="Música"
            nota="A trilha do lobby e da corrida. O som do carro continua."
            ligado={musica}
            onMudar={(ligada) => {
              definirMusicaDesligada(!ligada)
              setMusica(ligada)
            }}
          />
        </section>

        <section className="opcoes-grupo" aria-labelledby="opcoes-cambio">
          <h3 id="opcoes-cambio">CÂMBIO</h3>
          <div className="opcoes-escolha" role="radiogroup" aria-labelledby="opcoes-cambio">
            {(['automatico', 'manual'] as const).map((tipo) => (
              <button
                key={tipo}
                type="button"
                role="radio"
                aria-checked={cambio === tipo}
                className={cambio === tipo ? 'on' : ''}
                onClick={() => {
                  definirCambio(tipo)
                  setCambio(tipo)
                }}
              >
                <strong>{tipo === 'manual' ? 'MANUAL' : 'AUTOMÁTICO'}</strong>
                <small>{tipo === 'manual' ? 'Você troca as marchas. A troca perfeita rende turbo.' : 'As marchas trocam sozinhas.'}</small>
              </button>
            ))}
          </div>
          <p className="opcoes-nota">Vale no treino, nos recordes e nas salas com amigos. Na ranqueada o câmbio é sempre manual.</p>
        </section>

        <section className="opcoes-grupo" aria-labelledby="opcoes-comandos">
          <h3 id="opcoes-comandos">COMANDOS</h3>
          <dl className="opcoes-comandos teclado">
            <div><dt><kbd>W</kbd><kbd>S</kbd></dt><dd>Acelera e freia (ou ↑ ↓)</dd></div>
            <div><dt><kbd>A</kbd><kbd>D</kbd></dt><dd>Direção (ou ← →)</dd></div>
            <div><dt><kbd>ESPAÇO</kbd></dt><dd>Boost</dd></div>
            <div><dt><kbd>E</kbd><kbd>Q</kbd></dt><dd>Sobe e desce a marcha</dd></div>
            <div><dt><kbd>⌫</kbd></dt><dd>Recomeça o contrarrelógio</dd></div>
          </dl>
          <dl className="opcoes-comandos toque">
            <div><dt><kbd>‹</kbd><kbd>›</kbd></dt><dd>Direção: deslize o polegar de um lado para o outro</dd></div>
            <div><dt><kbd>BOOST</kbd></dt><dd>Segure para o turbo</dd></div>
            <div><dt><kbd>FREIO</kbd></dt><dd>O acelerador é automático no toque</dd></div>
            <div><dt><kbd>▲</kbd><kbd>▼</kbd></dt><dd>Marchas, no câmbio manual</dd></div>
          </dl>
        </section>
      </div>
    </dialog>
  )
}
