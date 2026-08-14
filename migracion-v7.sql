USE entre_amigos;

ALTER TABLE grupo_persona
  ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1;