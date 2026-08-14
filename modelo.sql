DROP DATABASE IF EXISTS entre_amigos;

CREATE DATABASE entre_amigos
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE entre_amigos;

CREATE TABLE personas (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100),
  telefono VARCHAR(50),
  alias_bancario VARCHAR(120)
);

CREATE TABLE grupos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE grupo_persona (
  grupo_id INT NOT NULL,
  persona_id INT NOT NULL,
  PRIMARY KEY (grupo_id, persona_id),
  FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE,
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
);

CREATE TABLE eventos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  grupo_id INT NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  fecha DATE NOT NULL,
  FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE
);

CREATE TABLE participantes (
  evento_id INT NOT NULL,
  persona_id INT NOT NULL,
  monto_asignado DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (evento_id, persona_id),
  FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
  FOREIGN KEY (persona_id) REFERENCES personas(id)
);

CREATE TABLE pagos_evento (
  id INT PRIMARY KEY AUTO_INCREMENT,
  evento_id INT NOT NULL,
  persona_id INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
  FOREIGN KEY (persona_id) REFERENCES personas(id)
);

CREATE TABLE pagos_deuda (
  id INT PRIMARY KEY AUTO_INCREMENT,
  grupo_id INT NOT NULL,
  deudor_id INT NOT NULL,
  acreedor_id INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  fecha DATE NOT NULL,
  descripcion VARCHAR(255),
  FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE,
  FOREIGN KEY (deudor_id) REFERENCES personas(id),
  FOREIGN KEY (acreedor_id) REFERENCES personas(id)
);

INSERT INTO personas(nombre, apellido, telefono, alias_bancario) VALUES
('Ana', 'García', NULL, 'ana.garcia'),
('Bruno', 'López', NULL, 'bruno.lopez'),
('Carla', 'Martínez', NULL, 'carla.mp');

INSERT INTO grupos(nombre) VALUES ('Amigos');

INSERT INTO grupo_persona(grupo_id, persona_id)
SELECT 1, id FROM personas;