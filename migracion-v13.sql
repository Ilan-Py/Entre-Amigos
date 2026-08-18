-- ENTRE AMIGOS V13 — DEMO TEMPORAL
-- Ejecutar UNA sola vez en Neon.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS demo_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_demo_token
  ON usuarios(demo_token_hash)
  WHERE demo_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_demo_expira
  ON usuarios(demo_expires_at)
  WHERE is_demo = TRUE;