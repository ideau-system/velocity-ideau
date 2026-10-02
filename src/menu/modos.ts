/**
 * Os modos do paddock, na ordem em que aparecem.
 *
 * Eram sete cartões iguais empilhados, numerados fora de ordem. Agora são dois
 * grupos — o que se joga com gente e o que se joga contra o relógio —, cada
 * modo com uma cor que o identifica no menu inteiro: no ícone, na faixa do
 * item, no topo do painel e no botão de jogar.
 */

export type ModoDoMenu = 'sala' | 'ranqueada' | 'copa' | 'treino' | 'pistaDoDia' | 'desafios' | 'circuito'

export type GrupoDoMenu = 'online' | 'solo'

export type DefinicaoDoModo = {
  id: ModoDoMenu
  nome: string
  grupo: GrupoDoMenu
  /** A cor do modo, e a do botão de jogar dele. */
  cor: string
  /** O que se faz nele, numa frase. */
  resumo: string
}

export const MODOS_DO_MENU: readonly DefinicaoDoModo[] = [
  {
    id: 'sala',
    nome: 'Sala com amigos',
    grupo: 'online',
    cor: '#ff4b2b',
    resumo: 'Crie uma sala e mande o convite, ou entre com o código de um amigo. Até seis no grid.',
  },
  {
    id: 'ranqueada',
    nome: 'Ranqueada',
    grupo: 'online',
    cor: '#c86bff',
    resumo: 'Fila pública com pilotos do seu nível. A largada é automática, e quem chega na frente sobe de tier.',
  },
  {
    id: 'copa',
    nome: 'Copa do Dia',
    grupo: 'online',
    cor: '#4f8dff',
    resumo: 'Hora marcada: classificação na Pista do Dia e eliminatórias em divisões de seis. Vale troféu.',
  },
  {
    id: 'treino',
    nome: 'Treino livre',
    grupo: 'solo',
    cor: '#cfd6dd',
    resumo: 'Sem fila e sem pressão: uma pista nova a cada volta, no nível que você escolher.',
  },
  {
    id: 'pistaDoDia',
    nome: 'Pista do Dia',
    grupo: 'solo',
    cor: '#ffc630',
    resumo: 'A mesma pista para todo mundo, o dia inteiro. Bata as medalhas e o fantasma do seu recorde.',
  },
  {
    id: 'desafios',
    nome: 'Desafios da semana',
    grupo: 'solo',
    cor: '#43e7ff',
    resumo: 'Cinco pistas com as regras mexidas. O quadro de cada uma zera toda segunda-feira.',
  },
  {
    id: 'circuito',
    nome: 'Circuito Oficial',
    grupo: 'solo',
    cor: '#45e7ad',
    resumo: 'A pista que nunca muda: o ranking mundial guarda o melhor tempo de cada piloto, de todos os tempos.',
  },
]

export const NOME_DO_GRUPO: Record<GrupoDoMenu, string> = {
  online: 'Online',
  solo: 'Solo',
}

export function modoPorId(id: ModoDoMenu): DefinicaoDoModo {
  return MODOS_DO_MENU.find((modo) => modo.id === id) ?? MODOS_DO_MENU[0]
}

export function eModoDoMenu(valor: unknown): valor is ModoDoMenu {
  return MODOS_DO_MENU.some((modo) => modo.id === valor)
}

/** O modo escolhido fica entre visitas: quem joga ranqueada volta direto para ela. */
const MODO_KEY = 'corrida-modo-do-menu'

export function lerModoDoMenu(padrao: ModoDoMenu = 'sala'): ModoDoMenu {
  try {
    const guardado = localStorage.getItem(MODO_KEY)
    return eModoDoMenu(guardado) ? guardado : padrao
  } catch {
    return padrao
  }
}

export function guardarModoDoMenu(modo: ModoDoMenu) {
  try {
    localStorage.setItem(MODO_KEY, modo)
  } catch {
    // Sem armazenamento, o menu abre no modo padrão na próxima visita.
  }
}
