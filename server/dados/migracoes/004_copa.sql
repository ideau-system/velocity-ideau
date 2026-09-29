-- Troféus da Copa do Dia: só cosméticos, como os do Trackmania.
--
-- A Copa não mexe no rating nem nos PL: é um evento em horário marcado, para
-- juntar gente com pouca gente jogando. O que fica dela é o troféu.

CREATE TABLE trofeus (
  id uuid PRIMARY KEY,
  perfil_id uuid NOT NULL REFERENCES perfis (id) ON DELETE CASCADE,
  dia date NOT NULL,
  divisao integer NOT NULL CHECK (divisao >= 1),
  posicao integer NOT NULL CHECK (posicao BETWEEN 1 AND 3),
  participantes integer NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trofeus_por_perfil ON trofeus (perfil_id, dia DESC);
