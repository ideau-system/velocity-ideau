// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { curvatureLoad, type TrackLayout } from './layout.js'
import { CARGA_CURVA_MIN, STEER_RATE, STEER_TAU, type RaceInput, type RaceState } from './simulation.js'
import { HIT_HALF_WIDTH, OFF_ROAD_LIMIT, VIEW_DISTANCE } from './track.js'

/**
 * Pilotos de referência.
 *
 * Em pista reta — que é o contexto padrão de `stepRace`, e o que os testes de
 * boost, penalidade e obstáculos usam para isolar o que medem — um carro sem
 * comando anda em linha reta e não precisa de piloto. Com a curva ativa, não:
 * ela empurra o carro para fora, e "não tocar em nada" deixa de ser uma forma
 * válida de percorrer a pista. Os testes que correm numa pista gerada de
 * verdade precisam de alguém no volante, senão medem uma corrida que nenhum
 * jogador faria.
 *
 * São deliberadamente simples e sem ambição de ritmo: servem para descrever
 * comportamentos de jogador nos testes, não para ser rápidos. É daqui que sai
 * um adversário controlado pela máquina, se um dia houver modo treino com bot.
 */
export type Piloto = (state: RaceState) => RaceInput

/** Folga antes de corrigir, para o comando não oscilar a cada quadro. */
const ZONA_MORTA = 0.02

/**
 * Mantém o carro em uma faixa, corrigindo a força da curva como faria um
 * jogador atento. É o piloto usado quando o teste quer o carro onde o pôs.
 */
export function segurandoAFaixa(faixa = 0, boost = false): Piloto {
  return (state) => ({
    left: state.lateral > faixa + ZONA_MORTA,
    right: state.lateral < faixa - ZONA_MORTA,
    boost,
  })
}

/**
 * Corrige só quando a curva já levou o carro para perto da grama.
 *
 * É o menor esforço que ainda conta como dirigir, e por isso é ele que define
 * o piso de dificuldade: se este piloto completa a prova no tempo previsto em
 * qualquer semente e qualquer nível, um iniciante de celular também completa.
 * É essa a garantia que `demonstracao.test.ts` cobra.
 */
export function noLimiteDoAsfalto(boost = false): Piloto {
  const borda = OFF_ROAD_LIMIT * 0.8
  return (state) => ({
    left: state.lateral > borda,
    right: state.lateral < -borda,
    boost,
  })
}

/**
 * Desvia do obstáculo mais próximo que estiver na sua faixa, para o lado que
 * couber dentro da pista, e segura a curva enquanto isso.
 *
 * Com o reset por batidas, o piloto rápido deixou de ser o que acelera o tempo
 * todo pelo meio da pista: esse bate nas barreiras do meio, e na terceira perde
 * um segundo e meio parado. Rápido agora é quem desvia. Sem reflexo
 * sobre-humano: ele só reage ao que já entrou no campo de visão.
 *
 * Guarda a faixa escolhida até o obstáculo passar, como um jogador faz. Uma
 * regra sem memória — ir para o lado só enquanto se está na faixa do
 * obstáculo — sai da faixa, volta para o meio, entra de novo e fica nesse vai
 * e vem até o obstáculo passar: medido, trocava de lado seis vezes por segundo
 * e pagava em aderência pelo próprio zigue-zague. Cada chamada devolve um
 * piloto novo, com a própria memória: um por corrida.
 */
