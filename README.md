# Corrida Fantasma

Protótipo jogável do plano em `PLANO_DESENVOLVIMENTO.md`: corrida offline, lobby multiplayer para até seis pilotos, largada sincronizada, um carro fantasma para cada rival e resultado oficial com revanche.

## Como se dirige

O piloto controla **direção**, **acelerador**, **freio**, **câmbio** e **boost**.
No teclado, W ou ↑ acelera, S ou ↓ freia, A/D ou ←/→ viram, E sobe e Q reduz a
marcha, e o espaço é o boost. No toque o pé fica no fundo sozinho — os dois
polegares já têm a direção e o boost —, e o freio mora ao lado do boost.

**Pedais e câmbio** (`src/game/simulation.ts`, testados em `src/game/cambio.test.ts`):

- **Sete marchas**, próximas como num câmbio de corrida: da primeira para a
  segunda o giro cai 28%; da sexta para a sétima, 10%. A última chega ao teto
  do nível; o cruzeiro cai na quinta, a mais de nove décimos do corte, e só o
  boost vai à sétima.
- **Câmbio automático**, o padrão no toque: sobe logo antes do corte e reduz
  quando o giro cai demais. Com ele a física é *exatamente* a de antes do
  câmbio — os tempos de referência, as medalhas e o piso de tempo do servidor
  continuam valendo, e as voltas gravadas antes continuam sendo refeitas iguais.
- **Câmbio manual**, o padrão no teclado (o botão MANUAL/AUTO ao lado da marcha
  troca, e tocar numa borboleta no automático já passa para o manual). As
  quinze luzes do volante — verdes, vermelhas e azuis — sobem com o giro; um
  quarto de segundo antes do corte todas piscam em roxo: é a **janela da troca
  perfeita**, que fica aberta até 0,15 s depois de o motor bater no corte.
  Subir nela rende 0,4 s de impulso — a mesma força do boost, sem gastar a
  barra —, e trocas perfeitas seguidas acumulam até 1,2 s. Trocar **tarde**
  deixa o carro parado no corte; trocar **cedo** derruba o giro abaixo da faixa
  de força, e o motor se arrasta (até 35% da força numa marcha longa demais). A
  redução que passaria do corte é recusada, como num Fórmula 1. Em cruzeiro a
  janela não abre — o carro precisa estar ganhando velocidade —, então subir e
  descer de marcha não fabrica turbo, e frear para colher trocas perfeitas
  nunca compensa (há teste para isso).
- Medido da largada até 245 km/h, no normal: automático, 5,9 s; trocando
  sempre na janela, 3,9 s; trocando só depois de bater no corte, 7,0 s;
  trocando com o motor em meio giro, 6,2 s. Numa prova inteira, com o piloto
  completo, acertar todas as trocas vale pouco mais de um segundo sobre o
  automático, e atrasá-las custa quase um.
- **Freio**: de 95 a 135 km/h por segundo, mais forte em alta, como a asa
  ajuda um Fórmula 1 de verdade. Vence o acelerador e o boost. Como a força da
  curva cresce com o quadrado da velocidade, frear antes do grampo é o que deixa
  entrar por dentro sem ir para o muro. Freando, a luz de chuva pisca, como a
  de um Fórmula 1 recuperando energia.
- **Pé fora**: sem acelerar nem frear, o carro perde uns 22 km/h por segundo em
  cruzeiro — arrasto e freio-motor. Tirar o pé no meio de um impulso o joga
  fora. O boost também acelera, mesmo sem o pedal.

**O som segue o câmbio** (`src/game/motorF1.ts`). O motor gravado de cada carro
sobe e cai exatamente quando a física troca: a voz que aguenta cai o que a
marcha cai, e as gravadas só no alto do giro encolhem a queda — o V8 da Brawn a
62%, o V10 da Williams a 71% — para a gravação nunca ser esticada além de um
quinto. Na subida a ignição corta por um instante e o escapamento estala (e a
válvula do turbo sopra, nos V6 dos anos oitenta); na redução o câmbio dá o
toque no acelerador, o giro pula e o escapamento pipoca; no corte, o limitador
engasga dezesseis vezes por segundo; tirando o pé em giro alto, o escapamento
estoura, cada vez mais fraco. No grid, segurar o W segura o giro da largada.
Medido fora de tempo real, o estalo da subida passa de 2 a 7 dB por cima do
motor, conforme a voz (o híbrido, abafado pela turbina, de 1 a 2 dB), sem
nenhum ponto passar de 0,45 na saída.

**Os avisos ficam acima do horizonte.** No monitor e no notebook, batida, fora
da pista, reset, tangência, troca perfeita, parcial, nota de curva e o painel do
rival moram em duas colunas na faixa do HUD, uma de cada lado do cronômetro —
à esquerda o que cobra, à direita o que paga —, e as luzes da largada viram um
pórtico no alto da tela. A pista que vem, onde se leem a curva e o obstáculo,
fica inteira à vista. No celular cada aviso fica onde sempre esteve.

Além dos pedais, há três coisas disputando a direção e o boost.

**A curva empurra, e quem segura o volante a faz.** A curvatura vem do traçado
sorteado para a corrida, a mesma que está sendo desenhada na tela, e entra na
física como força lateral: cresce com o quadrado da velocidade e só desloca o
carro no que passa da aderência do pneu. A calibração segue a regra de Top Gear:
em cruzeiro, segurar o volante para o lado da curva sempre mantém o carro na
linha — o desafio é a linha e o boost, e não uma curva que não se consegue fazer.

| Nível | Aderência | Pior curva comum pede do volante | Grampo pede do volante |
| --- | --- | --- | --- |
| Normal | 0,18 | 72% em cruzeiro · **151%** de boost | 93% em cruzeiro · **192%** de boost |
| Difícil | 0,15 | 72% em cruzeiro · 146% de boost | 94% em cruzeiro · 186% de boost |
| Profissional | 0,12 | 73% em cruzeiro · 143% de boost | 94% em cruzeiro · 181% de boost |

Passar de 100% significa que ali o carro escapa mesmo com o volante todo virado, e
é só de boost que isso acontece: **de boost, o motor manda às rodas mais força do
que o pneu segura de lado**, e a carga da curva cresce 30%. É a lição do nitro de
Top Gear — na reta ele é a arma; na curva, o jeito mais rápido de ir para a grama.
O pneu que escapa também esfrega velocidade, mas pouco: quem faz a linha perde uns
5% numa super curva.

O volante tem inércia de um décimo de segundo, e castiga só o **zigue-zague**: o
volante indo de um lado para o outro. Pulsar o mesmo lado — que é como se segura
uma curva com tecla ou toque, onde não existe meio volante — não custa nada.

**Por dentro é mais curto.** Numa curva de raio R, a linha a n metros do centro
tem raio R − n: quem vai por dentro avança na pista mais depressa na mesma
velocidade, e quem vai por fora, mais devagar. Pela mesma conta, por dentro a
curva empurra mais. É a escolha de toda curva de verdade, e pseudo-3D nenhum da
linhagem de Top Gear e Horizon Chase a fazia: neles o carro avança pela linha
central esteja onde estiver. O ganho nunca faz o carro passar do teto do nível, que
é o que o servidor usa para o tempo mínimo da prova.

**As super curvas.** Toda prova tem quatro, uma de cada tipo, em ordem e lado
sorteados pela semente, todas com raio de 21 a 27 m no ápice:

| Tipo | Virada | Pista | Carga no ápice |
| --- | --- | --- | --- |
| Cotovelo | 90° | 64 m | 2,27× a pior curva comum |
| Grampo | 180° | 100 m | 2,72× — o mais fechado |
| Caracol | 270° | 165 m | 2,53×, e dura o dobro |
| S | 100° + 100°, emendadas | 2 × 64 m | 2,45× em cada metade |

Elas empurram um quarto a mais que a pior curva comum: em cruzeiro, pedem
quase o volante todo, e de boost jogam o carro para fora. O que decide a curva é
a linha:

- **A nota de curva avisa** 280 m antes, do lado para onde a pista vai, como o
  copiloto de rali: nome, ângulo, distância e o que fazer (*SOLTE O BOOST*,
  *ENTRE POR DENTRO*, *SEGURE*). No S ela mostra as duas setas e, passado o ápice
  da primeira metade, já fala da segunda.
- **A tangência mora no ápice**, no meio da curva, na faixa âmbar da zebra de
  dentro: entre por dentro e segure a zebra até ali. Por dentro a curva empurra
  mais, porque o raio é menor, e é isso que a faz valer: devolve 22% de boost,
  uma vez por curva, e a linha de dentro é a mais curta. O S tem uma tangência
  só, a da primeira metade — para tangenciar as duas, o carro teria de largar o
  lado de dentro antes do primeiro ápice.
- **Por fora de cada super curva há um muro de pneus**, a 70 cm do asfalto.
  Encostar nele é batida: conta para o reset, derruba a velocidade, solta faísca,
  e colado nele o carro continua raspando velocidade. Quem segura o volante nunca
  chega lá; quem não vira, ou entra de boost e corrige tarde, chega.
- Medido com os pilotos de teste no normal: quem faz a tangência chega de 0,6 a
  1,4 s antes de quem entra pelo meio, e ninguém que segura o volante vai para a
  grama. Quem não vira na super curva bate no muro em toda semente e perde de 8 a
  10 s. O iniciante termina dentro da janela de 60 a 90 s em todos os níveis.

A pista relida a cada passo fixo, e não uma vez por quadro, garante que a super
curva chegue na mesma hora para aparelhos de 60, 30 e 20 quadros por segundo. O
traçado põe o miolo de cada uma, e o lado de dentro da entrada, longe dos
obstáculos que todos os níveis têm.

**Para desenhar a volta, a câmera virou de verdade.** Ela ficava presa ao eixo do
mundo, e era isso que limitava as curvas a 24°. Agora a pista é desenhada no
referencial do carro, e a paisagem gira com o rumo dele. E o desenho exagera: nas
super curvas a pista na tela vira uma vez e meia o que a física vira, chicoteando
para fora da tela, e a paisagem gira junto — o caracol passa o céu inteiro diante
do carro mais de uma vez. O horizonte inclina para dentro da curva na proporção da
força lateral — três graus na pior curva comum, quatro num grampo, oito de boost —, e o
carro deita com ela. O muro é uma parede contínua de pneus vermelhos e brancos com
as placas de seta em cima, e o pneu que passa da carga da pior curva comum solta
fumaça.

