import crypto from "crypto";
import db from "./db.js";

const DEMO_COOKIE = "ea_demo";
const DEMO_SECONDS = 2 * 60 * 60;

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");

  return Object.fromEntries(
    raw
      .split(";")
      .map(v => v.trim())
      .filter(Boolean)
      .map(part => {
        const i = part.indexOf("=");
        if (i === -1) return [part, ""];
        return [
          decodeURIComponent(part.slice(0, i)),
          decodeURIComponent(part.slice(i + 1))
        ];
      })
  );
}

function tokenHash(token) {
  return crypto
    .createHash("sha256")
    .update(String(token))
    .digest("hex");
}

function cookieOptions(req, maxAge = DEMO_SECONDS) {
  const secure =
    req.secure ||
    String(req.headers["x-forwarded-proto"] || "") === "https";

  const parts = [
    `${DEMO_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];

  if (secure) parts.push("Secure");

  return parts;
}

function setDemoCookie(req, res, token) {
  const parts = cookieOptions(req);
  parts[0] = `${DEMO_COOKIE}=${encodeURIComponent(token)}`;
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearDemoCookie(req, res) {
  const parts = cookieOptions(req, 0);
  parts[0] = `${DEMO_COOKIE}=`;
  res.setHeader("Set-Cookie", parts.join("; "));
}

export async function getDemoUser(req) {
  const token = parseCookies(req)[DEMO_COOKIE];

  if (!token) return null;

  const [rows] = await db.query(`
    SELECT
      id,
      email,
      nombre,
      avatar,
      demo_expires_at
    FROM usuarios
    WHERE is_demo = TRUE
      AND demo_token_hash = ?
      AND demo_expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `, [tokenHash(token)]);

  if (!rows.length) {
    return null;
  }

  return {
    ...rows[0],
    is_demo: true
  };
}

async function borrarDatosDemo(conn, usuarioId) {
  // Primero grupos: los eventos, participantes, pagos y deudas
  // dependen de ellos y se limpian por CASCADE.
  await conn.query(`
    DELETE FROM grupos
    WHERE usuario_id = ?
  `, [usuarioId]);

  await conn.query(`
    DELETE FROM personas
    WHERE usuario_id = ?
  `, [usuarioId]);
}

async function limpiarDemosExpiradas() {
  const [expiradas] = await db.query(`
    SELECT id
    FROM usuarios
    WHERE is_demo = TRUE
      AND demo_expires_at <= CURRENT_TIMESTAMP
  `);

  for (const u of expiradas) {
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();
      await borrarDatosDemo(conn, u.id);

      await conn.query(`
        DELETE FROM usuarios
        WHERE id = ?
          AND is_demo = TRUE
      `, [u.id]);

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      console.warn("No se pudo limpiar demo expirada:", u.id, e);
    } finally {
      conn.release();
    }
  }
}

function isoDiasAtras(dias) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

async function insertarPersona(conn, usuarioId, data) {
  const [rows] = await conn.query(`
    INSERT INTO personas(
      nombre,
      apellido,
      telefono,
      alias_bancario,
      usuario_id,
      activo
    )
    VALUES (?, ?, ?, ?, ?, TRUE)
    RETURNING id
  `, [
    data.nombre,
    data.apellido || null,
    data.telefono || null,
    data.alias || null,
    usuarioId
  ]);

  return rows[0].id;
}

async function insertarGrupo(conn, usuarioId, nombre) {
  const [rows] = await conn.query(`
    INSERT INTO grupos(
      nombre,
      usuario_id,
      activo
    )
    VALUES (?, ?, TRUE)
    RETURNING id
  `, [nombre, usuarioId]);

  return rows[0].id;
}

async function vincular(conn, grupoId, personaIds) {
  for (const personaId of personaIds) {
    await conn.query(`
      INSERT INTO grupo_persona(
        grupo_id,
        persona_id,
        activo
      )
      VALUES (?, ?, TRUE)
      ON CONFLICT (grupo_id, persona_id)
      DO UPDATE SET activo = TRUE
    `, [grupoId, personaId]);
  }
}

async function agregarEvento(
  conn,
  {
    grupoId,
    descripcion,
    categoria,
    fecha,
    participantes,
    pagadores
  }
) {
  const [rows] = await conn.query(`
    INSERT INTO eventos(
      grupo_id,
      descripcion,
      fecha,
      categoria
    )
    VALUES (?, ?, ?, ?)
    RETURNING id
  `, [
    grupoId,
    descripcion,
    fecha,
    categoria
  ]);

  const eventoId = rows[0].id;

  for (const p of participantes) {
    await conn.query(`
      INSERT INTO participantes(
        evento_id,
        persona_id,
        monto_asignado
      )
      VALUES (?, ?, ?)
    `, [
      eventoId,
      p.personaId,
      p.monto
    ]);
  }

  for (const p of pagadores) {
    await conn.query(`
      INSERT INTO pagos_evento(
        evento_id,
        persona_id,
        monto
      )
      VALUES (?, ?, ?)
    `, [
      eventoId,
      p.personaId,
      p.monto
    ]);
  }
}

async function agregarTransferencia(
  conn,
  {
    grupoId,
    deudorId,
    acreedorId,
    monto,
    diasAtras,
    descripcion
  }
) {
  await conn.query(`
    INSERT INTO pagos_deuda(
      grupo_id,
      deudor_id,
      acreedor_id,
      monto,
      fecha,
      descripcion
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    grupoId,
    deudorId,
    acreedorId,
    monto,
    isoDiasAtras(diasAtras),
    descripcion
  ]);
}

