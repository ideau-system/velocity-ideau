# Pesquisa: como tornar a Corrida Fantasma ultra competitiva

*Setembro de 2026.* A base pedida foi Top Gear (SNES), Horizon Chase, Mario Kart e a ranqueada do League of Legends. Para cobrir o que esses quatro não respondem, a pesquisa também estudou:

- **outros jogos de corrida:** Trackmania, F-Zero 99, Gran Turismo, iRacing, Forza, Burnout, Crash Team Racing e Wipeout;
- **outros jogos:** Spelunky;
- **os algoritmos de rating** usados em partidas com vários jogadores.

Como ler:
- Cada afirmação traz o link da fonte.
- **(não confirmado)** marca dado visto só em trecho de busca ou em fonte fraca.
- *Cálculo nosso* marca conta feita durante a pesquisa, e não publicada pela fonte.
- As seções 1 a 8 são o que se aprendeu.
- A seção 9 traz o quadro de copiar e evitar.
- A seção 10 é a especificação para este jogo.
- A seção 11 lista as lacunas.

---

## Resumo

1. **O maior risco de um jogo com aceleração automática é o jogador sentir que não faz nada.** É a crítica mais dura ao Top Gear relançado em 2024 ([WayTooManyGames](https://waytoomany.games/2024/03/04/review-top-racer-collection/)). A profundidade precisa vir de decisões que dá para medir: a linha, o momento do boost, a carga de curva e a largada.
2. **Com dois comandos, a profundidade vem de quatro receitas:**
   - um recurso com dois usos concorrentes (F-Zero, Wipeout);
   - uma recompensa que cresce com o risco (Burnout, CTR);
   - uma carga por tempo cuja taxa depende da linha (o mini-turbo do Mario Kart);
   - um encadeamento visível (CTR).
3. **A física tem de ser igual para todos.** Atributos de carro acabam em uma escolha obrigatória: no Top Gear o Cannibal vence por uns 11 s por corrida, e o MK8DX tem um meta de poucas combinações. O Mario Kart World igualou os limiares de mini-turbo para todos.
4. **Rubber banding não.** Foi a crítica nº 1 do Horizon Chase Turbo. Contra humanos, o único catch-up aceitável é o que exige habilidade, como o vácuo.
5. **Itens não entram na ranqueada.** No MK8DX com itens, cerca de 61% da variância de colocação é sorte ([Roman's Attic](https://romansattic.substack.com/p/luck-causes-61-of-rank-variance-in)).
6. **Só dá para comparar tempos com seed compartilhada.** Para isso, uma Pista do Dia (como o Spelunky Daily e a Track of the Day do Trackmania) e um pool semanal de seeds para a ranqueada (como a campanha do Trackmania).
7. **Rating:** o OpenSkill com o modelo Bradley-Terry completo (licença MIT, TypeScript) é o melhor custo-benefício para salas de 2 a 6 pilotos. Cada corrida de 6 vira 15 duelos.
8. **Ranqueada no molde da Riot de 2025–2026:**
   - MMR oculto, e pontos visíveis que convergem para ele com limite;
   - sem série de promoção;
   - colocação sem perda;
   - proteção só na queda de tier;
   - reset raro;
   - recompensas só cosméticas;
   - uma fila só.
9. **Integridade.** O servidor já usa o relógio de parede, então câmera lenta não rende. Faltam três coisas:
   - ligar a identidade ao socket;
   - apertar o teto de velocidade e o piso de tempo;
   - re-simular os melhores tempos.
   
   O caso Riolu no Trackmania mostra que validar só o tempo final não basta.
10. **Com pouca gente jogando,** três saídas:
    - concentrar jogadores em horários;
    - completar salas com fantasmas gravados de rating congelado;
    - oferecer desafios assíncronos.

---

## 1. Top Gear (SNES, Gremlin/Kemco, 1992–1995)

### 1.1 Mecânicas do primeiro jogo

- **Nitro: 3 por corrida** ([Wikipedia](https://en.wikipedia.org/wiki/Top_Gear_(video_game))).
  - O bom jogador guarda o nitro para a reta final ([MoeGamer](https://moegamer.net/2018/02/23/snes-essentials-top-gear/)).
  - E evita gastá-lo no meio de uma sequência de curvas ([The Pixel Empire](https://www.thepixelempire.net/top-gear-snes-review.html)).
- **Combustível e pit stop.** Ficar sem combustível encerra a corrida, e o pit custa tempo ([Wikipedia](https://en.wikipedia.org/wiki/Top_Gear_(video_game))).
  - Quanto combustível pôr é uma aposta que decide posições.
  - O carro econômico ganha tempo porque para menos ([Pixel Empire](https://www.thepixelempire.net/top-gear-snes-review.html)).
- **Os 4 carros** ([Codex Gamicus](https://gamicus.fandom.com/wiki/Top_Gear), não confirmado):

  | Carro | Máxima | 0–60 mph | Aderência | Consumo |
  |---|---|---|---|---|
  | Cannibal | 237 km/h | 5,9 s | baixa | alto |
  | Razor | 220 km/h | 5,0 s | baixa | médio |
  | Weasel | 220 km/h | 4,3 s | média | médio |
  | Sidewinder | 211 km/h | 3,5 s | alta | baixo |

- **Câmbio automático ou manual,** com L e R. No Top Gear 2, o manual acelera mais porque as marchas baixas rendem mais ([guia speedrun.com](https://www.speedrun.com/top_gear_2/guides/u2p2d), não confirmado). No Top Gear 1 os relatos se contradizem.
- **Soltar o acelerador perde velocidade mais devagar que frear.** Os carros transferem impulso quando se tocam ([TASVideos 6148S](https://tasvideos.org/6148S)).

### 1.2 Estrutura e IA

- **Estrutura:** 32 pistas em 8 países, com Rio de Janeiro e Amazônia entre elas. Grid de 20 carros, e é preciso terminar no top 5 para seguir ([Wikipedia](https://en.wikipedia.org/wiki/Top_Gear_(video_game)), [Destrutor](https://destrutor.com.br/top-gear-o-game-de-corrida-topzera-dos-brasileiros/)).
- **Pontos:** vão até o 10º lugar, mas não mudam a progressão. Os críticos apontaram isso como falha ([Pixel Empire](https://www.thepixelempire.net/top-gear-snes-review.html)).
- **IA:** só o rival "Computer" adapta a velocidade ao desempenho do jogador. O resto do grid termina em tempos fixos ([Vizzed](http://www.vizzed.com/games/top-gear-snes-super-nintendo-8727-cheats-codes)). Com isso o jogo tem um nêmesis e mesmo assim não estraga a leitura do ritmo do pelotão.

### 1.3 O que Top Gear 2 e 3000 acrescentaram

| Jogo | O que entrou | Como foi recebido |
|---|---|---|
| **Top Gear 2** | 64 pistas; 6 nitros; top 10 para seguir; upgrades comprados (motor, câmbio, pneus, nitro, blindagem); dano por setor; clima com escolha de pneu ([Wikipedia](https://en.wikipedia.org/wiki/Top_Gear_2)) | "mais difícil e menos arcade" ([TASVideos 665G](https://tasvideos.org/665G)) |
| **Top Gear 3000** | itens que só afetam o próprio carro (pulo, warp, atrator, boost); 4 jogadores; bônus secretos por corrida limpa: usar boost, não bater em carro, desviar dos obstáculos, ficar na pista ([Wikipedia](https://en.wikipedia.org/wiki/Top_Gear_3000), [Freezenet](https://www.freezenet.ca/review-top-gear-3000-snes/)) | armas vistas como pouco importantes; IA que ignora combustível e barreiras |

**Leitura:**
- Upgrades e economia alongaram a campanha, mas não melhoraram o duelo.
- A adição mais elegante é a escolha de pneu conforme o clima: uma decisão binária e legível antes da largada.

### 1.4 Tela dividida permanente

- No Top Gear 1 a tela é sempre dividida, até contra a CPU. O rival fica visível o tempo todo.
- Hoje isso é criticado pela área de jogo pequena ([WayTooManyGames](https://waytoomany.games/2024/03/04/review-top-racer-collection/)).
- O que valia era **saber onde o rival está e o que ele está fazendo**. Um painel pequeno entrega isso sem gastar meia tela.

### 1.5 O que separa o expert do iniciante

- **Recordes do Top Gear 1** ([API speedrun.com](https://www.speedrun.com/api/v1/games/w6j37xdj/records?top=1&embed=players)): Cannibal 1:19:26 contra Sidewinder 1:25:19 nas 32 corridas. *Cálculo nosso:* cerca de 11 s por corrida a favor do carro mais rápido.
- **Técnicas do Top Gear 2** ([TASVideos 7144S](https://tasvideos.org/7144S)):
  - nitro nas descidas;
  - pular marchas;
  - *turn throttling*: toques de direção a cada 3 quadros, que anulam o deslize e dão vantagem a quem tem controle digital e mão rápida.
- **Glitch de parede do Top Gear 2:** a corrida "termina" ao encostar na parede de um jeito específico ([TASVideos 6017S](https://tasvideos.org/6017S)). É um alerta para validar o percurso, e não só a chegada.
- **Cena brasileira:** vários recordistas do Top Gear 2 em 2024–2025 são brasileiros ([API speedrun.com](https://www.speedrun.com/api/v1/games/j1ljn4dg/records?top=1&embed=players)).

### 1.6 Por que ficou na memória

- **Velocidade legível.**
- **Pista em que não dá para se perder** ([MoeGamer](https://moegamer.net/2018/02/23/snes-essentials-top-gear/)).
- **Melodias fortes:** Barry Leitch, que depois compôs para Horizon Chase ([Nintendo Blast](https://www.nintendoblast.com.br/2021/03/entrevista-barry-leitch-top-gear-horizon-chase.html)).
- **Poucas decisões, mas pesadas:** nitro e combustível.

O que envelheceu mal:
- framerate e tela pequena;
- a sensação de pouco input.

---

## 2. Horizon Chase (Aquiris, Porto Alegre, 2015, 2018 e 2022)

### 2.1 Intenção de design (post-mortem de Felipe Dal Molin, 2015)

Fonte: [Game Developer](https://www.gamedeveloper.com/design/making-a-new-game-from-an-old-genre-with-horizon-chase), [Tumblr](https://horizonchase.tumblr.com/post/128722385386/devteam-interview-ep-6-game-design-post-mortem).

- **Sem freio.** Frear e soltar o acelerador confundiam a sensação de arcade, então a velocidade é gerida num input só.
- **Curvas de arco com raio constante,** e não Bézier. A força da curva fica constante do começo ao fim, e é isso que faz a curva se aprender.
- **Input Filter.** Média do input numa janela curta de tempo. Dá peso ao carro sem tirar resposta. É a razão de o toque binário (esquerda/direita) funcionar bem.
- **Auto-steer leve.** O carro gira um pouco sozinho na direção da estrada.
- **Câmera como feedback.** Zoom no nitro, deslocamento e inclinação em alta velocidade.
- **Fora de propósito:** drift, saltos, vácuo, itens e armas.
- **Os carros** precisam ser reconhecíveis a 200 mph pela cor e pela silhueta ([GamingBolt](https://gamingbolt.com/horizon-chase-turbo-interview-recovering-the-retro-arcade-racer)).
- **Corridas de até 3 minutos no mobile.** O jogador enfrenta os próprios tempos desde o tutorial ([PopOptiq](https://www.popoptiq.com/interview-ios-game-horizon-chase-developer-aquiris/)).

### 2.2 Mecânicas do Turbo

- **Combustível:** galões espalhados pela pista criam rota, mas espantavam os casuais. Os próprios desenvolvedores reconheceram isso ([Steam](https://steamcommunity.com/app/389140/discussions/0/1652169858549719830/)), e o Horizon Chase 2 removeu o combustível ([TheSixthAxis](https://www.thesixthaxis.com/2024/06/27/horizon-chase-2-review/)).
- **Moedas:** pegar todas dá um boost e conta para o "super troféu", que pede 1º lugar, todas as moedas e tanque cheio ([PSNProfiles](https://psnprofiles.com/guide/8513-horizon-chase-turbo-trophy-guide), não confirmado).
- **Upgrades globais:** melhoram todos os carros ao mesmo tempo, por desafio de região.

### 2.3 IA e o "paradoxo da medalha"

- **O rubber banding é a crítica nº 1 da comunidade** ([Steam](https://steamcommunity.com/app/389140/discussions/0/1652169858549790069/)):
  - os líderes ficam a uma distância quase fixa;
  - guardar todos os nitros para a última volta rende mais do que espalhá-los;
  - uma corrida de 3 min deu ouro, e um replay mais rápido, de 2 min, deu prata.
- **Horizon Chase 2:** o rubber banding ficou bem menos visível ([WayTooManyGames](https://waytoomany.games/2023/09/19/review-horizon-chase-2/)).

### 2.4 Playground: competição assíncrona

- **Temporadas de duas semanas,** cada uma com 5 pistas e regras alteradas: contra o relógio, nitro infinito, espelhada, carro restrito e clima.
- **Ranking global e de amigos,** que zera a cada temporada ([Fandom](https://horizonchase.fandom.com/wiki/Playground), [LGC](https://linuxgameconsortium.com/horizon-chase-turbo-new-playground-mode/)).
- **Playground 2.0 (2019):** moedas trocáveis por skins e rankings top 50 ([Worthplaying](https://worthplaying.com/article/2019/5/16/news/114329-horizon-chase-turbo-all-celebrates-1st-anniversary-with-playground-mode-20-skins-and-more/)).
- **Fim:** o modo acabou em março de 2022.

### 2.5 Horizon Chase 2 online

- **Crews de até 4, Playground com matchmaking e cross-play** ([FAQ Epic](https://www.epicgames.com/help/en-US/c-Horizon_Chase_2/c-HorizonChase2_General_Support/horizon-chase-2-general-faq-a000090896)).
- **Salas completadas com IA,** porque raramente há humanos disponíveis (review citada nos resultados de busca, não confirmado).
- **Não há ranqueada.** A crítica preferiu o multiplayer local ao online ([TheSixthAxis](https://www.thesixthaxis.com/2024/06/27/horizon-chase-2-review/)).
- **Delisting:** Horizon Chase 1 e Turbo saíram das lojas em 01/06/2026, depois das demissões na Epic ([GamingOnLinux](https://www.gamingonlinux.com/2026/03/horizon-chase-turbo-is-getting-delisted-after-the-epic-games-layoffs/)). É um lembrete para ter backend próprio.

---

## 3. Mario Kart: pilotagem, sem itens

### 3.1 Mini-turbo: carga por tempo, com a taxa dependendo da mira

Fonte: [Mario Wiki: Mini-Turbo](https://www.mariowiki.com/Mini-Turbo), [VikeMK](https://vikemk.com/drifting-guide).

- **Mario Kart Wii e 8:** o contador sobe **5 unidades por quadro** quando o direcional aponta para dentro com força, e **2** nos outros casos. É 2,5× mais rápido para quem mira a curva.
- **Limiares no Mario Kart 8:** faíscas azuis em 135, Mini-Turbo em 270, Super em 570.
- **MK8DX:** a mira ideal fica acima de cerca de 45,5° no direcional.
- **Durações no MK8DX:** Mini 0,621 s, Super 1,674 s, Ultra 2,633 s. *Cálculo nosso:* a proporção é 1 : 2,7 : 4,2. O prêmio cresce mais depressa que o custo, então vale segurar a carga pela curva inteira.
- **Snaking:** no DS e no Double Dash, o jogador encadeava mini-turbos zigue-zagueando nas retas. A série acabou com isso passando a carga para o tempo, em vez de depender de balançar o direcional ([Mario Wiki: Snaking](https://www.mariowiki.com/Snaking)).
- **Mario Kart World:** as faíscas arco-íris ganham um "pulso" quando a carga está pronta, e os limiares são **iguais para todas as combinações**.
- **Feedback em camadas no MK8** ([Basberg](https://gd.basberg.com/2022/09/26/inspiration-mario-kart/)):
  - uma "explosão" a 1,13 s marca que o Mini está pronto;
  - as faíscas ficam douradas a 2,13 s;
  - o pneu guincha.

### 3.2 Largada, vácuo e moedas

- **Largada turbo:** existe em todos os jogos, com a janela presa à contagem. Acertar dá de 0,5 a 2 s de turbo, conforme a precisão. Apertar cedo "afoga" o motor ([Mario Wiki: Rocket Start](https://www.mariowiki.com/Rocket_Start)).
- **Vácuo:** ficar atrás de alguém por um tempo rende um turbo curto ([Mario Wiki: Slipstream](https://www.mariowiki.com/Slipstream)).
- **Moedas no MK8DX:** 10 moedas dão cerca de +6,25% de velocidade máxima (*cálculo nosso* sobre a tabela de [estatísticas](https://www.mariowiki.com/Mario_Kart_8_Deluxe_in-game_statistics)).
- **Moedas no MKW:** o teto sobe para 20, com curva de ganho ([GameSpot](https://www.gamespot.com/articles/mario-kart-world-coins-dont-function-as-youd-expect-new-evidence-suggests/1100-6532471/)).
- **Truques que a Nintendo desmontou:** fire hopping (MK8 → MK8DX), snaking, e o salto carregado do World, que em reta **deixa o carro mais lento** ([Kotaku](https://kotaku.com/mario-kart-world-charge-jump-speed-boost-too-slow-1851785905)). O princípio: nenhuma sequência de inputs em reta pode vencer quem dirige limpo.

### 3.3 Atributos e meta

- **MK8DX:** o meta competitivo converge para poucas combinações que favorecem o mini-turbo. O balanceamento vira patches sem fim, com ajustes de ±0,25 ([histórico de atualizações](https://www.mariowiki.com/Mario_Kart_8_Deluxe_update_history)).
- **Mario Kart World:** simplificou para quatro atributos visíveis e tirou o atributo de mini-turbo ([Dexerto](https://www.dexerto.com/wikis/mario-kart-world/mario-kart-world-character-stats-explained/)).

### 3.4 Contrarrelógio e fantasmas

- **Degraus de fantasma:** staff ghost, depois especialista ou 200cc, depois o recorde mundial ([Mario Wiki: Ghost](https://www.mariowiki.com/Ghost_(Mario_Kart_series))).
- **O fantasma ensina sem texto:** mostra linha, ponto de drift e ponto de soltura.
- **Recordes exigem prova:** fantasma ou transmissão ao vivo. Pause buffering e controle turbo são proibidos ([mkwrs.com](https://mkwrs.com/)).

### 3.5 Assistência que corta o teto

- **MK8DX:** o Smart Steering impede o Ultra Mini-Turbo, e uma antena visível no kart denuncia a assistência. Os torneios podem proibi-la ([Mario Wiki: Smart Steering](https://www.mariowiki.com/Smart_Steering)).
- **Mario Kart World:** a assistência limita o mini-turbo ao 2º nível. O auto-acelerar existe como opção ([Kotaku](https://kotaku.com/mario-kart-world-smart-steering-auto-acceleration-work-1851784842)).

---

## 4. Mario Kart: itens, catch-up, rating e cena competitiva

### 4.1 Distribuição de itens

- **MK8 e MK8DX:** a tabela depende da **distância até o líder**, e o 1º lugar nunca recebe Casco Azul ([Mario Wiki](https://www.mariowiki.com/Mario_Kart_8_item_probability_distributions)).
- **Mario Kart World:** voltou a distribuir por **posição**, com 24 corredores. Como fica fácil receber item forte sem estar longe da frente, surgiu o **sandbagging**, que é evitar a liderança de propósito ([NintendoSoup](https://nintendosoup.com/in-depth-analysis-reveals-how-mario-kart-worlds-item-system-works/), [TheGamer](https://www.thegamer.com/mario-kart-world-players-avoiding-first-place-sandbagging/)).
- **"Custom Items" no MKW 1.4.0:** a sala escolhe quais itens valem ([histórico](https://www.mariowiki.com/Mario_Kart_World_update_history)).
- **Casco Azul:** Konno o queria para manter todos no páreo até o fim. A Nintendo testou removê-lo e sentiu falta ([Wikipedia](https://en.wikipedia.org/wiki/Blue_shell)).

### 4.2 Variância

- **Estudo com o MK8DX** (48 corridas no 200cc, todos os itens, 11 CPUs):
  - cerca de **39%** da variância de colocação vem do piloto, e **61%** é sorte;
  - para ter 90% de confiabilidade no ranking são precisas cerca de 20 corridas ([Roman's Attic](https://romansattic.substack.com/p/luck-causes-61-of-rank-variance-in)).
- **Como a comunidade compensa:** com volume. Cada evento da Lounge tem 12 corridas, e o evento oficial de 2026 teve 16.

### 4.3 Rating oficial (VR)

- **Mario Kart Wii:** Elo por pares. Cada par de pilotos é um duelo, pontuado por uma B-spline da diferença de rating. Quem desconecta perde para todos ([MKWiiki](https://mkwiiki.org/wiki/Versus_Rating)).
- **MK8, 2014:** uma mudança silenciosa tornou os ganhos e as perdas bruscos, e gerou revolta ([Kotaku](https://kotaku.com/the-small-weird-way-nintendo-changed-mario-kart-8-s-on-1636504429)).
- **Mario Kart World:** jogadores perdendo VR mesmo vencendo, sem explicação ([GameRant](https://gamerant.com/mario-kart-world-losing-vr-points-after-winning/)). Na versão 1.8.0, o delta passou a variar com o comprimento da pista.
- **Mario Kart Tour:** grupos de 20 com tiers semanais de promoção e rebaixamento ([Mario Wiki](https://www.mariowiki.com/This_Week%27s_Ranking)).

### 4.4 Lounge do MK8DX (comunidade)

- **Fórmula** ([código da calculadora](https://raw.githubusercontent.com/VikeMK/Lounge-MMR-Calculator/master/index.html)):
  - `Δ = cap / (1 + 11^(−(Rperdedor − Rvencedor − offset)/sf))`, com `offset/sf = log₁₁(2)`;
  - por isso, vencer alguém de MMR igual vale exatamente `cap/3` (FFA: cap 60, então +20).
- **FFA de 12, todos iguais** (*cálculo nosso*): o 1º ganha +220 e o 12º perde −220, em passos de 40.
- **Regras** ([ruleset](https://docs.google.com/document/u/0/d/e/2PACX-1vQSfo4pVT4e0HTdJ-djk8OAwVIFoR3nrVpIcx7nW2K-mv0Y4wA9qLZo4sXB09egguOONnqC8n22b1_c/pub?pli=1)):
  - 18 ranks, de Iron a Grandmaster;
  - placement de 500 a 4500, conforme o primeiro evento;
  - penalidades fixas: −50 por atraso e −100 por sair antes da corrida 1;
  - strikes que expiram em 30 dias;
  - tiers de sala por rank.

### 4.5 Pontuação por estilo (Mario Kart Tour)

- **Como pontua:** pontos de ação (mini-turbo, vácuo, acertos) somados aos de posição. As ações podem valer mais que a posição ([Mario Wiki](https://www.mariowiki.com/Mario_Kart_Tour_race_points_system)).
- **Efeito:** bom para desafio diário, mas no ranking desvia o incentivo de chegar primeiro.

---

## 5. League of Legends e as ranqueadas "todos contra todos" da Riot

### 5.1 LoL Solo/Duo em 2026

- **Estrutura:** Iron a Diamond têm divisões IV–I com 0–100 LP. Master, Grandmaster e Challenger formam uma escada aberta.
- **Emerald (2023):** entrou porque mais de 60% dos jogadores estavam em Bronze e Silver ([Riot, 2023](https://www.leagueoflegends.com/en-us/news/game-updates/what-s-next-for-ranked/)).
- **Colocação:** 5 partidas; perder numa delas dá 0 LP; ninguém é colocado acima de Diamond III ([Riot Support](https://support.riotgames.com/en-us/league-of-legends/gameplay/placements-promotions-series-demotions-and-decay/)).
- **Promoção:** automática aos 100 LP. As séries entre divisões saíram em 2020, e as entre tiers em 2023. A Riot citou o estresse de repetir séries ([Dexerto](https://www.dexerto.com/league-of-legends/riot-remove-league-promo-series-major-season-11-ranked-shake-up-1421120/), [Riot 2023](https://www.leagueoflegends.com/en-us/news/game-updates/what-s-next-for-ranked/)).
- **Rebaixamento:** entre divisões não há proteção. Entre tiers, o jogador cai com 25, 50 ou 75 LP, e quem acaba de chegar ao Master tem 3 partidas de proteção.
- **MMR e LP:** no apex, desde abril de 2026, a variação vai de ±30 a um máximo de +35/−25 ou +25/−35 conforme o MMR. A Riot admitiu que variações de +10/−30 minavam a integridade do ranking ([Riot /dev](https://www.leagueoflegends.com/en-us/news/dev/dev-apex-tier-ranked-reset/)).
- **Indicador de subida (2026):** mostra quando o MMR está acima do rank ([Riot /dev Ranked 2026](https://www.leagueoflegends.com/en-gb/news/dev/dev-ranked-2026/)).
- **Decay:** só Diamond+ (−50 LP/dia) e Master+ (−75/dia), com dias acumulados por partida.
- **Aegis (patch 26.15):** a proteção de autofill por nota foi trocada por LP em dobro na vitória. O motivo: criava o objetivo de jogar pela nota, e não pela vitória ([Patch 26.15](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-15-notes/)).

### 5.2 Temporadas

| Ano | Formato | O que se viu |
|---|---|---|
| 2024 | 3 splits com 3 resets | reclamação de "grind" ([Dexerto](https://www.dexerto.com/league-of-legends/league-players-upset-with-new-grind-caused-by-season-14-ranked-splits-2726725/)) |
| 2025 | **um reset por ano**, em janeiro | a Riot disse que os resets repetidos tornavam a subida menos recompensadora e o ranking mais volátil ([Riot /dev 2025](https://www.leagueoflegends.com/en-us/news/dev/dev-ranked-update-season-one-2025/)) |
| 2026 | igual a 2025, mais um reset duro só para o Master+ em seis regiões | a Riot citou a integridade do ranking |

- **Skin Vitoriosa (regra atual):** exige 15 vitórias por temporada e Honra 3 ou mais ([Riot Support](https://support.riotgames.com/en-us/league-of-legends/rewards/ranked-years-seasons-and-end-of-season-rewards)).

### 5.3 TFT: 8 jogadores, todos contra todos

Fonte: [TFT Ranked FAQ](https://support.riotgames.com/en-us/tft/account/teamfight-tactics-ranked-faq).

- **Metades:** quem termina entre os 4 primeiros **nunca perde** LP, e quem termina entre os 4 últimos **nunca ganha**.
- **Sem queda de tier** do Iron ao Master. As divisões ainda caem.
- **5 partidas provisórias** sem perda.
- **Reset suave** a cada set: o MMR é puxado para a mediana.
- **Valores típicos** ([TFT Ninja](https://tft.ninja/guides/ranked/tiers-and-lp), aproximados): 1º de +35 a +45 e 8º de −35 a −50.

### 5.4 Hyper Roll e Arena

- **Hyper Roll:** um número único com faixas (Grey 0, Green 1400, Blue 2600, Purple 3400, Hyper 4200) ([LoL Wiki](https://wiki.leagueoflegends.com/en-us/TFT:Hyper_Roll)). Foi removido em 2025 com cerca de 2% do tempo de jogo ([Esports.gg](https://esports.gg/news/teamfight-tactics/tft-roadmap-2025-no-more-hyper-roll-pengus-party-returns-and-new-set-revival/), não confirmado).
- **Arena:** tinha rating de Wood a Gladiator, com perdas só no topo. Desde 2025 virou "Fama", uma progressão que nunca cai ([LoL Wiki](https://wiki.leagueoflegends.com/en-us/Arena)).
- **Lição:** com população pequena, não crie filas paralelas.

### 5.5 Psicologia

- **Efeito de gradiente de meta:** o esforço cresce perto da recompensa ([Kivetz et al., 2006](https://journals.sagepub.com/doi/abs/10.1509/jmkr.43.1.39)). Divisões de 100 pontos criam metas curtas.
- **Oponentes mais fortes aumentam o abandono,** e sequências de vitória o reduzem ([Kang et al., 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10839887/)).
- **O que a própria Riot reconhece como erro:** estresse nas séries, "grind" com resets, colocações "brutais" e objetivos secundários.

---

## 6. Rating e ranking em jogos de corrida

### 6.1 Como os jogos de corrida fazem

| Jogo | Rating de velocidade | Rating de limpeza | Observação |
|---|---|---|---|
| Gran Turismo 7 | DR (E→S), por pares sobre a ordem de chegada | SR | o DR não passa do SR ([manual GT7](https://www.gran-turismo.com/gb/gt7/manual/tips/03)) |
| iRacing | iRating: duelos 1x1 sobre a ordem de chegada, `Δ ∝ 200/N` | Safety Rating e licença | fórmula por engenharia reversa em [irating-rs](https://github.com/Turbo87/irating-rs) |
| Forza Motorsport (2023) | Skill Rating, depois de 3 corridas de colocação | Safety Rating | o matchmaking usa Skill primeiro e Safety depois ([Dexerto](https://www.dexerto.com/forza/forza-motorsport-multiplayer-explained-qualifier-series-ratings-events-2322599/)) |
| Trackmania | pontos visíveis fixos (+40…−40) e divisões Bronze→Master | — | soft reset, decaimento com imunidade, boost nas 10 primeiras partidas ([TM news](https://www.trackmania.com/news/7130)) |
| F-Zero 99 | patente D→S20 | — | cada corrida sorteia 4 rivais de patente parecida e pontua só contra eles ([SuperJump](https://www.superjumpmagazine.com/dust-and-destruction-the-racing-economy-in-f-zero-99/)) |

### 6.2 Algoritmos para partidas de N jogadores

- **TrueSkill** ([trueskill.org](https://trueskill.org/)):
  - μ=25, σ=25/3, β=25/6, τ=25/300;
  - o leaderboard mostra μ−3σ;
  - a licença só permite Xbox ou uso não comercial.
- **TrueSkill 2** ([MSR, 2018](https://www.microsoft.com/en-us/research/wp-content/uploads/2018/03/trueskill2.pdf)):
  - trata abandono como observação extra;
  - usa bots de habilidade fixa como referência, como no Gears 4;
  - o σ cresce com o tempo sem jogar.
- **Weng & Lin (2011), a base do OpenSkill** ([JMLR](https://www.csie.ntu.edu.tw/~cjlin/papers/online_ranking/online_journal.pdf)):
  - forma fechada;
  - no FFA do Halo 2, **Bradley-Terry completo errou 30,59%**, contra 30,82% do TrueSkill;
  - é cerca de 10× mais rápido;
  - tem menos de 100 linhas.
- **OpenSkill.js** ([GitHub](https://github.com/philihp/openskill.js)): licença MIT e TypeScript.
  - `rate(times, {rank})`, `ordinal()` e `predictRank`;
  - modelos Plackett-Luce (padrão) e Bradley-Terry.
- **Glicko-2** ([Glickman](http://www.glicko.net/glicko/glicko2.pdf)): feito para pares e para 10 a 15 jogos por período de rating. Não serve bem aqui.
- **Simulação feita na pesquisa** (Weng-Lin reimplementado; população de 60 pilotos com habilidade oculta; salas aleatórias de 6):

  | Corridas | Plackett-Luce (ρ / σ médio) | Bradley-Terry completo (ρ / σ médio) |
  |---|---|---|
  | 1 | 0,74 / 8,21 | 0,74 / 6,89 |
  | 5 | 0,92 / 7,77 | 0,93 / 4,82 |
  | 10 | 0,96 / 7,29 | 0,96 / 3,86 |
  | 20 | 0,98 / 6,52 | 0,98 / 3,01 |

  Os dois ordenam igualmente bem, mas **o BT reduz a incerteza cerca de 2× mais rápido**. Em salas de 6, isso decide se o rating exibido significa alguma coisa em poucas corridas.

### 6.3 Como mostrar o rating

- **Xbox:** mostra μ−3σ, que começa em zero e cresce com a confiança.
- **Valorant e LoL:** pontos visíveis que se movem para o MMR com um multiplicador de convergência ([Riot Support](https://support.riotgames.com/en-us/valorant/gameplay/how-rank-rating-rr-is-calculated)).
- **Trackmania:** pontos fixos, transparentes.

### 6.4 Matchmaking com pouca gente

- **Josh Menke** ([GDC](https://gdconf.com/article/interview-josh-menke-on-the-evolution-of-matchmaking-in-competitive-multiplayer-games/)): o erro mais comum é começar exigente e afrouxar com o tempo. Os limites devem sair das estatísticas da população ao vivo.
- **Real Racing 3:** fantasmas de amigos viram adversários assíncronos ([Pocket Gamer](https://www.pocketgamer.com/real-racing-3/real-racing-3s-asynchronous-multiplayer-turns-ghosts-into-ai-competitors/)).
- **Horários fixos:** Cup of the Day 3× por dia, Grand Prix do F-Zero 99, eventos do Forza a cada ~30 min.
- **Cuidado com o fantasma:** o recorde pessoal é mais difícil de vencer do que o dono ao vivo. Use uma volta típica, ou dê a cada volta gravada o próprio rating.

---

## 7. Princípios de design competitivo

### 7.1 Profundidade com um ou dois botões

- **F-Zero 99:** uma barra de energia que é vida e boost ao mesmo tempo. O boost só libera depois da primeira volta ([Wikipedia](https://en.wikipedia.org/wiki/F-Zero_99)).
- **Burnout 3:**
  - o boost vem de risco: near miss, contramão, drift e takedown;
  - cada takedown pode aumentar a barra até 4×;
  - bater tira boost ([Wikipedia](https://en.wikipedia.org/wiki/Burnout_3:_Takedown)).
- **CTR Nitro-Fueled:**
  - até 3 boosts por powerslide;
  - quanto mais tarde o aperto dentro da janela, melhor o turbo;
  - as reserves, um tanque invisível, sustentam a velocidade quando o jogador encadeia boosts ([PowerPyx](https://www.powerpyx.com/crash-team-racing-nitro-fueled-boost-mechanics-explained/), [Kavo](https://kavogaming.com/powersliding-sacred-boost-and-reserves-guide-crash-team-racing-nitro-fueled/)). Aumentam o teto, mas são difíceis de aprender justamente por serem invisíveis.
- **Wipeout HD:** o barrel roll custa 15% do escudo. Absorver uma arma devolve energia, e o HUD mostra o trade-off ([Wipeout Central](https://wipeout.fandom.com/wiki/Absorption)).

### 7.2 Catch-up

- **Rubber banding** parece injusto porque a CPU não segue as regras do jogador. O ajuste dinâmico ideal é invisível ([Compton, Game Developer](https://www.gamedeveloper.com/design/more-than-meets-the-eye-the-secrets-of-dynamic-difficulty-adjustment)).
- **As alternativas que preservam habilidade:**
  - vácuo;
  - recurso ganho por ação, como o Super Boost do F-Zero 99;
  - separar modo casual de modo competitivo.

### 7.3 Trackmania: fantasmas, determinismo e "só mais uma"

- **Física determinística:**
  - a 100 ticks/s;
  - o replay é o input com timestamp;
  - a validação re-simula a corrida ([donadigo](https://donadigo.com/tmx1)).
- **Mesmo assim, o topo trapaceou por uma década com câmera lenta,** e a detecção veio da estatística. Replays legítimos têm cerca de 3 mudanças de direção por segundo; os suspeitos, mais de 11 ([donadigo](https://donadigo.com/tmx1), [Wikipedia: Wirtual](https://en.wikipedia.org/wiki/Wirtual)).
- **Medalhas bronze, prata, ouro e autor:** o tempo de validação do criador vira a referência ([Trackmania Wiki](https://www.trackmania.wiki/wiki/Medals)).
- **Calendário** ([Wikipedia](https://en.wikipedia.org/wiki/Trackmania_(2020_video_game)), [COTD](https://raw.githubusercontent.com/nadeo/trackmania-doc/master/docs/play/how-to-play-cotd.md)):
  - Track of the Day;
  - Cup of the Day 3× por dia: 15 minutos de classificação, depois divisões de 64 com eliminação;
  - campanha de 25 pistas por trimestre.
- **Weekly Shorts:** pistas de até 20 s, em 5 estilos, feitas para iniciantes ([blog Trackmania](https://blog.trackmania.com/2025/03/10/weekly-shorts-new-rules-guidelines/)).

### 7.4 Pista procedural contra pista fixa

- **Spelunky Daily:** a mesma seed para todos, uma tentativa só, um leaderboard por dia. Gerou jogo cuidadoso e comunidade ([Mike Rose, Game Developer](https://www.gamedeveloper.com/design/the-understated-genius-of-the-i-spelunky-i-daily-challenge)).
- **Trackmania usa os dois modos:** pool fixo no ranqueado, onde memorizar conta, e pista nova por dia, onde adaptar conta.
- **Neste jogo:** a seed aleatória por sala é justa dentro da sala. Para comparar tempos e reaproveitar fantasmas, é preciso uma seed compartilhada.

### 7.5 Sensação de jogo e HUD

- **Hit-pause, câmera com inércia, tremor** ([Nijman, "Art of Screenshake"](https://pepwuper.com/jan-willem-nijman-co-founder-of-vlambeer-on-the-art-of-screenshake/)). Na competição, só como efeito visual: nunca pode mexer no tempo simulado.
- **CTR:** a cor da fumaça marca a janela, e a cor da chama marca o nível do boost.
- **Com 6 fantasmas na tela,** a informação competitiva (delta, rival mais próximo) precisa aparecer o tempo todo, e o ruído dos outros tem de baixar.

### 7.6 Toque

- **Não há fonte sólida** sobre o assunto.
- **Asphalt 9:** a direção assistida baixa o teto. Isso pede que os tempos com assistência fiquem marcados ([App Store](https://apps.apple.com/us/story/id1500622939)).

---

## 8. Integridade competitiva

- **Enviar os inputs, e não o resultado:**
  - o servidor re-simula com passo fixo e a seed;
  - o intervalo entre os pacotes de início e fim precisa bater com a duração do replay ([Vittorio Romeo](https://vittorioromeo.com/index/blog/oh_secure_leaderboards.html)).
- **Determinismo em JavaScript:**
  - `+ − × ÷ sqrt` são exatos pelo IEEE-754;
  - `Math.sin/cos/exp/pow` variam entre V8, JavaScriptCore e SpiderMonkey ([esdiscuss](https://esdiscuss.org/topic/es6-accuracy-of-special-functions), [Gaffer on Games](https://gafferongames.com/post/floating_point_determinism/));
  - portanto, a re-simulação precisa de tolerância.
- **Smurf:**
  - o Valorant resolveu acelerando a convergência do MMR, que chega ao nível certo em cerca de 4 partidas ([Riot](https://playvalorant.com/en-us/news/dev/valorant-systems-health-series-smurf-detection/));
  - sem contas fortes, o que se tem é σ inicial alto e esconder do leaderboard quem tem poucas corridas.
- **Diagnóstico do servidor da Corrida Fantasma (setembro de 2026):**
  - O tempo oficial é o relógio de parede desde a largada (`recordFinish`, `server/rooms.ts`), com folga de 2 s. Câmera lenta não rende.
  - Speedhack rende. O piso `minRaceSeconds` é a pista inteira no boost máximo mais o vácuo máximo (cerca de 50,8 s no normal), bem abaixo do que qualquer corrida real alcança.
  - O teto da telemetria é de 120 m/s fixos, acima do teto real de todos os níveis.
  - Os handlers confiam em `payload.playerId` sem ligá-lo ao socket, então um cliente pode falar em nome de outro.

---

## 9. Quadro: o que copiar e o que evitar

| Copiar | De onde | Evitar | Por quê |
|---|---|---|---|
| Recurso escasso com decisão (nitro guardado, aposta) | Top Gear, F-Zero | Combustível e pit stop | espantou casuais; o HC2 tirou |
| Mini-turbo por tempo, com taxa pela linha | Mario Kart Wii/8/World | Carga que dependa de balançar o direcional | vira snaking |
| 3 níveis com prêmio que cresce mais que o custo | MK8DX | Tempo de reta vencido por uma sequência de inputs | o MKW desenhou o salto carregado para perder em reta |
| Largada turbo com afogamento | Mario Kart | Largada por reflexo puro | a latência do aparelho decide |
| Encadeamento **visível** | CTR | Tanque invisível | difícil de aprender |
| Boost ganho por risco | Burnout | Catch-up por posição | é rubber banding disfarçado |
| Física igual para todos | Mario Kart World | Atributos e upgrades de desempenho | vira meta de carro obrigatório |
| Curva de raio constante e filtro de input | Horizon Chase | Rubber banding | crítica nº 1 do Turbo; "paradoxo da medalha" |
| Desafios quinzenais com modificadores | HC Playground | Filas paralelas com pouca gente | o Hyper Roll morreu com ~2% do tempo de jogo |
| Seed compartilhada, fantasma do recorde pessoal, medalhas, restart instantâneo | Trackmania, Spelunky | Comparar tempos de seeds diferentes | não mede nada |
| Elo por pares e delta mostrado por rival | MKWii, Lounge, iRacing | Mudança opaca de rating | revolta no MK8 e no MKW |
| MMR oculto + pontos com convergência limitada | LoL, Valorant | +10/−30 | a Riot chamou de péssima experiência |
| Colocação sem perda; proteção só entre tiers | LoL, TFT | Série de promoção | estresse; a Riot removeu |
| Metade de cima ganha, metade de baixo perde | TFT | Pontos que não mudam nada | crítica ao Top Gear 1 |
| Reset raro e recompensa só cosmética | LoL 2025+ | Três resets por ano | "grind" em 2024 |
| Bônus de corrida limpa, fora do rating | Top Gear 3000 | Pontos de estilo no rating | MK Tour e a Aegis do LoL desviaram o incentivo |
| Validação estatística de input | Trackmania | Validar só o tempo final | caso Riolu |

---

## 10. Especificação para a Corrida Fantasma

### 10.1 Pilotagem, com os mesmos dois comandos

- **Impulso.** Um turbo que não gasta a barra: leva o carro à velocidade de boost, com a tração do boost. Na curva ele empurra para fora como o boost, que é a regra de Top Gear. **Não passa do teto do nível**, então `minRaceSeconds` continua valendo.
- **Largada turbo.** As cinco luzes têm ritmo fixo de 900 ms, então quem acerta é quem antecipa, e não quem reage mais rápido. O jogador aperta o boost logo no apagar das luzes:

  | Momento do aperto | Resultado |
  |---|---|
  | De −80 a 150 ms | **Largada perfeita**: cerca de 1,5 s de impulso |
  | Até 350 ms | Cerca de 1 s de impulso |
  | Até 700 ms | Cerca de 0,5 s de impulso |
  | Antes da janela (ou segurado desde antes) | **Queimou**: motor afogado por 0,8 s |

- **Mini-turbo de curva**, sem botão novo:
  - Carrega enquanto o jogador segura a direção para dentro de uma curva de verdade, sem boost, sem impulso ativo, fora da grama e sem penalidade.
  - A taxa é de 1,0 por segundo com o carro na metade de dentro da pista e de 0,4 fora dela. É a proporção 5:2 do Mario Kart, com a linha fazendo o papel do ângulo do direcional.
  - Três níveis, que disparam o impulso ao endireitar ou ao sair da curva.
  - Virar para fora zera a carga, e em reta não carrega nada.
  - Meta de calibração: o nível 1 cabe numa curva comum, e o nível 3 só numa super curva feita com linha limpa.
- **Combo de tangência:** 22 → 27 → 32% de boost em tangências seguidas. Muro ou reset zera a sequência.
- **Raspão:** passar rente a uma barreira ou destroço sem tocar devolve uma pequena carga de boost, uma vez por obstáculo.
- **Meta medida com os pilotos-robô:**
  - o expert (tangência, mini-turbo e largada) chega pelo menos 8% antes do novato, e 3% antes de quem só tangencia;
  - o novato continua dentro de 60 a 90 s.

### 10.2 Clareza e feedback

- **Carga:** faíscas azul, laranja e roxa com tamanhos diferentes, para não depender só da cor. Bipes que sobem de tom e um pulso do carro no nível 3.
- **Parciais:** um setor termina na saída de cada super curva, com delta contra o recorde pessoal ou contra o rival.
- **Delta ao vivo** contra o fantasma do recorde pessoal.
- **Hierarquia dos fantasmas:** o recorde pessoal e o rival mais próximo ficam mais opacos, e o nome aparece só nos dois mais próximos.
- **Pós-corrida "onde você perdeu tempo":** tangências, mini-turbos, boost travado, grama, batidas e largada, cada item com os segundos estimados.
- **Medalhas de corrida limpa,** fora do rating.

### 10.3 Contrarrelógio e Pista do Dia

- **Seed do dia:** vem da data em Brasília, igual para todos.
- **Restart instantâneo.**
- **Fantasma do recorde pessoal.**
- **Medalhas** calculadas pelo piloto-robô na mesma seed, o equivalente ao tempo de autor: ouro ×1,03, prata ×1,08, bronze ×1,18.
- **Tempos comparáveis:** no contrarrelógio não há vácuo.
- **Ranking online:** na dificuldade oficial (difícil), com validação no servidor.

### 10.4 Ranqueada

- **MMR oculto:** OpenSkill com Bradley-Terry completo e os valores padrão. O σ cresce com a inatividade.
- **Ordem da corrida:** primeiro quem chegou, pelo tempo; depois os que não terminaram, empatados; por fim os abandonos, empatados.
- **Pontos de Liga (PL):** Bronze, Prata, Ouro, Platina e Diamante, cada um com divisões III, II e I de 100 PL. Acima disso, Mestre é uma escada aberta, e o top 5 recebe o selo "Lenda".
- **PL por colocação,** com 6 pilotos de MMR igual:

  | 1º | 2º | 3º | 4º | 5º | 6º |
  |---|---|---|---|---|---|
  | +30 | +20 | +10 | −10 | −20 | −30 |

  - Em Bronze e Prata, as perdas caem pela metade.
  - Para N de 2 a 6 pilotos: `base = −30 + 60·p`, com `p = (N−pos)/(N−1)`, multiplicado por `√((N−1)/5)`.
- **Convergência para o MMR:** `mult = clamp(1 + (PL_alvo − PL)/400, 0,75, 1,25)`. O ganho é multiplicado por `mult`, e a perda por `2 − mult`. Um indicador de subida aparece quando `mult > 1,1`.
- **Proteções:**
  - 5 corridas de colocação sem perda, com teto em Ouro I;
  - promoção automática, sem série;
  - ao cair de divisão, o piloto entra com 75 PL;
  - escudo de 3 corridas depois de subir de tier;
  - Bronze e Prata não caem de tier;
  - sem decay.
- **Abandono:** conta como último lugar, com −5 PL extras.
- **Queda antes da largada:** a corrida é refeita.
- **Sair durante a contagem:** espera crescente de 1, 5 e 30 minutos.
- **Só a fila pública conta.** Salas por código continuam casuais. Um grupo que corre junto repetidamente ganha retornos decrescentes.
- **Temporada por semestre,** com reset suave e recompensas cosméticas.
- **O resultado mostra o ΔPL e a contribuição de cada rival.**
- **Matchmaking:**
  - a fila espera até 20 s e agrupa pelo MMR, com mínimo de 2 humanos;
  - horário ranqueado divulgado;
  - pool semanal de 10 seeds curadas;
  - quando falta gente, fantasmas gravados com rating congelado completam a sala.

### 10.5 Integridade

1. Ligar o piloto ao socket.
2. Teto de telemetria por nível.
3. Tempo simulado na telemetria (contra speedhack).
4. Piso realista por seed, dado pelo piloto-robô. Um tempo muito abaixo fica "pendente".
5. Re-simulação por inputs, com tolerância, para liberar os pendentes.
6. Heurística de trocas de direção por segundo.

---

## 11. Lacunas da pesquisa

- **Números que não achamos:**
  - duração exata do nitro no Top Gear 1;
  - a tabela de pontos do Top Gear 1;
  - cargas de nitro e taxas de combustível do Horizon Chase;
  - as janelas de largada do Mario Kart em quadros;
  - a tabela completa de itens do MK8DX 2.x.
- **Riot:** a fórmula de LP abaixo do apex não é publicada. As tabelas exatas de pontos do Hyper Roll e da Arena não foram encontradas.
- **Toque contra teclado:** não há dados publicados de diferença de desempenho. O plano é registrar o dispositivo em cada tempo e só separar os rankings se os dados pedirem.
- **Retenção:** não achamos números públicos de retenção por modo diário ou sazonal.
- **Dados que o próprio jogo precisa coletar:**
  - a variância por seed (para curar o pool ranqueado);
  - a distribuição de medalhas;
  - a diferença entre toque e teclado;
  - a confiabilidade do rating (ICC com pilotos-robô).
