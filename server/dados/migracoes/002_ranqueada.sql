-- Ranqueada: o estado de cada piloto por temporada e o histórico das corridas.
--
-- O MMR (mu e sigma do OpenSkill) é oculto; os PL são o que a tela mostra. O
-- histórico guarda antes e depois de cada piloto em cada corrida, para o
-- resultado ser auditável e o retorno decrescente saber quem correu com quem.

CREATE TABLE ratings (
  perfil_id uuid NOT NULL REFERENCES perfis (id) ON DELETE CASCADE,
  temporada text NOT NULL,
  mu double precision NOT NULL,
  sigma double precision NOT NULL,
  pl integer NOT NULL,
  corridas integer NOT NULL,
  colocacao integer NOT NULL,
  escudo integer NOT NULL,
  pico integer NOT NULL,
  podios integer NOT NULL,
  abandonos integer NOT NULL,
  ultima_corrida timestamptz,
  PRIMARY KEY (perfil_id, temporada)
);

CREATE INDEX ratings_da_escada ON ratings (temporada, pl DESC);

CREATE TABLE corridas_ranqueadas (
  id uuid PRIMARY KEY,
  temporada text NOT NULL,
  sala text NOT NULL,
  seed bigint NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resultados_ranqueados (
  corrida_id uuid NOT NULL REFERENCES corridas_ranqueadas (id) ON DELETE CASCADE,
  perfil_id uuid NOT NULL REFERENCES perfis (id) ON DELETE CASCADE,
  posto integer NOT NULL,
  desfecho text NOT NULL,
  tempo double precision,
  pl_antes integer NOT NULL,
  pl_depois integer NOT NULL,
  mu_antes double precision NOT NULL,
  mu_depois double precision NOT NULL,
  sigma_antes double precision NOT NULL,
  sigma_depois double precision NOT NULL,
  PRIMARY KEY (corrida_id, perfil_id)
);

CREATE INDEX resultados_por_perfil ON resultados_ranqueados (perfil_id);