async function sembrarDemo(conn, usuarioId) {
  const personas = {};

  const datosPersonas = [
    ["sofia",     "Sofía",         "Rossi",     "+54 9 11 5555-0101", "sofi.rossi"],
    ["martin",    "Martín",        "Luna",      "+54 9 11 5555-0102", "martin.luna"],
    ["lucas",     "Lucas",         "Ferreyra",  "+54 9 11 5555-0103", "lucas.ferreyra"],
    ["valentina", "Valentina",     "Suárez",    "+54 9 11 5555-0104", "vale.suarez"],
    ["tomas",     "Tomás",         "Pérez",     "+54 9 11 5555-0201", "tomas.perez"],
    ["julia",     "Julia",         "Méndez",    "+54 9 11 5555-0202", "julia.mendez"],
    ["mateo",     "Mateo",         "Silva",     "+54 9 11 5555-0203", "mateo.silva"],
    ["nico",      "Nicolás",       "Acosta",    "+54 9 11 5555-0301", "nico.acosta"],
    ["franco",    "Franco",        "Ruiz",      "+54 9 11 5555-0302", "franco.ruiz"],
    ["agustin",   "Agustín",       "Vega",      "+54 9 11 5555-0303", "agus.vega"],
    ["sarah",     "Sarah",         "Morgan",     null,                  "sarah.constellation"],
    ["barrett",   "Barrett",       null,         null,                  "barrett.frontier"],
    ["sam",       "Sam",           "Coe",        null,                  "sam.coe"],
    ["andreja",   "Andreja",       null,         null,                  "andreja"],
    ["septim",    "Martin",        "Septim",     null,                  "martin.septim"],
    ["jauffre",   "Jauffre",       null,         null,                  "jauffre"],
    ["baurus",    "Baurus",        null,         null,                  "baurus"]
  ];

  for (const [key, nombre, apellido, telefono, alias] of datosPersonas) {
    personas[key] = await insertarPersona(conn, usuarioId, {
      nombre,
      apellido,
      telefono,
      alias
    });
  }

  const grupos = {
    bariloche: await insertarGrupo(conn, usuarioId, "Viaje a Bariloche"),
    depto: await insertarGrupo(conn, usuarioId, "Depto 4B"),
    futbol: await insertarGrupo(conn, usuarioId, "Fútbol de los jueves"),
    constellation: await insertarGrupo(conn, usuarioId, "Constellation"),
    blades: await insertarGrupo(conn, usuarioId, "Blades")
  };

  await vincular(conn, grupos.bariloche, [
    personas.sofia,
    personas.martin,
    personas.lucas,
    personas.valentina
  ]);

  await vincular(conn, grupos.depto, [
    personas.tomas,
    personas.julia,
    personas.mateo
  ]);

  await vincular(conn, grupos.futbol, [
    personas.nico,
    personas.franco,
    personas.agustin,
    personas.tomas
  ]);

  await vincular(conn, grupos.constellation, [
    personas.sarah,
    personas.barrett,
    personas.sam,
    personas.andreja
  ]);

  await vincular(conn, grupos.blades, [
    personas.septim,
    personas.jauffre,
    personas.baurus
  ]);

  // VIAJE A BARILOCHE
  await agregarEvento(conn, {
    grupoId: grupos.bariloche,
    descripcion: "Hotel",
    categoria: "Alojamiento",
    fecha: isoDiasAtras(8),
    participantes: [
      { personaId: personas.sofia, monto: 105000 },
      { personaId: personas.martin, monto: 105000 },
      { personaId: personas.lucas, monto: 105000 },
      { personaId: personas.valentina, monto: 105000 }
    ],
    pagadores: [
      { personaId: personas.sofia, monto: 300000 },
      { personaId: personas.martin, monto: 120000 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.bariloche,
    descripcion: "Cena en el centro",
    categoria: "Comida",
    fecha: isoDiasAtras(7),
    participantes: [
      { personaId: personas.sofia, monto: 18000 },
      { personaId: personas.martin, monto: 22000 },
      { personaId: personas.lucas, monto: 26000 },
      { personaId: personas.valentina, monto: 22000 }
    ],
    pagadores: [
      { personaId: personas.lucas, monto: 88000 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.bariloche,
    descripcion: "Remis al aeropuerto",
    categoria: "Transporte",
    fecha: isoDiasAtras(6),
    participantes: [
      { personaId: personas.sofia, monto: 9000 },
      { personaId: personas.martin, monto: 9000 },
      { personaId: personas.lucas, monto: 9000 },
      { personaId: personas.valentina, monto: 9000 }
    ],
    pagadores: [
      { personaId: personas.valentina, monto: 36000 }
    ]
  });

  await agregarTransferencia(conn, {
    grupoId: grupos.bariloche,
    deudorId: personas.martin,
    acreedorId: personas.sofia,
    monto: 40000,
    diasAtras: 5,
    descripcion: "Transferencia parcial"
  });

  // DEPTO 4B
  await agregarEvento(conn, {
    grupoId: grupos.depto,
    descripcion: "Supermercado",
    categoria: "Compras",
    fecha: isoDiasAtras(5),
    participantes: [
      { personaId: personas.tomas, monto: 31880 },
      { personaId: personas.julia, monto: 31880 },
      { personaId: personas.mateo, monto: 31880 }
    ],
    pagadores: [
      { personaId: personas.julia, monto: 95640 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.depto,
    descripcion: "Internet",
    categoria: "Servicios",
    fecha: isoDiasAtras(4),
    participantes: [
      { personaId: personas.tomas, monto: 14000 },
      { personaId: personas.julia, monto: 14000 },
      { personaId: personas.mateo, monto: 14000 }
    ],
    pagadores: [
      { personaId: personas.tomas, monto: 42000 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.depto,
    descripcion: "Limpieza",
    categoria: "Servicios",
    fecha: isoDiasAtras(3),
    participantes: [
      { personaId: personas.tomas, monto: 10000 },
      { personaId: personas.julia, monto: 10000 },
      { personaId: personas.mateo, monto: 10000 }
    ],
    pagadores: [
      { personaId: personas.tomas, monto: 15000 },
      { personaId: personas.mateo, monto: 15000 }
    ]
  });

  // FÚTBOL
  await agregarEvento(conn, {
    grupoId: grupos.futbol,
    descripcion: "Cancha",
    categoria: "Entretenimiento",
    fecha: isoDiasAtras(3),
    participantes: [
      { personaId: personas.nico, monto: 12000 },
      { personaId: personas.franco, monto: 12000 },
      { personaId: personas.agustin, monto: 12000 },
      { personaId: personas.tomas, monto: 12000 }
    ],
    pagadores: [
      { personaId: personas.nico, monto: 48000 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.futbol,
    descripcion: "Bebidas",
    categoria: "Comida",
    fecha: isoDiasAtras(3),
    participantes: [
      { personaId: personas.nico, monto: 7000 },
      { personaId: personas.franco, monto: 6500 },
      { personaId: personas.agustin, monto: 6000 },
      { personaId: personas.tomas, monto: 6000 }
    ],
    pagadores: [
      { personaId: personas.franco, monto: 25500 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.futbol,
    descripcion: "Tercer tiempo",
    categoria: "Comida",
    fecha: isoDiasAtras(2),
    participantes: [
      { personaId: personas.nico, monto: 16000 },
      { personaId: personas.franco, monto: 16000 },
      { personaId: personas.agustin, monto: 16000 },
      { personaId: personas.tomas, monto: 16000 }
    ],
    pagadores: [
      { personaId: personas.tomas, monto: 32000 },
      { personaId: personas.agustin, monto: 32000 }
    ]
  });

  // CONSTELLATION
  await agregarEvento(conn, {
    grupoId: grupos.constellation,
    descripcion: "Reparación de la Frontier",
    categoria: "Servicios",
    fecha: isoDiasAtras(5),
    participantes: [
      { personaId: personas.sarah, monto: 44625 },
      { personaId: personas.barrett, monto: 44625 },
      { personaId: personas.sam, monto: 44625 },
      { personaId: personas.andreja, monto: 44625 }
    ],
    pagadores: [
      { personaId: personas.barrett, monto: 178500 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.constellation,
    descripcion: "Combustible de nave",
    categoria: "Transporte",
    fecha: isoDiasAtras(4),
    participantes: [
      { personaId: personas.sarah, monto: 23400 },
      { personaId: personas.barrett, monto: 23400 },
      { personaId: personas.sam, monto: 23400 },
      { personaId: personas.andreja, monto: 23400 }
    ],
    pagadores: [
      { personaId: personas.sarah, monto: 50000 },
      { personaId: personas.andreja, monto: 43600 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.constellation,
    descripcion: "Cena en New Atlantis",
    categoria: "Comida",
    fecha: isoDiasAtras(2),
    participantes: [
      { personaId: personas.sarah, monto: 17000 },
      { personaId: personas.barrett, monto: 19800 },
      { personaId: personas.sam, monto: 18400 },
      { personaId: personas.andreja, monto: 16000 }
    ],
    pagadores: [
      { personaId: personas.sam, monto: 71200 }
    ]
  });

  // BLADES
  await agregarEvento(conn, {
    grupoId: grupos.blades,
    descripcion: "Provisiones para Cloud Ruler Temple",
    categoria: "Compras",
    fecha: isoDiasAtras(6),
    participantes: [
      { personaId: personas.septim, monto: 19333.33 },
      { personaId: personas.jauffre, monto: 19333.33 },
      { personaId: personas.baurus, monto: 19333.34 }
    ],
    pagadores: [
      { personaId: personas.jauffre, monto: 58000 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.blades,
    descripcion: "Caballos a Bruma",
    categoria: "Transporte",
    fecha: isoDiasAtras(4),
    participantes: [
      { personaId: personas.septim, monto: 28000 },
      { personaId: personas.jauffre, monto: 28000 },
      { personaId: personas.baurus, monto: 28000 }
    ],
    pagadores: [
      { personaId: personas.septim, monto: 84000 }
    ]
  });

  await agregarEvento(conn, {
    grupoId: grupos.blades,
    descripcion: "Reparación de armaduras",
    categoria: "Servicios",
    fecha: isoDiasAtras(1),
    participantes: [
      { personaId: personas.septim, monto: 15500 },
      { personaId: personas.jauffre, monto: 15500 },
      { personaId: personas.baurus, monto: 15500 }
    ],
    pagadores: [
      { personaId: personas.baurus, monto: 46500 }
    ]
  });
}

export async function startDemo(req, res) {
  try {
    const vigente = await getDemoUser(req);

    if (vigente) {
      return res.json({
        ok: true,
        reused: true
      });
    }

    await limpiarDemosExpiradas();

    const token = crypto.randomBytes(32).toString("hex");
    const hash = tokenHash(token);
    const suffix = crypto.randomUUID();

    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(`
        INSERT INTO usuarios(
          email,
          nombre,
          is_demo,
          demo_token_hash,
          demo_expires_at,
          last_login_at
        )
        VALUES (
          ?,
          'Modo demo',
          TRUE,
          ?,
          CURRENT_TIMESTAMP + INTERVAL '2 hours',
          CURRENT_TIMESTAMP
        )
        RETURNING id
      `, [
        `demo-${suffix}@entre-amigos.local`,
        hash
      ]);

      const usuarioId = rows[0].id;

      await sembrarDemo(conn, usuarioId);
      await conn.commit();

      setDemoCookie(req, res, token);

      res.status(201).json({
        ok: true,
        expiresInSeconds: DEMO_SECONDS
      });

    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

  } catch (e) {
    console.error("startDemo:", e);

    res.status(500).json({
      error: "No se pudo iniciar la demo."
    });
  }
}

export async function resetDemo(req, res) {
  try {
    const usuario = await getDemoUser(req);

    if (!usuario) {
      return res.status(401).json({
        error: "DEMO_EXPIRED"
      });
    }

    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();
      await borrarDatosDemo(conn, usuario.id);
      await sembrarDemo(conn, usuario.id);

      await conn.query(`
        UPDATE usuarios
        SET demo_expires_at =
          CURRENT_TIMESTAMP + INTERVAL '2 hours'
        WHERE id = ?
      `, [usuario.id]);

      await conn.commit();

      res.json({
        ok: true,
        expiresInSeconds: DEMO_SECONDS
      });

    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

  } catch (e) {
    console.error("resetDemo:", e);

    res.status(500).json({
      error: "No se pudo restablecer la demo."
    });
  }
}

export async function endDemo(req, res) {
  try {
    const usuario = await getDemoUser(req);

    if (usuario) {
      const conn = await db.getConnection();

      try {
        await conn.beginTransaction();
        await borrarDatosDemo(conn, usuario.id);

        await conn.query(`
          DELETE FROM usuarios
          WHERE id = ?
            AND is_demo = TRUE
        `, [usuario.id]);

        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    clearDemoCookie(req, res);

    res.json({ ok: true });

  } catch (e) {
    console.error("endDemo:", e);
    clearDemoCookie(req, res);

    res.json({ ok: true });
  }
}