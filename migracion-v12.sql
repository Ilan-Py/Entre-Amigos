-- ENTRE AMIGOS V12 — GOOGLE AUTH / MULTIUSUARIO
-- Ejecutar UNA sola vez en Neon ANTES de desplegar V12.

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  nombre VARCHAR(180),
  avatar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMPTZ
);

ALTER TABLE grupos
  ADD COLUMN IF NOT EXISTS usuario_id INTEGER;

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS usuario_id INTEGER;

ALTER TABLE grupos
  DROP CONSTRAINT IF EXISTS grupos_nombre_key;

ALTER TABLE grupos
  DROP CONSTRAINT IF EXISTS fk_grupos_usuario;

ALTER TABLE personas
  DROP CONSTRAINT IF EXISTS fk_personas_usuario;

ALTER TABLE grupos
  ADD CONSTRAINT fk_grupos_usuario
  FOREIGN KEY (usuario_id)
  REFERENCES usuarios(id)
  ON DELETE CASCADE;

ALTER TABLE personas
  ADD CONSTRAINT fk_personas_usuario
  FOREIGN KEY (usuario_id)
  REFERENCES usuarios(id)
  ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_grupos_usuario_nombre
  ON grupos(usuario_id, LOWER(nombre))
  WHERE usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grupos_usuario
  ON grupos(usuario_id);

CREATE INDEX IF NOT EXISTS idx_personas_usuario
  ON personas(usuario_id);

-- IMPORTANTE:
-- Los datos existentes quedan temporalmente con usuario_id = NULL.
-- La PRIMERA cuenta Google que inicie sesión en una instalación V12
-- reclamará automáticamente estos datos legacy.
-- Por eso, iniciá sesión vos primero antes de compartir la URL.