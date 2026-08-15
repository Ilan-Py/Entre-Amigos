DROP TABLE IF EXISTS pagos_deuda CASCADE;
DROP TABLE IF EXISTS pagos_evento CASCADE;
DROP TABLE IF EXISTS participantes CASCADE;
DROP TABLE IF EXISTS eventos CASCADE;
DROP TABLE IF EXISTS grupo_persona CASCADE;
DROP TABLE IF EXISTS grupos CASCADE;
DROP TABLE IF EXISTS personas CASCADE;

CREATE TABLE personas (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100),
  telefono VARCHAR(50),
  alias_bancario VARCHAR(120)
);

CREATE TABLE grupos (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE grupo_persona (
  grupo_id INTEGER NOT NULL,
  persona_id INTEGER NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (grupo_id, persona_id),
  CONSTRAINT fk_gp_grupo
    FOREIGN KEY (grupo_id)
    REFERENCES grupos(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_gp_persona
    FOREIGN KEY (persona_id)
    REFERENCES personas(id)
    ON DELETE CASCADE
);

CREATE TABLE eventos (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grupo_id INTEGER NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  fecha DATE NOT NULL,
  CONSTRAINT fk_evento_grupo
    FOREIGN KEY (grupo_id)
    REFERENCES grupos(id)
    ON DELETE CASCADE
);

CREATE TABLE participantes (
  evento_id INTEGER NOT NULL,
  persona_id INTEGER NOT NULL,
  monto_asignado NUMERIC(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (evento_id, persona_id),
  CONSTRAINT fk_part_evento
    FOREIGN KEY (evento_id)
    REFERENCES eventos(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_part_persona
    FOREIGN KEY (persona_id)
    REFERENCES personas(id)
);

CREATE TABLE pagos_evento (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento_id INTEGER NOT NULL,
  persona_id INTEGER NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  CONSTRAINT fk_pago_evento
    FOREIGN KEY (evento_id)
    REFERENCES eventos(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_pago_persona
    FOREIGN KEY (persona_id)
    REFERENCES personas(id)
);

CREATE TABLE pagos_deuda (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grupo_id INTEGER NOT NULL,
  deudor_id INTEGER NOT NULL,
  acreedor_id INTEGER NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha DATE NOT NULL,
  descripcion VARCHAR(255),
  CONSTRAINT fk_pd_grupo
    FOREIGN KEY (grupo_id)
    REFERENCES grupos(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_pd_deudor
    FOREIGN KEY (deudor_id)
    REFERENCES personas(id),
  CONSTRAINT fk_pd_acreedor
    FOREIGN KEY (acreedor_id)
    REFERENCES personas(id),
  CONSTRAINT chk_deudor_acreedor
    CHECK (deudor_id <> acreedor_id)
);

CREATE INDEX idx_eventos_grupo_fecha
  ON eventos(grupo_id, fecha);

CREATE INDEX idx_pagos_deuda_grupo_fecha
  ON pagos_deuda(grupo_id, fecha);

CREATE INDEX idx_grupo_persona_activo
  ON grupo_persona(grupo_id, activo);

-- Datos de demostración opcionales
INSERT INTO personas(nombre, apellido, alias_bancario)
VALUES
  ('Ana', 'García', 'ana.garcia'),
  ('Bruno', 'López', 'bruno.lopez'),
  ('Carla', 'Martínez', 'carla.mp');

INSERT INTO grupos(nombre)
VALUES ('Amigos');

INSERT INTO grupo_persona(grupo_id, persona_id, activo)
SELECT 1, id, TRUE
FROM personas;