export function desviando(boost = false): Piloto {
  let faixa = 0
  return (state) => {
    let ameaca = false
    for (const o of state.rules.obstacles) {
      const adiante = o.distance - state.progress
      if (adiante <= 0 || adiante > VIEW_DISTANCE) continue
      ameaca = true
      const alcance = HIT_HALF_WIDTH[o.kind] + 0.1
      // A faixa escolhida já passa ao largo deste: fica nela.
      if (Math.abs(faixa - o.lane) >= alcance) break
      const paraDireita = o.lane + alcance + 0.06
      const paraEsquerda = o.lane - alcance - 0.06
      const cabeDireita = Math.abs(paraDireita) < OFF_ROAD_LIMIT
      const cabeEsquerda = Math.abs(paraEsquerda) < OFF_ROAD_LIMIT
      // Entre os dois lados, o que fica mais perto de onde o carro já está.
      faixa = cabeDireita && (!cabeEsquerda || Math.abs(paraDireita - state.lateral) <= Math.abs(paraEsquerda - state.lateral))
        ? paraDireita
        : paraEsquerda
      break
    }
    // Sem nada à vista, volta para o meio, que é onde mais cabe o próximo.
    if (!ameaca) faixa = 0
    return { ...rumoA(faixa, state), boost }
  }
}

/** Uma super curva, do ponto de vista de quem dirige: onde, e para que lado. */
export type CurvaAnunciada = { start: number; end: number; side: 1 | -1 }

/**
 * Metros antes da super curva em que o piloto começa a se preparar.
 *
 * É menos do que a reta de aproximação que o traçado garante, e é o que a nota
 * de curva dá de tempo a quem está em cruzeiro: pouco mais de um segundo e
 * meio para soltar o boost e ir para o lado de dentro.
 */
const PREPARO_M = 110

/**
 * Fração da primeira metade de um S a partir da qual o piloto larga o lado de
 * dentro dela e vai para o da segunda.
 *
 * Depois da zebra da tangência, que termina a dois terços da primeira metade:
 * largar antes custaria a tangência, que no S é a da primeira metade só. Daí em
 * diante, o carro atravessa para o lado de dentro da segunda, que é a linha
 * mais curta dela.
 */
const SOLTAR_NO_S = 0.7

/**
 * Desvia como `desviando` e, nas super curvas, faz a tangência.
 *
 * Solta o boost antes da curva, vai para o lado de dentro e segura ali até a
 * saída — que é a linha mais curta e a que dá o boost de volta. É o piloto que
 * leu a nota de curva: o que os testes usam para dizer que a super curva é
 * pesada, e não injusta. Recebe as curvas da prova porque o piloto humano as
 * vê chegando; ele não conhece nada além disso.
 */
export function tangenciando(curvas: readonly CurvaAnunciada[], boost = false): Piloto {
  let normal = desviando(boost)
  let naCurva = false
  const dentro = OFF_ROAD_LIMIT * 0.86
  return (state) => {
    const agoraNaCurva = curvas.some((curva) => state.progress >= curva.start - PREPARO_M && state.progress <= curva.end)
    // Saindo da super curva, o desvio recomeça do zero. O lado que ele tinha
    // escolhido foi escolhido de dentro da curva, e a curva jogou o carro para
    // fora: guardá-lo faria o carro atravessar a pista por cima do obstáculo.
    if (naCurva && !agoraNaCurva) normal = desviando(boost)
    naCurva = agoraNaCurva
    const comando = normal(state)
    for (const curva of curvas) {
      if (state.progress < curva.start - PREPARO_M || state.progress > curva.end) continue
      // No S, depois do ápice da primeira metade, a boa linha deixa o carro
      // abrir: o lado de fora dela é o de dentro da segunda, e brigar contra o
      // empurrão até o fim faria o carro chegar à segunda metade pelo meio.
      const emendada = curvas.find((outra) => outra.start === curva.end)
      const soltar = curva.start + (curva.end - curva.start) * SOLTAR_NO_S
      const lado = emendada && state.progress > soltar ? emendada.side : curva.side
      // Um obstáculo logo adiante, no caminho até a faixa de dentro, vem antes
      // da curva: o piloto desvia dele primeiro e só então encosta. Ir para
      // dentro por cima de uma barreira é trocar a tangência por uma batida —
      // e o que conta é o trajeto inteiro, não só a faixa de chegada.
      const alvo = lado * dentro
      for (const o of state.rules.obstacles) {
        const adiante = o.distance - state.progress
        if (adiante <= 0 || adiante > PREPARO_M * 0.6) continue
        const folga = HIT_HALF_WIDTH[o.kind] + 0.14
        const noCaminho = o.lane > Math.min(state.lateral, alvo) - folga && o.lane < Math.max(state.lateral, alvo) + folga
        if (noCaminho) return { ...comando, boost: false }
      }
      return { ...rumoA(alvo, state), boost: false }
    }
    return comando
  }
}