**O vácuo do rival rende.** Vindo atrás e alinhado com o adversário, o carro ganha
até 26 km/h no normal — cerca de 10% do cruzeiro nos três níveis —, mais forte
quanto mais perto. Ultrapassar custa esse ganho, porque a esteira desaparece no
instante em que o carro passa à frente. É o que dá sentido mecânico à presença do
outro piloto: sem isso, uma corrida on-line seriam duas provas solo sobrepostas.
Com pilotos de habilidade diferente o melhor continua ganhando; o vácuo só encosta
os carros quando já estão empatados, que é justamente a disputa que se quer
dramática.

**Três jeitos de ganhar tempo com os mesmos dois comandos.** A pesquisa que
orienta o jogo competitivo está em [PESQUISA_COMPETITIVA.md](PESQUISA_COMPETITIVA.md);
o risco que ela aponta primeiro é o jogador sentir que não faz nada — e aqui a
aceleração é automática. Então cada comando ganhou uma segunda camada:

- **Largada turbo.** Aperte o boost no instante em que as luzes se apagam. As
  cinco acendem em ritmo fixo, 900 ms cada, então acertar é antecipar o ritmo,
  e não reagir mais rápido que a tela. Até 150 ms depois é a **perfeita** — o
  carro sai da linha a 90 km/h, com um segundo de impulso —; até 350 ms, a boa;
  até 700 ms, a turbo. Boost apertado desde antes da hora **queima a largada**:
  o motor afoga e o carro fica 0,8 s parado. Apertar e soltar antes não custa
  nada; o que queima é estar segurando quando as luzes se apagam
  (`src/game/largada.ts`).
- **Mini-turbo de curva, sem botão novo.** Segurar a direção para dentro de uma
  curva de verdade carrega um turbo; endireitar o dispara. Por dentro da pista a
  carga sobe duas vezes e meia mais rápido que por fora — é a receita do Mario
  Kart, com a linha fazendo o papel do ângulo do direcional. São três níveis
  (0,4, 0,8 e 1,2 s de carga), com faíscas azul, laranja e roxa, cada uma
  maior, e uma nota que sobe a cada nível; o terceiro só sai de uma super curva
  feita inteira pela linha de dentro. Em reta não carrega nada, e é isso que
  impede encadear turbos em zigue-zague. De boost também não: na curva o piloto
  escolhe entre o nitro, que a curva cobra, e a carga, que ela paga na saída. E
  apertar o boost com a carga guardada a solta, porque é o gesto natural de
  quem endireita e acelera. Grama e batida jogam a carga fora.
- **O impulso** que o mini-turbo e a largada pagam leva o carro à velocidade do
  boost sem gastar a barra — com o boost apertado, a barra espera o impulso
  acabar. Nunca passa do teto do nível, então o tempo mínimo que o servidor
  aceita continua valendo.
- **Tangências seguidas rendem mais**: 22, 27 e 32% de boost, à vista no aviso
  (×2, ×3). Uma zebra perdida, o muro ou um reset zeram a sequência.
- **Raspão**: passar rente a uma barreira, sem tocar, devolve 6% de boost — o
  boost ganho por risco de Burnout, pequeno e uma vez por peça.

Os pilotos de teste medem a escada, em `src/game/habilidade.test.ts`: no normal,
na média de cinco sementes, quem corrige só na borda do asfalto faz 75,6 s; quem
desvia com o boost ligado, 69,8 s; quem lê a nota de curva e tangencia, 67,3 s;
e quem usa tudo — tangência, mini-turbo e largada perfeita —, 65,2 s. Cada
degrau vale tempo em todos os níveis, e o teste falha se algum deixar de valer.

**O volante castiga quem o maltrata.** Uma correção de curva mexe pouco e some;
zigue-zague sustentado acumula e cobra aderência. Os dois sistemas não brigam: uma
correção firme e mantida não é punida, porque o que conta é o curso do volante, e
não a posição do carro.

## Pista do Dia e contrarrelógio

O traçado da corrida é sorteado a cada prova: justo dentro da sala, porque
todos correm a mesma pista, mas impossível de comparar entre provas. A **Pista
do Dia** resolve do jeito do Spelunky e da Track of the Day do Trackmania: uma
semente por dia, a mesma para todo mundo, virando à meia-noite de Brasília
(`src/game/contrarrelogio.ts`).

- Corre no nível **difícil**, o oficial — o mesmo da ranqueada —, para os
  tempos serem comparáveis e a população pequena não se dividir em três quadros.
- **Fantasma do recorde.** A melhor volta fica guardada no navegador, dez
  amostras por segundo, uns 9 KB (`src/game/gravador.ts`), e corre na pista na
  tentativa seguinte, com o carro do próprio piloto. Ele não deixa vácuo: se
  deixasse, o tempo dependeria de colar nele.
- **Delta ao vivo** embaixo do cronômetro — o tempo de agora menos o do recorde
  no mesmo ponto da pista —, e a **parcial** de cada setor, na saída de cada
  super curva, em verde ou vermelho.
- **Recomeço instantâneo**: `Backspace` ou o botão RECOMEÇAR, com contagem de
  2,4 s. Tentar de novo tem de custar menos que desistir.
- **Medalhas.** Uma pista sorteada não tem autor, então o "tempo do autor" é o
  do piloto de teste que usa tudo, rodado fora da tela na hora: **Piloto** é
  bater esse tempo, **Ouro** fica 3% acima dele, **Prata** 7% e **Bronze** 12%.
  Na prática, quem tangencia pega ouro, quem só desvia com boost pega prata, e
  o iniciante que corrige na borda ainda não pega nada.

Toda prova — treino, online ou contrarrelógio — termina com o **resumo**
(`src/game/analise.ts`):

- **onde você perdeu tempo**, com os segundos estimados: tangências perdidas,
  batidas, resets, grama e largada;
- **o que você usou da pista**: tangências, sequência, mini-turbos por nível e
  raspões;
- **cinco metas de corrida limpa**, à moda dos bônus secretos de Top Gear 3000:
  todas as tangências, sem batidas, nunca na grama, boost sem travar e largada
  perfeita.

Nada disso entra na classificação. Uma meta paralela que valesse ponto
desviaria o piloto de tentar chegar primeiro — a lição do Mario Kart Tour e da
Aegis do LoL.

### Desafios da Semana

O Playground do Horizon Chase Turbo: **cinco pistas por semana**, cada uma com
uma regra mexida, e um quadro por desafio que zera toda segunda-feira à
meia-noite de Brasília (`src/game/desafios.ts`). As sementes saem da semana, então
o aparelho e o servidor chegam aos mesmos cinco desafios sem combinar nada.

| Desafio | O que muda |
| --- | --- |
| Clássico | Nada: a pista pura, no nível difícil |
| Nitro livre | O boost não gasta |
| Só tangência | O boost só recarrega na tangência |
| Chuva | Menos aderência nas curvas, e sair da linha custa mais |
| Profissional | O nível profissional |

Cada desafio tem medalhas próprias, com o piloto de teste correndo sob a mesma
regra, e o resultado do contrarrelógio diz qual desafio foi corrido.

## Ranqueada

