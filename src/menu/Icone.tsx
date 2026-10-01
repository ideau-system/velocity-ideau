import type { ModoDoMenu } from './modos'

export type NomeDoIcone =
  | ModoDoMenu
  | 'jogar'
  | 'ranking'
  | 'garagem'
  | 'perfil'
  | 'opcoes'
  | 'voltar'
  | 'play'
  | 'relogio'
  | 'cadeado'
  | 'olho'
  | 'fechar'

/**
 * Os traços de cada ícone, num quadro de 24. Linha de 2 e pontas redondas,
 * como os do resto da interface: nenhum depende de fonte nem de biblioteca.
 */
const TRACOS: Record<NomeDoIcone, string> = {
  // Pessoas: a sala com os amigos.
  sala: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.6 5.2',
  // Escudo com divisas: o tier.
  ranqueada: 'M12 3l8 3v5.5c0 4.8-3.4 8.3-8 9.8-4.6-1.5-8-5-8-9.8V6zM8 11.5l4-3 4 3M8 15.5l4-3 4 3',
  // Taça.
  copa: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5v1.2A3.8 3.8 0 0 0 8 11M16 6h3.5v1.2A3.8 3.8 0 0 1 16 11M12 13v4M8.5 20.5h7M10 17h4',
  // Cronômetro.
  treino: 'M12 20.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12 13V9.5M10 2.5h4M18.4 6.6l-1.6 1.6',
  // Calendário.
  pistaDoDia: 'M5 5h14a1.5 1.5 0 0 1 1.5 1.5v12.5A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5zM3.5 10h17M8 3v4M16 3v4M8.5 14h2.5v2.5H8.5z',
  // Raio: as regras mexidas.
  desafios: 'M13 2.5L5 13.5h6l-1 8 8-11h-6z',
  // Globo: o ranking mundial.
  circuito: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM3.5 12h17M12 3.5c2.5 2.3 3.8 5.1 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.1-3.8-8.5S9.5 5.8 12 3.5z',
  // Bandeira: jogar.
  jogar: 'M5 21V3.5M5 4h13l-2.6 4.5L18 13H5',
  // Pódio.
  ranking: 'M3 20.5h18M4.5 20.5V14h5v6.5M9.5 20.5V9h5v11.5M14.5 20.5V12h5v8.5',
  // Volante.
  garagem: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3.8 10.5l5.8 1M20.2 10.5l-5.8 1M12 14.5v6',
  // Capacete de gente.
  perfil: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20.5c1-4 4.2-6 8-6s7 2 8 6',
  // Controles deslizantes: as opções.
  opcoes: 'M4 7h9M18 7h2M4 17h3M12 17h8M15.5 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  voltar: 'M15 5l-7 7 7 7',
  play: 'M8 5.5v13l10.5-6.5z',
  relogio: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 2',
  cadeado: 'M6.5 10.5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5zM8 10.5V7.5a4 4 0 0 1 8 0v3',
  olho: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  fechar: 'M6 6l12 12M18 6L6 18',
}

/** Os que são cheios, e não contorno. */
const CHEIOS = new Set<NomeDoIcone>(['play'])

export default function Icone({ nome, className }: { nome: NomeDoIcone; className?: string }) {
  const cheio = CHEIOS.has(nome)
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill={cheio ? 'currentColor' : 'none'}
      stroke={cheio ? 'none' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={TRACOS[nome]} />
    </svg>
  )
}
