-- Voltas das corridas ranqueadas, para completar salas com fantasmas.
--
-- Com pouca gente jogando, quem fica sozinho na fila corre contra voltas de
-- verdade de outros pilotos, na mesma pista, escolhidas pelo MMR que eles
-- tinham quando correram. O MMR vai junto porque é ele, congelado, que entra
-- na conta do rating — como os bots de habilidade fixa do Gears of War 4.

CREATE TABLE voltas_ranqueadas (
  id uuid PRIMARY KEY,
  perfil_id uuid NOT NULL REFERENCES perfis (id) ON DELETE CASCADE,
  seed bigint NOT NULL,
  dificuldade text NOT NULL,
  tempo double precision NOT NULL CHECK (tempo > 0),
  mu double precision NOT NULL,
  sigma double precision NOT NULL,
  carro text NOT NULL,
  gravacao jsonb NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX voltas_ranqueadas_recentes ON voltas_ranqueadas (dificuldade, criada_em DESC);