A fila pública (`server/ranqueada/`), no molde da Riot de 2025–2026 e do TFT. **Só ela conta**: salas por código ou QR continuam casuais, para amigos não combinarem resultado. A ranqueada é de quem tem [conta](#contas): o nome é o do cadastro, e o PL, o tier e o histórico vão com o piloto para qualquer aparelho.

- **Dois números por piloto, como no LoL.**
  - O **MMR**, oculto, é o OpenSkill com o modelo Bradley-Terry completo (`openskill`, licença MIT): cada corrida de seis vira quinze duelos. Foi o de menor erro em partidas de todos contra todos no artigo que o criou, e em salas de seis reduz a incerteza duas vezes mais depressa que o Plackett-Luce.
  - Os **PL** (pontos de liga), visíveis, andam pela colocação: com seis, +30, +20, +10, −10, −20, −30. A metade de cima nunca perde, como no TFT; salas menores movem menos, e o duelo vale ±10.
  - Os PL convergem para o MMR com um multiplicador limitado entre 0,75 e 1,25, como o +35/−25 do LoL. Quem está acima dos próprios PL ganha mais e perde menos, e a tela avisa.
- **Tiers:** Bronze, Prata, Ouro, Platina e Diamante, com divisões III, II e I de 100 PL. Acima disso vem o Mestre, uma escada aberta, e os cinco primeiros do Mestre recebem o selo de **Lenda**.
- **Colocação e proteções:**
  - 5 corridas de colocação sem perda de PL, com teto no Ouro I.
  - Promoção automática, sem série.
  - Bronze e Prata não caem de tier, e perdem pela metade.
  - Acima da Prata, cair de tier leva à divisão I de baixo com 75 PL, e subir dá 3 corridas de escudo.
  - Sem decay: a ausência só aumenta a incerteza do MMR, e quem some por duas semanas sai da vista na escada do Mestre.
- **Corrida:**
  - A fila espera até 20 s para juntar até seis pilotos, agrupados pela ordem do MMR em salas de tamanho parecido.
  - A largada sai sozinha, no nível **difícil**, numa das dez pistas da semana. Esse pool é curado pelos pilotos de teste: fica a semente em que o iniciante termina entre 60 e 90 s e em que usar tudo rende tempo.
  - Três minutos depois da largada, quem não chegou fica como "não completou", e o resultado sai.
- **Integridade:**
  - Na sala ranqueada, a telemetria fica presa ao que cabe desde a largada, e a chegada só vale se a telemetria validada estiver a menos de 150 m da linha.
  - Abandono conta como último lugar e custa 5 PL extras.
  - Sair ou cair na contagem cancela a sala para todos, sem PL, e quem saiu espera 1, 5 e depois 30 minutos para voltar.
  - O mesmo grupo correndo junto mais de três vezes por hora ganha e perde metade dos PL.
- **Transparência:** o resultado mostra o delta de cada piloto para todos e, contra cada rival, a chance que o MMR dava de ficar à frente dele. É a lição das mudanças opacas de rating do Mario Kart.
- **Temporadas:** uma por semestre (`2026.2`), acompanhando o calendário acadêmico. Na virada, o MMR volta 30% do caminho até a média e vêm 3 corridas de colocação. Recompensas, se vierem, são só cosméticas.

**Fantasmas quando falta gente.** Quem espera sozinho na fila por 40 s corre contra **voltas gravadas** de outros pilotos, na mesma pista do pool — o que o Horizon Chase 2 faz completando salas com IA, só que com voltas de gente de verdade:

- toda chegada ranqueada leva a volta gravada, e o servidor a guarda quando ela bate com o tempo oficial, junto do MMR que o piloto tinha ao corrê-la;
- a sala junta até cinco voltas das últimas duas semanas, de MMR mais perto do de quem espera — voltas típicas, não recordes;
- o servidor reproduz cada volta como telemetria, pelo mesmo caminho de um rival, e marca a chegada no tempo dela. Os fantasmas não têm colisão nem deixam vácuo além do que a posição deles dá, como qualquer rival;
- no rating, o fantasma entra com o **MMR congelado** e só o humano é atualizado. No placar, o nome dele leva "(fantasma)".

A simulação em `server/ranqueada/rating.test.ts` confere que o rating encontra quem é bom: com sessenta pilotos de habilidade oculta, em salas de seis e vinte corridas cada, a ordem do MMR bate com a habilidade real (Spearman acima de 0,9).

Para testar a ranqueada sem um segundo aparelho, o piloto virtual entra na fila e corre com a física de verdade:

```bash
npm run piloto -- --ranqueada --nome Rival --carro schumacher
```

## Copa do Dia

O Cup of the Day do Trackmania e o Grand Prix do F-Zero 99, no tamanho de uma sala de seis (`server/copa/copa.ts`). Com pouca gente jogando, é a **hora marcada** que junta os pilotos.

1. **Inscrição**, pelo card do menu, a qualquer hora do dia até o fim da classificação.
2. **Classificação**, às **21h de Brasília**, por **10 minutos**: é a Pista do Dia no contrarrelógio de sempre. Vale a melhor volta **aceita** pelo servidor e largada dentro da janela; uma volta pendente não entra, porque a copa não espera conferência. A volta que largou antes do fim ainda tem uma folga para chegar.
3. **Divisões:** pela ordem da classificação, só com quem está conectado, no menor número de salas de até seis, repartidas por igual — sete pilotos viram 4 e 3, e ninguém é campeão sem correr.
4. **Eliminação:** cada divisão corre na pista do dia, com largada automática, telemetria estrita e limite de três minutos, como a ranqueada. Em cada corrida sai **o último**; quem não completou fica atrás de quem chegou, com o empate desfeito pela classificação. Quem abandona, cai ou pede para sair sai na hora, todos juntos. Sair na contagem elimina quem saiu, e os outros largam de novo numa sala nova. Quem sobra é o **campeão da divisão**.
5. **Troféus:** 1º, 2º e 3º de cada divisão ganham um troféu **só cosmético**, que aparece no card da copa. Quem abandonou não leva troféu. A copa não mexe no MMR nem nos PL.

Entre uma rodada e outra, o resultado mostra quem saiu, quem segue e a contagem até a próxima largada. O horário e a duração da classificação se ajustam por `COPA_HORARIO` e `COPA_CLASSIFICACAO_MIN` — num evento, dá para marcar a copa para o meio da apresentação. O estado da copa vive na memória do servidor; os troféus, no repositório.

Para ver uma copa inteira sem mais aparelhos, marque-a para daqui a pouco e rode pilotos virtuais inscritos — eles mandam uma volta de classificação de verdade e correm as rodadas com a física do jogo:

```bash
COPA_HORARIO=16:45 COPA_CLASSIFICACAO_MIN=3 npm run dev
npm run piloto -- --copa --nome Rival
npm run piloto -- --copa --nome Lento --novato --abandona --carro schumacher
```

## Contas

O login é do **Supabase Auth**, com **e-mail e senha** (`src/conta/`). Na primeira visita o jogo abre a porta de entrada, com três caminhos:

- **Entrar** na conta que já existe.
- **Criar conta**, escolhendo o **nome de piloto** — de 3 a 16 caracteres, único entre as contas sem diferenciar maiúsculas, conferido enquanto se digita. É o nome do grid, da ranqueada e do ranking mundial, e não muda depois.
- **Jogar como convidado**, com o nome escolhido no menu, como sempre foi. O convidado corre online e treina; ranqueada, Copa do Dia, quadros e ranking mundial pedem conta, porque precisam de nome único — senão qualquer um correria como outro piloto. O contrarrelógio do convidado guarda o recorde só no aparelho.

A escolha fica lembrada: quem entrou volta direto para a conta, e o convidado não vê mais a porta de entrada — o botão da conta fica no canto do menu.

A senha vai do aparelho direto para o Supabase, por HTTPS, e nunca passa pelo servidor do jogo. O que o servidor recebe é o **token de acesso** da sessão, que ele confere com as chaves públicas do projeto (JWT com ES256, `server/contas.ts`) — sem consultar o Supabase a cada conexão. O id do usuário no Supabase é o id do perfil no jogo, e na conta o nome que vale no grid é o do cadastro, qualquer que seja o que o aparelho mandar. O cliente do Supabase é baixado só por quem usa conta: o convidado não baixa nada disso.

**No painel do Supabase** (Authentication), antes de abrir o jogo ao público:

1. **Confirmação de e-mail.** O envio de e-mail padrão do Supabase só entrega para membros do time do projeto, e com limite de poucos por hora. Ou se desliga *Confirm email* (em *Sign In / Providers → Email*), e a conta entra na hora, ou se configura um SMTP próprio (em *Emails → SMTP Settings*). Com a confirmação ligada e sem SMTP, o cadastro de quem não é do time falha.
2. **Endereço do site.** Em *URL Configuration*, o *Site URL* e as *Redirect URLs* com o endereço público do jogo: é para lá que os links de confirmação e de troca de senha levam.
3. **Senha vazada** (opcional, planos pagos): *Leaked password protection* recusa senhas que já apareceram em vazamentos.

"Esqueci a senha" manda o link de troca pelo mesmo envio de e-mail, então só funciona com o SMTP configurado. Trocar a senha estando na conta funciona sempre, pelo perfil.

## Ranking mundial

Tempo só se compara na mesma pista, e cada corrida sorteia um traçado. O ranking mundial de melhor tempo é, por isso, o de uma pista que não muda nunca: o **Circuito Oficial** (`CIRCUITO_OFICIAL` em `src/game/contrarrelogio.ts`), como as pistas da campanha do Trackmania. A semente foi escolhida entre as que o pool da ranqueada aprovaria: o iniciante termina em 77 s, e o piloto que usa tudo tira 15 s disso. Trocar a semente zera o ranking.

- Corre-se no contrarrelógio de sempre, no nível difícil, com medalhas, fantasma do recorde pessoal e recomeço instantâneo.
- Cada volta passa pela mesma conferência da Pista do Dia — o relógio do servidor, a volta gravada e a re-simulação pelos comandos —, e vale o **melhor tempo de cada piloto, de todos os tempos**.
- O ▶ ao lado dos dez primeiros baixa o fantasma daquele piloto e larga contra ele.

A tela do ranking tem três abas: **melhor tempo** (o Circuito Oficial), a **Pista do Dia** e a escada da **ranqueada**. O nome de qualquer piloto abre o perfil dele.

## Perfil do piloto

O perfil (`src/perfil/Perfil.tsx`, montado em `server/estatisticas.ts`) mostra:

- **corridas online** — salas, ranqueada e Copa —: corridas, vitórias, pódios, aproveitamento, posição média e abandonos. Vitória e pódio só contam com rival na sala e com a chegada cruzada;
- a **ranqueada** da temporada, e onde o piloto terminou cada temporada anterior;
- os **melhores tempos**: a posição no ranking mundial, as voltas de contrarrelógio, as pistas com tempo, a melhor medalha de cada pista e quantos quadros ele lidera;
- **na pista**: o carro favorito, a velocidade máxima, os quilômetros rodados e as batidas;
- os **troféus** da Copa do Dia e as **últimas corridas**, com os PL de cada uma.

Cada corrida online de quem tem conta fica guardada (`participacoes`), com a sala e a largada como chave — a mesma corrida não entra duas vezes. O próprio perfil mostra também o e-mail, a troca de senha e a saída da conta.

## Executar

```bash
npm install
npm run dev
```

O comando inicia o site (porta 5173) e o servidor Socket.IO (porta 3001). Abra o endereço do Vite; ele aceita conexões da rede local para facilitar testes no celular.

Para apontar o jogo a outro servidor da partida, use `GAME_SERVER_URL` no desenvolvimento ou `VITE_SERVER_URL` na build.

`npm run dev:paralelo` sobe o mesmo par nas portas 5175 e 3002, para quando outra cópia do projeto — outra worktree, outra sessão — já está com a 5173 e a 3001. É o que a entrada `corrida-fantasma` de `.claude/launch.json` usa.

## Publicar

Em produção é **um processo só**: o mesmo servidor entrega o site e aceita as conexões WebSocket.

Na Hostinger, configure a aplicação como backend Express/Node.js, com Node 24,
build `npm run build` e arquivo de entrada `server.js` na raiz do projeto.
O comando `npm start` também usa essa entrada, que carrega o servidor TypeScript
via `tsx` e assume a porta 3000 quando `PORT` não estiver definida.
Mantenha o projeto completo disponível no servidor: `dist` contém apenas o site,
e a inicialização também depende de `server`, `src/game`, `src/conta` e das dependências npm.
Use uma única instância e habilite WebSocket no proxy da hospedagem.
Para conferir a publicação, acesse `/health` e teste uma sala em dois aparelhos.

```bash
npm ci && npm run build && npm start
```

O servidor escuta em `0.0.0.0` e imprime os endereços da máquina na rede local, para acessar pelo celular. Há um `Dockerfile` pronto para hospedagens que aceitem contêiner.

O estado das salas vive na memória, então precisa ser **uma instância só** — duas separariam os pilotos de uma mesma sala.

O que precisa sobreviver entre uma partida e outra — os perfis, os tempos, a ranqueada, os troféus e as estatísticas — vai para o **Postgres** quando existe `DATABASE_URL` (`server/dados/`). Sem ela, fica na memória: o jogo casual funciona igual, e o resto esquece tudo quando o servidor para, que é o modo do workshop sem internet. As migrações são arquivos SQL em `server/dados/migracoes/`, aplicados na subida, em ordem, cada um numa transação. `docker compose up -d banco` sobe um Postgres para o desenvolvimento (`docker-compose.yml`).

Em produção o banco é o do **Supabase**, no esquema `corrida`, com um papel só do servidor do jogo, `corrida_servidor`. O esquema não é exposto pela Data API, e os papéis `anon` e `authenticated` não têm acesso a ele: o navegador fala com o servidor do jogo, nunca com as tabelas. A `DATABASE_URL` usa o pooler em modo sessão (porta 5432), e a conexão é cifrada e conferida com o certificado raiz do Supabase, que está no projeto (`server/dados/supabase-ca-2021.crt`):

```
postgresql://corrida_servidor.<projeto>:<senha>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
```

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `PORT` | Porta do servidor | `3000` com `npm start`; `3001` no desenvolvimento e Docker |
| `DEMO_ROOMS` | Salas que existem sempre, separadas por vírgula | `DEMO1` |
| `DATABASE_URL` | Postgres de perfis, tempos, ranqueada, troféus e estatísticas | memória |
| `SUPABASE_URL` | Projeto do Supabase cujas contas o servidor aceita | o do jogo |
| `CONTAS_DE_TESTE` | `1` aceita também as contas dos pilotos virtuais. **Nunca em produção** | desligado |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Projeto e chave publicável das contas, na build do site | os do jogo |
| `COPA_HORARIO` | Horário de Brasília em que a Copa do Dia abre, `HH:MM` | `21:00` |
| `COPA_CLASSIFICACAO_MIN` | Minutos de classificação da Copa do Dia | `10` |

### Conta e integridade

O perfil é o da [conta](#contas): o servidor liga cada conexão a ela depois de conferir o token, e ranqueada, Copa, quadros e estatísticas só aceitam conexão ligada a uma conta. O **easter egg** do Hamilton na Mercedes com o nome Ideau vale no treino e nas salas casuais, mas não onde há ponto, troféu ou quadro em jogo: na ranqueada, na Copa e no contrarrelógio o carro é só pintura, no aparelho e no servidor.

O servidor não confia mais no que o cliente diz ser:

- **Quem fala por quem.** Cada conexão ganha o piloto ao criar ou entrar numa sala, e só fala por ele: telemetria, chegada, abandono, confirmação ou troca de carro em nome de outro são recusados.
- **Teto da telemetria por nível.** É o teto da física daquele nível, boost e vácuo inteiros, mais 5%. Antes era 120 m/s para todos, um quarto acima do mais rápido.
- **Chegada recusada avisa.** Antes ela sumia calada e o cliente esperava o resultado para sempre.
- **Tempos da Pista do Dia** são julgados em camadas (`server/contrarrelogio.ts`):
  - o relógio do servidor mede a tentativa inteira, e o tempo declarado precisa caber nela — o jogo em câmera lenta, que derrubou o topo do Trackmania, declara menos do que passou. Vale para a Pista do Dia, os desafios e o Circuito Oficial;
  - a volta gravada precisa bater com o tempo, chegar à linha e nunca passar do teto do nível;
  - volante trocando de lado mais de oito vezes por segundo, ou tempo abaixo do piloto de referência, deixam o tempo **pendente**, fora do quadro até ser conferido.
- **Re-simulação pelos comandos**, a camada do Trackmania (`src/game/registroDeEntradas.ts`). O jogo roda a física em passos arredondados ao microssegundo e guarda, de cada quadro, o passo e os comandos — esquerda, direita, boost, acelerador, freio, as duas borboletas e o câmbio, num byte —, compactados em sequências repetidas: uma volta inteira cabe em poucos KB. O servidor refaz a volta com o mesmo `advanceRace` — o quadro longo do celular lento vira passos iguais, no aparelho e no servidor — e confere com a gravada, com tolerância, porque `Math.exp` e `Math.pow` podem diferir entre motores de JavaScript: mediana do desvio até 5 m, no máximo 10% das amostras acima de 25 m, e a chegada no mesmo segundo. A volta que passa sai de **pendente** direto para o quadro — só o volante suspeito ainda espera conferência. Uma aba escondida que pulou quadros registra o salto, e a re-simulação o repete.

O passo a passo do evento, com conferência de véspera, rede de reserva e roteiro da apresentação, está em [WORKSHOP.md](WORKSHOP.md).

### QR code da apresentação

```bash
npm run qrcode -- https://seu-endereco --sala DEMO1
```

Gera SVG para o slide, PNG para imprimir e o endereço em texto, na pasta `qrcode/`.

### Fontes

A tipografia fica dentro do projeto, em `public/fontes`, para o jogo funcionar em rede sem internet. Para atualizá-la: `npm run fontes`.

### Carros

A pintura de cada carro é uma arte em `public/carros`, gerada por `npm run carros` a partir dos originais em `arte/carros`. É a mesma imagem no menu, na seleção de pilotos, no lobby, no resultado e na pista.

Na pista, `src/game/carSprites.ts` assa a arte numa folha de sprites de quinze quadros durante a contagem de largada, e o laço de corrida escolhe o quadro e faz um `drawImage`. O que varia continuamente — posição, escala com a distância, inclinação da carroceria, trepidação e brilho do boost — fica para a hora do desenho.

Os quadros são poses de um eixo só, da derrapagem toda à esquerda à derrapagem toda à direita:

- **Curva comum**: nove quadros, do volante todo virado para um lado ao outro. As rodas da frente esterçam, a carroceria rola e o carro **gira no próprio eixo** até 7°.
- **Derrapagem**: três quadros de cada lado. O carro atravessa até 13°, a traseira escapa para fora da curva e as rodas da frente **contraesterçam** — o desenho clássico do carro seguro no limite.

A arte é uma imagem chapada, e o giro não é um recorte girado. As rodas da frente saem da carroceria para esterçar sozinhas, e a carroceria é cisalhada: cada linha do desenho desliza de lado na proporção da distância dela ao pivô, pouco à frente do eixo traseiro, que é o que a projeção faria com o carro girado de verdade. O cisalhamento é calibrado para os dois eixos andarem exatamente o que as rodas andam, então a sombra, a banda do pneu e a terra da grama continuam no lugar em qualquer quadro.

A pose sai da física: o esterço é o do volante, e a derrapagem começa pouco antes da carga da pior curva comum — nas super curvas o carro atravessa, e de boost ele vai todo de lado. Ela entra em pouco mais de um décimo de segundo e sai em quase três, e é essa inércia que faz a troca de quadros virar movimento: na entrada de um grampo o carro vira, atravessa, escorrega e endireita. Cada rival derrapa pela mesma conta, com a curva de onde ele está e a velocidade que informou.

A meia-largura do pneu traseiro é `CAR_SPRITE_HALF_WIDTH`, e um teste cobra isso: o carro ocupa na tela exatamente a largura que a regra de saída de pista cobra. Cada rival usa a folha do próprio carro, banhada de azul, e nunca se confunde com o carro do jogador — nem quando os dois escolhem o mesmo.

#### O molde vetorial

`src/game/carModel.ts` descreve o mesmo carro com as formas cheias e as cores chapadas do cenário, e tem dois papéis. É dele que sai a geometria do giro — a profundidade de cada peça, o centro das rodas e a linha do chão —, e é ele que a corrida desenha enquanto a arte não chega, ou se ela não chegar: o jogo nunca espera um arquivo para largar. A pintura de reserva de cada carro, em `PINTURAS`, segue as cores da arte dele.

Cada ponto do molde é dado em metros e projetado por uma câmera de teleobjetiva, alta e distante, a mesma de Top Gear e Horizon Chase. A altura entra achatada de propósito, na convenção do desenho de corrida visto de cima: sem isso o capacete subiria até a altura do bico e o carro perderia o empilhamento que o faz ler como carro. Nenhum volume usa degradê; todos são resolvidos em faixas de cor chapada, com um vinco escuro em cada encontro de peça e um fio claro na quina iluminada.

Para acrescentar um carro, ponha a arte em `arte/carros`, rode `npm run carros`, registre o carro em `CARS` e a pintura de reserva dele em `PINTURAS`.

A escolha é só de pintura. Todos os carros andam com a mesma física: o duelo mede quem dirige melhor, e um carro mais rápido decidiria a corrida antes da largada.

### Cenário

Árvore, arbusto, capim, placa e marcador de distância são descritos em `src/game/cenarioModel.ts` com o mesmo pincel do carro — `src/game/pincel.ts` — e a mesma regra de luz de `src/game/paleta.ts`: rampa de cinco tons que desliza com a luminância, luz sempre de cima e da esquerda, vinco escuro em cada encontro de peça. `src/game/cenarioSprites.ts` assa todos numa folha só, durante a contagem de largada, e o laço de quadro desenha cada objeto com um `drawImage`.

A intuição sobre o que assar estava invertida, e vale registrar: parecia que a folha servia para o campo distante, onde há muitos objetos pequenos, e que o objeto colado na câmera deveria ser desenhado ao vivo para não borrar. É o contrário. Objeto pequeno custa **chamadas**; objeto grande custa **área escrita**. Uma árvore de setecentos pixels com trinta faces escreve mais pixels do que todas as faixas de grama da pista somadas; esticada de uma célula de 256, escreve um terço disso. A folha é o caminho rápido justamente para o que está perto — e o borrão ali custa pouco, porque a sessenta metros por segundo um objeto a cinco metros atravessa a tela em seis quadros.

A **cerca** continua procedural, por motivo estrutural: as travessas de vagas vizinhas precisam se encontrar, e isso depende das projeções das duas vagas — assada por vaga, viraria uma fila de portõezinhos soltos. Os obstáculos que ficam deitados no asfalto também, pelo motivo contrário: a folha descreve cada objeto numa caixa com o chão em zero e o topo em menos um, e essa caixa não descreve uma peça sem altura.

Nenhuma face do cenário pode ser translúcida, e isso é teste. Quem desenha aplica a névoa da distância com `globalAlpha`: face a face isso dá uma cor, e aplicado ao objeto já composto na folha, dá outra — o objeto mudaria de cor ao trocar de nível de detalhe. Pela mesma razão a sombra no chão fica **fora** do sprite, desenhada ao vivo. Ela é o detalhe mais barato do cenário e o que mais rende: sem ela, tudo o que fica na beira da pista paira alguns pixels acima da grama.

### Os quatro lugares

Até aqui os quatro ambientes trocavam só a cor do céu, da serra e da grama: a diferença entre eles era de hora do dia, não de lugar. Agora cada um tem o próprio repertório de objetos, que é o que Top Gear fazia trocando de país a cada etapa — a mesma pista parece outra com outra coisa na beira.

| Ambiente | Lugar | O que aparece na beira |
| --- | --- | --- |
| entardecer | campo | árvore, arbusto, cerca, bandeira, arquibancada |
| manhã | cidade | prédio, poste de luz, guardrail, pilha de pneus, arquibancada |
| meio-dia | montanha | pinheiro, rocha, guardrail, pilha de pneus |
| travessia seca | deserto | cacto, rocha, cerca, capim |

Os quatro conjuntos têm o mesmo número de entradas de propósito. O índice do trecho é sorteado sobre o tamanho da lista, então listas de tamanhos diferentes fariam a estrutura do traçado — onde estão os trechos densos, onde estão as pausas — mudar junto com o lugar. Assim só muda o que aparece.

Três números estavam embutidos e impediam acrescentar família. `FAMILIES.length` era índice, então somar uma entrada mudava a família de toda região em toda semente; a variante vinha de um `* 3` que só funcionava porque três vetores de cor tinham exatamente três entradas; e a supressão de vizinho tinha dois nomes de família escritos à mão. Hoje a variante sorteada é `VARIANTES_SORTEADAS` e quem desenha a reduz ao repertório da própria família, e a supressão sai de uma tabela de estorvo — duas famílias só convivem lado a lado se couberem juntas na soma. A mesma tabela afasta da pista o que é largo: um prédio na beira do asfalto tapa a curva, o mesmo prédio um pouco atrás compõe o fundo.

Cerca e guardrail seguem procedurais, e pelo mesmo motivo: são contínuos, e o vão de cada vaga cobre metade do espaçamento para os dois lados para as travessas se encontrarem. Isso depende das projeções de duas vagas vizinhas, que diferem — assados numa célula por vaga, virariam uma fila de portõezinhos soltos.

Os canais de `randomAt` agora estão listados no cabeçalho de `layout.ts`. Reusar um por engano faz duas decisões independentes andarem juntas: um defeito que não quebra nada, não aparece em teste, e só deixa a pista estranhamente regular.

### Pórticos e chegada

Os arcos sobre a pista caem a cada dezesseis vagas de cenário — noventa e seis metros —, e nem todo marco recebe um: em fila certinha o pórtico vira placa de quilometragem em vez de marco. São **decoração e só**; se colidissem, o layout competitivo passaria a depender da semente e cairia a garantia de que os dois pilotos correm a mesma prova.

Eles são emitidos de **dentro** do laço do cenário, e não num passe à parte. A copa de uma árvore a quarenta metros se debruça sobre a pista, e um arco a oitenta desenhado depois passaria por cima dela.

O pórtico continua procedural, junto com cerca e guardrail: ele acompanha a largura do asfalto, chega a dois mil pixels de dispositivo e não caberia em célula nenhuma — e é barato, uma dúzia de preenchimentos.

O pórtico vive e morre com a vaga em que está, como qualquer outro objeto da beira da pista. Houve uma versão que o fazia subir e se dissolver ao chegar perto, para ele não sumir de um quadro para o outro quando a câmera o alcança — `roadProjection` faz `Math.max(0, distanceAhead)`, então nada cresce além do tamanho que tem em `ahead = 0`. O remédio se via mais que a doença, e saiu.

A linha de chegada era doze células num retângulo de cinco pixels de altura: a superfície mais pobre do jogo, no momento que mais importa dele. Agora são duas fileiras de quadriculado com espessura no asfalto e o pórtico quadriculado por cima.

### Faixa de meio-campo

Entre a serra e a grama corre uma faixa própria de cada lugar: linha de mata no campo, silhueta de prédios na cidade, cumeada de rocha na montanha, dunas no deserto. Sem ela a montanha encostava direto na grama e a distância entre as duas virava um salto.

É uma tira assada uma vez e desenhada como padrão que se repete, então custa um preenchimento por quadro. A tira emenda consigo mesma porque toda silhueta que cruza a borda direita é repetida do outro lado — sem isso, a repetição mostra uma costura vertical atravessando o horizonte a cada volta.

Ela corre mais depressa que a serra e mais devagar que as árvores da beira da pista, e é essa diferença de velocidade que dá a leitura de camadas. O sorteio da tira não usa a semente da corrida: é decoração de horizonte, igual para todo mundo que correr naquele lugar.

`banca.html` é a bancada de desenvolvimento: abre com `npm run dev` em `/banca.html` e mostra toda a folha em três tamanhos, os obstáculos numa pista com a régua antiga e a nova lado a lado, os cinco obstáculos em cinco tamanhos, a poça nos quatro ambientes, uma tira de pórticos de cento e vinte metros até a vaga em que são cortados, as quatro faixas de fundo e o carro em seis poses; no rodapé, o tempo de assar e o tamanho da folha. `?familia=tree` isola uma família, `?flora=seca` troca a paleta. Não entra na build. Ela não precisa do servidor da partida, então a entrada `bancada` de `.claude/launch.json` sobe só o Vite, na porta 5174 — útil quando outra sessão já está com a 5173.

O fundo tem duas cordilheiras, a de trás já lavada pela cor do céu, e cada uma é desenhada duas vezes com a mesma crista deslocada: o que sobra entre as duas é a lasca acesa na encosta voltada para o sol. Nuvens, o halo do sol em três degraus de opacidade e as rajadas de velocidade do boost completam o fundo. Tudo isso junto custa 0,4 ms por quadro.

O que está longe recebe só a silhueta. Detalhe no horizonte vira ruído, e quem manda ali é a névoa.

### Obstáculos

Todo obstáculo mede uma fração da largura da pista **naquela distância** — a mesma régua de perspectiva do asfalto, do cenário e do fantasma. Antes ele tinha régua própria, uma curva quase linear na distância: a pista encolhe com `1/z` e o obstáculo encolhia bem menos, e a cem metros uma barreira cobria dois terços do asfalto que, na altura do carro, ela cobre um quinto. Chegava enorme e ia "diminuindo para dentro" da pista conforme se aproximava, e é daí que vinha a impressão de peça colada por cima dela. Na altura do carro nada mudou — ali a colisão foi calibrada contra o desenho, e um teste cobra que o tamanho continue o de antes.

As peças deitadas — buraco, óleo e poça — têm comprimento em metros ao longo da pista, e as duas bordas passam pela mesma projeção que desenha as faixas de doze metros do asfalto. É o que as deita: antes tinham proporção fixa entre altura e largura e, ao longe, ficavam de pé como discos. A perspectiva de verdade, porém, achata um buraco a cinquenta metros até um pixel e meio, e encostado na zebra ele sumia — o que não pode acontecer com a peça que fecha a beirada da pista. Então, dali em diante, o achatamento para em 14% e a peça fica um traço deitado que ainda se lê. `banca.html` mostra a mesma cena com as duas réguas, lado a lado.

Barreira e cone saem da folha, como o resto do cenário. Eram os últimos desenhos ao vivo de pé sobre o chão, e os únicos fora do banho de névoa da folha: em cor cheia, apareciam recortados de outra cena à medida que a pista escurecia. A barreira tem duas pinturas, de galões e de blocos, e a variante sai do identificador do obstáculo — que é literal em `track.ts`, então os dois pilotos veem a mesma barreira no mesmo lugar. Buraco, óleo e poça seguem procedurais, deitados no asfalto.

Medir o cone pixel a pixel revelou um defeito que era de todo o cenário, desde que a folha existe: as células estavam encostadas umas nas outras, e o `drawImage` de um objeto de perto, que amplia, lia meio texel além do retângulo pedido e trazia junto a primeira coluna da vizinha. Aparecia como um risco de cor estranha na borda de cada objeto. Hoje há dois pixels de folga em volta de cada célula. O empacotamento também passou a preencher a sobra de cada prateleira em vez de deixá-la vazia, e a folha — já com as duas famílias novas e a folga — caiu de 8,3 para 7,8 MB, e de 9 para 6,6 ms de assar.

**Óleo e poça** são o perfil oposto ao da barreira: largos (0,34 e 0,30 de meia-largura de colisão, contra 0,25) e baratos (40% e 30% da penalidade). Dá para atravessar de propósito em vez de jogar o carro na grama para desviar, que é a decisão que a barreira nunca oferece. A água da poça é o céu do lugar, então ela muda com a etapa sem saber que etapa é.

Onde eles cabem não foi escolha de gosto. O campo do profissional já estava saturado: 38 obstáculos em 4 800 m, um único vão maior que 150 m e 0,628 s de folga no desvio mais apertado, contra o piso de 0,5 s cobrado em `rules.test.ts`. Cortar um vão típico de 110 m ao meio exige que a peça nova fique a menos de 0,324 de faixa das **duas** vizinhas, que costumam estar a meia pista uma da outra. Sobraram três lugares que não tocam naquela folga — os 510 m de abertura, a fresta logo depois do primeiro obstáculo e o vão largo da reta final —, e entraram quatro manchas. Que três caiam nos primeiros 600 m é feliz por acidente: são as ameaças baratas do jogo, e a largada é onde o piloto aprende o que elas são sem pagar por isso.

### O carro na pista

A sombra do carro saiu da folha. A folha inteira inclina com o volante e é deslocada pela suspensão e pela trepidação, e a sombra assada ia junto — uma sombra que rola com a carroceria não é sombra, é adesivo. Desenhada ao vivo, ela fica no chão e reage só à altura: fecha e escurece quando o carro afunda, abre e clareia quando ele fica leve, no topo de uma lomba ou no quadro da batida. A sombra de cada pneu é a exceção, e vai atrás dele: neste desenho a rolagem gira o quadro inteiro, rodas inclusive, em torno da linha do chão, e a roda da frente está sessenta unidades acima desse pivô — no esterço máximo ela anda nove para o lado, e uma sombra parada ali ficava sozinha no asfalto.

Depois de uma passagem pela grama o carro fica sujo. A sujeira é o único sinal assimétrico de `feel.ts`: chega perto do máximo em menos de um segundo de grama e leva uns vinte segundos de asfalto para sair. São manchas de respingo, e não um véu sobre a carroceria — barro atirado por pneu tem borda, e um véu uniforme leria como o carro ter mudado de cor. As posições saem de onde o barro de cada eixo cai de fato, e um teste cobra que toda mancha fique sobre o carro: a primeira versão punha terra ao lado da roda dianteira, e num carro de roda descoberta ali só há braço de suspensão e ar.

A suspensão responde ao relevo — à **mudança** de inclinação, que é o que carrega o carro: o fundo de uma depressão comprime, a crista alivia. Jogar o volante depressa rola a carroceria um pouco além do ponto antes de ela assentar, e o carro no limite de aderência vibra, numa frequência mais alta e menor que a da grama e a da batida. Cada partícula passou a ter a própria cor e o próprio giro: a poeira sobe da cor do chão de cada lugar, e as faíscas giram em vez de saírem todas alinhadas à tela, como confete.

## Testes

```bash
npm test
```

A suíte cobre a física da corrida, a sequência das cinco luzes, a estimativa de relógio, a interpolação do fantasma, as regras das salas e testes de integração que sobem o servidor real e conectam dois clientes Socket.IO — inclusive medindo o erro do fantasma com pacotes atrasados e perdidos.

O contrato do repositório (`server/dados/repositorio.test.ts`) roda contra a memória sempre, e contra o Postgres quando `TEST_DATABASE_URL` aponta para um banco de teste — que é apagado a cada caso:

```bash
TEST_DATABASE_URL=postgres://corrida:corrida@localhost:5432/corrida_teste npm test
```

Três testes merecem destaque:

- **A prova cabe entre 60 e 90 segundos em qualquer semente e qualquer nível**,
  com a curva ativa e no ritmo de quem corrige só na borda do asfalto. Desde que
  o traçado é sorteado por corrida e a curva cobra tempo, é este teste que
  impede uma pista sorteada de estourar a janela do plano.
- **A curva desloca o carro de onde o piloto aponta**, medido pelo desvio médio
  em cinco sementes contra a mesma prova em pista reta. Não se mede isso pelo
  tempo: quem só segura o meio tem esterço sobrando e corrige quase de graça —
  a força cobra margem de comando, não segundos. Se este teste parar de valer, a
  curva voltou a ser enfeite.
- **O ritmo do fantasma na tela nunca passa da velocidade real do rival**, com
  rede boa, com pacotes fora de ordem e com perdas. A medição é em metros por
  segundo, e não metros por amostra, porque `setInterval` não entrega intervalos
  constantes — medir por amostra transformava atraso do temporizador em "salto
  do fantasma", e reprovava o teste em uma execução a cada três sem nada de
  errado com o fantasma.

O roteiro da apresentação é um teste de aceitação à parte, que percorre a demonstração inteira — dois pilotos na mesma sala, largada, corrida com a física real, fantasma, resultado e revanche:

```bash
npx vitest run server/demonstracao.test.ts
```

### Piloto virtual

Para testar o fantasma sem um segundo aparelho, entre em uma sala pelo navegador e rode:

```bash
npm run piloto -- CODIGO --nome Rival --velocidade 250 --carro schumacher
```

Ele entra na sala como mais um piloto, confirma presença, corre no ritmo pedido e envia telemetria pelo mesmo protocolo do navegador. Sem `--carro`, corre com a Red Bull, diferente do carro padrão do navegador, para o fantasma mostrar a pintura do rival. Para encher o grid, rode um por vaga, cada um com o próprio `--nome` e `--carro`.

Com `--parado`, ele entra e nunca confirma: é o celular esquecido na mesa, para testar o anfitrião tirando alguém do grid. Tirado, o piloto virtual se despede e encerra.

Com `--ranqueada` ou `--copa`, ele não entra em sala nenhuma: entra numa conta de teste e vai para a fila ranqueada, ou se inscreve na Copa do Dia. A conta de teste só vale num servidor subido com `CONTAS_DE_TESTE=1` — nunca o de produção. Nos dois casos corre com a física do jogo — o piloto de teste que usa tudo, ou um novato serpenteando com `--novato` —, porque ali o servidor só aceita a chegada que a telemetria sustenta. Na copa, `--abandona` desiste de cada rodada logo depois da largada, para testar a eliminação sem esperar a prova inteira.

## Controles

- `A` / `D` ou setas: direção — segurada para dentro da curva, carrega o mini-turbo
- `Espaço`: boost — no apagar das luzes, largada turbo; com carga guardada, solta o mini-turbo
- `Backspace`: recomeça o contrarrelógio na hora
- Celular: botões de direção e boost na tela
- **SOM** liga e desliga todo o áudio; **MÚSICA** liga e desliga só a trilha — na corrida e no lobby —, e as duas escolhas ficam guardadas na aba
- **RÁDIO ⏭** ou `R`: próxima faixa da Rádio Fantasma

### Motor

Cada carro tem a voz do motor da época dele, tocada por `src/game/motorF1.ts` a partir de laços em `public/audio/motor`, cortados de gravações de verdade:

| Voz | Carros | Câmbio | Gravação |
| --- | --- | --- | --- |
| Honda V6 turbo | Senna (McLaren) | 6 marchas, troca a 12.500 | McLaren-Honda MP4/4 (1988) |
| TAG V6 turbo | Senna (Lotus) | 5 marchas, troca a 11.400 | McLaren-TAG MP4/2C (1986) |
| Mercedes V10 | Schumacher | 7 marchas, troca a 18.300 | McLaren-Mercedes MP4-16 (2001) |
| Cosworth V10 | Barrichello (Ferrari) | 7 marchas, troca a 17.900 | Red Bull-Cosworth RB1 (2005) |
| Renault V10 | Alonso (Renault) | 6 marchas, troca a 16.600 | Williams-Renault FW18 (1996) |
| Ferrari V8 | Massa (Ferrari) | 7 marchas, troca a 17.800 | Ferrari F60 (2009) |
| Mercedes V8 | Barrichello (Brawn) | 7 marchas, troca a 17.800 | Brawn-Mercedes BGP 001 (2009) |
| Renault V8 | Vettel | 7 marchas, troca a 17.800 | Red Bull-Renault RB5 (2009) e RB8 (2012) |
| V6 turbo híbrido | os oito da era híbrida | 8 marchas, troca a 14.600 | passagens de F1 numa pista, em 2024 |

Quando não havia gravação da fábrica certa, entrou a da mesma época: a Lotus de 1985 ganha o V6 turbo TAG, e as duas Ferrari de V10 ficaram com vozes diferentes para não soarem iguais.

- **Como os laços foram cortados.** A rotação foi rastreada ao longo de cada gravação pela soma das ordens do motor — num quatro tempos, a explosão é a ordem 3 no V6, 4 no V8 e 5 no V10, e as ordens de meia volta aparecem em todos —, trecho a trecho, numa faixa estreita de rotação para não pular de oitava. Cada trecho de aceleração plena foi reamostrado com taxa variável até o motor girar em rotação constante; o volume foi achatado, para o carro passando perto do microfone não virar uma onda; os trechos de uma mesma camada foram equalizados até terem o mesmo timbre e emendados onde mais se parecem; e o fim de cada laço cruza com o começo num múltiplo exato do ciclo de duas voltas, por isso ele toca para sempre sem pulsar. Trechos com estalo de troca de marcha ou chiado de pneu ficaram de fora. Os scripts do corte estão em [`scripts/motor`](scripts/motor), e as gravações, em [`arte/motor`](arte/motor).
- **Como tocam.** Em cada instante soam as duas camadas vizinhas da rotação, cada uma esticada até ela e cruzadas com potência constante, numa escala logarítmica, que é como o ouvido mede altura; a camada que domina nunca é esticada mais de um quinto. Perdendo velocidade — batida, grama, reset —, a mistura passa para o laço sem carga, onde a gravação tem um, ou o motor abaixa.
- **Câmbio.** O cruzeiro cai sempre na penúltima marcha, a uns nove décimos da troca, e o boost puxa a última até o grito. As quedas são as de corrida — da primeira para a segunda o motor cai quase um terço, da última troca pouco mais de um décimo —, e a primeira troca nunca derruba o motor abaixo do giro da largada. Na troca, a ignição corta por 45 ms.
- **Sem depender do arquivo.** Enquanto os laços não chegam — ou se não chegarem —, toca o motor de osciladores de antes. O volume das amostras foi casado com o dele por medição, e as nove vozes ficam a menos de um decibel e meio umas das outras em cruzeiro. Só a voz do carro escolhido é baixada, entre 40 e 150 kB por laço, e tocá-la custa menos de 1% de um núcleo.

#### Créditos dos sons

Os laços são obras derivadas: trechos recortados, com a rotação normalizada, o volume achatado, o timbre equalizado e fechados em laço.

| Voz | Origem | Autor | Licença |
| --- | --- | --- | --- |
| Honda V6 turbo | [McLaren-Honda MP4/4 (1988) driven by Bruno Senna](https://commons.wikimedia.org/wiki/File:McLaren-Honda_MP4_4_(1988)_driven_by_Bruno_Senna.ogg) | Ed Pond (Edvvc), Wikimedia Commons | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| TAG V6 turbo | [McLaren-Tag MP4/2C (1986)](https://commons.wikimedia.org/wiki/File:McLaren-Tag_MP4_2C_(1986).ogg) | Ed Pond (Edvvc), Wikimedia Commons | CC BY-SA 3.0 |
| Cosworth V10 | [Red Bull-Cosworth RB1 (2005)](https://commons.wikimedia.org/wiki/File:Red_Bull-Cosworth_RB1_(2005).ogg) | Ed Pond (Edvvc), Wikimedia Commons | CC BY-SA 3.0 |
| Renault V10 | [Williams-Renault FW18 (1996)](https://commons.wikimedia.org/wiki/File:Williams-Renault_FW18_(1996).ogg) | Ed Pond (Edvvc), Wikimedia Commons | CC BY-SA 3.0 |
| Ferrari V8 | [Ferrari F60 (2009)](https://commons.wikimedia.org/wiki/File:Ferrari_F60_(2009).ogg) | Ed Pond (Edvvc), Wikimedia Commons | CC BY-SA 3.0 |
| Mercedes V8 | [Brawn-Mercedes BGP 001 (2009)](https://commons.wikimedia.org/wiki/File:Brawn-Mercedes_BGP_001_(2009).ogg) | Ed Pond (Edvvc), Wikimedia Commons | CC BY-SA 3.0 |
| Renault V8 | [Red Bull-Renault RB5 (2009)](https://commons.wikimedia.org/wiki/File:Red_Bull-Renault_RB5_(2009).ogg) e [F-1raceCar-IdleAndRaceStartDemo](https://freesound.org/people/Ears68/sounds/181187/) | Ed Pond (Edvvc), Wikimedia Commons; Ears68, Freesound | CC BY-SA 3.0; [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| V6 turbo híbrido | passagens do pacote [Racetrack Session](https://freesound.org/people/Geoff-Bremner-Audio/packs/41400/) | Geoff Bremner, Freesound | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Mercedes V10 | vídeo "MCLAREN Mercedes MP4-16 de Mika Hakkinen - F1 2001 no Assetto Corsa", do canal Super Danilo F1 - Sim Racing, no YouTube | Super Danilo F1 (som de simulador) | sem licença livre |

Os laços feitos de gravações CC BY-SA 3.0 ficam sob a mesma licença. O do Mercedes V10 é a exceção: a gravação é de terceiros e está em uso como referência no protótipo acadêmico; para publicar o jogo fora desse contexto, é preciso autorização ou trocar esses cinco laços por uma gravação de licença livre, cortada pelo mesmo método.

### Trilha sonora

A música da corrida é a **Rádio Fantasma** (`src/game/radio.ts`): cinco faixas, geradas na hora — sem arquivo nenhum —, tocando uma depois da outra com a vinheta da rádio entre elas. Cada uma guarda a composição como partitura, testada sem navegador, e a sintetiza pelo mesmo contexto de áudio do motor. O lobby toca a **Turbo**; na corrida, a semente do traçado escolhe a faixa que abre — rock ou Turbo —, então todos os pilotos da sala largam ouvindo a mesma. Dali em diante cada um anda na própria rádio, e pode pular de faixa quando quiser.

| Faixa | Estilo | Partitura |
| --- | --- | --- |
| Pé Embaixo | rock de corrida | `trilha.ts` |
| Motor Quente | hard rock de boogie | `trilhaMotorQuente.ts` |
| Turbo | synth de 16 bits | `trilhaTurbo.ts` |
| Última Volta | rock épico | `trilhaUltimaVolta.ts` |
| Largada Queimada | punk rock | `trilhaLargada.ts` |

A abertura e a segunda faixa são sempre de estilos diferentes: o rock e a Turbo ficam intercaladas com as outras. Só a faixa no ar existe no grafo de áudio — as outras nem são criadas —, e os amplificadores simulados nascem na primeira nota que os pede: uma banda parada ainda processaria silêncio a cada bloco. Todas saem da mesma banda (`src/game/banda.ts`), que lê a partitura de cada uma: bateria, baixo, guitarra base pesada ou de amplificador aberto, guitarra solo, violão de doze cordas, flauta e teclado.

**Rock** (`src/game/trilha.ts`):

- Mi menor, 150 batidas por minuto, em quatro seções de oito compassos: **estrofe** com a guitarra abafada em galope, **refrão** com acordes soltos e a guitarra solo por cima, **estrofe** de novo e **ponte** com o bumbo nos quatro tempos até a virada de caixa que devolve ao começo. São 51 segundos, e a trilha dá a volta.
- Bateria de seno e ruído filtrado, baixo em serra, power chords de seis serras desafinadas somadas antes de uma saturação e de uma caixa de som simulada, e a guitarra solo com vibrato e eco.

**Turbo** (`src/game/trilhaTurbo.ts`), o outro lado de Top Gear — o do chip do Super Nintendo. A composição é original; de Top Gear vem a receita:

- Lá maior, 160 batidas por minuto: **tema**, **refrão**, **tema** e **ponte**, oito compassos cada, 48 segundos. A ponte passa pelo sol natural, o sétimo grau abaixado que é o sotaque das trilhas de corrida da época, antes do mi que devolve ao tema.
- Baixo de onda quadrada pulando de oitava em semicolcheias, arpejo de chip por baixo, metais de serra com o filtro abrindo em cada ataque nos contratempos, e o lead de onda quadrada com vibrato e eco por cima.
- A mistura foi acertada por medição: cada instrumento renderizado sozinho, fora de tempo real, com a loudness do BS.1770. A faixa fica em −19 LUFS com pico de 0,62 no master, contra −17,5 LUFS e 0,58 da de rock — trocar de faixa não dá tombo de volume. As seis serras dos metais largam com 1,5 ms entre uma e outra: juntas, começavam em fase e somavam um estalo que era o pico da faixa.

**Motor Quente** (`src/game/trilhaMotorQuente.ts`), o rock de estrada dos anos setenta e oitenta. A composição é original; do gênero vem a receita:

- Lá, 132 batidas por minuto. Introdução com a guitarra sozinha, estrofe de doze compassos sobre o blues em lá, refrão de oito, solo de doze, refrão e um final com o acorde soando — um minuto e vinte e poucos.
- A guitarra de amplificador aberto toca o boogie de quinta, sexta e sétima sobre a corda solta; o baixo sobe e desce pelo acorde; o refrão bate acordes cheios, com as cordas soando uma depois da outra como numa palhetada; o solo corre a pentatônica com a nota de blues de passagem.

**Última Volta** (`src/game/trilhaUltimaVolta.ts`), o arco das grandes faixas de rock dos anos setenta — de novo, o arco, e não as notas nem a harmonia de música nenhuma:

- Lá menor, 144 batidas por minuto contadas em semicolcheias, que no começo soam como 72. **Abertura** de dezesseis compassos com violão de doze cordas dedilhando e a flauta entrando no quinto; **subida** de oito com a bateria em meio tempo e a guitarra batendo os acordes; **tempestade** de dezesseis no dobro do andamento — lá, sol, fá, sol — com o solo correndo; e o **final**, com o tema da flauta de volta na guitarra solo, uma oitava acima. Um minuto e vinte.
- A abertura acústica foi medida contra o motor: mais baixa, ela ficava catorze decibéis abaixo de um V10 em cruzeiro, e meio minuto de música não se ouvia. Agora fica sete abaixo da tempestade — calma, mas presente.

**Largada Queimada** (`src/game/trilhaLargada.ts`), punk rock rápido:

- Ré maior, 184 batidas por minuto. A caixa chama a banda, estrofe e refrão duas vezes, uma ponte parada em que a banda inteira bate junto e se cala, e o último refrão — pouco mais de um minuto.
- Na estrofe a palma abafa a guitarra fora do um e do três; ela só abre no refrão, e é esse contraste que faz o refrão explodir.

As três novas foram medidas como a Turbo: entre −17,4 e −18,0 LUFS, com pico abaixo de 0,8 no master, e cada uma custa cerca de 11% de um núcleo, o mesmo que o rock. As notas abafadas da guitarra leve usam uma serra por corda, e não o par desafinado do acorde aberto: ali o par só dobraria o custo sem se ouvir.

Em todas: a música entra no "VAI!" com o prato do primeiro compasso — online, a mesma largada em todos os aparelhos — e some aos poucos na bandeirada, sempre sob o motor, que é retorno de jogo. As notas são agendadas pouco adiante, no relógio do áudio, e não no de animação: a música não atrasa quando o quadro engasga. Renderizada fora de tempo real, a de rock inteira custa cerca de 8% de um núcleo de computador de mesa.

## O lobby

A sala comporta seis pilotos, e o lobby foi desenhado para o grid cheio:

- **Quem falta.** Um medidor de seis segmentos mostra quem está pronto, quem está no grid e quem perdeu o sinal, e a linha de estado diz pelo nome quem falta confirmar — com seis na sala, "aguardando todos" não diz nada.
- **Cada carro na sua cor.** Cada vaga ocupada traz a faixa da cor do carro, e a sua vem destacada. Quando falta espaço, a equipe é cortada antes do nome do piloto.
- **Convite na vaga livre.** A primeira vaga vazia tem o botão de convite, que copia o link da sala.
- **O anfitrião tira quem está parado.** A largada só sai com todos confirmados, e um celular esquecido na mesa segura a prova de cinco. O anfitrião pode tirar um piloto do grid — o primeiro toque pergunta, o segundo confirma —, menos com a largada marcada ou a prova em andamento. Quem é tirado volta ao menu com o aviso.
- **A largada não espera quem saiu.** Se quem faltava confirmar sai da sala, é tirado ou não volta dentro da janela de reconexão, e todos os que ficaram já confirmaram, a largada é marcada na hora.
- Em telas largas as vagas ficam em duas colunas e o lobby inteiro cabe em 1366 × 768; quando o painel estreita, as vagas passam a uma coluna.

## Como a largada é sincronizada

1. Cada cliente mede a diferença entre o próprio relógio e o do servidor com cinco amostras de ida e volta e fica com a de menor latência.
2. Quando todos os pilotos da sala — de dois a seis — confirmam, o servidor escolhe um instante futuro comum (`startAt`, 5,4 s à frente) e envia o mesmo valor para todos.
3. Cada cliente converte `startAt` em luzes: cinco acendem uma a uma, com 900 ms de intervalo, e todas apagam exatamente em `startAt`.
4. O cronômetro da corrida é contado a partir de `startAt`, e não do quadro em que a tela abriu, então todos medem o mesmo tempo.

## Como o fantasma funciona

Cada navegador envia dez medições por segundo (progresso, faixa, velocidade, estado e se está de boost). O servidor valida — recusa pacotes atrasados, corrige horários incoerentes e limita avanços impossíveis — e repassa aos outros pilotos da sala. Cada conexão só fala pelo próprio piloto: o servidor a amarra a ele quando ela cria ou entra na sala, e recusa telemetria, chegada ou confirmação em nome de outro.

Quem recebe desenha cada rival **no presente**. A medição mais nova já chega velha — a rede leva dezenas de milissegundos —, então a posição é projetada até agora, na velocidade da medição e com a aceleração que as últimas mostram. Desenhado 160 ms no passado, como era antes, o rival ficava uns 11 m atrás de onde estava de fato: dois carros lado a lado viam cada um o outro atrás, os dois se achando em primeiro, e o vácuo caía no lugar errado. Com a rede lenta, 120 ms a mais por pacote, o fantasma continua a menos de 4 m do carro de verdade (o teste de ponta a ponta mede isso).

Quando uma medição nova corrige a projeção, a diferença é absorvida em pouco mais de um décimo de segundo, com um teto de ritmo — parece o rival acelerando, e não o carro saltando —, e o fantasma nunca anda para trás. Uma diferença grande demais, a de quem volta de uma queda, reposiciona o carro de uma vez. Sem notícias por 0,9 s, o fantasma congela e é marcado sem sinal. A aba em segundo plano, que congela a física, manda velocidade zero: o fantasma para na tela dos rivais, em vez de seguir andando e depois esperar o carro alcançá-lo.

Na tela, cada fantasma:

- **aparece na profundidade certa.** O carro de quem mandou a telemetria fica um pouco à frente da câmera dele, como o nosso: um rival lado a lado aparece ao lado, e quem vem colado atrás ainda aparece, por cima do nosso carro. Antes, os dois sumiam.
- **fica legível de longe.** A transparência cai com a distância, para o carro não se perder na bruma, e sobe de novo quando ele fica sem sinal.
- **tem o peso que merece.** Com seis na pista, o rival mais próximo à vista — o da disputa naquele trecho — e o fantasma do recorde ficam mais opacos; os demais, a meia opacidade, presentes sem roubar a atenção.
- **diz quem é.** Uma etiqueta na cor do carro leva a posição e o nome, "P2 SCHUMI" — o nome só nos dois mais próximos e no recorde; os outros levam só a posição, que a classificação ao lado traduz. Num pelotão, as etiquetas sobem em degraus sobre os carros, em vez de se empilhar num ponto só.
- **mostra o boost.** De boost — o apertado, ou o impulso da largada e do mini-turbo —, o fantasma acende a mesma chama do nosso carro, e a etiqueta ganha um contorno ciano. O painel do rival mais próximo diz "DE BOOST", e a barra dele na classificação acende. Na arquibancada, a chama, o rastro e o som seguem o boost de quem a câmera acompanha.
- **avisa quando vem atrás.** Fora da vista da câmera, o rival vira seta no radar, logo abaixo do nosso carro, na coluna em que vem, com o nome e a distância.

A classificação ao vivo, à esquerda, lista os seis com a diferença em segundos para quem se está olhando e "CHEGOU" para quem já cruzou a linha; a barra de progresso traz a marca de cada um, na cor do carro.

O rival não tem colisão: os carros se atravessam. Mas ele não é só desenho — a posição dele entra na simulação por um caminho só, e estreito: a força do vácuo, um número de 0 a 1 calculado da distância e do alinhamento. É isso que `stepRace` recebe dos rivais — o melhor vácuo entre todos —, e nada mais. Ele não pode empurrar, frear nem desviar o carro do jogador; só permitir que quem vem atrás ande um pouco mais rápido.

## Arquibancada

Uma sala tem seis vagas no grid e, fora delas, até trinta lugares na arquibancada. Quem assiste não ocupa vaga, não confirma, não corre, não entra no resultado e não fala por piloto nenhum; recebe a mesma sala, a mesma largada, a telemetria de todos e o resultado oficial.

- **Entrar.** No menu, o código da sala e "SÓ ASSISTIR, SEM OCUPAR VAGA" — com o grid cheio ou com a prova em andamento. O lobby tem um "LINK PARA ASSISTIR", `?room=CODIGO&assistir=1`, que abre direto na arquibancada: é o do telão do evento. Quem chega no meio da prova recebe o instante oficial e a última posição de cada piloto, e a corrida aparece inteira na hora.
- **Assistir.** A câmera segue o líder de quem ainda corre, e só troca quando o novo líder se firma na frente — dois carros lado a lado não fazem a imagem pular. As setas do painel, A e D, ou um toque numa linha da classificação escolhem outro piloto; o L volta para o líder. O carro seguido aparece inteiro, e os outros cinco como fantasmas, com as etiquetas.
- **Trocar de lugar.** Do lobby, quem assiste desce para o grid quando abre uma vaga; quem pilota sobe para assistir enquanto a largada não foi marcada, e a vaga dele abre para outro.
- **Não atrapalhar.** A saída ou a queda de um espectador não mexe na contagem nem na prova, e a sala segue aberta enquanto houver alguém na arquibancada. Os pilotos veem quantos assistem.

## Quem decide o vencedor

O cliente avisa a própria chegada, mas quem decide é o servidor. Ele conhece o instante oficial da largada e o comprimento da pista, então prende o tempo informado entre o mínimo fisicamente possível — a pista inteira na velocidade máxima do carro — e o tempo já decorrido desde a largada. Um relógio errado ou um cliente adulterado não conseguem reivindicar uma volta impossível.

Quando todos os pilotos têm um desfecho, o servidor monta o resultado uma única vez e envia o mesmo objeto para todas as telas: vencedor, tempos, diferença e posições. Num duelo, quem cai e não volta dentro da janela de retorno entrega a vitória por abandono; com três ou mais, os outros seguem correndo e o abandono ocupa a posição dele no resultado.

A revanche precisa do pedido de todos. Com eles, a sala limpa telemetria e resultado e agenda uma nova largada sincronizada, sem ninguém recarregar a página. Com a corrida em andamento, a sala não aceita piloto novo.

## Estado atual

- [x] Fluxo menu → largada → corrida → resultado → nova tentativa
- [x] Pista pseudo-3D e aceleração automática
- [x] Super curvas de 90° a 270° e S emendado, com nota de curva, tangência no ápice, muro de pneus e câmera no referencial do carro
- [x] Curvas calibradas pela regra de Top Gear: quem segura o volante faz a curva; de boost, ela joga o carro para fora
- [x] Reset depois de três batidas ou de tempo demais fora da pista
- [x] Controles por teclado e toque
- [x] Limites da pista, obstáculos e penalidades
- [x] Boost com consumo, recarga e bloqueio ao esgotar
- [x] Cronômetro, velocidade e progresso
- [x] Cinco luzes de largada e áudio procedural básico
- [x] Poeira, faíscas, rastro de boost e marcas de pneu, com teto de partículas
- [x] Cenário assado em folha de sprites, com quatro lugares, pórticos e faixa de meio-campo
- [x] Cinco tipos de obstáculo, dois deles manchas que valem a pena atravessar
- [x] Sombra no chão, terra da grama e suspensão que responde ao relevo
- [x] Salas de dois a seis pilotos com código, link e QR code
- [x] Lobby em tempo real, confirmação e tratamento de sala cheia/inexistente
- [x] Lobby de seis: medidor de prontos, quem falta confirmar pelo nome, convite na vaga livre e anfitrião tirando piloto parado
- [x] Relógio sincronizado entre cliente e servidor
- [x] Largada agendada e idêntica em todos os aparelhos
- [x] Cancelamento da largada por desistência, saída ou queda de conexão
- [x] Reconexão curta e retorno após recarregar a página
- [x] Telemetria validada pelo servidor e repassada aos outros pilotos
- [x] Um fantasma por rival, projetado até o presente, translúcido, em cor distinta e na ordem de profundidade da pista
- [x] Fantasma legível com seis na pista: etiqueta com posição e nome, rival lado a lado visível, radar de quem vem atrás
- [x] Posição no grid, classificação ao vivo dos seis, marcas na barra de progresso, diferença para o rival mais perto e indicador de rival fora da tela
- [x] Arquibancada: até trinta espectadores por sala, fora das vagas, com câmera no líder ou em quem se escolher
- [x] Chegada validada pelo servidor, com tempo impossível recusado
- [x] Mesmo vencedor, tempos e diferença em todas as telas
- [x] Vitória por abandono no duelo; com mais pilotos, o abandono entra na classificação
- [x] Revanche na mesma sala, sem recarregar a página
- [x] Publicação em processo único, com Dockerfile e endereços da rede local
- [x] Sala de demonstração que se cria sozinha
- [x] Fontes servidas pelo projeto, sem depender de internet
- [x] Garagem com dezesseis carros em arte própria, agrupados por piloto: a escolha vale no treino e online, e cada fantasma usa a pintura do rival
- [x] Quadros de curva e de derrapagem com contraesterço, assados da arte de cada carro, com transição guiada pela física da curva
- [x] Trilha sonora de rock procedural, com botão próprio
- [x] Nove vozes de motor gravadas — V6 turbo, V10, V8 e V6 híbrido —, uma por época de carro, com o câmbio de cada uma e o motor de osciladores de reserva
- [x] Rádio Fantasma: cinco faixas originais, vinheta entre elas e troca de faixa por botão ou tecla
- [x] Segunda faixa, synth de 16 bits no molde de Top Gear: toca no lobby e alterna com o rock nas corridas
- [x] QR code definitivo e roteiro do workshop
- [x] Contas com e-mail e senha no Supabase Auth, e o convidado correndo sem conta
- [x] Ranking mundial de melhor tempo no Circuito Oficial, com a Pista do Dia e a escada da ranqueada ao lado
- [x] Perfil do piloto com estatísticas, aberto pelo próprio piloto ou pelo nome num ranking
- [x] Perfis, tempos, ranqueada e estatísticas no Postgres do Supabase

## Limitações conhecidas

- Em uma aba fora de primeiro plano o navegador pausa a animação: o relógio da corrida continua correto, mas o carro não anda enquanto a aba estiver escondida. A telemetria continua sendo enviada por temporizador, então o rival vê o fantasma parado na posição real, em vez de perdê-lo de vista.
