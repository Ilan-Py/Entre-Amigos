-- ENTRE AMIGOS - MIGRACIÓN UX/CATEGORÍAS
-- Ejecutar UNA sola vez en Neon sobre la base actual.

ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(80) NOT NULL DEFAULT 'Otros';

CREATE INDEX IF NOT EXISTS idx_eventos_grupo_categoria
  ON eventos(grupo_id, categoria);