/** O que o piloto completo precisa ver da pista: as super curvas e a curva de cada ponto. */
export type PistaVista = Pick<TrackLayout, 'superCurves' | 'curvature'>

/** Metros adiante em que o piloto completo lê a curva comum, como quem vê a pista chegar. */
const OLHAR_ADIANTE_M = 15

/** Até quantos metros adiante um obstáculo no caminho até a linha de dentro manda mais que a carga. */
const CAMINHO_M = 70

/** Faixa de dentro em que o piloto completo segura as curvas comuns. */
const DENTRO_DA_CURVA = OFF_ROAD_LIMIT * 0.8

/**
 * O piloto que usa tudo o que a pista paga.
 *
 * Faz o que `tangenciando` faz — desvia, lê a nota de curva, tangencia — e, nas
 * curvas comuns, carrega o mini-turbo: entra mirando a curva com o volante
 * todo até chegar à linha de dentro, e segura ali; ao endireitar, a carga
 * dispara. Guarda o boost para as retas, porque de boost a carga se perde. É o
 * teto de referência: o que os testes usam para dizer que habilidade rende
 * tempo, e o tempo de referência das medalhas de cada semente.
 */
export function pilotoCompleto(pista: PistaVista): Piloto {
  const base = tangenciando(pista.superCurves, true)
  return (state) => {
    const comando = base(state)
    const naSuperCurva = pista.superCurves.some(
      (curva) => state.progress >= curva.start - PREPARO_M && state.progress <= curva.end,
    )
    if (naSuperCurva) return comando
    const carga = curvatureLoad(pista.curvature(state.progress + OLHAR_ADIANTE_M))
    if (Math.abs(carga) < CARGA_CURVA_MIN) return comando
    const lado = Math.sign(carga)
    const alvo = lado * DENTRO_DA_CURVA
    // Um obstáculo entre o carro e a linha de dentro vem antes da carga: o
    // desvio manda, sem boost, para não jogar fora o que já carregou.
    for (const o of state.rules.obstacles) {
      const adiante = o.distance - state.progress
      if (adiante <= -5 || adiante > CAMINHO_M) continue
      const folga = HIT_HALF_WIDTH[o.kind] + 0.14
      const noCaminho = o.lane > Math.min(state.lateral, alvo) - folga && o.lane < Math.max(state.lateral, alvo) + folga
      if (noCaminho) return { ...comando, boost: false }
    }
    // Mira a curva com o volante todo até chegar por dentro: é o que carrega.
    if (state.lateral * lado < DENTRO_DA_CURVA - 0.05) return { left: lado < 0, right: lado > 0, boost: false }
    return { ...rumoA(alvo, state), boost: false }
  }
}

/**
 * Leva o carro a uma faixa soltando o comando antes de chegar.
 *
 * O volante tem inércia: solto, o carro ainda anda um pouco para o lado. Um
 * controle que só solta ao chegar passa da faixa, corrige para o outro lado e
 * passa de novo — medido, o piloto que desvia trocava de lado até oito vezes
 * por segundo e perdia um quinto da aderência para o próprio zigue-zague, e
 * saía mais lento do que quem batia em tudo. Um jogador de verdade dá toques.
 * Aqui o comando decide pela posição em que o carro vai parar, e não pela de
 * agora.
 */
function rumoA(alvo: number, state: RaceState) {
  const deslizando = state.steerInput * (STEER_RATE + state.speed / 520) * STEER_TAU
  const erro = alvo - (state.lateral + deslizando)
  return { left: erro < -ZONA_MORTA, right: erro > ZONA_MORTA }
}
