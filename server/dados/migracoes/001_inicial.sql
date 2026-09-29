-- Perfis leves e os tempos da Pista do Dia.
--
-- O segredo do perfil nunca é guardado: só o hash dele. Os tempos guardam a
-- volta inteira, para virar o fantasma de quem quiser correr contra ela.

CREATE TABLE perfis (
  id uuid PRIMARY KEY,
  apelido text NOT NULL,
  token_hash text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tempos (
  id uuid PRIMARY KEY,
  perfil_id uuid NOT NULL REFERENCES perfis (id) ON DELETE CASCADE,
  dia date NOT NULL,
  seed bigint NOT NULL,
  dificuldade text NOT NULL,
  tempo double precision NOT NULL CHECK (tempo > 0),
  dispositivo text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('valido', 'pendente', 'recusado')),
  gravacao jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- O quadro lê o melhor tempo válido de cada piloto numa semente e nível.
CREATE INDEX tempos_do_quadro ON tempos (seed, dificuldade, estado, tempo);
