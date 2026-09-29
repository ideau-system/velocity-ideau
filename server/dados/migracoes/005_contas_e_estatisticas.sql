-- Contas, estatísticas do perfil e medalhas.
--
-- O perfil passa a ser de uma conta do Supabase Auth: o id do perfil é o id do
-- usuário lá, e o apelido escolhido no cadastro é único entre as contas, sem
-- diferenciar maiúsculas. Os perfis de aparelho (apelido e segredo) ficam fora
-- dessa regra: não há mais como entrar neles, e o que fizeram segue nos
-- quadros em que já estava.

ALTER TABLE perfis ALTER COLUMN token_hash DROP NOT NULL;

CREATE UNIQUE INDEX perfis_apelido_da_conta ON perfis (lower(apelido)) WHERE token_hash IS NULL;

-- A medalha de cada volta do contrarrelógio, calculada quando ela é julgada:
-- o perfil conta as medalhas sem refazer o piloto de referência de cada pista.
ALTER TABLE tempos ADD COLUMN medalha text CHECK (medalha IN ('autor', 'ouro', 'prata', 'bronze'));

CREATE INDEX tempos_do_piloto ON tempos (perfil_id, seed, dificuldade, tempo);

-- Cada corrida online de quem entrou com conta — casual, ranqueada ou da Copa.
-- É daqui que saem as estatísticas do perfil. A sala e a largada identificam
-- a corrida: a mesma não entra duas vezes.
CREATE TABLE participacoes (
  perfil_id uuid NOT NULL REFERENCES perfis (id) ON DELETE CASCADE,
  sala text NOT NULL,
  largada timestamptz NOT NULL,
  modo text NOT NULL CHECK (modo IN ('casual', 'ranqueada', 'copa')),
  seed bigint NOT NULL,
  dificuldade text NOT NULL,
  pilotos integer NOT NULL CHECK (pilotos >= 1),
  posicao integer NOT NULL CHECK (posicao >= 1),
  desfecho text NOT NULL CHECK (desfecho IN ('chegou', 'naoTerminou', 'abandonou')),
  tempo double precision,
  velocidade_maxima double precision NOT NULL DEFAULT 0,
  batidas integer NOT NULL DEFAULT 0,
  carro text NOT NULL,
  delta_pl integer,
  PRIMARY KEY (perfil_id, sala, largada)
);

CREATE INDEX participacoes_recentes ON participacoes (perfil_id, largada DESC);
