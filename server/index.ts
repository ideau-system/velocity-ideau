import { networkInterfaces } from 'node:os'
import { createGameServer } from './app.js'
import { SUPABASE_URL_PADRAO, verificadorDeTeste, verificadorDoSupabase, verificadores } from './contas.js'
import { aberturaAs, CLASSIFICACAO_MS } from './copa/copa.js'
import { criarRepositorio } from './dados/index.js'
import { COUNTDOWN_MS } from './rooms.js'

const port = Number(process.env.PORT) || 3001

// Salas que sempre existem, para o QR code da apresentação nunca falhar.
const openRooms = (process.env.DEMO_ROOMS ?? 'DEMO1')
  .split(',')
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean)

// Perfis, tempos da Pista do Dia e ranqueada: no Postgres com DATABASE_URL, na
// memória sem ela — o jogo casual funciona igual nos dois casos.
const repositorio = await criarRepositorio()

// Copa do Dia: o horário de Brasília em que abre (padrão 21:00) e quantos
// minutos dura a classificação (padrão 10). Num evento, dá para marcá-la para
// o meio da apresentação.
const horarioDaCopa = process.env.COPA_HORARIO ?? '21:00'
const classificacaoMs = (Number(process.env.COPA_CLASSIFICACAO_MIN) || CLASSIFICACAO_MS / 60_000) * 60_000

// Contas: o login é do Supabase Auth, e o servidor confere o token de cada
// conexão com as chaves públicas do projeto. CONTAS_DE_TESTE=1 aceita também
// os tokens dos pilotos virtuais — só para testar na própria máquina.
const supabaseUrl = process.env.SUPABASE_URL || SUPABASE_URL_PADRAO
const contasDeTeste = process.env.CONTAS_DE_TESTE === '1'
const contas = contasDeTeste
  ? verificadores(verificadorDeTeste(), verificadorDoSupabase(supabaseUrl))
  : verificadorDoSupabase(supabaseUrl)

const { http } = createGameServer({
  openRooms,
  repositorio,
  contas,
  copa: { abertura: aberturaAs(horarioDaCopa), classificacaoMs },
})

/** Endereços da máquina na rede local, para acessar pelo celular no evento. */
function enderecosLocais() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((rede) => rede && rede.family === 'IPv4' && !rede.internal)
    .map((rede) => `http://${rede!.address}:${port}`)
}

http.listen(port, '0.0.0.0', () => {
  console.log(`Corrida Fantasma no ar em http://localhost:${port}`)
  for (const endereco of enderecosLocais()) console.log(`  na rede local: ${endereco}`)
  console.log(`Largada agendada com ${COUNTDOWN_MS} ms de antecedência.`)
  if (openRooms.length > 0) console.log(`Sala(s) de demonstração sempre abertas: ${openRooms.join(', ')}`)
  console.log(`Perfis e rankings: ${repositorio.descricao}`)
  console.log(`Contas: Supabase Auth em ${supabaseUrl}`)
  if (contasDeTeste) console.warn('ATENÇÃO: CONTAS_DE_TESTE=1 — qualquer um entra em qualquer conta de teste. Nunca use assim em produção.')
  console.log(`Copa do Dia: às ${horarioDaCopa} de Brasília, com ${classificacaoMs / 60_000} min de classificação.`)
})
